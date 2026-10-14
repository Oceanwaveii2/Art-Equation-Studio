//! P0 app surface: prepare Vello compute, then synchronously commit the main-thread surface.
//! The frame path never maps a GPU buffer or transfers pixel data to JavaScript.

use serde_json::Value;

#[cfg(all(target_arch = "wasm32", feature = "native-cpu-parallel"))]
compile_error!("native-cpu-parallel must not be enabled for the browser WASM worker");

const PROOF_MAX_DIMENSION: u32 = 4096;
const MAX_SNAPSHOT_BYTES: usize = 16 * 1024 * 1024;
const MAX_OBJECTS: usize = 50_000;
pub mod cpu;
mod gpu_scene;
mod prepared_display_list;
mod prepared_scene;
mod retained_protocol;
pub mod shaped_text;
mod image_resources;
mod image_atlas;
#[cfg(not(target_arch = "wasm32"))]
#[cfg(not(target_arch = "wasm32"))]
pub mod native_gpu;
#[cfg(any(feature="native-hybrid",feature="browser-hybrid"))]
mod native_hybrid;

#[cfg(target_arch="wasm32")]
pub type EngineError=wasm_bindgen::JsValue;
#[cfg(not(target_arch="wasm32"))]
pub type EngineError=String;
pub fn engine_error(message:impl AsRef<str>)->EngineError {
    #[cfg(target_arch="wasm32")]
    {wasm_bindgen::JsValue::from_str(message.as_ref())}
    #[cfg(not(target_arch="wasm32"))]
    {message.as_ref().to_owned()}
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct EncodingReport {
    objects: usize,
    vectors: usize,
    connections: usize,
    encoded_connections: usize,
    text: usize,
    raster: usize,
    structural: usize,
    requires_mixed_compositor: bool,
}

#[cfg(test)]
fn real_board_fixture() -> Value {
    serde_json::from_str(include_str!("../fixtures/real-board-sacrificial.json"))
        .expect("owned sacrificial scene fixture must parse")
}

/// A frame can be presented only after a successful preparation. Starting another
/// preparation or discarding invalidates the old frame, and commit consumes it.
struct PreparedGate<T> {
    ready: Option<T>,
}

impl<T> Default for PreparedGate<T> {
    fn default() -> Self {
        Self { ready: None }
    }
}

impl<T> PreparedGate<T> {
    fn discard(&mut self) {
        self.ready = None;
    }
    fn stage(&mut self, frame: T) {
        self.ready = Some(frame);
    }
    fn take_for_present(&mut self) -> Result<T, &'static str> {
        self.ready
            .take()
            .ok_or("NO_PREPARED_FRAME: prepare a frame before presenting")
    }
}

#[cfg(target_arch = "wasm32")]
#[wasm_bindgen::prelude::wasm_bindgen]
pub fn render_cpu_snapshot(
    width: u32,
    height: u32,
    snapshot_json: String,
    scale: f64,
    pan_x: f64,
    pan_y: f64,
) -> Result<Vec<u8>, wasm_bindgen::JsValue> {
    cpu::render_cpu_snapshot(width, height, &snapshot_json, scale, pan_x, pan_y)
        .map_err(|error| wasm_bindgen::JsValue::from_str(&error))
}

#[derive(Debug, PartialEq)]
struct FrameInput {
    width: u32,
    height: u32,
    scale: f64,
    pan_x: f64,
    pan_y: f64,
}

fn validate_frame(
    width: u32,
    height: u32,
    device_max_dimension: u32,
    scale: f64,
    pan_x: f64,
    pan_y: f64,
) -> Result<FrameInput, String> {
    if width == 0 || height == 0 || device_max_dimension == 0 {
        return Err("Frame dimensions must be nonzero".into());
    }
    if !scale.is_finite() || scale <= 0.0 || scale > 1_000_000.0 {
        return Err("Viewport scale must be finite, positive and at most 1000000".into());
    }
    if !pan_x.is_finite() || !pan_y.is_finite() || pan_x.abs() > 1e9 || pan_y.abs() > 1e9 {
        return Err("Viewport pan must be finite and within +/-1000000000".into());
    }
    let maximum = device_max_dimension.min(PROOF_MAX_DIMENSION);
    Ok(FrameInput {
        width: width.min(maximum),
        height: height.min(maximum),
        scale,
        pan_x,
        pan_y,
    })
}

fn validate_numbers(value: &Value) -> Result<(), String> {
    match value {
        Value::Number(number) => {
            let value = number
                .as_f64()
                .ok_or("Snapshot number is outside f64 range")?;
            if !value.is_finite() || value.abs() > 1e12 {
                return Err(
                    "Snapshot numeric magnitude exceeds the proof's finite 1e12 limit".into(),
                );
            }
        }
        Value::Array(values) => {
            for value in values {
                validate_numbers(value)?;
            }
        }
        Value::Object(values) => {
            for value in values.values() {
                validate_numbers(value)?;
            }
        }
        _ => {}
    }
    Ok(())
}

/// This slice consumes flat path commands plus one canonical affine matrix.
/// It cannot infer an inherited group transform, clipping or live Boolean from
/// production BoardNode metadata. Reject those meanings rather than painting a
/// successful but geometrically different rectangle/path.
fn validate_flat_vector_metadata(object: &Value) -> Result<(), String> {
    prepared_scene::object_transform(object)?;
    for key in [
        "parentId",
        "clipId",
        "groupId",
        "vectorTransform",
        "vectorBoolean",
        "clip",
        "clipPath",
        "clipStack",
        "mask",
        "filter",
    ] {
        if !object[key].is_null() {
            return Err(format!(
                "SCENE_UNSUPPORTED: object.{key} requires a later full-scene engine slice"
            ));
        }
    }
    let payload = &object["payload"];
    for key in [
        "vectorTransform",
        "vectorBoolean",
        "vectorPath",
        "resolvedPaths",
        "clip",
        "clipPath",
        "clips",
        "clipStack",
        "mask",
        "filter",
        "shadow",
        "diagramCaption",
    ] {
        if !payload[key].is_null() {
            return Err(format!(
                "SCENE_UNSUPPORTED: payload.{key} must be encoded into supported flat commands/matrix before rendering"
            ));
        }
    }
    if !payload["clipChildren"].is_null() && payload["clipChildren"] != false {
        return Err(
            "SCENE_UNSUPPORTED: active clipChildren requires the full-scene clip hierarchy".into(),
        );
    }
    if !payload["fillOpacity"].is_null() && payload["fillOpacity"].as_f64() != Some(1.0) {
        return Err(
            "SCENE_UNSUPPORTED: separate fillOpacity requires a later matched CPU/GPU paint slice"
                .into(),
        );
    }
    if !payload["cornerRadius"].is_null() && payload["cornerRadius"].as_f64() != Some(0.0) {
        return Err(
            "SCENE_UNSUPPORTED: cornerRadius must be encoded into path commands before rendering"
                .into(),
        );
    }
    if payload["commands"].is_null() {
        if let Some(shape) = payload["shapeType"].as_str() {
            if shape != "rect" && shape != "rectangle" {
                return Err(format!(
                    "SCENE_UNSUPPORTED: {shape} requires explicit path commands; bounds fallback only supports rectangles"
                ));
            }
        }
    }
    Ok(())
}

fn parse_snapshot(source: &str) -> Result<Value, String> {
    if source.len() > MAX_SNAPSHOT_BYTES {
        return Err("Snapshot exceeds the 16 MiB proof limit".into());
    }
    let snapshot: Value =
        serde_json::from_str(source).map_err(|error| format!("Invalid snapshot JSON: {error}"))?;
    if snapshot["schema"] == "art-equation.display-list" {
        validate_numbers(&snapshot)?;
        return Ok(snapshot);
    }
    if snapshot["schema"] != "art-equation.scene" || snapshot["schemaVersion"] != 1 {
        return Err("Expected art-equation.scene schemaVersion 1".into());
    }
    let objects = snapshot["objects"]
        .as_array()
        .ok_or("Snapshot objects must be an array")?;
    if objects.len() > MAX_OBJECTS {
        return Err("Snapshot exceeds the 50000-object proof limit".into());
    }
    if snapshot["connections"]
        .as_array()
        .is_some_and(|connections| !connections.is_empty())
    {
        return Err(
            "SCENE_UNSUPPORTED: connection encoding requires a later matched CPU/GPU slice".into(),
        );
    }
    for object in objects {
        if object["visible"] != false && object["hidden"] != true && object["kind"] != "vector" {
            return Err(format!(
                "SCENE_UNSUPPORTED: visible {} object {} requires a later full-scene engine slice",
                object["kind"].as_str().unwrap_or("unknown"),
                object["id"].as_str().unwrap_or("unknown")
            ));
        }
        if object["blendMode"]
            .as_str()
            .is_some_and(|mode| mode != "normal")
        {
            return Err("SCENE_UNSUPPORTED: blendMode must be normal in this proof".into());
        }
        if object["visible"] != false && object["hidden"] != true {
            validate_flat_vector_metadata(object)?;
        }
    }
    validate_numbers(&snapshot)?;
    Ok(snapshot)
}

#[cfg(target_arch = "wasm32")]
mod surface {
    use super::*;
    use sha2::{Digest, Sha256};
    use std::sync::{Arc, Mutex};
    use wasm_bindgen::{JsCast, prelude::*};
    use web_sys::HtmlCanvasElement;

    #[wasm_bindgen]
    extern "C" {
        #[wasm_bindgen(js_namespace = performance, js_name = now)]
        fn probe_now() -> f64;
    }

    fn js_error(message: impl AsRef<str>) -> JsValue {
        JsValue::from_str(message.as_ref())
    }

    struct SurfaceState {
        instance: wgpu::Instance,
        surface: wgpu::Surface<'static>,
        canvas: HtmlCanvasElement,
        device: wgpu::Device,
        queue: wgpu::Queue,
        renderer: vello::Renderer,
        images: image_resources::ImageRegistry,
        image_atlases: Vec<image_atlas::GpuImageAtlas>,
        target: wgpu::Texture,
        target_view: wgpu::TextureView,
        pan_scratch: Option<(wgpu::Texture, wgpu::TextureView)>,
        pan_cache: Option<PanCache>,
        scene_cache: Option<SceneCache>,
        wait_for_completion:bool,
        #[cfg(feature="browser-hybrid")]
        hybrid:Option<crate::native_hybrid::RetainedHybrid>,
        hybrid_static:bool,
        hybrid_revision:u64,
        target_width: u32,
        target_height: u32,
        blitter: wgpu::util::TextureBlitter,
        config: wgpu::SurfaceConfiguration,
        device_lost: Arc<Mutex<Option<String>>>,
        gpu_error: Arc<Mutex<Option<String>>>,
        frame: u64,
        prepared_count: u64,
        prepared: PreparedGate<PreparedFrame>,
        configurations: u64,
        target_allocations: u64,
        reconfigure_next_frame: bool,
    }

    struct PanCache {
        identity: [u8; 32],
        width: u32,
        height: u32,
        scale: f64,
        pan_x: f64,
        pan_y: f64,
        margin_x: u32,
        margin_y: u32,
        allocation: vello::low_level::BumpAllocators,
    }

    #[derive(Clone)]
    struct SceneCache {
        identity: [u8; 32],
        source_scene: Arc<vello::Scene>,
        prepared_scene: Arc<prepared_scene::PreparedScene>,
        atlas_pages: usize,
        atlas_page_resource_counts: Vec<usize>,
    }

    impl SurfaceState {
        fn check_health(&self) -> Result<(), JsValue> {
            if let Some(message) = self.device_lost.lock().unwrap().as_ref() {
                return Err(js_error(format!(
                    "DEVICE_LOST: {message}; initialize the renderer again"
                )));
            }
            if let Some(message) = self.gpu_error.lock().unwrap().take() {
                return Err(js_error(message));
            }
            Ok(())
        }

        fn configure(&mut self) {
            self.surface.configure(&self.device, &self.config);
            self.configurations += 1;
            self.reconfigure_next_frame = false;
        }

        fn resize_target(&mut self, width: u32, height: u32) -> bool {
            if self.target_width == width && self.target_height == height {
                return false;
            }
            self.target.destroy();
            if let Some((texture, _)) = self.pan_scratch.take() { texture.destroy(); }
            self.pan_cache = None;
            let (target, target_view) = create_target(&self.device, width, height);
            self.target = target;
            self.target_view = target_view;
            self.target_width = width;
            self.target_height = height;
            self.target_allocations += 1;
            true
        }

        fn acquire(&mut self) -> Result<wgpu::SurfaceTexture, JsValue> {
            if self.reconfigure_next_frame {
                self.configure();
            }
            for _ in 0..2 {
                match self.surface.get_current_texture() {
                    wgpu::CurrentSurfaceTexture::Success(texture) => return Ok(texture),
                    wgpu::CurrentSurfaceTexture::Suboptimal(texture) => {
                        // Reconfiguration must happen after this texture is presented/dropped.
                        self.reconfigure_next_frame = true;
                        return Ok(texture);
                    }
                    wgpu::CurrentSurfaceTexture::Outdated => self.configure(),
                    wgpu::CurrentSurfaceTexture::Lost => {
                        self.check_health()?;
                        self.surface = self
                            .instance
                            .create_surface(wgpu::SurfaceTarget::Canvas(self.canvas.clone()))
                            .map_err(|error| {
                                js_error(format!("Surface recreation failed: {error}"))
                            })?;
                        self.configure();
                    }
                    wgpu::CurrentSurfaceTexture::Timeout => {
                        return Err(js_error("SURFACE_TIMEOUT: retry on a later frame"));
                    }
                    wgpu::CurrentSurfaceTexture::Occluded => {
                        return Err(js_error("SURFACE_OCCLUDED: retry when visible"));
                    }
                    wgpu::CurrentSurfaceTexture::Validation => {
                        return Err(js_error(
                            "SURFACE_VALIDATION: GPU surface acquisition failed",
                        ));
                    }
                }
            }
            Err(js_error(
                "SURFACE_RECOVERY_FAILED: initialize the renderer again",
            ))
        }
    }

    struct PreparedFrame {
        input: FrameInput,
        revision: Value,
        report: EncodingReport,
        images: usize,
        atlas_pages: usize,
        atlas_page_resource_counts: Vec<usize>,
        dimensions_clamped: bool,
        target_resized: bool,
        prepared_count: u64,
        queue_completed: bool,
        allocation: vello::low_level::BumpAllocators,
        allocation_status: &'static str,
        hybrid_receipt:Option<Value>,
        hybrid_declined:Option<String>,
    }

    fn frame_metadata(
        state: &SurfaceState,
        frame: &PreparedFrame,
        committed: bool,
        resized: bool,
    ) -> Value {
        let mut metadata = serde_json::json!({
            "frame": state.frame, "preparedFrame": frame.prepared_count,
            "revision": frame.revision,
            "width": frame.input.width, "height": frame.input.height,
            "visibleWidth": state.config.width, "visibleHeight": state.config.height,
            "dimensionsClamped": frame.dimensions_clamped,
            "targetResized": frame.target_resized, "resized": resized,
            "surfaceConfigurations": state.configurations,
            "targetAllocations": state.target_allocations,
            "objects": frame.report.objects, "vectors": frame.report.vectors,
            "images":frame.images,"imageResources":state.images.stats(),
            "imageAtlasBytes":state.image_atlases.len()*image_atlas::ATLAS_BYTES,
            "imageAtlasUploads":state.image_atlases.iter().map(|a|a.uploads).sum::<u64>(),
            "imageAtlasUploadBytes":state.image_atlases.iter().map(|a|a.upload_bytes).sum::<u64>(),
            "imageAtlasDeltaUploads":state.image_atlases.iter().map(|a|a.delta_uploads).sum::<u64>(),
            "imageAtlasFullUploads":state.image_atlases.iter().map(|a|a.full_uploads).sum::<u64>(),
            "imageAtlasPages":frame.atlas_pages,
            "imageAtlasAllocatedPages":state.image_atlases.len(),
            "imageAtlasPageResourceCounts":frame.atlas_page_resource_counts,
            "imageAtlasPageUploads":state.image_atlases.iter().map(|a|a.uploads).collect::<Vec<_>>(),
            "imageAtlasPageBytes":state.image_atlases.iter().map(|_|image_atlas::ATLAS_BYTES).collect::<Vec<_>>(),
            "connections": frame.report.connections, "encodedConnections": frame.report.encoded_connections,
            "textPending": frame.report.text, "rasterPending": frame.report.raster,
            "structuralObjects": frame.report.structural,
            "requiresMixedCompositor": frame.report.requires_mixed_compositor,
            "cpuPixelReadbacks": 0,
            "prepared": !committed, "committed": committed,
            "prepareQueueCompleted": frame.queue_completed,
            "queueOrdering":"single-device-ordered-render-then-blit",
            "completionPolicy":if frame.queue_completed{"checked-completed"}else{"checked-ordered"},
            "presentationSubmitted": committed,
        });
        metadata["gpuAllocationStatus"] = serde_json::json!(frame.allocation_status);
        metadata["gpuAllocationFailureFlags"] = serde_json::json!(frame.allocation.failed);
        metadata["gpuAllocationStatusBytes"] = serde_json::json!(32);
        metadata["gpuAllocationCounts"] = serde_json::json!({
            "failed": frame.allocation.failed, "binning": frame.allocation.binning,
            "ptcl": frame.allocation.ptcl, "tile": frame.allocation.tile,
            "segCounts": frame.allocation.seg_counts, "segments": frame.allocation.segments,
            "blend": frame.allocation.blend, "lines": frame.allocation.lines,
        });
        metadata["renderEngine"]=serde_json::json!("classic-0.10");
        if let Some(reason)=&frame.hybrid_declined{metadata["hybridDeclined"]=serde_json::json!(reason);}
        if let Some(receipt)=&frame.hybrid_receipt{
            // Hybrid has no Classic bump allocator. Never relabel Classic
            // counters as proof about a different renderer's output.
            for key in ["gpuAllocationCounts","gpuAllocationFailureFlags","gpuAllocationStatusBytes"] {metadata.as_object_mut().unwrap().remove(key);}
            metadata["gpuAllocationStatus"]=serde_json::json!("not-applicable-hybrid");
            metadata["renderEngine"]=serde_json::json!("hybrid-0.2");
            metadata["hybridValidationStatus"]=serde_json::json!("checked");
            metadata["hybridReceipt"]=receipt.clone();
        }
        metadata
    }

    impl Drop for SurfaceState {
        fn drop(&mut self) {
            self.target.destroy();
            if let Some((texture, _)) = self.pan_scratch.take() { texture.destroy(); }
            self.device.destroy();
            // wgpu's browser Surface::drop is a no-op. Explicitly release its canvas
            // configuration, so a fresh device may initialize this same canvas.
            if let Ok(Some(context)) = self.canvas.get_context("webgpu") {
                if let Ok(method) =
                    js_sys::Reflect::get(&context, &JsValue::from_str("unconfigure"))
                {
                    if let Some(method) = method.dyn_ref::<js_sys::Function>() {
                        let _ = method.call0(&context);
                    }
                }
            }
        }
    }

    fn create_target(
        device: &wgpu::Device,
        width: u32,
        height: u32,
    ) -> (wgpu::Texture, wgpu::TextureView) {
        let target = device.create_texture(&wgpu::TextureDescriptor {
            label: Some("p0-retained-vello-rgba8"),
            size: wgpu::Extent3d {
                width,
                height,
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::Rgba8Unorm,
            usage: wgpu::TextureUsages::STORAGE_BINDING | wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::RENDER_ATTACHMENT
                | wgpu::TextureUsages::COPY_SRC | wgpu::TextureUsages::COPY_DST,
            view_formats: &[],
        });
        let view = target.create_view(&wgpu::TextureViewDescriptor::default());
        (target, view)
    }

    #[wasm_bindgen]
    pub struct B4SurfaceRenderer {
        state: Option<SurfaceState>,
        retained: Option<crate::retained_protocol::RetainedScene>,
        rendered_revision: u32,
    }

    #[wasm_bindgen]
    impl B4SurfaceRenderer {
        #[wasm_bindgen(constructor)]
        pub fn new() -> Self {
            Self { state: None,retained:None,rendered_revision:0 }
        }

        /// Warm the optional second rasterizer on this existing browser device.
        /// It never creates another canvas, surface, queue or image atlas.
        pub async fn enable_hybrid(&mut self)->Result<String,JsValue>{
            let state=self.state.as_mut().ok_or_else(||js_error("RENDERER_NOT_INITIALIZED"))?;
            #[cfg(feature="browser-hybrid")]
            {
                if state.hybrid.is_none(){
                    let validation=state.device.push_error_scope(wgpu::ErrorFilter::Validation);
                    let memory=state.device.push_error_scope(wgpu::ErrorFilter::OutOfMemory);
                    let hybrid=crate::native_hybrid::RetainedHybrid::new(&state.device,state.target_width,state.target_height);
                    let memory_error=memory.pop().await;let validation_error=validation.pop().await;
                    if let Some(error)=memory_error.or(validation_error){return Err(js_error(format!("HYBRID_INITIALIZATION_FAILED: {error}")))}
                    state.check_health()?;state.hybrid=Some(hybrid);
                }
                Ok(serde_json::json!({"hybrid":"0.2","sharedDevice":true,"sharedQueue":true,"sharedOutput":true,"sharedImages":true,"gpuWorkingMemory":"not-measured"}).to_string())
            }
            #[cfg(not(feature="browser-hybrid"))]
            {let _=state;Err(js_error("HYBRID_FEATURE_NOT_BUILT"))}
        }

        pub fn set_render_policy(&mut self,policy:String)->Result<(),JsValue>{
            let state=self.state.as_mut().ok_or_else(||js_error("RENDERER_NOT_INITIALIZED"))?;
            match policy.as_str(){
                "classic"=>state.hybrid_static=false,
                "dual-static"=>{
                    #[cfg(feature="browser-hybrid")]
                    {if state.hybrid.is_none(){return Err(js_error("HYBRID_NOT_INITIALIZED"))}state.hybrid_static=true;}
                    #[cfg(not(feature="browser-hybrid"))]
                    {return Err(js_error("HYBRID_FEATURE_NOT_BUILT"))}
                },
                _=>return Err(js_error("INVALID_RENDER_POLICY")),
            }Ok(())
        }

        /// Initialize the main-thread canvas; no document/project state is opened.
        pub async fn initialize(&mut self, canvas: HtmlCanvasElement) -> Result<String, JsValue> {
            self.dispose();
            let input = validate_frame(
                canvas.width(),
                canvas.height(),
                PROOF_MAX_DIMENSION,
                1.0,
                0.0,
                0.0,
            )
            .map_err(js_error)?;
            let mut descriptor = wgpu::InstanceDescriptor::new_without_display_handle();
            descriptor.backends = wgpu::Backends::BROWSER_WEBGPU;
            let instance = wgpu::Instance::new(descriptor);
            let surface = instance
                .create_surface(wgpu::SurfaceTarget::Canvas(canvas.clone()))
                .map_err(|error| js_error(format!("WebGPU surface failed: {error}")))?;
            let adapter = instance
                .request_adapter(&wgpu::RequestAdapterOptions {
                    power_preference: wgpu::PowerPreference::HighPerformance,
                    force_fallback_adapter: false,
                    compatible_surface: Some(&surface),
                })
                .await
                .map_err(|error| js_error(format!("WEBGPU_UNAVAILABLE: {error}")))?;
            let info = adapter.get_info();
            let (device, queue) = adapter
                .request_device(&wgpu::DeviceDescriptor::default())
                .await
                .map_err(|error| js_error(format!("WebGPU device failed: {error}")))?;
            let device_lost = Arc::new(Mutex::new(None));
            let lost_signal = device_lost.clone();
            device.set_device_lost_callback(move |reason, message| {
                *lost_signal.lock().unwrap() = Some(format!("{reason:?}: {message}"));
            });
            let gpu_error = Arc::new(Mutex::new(None));
            let error_signal = gpu_error.clone();
            device.on_uncaptured_error(Arc::new(move |error| {
                let kind = match &error {
                    wgpu::Error::OutOfMemory { .. } => "GPU_OUT_OF_MEMORY",
                    wgpu::Error::Validation { .. } => "GPU_VALIDATION",
                    wgpu::Error::Internal { .. } => "GPU_INTERNAL",
                };
                *error_signal.lock().unwrap() = Some(format!("{kind}: {error}"));
            }));
            let capabilities = surface.get_capabilities(&adapter);
            let format = capabilities
                .formats
                .into_iter()
                .find(|format| {
                    matches!(
                        format,
                        wgpu::TextureFormat::Rgba8Unorm | wgpu::TextureFormat::Bgra8Unorm
                    )
                })
                .ok_or_else(|| js_error("No non-sRGB RGBA8/BGRA8 WebGPU surface format"))?;
            let input = validate_frame(
                input.width,
                input.height,
                device.limits().max_texture_dimension_2d,
                1.0,
                0.0,
                0.0,
            )
            .map_err(js_error)?;
            let config = wgpu::SurfaceConfiguration {
                usage: wgpu::TextureUsages::RENDER_ATTACHMENT,
                format,
                width: input.width,
                height: input.height,
                present_mode: wgpu::PresentMode::Fifo,
                desired_maximum_frame_latency: 2,
                // Cached wgpu 29 web backend supports this mode even though its
                // get_capabilities currently advertises only Opaque.
                alpha_mode: wgpu::CompositeAlphaMode::PreMultiplied,
                view_formats: vec![],
            };
            let renderer = vello::Renderer::new(
                &device,
                vello::RendererOptions {
                    use_cpu: false,
                    antialiasing_support: vello::AaSupport::area_only(),
                    num_init_threads: None,
                    pipeline_cache: None,
                },
            )
            .map_err(|error| js_error(format!("Vello pipeline setup failed: {error}")))?;
            let (target, target_view) = create_target(&device, input.width, input.height);
            // Vello 0.10 fine.wgsl writes straight RGBA (rgba_sep). Alpha blending
            // it exactly once onto a cleared surface produces the premultiplied
            // RGBA required by the configured WebGPU canvas compositor.
            let blitter = wgpu::util::TextureBlitterBuilder::new(&device, format)
                .blend_state(wgpu::BlendState::ALPHA_BLENDING)
                .build();
            let mut state = SurfaceState {
                instance,
                surface,
                canvas,
                device,
                queue,
                renderer,
                images:image_resources::ImageRegistry::default(),
                image_atlases:Vec::new(),
                pan_scratch:None,
                pan_cache:None,
                scene_cache:None,wait_for_completion:false,
                #[cfg(feature="browser-hybrid")]
                hybrid:None,
                hybrid_static:false,
                hybrid_revision:0,
                target,
                target_view,
                blitter,
                target_width: input.width,
                target_height: input.height,
                config,
                device_lost,
                gpu_error,
                frame: 0,
                prepared_count: 0,
                prepared: PreparedGate::default(),
                configurations: 0,
                target_allocations: 1,
                reconfigure_next_frame: false,
            };
            state.configure();
            state.check_health()?;
            let maximum_dimension = state
                .device
                .limits()
                .max_texture_dimension_2d
                .min(PROOF_MAX_DIMENSION);
            self.state = Some(state);
            Ok(serde_json::json!({
                "backend": format!("{:?}", info.backend),
                "deviceType": format!("{:?}", info.device_type),
                "name": info.name, "driver": info.driver,
                "presentation": "main-thread-prepare-then-synchronous-surface-commit",
                "surfaceFormat": format!("{format:?}"),
                "alphaMode": "premultiplied",
                "velloIntermediateAlpha": "straight",
                "width": input.width, "height": input.height,
                "maxDimension": maximum_dimension,
                "cpuPixelReadbacks": 0,
            })
            .to_string())
        }


        pub fn load_retained_scene(&mut self,snapshot_json:String,expected_revision:u32)->Result<u32,JsValue>{
            let revision=self.retained.as_ref().map(|v|v.revision).unwrap_or(0);
            if revision!=expected_revision{return Err(js_error("RETAINED_REVISION_MISMATCH"))}
            let next=crate::retained_protocol::RetainedScene::load(&snapshot_json,revision).map_err(js_error)?;
            let revision=next.revision;self.retained=Some(next);self.rendered_revision=0;Ok(revision)
        }
        pub fn patch_retained_scene(&mut self,patch_json:String,expected_revision:u32)->Result<u32,JsValue>{
            let current=self.retained.as_ref().ok_or_else(||js_error("RETAINED_SCENE_REQUIRED"))?;
            let next=current.patch(&patch_json,expected_revision).map_err(js_error)?;
            let revision=next.revision;self.retained=Some(next);self.rendered_revision=0;Ok(revision)
        }
        pub async fn prepare_retained_frame(&mut self,width:u32,height:u32,revision:u32,scale:f64,pan_x:f64,pan_y:f64)->Result<String,JsValue>{
            let current=self.retained.as_ref().ok_or_else(||js_error("RETAINED_SCENE_REQUIRED"))?;
            if current.revision!=revision{return Err(js_error("RETAINED_REVISION_MISMATCH"))}
            if self.rendered_revision!=revision || self.state.as_ref().is_none_or(|s|s.scene_cache.is_none()){
                let json=current.json.clone();
                let result=self.prepare_snapshot(width,height,json,scale,pan_x,pan_y).await?;
                self.rendered_revision=revision;return Ok(result)
            }
            let trace_start=probe_now();
            let state=self.state.as_mut().ok_or_else(||js_error("RENDERER_NOT_INITIALIZED"))?;
            state.prepared.discard();state.check_health()?;
            let input=validate_frame(width,height,state.device.limits().max_texture_dimension_2d,scale,pan_x,pan_y).map_err(js_error)?;
            let trace_validated=probe_now();
            let cache=state.scene_cache.as_ref().cloned().ok_or_else(||js_error("RETAINED_CACHE_REQUIRED"))?;
                    let camera = vello::kurbo::Affine::translate((input.pan_x, input.pan_y))
                        * vello::kurbo::Affine::scale(input.scale);
                    prepared_scene::validate_camera(&cache.prepared_scene, camera).map_err(js_error)?;
                    state.images.stage(&cache.prepared_scene.resources).map_err(js_error)?;
                    let mut scene = vello::Scene::new();
                    scene.append(&cache.source_scene, Some(camera));
                    let trace_appended=probe_now();
                    let target_resized = state.resize_target(input.width, input.height);
                    let allocation = state.renderer.render_to_texture_checked(
                        &state.device, &state.queue, &scene, &state.target_view,
                        &vello::RenderParams {
                            base_color: cache.prepared_scene.background,
                            width: input.width, height: input.height,
                            antialiasing_method: vello::AaConfig::Area,
                        },
                    ).await.map_err(|error| {
                        state.images.discard();
                        js_error(format!("Vello reused-scene render failed: {error}"))
                    })?;
                    let trace_render_call = probe_now();
                    if state.wait_for_completion {
                        let (sender, receiver) = futures_channel::oneshot::channel();
                        state.queue.on_submitted_work_done(move || { let _ = sender.send(()); });
                        receiver.await.map_err(|_| js_error("GPU_COMPLETION_CHANNEL_CLOSED"))?;
                    }
                    let trace_gpu_done = probe_now();
                    state.check_health()?;
                    state.prepared_count += 1;
                    let dimensions_clamped = input.width != width || input.height != height;
                    let prepared = PreparedFrame {
                        input, revision: serde_json::json!(revision.to_string()),
                        report: cache.prepared_scene.report,
                        images: cache.prepared_scene.images.len(),
                        atlas_pages: cache.atlas_pages,
                        atlas_page_resource_counts: cache.atlas_page_resource_counts,
                        dimensions_clamped,
                        target_resized, prepared_count: state.prepared_count,
                        queue_completed: state.wait_for_completion,
                        allocation, allocation_status: "checked",hybrid_receipt:None,hybrid_declined:None,
                    };
                    let mut metadata = frame_metadata(state, &prepared, false, false);
                    metadata["probeTimingsMs"] = serde_json::json!({
                        "validate": trace_validated - trace_start,
                        "parseScene": 0.0, "pack": 0.0, "atlas": 0.0,
                        "hash": 0.0, "transferBytes": 0,
                        "encode": trace_appended - trace_validated,
                        "renderCall": trace_render_call - trace_appended,
                        "gpuWait": trace_gpu_done - trace_render_call,
                        "total": trace_gpu_done - trace_start
                    });
                    metadata["paintMode"] = serde_json::json!("retained-camera");
                    state.prepared.stage(prepared);
                    return Ok(metadata.to_string());
        }

        pub fn set_completion_policy(&mut self,policy:String)->Result<(),JsValue>{
            let state=self.state.as_mut().ok_or_else(||js_error("RENDERER_NOT_INITIALIZED"))?;
            state.wait_for_completion=match policy.as_str(){"checked-ordered"=>false,"checked-completed"=>true,_=>return Err(js_error("INVALID_COMPLETION_POLICY"))};Ok(())
        }
        /// Representative checked work on the actual viewport device; never presents test pixels.
        pub async fn warm_classic(&mut self)->Result<String,JsValue>{
            let start=probe_now();
            let image=serde_json::json!({"key":"__classic-warm-image__","revision":1,"epoch":4294967295u32,"width":2,"height":2});
            self.register_image(image.to_string(),vec![255u8;16])?;
            let vector=serde_json::json!({"type":"vector","object":{"id":"warm-path","kind":"vector","transform":[1,0,0,1,0,0],"opacity":0.75,"payload":{"commands":[["M",2,2],["L",30,2],["C",48,2,48,40,30,40],["L",2,40],["Z"]],"fill":"#167b8aff","stroke":"#f1c878ff","strokeWidth":2,"vectorFillRule":"nonzero","vectorStrokeJoin":"round","vectorStrokeCap":"round"}}});
            let snapshot=serde_json::json!({"schema":"art-equation.display-list","schemaVersion":2,"sceneId":"__classic-warm__","revision":"1","environment":{"background":"#00000000","colorSpace":"srgb"},"resources":[image.clone()],"operations":[vector,{"type":"image","id":"warm-image","resource":image,"sourceRect":{"x":0,"y":0,"width":2,"height":2},"transform":[8,0,0,8,44,4],"opacity":0.8,"sampling":"bilinear"}]});
            let prepared=self.prepare_snapshot(64,64,snapshot.to_string(),1.0,0.0,0.0).await?;
            let state=self.state.as_mut().ok_or_else(||js_error("RENDERER_NOT_INITIALIZED"))?;
            let format=state.config.format;
            let texture=state.device.create_texture(&wgpu::TextureDescriptor{label:Some("launch-only-blit-warmup"),size:wgpu::Extent3d{width:64,height:64,depth_or_array_layers:1},mip_level_count:1,sample_count:1,dimension:wgpu::TextureDimension::D2,format,usage:wgpu::TextureUsages::RENDER_ATTACHMENT,view_formats:&[]});
            let view=texture.create_view(&wgpu::TextureViewDescriptor::default());
            let mut encoder=state.device.create_command_encoder(&wgpu::CommandEncoderDescriptor{label:Some("launch-blit-warmup")});
            state.blitter.copy(&state.device,&mut encoder,&state.target_view,&view);state.queue.submit([encoder.finish()]);
            let(sender,receiver)=futures_channel::oneshot::channel();state.queue.on_submitted_work_done(move||{let _=sender.send(());});receiver.await.map_err(|_|js_error("GPU_COMPLETION_CHANNEL_CLOSED"))?;
            state.check_health()?;state.prepared.discard();state.scene_cache=None;
            self.retain_images("[]".into())?;
            Ok(serde_json::json!({"status":"ready","renderer":"classic-0.10","sameViewportDevice":true,"presentationCount":0,"ms":probe_now()-start,"paths":["fill","stroke","curves","transparency","image-sampling","surface-blit"],"scope":"Representative pipeline warm-up, not all fonts/assets or persistent DX12 pipeline cache","checkedFrame":serde_json::from_str::<Value>(&prepared).map_err(|e|js_error(e.to_string()))?}).to_string())
        }

        /// Render into the retained target only. No visible canvas resize,
        /// surface configuration/acquisition or presentation happens here.
        /// The caller checks its generation before synchronously committing.
        pub async fn prepare_snapshot(
            &mut self,
            width: u32,
            height: u32,
            snapshot_json: String,
            scale: f64,
            pan_x: f64,
            pan_y: f64,
) -> Result<String, JsValue> {
            self.rendered_revision=0;
            let cache_hint = false;
            let warm_cache = false;
            let cache_snapshot_json = String::new();
            let trace_start = probe_now();
            let state = self
                .state
                .as_mut()
                .ok_or_else(|| js_error("RENDERER_NOT_INITIALIZED"))?;
            state.prepared.discard();
            state.check_health()?;
            let input = validate_frame(
                width,
                height,
                state.device.limits().max_texture_dimension_2d,
                scale,
                pan_x,
                pan_y,
            )
            .map_err(js_error)?;
            let trace_validated = probe_now();
            // The isolated viewer serializes its root revision before the
            // environment and operations. Hash the original bytes with only
            // that generation value skipped; a different scene still misses.
            let identity_source = if cache_hint || warm_cache {
                if cache_snapshot_json.is_empty() { return Err(js_error("CACHE_SCENE_REQUIRED")); }
                cache_snapshot_json.as_str()
            } else { snapshot_json.as_str() };
            let mut scene_hash = Sha256::new();
            let revision_prefix = "\"revision\":\"";
            if let Some(start) = identity_source.find(revision_prefix) {
                let value_start = start + revision_prefix.len();
                if let Some(value_end) = identity_source[value_start..].find('"') {
                    scene_hash.update(&identity_source.as_bytes()[..value_start]);
                    scene_hash.update(&identity_source.as_bytes()[value_start + value_end..]);
                } else {
                    scene_hash.update(identity_source.as_bytes());
                }
            } else {
                scene_hash.update(identity_source.as_bytes());
            }
            let identity: [u8; 32] = scene_hash.finalize().into();
            let cached_revision = snapshot_json.find(revision_prefix).and_then(|start| {
                let value_start = start + revision_prefix.len();
                let value_end = snapshot_json[value_start..].find('"')? + value_start;
                let raw = &snapshot_json[value_start..value_end];
                raw.chars().all(|ch| ch.is_ascii_digit()).then(|| raw.to_owned())
            });
            if !cache_hint && !warm_cache {
                if let (Some(cache), Some(revision)) = (
                    state.scene_cache.as_ref().filter(|cache| cache.identity == identity).cloned(),
                    cached_revision,
                ) {
                    let camera = vello::kurbo::Affine::translate((input.pan_x, input.pan_y))
                        * vello::kurbo::Affine::scale(input.scale);
                    prepared_scene::validate_camera(&cache.prepared_scene, camera).map_err(js_error)?;
                    state.images.stage(&cache.prepared_scene.resources).map_err(js_error)?;
                    let mut scene = vello::Scene::new();
                    scene.append(&cache.source_scene, Some(camera));
                    let target_resized = state.resize_target(input.width, input.height);
                    let allocation = state.renderer.render_to_texture_checked(
                        &state.device, &state.queue, &scene, &state.target_view,
                        &vello::RenderParams {
                            base_color: cache.prepared_scene.background,
                            width: input.width, height: input.height,
                            antialiasing_method: vello::AaConfig::Area,
                        },
                    ).await.map_err(|error| {
                        state.images.discard();
                        js_error(format!("Vello reused-scene render failed: {error}"))
                    })?;
                    let trace_render_call = probe_now();
                    if state.wait_for_completion {
                        let (sender, receiver) = futures_channel::oneshot::channel();
                        state.queue.on_submitted_work_done(move || { let _ = sender.send(()); });
                        receiver.await.map_err(|_| js_error("GPU_COMPLETION_CHANNEL_CLOSED"))?;
                    }
                    let trace_gpu_done = probe_now();
                    state.check_health()?;
                    state.prepared_count += 1;
                    let dimensions_clamped = input.width != width || input.height != height;
                    let prepared = PreparedFrame {
                        input, revision: serde_json::json!(revision),
                        report: cache.prepared_scene.report,
                        images: cache.prepared_scene.images.len(),
                        atlas_pages: cache.atlas_pages,
                        atlas_page_resource_counts: cache.atlas_page_resource_counts,
                        dimensions_clamped,
                        target_resized, prepared_count: state.prepared_count,
                        queue_completed: state.wait_for_completion,
                        allocation, allocation_status: "checked",hybrid_receipt:None,hybrid_declined:None,
                    };
                    let mut metadata = frame_metadata(state, &prepared, false, false);
                    metadata["probeTimingsMs"] = serde_json::json!({
                        "validate": trace_validated - trace_start,
                        "parseScene": 0.0, "pack": 0.0, "atlas": 0.0,
                        "encode": trace_render_call - trace_validated,
                        "renderCall": 0.0,
                        "gpuWait": trace_gpu_done - trace_render_call,
                        "total": trace_gpu_done - trace_start
                    });
                    metadata["paintMode"] = serde_json::json!("scene-reuse");
                    state.prepared.stage(prepared);
                    return Ok(metadata.to_string());
                }
            }
            let snapshot = parse_snapshot(&snapshot_json).map_err(js_error)?;
            let prepared_scene = prepared_scene::prepare_snapshot(&snapshot).map_err(js_error)?;
            let camera = vello::kurbo::Affine::translate((input.pan_x, input.pan_y))
                * vello::kurbo::Affine::scale(input.scale);
            prepared_scene::validate_camera(&prepared_scene, camera).map_err(js_error)?;
            let trace_scene_ready = probe_now();
            // Resolve all references and place the entire image batch before
            // rendering. Vello never receives independently packed image IDs.
            let decoded=prepared_scene.resources.iter().map(|r|state.images.resolve(r)).collect::<Result<Vec<_>,_>>().map_err(js_error)?;
            // Preflight the whole bounded set before touching any active GPU
            // page. The previous complete surface frame remains visible until
            // present_prepared commits the fully rendered replacement.
            let plans=image_atlas::pack_native_pages(decoded).map_err(js_error)?;
            let trace_packed = probe_now();
            state.images.stage(&prepared_scene.resources).map_err(js_error)?;
            while state.image_atlases.len()<plans.len() {
                let index=state.image_atlases.len();
                state.image_atlases.push(image_atlas::GpuImageAtlas::new_native_page(
                    &state.device,&mut state.renderer,index).map_err(js_error)?);
            }
            for (atlas,plan) in state.image_atlases.iter_mut().zip(&plans) {
                atlas.update(plan,&state.queue,&mut state.renderer);
            }
            let trace_atlas_ready = probe_now();
            let target_resized = state.resize_target(input.width, input.height);
            let pages=state.image_atlases.iter().zip(&plans)
                .map(|(atlas,plan)|(&atlas.image,plan)).collect::<Vec<_>>();
            let source_scene = gpu_scene::encode_prepared_with_image_pages(&prepared_scene,&pages).map_err(js_error)?;
            let report = prepared_scene.report;
            let mut scene = vello::Scene::new();
            scene.append(&source_scene, Some(camera));
            let background = prepared_scene.background;
            let trace_encoded = probe_now();
            let device_edge = state.device.limits().max_texture_dimension_2d;
            let margin_x = (device_edge.saturating_sub(input.width) / 2).min(320);
            let margin_y = (device_edge.saturating_sub(input.height) / 2).min(320);
            let prior_cache_match = state.pan_cache.as_ref().map(|prior| prior.identity == identity);
            let prior_cache_pan = state.pan_cache.as_ref().map(|prior| (prior.pan_x, prior.pan_y));
            let source = state.pan_cache.as_ref().and_then(|prior| {
                if !(cache_hint || warm_cache) || state.pan_scratch.is_none() || target_resized || prior.identity != identity
                    || prior.width != input.width || prior.height != input.height
                    || prior.scale != input.scale || prior.margin_x != margin_x
                    || prior.margin_y != margin_y { return None; }
                let x = f64::from(prior.margin_x) + prior.pan_x - input.pan_x;
                let y = f64::from(prior.margin_y) + prior.pan_y - input.pan_y;
                if (x - x.round()).abs() > 1e-7 || (y - y.round()).abs() > 1e-7
                    || x < 0.0 || y < 0.0
                    || x + f64::from(input.width) > f64::from(input.width + 2 * margin_x)
                    || y + f64::from(input.height) > f64::from(input.height + 2 * margin_y) {
                    return None;
                }
                Some((x.round() as u32, y.round() as u32))
            });
            let mut paint_mode;
            let allocation;
            let allocation_status;
            let mut hybrid_receipt=None;
            let mut hybrid_declined=None;
            if (cache_hint || warm_cache) && margin_x > 0 && margin_y > 0 {
                let (source_x, source_y) = if let Some(source) = source {
                    paint_mode = "retained-pan-copy";
                    allocation = state.pan_cache.as_ref().expect("matching checked pan cache").allocation;
                    allocation_status = "retained-checked";
                    source
                } else {
                    paint_mode = "overscan-render";
                    if let Some((old, _)) = state.pan_scratch.take() { old.destroy(); }
                    state.pan_cache = None;
                    let overscan_width = input.width + 2 * margin_x;
                    let overscan_height = input.height + 2 * margin_y;
                    let (texture, view) = create_target(&state.device, overscan_width, overscan_height);
                    let overscan_camera = vello::kurbo::Affine::translate((
                        input.pan_x + f64::from(margin_x), input.pan_y + f64::from(margin_y),
                    )) * vello::kurbo::Affine::scale(input.scale);
                    let cache_snapshot = parse_snapshot(&cache_snapshot_json).map_err(js_error)?;
                    if cache_snapshot["resources"] != snapshot["resources"]
                        || cache_snapshot["environment"] != snapshot["environment"] {
                        return Err(js_error("CACHE_SCENE_RESOURCE_OR_ENVIRONMENT_MISMATCH"));
                    }
                    let cache_prepared = prepared_scene::prepare_snapshot(&cache_snapshot).map_err(js_error)?;
                    prepared_scene::validate_camera(&cache_prepared, overscan_camera).map_err(js_error)?;
                    let cache_source_scene = gpu_scene::encode_prepared_with_image_pages(&cache_prepared,&pages).map_err(js_error)?;
                    let mut overscan_scene = vello::Scene::new();
                    overscan_scene.append(&cache_source_scene, Some(overscan_camera));
                    allocation = state.renderer.render_to_texture_checked(
                        &state.device, &state.queue, &overscan_scene, &view,
                        &vello::RenderParams {
                            base_color: background, width: overscan_width, height: overscan_height,
                            antialiasing_method: vello::AaConfig::Area,
                        },
                    ).await.map_err(|error| {
                        state.images.discard();
                        js_error(format!("Vello overscan render failed: {error}"))
                    })?;
                    allocation_status = "checked";
                    state.pan_scratch = Some((texture, view));
                    state.pan_cache = Some(PanCache { identity, width: input.width, height: input.height,
                        scale: input.scale, pan_x: input.pan_x, pan_y: input.pan_y,
                        margin_x, margin_y, allocation });
                    (margin_x, margin_y)
                };
                {
                    if warm_cache { paint_mode = "overscan-warm-copy"; }
                    let overscan = &state.pan_scratch.as_ref().unwrap().0;
                    let mut copy = state.device.create_command_encoder(&wgpu::CommandEncoderDescriptor {
                        label: Some("retina-copy-visible-overscan-region"),
                    });
                    copy.copy_texture_to_texture(
                        wgpu::TexelCopyTextureInfo { texture: overscan, mip_level: 0,
                            origin: wgpu::Origin3d { x: source_x, y: source_y, z: 0 },
                            aspect: wgpu::TextureAspect::All },
                        wgpu::TexelCopyTextureInfo { texture: &state.target, mip_level: 0,
                            origin: wgpu::Origin3d::ZERO, aspect: wgpu::TextureAspect::All },
                        wgpu::Extent3d { width: input.width, height: input.height,
                            depth_or_array_layers: 1 },
                    );
                    state.queue.submit([copy.finish()]);
                }
            } else {
                paint_mode = "full";
                // An exact frame can race between cache warming and the first
                // pointer-move. Keep a matching overscan texture alive; the
                // next pan still checks scene identity, dimensions and scale.
                if target_resized || state.pan_cache.as_ref().is_some_and(|prior|
                    prior.width != input.width || prior.height != input.height
                    || prior.scale != input.scale) {
                    state.pan_cache = None;
                }
                #[cfg(feature="browser-hybrid")]
                if state.hybrid_static {
                    state.hybrid_revision=state.hybrid_revision.wrapping_add(1);
                    let validation=state.device.push_error_scope(wgpu::ErrorFilter::Validation);
                    let memory=state.device.push_error_scope(wgpu::ErrorFilter::OutOfMemory);
                    let hybrid=state.hybrid.as_mut().ok_or_else(||js_error("HYBRID_NOT_INITIALIZED"))?;
                    let result=hybrid.render(&state.device,&state.queue,&state.target_view,&prepared_scene,None,&state.image_atlases,state.hybrid_revision,input.width,input.height,camera);
                    let memory_error=memory.pop().await;
                    let validation_error=validation.pop().await;
                    if let Some(error)=memory_error.or(validation_error){state.images.discard();return Err(js_error(format!("HYBRID_GPU_ERROR: {error}")))}
                    match result {
                        Ok(receipt)=>{hybrid_receipt=Some(receipt);paint_mode="hybrid-static";},
                        Err(error) if error.starts_with("HYBRID_UNSUPPORTED")=>{hybrid_declined=Some(error)},
                        Err(error)=>{state.images.discard();return Err(js_error(error))},
                    }
                }
                if hybrid_receipt.is_some(){
                    allocation=Default::default();allocation_status="not-applicable-hybrid";
                }else{
                allocation = state.renderer.render_to_texture_checked(
                    &state.device, &state.queue, &scene, &state.target_view,
                    &vello::RenderParams {
                        base_color: background, width: input.width, height: input.height,
                        antialiasing_method: vello::AaConfig::Area,
                    },
                ).await.map_err(|error| {
                    state.images.discard();
                    js_error(format!("Vello render failed: {error}"))
                })?;
                allocation_status = "checked";
                }
            }
            let trace_render_call = probe_now();
            // Vello's render and the subsequent surface blit use the same
            // ordered GPU queue. The blit cannot read the target before the
            // render/copy finishes. Waiting for the entire queue to become idle
            // adds a large startup stall without improving frame ordering.
            // Keep the old wait available as an opt-out diagnostic build.
            if paint_mode != "retained-pan-copy" && (state.wait_for_completion||hybrid_receipt.is_some()) {
                let (sender, receiver) = futures_channel::oneshot::channel();
                state.queue.on_submitted_work_done(move || {
                    let _ = sender.send(());
                });
                receiver
                    .await
                    .map_err(|_| js_error("GPU_COMPLETION_CHANNEL_CLOSED"))?;
            }
            let trace_gpu_done = probe_now();
            state.check_health()?;
            state.prepared_count += 1;
            let dimensions_clamped = input.width != width || input.height != height;
            let prepared = PreparedFrame {
                input,
                revision: snapshot["revision"].clone(),
                report,
                images:prepared_scene.images.len(),
                atlas_pages:plans.len(),
                atlas_page_resource_counts:plans.iter().map(|plan|plan.images.len()).collect(),
                dimensions_clamped,
                target_resized,
                prepared_count: state.prepared_count,
                queue_completed: paint_mode != "retained-pan-copy" && (state.wait_for_completion||hybrid_receipt.is_some()),
                allocation, allocation_status,hybrid_receipt,hybrid_declined,
            };
            let mut metadata = frame_metadata(state, &prepared, false, false);
            metadata["probeTimingsMs"] = serde_json::json!({
                "validate": trace_validated - trace_start,
                "parseScene": trace_scene_ready - trace_validated,
                "pack": trace_packed - trace_scene_ready,
                "atlas": trace_atlas_ready - trace_packed,
                "encode": trace_encoded - trace_atlas_ready,
                "renderCall": trace_render_call - trace_encoded,
                "gpuWait": trace_gpu_done - trace_render_call,
                "total": trace_gpu_done - trace_start
            });
            metadata["paintMode"] = serde_json::json!(paint_mode);
            metadata["priorCacheIdentityMatches"] = serde_json::json!(prior_cache_match);
            metadata["priorCachePan"] = serde_json::json!(prior_cache_pan);
            if !cache_hint && !warm_cache {
                state.scene_cache = Some(SceneCache {
                    identity, source_scene:Arc::new(source_scene),
                    prepared_scene: Arc::new(prepared_scene),
                    atlas_pages: plans.len(),
                    atlas_page_resource_counts: plans.iter().map(|plan| plan.images.len()).collect(),
                });
            } else {
                state.scene_cache = None;
            }
            state.prepared.stage(prepared);
            Ok(metadata.to_string())
        }

        /// One synchronous commit point for surface pixels and caller-owned DOM
        /// ownership/camera updates. A prepared frame is consumed exactly once.
        /// Preparation queue completion does not certify scan-out; this method
        /// submits the final small blit and presents in the current JS turn.
        pub fn present_prepared(&mut self) -> Result<String, JsValue> {
            let state = self
                .state
                .as_mut()
                .ok_or_else(|| js_error("RENDERER_NOT_INITIALIZED"))?;
            let prepared = state.prepared.take_for_present().map_err(js_error)?;
            // An attempted commit consumes the preparation even on a health or
            // surface error; it cannot become an accidental later retry.
            state.check_health()?;
            let resized = state.config.width != prepared.input.width
                || state.config.height != prepared.input.height;
            if resized {
                state.config.width = prepared.input.width;
                state.config.height = prepared.input.height;
                state.configure();
            }
            let surface_texture = state.acquire()?;
            let surface_view = surface_texture
                .texture
                .create_view(&wgpu::TextureViewDescriptor::default());
            let mut encoder =
                state
                    .device
                    .create_command_encoder(&wgpu::CommandEncoderDescriptor {
                        label: Some("p0-main-thread-prepared-surface-commit"),
                    });
            {
                // TextureBlitter loads its destination. Clear every surface frame
                // before alpha conversion so removed/transparent objects cannot
                // blend with an earlier frame or leave motion trails.
                let _clear = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                    label: Some("p0-clear-surface-before-alpha-conversion"),
                    color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                        view: &surface_view,
                        depth_slice: None,
                        resolve_target: None,
                        ops: wgpu::Operations {
                            load: wgpu::LoadOp::Clear(wgpu::Color::TRANSPARENT),
                            store: wgpu::StoreOp::Store,
                        },
                    })],
                    depth_stencil_attachment: None,
                    timestamp_writes: None,
                    occlusion_query_set: None,
                    multiview_mask: None,
                });
            }
            state.blitter.copy(
                &state.device,
                &mut encoder,
                &state.target_view,
                &surface_view,
            );
            state.queue.submit([encoder.finish()]);
            surface_texture.present();
            state.frame += 1;
            state.images.present();
            Ok(frame_metadata(state, &prepared, true, resized).to_string())
        }

        pub fn discard_prepared(&mut self) {
            if let Some(state) = self.state.as_mut() {
                state.prepared.discard();
                state.images.discard();
            }
        }

        /// Registration is synchronous and must finish before async preparation
        /// takes the mutable renderer borrow. Revisions are immutable.
        pub fn register_image(&mut self,reference_json:String,pixels:Vec<u8>)->Result<String,JsValue> {
            let state=self.state.as_mut().ok_or_else(||js_error("RENDERER_NOT_INITIALIZED"))?;
            state.check_health()?;
            let value:Value=serde_json::from_str(&reference_json).map_err(|_|js_error("RESOURCE_INVALID: image JSON"))?;
            let reference=image_resources::parse_reference(&value).map_err(js_error)?;
            let used_by_cached_scene = state.scene_cache.as_ref().is_some_and(|cache|
                cache.prepared_scene.resources.contains(&reference));
            let result=state.images.register(reference,pixels).map_err(js_error)?;
            if used_by_cached_scene { state.scene_cache=None; }
            Ok(result.to_string())
        }

        pub fn retain_images(&mut self,references_json:String)->Result<String,JsValue> {
            let state=self.state.as_mut().ok_or_else(||js_error("RENDERER_NOT_INITIALIZED"))?;
            state.prepared.discard();
            let references=image_resources::parse_references_json(&references_json).map_err(js_error)?;
            state.images.retain_candidates(&references);
            if state.scene_cache.as_ref().is_some_and(|cache|
                cache.prepared_scene.resources.iter().any(|r| !references.contains(r))) {
                state.scene_cache=None;
            }
            Ok(state.images.stats().to_string())
        }

        pub fn resource_stats(&self)->Result<String,JsValue> {
            let state=self.state.as_ref().ok_or_else(||js_error("RENDERER_NOT_INITIALIZED"))?;
            let mut stats=state.images.stats();stats["atlasAllocated"]=serde_json::json!(!state.image_atlases.is_empty());
            stats["imageAtlasAllocatedPages"]=serde_json::json!(state.image_atlases.len());
            stats["imageAtlasBytes"]=serde_json::json!(state.image_atlases.len()*image_atlas::ATLAS_BYTES);
            stats["imageAtlasUploads"]=serde_json::json!(state.image_atlases.iter().map(|a|a.uploads).sum::<u64>());
            stats["imageAtlasUploadBytes"]=serde_json::json!(state.image_atlases.iter().map(|a|a.upload_bytes).sum::<u64>());
            stats["imageAtlasDeltaUploads"]=serde_json::json!(state.image_atlases.iter().map(|a|a.delta_uploads).sum::<u64>());
            stats["imageAtlasFullUploads"]=serde_json::json!(state.image_atlases.iter().map(|a|a.full_uploads).sum::<u64>());
            stats["imageAtlasPageUploads"]=serde_json::json!(state.image_atlases.iter().map(|a|a.uploads).collect::<Vec<_>>());
            stats["imageAtlasPageBytes"]=serde_json::json!(state.image_atlases.iter().map(|_|image_atlas::ATLAS_BYTES).collect::<Vec<_>>());
            stats["targetWidth"]=serde_json::json!(state.target_width);stats["targetHeight"]=serde_json::json!(state.target_height);
            stats["visibleWidth"]=serde_json::json!(state.config.width);stats["visibleHeight"]=serde_json::json!(state.config.height);
            Ok(stats.to_string())
        }

        /// Check device health while idle. Calls must not overlap initialization
        /// or preparation, which hold the mutable renderer borrow until resolved.
        pub fn check_health(&self) -> Result<(), JsValue> {
            self.state
                .as_ref()
                .ok_or_else(|| js_error("RENDERER_NOT_INITIALIZED"))?
                .check_health()
        }

        pub fn dispose(&mut self) {
            self.retained=None;self.rendered_revision=0;
            self.state = None;
        }

        /// Destroy the actual device without disposing its observable state.
        /// WebGPU resolves GPUDevice.lost asynchronously; the installed callback
        /// then makes check_health report DEVICE_LOST. Do not synthesize a loss
        /// flag or clear state here, which would bypass that recovery evidence.
        /// Calls must not overlap initialization/preparation's mutable borrow.
        pub fn destroy_device_for_recovery_test(&mut self) {
            if let Some(state) = self.state.as_ref() {
                state.device.destroy();
            }
        }
    }
}

#[cfg(target_arch = "wasm32")]
pub use surface::B4SurfaceRenderer;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn frame_validation_rejects_zero_and_nonfinite_viewports() {
        assert!(validate_frame(0, 20, 4096, 1.0, 0.0, 0.0).is_err());
        assert!(validate_frame(20, 0, 4096, 1.0, 0.0, 0.0).is_err());
        for scale in [f64::NAN, f64::INFINITY, -1.0, 0.0, 1e7] {
            assert!(validate_frame(20, 20, 4096, scale, 0.0, 0.0).is_err());
        }
        for pan in [f64::NAN, f64::INFINITY, -f64::INFINITY, 1e10] {
            assert!(validate_frame(20, 20, 4096, 1.0, pan, 0.0).is_err());
            assert!(validate_frame(20, 20, 4096, 1.0, 0.0, pan).is_err());
        }
    }

    #[test]
    fn frame_dimensions_obey_device_and_proof_caps() {
        let input = validate_frame(u32::MAX, u32::MAX, 2048, 0.25, -900.0, 700.0).unwrap();
        assert_eq!((input.width, input.height), (2048, 2048));
        let input = validate_frame(8000, 6000, 8192, 1.0, 0.0, 0.0).unwrap();
        assert_eq!((input.width, input.height), (4096, 4096));
        assert!(validate_frame(1, 1, 0, 1.0, 0.0, 0.0).is_err());
    }

    #[test]
    fn invalid_snapshot_schema_shape_and_numbers_do_not_reach_gpu() {
        assert!(parse_snapshot("{").is_err());
        assert!(parse_snapshot(r#"{"schema":"wrong","schemaVersion":1,"objects":[]}"#).is_err());
        assert!(
            parse_snapshot(r#"{"schema":"art-equation.scene","schemaVersion":2,"objects":[]}"#)
                .is_err()
        );
        assert!(
            parse_snapshot(r#"{"schema":"art-equation.scene","schemaVersion":1,"objects":{}}"#)
                .is_err()
        );
        assert!(parse_snapshot(r#"{"schema":"art-equation.scene","schemaVersion":1,"objects":[{"bounds":{"x":1e100}}]}"#).is_err());
        assert!(parse_snapshot(&" ".repeat(MAX_SNAPSHOT_BYTES + 1)).is_err());
    }

    #[test]
    fn owned_sanitized_fixture_encodes_without_archived_dependency() {
        let mut fixture = real_board_fixture();
        assert!(parse_snapshot(&fixture.to_string()).is_err());
        fixture["connections"] = serde_json::json!([]);
        let parsed = parse_snapshot(&fixture.to_string()).unwrap();
        let (_, report) = gpu_scene::encode_snapshot(&parsed).unwrap();
        assert_eq!(report.vectors, 7);
        assert_eq!(report.encoded_connections, 0);
    }

    fn flat_guard_fixture() -> Value {
        serde_json::json!({
            "schema":"art-equation.scene", "schemaVersion":1,
            "environment":{"background":"#00000000","colorSpace":"srgb"},
            "connections":[], "objects":[{
                "id":"flat-vector", "kind":"vector", "visible":true,
                "transform":[1,0,0,1,0,0], "bounds":{"x":4,"y":4,"width":8,"height":8},
                "payload":{"fill":"#ff0000"}
            }]
        })
    }

    #[test]
    fn inherited_clips_groups_and_raw_vector_edits_fail_for_both_backends() {
        for (field, value) in [
            ("parentId", serde_json::json!("parent-group")),
            ("clipId", serde_json::json!("clip-mask")),
            ("groupId", serde_json::json!("raw-board-group")),
        ] {
            let mut fixture = flat_guard_fixture();
            fixture["objects"][0][field] = value;
            let source = fixture.to_string();
            assert!(parse_snapshot(&source).unwrap_err().contains(field));
            assert!(
                cpu::render_cpu_snapshot(32, 32, &source, 1.0, 0.0, 0.0)
                    .unwrap_err()
                    .contains(field)
            );
        }
        for (field, value) in [
            (
                "vectorTransform",
                serde_json::json!({"scaleX":-1,"skewX":20}),
            ),
            (
                "vectorBoolean",
                serde_json::json!({"operation":"subtract","operands":[]}),
            ),
            (
                "vectorPath",
                serde_json::json!({"version":1,"closed":true,"points":[]}),
            ),
            ("resolvedPaths", serde_json::json!([])),
            ("clipChildren", serde_json::json!(true)),
            ("fillOpacity", serde_json::json!(0.5)),
            ("cornerRadius", serde_json::json!(8)),
        ] {
            let mut fixture = flat_guard_fixture();
            fixture["objects"][0]["payload"][field] = value;
            let source = fixture.to_string();
            assert!(parse_snapshot(&source).unwrap_err().contains(field));
            assert!(
                cpu::render_cpu_snapshot(32, 32, &source, 1.0, 0.0, 0.0)
                    .unwrap_err()
                    .contains(field)
            );
        }
    }

    #[test]
    fn canonical_matrix_is_validated_and_preserves_actual_transformed_pixels() {
        for matrix in [
            serde_json::json!([1, 0, 0, 1]),
            serde_json::json!("matrix(1,0,0,1,0,0)"),
            serde_json::json!([1, 0, 0, 1, "x", 0]),
        ] {
            let mut fixture = flat_guard_fixture();
            fixture["objects"][0]["transform"] = matrix;
            assert!(parse_snapshot(&fixture.to_string()).is_err());
        }
        let mut fixture = flat_guard_fixture();
        fixture["objects"][0]["transform"] = serde_json::json!([1, 0, 0, 1, 8, 0]);
        let source = fixture.to_string();
        assert!(parse_snapshot(&source).is_ok());
        let pixels = cpu::render_cpu_snapshot(32, 32, &source, 1.0, 0.0, 0.0).unwrap();
        assert_eq!(
            &pixels[(8 * 32 + 6) * 4..(8 * 32 + 6) * 4 + 4],
            &[0, 0, 0, 0]
        );
        assert_eq!(
            &pixels[(8 * 32 + 16) * 4..(8 * 32 + 16) * 4 + 4],
            &[255, 0, 0, 255]
        );
    }

    #[test]
    fn descriptive_group_metadata_and_inactive_clips_do_not_trigger_a_false_positive() {
        let mut fixture = flat_guard_fixture();
        fixture["objects"][0]["payload"]["group"] = serde_json::json!("Reference palette group");
        fixture["objects"][0]["payload"]["clipChildren"] = serde_json::json!(false);
        fixture["objects"][0]["payload"]["fillOpacity"] = serde_json::json!(1.0);
        fixture["objects"][0]["payload"]["cornerRadius"] = serde_json::json!(0.0);
        fixture["objects"][0]["extensions"] =
            serde_json::json!({"group":{"label":"archived design reference"}});
        let source = fixture.to_string();
        assert!(parse_snapshot(&source).is_ok());
        assert!(cpu::render_cpu_snapshot(32, 32, &source, 1.0, 0.0, 0.0).is_ok());
    }

    #[test]
    fn nonrectangular_legacy_shapes_require_commands_and_hidden_ones_do_not_paint() {
        let mut fixture = flat_guard_fixture();
        fixture["objects"][0]["payload"]["shapeType"] = serde_json::json!("ellipse");
        assert!(
            parse_snapshot(&fixture.to_string())
                .unwrap_err()
                .contains("explicit path commands")
        );
        fixture["objects"][0]["visible"] = serde_json::json!(false);
        let pixels = cpu::render_cpu_snapshot(32, 32, &fixture.to_string(), 1.0, 0.0, 0.0).unwrap();
        assert!(pixels.iter().all(|byte| *byte == 0));
    }

    #[test]
    fn presentation_requires_a_successful_preparation_and_consumes_it_once() {
        let mut gate = PreparedGate::default();
        assert!(gate.take_for_present().is_err());
        gate.stage(("revision-1", 320, 240));
        assert_eq!(gate.take_for_present().unwrap(), ("revision-1", 320, 240));
        assert!(gate.take_for_present().is_err());
    }

    #[test]
    fn stale_or_failed_preparations_cannot_commit_the_previous_ready_frame() {
        let mut gate = PreparedGate::default();
        gate.stage(("ready-old", 320, 240));
        // A new preparation invalidates the old commit before it validates or
        // renders. Failure leaves the visible prior frame intact but not ready.
        gate.discard();
        let invalid_snapshot = "{";
        assert!(parse_snapshot(invalid_snapshot).is_err());
        assert!(gate.take_for_present().is_err());
        gate.stage(("stale-completed", 640, 480));
        // The caller's generation check may discard a completed stale render.
        gate.discard();
        assert!(gate.take_for_present().is_err());
        gate.stage(("current-completed", 800, 600));
        assert_eq!(
            gate.take_for_present().unwrap(),
            ("current-completed", 800, 600)
        );
    }
}
