//! Versioned paint derivative: ordered primitives and explicitly isolated scopes.
//! Neither ownership nor transforms are inferred from canonical parent metadata.
use crate::EncodingReport;
use crate::prepared_scene::{
    PreparedOp, PreparedScene, PreparedScope, PreparedScopeKind, object_path, object_transform, optional_number,
    optional_style, paint_color, prepare_snapshot, validate_transformed_path, PreparedGradient, PreparedShadow,
};
use serde_json::{Value, json};
use std::collections::HashSet;
use crate::image_resources::{parse_reference, PreparedImage};
use vello::kurbo::{Rect, Shape, Point};
use vello::peniko::{ImageQuality,Gradient,InterpolationAlphaSpace};
use vello_cpu::peniko::{BlendMode, Compose, Fill, Mix};

const MAX_OPERATIONS: usize = 100_000;
const MAX_SCOPE_DEPTH: usize = 32;
const MAX_COMMANDS: usize = 1_000_000;

fn fields(value: &Value, allowed: &[&str]) -> Result<(), String> {
    let map = value
        .as_object()
        .ok_or("DISPLAY_LIST_INVALID: operation must be an object")?;
    for name in map.keys() {
        if !allowed.contains(&name.as_str()) {
            return Err(format!("SCENE_UNSUPPORTED: display-list field {name}"));
        }
    }
    Ok(())
}

fn identity<'a>(value: &'a Value, key: &str) -> Result<&'a str, String> {
    value[key]
        .as_str()
        .filter(|v| !v.is_empty() && v.len() <= 1024)
        .ok_or_else(|| format!("DISPLAY_LIST_INVALID: {key} must be a bounded nonempty string"))
}

pub(super) fn prepare_display_list(snapshot: &Value) -> Result<PreparedScene, String> {
    if snapshot["schemaVersion"] != 2 {
        return Err("DISPLAY_LIST_INVALID: expected schemaVersion 2".into());
    }
    fields(
        snapshot,
        &[
            "schema",
            "schemaVersion",
            "sceneId",
            "revision",
            "environment",
            "operations",
            "resources",
        ],
    )?;
    identity(snapshot, "sceneId")?;
    identity(snapshot, "revision")?;
    fields(&snapshot["environment"], &["background", "colorSpace"])?;
    if snapshot["environment"]["colorSpace"] != "srgb" {
        return Err("SCENE_UNSUPPORTED: display-list colour space must be srgb".into());
    }
    let source_resources = snapshot["resources"]
        .as_array()
        .ok_or("DISPLAY_LIST_INVALID: resources must be an array")?;
    if source_resources.len()>1024 {
        return Err("RESOURCE_BUDGET_EXCEEDED: display list exceeds 1024 image references".into());
    }
    let resources=source_resources.iter().map(parse_reference).collect::<Result<Vec<_>,_>>()?;
    let mut resource_indices = std::collections::HashMap::with_capacity(resources.len());
    for (idx, resource) in resources.iter().enumerate() {
        if resource_indices.insert((resource.key.clone(), resource.revision), idx).is_some() {
            return Err("RESOURCE_INVALID: duplicate declared image identity".into());
        }
    }
    let source = snapshot["operations"]
        .as_array()
        .ok_or("DISPLAY_LIST_INVALID: operations must be an array")?;
    if source.len() > MAX_OPERATIONS {
        return Err("SCENE_RESOURCE_LIMIT: display-list exceeds 100000 operations".into());
    }
    let background = paint_color(&snapshot["environment"]["background"], "#00000000")?;
    let mut operations = Vec::with_capacity(source.len());
    let mut vectors = Vec::new();
    let mut images = Vec::new();
    let mut stack = Vec::new();
    let mut scopes = HashSet::new();
    let mut objects = HashSet::new();
    let mut command_count = 0_usize;
    for (index, operation) in source.iter().enumerate() {
        let fail = |message: String| format!("operation {index}: {message}");
        match operation["type"].as_str() {
            Some("gradient") => {
                fields(operation,&["type","id","commands","transform","brushTransform","fillRule","gradient"]).map_err(fail)?;
                let id=identity(operation,"id").map_err(fail)?;
                if !objects.insert(id) {return Err(fail("DISPLAY_LIST_INVALID: duplicate primitive identity".into()));}
                if !operation["transform"].is_array() || !operation["brushTransform"].is_array() {return Err(fail("PAINT_INVALID: explicit gradient matrices required".into()));}
                let transform=object_transform(operation).map_err(fail)?;
                let brush_transform=object_transform(&json!({"transform":operation["brushTransform"]})).map_err(fail)?;
                if brush_transform.determinant().abs()<1e-12 {return Err(fail("PAINT_INVALID: singular gradient brush matrix".into()));}
                let path=object_path(&json!({"payload":{"commands":operation["commands"]}}),&mut command_count).map_err(fail)?;
                validate_transformed_path(&path,transform).map_err(fail)?;
                let fill_rule=match operation["fillRule"].as_str(){Some("nonzero")=>Fill::NonZero,Some("evenodd")=>Fill::EvenOdd,_=>return Err(fail("PAINT_INVALID: explicit fill rule required".into()))};
                let g=&operation["gradient"];
                fields(g,&["kind","start","end","center","radius","stops","interpolation","alphaInterpolation"]).map_err(fail)?;
                if g["interpolation"]!="srgb" || g["alphaInterpolation"]!="premultiplied" {return Err(fail("PAINT_UNSUPPORTED: gradient colour convention must be explicit sRGB premultiplied".into()));}
                let point=|name:&str|->Result<Point,String>{let a=g[name].as_array().filter(|a|a.len()==2).ok_or("PAINT_INVALID: gradient point must have2 coordinates")?;
                    let x=a[0].as_f64().filter(|n|n.is_finite()&&n.abs()<=1e9).ok_or("PAINT_INVALID: gradient coordinate")?;
                    let y=a[1].as_f64().filter(|n|n.is_finite()&&n.abs()<=1e9).ok_or("PAINT_INVALID: gradient coordinate")?;Ok(Point::new(x,y))};
                let gradient=match g["kind"].as_str(){
                    Some("linear")=>{if !g["center"].is_null() || !g["radius"].is_null(){return Err(fail("PAINT_INVALID: linear gradient fields".into()));}
                        let start=point("start").map_err(fail)?;let end=point("end").map_err(fail)?;
                        if start.distance(end)<1e-9{return Err(fail("PAINT_INVALID: coincident gradient endpoints".into()));}Gradient::new_linear(start,end)},
                    Some("radial")=>{if !g["start"].is_null() || !g["end"].is_null(){return Err(fail("PAINT_INVALID: radial gradient fields".into()));}
                        let radius=g["radius"].as_f64().filter(|n|n.is_finite()&&*n>0.0&&*n<=1e9).ok_or_else(||fail("PAINT_INVALID: radial radius".into()))?;
                        Gradient::new_radial(point("center").map_err(fail)?,radius as f32)},
                    _=>return Err(fail("PAINT_UNSUPPORTED: gradient kind".into())),
                };
                let stops=g["stops"].as_array().filter(|s|s.len()>=2&&s.len()<=256).ok_or_else(||fail("PAINT_INVALID: gradient needs2..256 stops".into()))?;
                let mut resolved=Vec::new();let mut previous=-1.0;
                for stop in stops {fields(stop,&["offset","color"]).map_err(fail)?;
                    let offset=stop["offset"].as_f64().filter(|n|n.is_finite()&&*n>=previous&&*n>=0.0&&*n<=1.0).ok_or_else(||fail("PAINT_INVALID: gradient stops must be ordered0..1".into()))?;
                    if !stop["color"].is_string(){return Err(fail("PAINT_INVALID: explicit gradient color required".into()));}
                    resolved.push((offset as f32,paint_color(&stop["color"],"#00000000").map_err(fail)?));previous=offset;
                }
                operations.push(PreparedOp::Gradient(PreparedGradient{path,transform,brush_transform,fill_rule,
                    gradient:gradient.with_interpolation_alpha_space(InterpolationAlphaSpace::Premultiplied).with_stops(resolved.as_slice())}));
            }
            Some("blurredRoundedRect") => {
                fields(operation,&["type","id","rect","radius","stdDeviation","color","transform"]).map_err(fail)?;
                let id=identity(operation,"id").map_err(fail)?;
                if !objects.insert(id){return Err(fail("DISPLAY_LIST_INVALID: duplicate primitive identity".into()));}
                fields(&operation["rect"],&["x","y","width","height"]).map_err(fail)?;
                let r=&operation["rect"];
                let number=|key:&str|->Result<f64,String>{r[key].as_f64().filter(|n|n.is_finite()&&n.abs()<=1e9).ok_or_else(||format!("PAINT_INVALID: shadow rect.{key}"))};
                let x=number("x").map_err(fail)?;let y=number("y").map_err(fail)?;let w=number("width").map_err(fail)?;let h=number("height").map_err(fail)?;
                if w<=0.0||h<=0.0{return Err(fail("PAINT_INVALID: positive shadow rectangle required".into()));}
                let rect=Rect::new(x,y,x+w,y+h);
                let radius=operation["radius"].as_f64().filter(|n|n.is_finite()&&*n>=0.0&&*n<=w.min(h)/2.0).ok_or_else(||fail("PAINT_INVALID: shadow circular radius".into()))?;
                let std_dev=operation["stdDeviation"].as_f64().filter(|n|n.is_finite()&&*n>=0.0&&*n<=2048.0).ok_or_else(||fail("PAINT_INVALID: shadow stdDeviation".into()))?;
                if !operation["transform"].is_array() || !operation["color"].is_string(){return Err(fail("PAINT_INVALID: explicit shadow matrix/color required".into()));}
                let transform=object_transform(operation).map_err(fail)?;
                validate_transformed_path(&rect.inflate(2.5*std_dev,2.5*std_dev).to_path(0.05),transform).map_err(fail)?;
                let color=paint_color(&operation["color"],"#00000000").map_err(fail)?;
                operations.push(PreparedOp::Shadow(PreparedShadow{rect,radius,std_dev,color,transform}));
            }
            Some("image") => {
                if objects.len() >= 50_000 {
                    return Err("SCENE_RESOURCE_LIMIT: display-list exceeds 50000 primitives".into());
                }
                fields(operation,&["type","id","resource","sourceRect","transform","opacity","sampling"]).map_err(fail)?;
                let id=identity(operation,"id").map_err(fail)?;
                if !objects.insert(id) { return Err(fail(format!("DISPLAY_LIST_INVALID: duplicate primitive identity {id}"))); }
                let resource=parse_reference(&operation["resource"]).map_err(fail)?;
                let resource_index = *resource_indices
                    .get(&(resource.key.clone(), resource.revision))
                    .filter(|&&idx| resources[idx] == resource)
                    .ok_or_else(|| fail("RESOURCE_NOT_READY: image reference is not declared".into()))?;
                fields(&operation["sourceRect"],&["x","y","width","height"]).map_err(fail)?;
                let rect=&operation["sourceRect"];
                let number=|key:&str|rect[key].as_f64().filter(|n|n.is_finite()).ok_or_else(||format!("IMAGE_INVALID: sourceRect.{key} required"));
                let x=number("x").map_err(fail)?;let y=number("y").map_err(fail)?;
                let width=number("width").map_err(fail)?;let height=number("height").map_err(fail)?;
                if x<0.0 || y<0.0 || width<=0.0 || height<=0.0 || x+width>resource.width as f64 || y+height>resource.height as f64 {
                    return Err(fail("IMAGE_INVALID: source crop exceeds registered pixels".into()));
                }
                let source=Rect::new(x,y,x+width,y+height);
                if !operation["transform"].is_array() {return Err(fail("IMAGE_INVALID: explicit source-to-world matrix required".into()));}
                let transform=object_transform(operation).map_err(fail)?;
                if transform.determinant().abs()<1e-12 {return Err(fail("IMAGE_INVALID: singular source-to-world transform".into()));}
                validate_transformed_path(&source.to_path(0.05),transform).map_err(fail)?;
                let opacity=optional_number(operation,"opacity",1.0).map_err(fail)?;
                if !(0.0..=1.0).contains(&opacity){return Err(fail("IMAGE_INVALID: opacity must be0..1".into()));}
                let quality=match operation["sampling"].as_str(){Some("bilinear")=>ImageQuality::Medium,Some("nearest")=>ImageQuality::Low,_=>return Err(fail("IMAGE_INVALID: explicit nearest/bilinear sampling required".into()))};
                operations.push(PreparedOp::Image(images.len()));
                images.push(PreparedImage{resource,resource_index,source,transform,opacity:opacity as f32,quality});
            }
            Some("vector") => {
                if objects.len() >= 50_000 {
                    return Err(
                        "SCENE_RESOURCE_LIMIT: display-list exceeds 50000 primitives".into(),
                    );
                }
                fields(operation, &["type", "object"]).map_err(fail)?;
                let object = &operation["object"];
                let id = identity(object, "id").map_err(fail)?;
                if !objects.insert(id) {
                    return Err(fail(format!(
                        "DISPLAY_LIST_INVALID: duplicate primitive identity {id}"
                    )));
                }
                // Reuse all existing geometry/paint/dash/affine safeguards.
                // Array sequence, not object.order, controls display-list paint.
                let mut prepared = prepare_snapshot(&json!({"objects":[object], "connections":[],
                    "environment":{"background":"#00000000"}}))
                .map_err(fail)?;
                if prepared.vectors.len() != 1 {
                    return Err(fail(
                        "DISPLAY_LIST_INVALID: vector operation must be visible".into(),
                    ));
                }
                let vector = prepared.vectors.pop().unwrap();
                command_count = command_count
                    .checked_add(vector.path.elements().len())
                    .and_then(|n| {
                        n.checked_add(
                            vector
                                .stroke_path
                                .as_ref()
                                .map_or(0, |p| p.elements().len()),
                        )
                    })
                    .ok_or("SCENE_RESOURCE_LIMIT: display-list command overflow")?;
                operations.push(PreparedOp::Vector(vectors.len()));
                vectors.push(vector);
            }
            Some(kind @ ("pushClip" | "pushComposite")) => {
                let allowed = if kind == "pushClip" {
                    &[
                        "type",
                        "scopeId",
                        "commands",
                        "transform",
                        "fillRule",
                        "isolation",
                    ][..]
                } else {
                    &[
                        "type",
                        "scopeId",
                        "commands",
                        "transform",
                        "fillRule",
                        "isolation",
                        "opacity",
                        "blendMode",
                    ][..]
                };
                fields(operation, allowed).map_err(fail)?;
                let id = identity(operation, "scopeId").map_err(fail)?;
                if !scopes.insert(id) {
                    return Err(fail(format!(
                        "DISPLAY_LIST_INVALID: duplicate scope identity {id}"
                    )));
                }
                if stack.len() >= MAX_SCOPE_DEPTH {
                    return Err(fail("SCENE_RESOURCE_LIMIT: scope depth exceeds 32".into()));
                }
                if operation["isolation"] != "isolated" {
                    return Err(fail(
                        "SCENE_UNSUPPORTED: scope must explicitly be isolated".into(),
                    ));
                }
                if !operation["commands"].is_array() || !operation["transform"].is_array() {
                    return Err(fail(
                        "DISPLAY_LIST_INVALID: scope needs explicit commands and matrix".into(),
                    ));
                }
                let path = object_path(
                    &json!({"payload":{"commands":operation["commands"]}}),
                    &mut command_count,
                )
                .map_err(fail)?;
                let transform = object_transform(operation).map_err(fail)?;
                validate_transformed_path(&path, transform).map_err(fail)?;
                let fill_rule =
                    match optional_style(operation, "fillRule", "nonzero").map_err(fail)? {
                        "nonzero" => Fill::NonZero,
                        "evenodd" => Fill::EvenOdd,
                        value => return Err(fail(format!("SCENE_UNSUPPORTED: fillRule {value}"))),
                    };
                let opacity = optional_number(operation, "opacity", 1.0).map_err(fail)?;
                if !(0.0..=1.0).contains(&opacity) {
                    return Err(fail(
                        "DISPLAY_LIST_INVALID: opacity must be between zero and one".into(),
                    ));
                }
                let blend = match optional_style(operation, "blendMode", "normal").map_err(fail)? {
                    "normal" => BlendMode::new(Mix::Normal,Compose::SrcOver),
                    "multiply" => BlendMode::new(Mix::Multiply,Compose::SrcOver),
                    "screen" => BlendMode::new(Mix::Screen,Compose::SrcOver),
                    "destination-out" => BlendMode::new(Mix::Normal,Compose::DestOut),
                    value => return Err(fail(format!("SCENE_UNSUPPORTED: blendMode {value}"))),
                };
                operations.push(PreparedOp::Scope(PreparedScope {
                    kind: if kind == "pushClip" {
                        PreparedScopeKind::Clip
                    } else {
                        PreparedScopeKind::Composite
                    },
                    path,
                    transform,
                    fill_rule,
                    opacity: opacity as f32,
                    blend,
                }));
                stack.push(id);
            }
            Some("pop") => {
                fields(operation, &["type", "scopeId"]).map_err(fail)?;
                let id = identity(operation, "scopeId").map_err(fail)?;
                if stack.pop() != Some(id) {
                    return Err(fail(format!(
                        "DISPLAY_LIST_INVALID: unmatched scope pop {id}"
                    )));
                }
                operations.push(PreparedOp::Pop);
            }
            kind => return Err(fail(format!("SCENE_UNSUPPORTED: paint operation {kind:?}"))),
        }
        if objects.len()>50_000 {return Err("SCENE_RESOURCE_LIMIT: display-list exceeds 50000 primitives".into());}
        if command_count > MAX_COMMANDS {
            return Err(
                "SCENE_RESOURCE_LIMIT: display-list exceeds 1000000 compiled commands".into(),
            );
        }
    }
    if !stack.is_empty() {
        return Err("DISPLAY_LIST_INVALID: unclosed scope stack".into());
    }
    let report = EncodingReport {
        objects: objects.len(),
        vectors: vectors.len(),
        connections: 0,
        encoded_connections: 0,
        text: 0,
        raster: 0,
        structural: scopes.len(),
        requires_mixed_compositor: false,
    };
    Ok(PreparedScene {
        vectors,
        images,
        resources,
        operations,
        background,
        report,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rect(x: i32, y: i32, w: i32, h: i32) -> Value {
        json!([
            ["M", x, y],
            ["L", x + w, y],
            ["L", x + w, y + h],
            ["L", x, y + h],
            ["Z"]
        ])
    }
    fn draw(id: &str, fill: &str, commands: Value) -> Value {
        json!({"type":"vector","object":{"id":id,"kind":"vector","order":0,
            "transform":[1,0,0,1,0,0],"payload":{"commands":commands,"fill":fill,"strokeWidth":0}}})
    }
    fn scope(id: &str, kind: &str, commands: Value) -> Value {
        let mut value = json!({"type":kind,"scopeId":id,"commands":commands,
            "transform":[1,0,0,1,0,0],"fillRule":"nonzero","isolation":"isolated"});
        if kind == "pushComposite" {
            value["opacity"] = json!(1);
            value["blendMode"] = json!("normal");
        }
        value
    }
    fn pop(id: &str) -> Value {
        json!({"type":"pop","scopeId":id})
    }
    fn list(ops: Vec<Value>) -> Value {
        json!({"schema":"art-equation.display-list","schemaVersion":2,"sceneId":"disposable-scopes","revision":"1",
            "resources":[],"environment":{"background":"#00000000","colorSpace":"srgb"},"operations":ops})
    }
    fn render(value: &Value) -> Vec<u8> {
        crate::cpu::render_cpu_snapshot(64, 64, &value.to_string(), 1.0, 0.0, 0.0).unwrap()
    }
    fn pixel(p: &[u8], x: usize, y: usize) -> [u8; 4] {
        p[(y * 64 + x) * 4..(y * 64 + x) * 4 + 4]
            .try_into()
            .unwrap()
    }
    fn same_error(value: &Value) -> String {
        let source = value.to_string();
        let gpu = crate::parse_snapshot(&source)
            .and_then(|s| prepare_snapshot(&s))
            .err()
            .expect("reject before GPU encoding");
        let cpu = crate::cpu::render_cpu_snapshot(64, 64, &source, 1.0, 0.0, 0.0).unwrap_err();
        assert_eq!(gpu, cpu);
        gpu
    }
    #[test]
    fn display_sequence_wins_over_primitive_order_metadata() {
        let mut first = draw("red", "#ff0000", rect(8, 8, 40, 40));
        first["object"]["order"] = json!(100);
        let second = draw("blue", "#0000ff", rect(8, 8, 40, 40));
        let value = list(vec![first, second]);
        assert_eq!(pixel(&render(&value), 16, 16), [0, 0, 255, 255]);
        assert_eq!(
            crate::gpu_scene::encode_snapshot(&value).unwrap().1.vectors,
            2
        );
    }

    #[test]
    fn authored_clip_and_normal_composite_kinds_survive_shared_preparation() {
        let prepared = prepare_snapshot(&list(vec![
            scope("clip", "pushClip", rect(0,0,64,64)),
            scope("composite", "pushComposite", rect(0,0,64,64)),
            draw("paint", "#ff0000", rect(0,0,64,64)), pop("composite"), pop("clip"),
        ])).unwrap();
        let kinds = prepared.operations.iter().filter_map(|operation| match operation {
            PreparedOp::Scope(scope) => Some(scope.kind),
            _ => None,
        }).collect::<Vec<_>>();
        assert_eq!(kinds, vec![PreparedScopeKind::Clip, PreparedScopeKind::Composite]);
    }
    #[test]
    fn group_opacity_is_applied_once_across_overlapping_primitives() {
        let mut group = scope("g", "pushComposite", rect(0, 0, 64, 64));
        group["opacity"] = json!(0.5);
        let p = render(&list(vec![
            group,
            draw("r", "#ff0000", rect(8, 8, 24, 24)),
            draw("b", "#0000ff", rect(24, 8, 24, 24)),
            pop("g"),
        ]));
        assert_eq!(pixel(&p, 16, 16), [255, 0, 0, 128]);
        assert_eq!(pixel(&p, 28, 16), [0, 0, 255, 128]);
        assert_eq!(pixel(&p, 40, 16), [0, 0, 255, 128]);
    }
    #[test]
    fn nested_clips_keep_each_draw_matrix_independent_and_restore_after_pop() {
        let mut outer = scope("a", "pushClip", rect(0, 0, 32, 32));
        outer["transform"] = json!([1, 0, 0, 1, 8, 8]);
        let p = render(&list(vec![
            outer,
            scope("b", "pushClip", rect(16, 16, 32, 32)),
            draw("r", "#ff0000", rect(0, 0, 64, 64)),
            pop("b"),
            pop("a"),
            draw("b", "#0000ff", rect(48, 0, 8, 8)),
        ]));
        assert_eq!(pixel(&p, 20, 20), [255, 0, 0, 255]);
        assert_eq!(pixel(&p, 10, 10), [0, 0, 0, 0]);
        assert_eq!(pixel(&p, 45, 20), [0, 0, 0, 0]);
        assert_eq!(pixel(&p, 50, 4), [0, 0, 255, 255]);
    }
    #[test]
    fn rotated_and_off_viewport_clip_uses_authored_world_transform() {
        let mut clip = scope("rot", "pushClip", rect(0, 0, 16, 32));
        clip["transform"] = json!([0, 1, -1, 0, 24, -4]);
        let p = render(&list(vec![
            clip,
            draw("r", "#ff0000", rect(0, 0, 64, 64)),
            pop("rot"),
        ]));
        assert_eq!(pixel(&p, 4, 4), [255, 0, 0, 255]);
        assert_eq!(pixel(&p, 26, 4), [0, 0, 0, 0]);
        assert_eq!(pixel(&p, 4, 14), [0, 0, 0, 0]);
    }
    #[test]
    fn evenodd_clip_hole_and_empty_clip_do_not_restore_full_paint() {
        let mut commands = rect(4, 4, 52, 52).as_array().unwrap().clone();
        commands.extend(rect(20, 20, 16, 16).as_array().unwrap().clone());
        let mut clip = scope("hole", "pushClip", json!(commands));
        clip["fillRule"] = json!("evenodd");
        let p = render(&list(vec![
            clip,
            draw("r", "#ff0000", rect(0, 0, 64, 64)),
            pop("hole"),
        ]));
        assert_eq!(pixel(&p, 10, 10), [255, 0, 0, 255]);
        assert_eq!(pixel(&p, 24, 24), [0, 0, 0, 0]);
        let p = render(&list(vec![
            scope("empty", "pushClip", json!([])),
            draw("r", "#ff0000", rect(0, 0, 64, 64)),
            pop("empty"),
        ]));
        assert!(p.iter().all(|b| *b == 0));
    }
    #[test]
    fn multiply_and_screen_composite_use_the_backdrop_and_src_over() {
        for (blend, expected) in [("multiply", [0, 0, 0, 255]), ("screen", [255, 0, 255, 255])] {
            let mut group = scope("mix", "pushComposite", rect(0, 0, 64, 64));
            group["blendMode"] = json!(blend);
            let p = render(&list(vec![
                draw("r", "#ff0000", rect(0, 0, 64, 64)),
                group,
                draw("b", "#0000ff", rect(8, 8, 40, 40)),
                pop("mix"),
            ]));
            assert_eq!(pixel(&p, 16, 16), expected);
            assert_eq!(pixel(&p, 4, 4), [255, 0, 0, 255]);
        }
    }
    #[test]
    fn isolated_clip_has_explicit_blend_backdrop_semantics() {
        let mut group = scope("mix", "pushComposite", rect(0, 0, 64, 64));
        group["blendMode"] = json!("multiply");
        let p = render(&list(vec![
            draw("r", "#ff0000", rect(0, 0, 64, 64)),
            scope("clip", "pushClip", rect(8, 8, 40, 40)),
            group,
            draw("b", "#0000ff", rect(0, 0, 64, 64)),
            pop("mix"),
            pop("clip"),
        ]));
        assert_eq!(pixel(&p, 16, 16), [0, 0, 255, 255]);
        assert_eq!(pixel(&p, 4, 4), [255, 0, 0, 255]);
    }
    #[test]
    fn stack_underflow_mismatch_unclosed_and_duplicate_scopes_fail_identically() {
        for ops in [
            vec![pop("a")],
            vec![scope("a", "pushClip", rect(0, 0, 4, 4)), pop("b")],
            vec![scope("a", "pushClip", rect(0, 0, 4, 4))],
            vec![
                scope("a", "pushClip", rect(0, 0, 4, 4)),
                scope("a", "pushClip", rect(0, 0, 4, 4)),
                pop("a"),
                pop("a"),
            ],
        ] {
            assert!(same_error(&list(ops)).contains("DISPLAY_LIST_INVALID"));
        }
    }
    #[test]
    fn operation_depth_and_aggregate_complexity_limits_are_shared() {
        let ops = (0..33)
            .map(|i| scope(&format!("s{i}"), "pushClip", rect(0, 0, 4, 4)))
            .collect();
        assert!(same_error(&list(ops)).contains("depth"));
        assert!(same_error(&list(vec![pop("a"); MAX_OPERATIONS + 1])).contains("operations"));
        let commands: Vec<Value> = std::iter::once(json!(["M", 0, 0]))
            .chain((0..60_000).map(|_| json!(["L", 1, 1])))
            .collect();
        let ops = (0..17)
            .map(|i| draw(&format!("v{i}"), "#ffffff", json!(commands)))
            .collect();
        assert!(same_error(&list(ops)).contains("1000000"));
    }
    #[test]
    fn unsupported_resources_masks_and_unqualified_blends_cannot_succeed_partially() {
        let mut v = list(vec![]);
        v["resources"] = json!([{"id":"unready-image"}]);
        assert!(same_error(&v).contains("RESOURCE_INVALID"));
        for (key, input) in [
            ("mask", json!({})),
            ("isolation", json!("passthrough")),
            ("blendMode", json!("overlay")),
            ("opacity", json!(1.01)),
        ] {
            let mut op = scope("s", "pushComposite", rect(0, 0, 4, 4));
            op[key] = input;
            same_error(&list(vec![op, pop("s")]));
        }
        let mut op = draw("r", "#ff0000", rect(0, 0, 4, 4));
        op["object"]["payload"]["mask"] = json!({});
        same_error(&list(vec![op]));
    }
    #[test]
    fn malformed_headers_matrices_paths_identities_and_camera_fail_before_paint() {
        for (key, input) in [
            ("schemaVersion", json!(3)),
            ("sceneId", json!("")),
            ("operations", json!({})),
            ("objects", json!([])),
            ("resources", json!(null)),
        ] {
            let mut v = list(vec![]);
            v[key] = input;
            same_error(&v);
        }
        for (key, input) in [
            ("transform", json!([1, 0, 0, 1, 0])),
            ("transform", json!(["bad", 0, 0, 1, 0, 0])),
            ("commands", json!([["L", 0, 0]])),
            ("fillRule", json!("bad")),
        ] {
            let mut op = scope("s", "pushClip", rect(0, 0, 4, 4));
            op[key] = input;
            same_error(&list(vec![op, pop("s")]));
        }
        let mut clip = scope("s", "pushClip", rect(0, 0, 4, 4));
        clip["transform"] = json!([1, 0, 0, 1, 1e9, 0]);
        let prepared = prepare_snapshot(&list(vec![clip, pop("s")])).unwrap();
        assert!(
            crate::prepared_scene::validate_camera(&prepared, vello_cpu::kurbo::Affine::scale(1e6))
                .is_err()
        );
        let op = draw("same", "#ff0000", rect(0, 0, 4, 4));
        assert!(same_error(&list(vec![op.clone(), op])).contains("duplicate"));
    }
}
