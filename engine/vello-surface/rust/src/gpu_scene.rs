//! Vello GPU consumes the same prepared paths/styles as the CPU rasterizer.
use crate::prepared_scene::{PreparedOp, PreparedScene, PreparedScopeKind};
use crate::image_atlas::AtlasPlan;
use vello::{
    Scene,
    peniko::{BlendMode, Fill, ImageBrush, ImageData},
    kurbo::Affine,
};

pub(super) fn encode_prepared(prepared: &PreparedScene) -> Scene {
    encode_prepared_with_images(prepared, None).expect("vector-only encoder cannot consume unresolved images")
}

pub(super) fn encode_prepared_with_images(prepared: &PreparedScene, atlas: Option<(&ImageData, &AtlasPlan)>) -> Result<Scene, String> {
    match atlas {
        Some(page) => encode_prepared_with_image_pages(prepared, &[page]),
        None => encode_prepared_with_image_pages(prepared, &[]),
    }
}

/// The native host can bind a bounded set of pages while preserving exactly
/// the same ordered prepared operations and per-image crop/transform/opacity.
pub(super) fn encode_prepared_with_image_pages(prepared: &PreparedScene, pages: &[(&ImageData, &AtlasPlan)]) -> Result<Scene, String> {
    let mut scene = Scene::new();
    let clip_only = clip_only_scopes(prepared)?;
    for (operation_index, operation) in prepared.operations.iter().enumerate() {
        let object = match operation {
            PreparedOp::Vector(index) => &prepared.vectors[*index],
            PreparedOp::Image(index) => {
                let image=&prepared.images[*index];
                let identity=(image.resource.key.clone(),image.resource.revision);
                let (page,slot)=pages.iter().find_map(|&(page,plan)|
                    plan.slots.get(&identity).map(|slot|(page,slot)))
                    .ok_or("RESOURCE_NOT_READY: GPU image slot missing from native pages")?;
                scene.fill(Fill::NonZero, image.transform,
                    &ImageBrush::new(page.clone()).with_quality(image.quality).with_alpha(image.opacity),
                    Some(Affine::translate((-f64::from(slot.x),-f64::from(slot.y)))), &image.source);
                continue;
            }
            PreparedOp::Gradient(paint) => {
                scene.fill(paint.fill_rule,paint.transform,&paint.gradient,Some(paint.brush_transform),&paint.path);
                continue;
            }
            PreparedOp::Shadow(paint) => {
                if paint.std_dev==0.0 {
                    scene.fill(Fill::NonZero,paint.transform,paint.color,None,&paint.rect.to_rounded_rect(paint.radius));
                } else {
                    scene.draw_blurred_rounded_rect(paint.transform,paint.rect,paint.color,paint.radius,paint.std_dev);
                }
                continue;
            }
            PreparedOp::Scope(scope) => {
                if clip_only[operation_index] {
                    // The whole subtree was proven to contain no blend layer,
                    // including vector opacity layers. This obeys the pinned
                    // pure-clip API's blend-nesting restriction (#1198).
                    scene.push_clip_layer(scope.fill_rule, scope.transform, &scope.path);
                } else {
                    scene.push_layer(
                        scope.fill_rule,
                        scope.blend,
                        scope.opacity,
                        scope.transform,
                        &scope.path,
                    );
                }
                continue;
            }
            PreparedOp::Pop => {
                scene.pop_layer();
                continue;
            }
        };
        if object.opacity < 1.0 {
            // Clip includes the actual requested miter/cap extents. Whole-object
            // opacity applies once around both fills and resolved stroke runs.
            scene.push_layer(
                Fill::NonZero,
                BlendMode::default(),
                object.opacity,
                object.transform,
                &object.opacity_clip,
            );
        }
        scene.fill(
            object.fill_rule,
            object.transform,
            object.fill,
            None,
            &object.path,
        );
        if let Some(path) = &object.stroke_path {
            scene.stroke(
                &object.stroke,
                object.transform,
                object.stroke_color,
                None,
                path,
            );
        }
        if object.opacity < 1.0 {
            scene.pop_layer();
        }
    }
    Ok(scene)
}

/// A true clip may contain nested true clips and ordinary paints, but never an
/// explicit composite, an implicit opacity layer, a shadow or unknown paint.
/// Keep the CPU preparation and isolation contract unchanged. Only GPU encoding
/// uses this conservative, whole-subtree proof to avoid unnecessary blend spill.
fn clip_only_scopes(prepared: &PreparedScene) -> Result<Vec<bool>, String> {
    let mut eligible = vec![false; prepared.operations.len()];
    let mut stack = Vec::<usize>::new();
    for (index, operation) in prepared.operations.iter().enumerate() {
        let blocks_ancestors = match operation {
            PreparedOp::Scope(scope) => {
                let is_clip = scope.kind == PreparedScopeKind::Clip
                    && scope.opacity == 1.0
                    && scope.blend == BlendMode::default();
                eligible[index] = is_clip;
                !is_clip
            }
            PreparedOp::Vector(vector) => prepared.vectors[*vector].opacity < 1.0,
            PreparedOp::Image(_) | PreparedOp::Gradient(_) | PreparedOp::Pop => false,
            // A new paint kind must be explicitly reviewed before it may occur
            // inside a true clip. Shadows stay isolated even at zero blur.
            _ => true,
        };
        if blocks_ancestors {
            for ancestor in &stack {
                eligible[*ancestor] = false;
            }
        }
        match operation {
            PreparedOp::Scope(_) => stack.push(index),
            PreparedOp::Pop => {
                if stack.pop().is_none() {
                    return Err("DISPLAY_LIST_INVALID: GPU clip classification underflow".into());
                }
            }
            _ => {}
        }
    }
    if !stack.is_empty() {
        return Err("DISPLAY_LIST_INVALID: GPU clip classification unclosed scope".into());
    }
    Ok(eligible)
}

#[cfg(test)]
pub(super) fn encode_snapshot(
    snapshot: &serde_json::Value,
) -> Result<(Scene, crate::EncodingReport), String> {
    let prepared = crate::prepared_scene::prepare_snapshot(snapshot)?;
    Ok((encode_prepared_with_images(&prepared, None)?, prepared.report))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::prepared_scene::stroke_style;
    use vello::kurbo::{Cap, Join};
    use serde_json::{Value, json};
    use vello::peniko::{Compose, Mix};

    fn rect() -> Value {
        json!([["M", 0, 0], ["L", 16, 0], ["L", 16, 16], ["L", 0, 16], ["Z"]])
    }

    fn scope(id: &str, kind: &str) -> Value {
        let mut scope = json!({"type": kind, "scopeId": id, "commands": rect(),
            "transform": [1,0,0,1,0,0], "fillRule": "nonzero", "isolation": "isolated"});
        if kind == "pushComposite" {
            scope["opacity"] = json!(1);
            scope["blendMode"] = json!("normal");
        }
        scope
    }

    fn pop(id: &str) -> Value {
        json!({"type": "pop", "scopeId": id})
    }

    fn paint(id: &str) -> Value {
        json!({"type": "vector", "object": {"id": id, "kind": "vector",
            "transform": [1,0,0,1,0,0], "payload": {"commands": rect(), "fill": "#ff0000ff", "strokeWidth": 0}}})
    }

    fn list(operations: Vec<Value>, resources: Vec<Value>) -> Value {
        json!({"schema": "art-equation.display-list", "schemaVersion": 2,
            "sceneId": "gpu-clip-qualification", "revision": "1",
            "environment": {"background": "#00000000", "colorSpace": "srgb"},
            "operations": operations, "resources": resources})
    }

    /// Inspect the real pinned Vello draw stream. BEGIN_CLIP has two words of
    /// draw data; its first word distinguishes true clips from blend layers.
    fn encoded_layers(scene: &Scene) -> Vec<(u32, f32)> {
        let encoding = scene.encoding();
        let mut offset = 0;
        let mut layers = Vec::new();
        for tag in &encoding.draw_tags {
            if tag.0 == 0x49 {
                layers.push((encoding.draw_data[offset], f32::from_bits(encoding.draw_data[offset + 1])));
            }
            offset += ((tag.0 >> 2) & 0x7) as usize;
        }
        assert_eq!(offset, encoding.draw_data.len());
        layers
    }

    fn layers(operations: Vec<Value>) -> Vec<(u32, f32)> {
        let prepared = crate::prepared_scene::prepare_snapshot(&list(operations, vec![])).unwrap();
        encoded_layers(&encode_prepared(&prepared))
    }

    fn normal() -> u32 {
        ((Mix::Normal as u32) << 8) | Compose::SrcOver as u32
    }

    #[test]
    fn nested_blend_free_clip_leaf_images_use_true_vello_clips() {
        let reference = json!({"key": "tiny", "revision": 1, "epoch": 1, "width": 1, "height": 1});
        let image = json!({"type": "image", "id": "leaf-image", "resource": reference,
            "sourceRect": {"x":0,"y":0,"width":1,"height":1}, "transform":[16,0,0,16,0,0],
            "opacity":0.5, "sampling":"bilinear"});
        let prepared = crate::prepared_scene::prepare_snapshot(&list(vec![
            scope("outer", "pushClip"), scope("inner", "pushClip"), image,
            pop("inner"), pop("outer")], vec![reference])).unwrap();
        let resource = prepared.resources[0].clone();
        let atlas = AtlasPlan {
            slots: std::collections::HashMap::from([((resource.key.clone(), resource.revision),
                crate::image_atlas::Slot { x:0, y:0 })]),
            images: vec![],
        };
        let page = ImageData { data: vello::peniko::Blob::new(std::sync::Arc::new(vec![255u8,0,0,255])),
            format: vello::peniko::ImageFormat::Rgba8,
            alpha_type: vello::peniko::ImageAlphaType::AlphaPremultiplied, width:1, height:1 };
        let scene = encode_prepared_with_image_pages(&prepared, &[(&page, &atlas)]).unwrap();
        assert_eq!(encoded_layers(&scene), vec![(0x8003,1.0), (0x8003,1.0)]);
    }

    #[test]
    fn explicit_normal_composite_blocks_every_enclosing_clip() {
        assert_eq!(layers(vec![scope("a", "pushClip"), scope("b", "pushClip"),
            scope("group", "pushComposite"), paint("paint"), pop("group"), pop("b"), pop("a")]),
            vec![(normal(),1.0), (normal(),1.0), (normal(),1.0)]);
    }

    #[test]
    fn composite_opacity_keeps_isolation_but_inner_blend_free_clips_qualify() {
        let mut composite = scope("group", "pushComposite");
        composite["opacity"] = json!(0.5);
        assert_eq!(layers(vec![scope("a", "pushClip"), composite, scope("leaf", "pushClip"),
            paint("paint"), pop("leaf"), pop("group"), pop("a")]),
            vec![(normal(),1.0), (normal(),0.5), (0x8003,1.0)]);
    }

    #[test]
    fn destination_out_blocks_enclosing_clips_and_preserves_porter_duff_mode() {
        let mut composite = scope("hole", "pushComposite");
        composite["blendMode"] = json!("destination-out");
        assert_eq!(layers(vec![scope("a", "pushClip"), scope("b", "pushClip"),
            composite, paint("paint"), pop("hole"), pop("b"), pop("a")]),
            vec![(normal(),1.0), (normal(),1.0),
                (((Mix::Normal as u32) << 8) | Compose::DestOut as u32,1.0)]);
    }

    #[test]
    fn vector_opacity_implicit_layer_blocks_every_enclosing_clip() {
        let mut vector = paint("translucent");
        vector["object"]["opacity"] = json!(0.25);
        assert_eq!(layers(vec![scope("a", "pushClip"), scope("b", "pushClip"),
            vector, pop("b"), pop("a")]),
            vec![(normal(),1.0), (normal(),1.0), (normal(),0.25)]);
    }

    #[test]
    fn shadows_block_every_enclosing_clip_even_when_zero_blur_falls_back_to_fill() {
        for std_deviation in [0, 2] {
            let shadow = json!({"type": "blurredRoundedRect", "id": "shadow",
                "rect": {"x":1,"y":1,"width":14,"height":14}, "radius":2,
                "stdDeviation":std_deviation, "color":"#00000080", "transform":[1,0,0,1,0,0]});
            assert_eq!(layers(vec![scope("a", "pushClip"), scope("b", "pushClip"),
                shadow, pop("b"), pop("a")]), vec![(normal(),1.0), (normal(),1.0)]);
        }
    }

    #[test]
    fn sibling_composite_does_not_block_completed_or_later_clip_subtrees() {
        assert_eq!(layers(vec![scope("first", "pushClip"), paint("first-paint"), pop("first"),
            scope("group", "pushComposite"), paint("group-paint"), pop("group"),
            scope("last", "pushClip"), paint("last-paint"), pop("last")]),
            vec![(0x8003,1.0), (normal(),1.0), (0x8003,1.0)]);
    }

    #[test]
    fn stroke_defaults_and_metadata_follow_svg_semantics() {
        let (stroke, dashes, offset) = stroke_style(&serde_json::json!({})).unwrap();
        assert_eq!(stroke.start_cap, Cap::Butt);
        assert_eq!(stroke.join, Join::Miter);
        assert_eq!(stroke.miter_limit, 4.0);
        assert!(dashes.is_empty());
        assert_eq!(offset, 0.0);
        let (stroke, _, _) = stroke_style(&serde_json::json!({"vectorStrokeCap":"square","vectorStrokeJoin":"bevel","miterLimit":8})).unwrap();
        assert_eq!(stroke.start_cap, Cap::Square);
        assert_eq!(stroke.join, Join::Bevel);
        assert_eq!(stroke.miter_limit, 8.0);
        assert!(stroke_style(&serde_json::json!({"vectorStrokeCap":"triangle"})).is_err());
    }

    #[test]
    fn validated_fixture_encodes_vectors_and_rejects_unsupported_connections() {
        let mut fixture = crate::real_board_fixture();
        assert!(encode_snapshot(&fixture).is_err());
        fixture["connections"] = serde_json::json!([]);
        let (_, report) = encode_snapshot(&fixture).unwrap();
        assert_eq!((report.vectors, report.encoded_connections), (7, 0));
    }
}
