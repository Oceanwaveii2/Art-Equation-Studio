// Art Equation extension to pinned Vello 0.10.0.
// Reject failed coarse allocations before fine can touch the external target.
use crate::recording::{Command, Recording};
use crate::{
    BumpAllocators, Error, ExternalResource, Render, RenderParams, Renderer, Result, Scene,
};
use wgpu::{Device, Queue, TextureView};

const STATUS_BYTES: u64 = 32;
const _: () = assert!(size_of::<BumpAllocators>() == STATUS_BYTES as usize);

fn checked_status(
    status: BumpAllocators,
    limits: vello_encoding::ConfigUniform,
) -> Result<BumpAllocators> {
    if status.failed != 0 {
        return Err(Error::GpuRenderCapacityExceeded(
            status,
            "shader allocation failure",
        ));
    }
    // The pinned shader reserves 64 u32s per tile before dynamic ptcl entries.
    let ptcl_prefix = u64::from(limits.width_in_tiles)
        .saturating_mul(u64::from(limits.height_in_tiles))
        .saturating_mul(64);
    let counters = [
        (
            u64::from(status.binning),
            u64::from(limits.binning_size),
            "binning",
        ),
        (
            ptcl_prefix.saturating_add(u64::from(status.ptcl)),
            u64::from(limits.ptcl_size),
            "ptcl",
        ),
        (u64::from(status.tile), u64::from(limits.tiles_size), "tile"),
        (
            u64::from(status.seg_counts),
            u64::from(limits.seg_counts_size),
            "seg_counts",
        ),
        (
            u64::from(status.segments),
            u64::from(limits.segments_size),
            "segments",
        ),
        (
            u64::from(status.blend),
            u64::from(limits.blend_size),
            "blend",
        ),
        (
            u64::from(status.lines),
            u64::from(limits.lines_size),
            "lines",
        ),
    ];
    if let Some((_, _, name)) = counters
        .into_iter()
        .find(|(needed, capacity, _)| needed > capacity)
    {
        return Err(Error::GpuRenderCapacityExceeded(status, name));
    }
    Ok(status)
}

// A dropped future must not strand the coarse resources or mapped download.
struct PendingCheckedRender<'a> {
    renderer: &'a mut Renderer,
    device: &'a Device,
    queue: &'a Queue,
    render: Option<Render>,
}
impl PendingCheckedRender<'_> {
    fn finish(
        mut self,
        texture: &TextureView,
        params: &RenderParams,
        status: Result<BumpAllocators>,
    ) -> Result<BumpAllocators> {
        let render = self
            .render
            .take()
            .expect("checked coarse render is pending");
        self.renderer.finish_checked_render(
            self.device,
            self.queue,
            texture,
            params,
            render,
            status,
        )
    }
}
impl Drop for PendingCheckedRender<'_> {
    fn drop(&mut self) {
        if let Some(render) = self.render.take()
            && let Err(error) =
                self.renderer
                    .release_rejected_render(self.device, self.queue, render)
        {
            log::warn!("GPU_RENDER_STATUS_UNAVAILABLE: cancelled coarse cleanup failed: {error}");
        }
    }
}

impl Renderer {
    /// Render only after verifying Vello's 32-byte coarse allocation status.
    ///
    /// No color pixels are downloaded. A failed or unavailable status rejects
    /// the frame before fine rasterization touches the supplied target.
    /// This extension is pinned by Art Equation; it does not change budgets.
    pub async fn render_to_texture_checked(
        &mut self,
        device: &Device,
        queue: &Queue,
        scene: &Scene,
        texture: &TextureView,
        params: &RenderParams,
    ) -> Result<BumpAllocators> {
        let render = self.begin_checked_render(device, queue, scene, params)?;
        let pending = PendingCheckedRender {
            renderer: self,
            device,
            queue,
            render: Some(render),
        };
        let status = if let Some(buffer) = pending
            .renderer
            .engine
            .get_download(pending.render.as_ref().unwrap().bump_buf())
        {
            let slice = buffer.slice(..STATUS_BYTES);
            let (sender, receiver) = futures_intrusive::channel::shared::oneshot_channel();
            slice.map_async(wgpu::MapMode::Read, move |value| {
                let _ = sender.send(value);
            });
            match receiver.receive().await {
                Some(Ok(())) => {
                    let mapped = slice.get_mapped_range();
                    let status = bytemuck::pod_read_unaligned(&mapped);
                    drop(mapped);
                    buffer.unmap();
                    Ok(status)
                }
                Some(Err(error)) => Err(Error::GpuRenderStatusUnavailable(format!(
                    "allocation status map failed: {error}"
                ))),
                None => Err(Error::GpuRenderStatusUnavailable(
                    "map channel closed".into(),
                )),
            }
        } else {
            Err(Error::GpuRenderStatusUnavailable(
                "coarse status download missing".into(),
            ))
        };
        pending.finish(texture, params, status)
    }

    /// Native counterpart using the same status check with a bounded device poll.
    ///
    /// Surface acquisition and presentation remain host-owned. No fine work is
    /// submitted unless the coarse status has been mapped and validated.
    #[cfg(not(target_arch = "wasm32"))]
    pub fn render_to_texture_checked_sync(
        &mut self,
        device: &Device,
        queue: &Queue,
        scene: &Scene,
        texture: &TextureView,
        params: &RenderParams,
    ) -> Result<BumpAllocators> {
        let render = self.begin_checked_render(device, queue, scene, params)?;
        let status = (|| {
            let buffer = self.engine.get_download(render.bump_buf()).ok_or_else(|| {
                Error::GpuRenderStatusUnavailable("coarse status download missing".into())
            })?;
            let slice = buffer.slice(..STATUS_BYTES);
            let (sender, receiver) = std::sync::mpsc::sync_channel(1);
            slice.map_async(wgpu::MapMode::Read, move |value| {
                let _ = sender.send(value);
            });
            if let Err(error) = device.poll(wgpu::PollType::Wait {
                submission_index: None,
                timeout: Some(std::time::Duration::from_secs(10)),
            }) {
                buffer.unmap();
                return Err(Error::GpuRenderStatusUnavailable(format!(
                    "native status poll failed: {error}"
                )));
            }
            let mapped_result = receiver.try_recv().map_err(|_| {
                Error::GpuRenderStatusUnavailable(
                    "native map callback unavailable after poll".into(),
                )
            });
            match mapped_result {
                Ok(Ok(())) => {
                    let mapped = slice.get_mapped_range();
                    let status = bytemuck::pod_read_unaligned(&mapped);
                    drop(mapped);
                    buffer.unmap();
                    Ok(status)
                }
                Ok(Err(error)) => Err(Error::GpuRenderStatusUnavailable(format!(
                    "allocation status map failed: {error}"
                ))),
                Err(error) => {
                    buffer.unmap();
                    Err(error)
                }
            }
        })();
        self.finish_checked_render(device, queue, texture, params, render, status)
    }

    fn begin_checked_render(
        &mut self,
        device: &Device,
        queue: &Queue,
        scene: &Scene,
        params: &RenderParams,
    ) -> Result<Render> {
        let mut render = Render::new();
        let recording = render.render_encoding_coarse(
            scene.encoding(),
            &mut self.resolver,
            &self.shaders,
            &mut self.image_atlas,
            params,
            true,
        );
        if let Err(error) = self.engine.run_recording(
            device,
            queue,
            &recording,
            &[],
            "art-equation-checked-coarse",
            #[cfg(feature = "wgpu-profiler")]
            &mut self.profiler,
        ) {
            // An interrupted run_recording has not executed its final frees.
            // Process those frees separately before releasing the fine set.
            let mut cleanup = Recording::default();
            for command in &recording.commands {
                match command {
                    Command::FreeBuffer(proxy) => cleanup.free_buffer(*proxy),
                    Command::FreeImage(proxy) => cleanup.free_image(*proxy),
                    Command::Download(proxy) => self.engine.free_download(*proxy),
                    _ => (),
                }
            }
            let _ = self.engine.run_recording(
                device,
                queue,
                &cleanup,
                &[],
                "art-equation-coarse-error-cleanup",
                #[cfg(feature = "wgpu-profiler")]
                &mut self.profiler,
            );
            let _ = self.release_rejected_render(device, queue, render);
            return Err(Error::GpuRenderStatusUnavailable(format!(
                "coarse recording failed: {error}"
            )));
        }
        Ok(render)
    }

    fn release_rejected_render(
        &mut self,
        device: &Device,
        queue: &Queue,
        mut render: Render,
    ) -> Result<()> {
        if let Some(buffer) = self.engine.get_download(render.bump_buf()) {
            buffer.unmap();
        }
        self.engine.free_download(render.bump_buf());
        let mut cleanup = Recording::default();
        render.discard_fine(&mut cleanup);
        #[cfg(feature = "debug_layers")]
        if let Some(captured) = render.take_captured_buffers() {
            self.engine.free_download(captured.lines);
            captured.release_buffers(&mut cleanup);
        }
        self.engine.run_recording(
            device,
            queue,
            &cleanup,
            &[],
            "art-equation-rejected-coarse-cleanup",
            #[cfg(feature = "wgpu-profiler")]
            &mut self.profiler,
        )
    }

    fn finish_checked_render(
        &mut self,
        device: &Device,
        queue: &Queue,
        texture: &TextureView,
        _params: &RenderParams,
        mut render: Render,
        status: Result<BumpAllocators>,
    ) -> Result<BumpAllocators> {
        self.engine.free_download(render.bump_buf());
        let status =
            match status.and_then(|status| checked_status(status, render.allocation_config())) {
                Ok(status) => status,
                Err(error) => {
                    if let Err(cleanup) = self.release_rejected_render(device, queue, render) {
                        return Err(Error::GpuRenderStatusUnavailable(format!(
                            "coarse cleanup failed: {cleanup}; original: {error}"
                        )));
                    }
                    return Err(error);
                }
            };
        let target = render.out_image();
        let mut recording = Recording::default();
        render.record_fine(&self.shaders, &mut recording);
        #[cfg(feature = "debug_layers")]
        if let Some(captured) = render.take_captured_buffers() {
            self.engine.free_download(captured.lines);
            captured.release_buffers(&mut recording);
        }
        let resources = [ExternalResource::Image(target, texture)];
        self.engine.run_recording(
            device,
            queue,
            &recording,
            &resources,
            "art-equation-checked-fine",
            #[cfg(feature = "wgpu-profiler")]
            &mut self.profiler,
        )?;
        #[cfg(feature = "wgpu-profiler")]
        {
            self.profiler.end_frame().unwrap();
            if let Some(result) = self
                .profiler
                .process_finished_frame(queue.get_timestamp_period())
            {
                self.profile_result = Some(result);
            }
        }
        Ok(status)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn generous_limits() -> vello_encoding::ConfigUniform {
        vello_encoding::ConfigUniform {
            width_in_tiles: 1,
            height_in_tiles: 1,
            binning_size: u32::MAX,
            ptcl_size: u32::MAX,
            tiles_size: u32::MAX,
            seg_counts_size: u32::MAX,
            segments_size: u32::MAX,
            blend_size: u32::MAX,
            lines_size: u32::MAX,
            ..Default::default()
        }
    }
    #[test]
    fn status_matches_the_shader_32_byte_contract() {
        assert_eq!(size_of::<BumpAllocators>(), 32);
    }
    #[test]
    fn zero_failure_preserves_real_counters() {
        let status = BumpAllocators {
            blend: 1_048_576,
            lines: 73,
            ..Default::default()
        };
        let checked = checked_status(status, generous_limits()).unwrap();
        assert_eq!(checked.blend, 1_048_576);
        assert_eq!(checked.lines, 73);
    }
    #[test]
    fn every_failure_bit_rejects_even_without_a_blend_count() {
        for failed in [1, 2, 4, 8, 16, 32, 1 << 31, u32::MAX] {
            let error = checked_status(
                BumpAllocators {
                    failed,
                    ..Default::default()
                },
                generous_limits(),
            )
            .unwrap_err();
            assert!(matches!(error, Error::GpuRenderCapacityExceeded(..)));
            assert!(
                error
                    .to_string()
                    .starts_with("GPU_RENDER_CAPACITY_EXCEEDED:")
            );
        }
    }
    #[test]
    fn segments_overflow_is_rejected_even_without_a_shader_flag() {
        let mut limits = generous_limits();
        limits.segments_size = 7;
        assert!(
            checked_status(
                BumpAllocators {
                    segments: 7,
                    ..Default::default()
                },
                limits
            )
            .is_ok()
        );
        assert!(
            checked_status(
                BumpAllocators {
                    segments: 8,
                    ..Default::default()
                },
                limits
            )
            .is_err()
        );
    }
    #[test]
    fn dynamic_ptcl_is_added_to_the_reserved_tile_prefix() {
        let mut limits = generous_limits();
        limits.width_in_tiles = 2;
        limits.height_in_tiles = 3;
        limits.ptcl_size = 400;
        assert!(
            checked_status(
                BumpAllocators {
                    ptcl: 16,
                    ..Default::default()
                },
                limits
            )
            .is_ok()
        );
        assert!(
            checked_status(
                BumpAllocators {
                    ptcl: 17,
                    ..Default::default()
                },
                limits
            )
            .is_err()
        );
    }
    #[test]
    fn every_dynamic_counter_is_bounded_by_the_real_coarse_config() {
        let mut limits = generous_limits();
        limits.binning_size = 2;
        limits.tiles_size = 2;
        limits.seg_counts_size = 2;
        limits.segments_size = 2;
        limits.blend_size = 2;
        limits.lines_size = 2;
        for status in [
            BumpAllocators {
                binning: 3,
                ..Default::default()
            },
            BumpAllocators {
                tile: 3,
                ..Default::default()
            },
            BumpAllocators {
                seg_counts: 3,
                ..Default::default()
            },
            BumpAllocators {
                segments: 3,
                ..Default::default()
            },
            BumpAllocators {
                blend: 3,
                ..Default::default()
            },
            BumpAllocators {
                lines: 3,
                ..Default::default()
            },
        ] {
            assert!(checked_status(status, limits).is_err());
        }
    }
}
