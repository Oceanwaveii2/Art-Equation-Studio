//! Immutable, epoch-bound decoded pixels. No backend may resolve a missing image
//! as transparent paint. Versions remain alive while visible or being prepared.
use serde_json::{Value, json};
use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use sha2::{Digest, Sha256};
use vello::kurbo::{Affine, Rect};
use vello::peniko::ImageQuality;

pub const MAX_IMAGE_EDGE: u32 = 4096;
pub const MAX_IMAGE_BYTES: usize = 64 * 1024 * 1024;
const MAX_IMAGES: usize = 1024;

#[derive(Clone, Debug, PartialEq, Eq, Hash, serde::Serialize)]
pub struct ImageReference {
    pub key: String,
    pub revision: u64,
    pub epoch: u32,
    pub width: u32,
    pub height: u32,
}

pub struct PreparedImage {
    pub resource: ImageReference,
    pub source: Rect,
    pub transform: Affine,
    pub opacity: f32,
    pub quality: ImageQuality,
}

pub struct DecodedImage {
    pub reference: ImageReference,
    pub pixels: Arc<Vec<u8>>,
}

#[derive(Default)]
pub struct ImageRegistry {
    epoch: Option<u32>,
    entries: HashMap<(String, u64), Arc<DecodedImage>>,
    newest: HashMap<String, (u64, [u8; 32])>,
    visible: HashSet<(String, u64)>,
    pending: HashSet<(String, u64)>,
    candidates: HashSet<(String, u64)>,
    bytes: usize,
    registrations: u64,
    duplicates: u64,
    removals: u64,
    denials: u64,
}

pub fn parse_reference(value: &Value) -> Result<ImageReference, String> {
    let object = value.as_object().ok_or("RESOURCE_INVALID: image reference must be an object")?;
    if object.len() != 5 || object.keys().any(|key| !["key", "revision", "epoch", "width", "height"].contains(&key.as_str())) {
        return Err("RESOURCE_INVALID: image reference fields must be explicit".into());
    }
    let key = value["key"].as_str().filter(|s| !s.is_empty() && s.len() <= 1024)
        .ok_or("RESOURCE_INVALID: bounded image key required")?.to_owned();
    let revision = value["revision"].as_u64().filter(|r| *r > 0 && *r <= 9_007_199_254_740_991)
        .ok_or("RESOURCE_INVALID: positive safe image revision required")?;
    let epoch = value["epoch"].as_u64().filter(|r| *r > 0 && *r <= u32::MAX as u64)
        .ok_or("RESOURCE_INVALID: positive image epoch required")? as u32;
    let width = value["width"].as_u64().filter(|n| *n > 0 && *n <= MAX_IMAGE_EDGE as u64)
        .ok_or("RESOURCE_INVALID: image width must be 1..4096")? as u32;
    let height = value["height"].as_u64().filter(|n| *n > 0 && *n <= MAX_IMAGE_EDGE as u64)
        .ok_or("RESOURCE_INVALID: image height must be 1..4096")? as u32;
    Ok(ImageReference { key, revision, epoch, width, height })
}

impl ImageRegistry {
    pub fn contains(&self, key: &(String, u64)) -> bool { self.entries.contains_key(key) }
    pub fn register(&mut self, reference: ImageReference, pixels: Vec<u8>) -> Result<Value, String> {
        let result = self.register_inner(reference, pixels);
        if result.is_err() { self.denials += 1; }
        result
    }

    fn register_inner(&mut self, reference: ImageReference, pixels: Vec<u8>) -> Result<Value, String> {
        // Public native tests and WASM callers share the exact validation path.
        let reference = parse_reference(&json!({"key":reference.key,"revision":reference.revision,
            "epoch":reference.epoch,"width":reference.width,"height":reference.height}))?;
        let expected = (reference.width as usize).checked_mul(reference.height as usize).and_then(|n| n.checked_mul(4))
            .ok_or("RESOURCE_INVALID: image byte overflow")?;
        if pixels.len() != expected { return Err("RESOURCE_INVALID: exact RGBA8 byte length required".into()); }
        if pixels.chunks_exact(4).any(|p| p[0] > p[3] || p[1] > p[3] || p[2] > p[3]) {
            return Err("RESOURCE_INVALID: canonical sRGB premultiplied RGBA8 required".into());
        }
        if self.epoch.is_some_and(|epoch| epoch != reference.epoch) {
            return Err("RESOURCE_EPOCH_MISMATCH: stale decoded image".into());
        }
        let identity = (reference.key.clone(), reference.revision);
        if let Some(old) = self.entries.get(&identity) {
            if old.reference != reference || old.pixels.as_ref() != &pixels {
                return Err("RESOURCE_REVISION_CONFLICT: immutable revision has different pixels".into());
            }
            self.duplicates += 1;
            return Ok(self.stats());
        }
        let digest: [u8; 32] = Sha256::digest(&pixels).into();
        if self.newest.get(&reference.key).is_some_and(|(revision, _)| *revision > reference.revision) {
            return Err("RESOURCE_STALE_REVISION: old decode cannot replace current pixels".into());
        }
        if self.newest.get(&reference.key).is_some_and(|(revision, hash)| *revision == reference.revision && *hash != digest) {
            return Err("RESOURCE_REVISION_CONFLICT: retired revision has different pixels".into());
        }
        if self.entries.len() >= MAX_IMAGES || self.newest.len() >= MAX_IMAGES && !self.newest.contains_key(&reference.key)
            || self.bytes.checked_add(expected).is_none_or(|n| n > MAX_IMAGE_BYTES) {
            return Err("RESOURCE_BUDGET_EXCEEDED: decoded registry capacity exhausted".into());
        }
        self.epoch = Some(reference.epoch);
        self.bytes += expected;
        self.newest.insert(reference.key.clone(), (reference.revision, digest));
        self.entries.insert(identity, Arc::new(DecodedImage { reference, pixels: Arc::new(pixels) }));
        self.registrations += 1;
        Ok(self.stats())
    }

    pub fn resolve(&self, reference: &ImageReference) -> Result<Arc<DecodedImage>, String> {
        if self.epoch != Some(reference.epoch) { return Err("RESOURCE_EPOCH_MISMATCH: image reference epoch differs".into()); }
        let image = self.entries.get(&(reference.key.clone(), reference.revision))
            .ok_or_else(|| format!("RESOURCE_NOT_READY: {} revision {}", reference.key, reference.revision))?;
        if &image.reference != reference { return Err("RESOURCE_REVISION_CONFLICT: dimensions differ from registered pixels".into()); }
        Ok(image.clone())
    }

    pub fn stage(&mut self, references: &[ImageReference]) -> Result<(), String> {
        for reference in references { self.resolve(reference)?; }
        self.pending = references.iter().map(|r| (r.key.clone(), r.revision)).collect();
        Ok(())
    }
    pub fn present(&mut self) { self.visible = std::mem::take(&mut self.pending); self.prune(); }
    pub fn discard(&mut self) { self.pending.clear(); self.prune(); }
    pub fn retain_candidates(&mut self, references: &[ImageReference]) {
        // Caller-owned decoded resources must survive intervening low-profile
        // presents and discarded generations while a sharper profile is staged.
        // Keep this lease separate from the one-frame pending/visible pins.
        self.candidates = references.iter().map(|r| (r.key.clone(), r.revision)).collect();
        self.prune();
    }
    fn prune(&mut self) {
        let visible = &self.visible; let pending = &self.pending; let candidates = &self.candidates;
        self.entries.retain(|key, image| {
            let keep = visible.contains(key) || pending.contains(key) || candidates.contains(key);
            if !keep { self.bytes -= image.pixels.len(); self.removals += 1; }
            keep
        });
        // Tombstones prevent stale decode resurrection while the key is used.
        self.newest.retain(|key, _| self.entries.keys().any(|(entry, _)| entry == key)
            || visible.iter().any(|(entry, _)| entry == key) || pending.iter().any(|(entry, _)| entry == key)
            || candidates.iter().any(|(entry, _)| entry == key));
    }
    pub fn stats(&self) -> Value {
        let mut references:Vec<_>=self.entries.values().map(|i|i.reference.clone()).collect();
        references.sort_by(|a,b|a.key.cmp(&b.key).then_with(||a.revision.cmp(&b.revision)));
        json!({"epoch":self.epoch,"bytes":self.bytes,"maxBytes":MAX_IMAGE_BYTES,
            "references":references,
            "count":self.entries.len(),"visiblePins":self.visible.len(),"pendingPins":self.pending.len(),
            "candidatePins":self.candidates.len(),
            "registrations":self.registrations,"duplicates":self.duplicates,"removals":self.removals,"denials":self.denials,
            "alphaType":"premultiplied","colorSpace":"srgb"})
    }
}

pub fn parse_references_json(source: &str) -> Result<Vec<ImageReference>, String> {
    if source.len() > 2 * 1024 * 1024 { return Err("RESOURCE_INVALID: reference list exceeds limit".into()); }
    let value: Value = serde_json::from_str(source).map_err(|_| "RESOURCE_INVALID: reference list JSON")?;
    let values = value.as_array().filter(|v|v.len() <= MAX_IMAGES).ok_or("RESOURCE_INVALID: bounded reference array required")?;
    let mut seen=HashSet::new();
    values.iter().map(|v| {
        let reference=parse_reference(v)?;
        if !seen.insert((reference.key.clone(),reference.revision)) { return Err("RESOURCE_INVALID: duplicate image reference".into()); }
        Ok(reference)
    }).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    fn reference(revision: u64) -> ImageReference { ImageReference { key:"test".into(),revision,epoch:7,width:1,height:1 } }
    #[test]
    fn validates_pixels_dimensions_epochs_and_idempotent_revisions() {
        let mut registry=ImageRegistry::default();
        assert!(registry.register(reference(1),vec![1,0,0,0]).is_err());
        assert!(registry.register(reference(1),vec![0;3]).is_err());
        registry.register(reference(1),vec![100,0,0,128]).unwrap();
        registry.register(reference(1),vec![100,0,0,128]).unwrap();
        assert!(registry.register(reference(1),vec![0,0,0,128]).is_err());
        let mut other=reference(2);other.epoch=8;
        assert!(registry.register(other,vec![0;4]).is_err());
        assert_eq!(registry.stats()["bytes"],4);assert_eq!(registry.stats()["duplicates"],1);
    }
    #[test]
    fn visible_versions_survive_candidate_failure_and_new_versions_replace_atomically() {
        let mut registry=ImageRegistry::default();registry.register(reference(1),vec![255;4]).unwrap();
        registry.stage(&[reference(1)]).unwrap();registry.present();
        registry.register(reference(2),vec![0;4]).unwrap();registry.stage(&[reference(2)]).unwrap();
        registry.discard();assert!(registry.resolve(&reference(1)).is_ok());assert!(registry.resolve(&reference(2)).is_err());
        registry.register(reference(3),vec![0;4]).unwrap();registry.stage(&[reference(3)]).unwrap();registry.present();
        assert!(registry.resolve(&reference(1)).is_err());assert!(registry.resolve(&reference(3)).is_ok());
        assert!(registry.register(reference(2),vec![0;4]).is_err());
    }
    #[test]
    fn staged_candidates_survive_unrelated_present_and_discard_until_lease_replaced() {
        let mut registry=ImageRegistry::default();
        registry.register(reference(1),vec![255;4]).unwrap();
        registry.stage(&[reference(1)]).unwrap();registry.present();
        registry.retain_candidates(&[reference(1),reference(2)]);
        registry.register(reference(2),vec![0;4]).unwrap();
        registry.stage(&[reference(1)]).unwrap();registry.present();
        assert!(registry.resolve(&reference(2)).is_ok());
        registry.stage(&[reference(1)]).unwrap();registry.discard();
        assert!(registry.resolve(&reference(2)).is_ok());
        registry.stage(&[reference(2)]).unwrap();registry.present();
        registry.retain_candidates(&[reference(2)]);
        assert!(registry.resolve(&reference(1)).is_err());
        assert!(registry.resolve(&reference(2)).is_ok());
        assert_eq!(registry.stats()["candidatePins"],1);
    }
    #[test]
    fn missing_stale_dimensions_and_oversized_inputs_refuse_before_rendering() {
        let mut registry=ImageRegistry::default();registry.register(reference(1),vec![0;4]).unwrap();
        assert!(registry.stage(&[reference(2)]).is_err());
        let mut wrong=reference(1);wrong.width=2;assert!(registry.resolve(&wrong).is_err());
        wrong.width=4097;assert!(registry.register(wrong,vec![]).is_err());
    }
}
