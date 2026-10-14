//! Actual Vello CPU fallback consuming the shared validated prepared scene.
//! GPU pixels are never requested; output is straight RGBA for ImageData.

#[cfg(test)]
use crate::prepared_scene::MAX_PATH_COMMANDS;
use crate::prepared_scene::{PreparedOp, prepare_snapshot, validate_camera};
use crate::image_resources::{ImageRegistry, ImageReference, parse_reference, parse_references_json};
use std::{collections::HashMap, sync::Arc};
#[cfg(test)]
use serde_json::Value;
use vello_cpu::{
    Level, Pixmap, RasterizerSettings, RenderContext, RenderMode, RenderSettings, Resources, ImageSource,
    kurbo::{Affine, Rect, Shape},
    peniko::{Fill, ImageBrush, ImageSampler},
};

/// Worker-local persistent decoded resources. Raw canonical bytes and CPU
/// pixmaps are both counted; neither is inferred from GPU readback.
#[cfg_attr(target_arch="wasm32", wasm_bindgen::prelude::wasm_bindgen)]
pub struct B4CpuRenderer {
    registry: ImageRegistry,
    images: HashMap<(String,u64), Arc<Pixmap>>,
    surface: Option<CpuSurface>,
    additional_threads: u16,
    surface_allocations: usize,
    surface_resizes: usize,
    disposed: bool,
}

/// The context and its resources have the same lifetime. Reset command/state
/// buffers between frames; retain the raster buffer at the current resolution.
struct CpuSurface {
    context: RenderContext,
    pixmap: Pixmap,
    resources: Resources,
}

impl Default for B4CpuRenderer {
    fn default()->Self { Self {registry:ImageRegistry::default(),images:HashMap::new(),surface:None,
        additional_threads:0,surface_allocations:0,surface_resizes:0,disposed:false} }
}

impl B4CpuRenderer {
    #[cfg(all(not(target_arch="wasm32"), feature="native-cpu-parallel"))]
    pub fn with_additional_threads(threads: u16) -> Result<Self, String> {
        if threads > 4 { return Err("CPU_THREAD_LIMIT: use 0 to 4 additional threads".into()); }
        Ok(Self {additional_threads:threads,..Self::default()})
    }
    pub fn register(&mut self, reference: ImageReference, pixels: Vec<u8>) -> Result<String,String> {
        if self.disposed {return Err("CPU_RENDERER_DISPOSED".into());}
        self.registry.register(reference, pixels)?;
        Ok(self.stats().to_string())
    }
    fn prune_pixmaps(&mut self) { self.images.retain(|key,_|self.registry.contains(key)); }
    pub fn stats(&self)->serde_json::Value {
        let pixmap_bytes:usize=self.images.values().map(|p|usize::from(p.width())*usize::from(p.height())*4).sum();
        serde_json::json!({"decoded":self.registry.stats(),"cpuPixmapBytes":pixmap_bytes,"cpuPixmapCount":self.images.len(),
            "cpuSurfaceAllocations":self.surface_allocations,"cpuSurfaceResizes":self.surface_resizes,
            "cpuAdditionalThreads":self.additional_threads,
            "cpuSurfaceBytes":self.surface.as_ref().map_or(0,|s|s.pixmap.capacity()*4)})
    }
    pub fn render(&mut self,width:u32,height:u32,snapshot_json:&str,scale:f64,pan_x:f64,pan_y:f64)->Result<Vec<u8>,String> {
        if self.disposed {return Err("CPU_RENDERER_DISPOSED".into());}
        // A completed worker render holds resources until the next requested
        // complete frame. Visible CPU pixels are an independent copied surface.
        let result=self.render_inner(width,height,snapshot_json,scale,pan_x,pan_y);
        if result.is_ok() {self.registry.present();} else {self.registry.discard();}
        self.prune_pixmaps();
        result
    }

    fn render_inner(&mut self,width:u32,height:u32,snapshot_json:&str,scale:f64,pan_x:f64,pan_y:f64)->Result<Vec<u8>,String> {
        if width>4096 || height>4096 {return Err("CPU frame dimensions exceed the 4096-pixel proof limit".into());}
        super::validate_frame(width,height,4096,scale,pan_x,pan_y)?;
        let snapshot=super::parse_snapshot(snapshot_json)?;
        let prepared=prepare_snapshot(&snapshot)?;
        let camera=Affine::translate((pan_x,pan_y))*Affine::scale(scale);
        validate_camera(&prepared,camera)?;
        self.registry.stage(&prepared.resources)?;
        // Resolve every image and allocate persistent pixmaps before output.
        for reference in &prepared.resources {
            let key=(reference.key.clone(),reference.revision);
            if !self.images.contains_key(&key) {
                let image=self.registry.resolve(reference)?;
                let mut pixmap=Pixmap::new(reference.width as u16,reference.height as u16);
                pixmap.data_as_u8_slice_mut().copy_from_slice(&image.pixels);
                self.images.insert(key,Arc::new(pixmap));
            }
        }
        if let Some(surface) = &mut self.surface {
            if u32::from(surface.pixmap.width()) != width || u32::from(surface.pixmap.height()) != height {
                surface.context.reset_and_resize(width as u16, height as u16);
                // Bound retained capacity to the largest admitted frame rather
                // than Vec's geometric growth beyond the requested allocation.
                if width as usize * height as usize > surface.pixmap.capacity() {
                    surface.pixmap = Pixmap::new(width as u16,height as u16);
                } else { surface.pixmap.resize(width as u16, height as u16); }
                self.surface_resizes += 1;
            } else {
                surface.context.reset();
            }
        } else {
            self.surface = Some(CpuSurface {
                context:RenderContext::new_with(width as u16,height as u16,RenderSettings {
                    level:Level::new(), num_threads:self.additional_threads,
                }),
                pixmap:Pixmap::new(width as u16,height as u16),resources:Resources::new(),
            });
            self.surface_allocations += 1;
        }
        rasterize(width,height,&prepared,camera,&self.images,self.surface.as_mut().unwrap())
    }
}

#[cfg_attr(target_arch="wasm32", wasm_bindgen::prelude::wasm_bindgen)]
impl B4CpuRenderer {
    #[cfg_attr(target_arch="wasm32", wasm_bindgen::prelude::wasm_bindgen(constructor))]
    pub fn new()->Self {Self::default()}
    pub fn register_image(&mut self,reference_json:String,pixels:Vec<u8>)->Result<String,crate::EngineError> {
        let value=serde_json::from_str(&reference_json).map_err(|_|crate::engine_error("RESOURCE_INVALID: image JSON"))?;
        let reference=parse_reference(&value).map_err(crate::engine_error)?;
        self.register(reference,pixels).map_err(crate::engine_error)
    }
    pub fn retain_images(&mut self,references_json:String)->Result<String,crate::EngineError> {
        if self.disposed {return Err(crate::engine_error("CPU_RENDERER_DISPOSED"));}
        let references=parse_references_json(&references_json).map_err(crate::engine_error)?;
        self.registry.retain_candidates(&references);self.prune_pixmaps();
        Ok(self.stats().to_string())
    }
    pub fn resource_stats(&self)->String {self.stats().to_string()}
    pub fn render_snapshot(&mut self,width:u32,height:u32,snapshot_json:String,scale:f64,pan_x:f64,pan_y:f64)->Result<Vec<u8>,crate::EngineError> {
        self.render(width,height,&snapshot_json,scale,pan_x,pan_y).map_err(crate::engine_error)
    }
    pub fn dispose(&mut self) {self.registry=ImageRegistry::default();self.images.clear();self.surface=None;self.disposed=true;}
}

pub fn render_cpu_snapshot(
    width: u32,
    height: u32,
    snapshot_json: &str,
    scale: f64,
    pan_x: f64,
    pan_y: f64,
) -> Result<Vec<u8>, String> {
    B4CpuRenderer::new().render(width,height,snapshot_json,scale,pan_x,pan_y)
}

fn rasterize(width:u32,height:u32,prepared:&crate::prepared_scene::PreparedScene,camera:Affine,
    images:&HashMap<(String,u64),Arc<Pixmap>>,surface:&mut CpuSurface)->Result<Vec<u8>,String> {
    // Complete validation/preparation precedes all output surface allocation.
    let context = &mut surface.context;
    context.set_paint(prepared.background);
    context.fill_rect(&Rect::new(0.0, 0.0, f64::from(width), f64::from(height)));
    for operation in &prepared.operations {
        let object = match operation {
            PreparedOp::Vector(index) => &prepared.vectors[*index],
            PreparedOp::Image(index) => {
                let image=&prepared.images[*index];
                let pixmap=images.get(&(image.resource.key.clone(),image.resource.revision))
                    .ok_or("RESOURCE_NOT_READY: CPU pixmap missing")?;
                context.set_transform(camera*image.transform);
                context.reset_paint_transform();
                context.set_fill_rule(Fill::NonZero);
                // vello_common 0.2 explicitly panics for ImageSampler.alpha
                // other than one. Apply opacity through the supported layer
                // compositing path shared with vector primitives instead.
                if image.opacity < 1.0 { context.push_opacity_layer(image.opacity); }
                context.set_paint(ImageBrush{image:ImageSource::Pixmap(pixmap.clone()),
                    sampler:ImageSampler::new().with_quality(image.quality)});
                context.fill_rect(&image.source);
                if image.opacity < 1.0 { context.pop_layer(); }
                continue;
            }
            PreparedOp::Gradient(paint) => {
                context.set_transform(camera*paint.transform);
                context.set_paint_transform(paint.brush_transform);
                context.set_fill_rule(paint.fill_rule);
                context.set_paint(paint.gradient.clone());
                context.fill_path(&paint.path);
                context.reset_paint_transform();
                continue;
            }
            PreparedOp::Shadow(paint) => {
                context.set_transform(camera*paint.transform);
                context.reset_paint_transform();
                context.set_fill_rule(Fill::NonZero);
                context.set_paint(paint.color);
                if paint.std_dev==0.0 {
                    context.fill_path(&paint.rect.to_rounded_rect(paint.radius).to_path(0.05));
                } else {
                    context.fill_blurred_rounded_rect(&paint.rect,paint.radius as f32,paint.std_dev as f32,false);
                }
                continue;
            }
            PreparedOp::Scope(scope) => {
                context.set_transform(camera * scope.transform);
                context.set_fill_rule(scope.fill_rule);
                context.push_layer(
                    Some(&scope.path),
                    Some(scope.blend),
                    Some(scope.opacity),
                    None,
                    None,
                );
                continue;
            }
            PreparedOp::Pop => {
                context.pop_layer();
                continue;
            }
        };
        context.set_transform(camera * object.transform);
        context.reset_paint_transform();
        if object.opacity < 1.0 {
            context.push_opacity_layer(object.opacity);
        }
        context.set_fill_rule(object.fill_rule);
        context.set_paint(object.fill);
        context.fill_path(&object.path);
        if let Some(path) = &object.stroke_path {
            context.set_stroke(object.stroke.clone());
            context.set_paint(object.stroke_color);
            context.stroke_path(path);
        }
        if object.opacity < 1.0 {
            context.pop_layer();
        }
    }
    context.flush();
    context.render_with(
        &mut surface.pixmap,
        &mut surface.resources,
        RasterizerSettings {
            render_mode: RenderMode::OptimizeSpeed,
            ..Default::default()
        },
    );
    let mut pixels = Vec::with_capacity(width as usize * height as usize * 4);
    // Preserve vello_common's rounding without consuming the retained pixmap.
    // The returned frame is independently owned for WASM/worker transfer.
    for pixel in surface.pixmap.data() {
        if pixel.a == 0 { pixels.extend_from_slice(&[0;4]); } else {
            let alpha = 255.0 / f32::from(pixel.a);
            let unpremultiply = |component| (f32::from(component) * alpha + 0.5) as u8;
            pixels.extend_from_slice(&[unpremultiply(pixel.r),unpremultiply(pixel.g),unpremultiply(pixel.b),pixel.a]);
        }
    }
    Ok(pixels)
}
#[cfg(test)]
mod image_tests {
    use super::*;
    use serde_json::{Value,json};
    fn reference(revision:u64)->ImageReference {ImageReference{key:"pixels".into(),revision,epoch:7,width:2,height:2}}
    fn draw(r:&ImageReference)->Value {json!({"type":"image","id":"photo","resource":r,
        "sourceRect":{"x":0,"y":0,"width":2,"height":2},"transform":[4,0,0,4,4,4],"opacity":1,"sampling":"nearest"})}
    fn list(r:&ImageReference,operations:Vec<Value>)->Value {json!({"schema":"art-equation.display-list","schemaVersion":2,"sceneId":"photo-board","revision":"1",
        "environment":{"background":"#00000000","colorSpace":"srgb"},"resources":[r],"operations":operations})}
    fn pixel(bytes:&[u8],x:usize,y:usize)->[u8;4]{bytes[(y*16+x)*4..(y*16+x)*4+4].try_into().unwrap()}
    fn render(engine:&mut B4CpuRenderer,value:&Value)->Result<Vec<u8>,String>{engine.render(16,16,&value.to_string(),1.0,0.0,0.0)}
    fn install(engine:&mut B4CpuRenderer,r:&ImageReference){engine.register(r.clone(),vec![255,0,0,255,0,255,0,255,0,0,255,255,100,0,0,128]).unwrap();}
    #[test]
    fn real_cpu_image_pixels_crop_transform_and_premultiplied_alpha_are_preserved() {
        let r=reference(1);let mut engine=B4CpuRenderer::new();install(&mut engine,&r);
        let mut op=draw(&r);let painted=render(&mut engine,&list(&r,vec![op.clone()])).unwrap();
        assert_eq!(pixel(&painted,5,5),[255,0,0,255]);assert_eq!(pixel(&painted,10,5),[0,255,0,255]);
        assert_eq!(pixel(&painted,5,10),[0,0,255,255]);assert!((198..=200).contains(&pixel(&painted,10,10)[0]));
        assert_eq!(pixel(&painted,10,10)[3],128);assert_eq!(pixel(&painted,2,2),[0;4]);
        op["sourceRect"]=json!({"x":1,"y":0,"width":1,"height":1});
        let cropped=render(&mut engine,&list(&r,vec![op.clone()])).unwrap();
        assert_eq!(pixel(&cropped,5,5),[0;4]);assert_eq!(pixel(&cropped,10,5),[0,255,0,255]);
        op["transform"]=json!([-4,0,0,4,12,4]);
        let flipped=render(&mut engine,&list(&r,vec![op])).unwrap();assert_eq!(pixel(&flipped,5,5),[0,255,0,255]);
        assert_eq!(engine.stats()["cpuPixmapCount"],1);
    }
    #[test]
    fn complete_resource_resolution_precedes_output_and_versions_recover() {
        let r=reference(1);let mut engine=B4CpuRenderer::new();
        assert!(render(&mut engine,&list(&r,vec![draw(&r)])).unwrap_err().contains("RESOURCE"));
        install(&mut engine,&r);render(&mut engine,&list(&r,vec![draw(&r)])).unwrap();
        let next=reference(2);let before=engine.stats();
        assert!(render(&mut engine,&list(&next,vec![draw(&next)])).is_err());assert_eq!(engine.stats()["decoded"]["bytes"],before["decoded"]["bytes"]);
        install(&mut engine,&next);render(&mut engine,&list(&next,vec![draw(&next)])).unwrap();
        assert_eq!(engine.stats()["decoded"]["references"],json!([next]));assert_eq!(engine.stats()["cpuPixmapBytes"],16);
        let mut bad=draw(&next);bad["sourceRect"]["width"]=json!(3);assert!(render(&mut engine,&list(&next,vec![bad])).is_err());
        render(&mut engine,&list(&next,vec![draw(&next)])).unwrap();
        engine.dispose();assert_eq!(engine.stats()["decoded"]["bytes"],0);assert!(render(&mut engine,&list(&next,vec![draw(&next)])).is_err());
    }
    #[test]
    fn image_clipping_and_scope_opacity_obey_the_same_ordered_list() {
        let r=reference(1);let mut engine=B4CpuRenderer::new();install(&mut engine,&r);
        let clip=json!({"type":"pushComposite","scopeId":"clip","commands":[["M",4,4],["L",8,4],["L",8,12],["L",4,12],["Z"]],
            "transform":[1,0,0,1,0,0],"isolation":"isolated","fillRule":"nonzero","opacity":0.5,"blendMode":"normal"});
        let painted=render(&mut engine,&list(&r,vec![clip,draw(&r),json!({"type":"pop","scopeId":"clip"})])).unwrap();
        let red=pixel(&painted,5,5);assert_eq!(&red[..3],&[255,0,0]);assert!((127..=128).contains(&red[3]));
        assert_eq!(pixel(&painted,10,5),[0;4]);
    }
    #[test]
    fn bilinear_sampling_and_camera_are_real_cpu_paint() {
        let r=reference(1);let mut engine=B4CpuRenderer::new();install(&mut engine,&r);
        let mut op=draw(&r);op["sampling"]=json!("bilinear");
        let painted=engine.render(16,16,&list(&r,vec![op]).to_string(),0.5,2.0,2.0).unwrap();
        assert_eq!(pixel(&painted,2,2),[0;4]);assert!(pixel(&painted,5,5)[3]>0);assert_eq!(pixel(&painted,9,9),[0;4]);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn rectangle(fill: &str) -> Value {
        json!({
            "id": "vector", "kind": "vector", "order": 0, "visible": true,
            "locked": false, "opacity": 1, "blendMode": "normal",
            "transform": [1, 0, 0, 1, 0, 0],
            "bounds": { "x": 8, "y": 8, "width": 16, "height": 16 },
            "payload": { "commands": [["M",8,8],["L",24,8],["L",24,24],["L",8,24],["Z"]], "fill": fill, "strokeWidth": 0 }
        })
    }

    fn scene(objects: Vec<Value>) -> Value {
        json!({
            "schema": "art-equation.scene", "schemaVersion": 1,
            "documentId": "cpu-proof", "sceneId": "cpu-proof", "revision": "1",
            "coordinateSystem": { "units": "document-unit", "xAxis": "right", "yAxis": "down" },
            "environment": { "background": "#00000000", "colorSpace": "srgb" },
            "objects": objects, "connections": [], "assetIds": []
        })
    }

    fn render(value: &Value) -> Vec<u8> {
        render_cpu_snapshot(48, 40, &value.to_string(), 1.0, 0.0, 0.0).unwrap()
    }

    fn pixel(bytes: &[u8], x: usize, y: usize) -> [u8; 4] {
        bytes[(y * 48 + x) * 4..(y * 48 + x) * 4 + 4]
            .try_into()
            .unwrap()
    }

    #[test]
    fn actual_cpu_pixels_are_deterministic_and_include_unlocked_paths() {
        let value = scene(vec![rectangle("#ff0000")]);
        let first = render(&value);
        assert_eq!(first.len(), 48 * 40 * 4);
        assert_eq!(first, render(&value));
        assert_eq!(pixel(&first, 16, 16), [255, 0, 0, 255]);
        assert_eq!(pixel(&first, 2, 2), [0, 0, 0, 0]);
    }

    #[test]
    fn reused_surface_clears_old_paint_and_resizes_without_replacing_context() {
        let mut engine=B4CpuRenderer::new();
        let red=scene(vec![rectangle("#ff000080")]).to_string();
        let empty=scene(vec![]).to_string();
        let reference=render_cpu_snapshot(48,40,&red,1.0,0.0,0.0).unwrap();
        assert_eq!(engine.render(48,40,&red,1.0,0.0,0.0).unwrap(),reference);
        let context_address=&engine.surface.as_ref().unwrap().context as *const RenderContext;
        let raster_address=engine.surface.as_ref().unwrap().pixmap.data().as_ptr();
        assert!(engine.render(48,40,&empty,1.0,0.0,0.0).unwrap().iter().all(|v|*v==0));
        assert_eq!(engine.surface.as_ref().unwrap().pixmap.data().as_ptr(),raster_address);
        for (w,h,scale,x,y) in [(24,20,0.5,2.0,3.0),(64,48,1.5,-3.0,2.0),(48,40,1.0,0.0,0.0)] {
            assert_eq!(engine.render(w,h,&red,scale,x,y).unwrap(),render_cpu_snapshot(w,h,&red,scale,x,y).unwrap());
            assert_eq!(&engine.surface.as_ref().unwrap().context as *const RenderContext,context_address);
        }
        assert_eq!(engine.stats()["cpuSurfaceAllocations"],1);
        assert_eq!(engine.stats()["cpuSurfaceResizes"],3);
        assert!(engine.render(48,40,"bad json",1.0,0.0,0.0).is_err());
        assert_eq!(engine.render(48,40,&red,1.0,0.0,0.0).unwrap(),reference);
        engine.dispose();assert_eq!(engine.stats()["cpuSurfaceBytes"],0);
        assert!(engine.render(48,40,&red,1.0,0.0,0.0).is_err());
    }

    #[test]
    #[cfg(all(not(target_arch="wasm32"), feature="native-cpu-parallel"))]
    fn native_threaded_paint_matches_single_thread_and_validates_thread_budget() {
        let mut curve=rectangle("#4bd5d080");
        curve["id"]=json!("curve");curve["order"]=json!(1);
        curve["payload"]["commands"]=json!([["M",8,24],["C",8,0,24,0,24,24],["L",8,24],["Z"]]);
        let source=scene(vec![rectangle("#ff0000"),curve]).to_string();
        let expected=render_cpu_snapshot(48,40,&source,1.0,0.0,0.0).unwrap();
        for threads in [2,4] {
            let mut engine=B4CpuRenderer::with_additional_threads(threads).unwrap();
            for _ in 0..3 {assert_eq!(engine.render(48,40,&source,1.0,0.0,0.0).unwrap(),expected);}
            assert_eq!(engine.stats()["cpuSurfaceAllocations"],1);
            assert_eq!(engine.stats()["cpuAdditionalThreads"],threads);
        }
        assert!(B4CpuRenderer::with_additional_threads(5).is_err());
    }

    #[test]
    fn quadratic_and_cubic_commands_preserve_curved_pixels() {
        let mut object = rectangle("#ff0000");
        object["payload"]["commands"] =
            json!([["M", 8, 24], ["Q", 16, 0, 24, 24], ["L", 8, 24], ["Z"]]);
        let quadratic = render(&scene(vec![object.clone()]));
        assert_eq!(pixel(&quadratic, 16, 9), [0, 0, 0, 0]);
        assert_eq!(pixel(&quadratic, 16, 18), [255, 0, 0, 255]);
        object["payload"]["commands"] = json!([
            ["M", 8, 24],
            ["C", 8, 0, 24, 0, 24, 24],
            ["L", 8, 24],
            ["Z"]
        ]);
        let cubic = render(&scene(vec![object]));
        assert_eq!(pixel(&cubic, 16, 9), [255, 0, 0, 255]);
        assert_eq!(pixel(&cubic, 16, 18), [255, 0, 0, 255]);
    }

    #[test]
    fn missing_commands_use_the_canonical_bounds_rectangle() {
        let object = rectangle("#ff0000");
        let reference = render(&scene(vec![object.clone()]));
        let mut bounds_only = object;
        bounds_only["payload"]
            .as_object_mut()
            .unwrap()
            .remove("commands");
        assert_eq!(render(&scene(vec![bounds_only])), reference);
    }

    #[test]
    fn evenodd_hole_differs_from_nonzero_fill() {
        let mut object = rectangle("#00ff00");
        object["payload"]["commands"] = json!([
            ["M", 4, 4],
            ["L", 28, 4],
            ["L", 28, 28],
            ["L", 4, 28],
            ["Z"],
            ["M", 10, 10],
            ["L", 22, 10],
            ["L", 22, 22],
            ["L", 10, 22],
            ["Z"]
        ]);
        object["payload"]["vectorFillRule"] = json!("evenodd");
        let with_hole = render(&scene(vec![object.clone()]));
        assert_eq!(pixel(&with_hole, 16, 16), [0, 0, 0, 0]);
        assert_eq!(pixel(&with_hole, 6, 6), [0, 255, 0, 255]);
        object["payload"]["vectorFillRule"] = json!("nonzero");
        assert_eq!(
            pixel(&render(&scene(vec![object])), 16, 16),
            [0, 255, 0, 255]
        );
    }

    #[test]
    fn zero_stroke_does_not_draw_an_open_line() {
        let mut object = rectangle("none");
        object["payload"]["commands"] = json!([["M", 12, 16], ["L", 28, 16]]);
        object["payload"]["stroke"] = json!("#ff0000");
        assert!(
            render(&scene(vec![object]))
                .iter()
                .all(|component| *component == 0)
        );
    }

    #[test]
    fn stroke_caps_change_actual_endpoint_pixels() {
        let mut object = rectangle("none");
        object["payload"]["commands"] = json!([["M", 12, 16], ["L", 28, 16]]);
        object["payload"]["stroke"] = json!("#0000ff");
        object["payload"]["strokeWidth"] = json!(8);
        object["payload"]["vectorStrokeCap"] = json!("butt");
        assert_eq!(pixel(&render(&scene(vec![object.clone()])), 9, 16)[3], 0);
        for cap in ["round", "square"] {
            object["payload"]["vectorStrokeCap"] = json!(cap);
            assert!(pixel(&render(&scene(vec![object.clone()])), 9, 16)[3] > 200);
        }
    }

    #[test]
    fn stroke_join_changes_actual_corner_pixels() {
        let mut object = rectangle("none");
        object["payload"]["commands"] = json!([["M", 12, 28], ["L", 12, 12], ["L", 28, 12]]);
        object["payload"]["stroke"] = json!("#0000ff");
        object["payload"]["strokeWidth"] = json!(8);
        object["payload"]["vectorStrokeJoin"] = json!("miter");
        let miter = render(&scene(vec![object.clone()]));
        object["payload"]["vectorStrokeJoin"] = json!("bevel");
        let bevel = render(&scene(vec![object]));
        assert_eq!(pixel(&miter, 8, 8)[3], 255);
        assert_eq!(pixel(&bevel, 8, 8)[3], 0);
    }

    #[test]
    fn transparent_object_opacity_returns_straight_rgba() {
        let mut object = rectangle("#ff0000");
        object["opacity"] = json!(0.5);
        let pixels = render(&scene(vec![object]));
        let actual = pixel(&pixels, 16, 16);
        assert_eq!(&actual[..3], &[255, 0, 0]);
        assert!((127..=128).contains(&actual[3]));
        assert!(
            pixels
                .chunks_exact(4)
                .filter(|p| p[3] == 0)
                .all(|p| p[..3] == [0, 0, 0])
        );
    }

    #[test]
    fn paint_alpha_and_object_opacity_combine_without_darkening_rgb() {
        let mut object = rectangle("#00ff0080");
        object["opacity"] = json!(0.5);
        let actual = pixel(&render(&scene(vec![object])), 16, 16);
        assert_eq!(&actual[..3], &[0, 255, 0]);
        assert!((63..=64).contains(&actual[3]));
    }

    #[test]
    fn opacity_applies_once_to_fill_and_stroke_overlap() {
        let mut object = rectangle("#ff0000");
        object["opacity"] = json!(0.5);
        object["payload"]["stroke"] = json!("#0000ff");
        object["payload"]["strokeWidth"] = json!(8);
        let actual = pixel(&render(&scene(vec![object])), 9, 16);
        assert_eq!(&actual[..3], &[0, 0, 255]);
        assert!((127..=128).contains(&actual[3]));
    }

    #[test]
    fn camera_and_object_transforms_are_composed_in_order() {
        let mut object = rectangle("#ff0000");
        object["transform"] = json!([1, 0, 0, 1, 2, 1]);
        let value = scene(vec![object]);
        let pixels = render_cpu_snapshot(48, 40, &value.to_string(), 0.5, 10.0, 4.0).unwrap();
        assert_eq!(pixel(&pixels, 16, 10), [255, 0, 0, 255]);
        assert_eq!(pixel(&pixels, 12, 10), [0, 0, 0, 0]);
        assert_eq!(pixel(&pixels, 24, 10), [0, 0, 0, 0]);
    }

    #[test]
    fn canonical_order_wins_over_input_array_order() {
        let mut top = rectangle("#0000ff");
        top["id"] = json!("top");
        top["order"] = json!(9);
        let mut bottom = rectangle("#ff0000");
        bottom["id"] = json!("bottom");
        bottom["order"] = json!(2);
        assert_eq!(
            pixel(&render(&scene(vec![top, bottom])), 16, 16),
            [0, 0, 255, 255]
        );
    }

    #[test]
    fn invisible_and_zero_opacity_objects_leave_background_untouched() {
        let mut hidden = rectangle("#ff0000");
        hidden["id"] = json!("hidden");
        hidden["visible"] = json!(false);
        let mut transparent = rectangle("#0000ff");
        transparent["id"] = json!("transparent");
        transparent["opacity"] = json!(0);
        let mut value = scene(vec![hidden, transparent]);
        value["environment"]["background"] = json!("#008000");
        assert!(
            render(&value)
                .chunks_exact(4)
                .all(|p| p == [0, 128, 0, 255])
        );
    }

    #[test]
    fn visible_unsupported_kinds_and_connections_are_rejected() {
        for kind in ["text", "raster", "container", "video", "model"] {
            let mut object = rectangle("#ff0000");
            object["kind"] = json!(kind);
            assert!(
                render_cpu_snapshot(48, 40, &scene(vec![object]).to_string(), 1.0, 0.0, 0.0)
                    .is_err()
            );
        }
        let mut value = scene(vec![]);
        value["connections"] = json!([{ "id": "edge" }]);
        assert!(render_cpu_snapshot(48, 40, &value.to_string(), 1.0, 0.0, 0.0).is_err());
    }

    #[test]
    fn malformed_paths_transforms_and_styles_fail_before_rasterization() {
        let invalid = [
            ("commands", json!([["L", 2, 2]])),
            ("commands", json!([["M", 2, 2], ["C", 3, 3]])),
            ("commands", json!([["M", "bad", 2]])),
            ("commands", json!([["M", 2, 2], ["A", 3, 3]])),
            ("vectorFillRule", json!("unknown")),
            ("vectorStrokeCap", json!("unknown")),
            ("vectorStrokeJoin", json!("unknown")),
            ("dashArray", json!([3, -2])),
            ("miterLimit", json!(0)),
            ("strokeWidth", json!(-1)),
            ("fill", json!("invalid-color")),
        ];
        for (field, value) in invalid {
            let mut object = rectangle("#ff0000");
            object["payload"][field] = value;
            assert!(
                render_cpu_snapshot(48, 40, &scene(vec![object]).to_string(), 1.0, 0.0, 0.0)
                    .is_err(),
                "{field}"
            );
        }
        let mut object = rectangle("#ff0000");
        object["transform"] = json!([1, 0, 0]);
        assert!(
            render_cpu_snapshot(48, 40, &scene(vec![object]).to_string(), 1.0, 0.0, 0.0).is_err()
        );
    }

    #[test]
    fn oversized_path_is_rejected_before_rasterization() {
        let mut object = rectangle("#ff0000");
        object["payload"]["commands"] =
            Value::Array(vec![json!(["M", 0, 0]); MAX_PATH_COMMANDS + 1]);
        let error = render_cpu_snapshot(48, 40, &scene(vec![object]).to_string(), 1.0, 0.0, 0.0)
            .unwrap_err();
        assert!(error.contains("complexity bounds"));
    }

    #[test]
    fn invalid_frame_and_schema_inputs_do_not_allocate_output() {
        let value = scene(vec![rectangle("#ff0000")]).to_string();
        for (width, height, scale) in [
            (0, 40, 1.0),
            (4097, 40, 1.0),
            (48, 0, 1.0),
            (48, 40, 0.0),
            (48, 40, f64::NAN),
        ] {
            assert!(render_cpu_snapshot(width, height, &value, scale, 0.0, 0.0).is_err());
        }
        for invalid in [
            "{}",
            "not-json",
            "{\"schema\":\"wrong\",\"schemaVersion\":1,\"objects\":[]}",
        ] {
            assert!(render_cpu_snapshot(48, 40, invalid, 1.0, 0.0, 0.0).is_err());
        }
    }

    fn dashed_line(pattern: Value, offset: f64, cap: &str) -> Value {
        let mut object = rectangle("none");
        object["payload"]["commands"] = json!([["M", 8, 16], ["L", 40, 16]]);
        object["payload"]["stroke"] = json!("#0000ff");
        object["payload"]["strokeWidth"] = json!(4);
        object["payload"]["dashArray"] = pattern;
        object["payload"]["dashOffset"] = json!(offset);
        object["payload"]["vectorStrokeCap"] = json!(cap);
        object
    }

    #[test]
    fn dash_gaps_and_caps_change_actual_pixels_without_affecting_fill() {
        let butt = dashed_line(json!([6, 4]), 0.0, "butt");
        let pixels = render(&scene(vec![butt.clone()]));
        assert_eq!(pixel(&pixels, 10, 16), [0, 0, 255, 255]);
        assert_eq!(pixel(&pixels, 16, 16), [0, 0, 0, 0]);
        assert_eq!(pixel(&pixels, 20, 16), [0, 0, 255, 255]);
        let mut round = butt;
        round["payload"]["vectorStrokeCap"] = json!("round");
        assert!(pixel(&render(&scene(vec![round])), 14, 16)[3] > pixel(&pixels, 14, 16)[3]);
        let mut filled = rectangle("#ff0000");
        filled["payload"]["stroke"] = json!("#0000ff");
        filled["payload"]["strokeWidth"] = json!(2);
        filled["payload"]["dashArray"] = json!([2, 2]);
        assert_eq!(
            pixel(&render(&scene(vec![filled])), 16, 16),
            [255, 0, 0, 255]
        );
    }

    #[test]
    fn odd_dash_patterns_and_negative_offsets_match_their_equivalent_cycles() {
        let odd = dashed_line(json!([4, 2, 1]), 9.0, "butt");
        let doubled = dashed_line(json!([4, 2, 1, 4, 2, 1]), 9.0, "butt");
        assert_eq!(render(&scene(vec![odd])), render(&scene(vec![doubled])));
        let negative = dashed_line(json!([6, 4]), -7.0, "butt");
        let equivalent = dashed_line(json!([6, 4]), 3.0, "butt");
        assert_eq!(
            render(&scene(vec![negative])),
            render(&scene(vec![equivalent]))
        );
    }

    #[test]
    fn dash_phase_resets_for_each_authored_subpath_and_empty_pattern_is_solid() {
        let mut object = dashed_line(json!([6, 4]), 3.0, "butt");
        object["payload"]["commands"] =
            json!([["M", 8, 12], ["L", 40, 12], ["M", 8, 24], ["L", 40, 24]]);
        let pixels = render(&scene(vec![object]));
        for x in 0..48 {
            assert_eq!(pixel(&pixels, x, 12), pixel(&pixels, x, 24));
        }
        let empty = dashed_line(json!([]), 0.0, "butt");
        let mut absent = empty.clone();
        absent["payload"]
            .as_object_mut()
            .unwrap()
            .remove("dashArray");
        assert_eq!(render(&scene(vec![empty])), render(&scene(vec![absent])));
    }

    #[test]
    fn custom_miter_limit_preserves_acute_corner_pixels_and_object_alpha() {
        let mut object = dashed_line(json!([]), 0.0, "butt");
        object["opacity"] = json!(0.5);
        object["payload"]["strokeWidth"] = json!(6);
        object["payload"]["commands"] = json!([["M", 21, 36], ["L", 22, 20], ["L", 23, 36]]);
        object["payload"]["miterLimit"] = json!(32);
        let high = render(&scene(vec![object.clone()]));
        object["payload"]["miterLimit"] = json!(1);
        let low = render(&scene(vec![object]));
        assert!(pixel(&high, 22, 4)[3] > 0);
        assert_eq!(pixel(&low, 22, 4)[3], 0);
        assert!(pixel(&high, 22, 4)[3] <= 128);
    }
}

#[cfg(test)]
mod effect_tests {
    use super::*;
    use serde_json::{Value,json};
    fn path()->Value {json!([["M",0,0],["L",16,0],["L",16,16],["L",0,16],["Z"]])}
    fn list(ops:Vec<Value>)->Value {json!({"schema":"art-equation.display-list","schemaVersion":2,"sceneId":"effects","revision":"1",
        "environment":{"background":"#00000000","colorSpace":"srgb"},"resources":[],"operations":ops})}
    fn render(value:&Value)->Result<Vec<u8>,String>{render_cpu_snapshot(16,16,&value.to_string(),1.0,0.0,0.0)}
    fn pixel(bytes:&[u8],x:usize,y:usize)->[u8;4]{bytes[(y*16+x)*4..(y*16+x)*4+4].try_into().unwrap()}
    fn gradient()->Value {json!({"type":"gradient","id":"gradient","commands":path(),"transform":[1,0,0,1,0,0],"brushTransform":[1,0,0,1,0,0],"fillRule":"nonzero",
        "gradient":{"kind":"linear","start":[0,0],"end":[16,0],"stops":[{"offset":0,"color":"#ff0000"},{"offset":1,"color":"#0000ff00"}],"interpolation":"srgb","alphaInterpolation":"premultiplied"}})}
    fn shadow(std_dev:f64)->Value {json!({"type":"blurredRoundedRect","id":"shadow","rect":{"x":4,"y":4,"width":8,"height":8},"radius":2,"stdDeviation":std_dev,"color":"#ff0000","transform":[1,0,0,1,0,0]})}
    #[test]
    fn linear_gradient_uses_explicit_premultiplied_srgb_and_independent_brush_matrix() {
        let mut op=gradient();let painted=render(&list(vec![op.clone()])).unwrap();
        let left=pixel(&painted,2,8);let right=pixel(&painted,13,8);
        assert_eq!(left[0],255);assert_eq!(right[0],255);assert_eq!(left[2],0);assert!(left[3]>right[3]);assert!(right[3]>0);
        op["brushTransform"]=json!([1,0,0,1,8,0]);
        let translated=render(&list(vec![op])).unwrap();assert_eq!(pixel(&translated,2,8),[255,0,0,255]);
    }
    #[test]
    fn radial_gradient_and_zero_blur_rounding_produce_real_pixels() {
        let mut op=gradient();op["gradient"]=json!({"kind":"radial","center":[8,8],"radius":8,"stops":[{"offset":0,"color":"#ffffff"},{"offset":1,"color":"#000000"}],"interpolation":"srgb","alphaInterpolation":"premultiplied"});
        let painted=render(&list(vec![op])).unwrap();assert!(pixel(&painted,8,8)[0]>pixel(&painted,1,8)[0]);
        let sharp=render(&list(vec![shadow(0.0)])).unwrap();assert_eq!(pixel(&sharp,8,8),[255,0,0,255]);assert_eq!(pixel(&sharp,3,8),[0;4]);assert!(pixel(&sharp,4,4)[3]<128);
    }
    #[test]
    fn analytic_shadow_blur_has_soft_edges_and_bounded_support() {
        let painted=render(&list(vec![shadow(1.0)])).unwrap();
        assert!(pixel(&painted,8,8)[3]>250);assert!(pixel(&painted,3,8)[3]>0);assert!(pixel(&painted,4,8)[3]<250);assert_eq!(pixel(&painted,0,0),[0;4]);
    }
    #[test]
    fn destination_out_scope_preserves_backdrop_and_creates_an_actual_hole() {
        let base=json!({"type":"vector","object":{"id":"base","kind":"vector","transform":[1,0,0,1,0,0],"payload":{"commands":path(),"fill":"#ff0000","strokeWidth":0}}});
        let scope=json!({"type":"pushComposite","scopeId":"knockout","commands":path(),"transform":[1,0,0,1,0,0],"fillRule":"nonzero","isolation":"isolated","opacity":1,"blendMode":"destination-out"});
        let cut=json!({"type":"vector","object":{"id":"cut","kind":"vector","transform":[1,0,0,1,0,0],"payload":{"commands":[["M",4,4],["L",12,4],["L",12,12],["L",4,12],["Z"]],"fill":"#ffffff","strokeWidth":0}}});
        let painted=render(&list(vec![base,scope,cut,json!({"type":"pop","scopeId":"knockout"})])).unwrap();
        assert_eq!(pixel(&painted,2,8),[255,0,0,255]);assert_eq!(pixel(&painted,8,8),[0;4]);
    }
    #[test]
    fn malformed_effects_refuse_before_paint() {
        for (field,value) in [("stdDeviation",json!(-1)),("radius",json!(99)),("color",json!(7)),("transform",json!(null))] {
            let mut op=shadow(1.0);op[field]=value;assert!(render(&list(vec![op])).is_err());
        }
        for (field,value) in [("interpolation",json!("oklab")),("stops",json!([])),("end",json!([0,0])),("start",json!([0]))] {
            let mut op=gradient();op["gradient"][field]=value;assert!(render(&list(vec![op])).is_err());
        }
    }
}
