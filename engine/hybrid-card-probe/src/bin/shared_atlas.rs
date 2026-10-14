//! GPU correctness smoke for shared native resources; not an FPS benchmark.
use art_equation_p0_app_surface::native_gpu::NativeGpuRenderer;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{fs, path::Path, time::Duration};
fn wait(device: &wgpu::Device) -> Result<(), String> {
    device
        .poll(wgpu::PollType::Wait {
            timeout: Some(Duration::from_secs(30)),
            submission_index: None,
        })
        .map_err(|e| e.to_string())?;
    Ok(())
}
fn pixels(
    device: &wgpu::Device,
    queue: &wgpu::Queue,
    texture: &wgpu::Texture,
    w: u32,
    h: u32,
) -> Result<Vec<u8>, String> {
    let row = (w * 4).div_ceil(256) * 256;
    let buffer = device.create_buffer(&wgpu::BufferDescriptor {
        label: Some("Parity-only readback"),
        size: u64::from(row) * u64::from(h),
        usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
        mapped_at_creation: false,
    });
    let mut encoder = device.create_command_encoder(&Default::default());
    encoder.copy_texture_to_buffer(
        texture.as_image_copy(),
        wgpu::TexelCopyBufferInfo {
            buffer: &buffer,
            layout: wgpu::TexelCopyBufferLayout {
                offset: 0,
                bytes_per_row: Some(row),
                rows_per_image: Some(h),
            },
        },
        wgpu::Extent3d {
            width: w,
            height: h,
            depth_or_array_layers: 1,
        },
    );
    queue.submit([encoder.finish()]);
    let (tx, rx) = std::sync::mpsc::channel();
    buffer.slice(..).map_async(wgpu::MapMode::Read, move |r| {
        let _ = tx.send(r);
    });
    wait(device)?;
    rx.recv()
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())?;
    let mapped = buffer.slice(..).get_mapped_range();
    let mut result = Vec::with_capacity((w * h * 4) as usize);
    for row_bytes in mapped.chunks(row as usize) {
        result.extend_from_slice(&row_bytes[..(w * 4) as usize]);
    }
    drop(mapped);
    buffer.unmap();
    Ok(result)
}
fn save(path: &Path, w: u32, h: u32, pixels: &[u8]) -> Result<(), String> {
    image::save_buffer(path, pixels, w, h, image::ColorType::Rgba8).map_err(|e| e.to_string())
}
fn run() -> Result<(), String> {
    let args: Vec<_> = std::env::args().collect();
    let path = args.get(1).ok_or("input JSON required")?;
    let output = Path::new(args.get(2).ok_or("output directory required")?);
    fs::create_dir_all(output).map_err(|e| e.to_string())?;
    let bytes = fs::read(path).map_err(|e| e.to_string())?;
    let input: Value = serde_json::from_slice(&bytes).map_err(|e| e.to_string())?;
    let w = input["width"].as_u64().ok_or("width")? as u32;
    let h = input["height"].as_u64().ok_or("height")? as u32;
    if w == 0 || h == 0 || w > 4096 || h > 4096 {
        return Err("bounded target required".into());
    }
    let mut descriptor = wgpu::InstanceDescriptor::new_without_display_handle();
    descriptor.backends = wgpu::Backends::VULKAN;
    let instance = wgpu::Instance::new(descriptor);
    let adapter = pollster::block_on(instance.request_adapter(&wgpu::RequestAdapterOptions {
        power_preference: wgpu::PowerPreference::HighPerformance,
        ..Default::default()
    }))
    .map_err(|e| e.to_string())?;
    let (device, queue) =
        pollster::block_on(adapter.request_device(&wgpu::DeviceDescriptor::default()))
            .map_err(|e| e.to_string())?;
    let texture = device.create_texture(&wgpu::TextureDescriptor {
        label: Some("Shared native renderer target"),
        size: wgpu::Extent3d {
            width: w,
            height: h,
            depth_or_array_layers: 1,
        },
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format: wgpu::TextureFormat::Rgba8Unorm,
        usage: wgpu::TextureUsages::STORAGE_BINDING
            | wgpu::TextureUsages::RENDER_ATTACHMENT
            | wgpu::TextureUsages::TEXTURE_BINDING
            | wgpu::TextureUsages::COPY_SRC,
        view_formats: &[],
    });
    let view = texture.create_view(&Default::default());
    let mut renderer = NativeGpuRenderer::new(&device)?;
    for entry in input["resources"].as_array().ok_or("resources")? {
        let data =
            fs::read(entry["path"].as_str().ok_or("resource path")?).map_err(|e| e.to_string())?;
        if format!("{:x}", Sha256::digest(&data))
            != entry["sha256"].as_str().ok_or("resource hash")?
        {
            return Err("resource hash mismatch".into());
        }
        renderer.register_image(&entry["reference"].to_string(), data)?;
    }
    let mut source = input["snapshot"].clone();
    source["environment"]["background"] = json!("#102131ff");
    let source = source.to_string();
    let dpr = input["dpr"].as_f64().unwrap_or(1.);
    let s = input["view"]["scale"].as_f64().unwrap_or(1.) * dpr;
    let x = input["view"]["x"].as_f64().unwrap_or(0.) * dpr;
    let y = input["view"]["y"].as_f64().unwrap_or(0.) * dpr;
    let classic = renderer.render_to_texture(&device, &queue, &view, w, h, &source, s, x, y)?;
    wait(&device)?;
    let a = pixels(&device, &queue, &texture, w, h)?;
    save(&output.join("classic.png"), w, h, &a)?;
    let first =
        renderer.render_retained_hybrid_to_texture(&device, &queue, &view, w, h, s, x, y)?;
    wait(&device)?;
    let b = pixels(&device, &queue, &texture, w, h)?;
    save(&output.join("hybrid.png"), w, h, &b)?;
    let cached =
        renderer.render_retained_hybrid_to_texture(&device, &queue, &view, w, h, s, x, y)?;
    wait(&device)?;
    if cached["encodeCacheHit"] != true
        || cached["hybridImageUploadBytes"] != 0
        || cached["sceneParses"] != 0
    {
        return Err("Hybrid reuse contract failed".into());
    }
    let camera = renderer.render_retained_to_texture(&device, &queue, &view, w, h, s, x + 8., y)?;
    wait(&device)?;
    if !camera.encode_cache_hit {
        return Err("Classic camera rebuilt source".into());
    }
    let moved =
        renderer.render_retained_hybrid_to_texture(&device, &queue, &view, w, h, s, x + 8., y)?;
    wait(&device)?;
    if moved["encodeCacheHit"] != false {
        return Err("Hybrid reused stale camera strips".into());
    }
    let sum: u64 = a
        .iter()
        .zip(&b)
        .map(|(a, b)| u64::from(a.abs_diff(*b)))
        .sum();
    let max = a
        .iter()
        .zip(&b)
        .map(|(a, b)| a.abs_diff(*b))
        .max()
        .unwrap_or(0);
    let changed = a
        .chunks_exact(4)
        .zip(b.chunks_exact(4))
        .filter(|(a, b)| a.iter().zip(*b).any(|(a, b)| a.abs_diff(*b) > 8))
        .count();
    let info = adapter.get_info();
    let report = json!({"status":"RESOURCE_REUSE_SMOKE_ONLY; APP_INPUT_AND_4K_ACCEPTANCE_PENDING","inputSha256":format!("{:x}",Sha256::digest(bytes)),"adapter":info.name,"backend":format!("{:?}",info.backend),"width":w,"height":h,"sharedDevice":true,"sharedOutput":true,"readbacksForParityOnly":true,"classic":classic,"hybridFirst":first,"hybridCached":cached,"classicCamera":camera,"hybridCameraInvalidated":moved,"parity":{"meanChannelError":sum as f64/a.len() as f64,"maxChannelError":max,"pixelsOver8":changed,"pixelCount":w*h}});
    fs::write(
        output.join("report.json"),
        serde_json::to_vec_pretty(&report).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    println!("{}", report);
    Ok(())
}
fn main() {
    if let Err(error) = run() {
        eprintln!("{error}");
        std::process::exit(1)
    }
}
