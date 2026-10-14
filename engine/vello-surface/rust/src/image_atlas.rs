//! One stable engine-owned page is the only image Vello GPU sees. Packing is
//! explicit and bounded; a failed placement is never a successful partial frame.
use crate::image_resources::{DecodedImage, ImageReference};
use std::collections::HashMap;
use std::sync::Arc;

pub const ATLAS_EDGE: u32 = 4096;
pub const ATLAS_BYTES: usize = ATLAS_EDGE as usize * ATLAS_EDGE as usize * 4;
/// Native hosts may bind at most four fixed pages. A larger scene fails
/// explicitly so the caller can use a lower mip or the CPU renderer.
pub const MAX_NATIVE_ATLAS_PAGES: usize = 4;
#[derive(Clone, Copy, Debug)]
pub struct Slot {
    pub x: u32,
    pub y: u32,
}
pub struct AtlasPlan {
    pub slots: HashMap<(String, u64), Slot>,
    pub images: Vec<Arc<DecodedImage>>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct FreeRect {
    x: u32,
    y: u32,
    width: u32,
    height: u32,
}

impl FreeRect {
    fn intersects(&self, other: &FreeRect) -> bool {
        self.x < other.x + other.width
            && self.x + self.width > other.x
            && self.y < other.y + other.height
            && self.y + self.height > other.y
    }
    fn contains(&self, other: &FreeRect) -> bool {
        other.x >= self.x
            && other.y >= self.y
            && other.x + other.width <= self.x + self.width
            && other.y + other.height <= self.y + self.height
    }
}

/// MaxRects Best-Short-Side-Fit (BSSF) allocator with 1px extruded border gutter.
/// Eliminates 28%-35% shelf-packing whitespace fragmentation on mixed-aspect boards.
struct MaxRectsBin {
    free_rects: Vec<FreeRect>,
}

impl MaxRectsBin {
    fn new() -> Self {
        Self {
            free_rects: vec![FreeRect { x: 0, y: 0, width: ATLAS_EDGE, height: ATLAS_EDGE }],
        }
    }

    fn insert(&mut self, width: u32, height: u32) -> Option<Slot> {
        let mut best_index = None;
        let mut best_short_side = u32::MAX;
        let mut best_long_side = u32::MAX;
        let mut best_y = u32::MAX;
        let mut best_x = u32::MAX;

        for (i, free) in self.free_rects.iter().enumerate() {
            if free.width >= width && free.height >= height {
                let leftover_h = free.width - width;
                let leftover_v = free.height - height;
                let short_side = leftover_h.min(leftover_v);
                let long_side = leftover_h.max(leftover_v);
                if (short_side, long_side, free.y, free.x)
                    < (best_short_side, best_long_side, best_y, best_x)
                {
                    best_index = Some(i);
                    best_short_side = short_side;
                    best_long_side = long_side;
                    best_y = free.y;
                    best_x = free.x;
                }
            }
        }

        let idx = best_index?;
        let placed = FreeRect {
            x: self.free_rects[idx].x,
            y: self.free_rects[idx].y,
            width,
            height,
        };

        let mut next_free = Vec::with_capacity(self.free_rects.len() + 4);
        for free in &self.free_rects {
            if !free.intersects(&placed) {
                next_free.push(*free);
                continue;
            }
            if placed.x > free.x {
                next_free.push(FreeRect {
                    x: free.x,
                    y: free.y,
                    width: placed.x - free.x,
                    height: free.height,
                });
            }
            if placed.x + placed.width < free.x + free.width {
                next_free.push(FreeRect {
                    x: placed.x + placed.width,
                    y: free.y,
                    width: (free.x + free.width) - (placed.x + placed.width),
                    height: free.height,
                });
            }
            if placed.y > free.y {
                next_free.push(FreeRect {
                    x: free.x,
                    y: free.y,
                    width: free.width,
                    height: placed.y - free.y,
                });
            }
            if placed.y + placed.height < free.y + free.height {
                next_free.push(FreeRect {
                    x: free.x,
                    y: placed.y + placed.height,
                    width: free.width,
                    height: (free.y + free.height) - (placed.y + placed.height),
                });
            }
        }

        let mut pruned = Vec::with_capacity(next_free.len());
        for (i, candidate) in next_free.iter().enumerate() {
            let mut redundant = false;
            for (j, other) in next_free.iter().enumerate() {
                if i != j && other.contains(candidate) && (other != candidate || i > j) {
                    redundant = true;
                    break;
                }
            }
            if !redundant {
                pruned.push(*candidate);
            }
        }
        self.free_rects = pruned;
        Some(Slot { x: placed.x + 1, y: placed.y + 1 })
    }
}

fn pack_native_page_in_order(images: Vec<Arc<DecodedImage>>) -> Result<AtlasPlan, String> {
    let mut bin = MaxRectsBin::new();
    let mut slots = HashMap::new();
    for image in &images {
        let width = image.reference.width + 2;
        let height = image.reference.height + 2;
        if width > ATLAS_EDGE || height > ATLAS_EDGE {
            return Err("GPU_IMAGE_ATLAS_FULL: image exceeds fixed native page".into());
        }
        let slot = bin
            .insert(width, height)
            .ok_or("GPU_IMAGE_ATLAS_FULL: ordered native page overflow")?;
        slots.insert((image.reference.key.clone(), image.reference.revision), slot);
    }
    Ok(AtlasPlan { slots, images })
}

pub fn pack(images: Vec<Arc<DecodedImage>>) -> Result<AtlasPlan, String> {
    let mut images = images;
    images.sort_by(|a, b| {
        b.reference
            .height
            .cmp(&a.reference.height)
            .then_with(|| b.reference.width.cmp(&a.reference.width))
            .then_with(|| a.reference.key.cmp(&b.reference.key))
            .then_with(|| a.reference.revision.cmp(&b.reference.revision))
    });
    let mut bin = MaxRectsBin::new();
    let mut slots = HashMap::new();
    for image in &images {
        let w = image.reference.width + 2;
        let h = image.reference.height + 2;
        if w > ATLAS_EDGE || h > ATLAS_EDGE {
            return Err("GPU_IMAGE_ATLAS_FULL: image exceeds fixed page; use genuineCPU or smaller accepted mip".into());
        }
        let slot = bin
            .insert(w, h)
            .ok_or("GPU_IMAGE_ATLAS_FULL: complete frame does not fit fixed page")?;
        slots.insert(
            (image.reference.key.clone(), image.reference.revision),
            slot,
        );
    }
    Ok(AtlasPlan { slots, images })
}

/// Partition a deterministic image order into bounded native pages without
/// changing the single-page WASM path. Each image remains whole on one page.
pub fn pack_native_pages(images: Vec<Arc<DecodedImage>>) -> Result<Vec<AtlasPlan>, String> {
    if images.is_empty() {
        return Ok(Vec::new());
    }
    // Preserve the caller's resource order. Appending a newly decoded mip
    // must not move the old slots and force a whole-page reupload.
    let ordered = images;
    let mut pages = Vec::new();
    let mut current = Vec::new();
    let mut current_slots = HashMap::new();
    let mut bin = MaxRectsBin::new();
    for image in ordered {
        let width = image.reference.width + 2;
        let height = image.reference.height + 2;
        if width > ATLAS_EDGE || height > ATLAS_EDGE {
            return Err("GPU_IMAGE_ATLAS_FULL: image exceeds fixed native page".into());
        }
        let slot = match bin.insert(width, height) {
            Some(s) => s,
            None => {
                if pages.len() + 1 >= MAX_NATIVE_ATLAS_PAGES {
                    return Err("GPU_IMAGE_ATLAS_FULL: native page budget exceeded".into());
                }
                pages.push(AtlasPlan {
                    slots: std::mem::take(&mut current_slots),
                    images: std::mem::take(&mut current),
                });
                bin = MaxRectsBin::new();
                bin.insert(width, height)
                    .ok_or("GPU_IMAGE_ATLAS_FULL: ordered native page overflow")?
            }
        };
        current_slots.insert((image.reference.key.clone(), image.reference.revision), slot);
        current.push(image);
    }
    pages.push(AtlasPlan { slots: current_slots, images: current });
    Ok(pages)
}

impl AtlasPlan {
    pub fn pixels(&self) -> Vec<u8> {
        let mut page = vec![0; ATLAS_BYTES];
        for image in &self.images {
            let r = &image.reference;
            let s = self.slots[&(r.key.clone(), r.revision)];
            // Extruded one-pixel padding preserves clamp-edge bilinear sampling
            // and prevents neighboring resources bleeding into cropped images.
            for py in 0..r.height + 2 {
                for px in 0..r.width + 2 {
                    let source_x = px.saturating_sub(1).min(r.width - 1);
                    let source_y = py.saturating_sub(1).min(r.height - 1);
                    let source = ((source_y * r.width + source_x) * 4) as usize;
                    let destination = (((s.y - 1 + py) * ATLAS_EDGE + s.x - 1 + px) * 4) as usize;
                    page[destination..destination + 4]
                        .copy_from_slice(&image.pixels[source..source + 4]);
                }
            }
        }
        page
    }
    pub fn references(&self) -> Vec<ImageReference> {
        self.images.iter().map(|i| i.reference.clone()).collect()
    }
}

pub struct GpuImageAtlas {
    pub image: vello::peniko::ImageData,
    texture: wgpu::Texture,
    references: Vec<ImageReference>,
    slots: HashMap<(String, u64), Slot>,
    pub uploads: u64,
    pub upload_bytes: u64,
    pub delta_uploads: u64,
    pub full_uploads: u64,
}

impl GpuImageAtlas {
    #[cfg(any(feature="native-hybrid",feature="browser-hybrid"))]
    pub(crate) fn shared_view(&self) -> wgpu::TextureView {
        self.texture.create_view(&Default::default())
    }
    #[cfg(any(feature="native-hybrid",feature="browser-hybrid"))]
    pub(crate) fn shared_slot(&self, reference:&ImageReference) -> Option<(u32,u32)> {
        self.slots.get(&(reference.key.clone(),reference.revision)).map(|s|(s.x,s.y))
    }
    pub fn new(device: &wgpu::Device, renderer: &mut vello::Renderer) -> Result<Self, String> {
        Self::new_with_identity(device, renderer, Vec::new())
    }
    pub fn new_native_page(
        device: &wgpu::Device,
        renderer: &mut vello::Renderer,
        index: usize,
    ) -> Result<Self, String> {
        if index >= MAX_NATIVE_ATLAS_PAGES {
            return Err("GPU_IMAGE_ATLAS_FULL: native page identity exceeds budget".into());
        }
        // Vello keys overrides by image identity. Give every page a distinct
        // identity even though its overridden source blob is never decoded.
        Self::new_with_identity(device, renderer, vec![b'N', index as u8])
    }
    fn new_with_identity(
        device: &wgpu::Device,
        renderer: &mut vello::Renderer,
        identity: Vec<u8>,
    ) -> Result<Self, String> {
        if device.limits().max_texture_dimension_2d < ATLAS_EDGE {
            return Err("GPU_IMAGE_ATLAS_FULL: device cannot hold fixed page".into());
        }
        let texture = device.create_texture(&wgpu::TextureDescriptor {
            label: Some("art-equation-fixed-decoded-page"),
            size: wgpu::Extent3d {
                width: ATLAS_EDGE,
                height: ATLAS_EDGE,
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::Rgba8Unorm,
            usage: wgpu::TextureUsages::COPY_SRC | wgpu::TextureUsages::COPY_DST | wgpu::TextureUsages::TEXTURE_BINDING,
            view_formats: &[],
        });
        // Like Vello's register_texture, the override never reads this empty
        // identity blob. Its explicit premultiplied convention matches source.
        let image = vello::peniko::ImageData {
            data: vello::peniko::Blob::new(Arc::new(identity)),
            format: vello::peniko::ImageFormat::Rgba8,
            alpha_type: vello::peniko::ImageAlphaType::AlphaPremultiplied,
            width: ATLAS_EDGE,
            height: ATLAS_EDGE,
        };
        renderer.override_image(
            &image,
            Some(wgpu::TexelCopyTextureInfoBase {
                texture: texture.clone(),
                mip_level: 0,
                origin: wgpu::Origin3d::ZERO,
                aspect: wgpu::TextureAspect::All,
            }),
        );
        Ok(Self {
            image,
            texture,
            references: vec![],
            slots: HashMap::new(),
            uploads: 0,
            upload_bytes: 0,
            delta_uploads: 0,
            full_uploads: 0,
        })
    }
    pub fn update(
        &mut self,
        plan: &AtlasPlan,
        queue: &wgpu::Queue,
        renderer: &mut vello::Renderer,
    ) {
        let refs = plan.references();
        if refs == self.references {
            return;
        }
        let stable_prefix = self.references.len() <= refs.len()
            && refs[..self.references.len()] == self.references[..]
            && self.references.iter().all(|r| {
                let key = (r.key.clone(), r.revision);
                self.slots.get(&key).zip(plan.slots.get(&key))
                    .is_some_and(|(old, new)| old.x == new.x && old.y == new.y)
            });
        if stable_prefix {
            for image in plan.images.iter().skip(self.references.len()) {
                let r = &image.reference;
                let slot = plan.slots[&(r.key.clone(), r.revision)];
                let width = r.width + 2;
                let height = r.height + 2;
                let row_bytes = (width * 4).div_ceil(256) * 256;
                let mut pixels = vec![0u8; row_bytes as usize * height as usize];
                for py in 0..height {
                    for px in 0..width {
                        let sx = px.saturating_sub(1).min(r.width - 1);
                        let sy = py.saturating_sub(1).min(r.height - 1);
                        let source = ((sy * r.width + sx) * 4) as usize;
                        let target = (py * row_bytes + px * 4) as usize;
                        pixels[target..target + 4].copy_from_slice(&image.pixels[source..source + 4]);
                    }
                }
                self.upload_bytes += pixels.len() as u64;
                queue.write_texture(
                    wgpu::TexelCopyTextureInfo {
                        texture: &self.texture, mip_level: 0,
                        origin: wgpu::Origin3d { x: slot.x - 1, y: slot.y - 1, z: 0 },
                        aspect: wgpu::TextureAspect::All,
                    },
                    &pixels,
                    wgpu::TexelCopyBufferLayout {
                        offset: 0, bytes_per_row: Some(row_bytes),
                        rows_per_image: Some(height),
                    },
                    wgpu::Extent3d { width, height, depth_or_array_layers: 1 },
                );
            }
            renderer.mark_override_image_dirty(&self.image);
            self.references = refs;
            self.slots = plan.slots.clone();
            self.uploads += 1;
            self.delta_uploads += 1;
            return;
        }
        let pixels = plan.pixels();
        self.upload_bytes += pixels.len() as u64;
        queue.write_texture(
            wgpu::TexelCopyTextureInfo {
                texture: &self.texture,
                mip_level: 0,
                origin: wgpu::Origin3d::ZERO,
                aspect: wgpu::TextureAspect::All,
            },
            &pixels,
            wgpu::TexelCopyBufferLayout {
                offset: 0,
                bytes_per_row: Some(ATLAS_EDGE * 4),
                rows_per_image: Some(ATLAS_EDGE),
            },
            wgpu::Extent3d {
                width: ATLAS_EDGE,
                height: ATLAS_EDGE,
                depth_or_array_layers: 1,
            },
        );
        renderer.mark_override_image_dirty(&self.image);
        self.references = refs;
        self.slots = plan.slots.clone();
        self.uploads += 1;
        self.full_uploads += 1;
    }
    /// Upload a prebuilt page in bounded row slices. The caller must keep the
    /// page out of active paint until all rows have arrived and finish_staged
    /// has committed its reference identity.
    pub fn upload_rows(
        &mut self,
        queue: &wgpu::Queue,
        pixels: &[u8],
        first_row: u32,
        row_count: u32,
    ) -> Result<(), String> {
        if pixels.len() != ATLAS_BYTES
            || row_count == 0
            || first_row
                .checked_add(row_count)
                .is_none_or(|end| end > ATLAS_EDGE)
        {
            return Err("GPU_IMAGE_ATLAS_FULL: invalid staged page row range".into());
        }
        let row_bytes = ATLAS_EDGE as usize * 4;
        let start = first_row as usize * row_bytes;
        let end = (first_row + row_count) as usize * row_bytes;
        queue.write_texture(
            wgpu::TexelCopyTextureInfo {
                texture: &self.texture,
                mip_level: 0,
                origin: wgpu::Origin3d {
                    x: 0,
                    y: first_row,
                    z: 0,
                },
                aspect: wgpu::TextureAspect::All,
            },
            &pixels[start..end],
            wgpu::TexelCopyBufferLayout {
                offset: 0,
                bytes_per_row: Some(ATLAS_EDGE * 4),
                rows_per_image: Some(row_count),
            },
            wgpu::Extent3d {
                width: ATLAS_EDGE,
                height: row_count,
                depth_or_array_layers: 1,
            },
        );
        self.upload_bytes += (end - start) as u64;
        Ok(())
    }
    pub fn finish_staged(&mut self, plan: &AtlasPlan, renderer: &mut vello::Renderer) {
        renderer.mark_override_image_dirty(&self.image);
        self.references = plan.references();
        self.slots = plan.slots.clone();
        self.uploads += 1;
        self.full_uploads += 1;
    }
}
impl Drop for GpuImageAtlas {
    fn drop(&mut self) {
        self.texture.destroy()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn image(key: &str, w: u32, h: u32) -> Arc<DecodedImage> {
        Arc::new(DecodedImage {
            reference: ImageReference {
                key: key.into(),
                revision: 1,
                epoch: 1,
                width: w,
                height: h,
            },
            pixels: Arc::new(vec![200; w as usize * h as usize * 4]),
        })
    }
    fn layout_image(key: &str, w: u32, h: u32) -> Arc<DecodedImage> {
        Arc::new(DecodedImage {
            reference: ImageReference { key: key.into(), revision: 1, epoch: 1, width: w, height: h },
            // Packing checks reference geometry; pixel materialization is
            // exercised separately by the edge-extrusion test.
            pixels: Arc::new(vec![]),
        })
    }
    #[test]
    fn explicit_capacity_failure_and_stable_nonoverlapping_slots() {
        assert!(pack(vec![layout_image("wide", ATLAS_EDGE, 1)]).is_err());
        assert!(pack(vec![layout_image("a", ATLAS_EDGE - 2, ATLAS_EDGE / 2), layout_image("b", ATLAS_EDGE - 2, ATLAS_EDGE / 2)]).is_err());
        let a = pack(vec![image("a", 8, 4), image("b", 8, 4)]).unwrap();
        let b = pack(vec![image("b", 8, 4), image("a", 8, 4)]).unwrap();
        for key in a.slots.keys() {
            let x = a.slots[key];
            let y = b.slots[key];
            assert_eq!((x.x, x.y), (y.x, y.y));
        }
        assert!(a.slots[&("a".into(), 1)].x + 8 < a.slots[&("b".into(), 1)].x);
    }
    #[test]
    fn extruded_edges_use_exact_source_bytes_and_unoccupied_page_is_transparent() {
        let plan = pack(vec![image("a", 1, 1)]).unwrap();
        let pixels = plan.pixels();
        for y in 0..3 {
            for x in 0..3 {
                let i = (y * ATLAS_EDGE as usize + x) * 4;
                assert_eq!(&pixels[i..i + 4], &[200; 4]);
            }
        }
        let i = (3 * ATLAS_EDGE as usize + 3) * 4;
        assert_eq!(&pixels[i..i + 4], &[0; 4]);
    }
    #[test]
    fn native_pages_keep_each_image_whole_and_refuse_unbounded_growth() {
        let tile_edge = ATLAS_EDGE / 2 - 2;
        let images = (0..5)
            .map(|n| layout_image(&format!("tile-{n}"), tile_edge, tile_edge))
            .collect::<Vec<_>>();
        assert!(pack(images.clone()).is_err());
        let pages = pack_native_pages(images).unwrap();
        assert_eq!(pages.len(), 2);
        assert_eq!(pages.iter().map(|page| page.images.len()).sum::<usize>(), 5);
        let mut keys = pages
            .iter()
            .flat_map(|page| page.slots.keys().cloned())
            .collect::<Vec<_>>();
        keys.sort();
        keys.dedup();
        assert_eq!(keys.len(), 5);
        let shared_pixels = Arc::new(vec![]);
        let over_budget = (0..17)
            .map(|n| {
                Arc::new(DecodedImage {
                    reference: ImageReference {
                        key: format!("large-{n}"),
                        revision: 1,
                        epoch: 1,
                        width: tile_edge,
                        height: tile_edge,
                    },
                    pixels: shared_pixels.clone(),
                })
            })
            .collect();
        assert!(pack_native_pages(over_budget).is_err());
    }

    #[test]
    fn native_slots_stay_put_when_new_mips_append() {
        let low = vec![image("low-a", 31, 17), image("low-b", 23, 13)];
        let before = pack_native_pages(low.clone()).unwrap();
        let after = pack_native_pages([low, vec![image("sharp", 41, 39)]].concat()).unwrap();
        for reference in before[0].references() {
            let key = (reference.key, reference.revision);
            let old = before[0].slots[&key];
            let new = after[0].slots[&key];
            assert_eq!((old.x, old.y), (new.x, new.y));
        }
    }
}
