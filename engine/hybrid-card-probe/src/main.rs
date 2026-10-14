use art_equation_p0_app_surface::native_gpu::NativeGpuRenderer;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    fs,
    path::Path,
    time::{Duration, Instant},
};
use vello_common::{
    kurbo::{Affine, BezPath, Cap, Join, Rect, Stroke},
    paint::{Image, ImageId, ImageSource},
    peniko::{BlendMode, Color, Compose, Fill, ImageQuality, ImageSampler, Mix},
    pixmap::Pixmap,
};
fn n(v: &Value, k: &str, default: f64) -> f64 {
    v[k].as_f64().unwrap_or(default)
}
fn matrix(v: &Value) -> Affine {
    let a = v.as_array().expect("affine");
    Affine::new(std::array::from_fn(|i| {
        a[i].as_f64().expect("finite affine")
    }))
}
fn color(v: &Value, opacity: f64) -> Result<Color, String> {
    let s = v.as_str().unwrap_or("#00000000").trim_start_matches('#');
    if s.len() != 6 && s.len() != 8 {
        return Err(format!("Unsupported paint color {v}"));
    }
    let c = |at| u8::from_str_radix(&s[at..at + 2], 16).map_err(|e| e.to_string());
    Ok(Color::from_rgba8(
        c(0)?,
        c(2)?,
        c(4)?,
        ((if s.len() == 8 { c(6)? } else { 255 }) as f64 * opacity).round() as u8,
    ))
}
fn path(v: &Value) -> Result<BezPath, String> {
    let mut p = BezPath::new();
    for command in v.as_array().ok_or("commands required")? {
        let c = command.as_array().ok_or("command array")?;
        let at = |i: usize| c[i].as_f64().expect("path coordinate");
        match c[0].as_str().ok_or("path verb")? {
            "M" => p.move_to((at(1), at(2))),
            "L" => p.line_to((at(1), at(2))),
            "Q" => p.quad_to((at(1), at(2)), (at(3), at(4))),
            "C" => p.curve_to((at(1), at(2)), (at(3), at(4)), (at(5), at(6))),
            "Z" => p.close_path(),
            other => return Err(format!("unsupported path verb {other}")),
        }
    }
    Ok(p)
}
fn encode_hybrid(
    scene: &mut vello_hybrid::Scene,
    snapshot: &Value,
    ids: &HashMap<String, ImageId>,
    camera: Affine,
) -> Result<(), String> {
    scene.reset();
    scene.set_transform(Affine::IDENTITY);
    scene.set_paint(Color::from_rgb8(16, 33, 49));
    scene.fill_rect(&Rect::new(
        0.,
        0.,
        scene.width() as f64,
        scene.height() as f64,
    ));
    for op in snapshot["operations"].as_array().ok_or("operations")? {
        match op["type"].as_str().ok_or("operation type")? {
            "vector" => {
                let o = &op["object"];
                let p = &o["payload"];
                let path = path(&p["commands"])?;
                scene.set_transform(camera * matrix(&o["transform"]));
                scene.reset_paint_transform();
                scene.set_fill_rule(if p["vectorFillRule"] == "evenodd" {
                    Fill::EvenOdd
                } else {
                    Fill::NonZero
                });
                let alpha = n(o, "opacity", 1.);
                let fill = color(&p["fill"], alpha)?;
                scene.set_paint(fill);
                scene.fill_path(&path);
                let width = n(p, "strokeWidth", 0.);
                if width > 0. {
                    let mut stroke = Stroke::new(width);
                    stroke.join = match p["vectorStrokeJoin"].as_str() {
                        Some("round") => Join::Round,
                        Some("bevel") => Join::Bevel,
                        _ => Join::Miter,
                    };
                    let cap = match p["vectorStrokeCap"].as_str() {
                        Some("round") => Cap::Round,
                        Some("square") => Cap::Square,
                        _ => Cap::Butt,
                    };
                    stroke.start_cap = cap;
                    stroke.end_cap = cap;
                    scene.set_stroke(stroke);
                    scene.set_paint(color(&p["stroke"], alpha)?);
                    scene.stroke_path(&path)
                }
            }
            "image" => {
                let r = &op["resource"];
                let key = format!("{}:{}", r["key"].as_str().unwrap(), r["revision"]);
                let id = *ids.get(&key).ok_or("image not uploaded")?;
                let rect = &op["sourceRect"];
                let x = n(rect, "x", 0.);
                let y = n(rect, "y", 0.);
                let w = n(rect, "width", 0.);
                let h = n(rect, "height", 0.);
                let t = camera * matrix(&op["transform"]);
                scene.set_transform(t);
                scene.set_paint_transform(Affine::IDENTITY);
                let opacity = n(op, "opacity", 1.);
                if opacity < 1. {
                    scene.push_opacity_layer(opacity as f32)
                }
                scene.set_paint(Image {
                    image: ImageSource::opaque_id(id),
                    sampler: ImageSampler::default().with_quality(if op["sampling"] == "nearest" {
                        ImageQuality::Low
                    } else {
                        ImageQuality::Medium
                    }),
                });
                scene.fill_rect(&Rect::new(x, y, x + w, y + h));
                if opacity < 1. {
                    scene.pop_layer()
                }
            }
            "pushClip" => {
                scene.set_transform(camera * matrix(&op["transform"]));
                scene.set_fill_rule(if op["fillRule"] == "evenodd" {
                    Fill::EvenOdd
                } else {
                    Fill::NonZero
                });
                scene.push_clip_layer(&path(&op["commands"])?)
            }
            "pushComposite" => {
                scene.set_transform(camera * matrix(&op["transform"]));
                scene.set_fill_rule(if op["fillRule"] == "evenodd" {
                    Fill::EvenOdd
                } else {
                    Fill::NonZero
                });
                let mix = match op["blendMode"].as_str() {
                    Some("normal") => Mix::Normal,
                    Some("multiply") => Mix::Multiply,
                    Some("screen") => Mix::Screen,
                    _ => return Err("Unsupported isolated blend in Hybrid probe".into()),
                };
                scene.push_layer(
                    Some(&path(&op["commands"])?),
                    Some(BlendMode {
                        mix,
                        compose: Compose::SrcOver,
                    }),
                    Some(n(op, "opacity", 1.) as f32),
                    None,
                    None,
                )
            }
            "pop" => scene.pop_layer(),
            other => {
                return Err(format!(
                    "Unsupported Hybrid replay operation: {other}; cannot claim fidelity"
                ));
            }
        }
    }
    Ok(())
}
fn wait(device: &wgpu::Device) -> Result<(), String> {
    device
        .poll(wgpu::PollType::Wait {
            timeout: Some(Duration::from_secs(30)),
            submission_index: None,
        })
        .map_err(|e| format!("GPU wait: {e}"))?;
    Ok(())
}
fn readback(
    device: &wgpu::Device,
    queue: &wgpu::Queue,
    texture: &wgpu::Texture,
    width: u32,
    height: u32,
) -> Result<Vec<u8>, String> {
    let row = (width * 4).div_ceil(256) * 256;
    let buffer = device.create_buffer(&wgpu::BufferDescriptor {
        label: Some("parity-only readback"),
        size: row as u64 * height as u64,
        usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
        mapped_at_creation: false,
    });
    let mut e = device.create_command_encoder(&Default::default());
    e.copy_texture_to_buffer(
        texture.as_image_copy(),
        wgpu::TexelCopyBufferInfo {
            buffer: &buffer,
            layout: wgpu::TexelCopyBufferLayout {
                offset: 0,
                bytes_per_row: Some(row),
                rows_per_image: Some(height),
            },
        },
        wgpu::Extent3d {
            width,
            height,
            depth_or_array_layers: 1,
        },
    );
    queue.submit([e.finish()]);
    let (tx, rx) = std::sync::mpsc::channel();
    buffer.slice(..).map_async(wgpu::MapMode::Read, move |r| {
        let _ = tx.send(r);
    });
    wait(device)?;
    rx.recv()
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())?;
    let data = buffer.slice(..).get_mapped_range();
    let mut pixels = Vec::with_capacity((width * height * 4) as usize);
    for r in data.chunks(row as usize) {
        pixels.extend_from_slice(&r[..width as usize * 4]);
    }
    drop(data);
    buffer.unmap();
    Ok(pixels)
}
fn percentile(values: &[f64], p: f64) -> f64 {
    let mut v = values.to_vec();
    v.sort_by(f64::total_cmp);
    v[((v.len() - 1) as f64 * p).ceil() as usize]
}
fn run() -> Result<(), String> {
    let args: Vec<_> = std::env::args().collect();
    let input_path = args.get(1).ok_or("input JSON path required")?;
    let output = args.get(2).ok_or("output directory required")?;
    fs::create_dir_all(output).map_err(|e| e.to_string())?;
    let bytes = fs::read(input_path).map_err(|e| e.to_string())?;
    let input: Value = serde_json::from_slice(&bytes).map_err(|e| e.to_string())?;
    let width = input["width"].as_u64().unwrap() as u32;
    let height = input["height"].as_u64().unwrap() as u32;
    let started = Instant::now();
    let mut descriptor = wgpu::InstanceDescriptor::new_without_display_handle();
    descriptor.backends = wgpu::Backends::VULKAN;
    let instance = wgpu::Instance::new(descriptor);
    let adapter = pollster::block_on(instance.request_adapter(&wgpu::RequestAdapterOptions {
        power_preference: wgpu::PowerPreference::HighPerformance,
        force_fallback_adapter: false,
        compatible_surface: None,
    }))
    .map_err(|e| e.to_string())?;
    let info = adapter.get_info();
    let (device, queue) = pollster::block_on(adapter.request_device(&wgpu::DeviceDescriptor {
        label: Some("Classic vs Hybrid card probe"),
        ..Default::default()
    }))
    .map_err(|e| e.to_string())?;
    let adapter_ms = started.elapsed().as_secs_f64() * 1000.;
    let texture = device.create_texture(&wgpu::TextureDescriptor {
        label: Some("identical headless card target"),
        size: wgpu::Extent3d {
            width,
            height,
            depth_or_array_layers: 1,
        },
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format: wgpu::TextureFormat::Rgba8Unorm,
        usage: wgpu::TextureUsages::RENDER_ATTACHMENT
            | wgpu::TextureUsages::STORAGE_BINDING
            | wgpu::TextureUsages::TEXTURE_BINDING
            | wgpu::TextureUsages::COPY_SRC,
        view_formats: &[],
    });
    let target = texture.create_view(&Default::default());
    let setup = Instant::now();
    let mut classic = NativeGpuRenderer::new(&device)?;
    let (mut hybrid, mut resources) = vello_hybrid::Renderer::new(
        &device,
        &vello_hybrid::RenderTargetConfig {
            format: wgpu::TextureFormat::Rgba8Unorm,
            width,
            height,
        },
    );
    let setup_ms = setup.elapsed().as_secs_f64() * 1000.;
    let mut ids = HashMap::new();
    let mut upload = device.create_command_encoder(&Default::default());
    let mut source_bytes = 0usize;
    let upload_start = Instant::now();
    for entry in input["resources"].as_array().ok_or("resources")? {
        let r = &entry["reference"];
        let pixels = fs::read(entry["path"].as_str().unwrap()).map_err(|e| e.to_string())?;
        let hash = format!("{:x}", Sha256::digest(&pixels));
        if hash != entry["sha256"].as_str().unwrap() {
            return Err("pixel resource hash mismatch".into());
        }
        source_bytes += pixels.len();
        classic.register_image(&r.to_string(), pixels.clone())?;
        let rgba = pixels
            .chunks_exact(4)
            .map(|p| vello_common::peniko::color::PremulRgba8 {
                r: p[0],
                g: p[1],
                b: p[2],
                a: p[3],
            })
            .collect();
        let pixmap = Pixmap::from_parts(
            rgba,
            r["width"].as_u64().unwrap() as u16,
            r["height"].as_u64().unwrap() as u16,
        );
        let id = hybrid.upload_image(&mut resources, &device, &queue, &mut upload, &pixmap);
        ids.insert(
            format!("{}:{}", r["key"].as_str().unwrap(), r["revision"]),
            id,
        );
    }
    queue.submit([upload.finish()]);
    wait(&device)?;
    let resource_setup_ms = upload_start.elapsed().as_secs_f64() * 1000.;
    let mut snapshot = input["snapshot"].clone();
    snapshot["environment"]["background"] = json!("#102131ff");
    let snapshot_string = snapshot.to_string();
    let scale = n(&input["view"], "scale", 1.) * n(&input, "dpr", 1.);
    let pan_x = n(&input["view"], "x", 0.) * n(&input, "dpr", 1.);
    let pan_y = n(&input["view"], "y", 0.) * n(&input, "dpr", 1.);
    let mut hscene = vello_hybrid::Scene::new(width as u16, height as u16);
    let size = vello_hybrid::RenderSize { width, height };
    let mut rows = Vec::new();
    let trace = std::env::var("AE_HYBRID_TRACE").unwrap_or_else(|_| "camera".into());
    let mut parity = HashMap::new();
    let mut receipts = Vec::new();
    let order = if std::env::var("AE_HYBRID_FIRST").is_ok() {
        ["hybrid", "classic"]
    } else {
        ["classic", "hybrid"]
    };
    for backend in order {
        let mut first = 0.;
        let mut warm = Vec::new();
        for frame in 0..21 {
            let t = Instant::now();
            let camera = Affine::new([
                scale,
                0.,
                0.,
                scale,
                pan_x
                    + if trace == "static" {
                        0.
                    } else {
                        (frame % 7) as f64 * 2.
                    },
                pan_y,
            ]);
            if backend == "classic" {
                let receipt = classic.render_to_texture(
                    &device,
                    &queue,
                    &target,
                    width,
                    height,
                    &snapshot_string,
                    scale,
                    pan_x
                        + if trace == "static" {
                            0.
                        } else {
                            (frame % 7) as f64 * 2.
                        },
                    pan_y,
                )?;
                receipts.push(serde_json::to_value(receipt).unwrap());
            } else {
                if frame == 0 || trace != "static" {
                    encode_hybrid(&mut hscene, &snapshot, &ids, camera)?;
                }
                let mut encoder = device.create_command_encoder(&Default::default());
                hybrid
                    .render(
                        &hscene,
                        &mut resources,
                        &device,
                        &queue,
                        &mut encoder,
                        &size,
                        &target,
                        &vello_hybrid::TextureBindings::default(),
                    )
                    .map_err(|e| e.to_string())?;
                queue.submit([encoder.finish()]);
            }
            wait(&device)?;
            let elapsed = t.elapsed().as_secs_f64() * 1000.;
            if frame == 0 {
                first = elapsed;
                let pixels = readback(&device, &queue, &texture, width, height)?;
                image::save_buffer(
                    Path::new(output).join(format!("{backend}.png")),
                    &pixels,
                    width,
                    height,
                    image::ColorType::Rgba8,
                )
                .map_err(|e| e.to_string())?;
                parity.insert(backend, pixels);
            } else if frame >= 6 {
                warm.push(elapsed)
            }
        }
        rows.push(json!({"backend":backend,"coldFirstRenderCompletionMs":first,"warmFrames":warm.len(),"warmMedianWallMs":percentile(&warm,0.5),"warmP95WallMs":percentile(&warm,0.95),"warmWallMs":warm}));
    }
    let a = &parity["classic"];
    let b = &parity["hybrid"];
    let mut total = 0u64;
    let mut over = 0usize;
    let mut maximum = 0u8;
    for (&x, &y) in a.iter().zip(b) {
        let d = x.abs_diff(y);
        maximum = maximum.max(d);
        total += d as u64;
        if d > 8 {
            over += 1
        }
    }
    let report = json!({"trace":trace,"status":"EXPERIMENT_COMPLETED; FULL_APP_ACCEPTANCE_NOT_TESTED","hybridVersion":"0.2.0","classicVersion":"0.10.0","adapter":{"name":info.name,"backend":format!("{:?}",info.backend),"deviceType":format!("{:?}",info.device_type),"vendor":info.vendor,"device":info.device,"driver":info.driver,"driverInfo":info.driver_info},"inputSha256":format!("{:x}",Sha256::digest(&bytes)),"fixtureSha256":input["fixtureSha256"],"authoredObjects":500,"acceptedObjectsIncludingEdges":input["accepted"],"excludedObjects":input["excludedObjects"],"target":{"width":width,"height":height},"adapterMs":adapter_ms,"rendererSetupMs":setup_ms,"resourceSetupMs":resource_setup_ms,"decodedPixelBytes":source_bytes,"hybridAtlasBytes":hybrid.atlas_texture().width() as u64*hybrid.atlas_texture().height() as u64*hybrid.atlas_texture().depth_or_array_layers() as u64*4,"timings":rows,"classicReceipts":receipts,"parity":{"meanAbsoluteChannelError":total as f64/a.len() as f64,"maximumChannelError":maximum,"fractionChannelsOver8":over as f64/a.len() as f64},"limits":["Headless renderer replay, not native shell pan/drag/edit/save or physical input latency.","Wall time includes adapter CPU encoding, GPU submission and completion wait. Not pure GPU timestamps or monitor FPS. Camera trace currently rebuilds Hybrid geometry from the prepared JSON; static trace reuses its prepared Scene.","First-render samples include wrapper preparation/validation differences and sequential shader warmup; they do not measure comparative app cold opening.","Both backends use identical premultiplied pixel resources and vectorized glyph operations; image decode is excluded from warm timings.","Missing subboard providers are excluded explicitly. Full board parity cannot pass.","Two diagnostic readbacks occur outside timed frames; screenshots and numerical difference require inspection."]});
    fs::write(
        Path::new(output).join("report.json"),
        serde_json::to_vec_pretty(&report).unwrap(),
    )
    .map_err(|e| e.to_string())?;
    println!(
        "{}",
        json!({"out":output,"adapter":report["adapter"],"timings":report["timings"],"parity":report["parity"]})
    );
    Ok(())
}
fn main() {
    if let Err(error) = run() {
        eprintln!("HYBRID_TEST_FAILED: {error}");
        std::process::exit(1)
    }
}
