//! One strict paint/geometry preparation shared by Vello GPU and Vello CPU.
//! The canonical app owns routes, Boolean resolution and affine flattening.
//! Dashes are expanded once here; no renderer invents independent geometry.

use crate::EncodingReport;
use serde_json::Value;
use std::collections::HashSet;
use vello_cpu::{
    color::{AlphaColor, Srgb, parse_color},
    kurbo::{Affine, BezPath, Cap, Join, PathEl, Point, Rect, Shape, Stroke, dash},
    peniko::{BlendMode, Fill, Gradient},
};

pub(super) const MAX_PATH_COMMANDS: usize = 65_536;
const MAX_SCENE_COMMANDS: usize = 1_000_000;
const MAX_DASH_ENTRIES: usize = 64;
const MAX_MITER_LIMIT: f64 = 1_024.0;
const MAX_COMPILED_COORDINATE: f64 = 1e12;

pub(super) struct PreparedScene {
    pub vectors: Vec<PreparedVector>,
    pub images: Vec<crate::image_resources::PreparedImage>,
    pub resources: Vec<crate::image_resources::ImageReference>,
    pub operations: Vec<PreparedOp>,
    pub background: AlphaColor<Srgb>,
    pub report: EncodingReport,
}

pub(super) enum PreparedOp {
    Vector(usize),
    Image(usize),
    Gradient(PreparedGradient),
    Shadow(PreparedShadow),
    Scope(PreparedScope),
    Pop,
}

pub(super) struct PreparedGradient {
    pub path:BezPath,pub transform:Affine,pub brush_transform:Affine,pub fill_rule:Fill,pub gradient:Gradient,
}
pub(super) struct PreparedShadow {
    pub rect:Rect,pub radius:f64,pub std_dev:f64,pub color:AlphaColor<Srgb>,pub transform:Affine,
}

pub(super) struct PreparedScope {
    pub kind: PreparedScopeKind,
    pub path: BezPath,
    pub transform: Affine,
    pub fill_rule: Fill,
    pub opacity: f32,
    pub blend: BlendMode,
}

/// Preserve the authored operation kind even when both currently use the same
/// isolated Normal/SrcOver CPU semantics. GPU clip optimization must never infer
/// an explicit composite from its opacity or blend value alone.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum PreparedScopeKind {
    Clip,
    Composite,
}

pub(super) struct PreparedVector {
    pub path: BezPath,
    pub stroke_path: Option<BezPath>,
    pub transform: Affine,
    pub opacity: f32,
    pub fill: AlphaColor<Srgb>,
    pub fill_rule: Fill,
    pub stroke_color: AlphaColor<Srgb>,
    /// No dash pattern remains: stroke_path already contains its resolved runs.
    pub stroke: Stroke,
    /// Includes requested miter and cap extents, unlike a fixed four-width box.
    pub opacity_clip: Rect,
}

fn optional_bool(value: &Value, key: &str, default: bool) -> Result<bool, String> {
    if value[key].is_null() {
        return Ok(default);
    }
    value[key]
        .as_bool()
        .ok_or_else(|| format!("{key} must be a boolean"))
}

/// Validate all paint before either backend allocates a rendering target.
pub(super) fn prepare_snapshot(snapshot: &Value) -> Result<PreparedScene, String> {
    if snapshot["schema"] == "art-equation.display-list" {
        return crate::prepared_display_list::prepare_display_list(snapshot);
    }
    let objects = snapshot["objects"]
        .as_array()
        .ok_or("Snapshot objects must be an array")?;
    if !snapshot["connections"].is_null() {
        let connections = snapshot["connections"]
            .as_array()
            .ok_or("Snapshot connections must be an array")?;
        if !connections.is_empty() {
            return Err("SCENE_UNSUPPORTED: raw connections need canonical compiled paint and layer ownership".into());
        }
    }
    let background = paint_color(&snapshot["environment"]["background"], "#00000000")?;
    let mut identities = HashSet::with_capacity(objects.len());
    let mut ordered = Vec::with_capacity(objects.len());
    for (index, object) in objects.iter().enumerate() {
        if !object.is_object() {
            return Err("scene object must be an object".into());
        }
        let id = object["id"]
            .as_str()
            .filter(|id| !id.is_empty())
            .ok_or("scene object id must be a nonempty string")?;
        if !identities.insert(id) {
            return Err(format!("scene object id {id} is duplicated"));
        }
        let order = optional_number(object, "order", 0.0)?;
        let visible = optional_bool(object, "visible", true)?;
        let hidden = optional_bool(object, "hidden", false)?;
        if visible && !hidden {
            ordered.push((index, order, object));
        }
    }
    ordered.sort_by(|left, right| left.1.total_cmp(&right.1).then(left.0.cmp(&right.0)));
    let mut vectors = Vec::with_capacity(ordered.len());
    let mut command_count = 0;
    let mut stroke_command_count = 0;
    for (_, _, object) in ordered {
        if object["kind"] != "vector" {
            return Err("SCENE_UNSUPPORTED: expected visible vector".into());
        }
        super::validate_flat_vector_metadata(object)?;
        if optional_style(object, "blendMode", "normal")? != "normal" {
            return Err("SCENE_UNSUPPORTED: blendMode must be normal".into());
        }
        let payload = &object["payload"];
        if !payload.is_object() {
            return Err("vector payload must be an object".into());
        }
        let path = object_path(object, &mut command_count)?;
        let transform = object_transform(object)?;
        validate_transformed_path(&path, transform)?;
        let opacity = optional_number(object, "opacity", 1.0)?;
        if !(0.0..=1.0).contains(&opacity) {
            return Err("object opacity must be between 0 and 1".into());
        }
        let fill_rule = match optional_style(payload, "vectorFillRule", "nonzero")? {
            "nonzero" => Fill::NonZero,
            "evenodd" => Fill::EvenOdd,
            value => return Err(format!("SCENE_UNSUPPORTED: vectorFillRule {value}")),
        };
        let fill = paint_color(&payload["fill"], "#808080")?;
        let stroke_color = paint_color(&payload["stroke"], "#000000")?;
        let (stroke, dashes, offset) = stroke_style(payload)?;
        let stroke_path = if stroke.width > 0.0 && stroke_color.components[3] > 0.0 {
            let resolved = if dashes.is_empty() {
                path.clone()
            } else {
                expand_dashes(&path, &dashes, offset)?
            };
            add_commands(&mut stroke_command_count, resolved.elements().len())?;
            Some(resolved)
        } else {
            None
        };
        let padding = stroke.width * stroke.miter_limit.max(1.0) + 1.0;
        let opacity_clip = path.bounding_box().inflate(padding, padding);
        validate_transformed_path(&opacity_clip.to_path(0.05), transform)?;
        vectors.push(PreparedVector {
            path,
            stroke_path,
            transform,
            opacity: opacity as f32,
            fill,
            fill_rule,
            stroke_color,
            stroke,
            opacity_clip,
        });
    }
    let report = EncodingReport {
        objects: objects.len(),
        vectors: vectors.len(),
        connections: 0,
        encoded_connections: 0,
        text: 0,
        raster: 0,
        structural: 0,
        requires_mixed_compositor: false,
    };
    Ok(PreparedScene {
        operations: (0..vectors.len()).map(PreparedOp::Vector).collect(),
        vectors,
        images: Vec::new(),
        resources: Vec::new(),
        background,
        report,
    })
}

fn add_commands(count: &mut usize, additional: usize) -> Result<(), String> {
    *count = count
        .checked_add(additional)
        .ok_or("SCENE_RESOURCE_LIMIT: command count overflow")?;
    if additional > MAX_PATH_COMMANDS || *count > MAX_SCENE_COMMANDS {
        return Err(
            "SCENE_RESOURCE_LIMIT: path commands exceed the shared complexity bounds".into(),
        );
    }
    Ok(())
}

pub(super) fn stroke_style(payload: &Value) -> Result<(Stroke, Vec<f64>, f64), String> {
    let width = optional_number(payload, "strokeWidth", 0.0)?;
    if !(0.0..=1e6).contains(&width) {
        return Err("stroke width is outside the shared bounds".into());
    }
    let cap = match optional_style(payload, "vectorStrokeCap", "butt")? {
        "butt" => Cap::Butt,
        "round" => Cap::Round,
        "square" => Cap::Square,
        value => return Err(format!("SCENE_UNSUPPORTED: vectorStrokeCap {value}")),
    };
    let join = match optional_style(payload, "vectorStrokeJoin", "miter")? {
        "miter" => Join::Miter,
        "round" => Join::Round,
        "bevel" => Join::Bevel,
        value => return Err(format!("SCENE_UNSUPPORTED: vectorStrokeJoin {value}")),
    };
    let miter = optional_number(payload, "miterLimit", 4.0)?;
    if !(1.0..=MAX_MITER_LIMIT).contains(&miter) {
        return Err("SCENE_RESOURCE_LIMIT: miterLimit must be between 1 and 1024".into());
    }
    let offset = optional_number(payload, "dashOffset", 0.0)?;
    let mut dashes = Vec::new();
    if !payload["dashArray"].is_null() {
        let values = payload["dashArray"]
            .as_array()
            .ok_or("dashArray must be a numeric array")?;
        if values.len() > MAX_DASH_ENTRIES {
            return Err("SCENE_RESOURCE_LIMIT: dashArray exceeds 64 entries".into());
        }
        for value in values {
            let length = finite_number(value, "dashArray entry")?;
            if length < 0.0 || length > 1e6 {
                return Err("dashArray entries must be nonnegative and at most 1000000".into());
            }
            if length == 0.0 {
                return Err("SCENE_UNSUPPORTED: zero-length dash entries require SVG dot parity verification".into());
            }
            dashes.push(length);
        }
    }
    Ok((
        Stroke::new(width)
            .with_caps(cap)
            .with_join(join)
            .with_miter_limit(miter),
        dashes,
        offset,
    ))
}

/// A control polygon upper-bounds curve arc length. Count dash transitions from
/// its shortest positive interval before iterating, then enforce the actual cap.
fn expand_dashes(path: &BezPath, pattern: &[f64], offset: f64) -> Result<BezPath, String> {
    let mut current = Point::ORIGIN;
    let mut start = Point::ORIGIN;
    let mut length = 0.0;
    for element in path.elements() {
        match *element {
            PathEl::MoveTo(point) => {
                current = point;
                start = point;
            }
            PathEl::LineTo(point) => {
                length += current.distance(point);
                current = point;
            }
            PathEl::QuadTo(control, point) => {
                length += current.distance(control) + control.distance(point);
                current = point;
            }
            PathEl::CurveTo(first, second, point) => {
                length += current.distance(first) + first.distance(second) + second.distance(point);
                current = point;
            }
            PathEl::ClosePath => {
                length += current.distance(start);
                current = start;
            }
        }
    }
    let shortest = pattern.iter().copied().fold(f64::INFINITY, f64::min);
    let estimate = 4.0 * (path.elements().len() as f64 + (length / shortest).ceil() + 1.0);
    if !estimate.is_finite() || estimate > MAX_PATH_COMMANDS as f64 {
        return Err(
            "SCENE_RESOURCE_LIMIT: dash expansion exceeds the per-path complexity budget".into(),
        );
    }
    let mut resolved = BezPath::new();
    for element in dash(path.elements().iter().copied(), offset, pattern) {
        if resolved.elements().len() >= MAX_PATH_COMMANDS {
            return Err(
                "SCENE_RESOURCE_LIMIT: resolved dashes exceed the per-path complexity budget"
                    .into(),
            );
        }
        resolved.push(element);
    }
    Ok(resolved)
}

pub(super) fn validate_transformed_path(path: &BezPath, transform: Affine) -> Result<(), String> {
    let check = |point: Point| -> Result<(), String> {
        let point = transform * point;
        if !point.x.is_finite()
            || !point.y.is_finite()
            || point.x.abs() > MAX_COMPILED_COORDINATE
            || point.y.abs() > MAX_COMPILED_COORDINATE
        {
            Err(
                "SCENE_RESOURCE_LIMIT: compiled geometry exceeds finite 1e12 coordinate bounds"
                    .into(),
            )
        } else {
            Ok(())
        }
    };
    for element in path.elements() {
        match *element {
            PathEl::MoveTo(point) | PathEl::LineTo(point) => check(point)?,
            PathEl::QuadTo(control, point) => {
                check(control)?;
                check(point)?;
            }
            PathEl::CurveTo(first, second, point) => {
                check(first)?;
                check(second)?;
                check(point)?;
            }
            PathEl::ClosePath => {}
        }
    }
    Ok(())
}

pub(super) fn validate_camera(scene: &PreparedScene, camera: Affine) -> Result<(), String> {
    for image in &scene.images {
        validate_transformed_path(&image.source.to_path(0.05), camera * image.transform)?;
    }
    for object in &scene.vectors {
        validate_transformed_path(&object.path, camera * object.transform)?;
        validate_transformed_path(
            &object.opacity_clip.to_path(0.05),
            camera * object.transform,
        )?;
    }
    for operation in &scene.operations {
        if let PreparedOp::Gradient(paint)=operation {
            validate_transformed_path(&paint.path,camera*paint.transform)?;
        }
        if let PreparedOp::Shadow(paint)=operation {
            validate_transformed_path(&paint.rect.inflate(2.5*paint.std_dev,2.5*paint.std_dev).to_path(0.05),camera*paint.transform)?;
        }
        if let PreparedOp::Scope(scope) = operation {
            validate_transformed_path(&scope.path, camera * scope.transform)?;
        }
    }
    Ok(())
}

pub(super) fn optional_number(value: &Value, key: &str, default: f64) -> Result<f64, String> {
    if value[key].is_null() {
        return Ok(default);
    }
    finite_number(&value[key], key)
}

fn finite_number(value: &Value, field: &str) -> Result<f64, String> {
    let number = value
        .as_f64()
        .ok_or_else(|| format!("{field} must be a finite number"))?;
    if !number.is_finite() || number.abs() > 1_000_000_000.0 {
        return Err(format!("{field} is outside the shared numeric bounds"));
    }
    Ok(number)
}

pub(super) fn optional_style<'a>(
    value: &'a Value,
    key: &str,
    default: &'a str,
) -> Result<&'a str, String> {
    if value[key].is_null() {
        return Ok(default);
    }
    value[key]
        .as_str()
        .ok_or_else(|| format!("{key} must be a string"))
}

pub(super) fn paint_color(value: &Value, default: &str) -> Result<AlphaColor<Srgb>, String> {
    let source = if value.is_null() {
        default
    } else {
        value.as_str().ok_or("paint color must be a CSS string")?
    };
    if source.len() > 256 {
        return Err("paint color is too long".into());
    }
    if source == "none" {
        return Ok(AlphaColor::from_rgba8(0, 0, 0, 0));
    }
    parse_color(source)
        .map(|color| color.to_alpha_color::<Srgb>())
        .map_err(|error| format!("invalid paint color: {error}"))
}

pub(super) fn object_transform(object: &Value) -> Result<Affine, String> {
    if object["transform"].is_null() {
        return Ok(Affine::IDENTITY);
    }
    let values = object["transform"]
        .as_array()
        .ok_or("object transform must be a six-number array")?;
    if values.len() != 6 {
        return Err("object transform must contain six numbers".into());
    }
    let mut coefficients = [0.0; 6];
    for (target, value) in coefficients.iter_mut().zip(values) {
        *target = finite_number(value, "object transform")?;
    }
    Ok(Affine::new(coefficients))
}

pub(super) fn object_path(object: &Value, scene_commands: &mut usize) -> Result<BezPath, String> {
    let commands = &object["payload"]["commands"];
    let supplied_bounds = if !object["bounds"].is_null() {
        Some(object_bounds(object)?)
    } else {
        None
    };
    if commands.is_null() {
        let path = supplied_bounds
            .ok_or("fallback path needs finite bounds")?
            .to_path(0.05);
        add_commands(scene_commands, path.elements().len())?;
        return Ok(path);
    }
    let commands = commands
        .as_array()
        .ok_or("path commands must be an array")?;
    add_commands(scene_commands, commands.len())?;
    let mut path = BezPath::new();
    let mut moved = false;
    for command in commands {
        let values = command.as_array().ok_or("path command must be an array")?;
        let opcode = values
            .first()
            .and_then(Value::as_str)
            .ok_or("path command needs an opcode")?;
        let expected = match opcode {
            "M" | "L" => 3,
            "Q" => 5,
            "C" => 7,
            "Z" => 1,
            _ => return Err(format!("unsupported path opcode {opcode}")),
        };
        if values.len() != expected {
            return Err(format!("path command {opcode} has the wrong arity"));
        }
        if opcode != "M" && !moved {
            return Err("path must start with MoveTo".into());
        }
        let mut coordinates = [0.0; 6];
        for (target, value) in coordinates.iter_mut().zip(values.iter().skip(1)) {
            *target = finite_number(value, "path coordinate")?;
        }
        match opcode {
            "M" => {
                path.move_to((coordinates[0], coordinates[1]));
                moved = true;
            }
            "L" => path.line_to((coordinates[0], coordinates[1])),
            "Q" => path.quad_to(
                (coordinates[0], coordinates[1]),
                (coordinates[2], coordinates[3]),
            ),
            "C" => path.curve_to(
                (coordinates[0], coordinates[1]),
                (coordinates[2], coordinates[3]),
                (coordinates[4], coordinates[5]),
            ),
            "Z" => path.close_path(),
            _ => unreachable!(),
        }
    }
    Ok(path)
}

fn object_bounds(object: &Value) -> Result<Rect, String> {
    let bounds = &object["bounds"];
    if !bounds.is_object() {
        return Err("bounds must be an object".into());
    }
    let x = finite_number(&bounds["x"], "bounds.x")?;
    let y = finite_number(&bounds["y"], "bounds.y")?;
    let width = finite_number(&bounds["width"], "bounds.width")?;
    let height = finite_number(&bounds["height"], "bounds.height")?;
    if width < 0.0 || height < 0.0 {
        return Err("bounds dimensions cannot be negative".into());
    }
    let right = x + width;
    let bottom = y + height;
    if !right.is_finite() || !bottom.is_finite() || right.abs() > 1e9 || bottom.abs() > 1e9 {
        return Err("SCENE_RESOURCE_LIMIT: bounds edges exceed finite 1e9 bounds".into());
    }
    Ok(Rect::new(x, y, right, bottom))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn fixture() -> Value {
        json!({ "schema":"art-equation.scene", "schemaVersion":1,
            "environment":{"background":"#00000000"}, "connections":[],
            "objects":[{ "id":"primitive", "kind":"vector", "order":0,
                "visible":true, "transform":[1,0,0,1,0,0],
                "bounds":{"x":4,"y":4,"width":36,"height":24},
                "payload":{"commands":[["M",4,8],["C",10,4,32,24,40,8]],
                    "fill":"none","stroke":"#ffffff","strokeWidth":2} }] })
    }

    fn assert_same_error(value: &Value) -> String {
        let source = value.to_string();
        let gpu = crate::parse_snapshot(&source)
            .and_then(|snapshot| prepare_snapshot(&snapshot))
            .err()
            .expect("GPU preparation must reject this input");
        let cpu = crate::cpu::render_cpu_snapshot(48, 40, &source, 1.0, 0.0, 0.0).unwrap_err();
        assert_eq!(
            gpu, cpu,
            "CPU/GPU share the exact failure, rather than partial paint"
        );
        gpu
    }

    #[test]
    fn shared_dash_preparation_keeps_curves_and_removes_second_expansion() {
        let mut value = fixture();
        value["objects"][0]["payload"]["dashArray"] = json!([4, 2, 1]);
        value["objects"][0]["payload"]["dashOffset"] = json!(-9);
        let prepared = prepare_snapshot(&value).unwrap();
        let vector = &prepared.vectors[0];
        assert!(vector.stroke.dash_pattern.is_empty());
        assert_eq!(vector.stroke.dash_offset, 0.0);
        assert_eq!(vector.path.elements().len(), 2);
        let runs = vector.stroke_path.as_ref().unwrap();
        assert!(runs.elements().len() > vector.path.elements().len());
        assert!(
            runs.elements()
                .iter()
                .any(|el| matches!(el, PathEl::CurveTo(..)))
        );
        let (_, report) = crate::gpu_scene::encode_snapshot(&value).unwrap();
        assert_eq!(report, prepared.report);
    }

    #[test]
    fn malformed_styles_bounds_and_visibility_fail_identically_before_paint() {
        for (field, input) in [
            ("dashArray", json!("4 2")),
            ("dashArray", json!([-1, 2])),
            ("dashArray", json!([0, 0])),
            ("dashArray", json!([0, 4])),
            ("dashArray", json!([1_000_001, 2])),
            ("dashArray", json!(["bad", 2])),
            ("dashArray", json!(vec![1; 65])),
            ("dashOffset", json!("bad")),
            ("miterLimit", json!(0.9)),
            ("miterLimit", json!(1025)),
            ("miterLimit", json!("8")),
            ("strokeWidth", json!(-1)),
        ] {
            let mut value = fixture();
            value["objects"][0]["payload"][field] = input;
            assert_same_error(&value);
        }
        for bounds in [
            json!([]),
            json!({"x":0,"y":0,"width":-1,"height":4}),
            json!({"x":"bad","y":0,"width":4,"height":4}),
            json!({"x":1e9,"y":0,"width":1,"height":4}),
        ] {
            let mut value = fixture();
            value["objects"][0]["bounds"] = bounds;
            assert_same_error(&value);
        }
        for (field, input) in [
            ("visible", json!(1)),
            ("hidden", json!("false")),
            ("order", json!("1")),
            ("blendMode", json!(42)),
        ] {
            let mut value = fixture();
            value["objects"][0][field] = input;
            assert_same_error(&value);
        }
        for field in [
            "clipPath",
            "clipStack",
            "mask",
            "filter",
            "shadow",
            "diagramCaption",
        ] {
            let mut value = fixture();
            value["objects"][0]["payload"][field] = json!({"uncompiled":true});
            assert!(assert_same_error(&value).contains(field));
        }
    }

    #[test]
    fn tiny_dash_periods_and_large_compiled_coordinates_reject_before_iteration() {
        let mut value = fixture();
        value["objects"][0]["payload"]["dashArray"] = json!([1e-18, 1e-18]);
        let error = assert_same_error(&value);
        assert!(error.starts_with("SCENE_RESOURCE_LIMIT: dash expansion"));
        value["objects"][0]["payload"]["dashArray"] = json!([]);
        value["objects"][0]["transform"] = json!([1e9, 0, 0, 1e9, 0, 0]);
        value["objects"][0]["payload"]["commands"] = json!([["M", 1e9, 0], ["L", 1e9, 1]]);
        assert!(assert_same_error(&value).contains("compiled geometry"));
    }

    #[test]
    fn duplicate_identity_and_malformed_connection_shape_are_rejected() {
        let mut value = fixture();
        let duplicate = value["objects"][0].clone();
        value["objects"].as_array_mut().unwrap().push(duplicate);
        assert!(assert_same_error(&value).contains("duplicated"));
        let mut value = fixture();
        value["objects"][0]["id"] = json!("");
        assert!(assert_same_error(&value).contains("nonempty string"));
        let mut value = fixture();
        value["connections"] = json!({"id":"uncompiled"});
        assert!(assert_same_error(&value).contains("connections must be an array"));
    }

    #[test]
    fn custom_miter_extents_are_preserved_inside_grouped_opacity_clip() {
        let mut value = fixture();
        value["objects"][0]["opacity"] = json!(0.5);
        value["objects"][0]["payload"]["strokeWidth"] = json!(6);
        value["objects"][0]["payload"]["miterLimit"] = json!(32);
        value["objects"][0]["payload"]["commands"] =
            json!([["M", 21, 36], ["L", 22, 20], ["L", 23, 36]]);
        let prepared = prepare_snapshot(&value).unwrap();
        let vector = &prepared.vectors[0];
        assert_eq!(vector.stroke.miter_limit, 32.0);
        assert!(vector.opacity_clip.y0 < -100.0);
        crate::gpu_scene::encode_prepared(&prepared);
        assert!(validate_camera(&prepared, Affine::scale(1e12)).is_err());
    }
}
