//! Hybrid reuses Classic's validated geometry and premultiplied atlas textures.
//! No second decode, JSON parse, CPU pixel copy, or Hybrid image upload.
use crate::{
    image_atlas::GpuImageAtlas,
    prepared_scene::{PreparedOp, PreparedScene, PreparedScopeKind},
};
#[cfg(not(target_arch="wasm32"))]
fn clock_ms()->f64 {static ORIGIN:std::sync::OnceLock<std::time::Instant>=std::sync::OnceLock::new();ORIGIN.get_or_init(std::time::Instant::now).elapsed().as_secs_f64()*1000.}
#[cfg(target_arch="wasm32")]
#[wasm_bindgen::prelude::wasm_bindgen]
extern "C" {#[wasm_bindgen::prelude::wasm_bindgen(js_namespace=performance,js_name=now)]fn clock_ms()->f64;}
use vello_common::{
    geometry::RectU16,
    kurbo::{Affine, Rect, Shape},
    peniko::{BlendMode, Compose, Fill, Mix},
};
use vello_hybrid::{Renderer, Resources, SampleRect, Scene, TextureBindings, TextureId};

#[derive(PartialEq)]
struct Key {
    revision: u64,
    width: u32,
    height: u32,
    camera: [u64; 6],
    atlases: Vec<u64>,
}
pub(crate) struct RetainedHybrid {
    renderer: Renderer,
    resources: Resources,
    scene: Option<Scene>,
    key: Option<Key>,
    bindings: TextureBindings,
}
impl RetainedHybrid {
    pub fn new(device: &wgpu::Device, width: u32, height: u32) -> Self {
        let (renderer, resources) = Renderer::new(
            device,
            &vello_hybrid::RenderTargetConfig {
                format: wgpu::TextureFormat::Rgba8Unorm,
                width,
                height,
            },
        );
        Self {
            renderer,
            resources,
            scene: None,
            key: None,
            bindings: TextureBindings::new(),
        }
    }
    pub fn render(
        &mut self,
        device: &wgpu::Device,
        queue: &wgpu::Queue,
        target: &wgpu::TextureView,
        prepared: &PreparedScene,
        environment: Option<&PreparedScene>,
        atlases: &[GpuImageAtlas],
        revision: u64,
        width: u32,
        height: u32,
        camera: Affine,
    ) -> Result<serde_json::Value, String> {
        let start = clock_ms();
        if width == 0 || height == 0 || width > 4096 || height > 4096 {
            return Err("HYBRID_UNSUPPORTED: bounded target required".into());
        }
        // Reject before touching the retained scene. Classic remains authoritative
        // for paint kinds whose parity has not been checked in this adapter.
        for op in environment.into_iter().flat_map(|p|p.operations.iter()).chain(prepared.operations.iter()) {
            match op {
                PreparedOp::Gradient(_) | PreparedOp::Shadow(_) => {
                    return Err("HYBRID_UNSUPPORTED: gradient/shadow parity pending".into())
                }
                PreparedOp::Scope(s)
                    if s.blend.compose != Compose::SrcOver
                        || !matches!(s.blend.mix, Mix::Normal | Mix::Multiply | Mix::Screen) =>
                {
                    return Err("HYBRID_UNSUPPORTED: blend parity pending".into())
                }
                _ => {}
            }
        }
        let key = Key {
            revision,
            width,
            height,
            camera: camera.as_coeffs().map(f64::to_bits),
            atlases: atlases.iter().map(|a| a.uploads).collect(),
        };
        let cached = self.key.as_ref() == Some(&key);
        if !cached {
            let mut scene = Scene::new(width as u16, height as u16);
            scene.set_paint(environment.map(|p|p.background).unwrap_or(prepared.background));
            scene.fill_rect(&Rect::new(0., 0., width as f64, height as f64));
            for prepared in environment.into_iter().chain(std::iter::once(prepared)) {
            for op in &prepared.operations {
                match op {
                    PreparedOp::Vector(index) => {
                        let o = &prepared.vectors[*index];
                        scene.set_transform(camera * o.transform);
                        scene.reset_paint_transform();
                        scene.set_fill_rule(o.fill_rule);
                        if o.opacity < 1. {
                            scene.push_layer(
                                Some(&o.opacity_clip.to_path(0.1)),
                                Some(BlendMode::default()),
                                Some(o.opacity),
                                None,
                                None,
                            )
                        }
                        scene.set_paint(o.fill);
                        scene.fill_path(&o.path);
                        if let Some(path) = &o.stroke_path {
                            scene.set_stroke(o.stroke.clone());
                            scene.set_paint(o.stroke_color);
                            scene.stroke_path(path)
                        }
                        if o.opacity < 1. {
                            scene.pop_layer()
                        }
                    }
                    PreparedOp::Image(index) => {
                        let i = &prepared.images[*index];
                        let (page, (x, y)) = atlases
                            .iter()
                            .enumerate()
                            .find_map(|(page, a)| {
                                a.shared_slot(&i.resource).map(|slot| (page, slot))
                            })
                            .ok_or("HYBRID_RESOURCE_NOT_READY: atlas slot missing")?;
                        scene.set_transform(camera * i.transform);
                        scene.set_fill_rule(Fill::NonZero);
                        // Clip the full resource to the authored fractional crop;
                        // external SampleRect itself uses integer texel regions.
                        scene.push_clip_layer(&i.source.to_path(0.1));
                        if i.opacity < 1. {
                            scene.push_opacity_layer(i.opacity)
                        }
                        let rect = RectU16::new(
                            x as u16,
                            y as u16,
                            (x + i.resource.width) as u16,
                            (y + i.resource.height) as u16,
                        );
                        scene.draw_texture_rects(
                            TextureId(page as u64),
                            i.quality,
                            [SampleRect {
                                source_region: rect,
                                transform: Affine::IDENTITY,
                            }],
                        );
                        if i.opacity < 1. {
                            scene.pop_layer()
                        }
                        scene.pop_layer();
                    }
                    PreparedOp::Scope(s) => {
                        scene.set_transform(camera * s.transform);
                        scene.set_fill_rule(s.fill_rule);
                        if s.kind == PreparedScopeKind::Clip {
                            scene.push_clip_layer(&s.path)
                        } else {
                            scene.push_layer(
                                Some(&s.path),
                                Some(s.blend),
                                Some(s.opacity),
                                None,
                                None,
                            )
                        }
                    }
                    PreparedOp::Pop => scene.pop_layer(),
                    _ => unreachable!("eligibility checked"),
                }
            }
            }
            self.bindings = TextureBindings::new();
            for (index, atlas) in atlases.iter().enumerate() {
                self.bindings
                    .insert(TextureId(index as u64), atlas.shared_view());
            }
            self.scene = Some(scene);
            self.key = Some(key);
        }
        let encode_ms = clock_ms()-start;
        let mut encoder = device.create_command_encoder(&wgpu::CommandEncoderDescriptor {
            label: Some("Hybrid shared native target"),
        });
        self.renderer
            .render(
                self.scene.as_ref().expect("encoded scene"),
                &mut self.resources,
                device,
                queue,
                &mut encoder,
                &vello_hybrid::RenderSize { width, height },
                target,
                &self.bindings,
            )
            .map_err(|e| format!("Hybrid render: {e:?}"))?;
        queue.submit([encoder.finish()]);
        Ok(
            serde_json::json!({"backend":"hybrid-0.2","encodeCacheHit":cached,"encodeMs":encode_ms,
            "submitElapsedMs":clock_ms()-start,"sharedImagePages":atlases.len(),
            "hybridImageUploadBytes":0,"sceneParses":0,"pixelReadbacks":0,
            "timingScope":"CPU encode and submission; excludes GPU completion"}),
        )
    }
}
