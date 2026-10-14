//! Native-window adapter for the same validated P0 scene and Vello GPU encoder
//! used by B4SurfaceRenderer. Surface acquisition/presentation remain host-owned.
use std::{collections::HashSet, time::Instant};

use serde::Serialize;
use serde_json::{Map, Value};
use vello::{AaConfig, AaSupport, RenderParams, Renderer, RendererOptions, Scene, kurbo::Affine};

use crate::{gpu_scene, image_atlas, image_resources, prepared_scene};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativePaintReceipt {
    pub parse_prepare_ms: f64,
    pub scene_cache_hit: bool,
    pub encode_cache_hit: bool,
    pub atlas_upload_bytes: u64,
    pub atlas_full_uploads: u64,
    pub atlas_delta_uploads: u64,
    pub atlas_ms: f64,
    pub encode_ms: f64,
    pub vello_submit_ms: f64,
    pub total_ms: f64,
    pub operations: usize,
    pub image_operations: usize,
    pub image_resources: usize,
    pub atlas_uploads: u64,
    pub atlas_pages: usize,
    pub atlas_page_resource_counts: Vec<usize>,
    pub atlas_page_uploads: Vec<u64>,
    pub atlas_page_bytes: Vec<usize>,
    pub atlas_allocated_pages: usize,
    pub atlas_bytes: usize,
    pub atlas_reserved_pages: usize,
    pub atlas_reserved_bytes: usize,
    pub prefetched_resources: usize,
    pub prefetched_bytes: usize,
    pub gpu_allocation_status: &'static str,
    pub gpu_allocation_failure_flags: u32,
    pub gpu_allocation_status_bytes: usize,
    pub gpu_allocation_counts: Value,
}

pub struct NativeGpuRenderer {
    environment: Option<(String,prepared_scene::PreparedScene,Scene)>,
    #[cfg(feature="native-hybrid")]
    hybrid: Option<crate::native_hybrid::RetainedHybrid>,
    #[cfg(feature="native-hybrid")]
    hybrid_revision: u64,
    renderer: Renderer,
    encoded_source: Option<Scene>,
    encoded_atlas_versions: Vec<u64>,
    images: image_resources::ImageRegistry,
    atlases: Vec<image_atlas::GpuImageAtlas>,
    prepared: Option<RetainedPrepared>,
    prefetched: Vec<image_resources::ImageReference>,
    prefetch_generation: Option<(String, String)>,
    prefetched_scene: Option<RetainedPrepared>,
    prefetched_plans: Vec<image_atlas::AtlasPlan>,
    prefetched_atlases: Vec<image_atlas::GpuImageAtlas>,
    prefetched_upload: Option<PartialAtlasUpload>,
}

struct PartialAtlasUpload {
    atlas: image_atlas::GpuImageAtlas,
    pixels: Vec<u8>,
    next_row: u32,
}

struct RetainedPrepared {
    source_json: Option<String>,
    scene: prepared_scene::PreparedScene,
    envelope: Option<Map<String, Value>>,
    operations: Vec<Value>,
    resources: Vec<Value>,
}

enum PreparedChange {
    Vector {
        operation_index: usize,
        slot: usize,
        value: Value,
        paint: prepared_scene::PreparedVector,
    },
    Image {
        operation_index: usize,
        slot: usize,
        value: Value,
        paint: image_resources::PreparedImage,
    },
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeDeltaReceipt {
    pub changed_operations: usize,
    pub prepare_ms: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeProfileStageReceipt {
    pub prepared: bool,
    pub uploaded_pages: usize,
    pub total_pages: usize,
    pub staged_rows: u32,
    pub elapsed_ms: f64,
}

fn operation_identity(operation: &Value) -> Option<&str> {
    if operation["type"] == "vector" {
        operation["object"]["id"].as_str()
    } else {
        operation["id"].as_str()
    }
}

fn checked_camera(
    device: &wgpu::Device,
    width: u32,
    height: u32,
    scale: f64,
    pan_x: f64,
    pan_y: f64,
) -> Result<Affine, String> {
    let input = crate::validate_frame(
        width,
        height,
        device.limits().max_texture_dimension_2d,
        scale,
        pan_x,
        pan_y,
    )?;
    if input.width != width || input.height != height {
        return Err("Native surface exceeds P0 frame dimension limit".into());
    }
    Ok(Affine::translate((pan_x, pan_y)) * Affine::scale(scale))
}

impl RetainedPrepared {
    fn from_source(source: &str, camera: Affine) -> Result<Self, String> {
        let mut snapshot = crate::parse_snapshot(source)?;
        let scene = prepared_scene::prepare_snapshot(&snapshot)?;
        prepared_scene::validate_camera(&scene, camera)?;
        let envelope = snapshot
            .as_object_mut()
            .ok_or("DISPLAY_LIST_INVALID: native snapshot must be an object")?;
        let operations = envelope
            .remove("operations")
            .and_then(|value| value.as_array().cloned())
            .ok_or("DISPLAY_LIST_INVALID: retained scene needs ordered operations")?;
        let resources = envelope
            .remove("resources")
            .and_then(|value| value.as_array().cloned())
            .ok_or("DISPLAY_LIST_INVALID: retained scene needs resource declarations")?;
        if operations.len() != scene.operations.len() {
            return Err("DISPLAY_LIST_INVALID: retained operation count changed".into());
        }
        Ok(Self {
            source_json: Some(source.to_owned()),
            scene,
            envelope: Some(envelope.clone()),
            operations,
            resources,
        })
    }

    fn apply_delta(
        &mut self,
        operations: &[Value],
        resources: &[Value],
        changed_indices: &[usize],
        camera: Affine,
    ) -> Result<NativeDeltaReceipt, String> {
        let started = Instant::now();
        let envelope = self
            .envelope
            .as_ref()
            .ok_or("SCENE_UNSUPPORTED: retained delta requires display-list v2")?;
        if resources != self.resources || operations.len() != self.operations.len() {
            return Err("SCENE_DELTA_REJECTED: resource or operation membership changed".into());
        }
        let supplied: HashSet<usize> = changed_indices.iter().copied().collect();
        if supplied.len() != changed_indices.len()
            || supplied.iter().any(|index| *index >= operations.len())
        {
            return Err("SCENE_DELTA_REJECTED: invalid changed-operation indices".into());
        }
        let actual = self
            .operations
            .iter()
            .zip(operations)
            .enumerate()
            .filter_map(|(index, (old, new))| (old != new).then_some(index))
            .collect::<HashSet<_>>();
        if !actual.is_subset(&supplied) {
            return Err(format!(
                "SCENE_DELTA_REJECTED: changed-operation indices omit paint (actual {}, supplied {}, first missing {:?})",
                actual.len(),
                supplied.len(),
                actual.difference(&supplied).next(),
            ));
        }
        let mut replacements = Vec::with_capacity(actual.len());
        for &index in changed_indices
            .iter()
            .filter(|index| actual.contains(index))
        {
            let old = &self.operations[index];
            let new = &operations[index];
            if old["type"] != new["type"] || operation_identity(old) != operation_identity(new) {
                return Err("SCENE_DELTA_REJECTED: operation identity/type changed".into());
            }
            let resource = match new["type"].as_str() {
                Some("vector") => Vec::new(),
                Some("image") => vec![new["resource"].clone()],
                _ => return Err("SCENE_DELTA_REJECTED: structural paint needs a full scene".into()),
            };
            let mut one = envelope.clone();
            one.insert("operations".into(), Value::Array(vec![new.clone()]));
            one.insert("resources".into(), Value::Array(resource));
            let prepared = prepared_scene::prepare_snapshot(&Value::Object(one))?;
            prepared_scene::validate_camera(&prepared, camera)?;
            match self.scene.operations[index] {
                prepared_scene::PreparedOp::Vector(slot) if prepared.vectors.len() == 1 => {
                    replacements.push(PreparedChange::Vector {
                        operation_index: index,
                        slot,
                        value: new.clone(),
                        paint: prepared.vectors.into_iter().next().unwrap(),
                    });
                }
                prepared_scene::PreparedOp::Image(slot) if prepared.images.len() == 1 => {
                    replacements.push(PreparedChange::Image {
                        operation_index: index,
                        slot,
                        value: new.clone(),
                        paint: prepared.images.into_iter().next().unwrap(),
                    });
                }
                _ => return Err("SCENE_DELTA_REJECTED: prepared paint slot changed".into()),
            }
        }
        // Validation above is atomic: one invalid connector cannot partially
        // replace a card or an earlier edge in the retained ordered scene.
        for replacement in replacements {
            match replacement {
                PreparedChange::Vector {
                    operation_index,
                    slot,
                    value,
                    paint,
                } => {
                    self.scene.vectors[slot] = paint;
                    self.operations[operation_index] = value;
                }
                PreparedChange::Image {
                    operation_index,
                    slot,
                    value,
                    paint,
                } => {
                    self.scene.images[slot] = paint;
                    self.operations[operation_index] = value;
                }
            }
        }
        self.source_json = None;
        Ok(NativeDeltaReceipt {
            changed_operations: actual.len(),
            prepare_ms: started.elapsed().as_secs_f64() * 1000.0,
        })
    }
}

impl NativeGpuRenderer {
    pub fn new(device: &wgpu::Device) -> Result<Self, String> {
        let renderer = Renderer::new(
            device,
            RendererOptions {
                use_cpu: false,
                antialiasing_support: AaSupport::area_only(),
                num_init_threads: None,
                pipeline_cache: None,
            },
        )
        .map_err(|error| format!("Vello pipeline setup failed: {error}"))?;
        Ok(Self {
            renderer,
            environment: None,
            #[cfg(feature="native-hybrid")]
            hybrid: None,
            #[cfg(feature="native-hybrid")]
            hybrid_revision: 0,
            images: image_resources::ImageRegistry::default(),
            encoded_source: None,
            encoded_atlas_versions: Vec::new(),
            atlases: Vec::new(),
            prepared: None,
            prefetched: Vec::new(),
            prefetch_generation: None,
            prefetched_scene: None,
            prefetched_plans: Vec::new(),
            prefetched_atlases: Vec::new(),
            prefetched_upload: None,
        })
    }

    pub fn register_image(&mut self, reference_json: &str, pixels: Vec<u8>) -> Result<(), String> {
        let value: serde_json::Value = serde_json::from_str(reference_json)
            .map_err(|error| format!("RESOURCE_INVALID: image JSON: {error}"))?;
        let reference = image_resources::parse_reference(&value)?;
        self.images.register(reference, pixels)?;
        Ok(())
    }
    /// Small camera-dependent grid/background paint; the retained card scene
    /// stays untouched. Both are presented together to avoid a second surface.
    pub fn set_environment(&mut self,snapshot:&str)->Result<(),String>{
        if self.environment.as_ref().is_some_and(|(source,_,_)|source==snapshot){return Ok(())}
        if snapshot.len()>256*1024{return Err("Environment snapshot exceeds bounded size".into())}
        let value:Value=serde_json::from_str(snapshot).map_err(|e|e.to_string())?;
        let prepared=prepared_scene::prepare_snapshot(&value)?;
        if !prepared.images.is_empty(){return Err("Environment cannot own image resources".into())}
        let encoded=gpu_scene::encode_prepared_with_images(&prepared,None)?;
        self.environment=Some((snapshot.to_owned(),prepared,encoded));
        #[cfg(feature="native-hybrid")]
        {self.hybrid_revision=self.hybrid_revision.wrapping_add(1);}
        Ok(())
    }

    /// The host can stage only the resources needed by the next visible
    /// viewport. Entries may be pruned after a successful frame, so query
    /// immediately before admitting a profile's decoded pixels.
    pub fn has_image(&self, key: &str, revision: u64) -> bool {
        self.images.contains(&(key.to_owned(), revision))
    }

    /// Pin already admitted, verified profile pixels across frames while a
    /// higher-resolution native profile is staged. The normal registry budget
    /// and exact reference validation still apply at registration.
    pub fn set_prefetched_references(&mut self, values: &[Value]) -> Result<(), String> {
        if values.len() > 1024 {
            return Err("RESOURCE_BUDGET_EXCEEDED: too many prefetched references".into());
        }
        let prepared = self
            .prepared
            .as_ref()
            .ok_or("SCENE_NOT_READY: prefetch needs a base scene")?;
        let envelope = prepared
            .envelope
            .as_ref()
            .ok_or("SCENE_UNSUPPORTED: native prefetch needs display-list v2")?;
        let generation = (
            envelope
                .get("sceneId")
                .and_then(Value::as_str)
                .ok_or("DISPLAY_LIST_INVALID: sceneId absent")?
                .to_owned(),
            envelope
                .get("revision")
                .and_then(Value::as_str)
                .ok_or("DISPLAY_LIST_INVALID: revision absent")?
                .to_owned(),
        );
        let mut identities = HashSet::with_capacity(values.len());
        let mut references = Vec::with_capacity(values.len());
        for value in values {
            let reference = image_resources::parse_reference(value)?;
            if !identities.insert((reference.key.clone(), reference.revision)) {
                return Err("RESOURCE_INVALID: duplicate prefetched reference".into());
            }
            self.images.resolve(&reference)?;
            references.push(reference);
        }
        self.prefetched = references;
        self.prefetch_generation = Some(generation);
        Ok(())
    }

    /// Prepare one upcoming profile stage per idle call. The first call
    /// validates/compiles the scene and packs the complete resource set;
    /// later calls upload at most one 2048² page each. Until every page is
    /// ready, normal rendering keeps the previous complete profile.
    #[allow(clippy::too_many_arguments)]
    pub fn stage_next_profile_page(
        &mut self,
        device: &wgpu::Device,
        queue: &wgpu::Queue,
        snapshot_json: &str,
        width: u32,
        height: u32,
        scale: f64,
        pan_x: f64,
        pan_y: f64,
    ) -> Result<NativeProfileStageReceipt, String> {
        let started = Instant::now();
        let camera = checked_camera(device, width, height, scale, pan_x, pan_y)?;
        if self
            .prefetched_scene
            .as_ref()
            .is_none_or(|scene| scene.source_json.as_deref() != Some(snapshot_json))
        {
            let next = RetainedPrepared::from_source(snapshot_json, camera)?;
            let decoded = next
                .scene
                .resources
                .iter()
                .map(|reference| self.images.resolve(reference))
                .collect::<Result<Vec<_>, _>>()?;
            let plans = image_atlas::pack_native_pages(decoded)?;
            if self.atlases.len() + plans.len() > image_atlas::MAX_NATIVE_ATLAS_PAGES {
                return Err("GPU_IMAGE_ATLAS_FULL: active plus prefetched profile exceeds native page budget".into());
            }
            self.prefetched_atlases.clear();
            self.prefetched_upload = None;
            self.prefetched_scene = Some(next);
            self.prefetched_plans = plans;
            return Ok(NativeProfileStageReceipt {
                prepared: true,
                uploaded_pages: 0,
                total_pages: self.prefetched_plans.len(),
                staged_rows: 0,
                elapsed_ms: started.elapsed().as_secs_f64() * 1000.0,
            });
        }
        let page_index = self.prefetched_atlases.len();
        if self.prefetched_upload.is_none() {
            if let Some(plan) = self.prefetched_plans.get(page_index) {
                let atlas = image_atlas::GpuImageAtlas::new_native_page(
                    device,
                    &mut self.renderer,
                    image_atlas::MAX_NATIVE_ATLAS_PAGES - self.prefetched_plans.len() + page_index,
                )?;
                self.prefetched_upload = Some(PartialAtlasUpload {
                    atlas,
                    pixels: plan.pixels(),
                    next_row: 0,
                });
            }
        } else if let Some(upload) = self.prefetched_upload.as_mut() {
            let rows = (image_atlas::ATLAS_EDGE - upload.next_row).min(256);
            upload
                .atlas
                .upload_rows(queue, &upload.pixels, upload.next_row, rows)?;
            upload.next_row += rows;
            if upload.next_row == image_atlas::ATLAS_EDGE {
                let mut complete = self.prefetched_upload.take().expect("staged upload exists");
                complete
                    .atlas
                    .finish_staged(&self.prefetched_plans[page_index], &mut self.renderer);
                self.prefetched_atlases.push(complete.atlas);
            }
        }
        Ok(NativeProfileStageReceipt {
            prepared: true,
            uploaded_pages: self.prefetched_atlases.len(),
            total_pages: self.prefetched_plans.len(),
            staged_rows: self
                .prefetched_upload
                .as_ref()
                .map_or(0, |upload| upload.next_row),
            elapsed_ms: started.elapsed().as_secs_f64() * 1000.0,
        })
    }

    pub fn render_to_texture(
        &mut self,
        device: &wgpu::Device,
        queue: &wgpu::Queue,
        target: &wgpu::TextureView,
        width: u32,
        height: u32,
        snapshot_json: &str,
        scale: f64,
        pan_x: f64,
        pan_y: f64,
    ) -> Result<NativePaintReceipt, String> {
        let start = Instant::now();
        let camera = checked_camera(device, width, height, scale, pan_x, pan_y)?;
        let prefetched_complete = !self.prefetched_plans.is_empty()
            && self.prefetched_atlases.len() == self.prefetched_plans.len();
        let prefetched_match = self
            .prefetched_scene
            .as_ref()
            .is_some_and(|scene| scene.source_json.as_deref() == Some(snapshot_json));
        if prefetched_match && (prefetched_complete || self.prefetched_plans.is_empty()) {
            #[cfg(feature="native-hybrid")]
            { self.hybrid_revision = self.hybrid_revision.wrapping_add(1); }
            self.encoded_source = None;
            std::mem::swap(&mut self.prepared, &mut self.prefetched_scene);
            std::mem::swap(&mut self.atlases, &mut self.prefetched_atlases);
            self.prefetched_plans.clear();
        }
        let scene_cache_hit = self
            .prepared
            .as_ref()
            .is_some_and(|prepared| prepared.source_json.as_deref() == Some(snapshot_json));
        if !scene_cache_hit {
            #[cfg(feature="native-hybrid")]
            { self.hybrid_revision = self.hybrid_revision.wrapping_add(1); }
            // Parse and validate the replacement before replacing the last
            // complete scene. A rejected edit must not poison later camera
            // redraws of the previously accepted snapshot.
            let next = RetainedPrepared::from_source(snapshot_json, camera)?;
            if self
                .prefetch_generation
                .as_ref()
                .is_some_and(|(scene_id, revision)| {
                    next.envelope.as_ref().is_none_or(|envelope| {
                        envelope.get("sceneId").and_then(Value::as_str) != Some(scene_id)
                            || envelope.get("revision").and_then(Value::as_str) != Some(revision)
                    })
                })
            {
                self.prefetched.clear();
                self.prefetch_generation = None;
            }
            self.encoded_source = None;
            self.prepared = Some(next);
            self.prefetched_scene = None;
            self.prefetched_plans.clear();
            self.prefetched_atlases.clear();
            self.prefetched_upload = None;
        }
        prepared_scene::validate_camera(
            &self.prepared.as_ref().expect("scene was prepared").scene,
            camera,
        )?;
        self.paint_prepared_to_texture(
            device,
            queue,
            target,
            width,
            height,
            camera,
            start,
            scene_cache_hit,
        )
    }

    /// Apply a bounded edit to the already validated ordered paint list. The
    /// caller retains the authoritative scene model and supplies its exact
    /// changed indices; undeclared changes and structural edits are rejected.
    pub fn apply_operation_delta(
        &mut self,
        device: &wgpu::Device,
        width: u32,
        height: u32,
        operations: &[Value],
        resources: &[Value],
        changed_indices: &[usize],
        scale: f64,
        pan_x: f64,
        pan_y: f64,
    ) -> Result<NativeDeltaReceipt, String> {
        let camera = checked_camera(device, width, height, scale, pan_x, pan_y)?;
        let receipt = self
            .prepared
            .as_mut()
            .ok_or("SCENE_DELTA_REJECTED: no validated base scene")?
            .apply_delta(operations, resources, changed_indices, camera)?;
        if receipt.changed_operations > 0 {
            #[cfg(feature="native-hybrid")]
            { self.hybrid_revision = self.hybrid_revision.wrapping_add(1); }
            self.encoded_source = None;
            // A warmed sibling profile has the prior card/edge geometry.
            // It must be rebuilt from the updated model before any switch.
            self.prefetched_scene = None;
            self.prefetched_plans.clear();
            self.prefetched_atlases.clear();
            self.prefetched_upload = None;
        }
        Ok(receipt)
    }

    /// Draw the last retained scene after an accepted delta or camera update.
    #[cfg(feature="native-hybrid")]
    pub fn warm_hybrid(&mut self,device:&wgpu::Device,width:u32,height:u32) {
        self.hybrid.get_or_insert_with(||crate::native_hybrid::RetainedHybrid::new(device,width,height));
    }

    #[cfg(feature="native-hybrid")]
    pub fn render_retained_hybrid_to_texture(&mut self, device:&wgpu::Device,queue:&wgpu::Queue,
        target:&wgpu::TextureView,width:u32,height:u32,scale:f64,pan_x:f64,pan_y:f64)->Result<Value,String>{
        let camera=checked_camera(device,width,height,scale,pan_x,pan_y)?;
        let prepared=&self.prepared.as_ref().ok_or("SCENE_NOT_READY: no native retained scene")?.scene;
        prepared_scene::validate_camera(prepared,camera)?;
        let hybrid=self.hybrid.get_or_insert_with(||crate::native_hybrid::RetainedHybrid::new(device,width,height));
        hybrid.render(device,queue,target,prepared,self.environment.as_ref().map(|(_,p,_)|p),&self.atlases,self.hybrid_revision,width,height,camera)
    }

    /// Draw the last retained scene after an accepted delta or camera update.
    pub fn render_retained_to_texture(
        &mut self,
        device: &wgpu::Device,
        queue: &wgpu::Queue,
        target: &wgpu::TextureView,
        width: u32,
        height: u32,
        scale: f64,
        pan_x: f64,
        pan_y: f64,
    ) -> Result<NativePaintReceipt, String> {
        let start = Instant::now();
        let camera = checked_camera(device, width, height, scale, pan_x, pan_y)?;
        prepared_scene::validate_camera(
            &self
                .prepared
                .as_ref()
                .ok_or("SCENE_NOT_READY: retained paint is empty")?
                .scene,
            camera,
        )?;
        self.paint_prepared_to_texture(device, queue, target, width, height, camera, start, true)
    }

    #[allow(clippy::too_many_arguments)]
    fn paint_prepared_to_texture(
        &mut self,
        device: &wgpu::Device,
        queue: &wgpu::Queue,
        target: &wgpu::TextureView,
        width: u32,
        height: u32,
        camera: Affine,
        start: Instant,
        scene_cache_hit: bool,
    ) -> Result<NativePaintReceipt, String> {
        let prepared = &self.prepared.as_ref().expect("scene was prepared").scene;
        let prepared_at = Instant::now();

        let attempt = (|| {
            let decoded = prepared
                .resources
                .iter()
                .map(|reference| self.images.resolve(reference))
                .collect::<Result<Vec<_>, _>>()?;
            let plans = image_atlas::pack_native_pages(decoded)?;
            let mut staged = prepared.resources.clone();
            staged.extend(
                self.prefetched
                    .iter()
                    .filter(|reference| !prepared.resources.contains(reference))
                    .cloned(),
            );
            self.images.stage(&staged)?;
            while self.atlases.len() < plans.len() {
                let page_index = self.atlases.len();
                self.atlases
                    .push(image_atlas::GpuImageAtlas::new_native_page(
                        device,
                        &mut self.renderer,
                        page_index,
                    )?);
            }
            for (atlas, plan) in self.atlases.iter_mut().zip(&plans) {
                atlas.update(plan, queue, &mut self.renderer);
            }
            let atlas_at = Instant::now();
            let pages = self
                .atlases
                .iter()
                .zip(&plans)
                .map(|(atlas, plan)| (&atlas.image, plan))
                .collect::<Vec<_>>();
            // Camera updates reuse validated local-space encoding. Atlas uploads
            // may alter image placement, so their exact versions revoke it.
            let atlas_versions = self.atlases.iter().take(plans.len()).map(|atlas| atlas.uploads).collect::<Vec<_>>();
            let encode_cache_hit = self.encoded_source.is_some() && atlas_versions == self.encoded_atlas_versions;
            if !encode_cache_hit {
                let source = gpu_scene::encode_prepared_with_image_pages(&prepared, &pages)?;
                self.encoded_source = Some(source);
                self.encoded_atlas_versions = atlas_versions;
            }
            let mut scene = Scene::new();
            if let Some((_,_,environment))=&self.environment{scene.append(environment,Some(camera));}
            scene.append(self.encoded_source.as_ref().expect("source encoded"), Some(camera));
            let encoded_at = Instant::now();
            let allocation = self.renderer
                .render_to_texture_checked_sync(
                    device,
                    queue,
                    &scene,
                    target,
                    &RenderParams {
                        base_color: self.environment.as_ref().map(|(_,environment,_)|environment.background).unwrap_or(prepared.background),
                        width,
                        height,
                        antialiasing_method: AaConfig::Area,
                    },
                )
                .map_err(|error| format!("Vello render failed: {error}"))?;
            let submitted_at = Instant::now();
            Ok(NativePaintReceipt {
                parse_prepare_ms: (prepared_at - start).as_secs_f64() * 1000.0,
                scene_cache_hit,
                encode_cache_hit,
                atlas_upload_bytes: self.atlases.iter().map(|atlas| atlas.upload_bytes).sum(),
                atlas_full_uploads: self.atlases.iter().map(|atlas| atlas.full_uploads).sum(),
                atlas_delta_uploads: self.atlases.iter().map(|atlas| atlas.delta_uploads).sum(),
                atlas_ms: (atlas_at - prepared_at).as_secs_f64() * 1000.0,
                encode_ms: (encoded_at - atlas_at).as_secs_f64() * 1000.0,
                vello_submit_ms: (submitted_at - encoded_at).as_secs_f64() * 1000.0,
                total_ms: (submitted_at - start).as_secs_f64() * 1000.0,
                operations: prepared.operations.len(),
                image_operations: prepared.images.len(),
                image_resources: prepared.resources.len(),
                atlas_uploads: self.atlases.iter().map(|atlas| atlas.uploads).sum(),
                atlas_pages: plans.len(),
                atlas_page_resource_counts: plans.iter().map(|plan| plan.images.len()).collect(),
                atlas_page_uploads: self.atlases.iter().map(|atlas| atlas.uploads).collect(),
                atlas_page_bytes: self
                    .atlases
                    .iter()
                    .map(|_| image_atlas::ATLAS_BYTES)
                    .collect(),
                atlas_allocated_pages: self.atlases.len(),
                atlas_bytes: self.atlases.len() * image_atlas::ATLAS_BYTES,
                atlas_reserved_pages: self.atlases.len()
                    + self.prefetched_atlases.len()
                    + usize::from(self.prefetched_upload.is_some()),
                atlas_reserved_bytes: (self.atlases.len()
                    + self.prefetched_atlases.len()
                    + usize::from(self.prefetched_upload.is_some()))
                    * image_atlas::ATLAS_BYTES,
                prefetched_resources: self.prefetched.len(),
                prefetched_bytes: self
                    .prefetched
                    .iter()
                    .map(|reference| reference.width as usize * reference.height as usize * 4)
                    .sum(),
                gpu_allocation_status: "checked",
                gpu_allocation_failure_flags: allocation.failed,
                gpu_allocation_status_bytes: 32,
                gpu_allocation_counts: serde_json::json!({
                    "failed": allocation.failed, "binning": allocation.binning,
                    "ptcl": allocation.ptcl, "tile": allocation.tile,
                    "segCounts": allocation.seg_counts, "segments": allocation.segments,
                    "blend": allocation.blend, "lines": allocation.lines,
                }),
            })
        })();
        if attempt.is_ok() {
            self.images.present();
        } else {
            self.images.discard();
        }
        attempt
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn retained_vector_delta_updates_only_its_slot_and_rejects_omissions_atomically() {
        let source = json!({
            "schema":"art-equation.display-list", "schemaVersion":2,
            "sceneId":"delta-test", "revision":"1",
            "environment":{"background":"#00000000","colorSpace":"srgb"},
            "resources":[],
            "operations":[
                {"type":"vector","object":{"id":"card","kind":"vector","order":0,
                    "transform":[1,0,0,1,0,0],"payload":{"commands":[["M",0,0],["L",8,0],["L",8,8],["Z"]],"fill":"#ff0000","strokeWidth":0}}},
                {"type":"vector","object":{"id":"edge","kind":"vector","order":1,
                    "transform":[1,0,0,1,0,0],"payload":{"commands":[["M",8,8],["L",16,16]],"fill":"#00000000","stroke":"#ffffff","strokeWidth":1}}}
            ]
        });
        let mut retained =
            RetainedPrepared::from_source(&source.to_string(), Affine::IDENTITY).unwrap();
        let old_edge = retained.operations[1].clone();
        let mut changed = retained.operations.clone();
        changed[0]["object"]["transform"] = json!([1, 0, 0, 1, 3, 4]);
        assert!(
            retained
                .apply_delta(&changed, &[], &[], Affine::IDENTITY)
                .is_err()
        );
        assert_eq!(retained.operations[0], source["operations"][0]);
        let receipt = retained
            .apply_delta(&changed, &[], &[0], Affine::IDENTITY)
            .unwrap();
        assert_eq!(receipt.changed_operations, 1);
        assert_eq!(retained.scene.vectors.len(), 2);
        assert_eq!(
            retained.scene.vectors[0].transform.as_coeffs()[4..],
            [3.0, 4.0]
        );
        assert_eq!(retained.operations[1], old_edge);
        assert!(retained.source_json.is_none());
        let mut malformed = changed.clone();
        malformed[1]["object"]["payload"]["commands"] = json!([["L", 0, 0]]);
        assert!(
            retained
                .apply_delta(&malformed, &[], &[1], Affine::IDENTITY)
                .is_err()
        );
        assert_eq!(retained.operations[1], old_edge);
    }
}
