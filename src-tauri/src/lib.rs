mod telemetry_cursor;
use serde::{Deserialize, Serialize};
mod image_pyramid;
mod window_chrome;
mod engine_capabilities;
mod hardware_discovery;
mod launch_preferences;
pub mod experimental_compute;
mod font_resolver;
mod codex_bridge;
mod live_inspection;
mod project_storage;
pub mod canvas_pipeline;
use hnsw_rs::prelude::{AnnT, DistL2, Hnsw, HnswIo};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::process::Command;
use std::{
    collections::{HashMap, HashSet},
    env,
    fs::{self, File, OpenOptions},
    io::{BufReader, Read, Write},
    path::{Component, Path, PathBuf},
    sync::{Mutex, OnceLock},
    time::{SystemTime, UNIX_EPOCH},
};
use sysinfo::{Pid, ProcessesToUpdate, System};
use tauri::{Manager, RunEvent, State};
use tauri_plugin_log::{Target, TargetKind};

const WORKSPACE_ENV: &str = "ART_EQUATION_WORKSPACE_ROOT";
const LOCK_FILENAME: &str = ".art-equation.workspace.lock";
const APISR_MODEL_FILENAME: &str = "4x_Apisr_Grl_Gan_model_fp16.onnx";
const APISR_MODEL_SHA256: &str = "0114b77063b776d40ae9d62bc14d08cd14394c0d6dfc7b5d6814a37f99b65e07";
const SEMANTIC_ANN_BASENAME: &str = "semantic-ann";
const SEMANTIC_ANN_SCHEMA_VERSION: u32 = 2;
const SEMANTIC_ANN_MIN_RECORDS: usize = 2_500;
const SEMANTIC_ANN_M: usize = 24;
const SEMANTIC_ANN_EF_CONSTRUCTION: usize = 240;
const SEMANTIC_ANN_EF_SEARCH: usize = 128;

struct CachedSemanticAnn {
    generation: u64,
    graph_bytes: u64,
    data_bytes: u64,
    index: Hnsw<'static, f32, DistL2>,
    records: Vec<SemanticSourceRecord>,
    vector_bytes: Vec<u8>,
}

static SEMANTIC_ANN_CACHE: OnceLock<Mutex<HashMap<PathBuf, CachedSemanticAnn>>> = OnceLock::new();

#[derive(Debug)]
struct WorkspaceState {
    root: PathBuf,
    lock_path: PathBuf,
    owns_lock: bool,
    read_only: bool,
    workspace_id: String,
}

impl Drop for WorkspaceState {
    fn drop(&mut self) {
        if self.owns_lock {
            let _ = fs::remove_file(&self.lock_path);
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceInfo {
    root: String,
    workspace_id: String,
    read_only: bool,
    lock_owned: bool,
    storage_schema: u32,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceManifest {
    schema_version: u32,
    workspace_id: String,
    name: String,
    created_at_unix_ms: u128,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SaveResult {
    relative_path: String,
    bytes_written: usize,
    backup_created: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProjectWorkspace {
    project_id: String,
    relative_path: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProjectSummary {
    id: String,
    title: String,
    updated_at: String,
    board_count: usize,
    asset_count: usize,
    tags: Option<String>,
    date: Option<String>,
    status: Option<String>,
    cover_relative_path: Option<String>,
    cover_framing: Option<Value>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AssetRecord {
    #[serde(skip_serializing_if = "Option::is_none")]
    image_dimensions: Option<SourceImageDimensions>,
    requires_tiled_preview: bool,
    id: String,
    relative_path: String,
    original_name: String,
    byte_length: u64,
    extension: String,
    deduplicated: bool,
    thumbnail_relative_path: Option<String>,
}

#[derive(Debug, Serialize, PartialEq)]
struct SourceImageDimensions {
    width: u32,
    height: u32,
}

fn oriented_image_dimensions(width: u32, height: u32, orientation: image::metadata::Orientation) -> Option<SourceImageDimensions> {
    use image::metadata::Orientation;
    if width == 0 || height == 0 { return None; }
    let (width, height) = match orientation {
        Orientation::Rotate90 | Orientation::Rotate270 | Orientation::Rotate90FlipH | Orientation::Rotate270FlipH => (height, width),
        _ => (width, height),
    };
    Some(SourceImageDimensions { width, height })
}

/// Read dimensions and EXIF orientation without allocating decoded pixel data.
/// Missing/unsupported headers never prevent an otherwise valid asset import.
fn image_dimensions_from_header(source: &Path) -> Option<SourceImageDimensions> {
    use image::ImageDecoder;
    let reader = image::ImageReader::open(source).ok()?.with_guessed_format().ok()?;
    let mut decoder = reader.into_decoder().ok()?;
    let (width, height) = decoder.dimensions();
    let orientation = decoder.orientation().unwrap_or(image::metadata::Orientation::NoTransforms);
    oriented_image_dimensions(width, height, orientation)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ModelBundleRecord {
    asset: AssetRecord,
    dependencies: Vec<String>,
    missing_dependencies: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct RecoveryEntry {
    relative_path: String,
    kind: String,
    byte_length: u64,
    modified_at_unix_ms: u128,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ReferenceFile {
    path: String,
    name: String,
    extension: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SemanticIndexManifest {
    schema_version: u32,
    project_id: String,
    generation: u64,
    state: String,
    model_id: Option<String>,
    model_revision: Option<String>,
    embedding_dimension: Option<u32>,
    source_count: usize,
    indexed_count: usize,
    failed_count: usize,
    created_at_unix_ms: u128,
    updated_at_unix_ms: u128,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    ann: Option<SemanticAnnMetadata>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    ann_build_error: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct SemanticAnnMetadata {
    schema_version: u32,
    engine: String,
    engine_version: String,
    #[serde(default)]
    platform: String,
    generation: u64,
    dimension: u32,
    indexed_count: usize,
    max_connections: usize,
    ef_construction: usize,
    ef_search: usize,
    graph_bytes: u64,
    data_bytes: u64,
    #[serde(default)]
    graph_sha256: String,
    #[serde(default)]
    data_sha256: String,
    built_at_unix_ms: u128,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct SemanticSourceRecord {
    record_id: String,
    asset_id: Option<String>,
    source_kind: String,
    relative_path: String,
    content_sha256: Option<String>,
    byte_length: Option<u64>,
    active: bool,
    embedding_state: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    vector_offset: Option<u64>,
}

fn semantic_source_matches(left: &SemanticSourceRecord, right: &SemanticSourceRecord) -> bool {
    left.record_id == right.record_id
        && left.relative_path == right.relative_path
        && left.content_sha256 == right.content_sha256
        && left.byte_length == right.byte_length
        && left.active == right.active
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SemanticEmbeddingInput {
    record_id: String,
    vector: Vec<f32>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SemanticIndexStatus {
    state: String,
    source_count: usize,
    indexed_count: usize,
    failed_count: usize,
    generation: u64,
    disk_bytes: u64,
    model_id: Option<String>,
    model_revision: Option<String>,
    updated_at_unix_ms: Option<u128>,
    ann_state: String,
    ann_indexed_count: usize,
    search_engine: String,
    ann_build_error: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SemanticSearchResult {
    record_id: String,
    score: f32,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SemanticNearDuplicate {
    left_record_id: String,
    right_record_id: String,
    embedding_score: f32,
    perceptual_distance: u32,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SemanticCluster {
    id: String,
    record_ids: Vec<String>,
    representative_record_id: String,
    average_score: f32,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SemanticAnalysis {
    near_duplicates: Vec<SemanticNearDuplicate>,
    clusters: Vec<SemanticCluster>,
    analyzed_count: usize,
}

fn model_references(source: &Path) -> Result<Vec<String>, String> {
    let extension = safe_extension(source);
    if extension == "glb" {
        return Ok(Vec::new());
    }
    let text = fs::read_to_string(source)
        .map_err(|error| format!("Could not inspect model dependencies: {error}"))?;
    if extension == "gltf" {
        let json: Value =
            serde_json::from_str(&text).map_err(|error| format!("Invalid GLTF JSON: {error}"))?;
        let mut refs = Vec::new();
        for group in ["buffers", "images"] {
            if let Some(items) = json.get(group).and_then(Value::as_array) {
                for item in items {
                    if let Some(uri) = item.get("uri").and_then(Value::as_str) {
                        if !uri.starts_with("data:") && !uri.contains("://") {
                            refs.push(uri.replace('\\', "/"));
                        }
                    }
                }
            }
        }
        return Ok(refs);
    }
    if extension == "obj" {
        return Ok(text
            .lines()
            .filter_map(|line| line.trim().strip_prefix("mtllib ").map(str::trim))
            .filter(|value| !value.is_empty())
            .map(str::to_owned)
            .collect());
    }
    Ok(Vec::new())
}

fn import_model_bundle_into(
    workspace_root: &Path,
    project_id: &str,
    source_path: &Path,
) -> Result<ModelBundleRecord, String> {
    let asset = import_asset_into(workspace_root, project_id, source_path)?;
    let mut references = model_references(source_path)?;
    let source_parent = source_path
        .parent()
        .ok_or_else(|| "Model has no source folder".to_owned())?;
    // ZBrush documents are proprietary containers, but artists commonly keep same-stem
    // materials, palettes, and texture sidecars beside them. Preserve these companions
    // in the portable bundle without attempting to rewrite the ZBrush source.
    if matches!(safe_extension(source_path).as_str(), "ztl" | "zpr") {
        let stem = source_path
            .file_stem()
            .and_then(|value| value.to_str())
            .unwrap_or("");
        for entry in fs::read_dir(source_parent)
            .map_err(|error| format!("Could not inspect ZBrush companions: {error}"))?
        {
            let path = entry
                .map_err(|error| format!("Could not inspect ZBrush companion: {error}"))?
                .path();
            if !path.is_file() || path == source_path {
                continue;
            }
            let companion_stem = path
                .file_stem()
                .and_then(|value| value.to_str())
                .unwrap_or("");
            let extension = safe_extension(&path);
            if companion_stem == stem
                && [
                    "zli", "zmt", "zbp", "png", "jpg", "jpeg", "tif", "tiff", "bmp", "psd",
                ]
                .contains(&extension.as_str())
            {
                if let Some(name) = path.file_name().and_then(|value| value.to_str()) {
                    references.push(name.to_owned());
                }
            }
        }
    }
    if safe_extension(source_path) == "obj" {
        let material_files = references.clone();
        for material_uri in material_files {
            let material_path = source_parent.join(&material_uri);
            if let Ok(material_text) = fs::read_to_string(&material_path) {
                for line in material_text.lines() {
                    let parts = line.split_whitespace().collect::<Vec<_>>();
                    if parts.len() > 1
                        && (parts[0].starts_with("map_")
                            || matches!(
                                parts[0].to_ascii_lowercase().as_str(),
                                "bump" | "disp" | "decal"
                            ))
                    {
                        let texture = Path::new(&material_uri)
                            .parent()
                            .unwrap_or(Path::new(""))
                            .join(parts[parts.len() - 1]);
                        references.push(texture.to_string_lossy().replace('\\', "/"));
                    }
                }
            }
        }
        references.sort();
        references.dedup();
    }
    let bundle_root = project_root(workspace_root, project_id)?
        .join("assets/bundles")
        .join(&asset.id);
    fs::create_dir_all(&bundle_root)
        .map_err(|error| format!("Could not create model bundle: {error}"))?;
    let entry_name = source_path
        .file_name()
        .ok_or_else(|| "Model has no filename".to_owned())?;
    fs::copy(source_path, bundle_root.join(entry_name))
        .map_err(|error| format!("Could not copy model entry: {error}"))?;
    let mut available = Vec::new();
    let mut missing = Vec::new();
    for uri in references {
        let relative = match validate_relative_path(&uri) {
            Ok(path) => path,
            Err(_) => {
                missing.push(uri);
                continue;
            }
        };
        let source_dependency = source_parent.join(&relative);
        if !source_dependency.is_file() {
            missing.push(uri);
            continue;
        }
        let target = bundle_root.join(&relative);
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent)
                .map_err(|error| format!("Could not create bundle folder: {error}"))?;
        }
        fs::copy(&source_dependency, &target)
            .map_err(|error| format!("Could not copy model dependency: {error}"))?;
        available.push(uri);
    }
    Ok(ModelBundleRecord {
        asset: AssetRecord {
            relative_path: format!(
                "projects/{project_id}/assets/bundles/{}/{}",
                asset.id,
                entry_name.to_string_lossy()
            ),
            ..asset
        },
        dependencies: available,
        missing_dependencies: missing,
    })
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AssetAuditRequest {
    id: String,
    relative_path: String,
    byte_length: u64,
    managed_relative_path: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AssetAuditResult {
    id: String,
    status: String,
    actual_byte_length: Option<u64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct MaterializedAsset {
    id: String,
    managed_relative_path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ManagedRollbackEntry {
    current_relative_path: String,
    previous_relative_path: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ManagedPreviewRequest {
    asset_id: String,
    display_name: String,
    virtual_folder: String,
    extension: String,
    existing_relative_path: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ApisrModelInfo {
    installed: bool,
    verified: bool,
    relative_path: String,
    byte_length: u64,
}

fn unix_millis() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}

fn diagnostic_log_path(file_name: &str) -> Option<PathBuf> {
    let root = env::var_os(WORKSPACE_ENV)
        .map(PathBuf::from)
        .or_else(|| env::current_exe().ok()?.parent().map(Path::to_path_buf))?;
    let logs = root.join("logs");
    fs::create_dir_all(&logs).ok()?;
    Some(logs.join(file_name))
}

fn append_diagnostic(file_name: &str, message: &str) {
    let Some(path) = diagnostic_log_path(file_name) else {
        return;
    };
    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(path) {
        let _ = writeln!(
            file,
            "{} {}",
            unix_millis(),
            message.replace(['\r', '\n'], " ")
        );
        let _ = file.flush();
    }
}

fn install_panic_diagnostics() {
    let default_hook = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |panic_info| {
        append_diagnostic("native-crash.log", &format!("panic: {panic_info}"));
        default_hook(panic_info);
    }));
}

fn sha256_file(path: &Path) -> Result<(String, u64), String> {
    let file =
        File::open(path).map_err(|error| format!("Could not open {}: {error}", path.display()))?;
    let byte_length = file
        .metadata()
        .map_err(|error| format!("Could not inspect {}: {error}", path.display()))?
        .len();
    let mut reader = BufReader::new(file);
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 1024 * 1024];
    loop {
        let read = reader
            .read(&mut buffer)
            .map_err(|error| format!("Could not read {}: {error}", path.display()))?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    let hash = hasher
        .finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    Ok((hash, byte_length))
}

fn resolve_workspace_root() -> Result<PathBuf, String> {
    let configured = env::var_os(WORKSPACE_ENV).map(PathBuf::from);
    let root = match configured {
        Some(path) => path,
        None => env::current_exe()
            .map_err(|error| format!("Could not locate the application executable: {error}"))?
            .parent()
            .ok_or_else(|| "The application executable has no parent directory".to_owned())?
            .to_path_buf(),
    };

    fs::create_dir_all(&root).map_err(|error| {
        format!(
            "Could not create workspace root {}: {error}",
            root.display()
        )
    })?;
    root.canonicalize().map_err(|error| {
        format!(
            "Could not resolve workspace root {}: {error}",
            root.display()
        )
    })
}

fn validate_relative_path(relative_path: &str) -> Result<PathBuf, String> {
    let path = Path::new(relative_path);
    if relative_path.trim().is_empty() || path.is_absolute() {
        return Err("Workspace paths must be non-empty relative paths".to_owned());
    }
    if path.components().any(|component| {
        matches!(
            component,
            Component::ParentDir | Component::RootDir | Component::Prefix(_)
        )
    }) {
        return Err("Workspace paths cannot escape the portable workspace".to_owned());
    }
    Ok(path.to_path_buf())
}

fn validate_id(value: &str, label: &str) -> Result<String, String> {
    let trimmed = value.trim();
    if trimmed.is_empty()
        || trimmed.len() > 80
        || !trimmed.chars().all(|character| {
            character.is_ascii_alphanumeric() || character == '-' || character == '_'
        })
    {
        return Err(format!(
            "{label} must contain only letters, numbers, hyphens, or underscores"
        ));
    }
    Ok(trimmed.to_owned())
}

#[tauri::command]
fn mini_bridge_launch() -> Option<(String, String)> {
    // The Mini Bridge runs as its own OS process; this process-local handoff
    // replaces cross-window WebView creation, which can stall WebView2 on
    // some Windows setups and freeze the whole app.
    env::var_os("ART_EQUATION_MINI_BRIDGE")
        .and_then(|value| value.into_string().ok())
        .and_then(|value| {
            let (project_id, board_id) = value.split_once(':')?;
            let project_id = project_id.trim().to_owned();
            let board_id = board_id.trim().to_owned();
            if project_id.is_empty() || board_id.is_empty() {
                return None;
            }
            Some((project_id, board_id))
        })
}

#[tauri::command]
fn spawn_mini_bridge(project_id: String, board_id: String) -> Result<(), String> {
    let project_id = validate_id(&project_id, "project id")?;
    let board_id = validate_id(&board_id, "board id")?;
    let exe = env::current_exe()
        .map_err(|error| format!("Could not locate the application executable: {error}"))?;
    // The child inherits ART_EQUATION_WORKSPACE_ROOT, so it opens the same
    // portable workspace. The workspace lock keeps it read-only while the
    // main app is running.
    std::process::Command::new(&exe)
        .env(
            "ART_EQUATION_MINI_BRIDGE",
            format!("{project_id}:{board_id}"),
        )
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .map_err(|error| format!("Could not start the Mini Bridge process: {error}"))?;
    log::info!("spawned Mini Bridge process for project {project_id} board {board_id}");
    Ok(())
}

/// Launch the sibling WebGL edition EXE shipped beside this launcher.
/// Returns false when the EXE is not present so the UI can fall back to the
/// in-app Generation 1 canvas.
#[tauri::command]
fn launch_webgl_edition() -> Result<bool, String> {
    const WEBGL_EXE: &str = "Art Equation Studio - WebGL Edition.exe";
    let exe = env::current_exe()
        .map_err(|error| format!("Could not locate the application executable: {error}"))?;
    let dir = exe
        .parent()
        .ok_or_else(|| "Could not resolve the application folder.".to_owned())?;
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Some(override_path) = env::var_os("ART_EQUATION_WEBGL_EXE") {
        candidates.push(PathBuf::from(override_path));
    }
    candidates.push(dir.join(WEBGL_EXE));
    candidates.push(dir.join("Art Equation Studio WebGL").join(WEBGL_EXE));
    for candidate in candidates {
        if candidate.is_file() {
            std::process::Command::new(&candidate)
                .current_dir(candidate.parent().unwrap_or(dir))
                .stdin(std::process::Stdio::null())
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::null())
                .spawn()
                .map_err(|error| {
                    format!(
                        "Could not start the WebGL edition ({}): {error}",
                        candidate.display()
                    )
                })?;
            log::info!("launched WebGL edition from {}", candidate.display());
            return Ok(true);
        }
    }
    Ok(false)
}

fn project_root(workspace_root: &Path, project_id: &str) -> Result<PathBuf, String> {
    Ok(workspace_root
        .join("projects")
        .join(validate_id(project_id, "Project ID")?))
}

fn create_project_directories(
    workspace_root: &Path,
    project_id: &str,
) -> Result<ProjectWorkspace, String> {
    let project_id = validate_id(project_id, "Project ID")?;
    let root = project_root(workspace_root, &project_id)?;
    for directory in [
        "documents",
        "boards",
        "assets/originals",
        "assets/thumbnails",
        "assets/previews",
        "assets/library",
        "backups",
        "journal",
    ] {
        fs::create_dir_all(root.join(directory)).map_err(|error| {
            format!(
                "Could not create project directory {}: {error}",
                root.join(directory).display()
            )
        })?;
    }
    Ok(ProjectWorkspace {
        project_id: project_id.clone(),
        relative_path: format!("projects/{project_id}"),
    })
}

fn safe_extension(path: &Path) -> String {
    let candidate = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("bin")
        .to_ascii_lowercase();
    if !candidate.is_empty()
        && candidate.len() <= 12
        && candidate
            .chars()
            .all(|character| character.is_ascii_alphanumeric())
    {
        candidate
    } else {
        "bin".to_owned()
    }
}

fn generate_thumbnail(source: &Path, target: &Path) -> Result<bool, String> {
    if target.exists() {
        return Ok(true);
    }
    if image_pyramid::needs_tiles(source) {
        // Preserve import even if optional tools are missing; never fall through
        // to a whole-image decode for an oversized source.
        return Ok(image_pyramid::large_thumbnail(source, target).unwrap_or(false));
    }
    let reader =
        match image::ImageReader::open(source).and_then(|reader| reader.with_guessed_format()) {
            Ok(reader) => reader,
            Err(_) => return Ok(false),
        };
    use image::ImageDecoder;
    let mut decoder = match reader.into_decoder() {
        Ok(decoder) => decoder,
        Err(_) => return Ok(false),
    };
    let orientation = decoder.orientation().unwrap_or(image::metadata::Orientation::NoTransforms);
    let mut decoded = match image::DynamicImage::from_decoder(decoder) {
        Ok(image) => image,
        Err(_) => return Ok(false),
    };
    decoded.apply_orientation(orientation);
    let thumbnail = decoded.thumbnail(decoded.width().min(768), decoded.height().min(768));
    let temp = target.with_extension("png.importing");
    thumbnail
        .save_with_format(&temp, image::ImageFormat::Png)
        .map_err(|error| format!("Could not encode thumbnail {}: {error}", temp.display()))?;
    OpenOptions::new()
        .write(true)
        .open(&temp)
        .and_then(|file| file.sync_all())
        .map_err(|error| format!("Could not flush thumbnail {}: {error}", temp.display()))?;
    fs::rename(&temp, target)
        .map_err(|error| format!("Could not finish thumbnail {}: {error}", target.display()))?;
    Ok(true)
}

fn import_asset_into(
    workspace_root: &Path,
    project_id: &str,
    source_path: &Path,
) -> Result<AssetRecord, String> {
    if !source_path.is_file() {
        return Err(format!(
            "The selected asset is not a file: {}",
            source_path.display()
        ));
    }
    let project = create_project_directories(workspace_root, project_id)?;
    let source = File::open(source_path)
        .map_err(|error| format!("Could not open {}: {error}", source_path.display()))?;
    let byte_length = source
        .metadata()
        .map_err(|error| format!("Could not inspect {}: {error}", source_path.display()))?
        .len();
    let mut reader = BufReader::new(source);
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let count = reader
            .read(&mut buffer)
            .map_err(|error| format!("Could not read {}: {error}", source_path.display()))?;
        if count == 0 {
            break;
        }
        hasher.update(&buffer[..count]);
    }

    let id = hasher
        .finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    let extension = safe_extension(source_path);
    let file_name = format!("{id}.{extension}");
    let originals = workspace_root
        .join(&project.relative_path)
        .join(project_storage::asset_folder(&extension));
    fs::create_dir_all(&originals).map_err(|e|e.to_string())?;
    let target = originals.join(&file_name);
    let deduplicated = target.exists();
    if !deduplicated {
        let temp = originals.join(format!(".{file_name}.importing"));
        fs::copy(source_path, &temp).map_err(|error| {
            format!(
                "Could not copy asset from {} to {}: {error}",
                source_path.display(),
                temp.display()
            )
        })?;
        OpenOptions::new()
            .write(true)
            .open(&temp)
            .and_then(|file| file.sync_all())
            .map_err(|error| {
                format!("Could not flush imported asset {}: {error}", temp.display())
            })?;
        fs::rename(&temp, &target).map_err(|error| {
            format!(
                "Could not finish asset import {}: {error}",
                target.display()
            )
        })?;
    }

    let thumbnail_target = workspace_root
        .join(&project.relative_path)
        .join("assets/thumbnails")
        .join(format!("{id}.png"));
    let thumbnail_relative_path = generate_thumbnail(&target, &thumbnail_target)?
        .then(|| format!("{}/assets/thumbnails/{id}.png", project.relative_path));

    Ok(AssetRecord {
        image_dimensions: image_dimensions_from_header(&target),
        requires_tiled_preview: image_pyramid::needs_tiles(&target),
        id,
        relative_path: format!("{}/{}/{file_name}", project.relative_path,project_storage::asset_folder(&extension)),
        original_name: source_path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("Imported asset")
            .to_owned(),
        byte_length,
        extension,
        deduplicated,
        thumbnail_relative_path,
    })
}

fn safe_library_segment(value: &str, fallback: &str) -> String {
    let cleaned = value
        .trim()
        .chars()
        .map(|character| {
            if character.is_control()
                || matches!(
                    character,
                    '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*'
                )
            {
                '_'
            } else {
                character
            }
        })
        .collect::<String>()
        .trim_matches(|character: char| character == '.' || character.is_whitespace())
        .chars()
        .take(90)
        .collect::<String>();
    if cleaned.is_empty()
        || matches!(
            cleaned.to_ascii_uppercase().as_str(),
            "CON"
                | "PRN"
                | "AUX"
                | "NUL"
                | "COM1"
                | "COM2"
                | "COM3"
                | "COM4"
                | "COM5"
                | "COM6"
                | "COM7"
                | "COM8"
                | "COM9"
                | "LPT1"
                | "LPT2"
                | "LPT3"
                | "LPT4"
                | "LPT5"
                | "LPT6"
                | "LPT7"
                | "LPT8"
                | "LPT9"
        )
    {
        fallback.to_owned()
    } else {
        cleaned
    }
}

fn materialize_asset_view(
    workspace_root: &Path,
    project_id: &str,
    asset_id: &str,
    source_relative_path: &str,
    display_name: &str,
    virtual_folder: &str,
    extension: &str,
    existing_relative_path: Option<&str>,
) -> Result<MaterializedAsset, String> {
    let project_id = validate_id(project_id, "Project ID")?;
    let asset_id = validate_id(asset_id, "Asset ID")?;
    let source_relative = validate_relative_path(source_relative_path)?;
    let project = project_root(workspace_root, &project_id)?;
    let project_canonical=project.canonicalize().map_err(|e|e.to_string())?;
    let source = workspace_root
        .join(source_relative)
        .canonicalize()
        .map_err(|error| format!("Could not locate managed asset source: {error}"))?;
    let legacy_originals=project_canonical.join("assets/originals");
    let sorted_original=source.starts_with(project_canonical.join(project_storage::asset_folder(extension))) && source.file_name().and_then(|v|v.to_str())==Some(format!("{asset_id}.{extension}").as_str());
    if !source.starts_with(&project_canonical) || (!source.starts_with(&legacy_originals)&&!sorted_original) || !source.is_file() {
        return Err("Only immutable project originals can be materialized".to_owned());
    }
    let mut folder = project.join("assets/library");
    for segment in virtual_folder
        .split(['/', '\\'])
        .filter(|segment| !segment.trim().is_empty())
        .take(8)
    {
        folder.push(safe_library_segment(segment, "Unsorted"));
    }
    fs::create_dir_all(&folder).map_err(|error| {
        format!(
            "Could not create managed library folder {}: {error}",
            folder.display()
        )
    })?;
    let extension = safe_library_segment(extension.trim_start_matches('.'), "bin");
    let stem = safe_library_segment(
        display_name.trim_end_matches(&format!(".{extension}")),
        "Asset",
    );
    let mut target = folder.join(format!("{stem}.{extension}"));
    let old_target = existing_relative_path
        .and_then(|relative| validate_relative_path(relative).ok())
        .map(|relative| workspace_root.join(relative));
    if target.exists() && old_target.as_ref() != Some(&target) {
        for number in 2..10_000 {
            let candidate = folder.join(format!("{stem} ({number}).{extension}"));
            if !candidate.exists() {
                target = candidate;
                break;
            }
        }
    }
    if !target.exists() {
        fs::hard_link(&source, &target).map_err(|error| {
            format!(
                "Could not create the zero-copy managed file {}: {error}",
                target.display()
            )
        })?;
    }
    if let Some(previous) = old_target.filter(|previous| {
        previous != &target && previous.starts_with(project.join("assets/library"))
    }) {
        let _ = fs::remove_file(previous);
    }
    let relative = target
        .strip_prefix(workspace_root)
        .map_err(|_| "Managed path escaped the workspace".to_owned())?;
    Ok(MaterializedAsset {
        id: asset_id,
        managed_relative_path: relative.to_string_lossy().replace('\\', "/"),
    })
}

fn atomic_write(target: &Path, bytes: &[u8]) -> Result<bool, String> {
    let parent = target
        .parent()
        .ok_or_else(|| "The target file has no parent directory".to_owned())?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("Could not create {}: {error}", parent.display()))?;

    let extension = target
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("json");
    let temp = target.with_extension(format!("{extension}.tmp"));
    let backup = target.with_extension(format!("{extension}.backup"));

    let mut file = File::create(&temp).map_err(|error| {
        format!(
            "Could not create temporary save {}: {error}",
            temp.display()
        )
    })?;
    file.write_all(bytes)
        .and_then(|_| file.sync_all())
        .map_err(|error| format!("Could not flush temporary save {}: {error}", temp.display()))?;

    let mut backup_created = false;
    if target.exists() {
        if backup.exists() {
            fs::remove_file(&backup).map_err(|error| {
                format!("Could not rotate backup {}: {error}", backup.display())
            })?;
        }
        fs::rename(target, &backup).map_err(|error| {
            format!(
                "Could not preserve previous save {}: {error}",
                target.display()
            )
        })?;
        backup_created = true;
    }

    if let Err(error) = fs::rename(&temp, target) {
        if backup_created {
            let _ = fs::rename(&backup, target);
        }
        return Err(format!(
            "Could not install completed save {}: {error}",
            target.display()
        ));
    }

    Ok(backup_created)
}

fn lock_owner_pid(lock_path: &Path) -> Option<u32> {
    let contents = fs::read_to_string(lock_path).ok()?;
    contents
        .lines()
        .find_map(|line| line.strip_prefix("pid="))?
        .trim()
        .parse()
        .ok()
}

fn process_is_running(pid: u32) -> bool {
    let pid = Pid::from_u32(pid);
    let mut system = System::new();
    system.refresh_processes(ProcessesToUpdate::Some(&[pid]), true);
    system.process(pid).is_some()
}

fn acquire_workspace_lock(lock_path: &Path) -> Result<(bool, bool), String> {
    for _ in 0..2 {
        match OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(lock_path)
        {
            Ok(mut lock) => {
                writeln!(
                    lock,
                    "pid={}\nstartedAtUnixMs={}",
                    std::process::id(),
                    unix_millis()
                )
                .map_err(|error| format!("Could not write workspace lock: {error}"))?;
                lock.sync_all()
                    .map_err(|error| format!("Could not flush workspace lock: {error}"))?;
                return Ok((true, false));
            }
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
                if lock_owner_pid(lock_path).is_some_and(process_is_running) {
                    return Ok((false, true));
                }
                match fs::remove_file(lock_path) {
                    Ok(()) => continue,
                    Err(remove_error) if remove_error.kind() == std::io::ErrorKind::NotFound => {
                        continue;
                    }
                    Err(remove_error) => {
                        return Err(format!(
                            "Could not recover stale workspace lock {}: {remove_error}",
                            lock_path.display()
                        ));
                    }
                }
            }
            Err(error) => return Err(format!("Could not acquire workspace lock: {error}")),
        }
    }
    Ok((false, true))
}

fn initialize_workspace() -> Result<WorkspaceState, String> {
    let root = resolve_workspace_root()?;
    for directory in ["projects", "logs"] {
        fs::create_dir_all(root.join(directory)).map_err(|error| {
            format!("Could not create workspace directory {directory}: {error}")
        })?;
    }

    let manifest_path = root.join("workspace.json");
    let manifest = if manifest_path.exists() {
        let text = fs::read_to_string(&manifest_path)
            .map_err(|error| format!("Could not read {}: {error}", manifest_path.display()))?;
        serde_json::from_str::<WorkspaceManifest>(&text)
            .map_err(|error| format!("Workspace manifest is invalid: {error}"))?
    } else {
        let manifest = WorkspaceManifest {
            schema_version: 1,
            workspace_id: uuid::Uuid::new_v4().to_string(),
            name: root
                .file_name()
                .and_then(|value| value.to_str())
                .unwrap_or("Art Equation Workspace")
                .to_owned(),
            created_at_unix_ms: unix_millis(),
        };
        let bytes = serde_json::to_vec_pretty(&manifest)
            .map_err(|error| format!("Could not serialize workspace manifest: {error}"))?;
        atomic_write(&manifest_path, &bytes)?;
        manifest
    };

    let lock_path = root.join(LOCK_FILENAME);
    let (owns_lock, read_only) = acquire_workspace_lock(&lock_path)?;

    Ok(WorkspaceState {
        root,
        lock_path,
        owns_lock,
        read_only,
        workspace_id: manifest.workspace_id,
    })
}

#[tauri::command]
fn workspace_info(state: State<'_, WorkspaceState>) -> WorkspaceInfo {
    WorkspaceInfo {
        root: state.root.to_string_lossy().to_string(),
        workspace_id: state.workspace_id.clone(),
        read_only: state.read_only,
        lock_owned: state.owns_lock,
        storage_schema: 2,
    }
}

#[tauri::command]
fn record_frontend_diagnostic(message: String) -> Result<(), String> {
    let trimmed = message.trim();
    if trimmed.is_empty() {
        return Ok(());
    }
    let bounded = trimmed.chars().take(16_000).collect::<String>();
    append_diagnostic("frontend-crash.log", &bounded);
    Ok(())
}

#[tauri::command]
fn record_performance_batch(batch: String) -> Result<(), String> {
    static WRITE_LOCK:std::sync::Mutex<()>=std::sync::Mutex::new(());
    let _guard=WRITE_LOCK.lock().map_err(|_|"Telemetry writer unavailable")?;
    if batch.len() > 256_000 { return Err("Diagnostic batch too large".into()); }
    let value: Value = serde_json::from_str(&batch).map_err(|error| error.to_string())?;
    let path = diagnostic_log_path("performance.jsonl").ok_or("Diagnostics folder unavailable")?;
    // Bounded local-only ring; no project content, screenshots or network upload.
    if fs::metadata(&path).map(|meta| meta.len() > 2_000_000).unwrap_or(false) {
        let previous = path.with_file_name("performance.previous.jsonl");
        if previous.exists() { fs::remove_file(&previous).map_err(|error| error.to_string())?; }
        fs::rename(&path, previous).map_err(|error| error.to_string())?;
    }
    let mut file = OpenOptions::new().create(true).append(true).open(path).map_err(|error| error.to_string())?;
    writeln!(file, "{}", serde_json::to_string(&value).map_err(|error| error.to_string())?).map_err(|error| error.to_string())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ProjectBPreflightContext {
    enabled: bool,
    webview2_runtime: Option<String>,
}

#[tauri::command]
fn project_b_preflight_context() -> ProjectBPreflightContext {
    ProjectBPreflightContext {
        enabled: std::env::var("ART_EQUATION_PROJECT_B_PREFLIGHT").as_deref() == Ok("1"),
        webview2_runtime: tauri::webview_version().ok(),
    }
}

#[tauri::command]
fn record_project_b_preflight(report: Value) -> Result<(), String> {
    let serialized = serde_json::to_string_pretty(&report).map_err(|error| error.to_string())?;
    append_diagnostic("project-b-preflight.jsonl", &serialized);
    Ok(())
}

#[tauri::command]
fn list_projects(state: State<'_, WorkspaceState>) -> Result<Vec<ProjectSummary>, String> {
    discover_projects(&state.root)
}

#[tauri::command]
fn trash_project(project_id: String, state: State<'_, WorkspaceState>) -> Result<String, String> {
    if state.read_only {
        return Err("This workspace is read-only".to_owned());
    }
    let id = validate_id(&project_id, "Project ID")?;
    let source = state.root.join("projects").join(&id);
    if source.join("state.sqlite").exists(){project_storage::request(source.clone(),id.clone(),"close",serde_json::json!({}))?;}
    if !source.is_dir() {
        return Err("Project was not found".to_owned());
    }
    let trash = state.root.join(".trash").join("projects");
    fs::create_dir_all(&trash)
        .map_err(|error| format!("Could not create recovery trash: {error}"))?;
    let target = trash.join(format!("{}-{}", id, unix_millis()));
    fs::rename(&source, &target)
        .map_err(|error| format!("Could not move project to recovery trash: {error}"))?;
    Ok(target.to_string_lossy().to_string())
}

#[tauri::command]
fn list_trashed_projects(state: State<'_, WorkspaceState>) -> Result<Vec<ProjectSummary>, String> {
    let root = state.root.join(".trash");
    if !root.join("projects").is_dir() {
        return Ok(Vec::new());
    }
    discover_projects(&root)
}

#[tauri::command]
fn restore_trashed_project(
    project_id: String,
    state: State<'_, WorkspaceState>,
) -> Result<String, String> {
    if state.read_only {
        return Err("This workspace is read-only".to_owned());
    }
    let id = validate_id(&project_id, "Project ID")?;
    let trash = state.root.join(".trash").join("projects");
    let source = fs::read_dir(&trash)
        .ok()
        .into_iter()
        .flatten()
        .flatten()
        .filter(|entry| entry.file_type().map(|kind| kind.is_dir()).unwrap_or(false))
        .filter(|entry| {
            entry
                .file_name()
                .to_string_lossy()
                .starts_with(&format!("{}-", id))
        })
        .max_by_key(|entry| entry.metadata().and_then(|meta| meta.modified()).ok());
    let Some(source) = source else {
        return Err("Trashed project was not found".to_owned());
    };
    let target = state.root.join("projects").join(&id);
    if target.exists() {
        return Err("A project with this ID already exists".to_owned());
    }
    fs::rename(source.path(), &target)
        .map_err(|error| format!("Could not restore project: {error}"))?;
    Ok(id)
}

// ---------- Project-local object trash (Adutt scope v2, phase 1) ----------
// Deleted canvas objects and assets live in projects/<id>/trash. Files are
// moved, never deleted; index.json carries the entries the frontend records
// (serialized object, placement history, original path) so restore can
// rebuild the exact prior state.

fn project_trash_dir(workspace_root: &Path, project_id: &str) -> Result<PathBuf, String> {
    Ok(project_root(workspace_root, project_id)?.join("trash"))
}

fn read_trash_index_at(trash_dir: &Path) -> Vec<Value> {
    fs::read_to_string(trash_dir.join("index.json"))
        .ok()
        .and_then(|text| serde_json::from_str::<Value>(&text).ok())
        .and_then(|value| value.as_array().cloned())
        .unwrap_or_default()
}

fn write_trash_index_at(trash_dir: &Path, entries: &[Value]) -> Result<(), String> {
    fs::create_dir_all(trash_dir)
        .map_err(|error| format!("Could not create project trash folder: {error}"))?;
    let bytes = serde_json::to_vec_pretty(entries)
        .map_err(|error| format!("Could not encode the trash index: {error}"))?;
    atomic_write(&trash_dir.join("index.json"), &bytes)
        .map(|_| ())
        .map_err(|error| format!("Could not save the trash index: {error}"))
}

fn move_path_to_trash_at(
    workspace_root: &Path,
    project_id: &str,
    relative_path: &str,
) -> Result<String, String> {
    let source = validate_relative_path(relative_path)?;
    let absolute = workspace_root.join(&source);
    if !absolute.is_file() {
        return Err(format!("{relative_path} was not found in the workspace"));
    }
    let trash_files = project_trash_dir(workspace_root, project_id)?.join("files");
    fs::create_dir_all(&trash_files)
        .map_err(|error| format!("Could not create project trash folder: {error}"))?;
    let file_name = absolute
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| "The file name is not valid".to_owned())?
        .to_owned();
    let target = trash_files.join(format!("{}-{}", unix_millis(), file_name));
    fs::rename(&absolute, &target)
        .map_err(|error| format!("Could not move {relative_path} to the project trash: {error}"))?;
    let relative_target = target
        .strip_prefix(workspace_root)
        .map_err(|error| format!("Could not locate the trash copy: {error}"))?;
    Ok(relative_target
        .to_string_lossy()
        .replace(std::path::MAIN_SEPARATOR, "/"))
}

fn restore_trash_file_at(
    workspace_root: &Path,
    project_id: &str,
    trash_relative_path: &str,
    original_relative_path: &str,
) -> Result<(), String> {
    let trash_dir = project_trash_dir(workspace_root, project_id)?;
    let trash_file = validate_relative_path(trash_relative_path)?;
    let absolute_trash = workspace_root.join(&trash_file);
    if !absolute_trash.starts_with(&trash_dir) || !absolute_trash.is_file() {
        return Err("That file is not in this project's trash".to_owned());
    }
    let original = validate_relative_path(original_relative_path)?;
    let absolute_original = workspace_root.join(&original);
    if absolute_original.exists() {
        return Err(format!(
            "{original_relative_path} already exists in the workspace"
        ));
    }
    if let Some(parent) = absolute_original.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Could not recreate the original folder: {error}"))?;
    }
    fs::rename(&absolute_trash, &absolute_original)
        .map_err(|error| format!("Could not restore the file: {error}"))
}

fn record_trash_entry_at(
    workspace_root: &Path,
    project_id: &str,
    entry: Value,
) -> Result<(), String> {
    let Some(id) = entry.get("id").and_then(Value::as_str) else {
        return Err("Trash entries must carry an id".to_owned());
    };
    if id.trim().is_empty() {
        return Err("Trash entries must carry a non-empty id".to_owned());
    }
    let trash_dir = project_trash_dir(workspace_root, project_id)?;
    let mut entries = read_trash_index_at(&trash_dir);
    entries.retain(|existing| existing.get("id").and_then(Value::as_str) != Some(id));
    entries.push(entry);
    write_trash_index_at(&trash_dir, &entries)
}

fn remove_trash_entry_at(
    workspace_root: &Path,
    project_id: &str,
    entry_id: &str,
) -> Result<(), String> {
    let trash_dir = project_trash_dir(workspace_root, project_id)?;
    let mut entries = read_trash_index_at(&trash_dir);
    let before = entries.len();
    entries.retain(|existing| existing.get("id").and_then(Value::as_str) != Some(entry_id));
    if entries.len() == before {
        return Err("That trash entry was not found".to_owned());
    }
    write_trash_index_at(&trash_dir, &entries)
}

#[tauri::command]
fn list_project_trash(
    project_id: String,
    state: State<'_, WorkspaceState>,
) -> Result<Vec<Value>, String> {
    let id = validate_id(&project_id, "Project ID")?;
    Ok(read_trash_index_at(&project_trash_dir(&state.root, &id)?))
}

#[tauri::command]
fn record_trash_entry(
    project_id: String,
    entry: Value,
    state: State<'_, WorkspaceState>,
) -> Result<(), String> {
    if state.read_only {
        return Err("This workspace is read-only".to_owned());
    }
    let id = validate_id(&project_id, "Project ID")?;
    record_trash_entry_at(&state.root, &id, entry)
}

#[tauri::command]
fn remove_trash_entry(
    project_id: String,
    entry_id: String,
    state: State<'_, WorkspaceState>,
) -> Result<(), String> {
    if state.read_only {
        return Err("This workspace is read-only".to_owned());
    }
    let id = validate_id(&project_id, "Project ID")?;
    remove_trash_entry_at(&state.root, &id, &entry_id)
}

#[tauri::command]
fn move_path_to_trash(
    project_id: String,
    relative_path: String,
    state: State<'_, WorkspaceState>,
) -> Result<String, String> {
    if state.read_only {
        return Err("This workspace is read-only".to_owned());
    }
    let id = validate_id(&project_id, "Project ID")?;
    move_path_to_trash_at(&state.root, &id, &relative_path)
}

#[tauri::command]
fn restore_trash_file(
    project_id: String,
    trash_relative_path: String,
    original_relative_path: String,
    state: State<'_, WorkspaceState>,
) -> Result<(), String> {
    if state.read_only {
        return Err("This workspace is read-only".to_owned());
    }
    let id = validate_id(&project_id, "Project ID")?;
    restore_trash_file_at(&state.root, &id, &trash_relative_path, &original_relative_path)
}

fn discover_projects(workspace_root: &Path) -> Result<Vec<ProjectSummary>, String> {
    let projects_root = workspace_root.join("projects");
    let entries = fs::read_dir(&projects_root)
        .map_err(|error| format!("Could not read {}: {error}", projects_root.display()))?;
    let mut projects = Vec::new();
    for entry in entries.flatten() {
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        if !file_type.is_dir() {
            continue;
        }
        let Some(folder_id) = entry.file_name().to_str().map(str::to_owned) else {
            continue;
        };
        if validate_id(&folder_id, "Project ID").is_err() {
            continue;
        }
        let Ok(value) = project_storage::summary(&entry.path()) else {
            continue;
        };
        let id = value
            .get("id")
            .and_then(Value::as_str)
            .unwrap_or(&folder_id);
        if id != folder_id {
            continue;
        }
        let cover_asset_id = value
            .get("projectCoverAssetId")
            .and_then(Value::as_str)
            .or_else(|| {
                value
                    .get("boards")
                    .and_then(Value::as_array)
                    .and_then(|boards| {
                        boards.iter().find_map(|board| {
                            board
                                .get("coverAssetId")
                                .and_then(Value::as_str)
                                .or_else(|| {
                                    board
                                        .get("nodes")
                                        .and_then(Value::as_array)
                                        .and_then(|nodes| {
                                            nodes.iter().find_map(|node| {
                                                (node.get("kind").and_then(Value::as_str)
                                                    == Some("image"))
                                                .then(|| {
                                                    node.get("assetId").and_then(Value::as_str)
                                                })
                                                .flatten()
                                            })
                                        })
                                })
                        })
                    })
            });
        let cover_relative_path = cover_asset_id.and_then(|cover_id| {
            value
                .get("assets")
                .and_then(Value::as_array)
                .and_then(|assets| {
                    assets.iter().find_map(|asset| {
                        if asset.get("id").and_then(Value::as_str) != Some(cover_id) {
                            return None;
                        }
                        asset
                            .get("thumbnailRelativePath")
                            .and_then(Value::as_str)
                            .or_else(|| asset.get("relativePath").and_then(Value::as_str))
                            .map(str::to_owned)
                    })
                })
        });
        projects.push(ProjectSummary {
            id: folder_id.clone(),
            title: value
                .get("title")
                .and_then(Value::as_str)
                .unwrap_or("Untitled project")
                .to_owned(),
            updated_at: value
                .get("updatedAt")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_owned(),
            board_count: value
                .get("boards")
                .and_then(Value::as_array)
                .map_or(0, Vec::len),
            asset_count: value
                .get("assets")
                .and_then(Value::as_array)
                .map_or(0, Vec::len),
            tags: value
                .get("questionnaire")
                .and_then(|q| q.get("tags"))
                .and_then(Value::as_str)
                .map(str::to_owned),
            date: value
                .get("questionnaire")
                .and_then(|q| q.get("date"))
                .and_then(Value::as_str)
                .map(str::to_owned),
            status: value
                .get("status")
                .and_then(Value::as_str)
                .map(str::to_owned),
            cover_relative_path,
            cover_framing: value.get("projectCoverFraming").cloned(),
        });
    }
    projects.sort_by(|left, right| {
        right
            .updated_at
            .cmp(&left.updated_at)
            .then_with(|| left.title.cmp(&right.title))
    });
    Ok(projects)
}

#[tauri::command]
fn load_json(relative_path: String, state: State<'_, WorkspaceState>) -> Result<Value, String> {
    let relative = validate_relative_path(&relative_path)?;
    if let Some(project_id) = relative_path.strip_prefix("projects/").and_then(|v|v.strip_suffix("/project.json")) {
        validate_id(project_id,"Project ID")?;
        return project_storage::read_project(&project_root(&state.root,project_id)?);
    }
    let target = state.root.join(relative);
    let text = fs::read_to_string(&target)
        .map_err(|error| format!("Could not read {}: {error}", target.display()))?;
    serde_json::from_str(&text)
        .map_err(|error| format!("Invalid JSON in {}: {error}", target.display()))
}

#[tauri::command]
fn list_recovery_entries(
    project_id: String,
    state: State<'_, WorkspaceState>,
) -> Result<Vec<RecoveryEntry>, String> {
    let project = project_root(&state.root, &project_id)?;
    let mut entries = Vec::new();
    for (folder, kind) in [("backups", "backup"), ("journal", "journal")] {
        let root = project.join(folder);
        if !root.is_dir() {
            continue;
        }
        for item in
            fs::read_dir(&root).map_err(|error| format!("Could not inspect {folder}: {error}"))?
        {
            let item =
                item.map_err(|error| format!("Could not inspect recovery entry: {error}"))?;
            let metadata = item
                .metadata()
                .map_err(|error| format!("Could not inspect recovery entry: {error}"))?;
            if !metadata.is_file() {
                continue;
            }
            let modified_at_unix_ms = metadata
                .modified()
                .ok()
                .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
                .map(|duration| duration.as_millis())
                .unwrap_or(0);
            entries.push(RecoveryEntry {
                relative_path: item
                    .path()
                    .strip_prefix(&state.root)
                    .unwrap_or(item.path().as_path())
                    .to_string_lossy()
                    .replace('\\', "/"),
                kind: kind.to_owned(),
                byte_length: metadata.len(),
                modified_at_unix_ms,
            });
        }
    }
    entries.sort_by(|left, right| right.modified_at_unix_ms.cmp(&left.modified_at_unix_ms));
    Ok(entries)
}

#[tauri::command]
async fn save_json(
    relative_path: String,
    value: Value,
    state: State<'_, WorkspaceState>,
) -> Result<SaveResult, String> {
    if state.read_only {
        return Err("This workspace is already open in another writer and is read-only".to_owned());
    }
    let relative = validate_relative_path(&relative_path)?;
    if let Some(project_id) = relative_path.strip_prefix("projects/").and_then(|v|v.strip_suffix("/project.json")) {
        let project_id=validate_id(project_id,"Project ID")?;
        let root=project_root(&state.root,&project_id)?;
        let bytes_written=value.to_string().len();
        tauri::async_runtime::spawn_blocking(move||project_storage::full_save(root,project_id,value)).await.map_err(|e|e.to_string())??;
        return Ok(SaveResult{relative_path,bytes_written,backup_created:true});
    }
    let bytes = serde_json::to_vec_pretty(&value)
        .map_err(|error| format!("Could not serialize workspace data: {error}"))?;
    let backup_created = atomic_write(&state.root.join(&relative), &bytes)?;
    Ok(SaveResult {
        relative_path: relative.to_string_lossy().replace('\\', "/"),
        bytes_written: bytes.len(),
        backup_created,
    })
}

#[tauri::command]
fn ensure_project_workspace(
    project_id: String,
    state: State<'_, WorkspaceState>,
) -> Result<ProjectWorkspace, String> {
    if state.read_only {
        return Err("This workspace is already open in another writer and is read-only".to_owned());
    }
    create_project_directories(&state.root, &project_id)
}

#[tauri::command]
fn ensure_managed_board_folders(
    project_id: String,
    board_ids: Vec<String>,
    state: State<'_, WorkspaceState>,
) -> Result<Vec<String>, String> {
    if state.read_only {
        return Err("This workspace is already open in another writer and is read-only".to_owned());
    }
    let project_id = validate_id(&project_id, "Project ID")?;
    let base = project_root(&state.root, &project_id)?.join("boards");
    let mut paths = Vec::with_capacity(board_ids.len());
    for board_id in board_ids {
        let board_id = validate_id(&board_id, "Board ID")?;
        let folder = base.join(&board_id);
        fs::create_dir_all(&folder)
            .map_err(|error| format!("Could not create board folder {}: {error}", folder.display()))?;
        paths.push(format!("projects/{project_id}/boards/{board_id}"));
    }
    Ok(paths)
}

fn directory_byte_length(root: &Path) -> u64 {
    let Ok(entries) = fs::read_dir(root) else {
        return 0;
    };
    entries
        .flatten()
        .map(|entry| {
            entry.metadata().ok().map_or(0, |metadata| {
                if metadata.is_dir() {
                    directory_byte_length(&entry.path())
                } else {
                    metadata.len()
                }
            })
        })
        .sum()
}

fn semantic_ann_paths(semantic_root: &Path) -> (PathBuf, PathBuf) {
    (
        semantic_root.join(format!("{SEMANTIC_ANN_BASENAME}.hnsw.graph")),
        semantic_root.join(format!("{SEMANTIC_ANN_BASENAME}.hnsw.data")),
    )
}

fn semantic_ann_platform() -> String {
    format!(
        "{}-{}-{}-{}bit",
        std::env::consts::OS,
        std::env::consts::ARCH,
        if cfg!(target_endian = "little") {
            "little"
        } else {
            "big"
        },
        usize::BITS
    )
}

fn semantic_ann_is_compatible(semantic_root: &Path, manifest: &SemanticIndexManifest) -> bool {
    let Some(ann) = manifest.ann.as_ref() else {
        return false;
    };
    if ann.schema_version != SEMANTIC_ANN_SCHEMA_VERSION
        || ann.engine != "hnsw_rs"
        || ann.engine_version != "0.3.4"
        || ann.platform != semantic_ann_platform()
        || ann.generation != manifest.generation
        || Some(ann.dimension) != manifest.embedding_dimension
        || ann.indexed_count != manifest.indexed_count
        || ann.graph_sha256.len() != 64
        || ann.data_sha256.len() != 64
    {
        return false;
    }
    let (graph, data) = semantic_ann_paths(semantic_root);
    graph
        .metadata()
        .is_ok_and(|metadata| metadata.len() == ann.graph_bytes)
        && data
            .metadata()
            .is_ok_and(|metadata| metadata.len() == ann.data_bytes)
}

fn invalidate_semantic_ann_cache(semantic_root: &Path) {
    if let Some(cache) = SEMANTIC_ANN_CACHE.get() {
        if let Ok(mut cache) = cache.lock() {
            cache.remove(semantic_root);
        }
    }
}

fn with_semantic_ann<R>(
    semantic_root: &Path,
    manifest: &SemanticIndexManifest,
    operation: impl FnOnce(&mut CachedSemanticAnn) -> R,
) -> Result<R, String> {
    if !semantic_ann_is_compatible(semantic_root, manifest) {
        return Err("The ANN sidecar is unavailable or stale".to_owned());
    }
    let ann = manifest
        .ann
        .as_ref()
        .ok_or_else(|| "The ANN manifest is missing".to_owned())?;
    let cache = SEMANTIC_ANN_CACHE.get_or_init(|| Mutex::new(HashMap::new()));
    let mut cache = cache
        .lock()
        .map_err(|_| "The ANN memory cache is unavailable".to_owned())?;
    let valid_cached = cache.get(semantic_root).is_some_and(|cached| {
        cached.generation == manifest.generation
            && cached.graph_bytes == ann.graph_bytes
            && cached.data_bytes == ann.data_bytes
    });
    if !valid_cached {
        cache.remove(semantic_root);
        let (graph_path, data_path) = semantic_ann_paths(semantic_root);
        let (graph_sha256, _) = sha256_file(&graph_path)?;
        let (data_sha256, _) = sha256_file(&data_path)?;
        if graph_sha256 != ann.graph_sha256 || data_sha256 != ann.data_sha256 {
            return Err(
                "The ANN sidecar checksum does not match; exact search remains available"
                    .to_owned(),
            );
        }
        let loaded = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let loader: &'static mut HnswIo =
                Box::leak(Box::new(HnswIo::new(semantic_root, SEMANTIC_ANN_BASENAME)));
            loader
                .load_hnsw_with_dist::<f32, DistL2>(DistL2 {})
                .map_err(|error| format!("Could not reload the ANN sidecar: {error}"))
        }))
        .map_err(|_| "The ANN sidecar is corrupt; exact search remains available".to_owned())??;
        let records = read_semantic_records(semantic_root)?;
        let vector_bytes = fs::read(semantic_root.join("embeddings.f32"))
            .map_err(|error| format!("Could not cache semantic vectors: {error}"))?;
        cache.insert(
            semantic_root.to_path_buf(),
            CachedSemanticAnn {
                generation: manifest.generation,
                graph_bytes: ann.graph_bytes,
                data_bytes: ann.data_bytes,
                index: loaded,
                records,
                vector_bytes,
            },
        );
    }
    let cached = cache
        .get_mut(semantic_root)
        .ok_or_else(|| "The ANN cache did not initialize".to_owned())?;
    cached.index.set_searching_mode(true);
    Ok(operation(cached))
}

fn semantic_authoritative_files_valid(
    semantic_root: &Path,
    manifest: &SemanticIndexManifest,
) -> bool {
    if !matches!(manifest.state.as_str(), "ready" | "partial") {
        return true;
    }
    let Some(dimension) = manifest.embedding_dimension.map(|value| value as usize) else {
        return false;
    };
    let Ok(records) = read_semantic_records(semantic_root) else {
        return false;
    };
    if records.len() != manifest.source_count {
        return false;
    }
    let Ok(byte_length) =
        fs::metadata(semantic_root.join("embeddings.f32")).map(|metadata| metadata.len() as usize)
    else {
        return false;
    };
    records
        .iter()
        .filter(|record| record.embedding_state == "ready")
        .all(|record| {
            record
                .vector_offset
                .and_then(|offset| (offset as usize).checked_add(dimension.checked_mul(4)?))
                .is_some_and(|end| end <= byte_length)
        })
}

fn semantic_status_in(
    workspace_root: &Path,
    project_id: &str,
) -> Result<SemanticIndexStatus, String> {
    let semantic_root = project_root(workspace_root, project_id)?.join("semantic");
    let manifest_path = semantic_root.join("semantic-manifest.json");
    if !manifest_path.is_file() {
        return Ok(SemanticIndexStatus {
            state: "notIndexed".to_owned(),
            source_count: 0,
            indexed_count: 0,
            failed_count: 0,
            generation: 0,
            disk_bytes: directory_byte_length(&semantic_root),
            model_id: None,
            model_revision: None,
            updated_at_unix_ms: None,
            ann_state: "notBuilt".to_owned(),
            ann_indexed_count: 0,
            search_engine: "exact".to_owned(),
            ann_build_error: None,
        });
    }
    let text = fs::read_to_string(&manifest_path)
        .map_err(|error| format!("Could not read semantic manifest: {error}"))?;
    let manifest: SemanticIndexManifest = serde_json::from_str(&text)
        .map_err(|error| format!("Semantic index is corrupt and can be rebuilt: {error}"))?;
    if manifest.project_id != project_id {
        return Err("Semantic index belongs to a different project and must be rebuilt".to_owned());
    }
    let authoritative_valid = semantic_authoritative_files_valid(&semantic_root, &manifest);
    let ann_compatible =
        authoritative_valid && semantic_ann_is_compatible(&semantic_root, &manifest);
    let ann_state = if manifest.indexed_count < SEMANTIC_ANN_MIN_RECORDS {
        "notNeeded"
    } else if ann_compatible {
        "ready"
    } else if manifest.ann.is_some() {
        "rebuildRequired"
    } else {
        "notBuilt"
    };
    Ok(SemanticIndexStatus {
        state: if authoritative_valid {
            manifest.state
        } else {
            "rebuildRequired".to_owned()
        },
        source_count: manifest.source_count,
        indexed_count: manifest.indexed_count,
        failed_count: manifest.failed_count,
        generation: manifest.generation,
        disk_bytes: directory_byte_length(&semantic_root),
        model_id: manifest.model_id,
        model_revision: manifest.model_revision,
        updated_at_unix_ms: Some(manifest.updated_at_unix_ms),
        ann_state: ann_state.to_owned(),
        ann_indexed_count: manifest.ann.as_ref().map_or(0, |ann| ann.indexed_count),
        search_engine: if ann_compatible { "hnsw" } else { "exact" }.to_owned(),
        ann_build_error: manifest.ann_build_error,
    })
}

fn prepare_semantic_index_in(
    workspace_root: &Path,
    project_id: &str,
) -> Result<SemanticIndexStatus, String> {
    let project = project_root(workspace_root, project_id)?;
    let value=project_storage::read_project(&project)?;
    if value.get("id").and_then(Value::as_str) != Some(project_id) {
        return Err("Project identity does not match its portable folder".to_owned());
    }

    let mut records = Vec::<SemanticSourceRecord>::new();
    if let Some(assets) = value.get("assets").and_then(Value::as_array) {
        for asset in assets {
            if asset.get("kind").and_then(Value::as_str) != Some("image") {
                continue;
            }
            let Some(asset_id) = asset.get("id").and_then(Value::as_str) else {
                continue;
            };
            let Some(relative_path) = asset.get("relativePath").and_then(Value::as_str) else {
                continue;
            };
            if validate_relative_path(relative_path).is_err() {
                continue;
            }
            let content_sha256 = (asset_id.len() == 64
                && asset_id.bytes().all(|byte| byte.is_ascii_hexdigit()))
            .then(|| asset_id.to_ascii_lowercase());
            records.push(SemanticSourceRecord {
                record_id: format!("asset:{asset_id}"),
                asset_id: Some(asset_id.to_owned()),
                source_kind: if asset.get("generated").is_some() {
                    "derivedAsset"
                } else {
                    "managedAsset"
                }
                .to_owned(),
                relative_path: relative_path.to_owned(),
                content_sha256,
                byte_length: asset.get("byteLength").and_then(Value::as_u64),
                active: asset.get("status").and_then(Value::as_str) != Some("missing"),
                embedding_state: "pending".to_owned(),
                vector_offset: None,
            });
        }
    }
    if let Some(crops) = value.get("referenceCrops").and_then(Value::as_array) {
        for crop in crops {
            if crop.get("assetId").and_then(Value::as_str).is_some() {
                continue;
            }
            let Some(crop_id) = crop.get("id").and_then(Value::as_str) else {
                continue;
            };
            let Some(source_path) = crop.get("sourcePath").and_then(Value::as_str) else {
                continue;
            };
            records.push(SemanticSourceRecord {
                record_id: format!("crop:{crop_id}"),
                asset_id: None,
                source_kind: "savedCrop".to_owned(),
                relative_path: source_path.to_owned(),
                content_sha256: None,
                byte_length: None,
                active: Path::new(source_path).is_file(),
                embedding_state: "pending".to_owned(),
                vector_offset: None,
            });
        }
    }
    records.sort_by(|left, right| left.record_id.cmp(&right.record_id));

    let semantic_root = project.join("semantic");
    let manifest_path = semantic_root.join("semantic-manifest.json");
    let previous = fs::read_to_string(&manifest_path)
        .ok()
        .and_then(|text| serde_json::from_str::<SemanticIndexManifest>(&text).ok());
    let previous_records = previous
        .as_ref()
        .and_then(|_| read_semantic_records(&semantic_root).ok())
        .unwrap_or_default();
    let previous_by_id = previous_records
        .iter()
        .map(|record| (record.record_id.as_str(), record))
        .collect::<HashMap<_, _>>();
    let can_reuse_vectors = previous
        .as_ref()
        .and_then(|manifest| manifest.embedding_dimension)
        .is_some()
        && semantic_root.join("embeddings.f32").is_file();
    for record in &mut records {
        if can_reuse_vectors {
            if let Some(previous_record) = previous_by_id.get(record.record_id.as_str()) {
                if semantic_source_matches(record, previous_record)
                    && previous_record.embedding_state == "ready"
                    && previous_record.vector_offset.is_some()
                {
                    record.embedding_state = "ready".to_owned();
                    record.vector_offset = previous_record.vector_offset;
                }
            }
        }
        if !record.active {
            record.embedding_state = "unavailable".to_owned();
            record.vector_offset = None;
        }
    }
    let active_count = records.iter().filter(|record| record.active).count();
    let indexed_count = records
        .iter()
        .filter(|record| record.active && record.embedding_state == "ready")
        .count();
    let unchanged = records.len() == previous_records.len()
        && records.iter().all(|record| {
            previous_by_id
                .get(record.record_id.as_str())
                .is_some_and(|previous_record| semantic_source_matches(record, previous_record))
        });
    let now = unix_millis();
    let generation = previous.as_ref().map_or(1, |manifest| {
        if unchanged {
            manifest.generation
        } else {
            manifest.generation + 1
        }
    });
    let mut records_bytes = Vec::new();
    for record in &records {
        serde_json::to_writer(&mut records_bytes, record)
            .map_err(|error| format!("Could not serialize semantic source: {error}"))?;
        records_bytes.push(b'\n');
    }
    atomic_write(&semantic_root.join("records.jsonl"), &records_bytes)?;
    let manifest = SemanticIndexManifest {
        schema_version: 2,
        project_id: project_id.to_owned(),
        generation,
        state: if active_count == indexed_count {
            "ready".to_owned()
        } else if indexed_count > 0 {
            "stale".to_owned()
        } else {
            "prepared".to_owned()
        },
        model_id: previous.as_ref().and_then(|item| item.model_id.clone()),
        model_revision: previous
            .as_ref()
            .and_then(|item| item.model_revision.clone()),
        embedding_dimension: previous.as_ref().and_then(|item| item.embedding_dimension),
        source_count: records.len(),
        indexed_count,
        failed_count: 0,
        created_at_unix_ms: previous
            .as_ref()
            .map_or(now, |item| item.created_at_unix_ms),
        updated_at_unix_ms: now,
        ann: if unchanged {
            previous.as_ref().and_then(|item| item.ann.clone())
        } else {
            None
        },
        ann_build_error: if unchanged {
            previous
                .as_ref()
                .and_then(|item| item.ann_build_error.clone())
        } else {
            None
        },
    };
    let manifest_bytes = serde_json::to_vec_pretty(&manifest)
        .map_err(|error| format!("Could not serialize semantic manifest: {error}"))?;
    atomic_write(&manifest_path, &manifest_bytes)?;
    semantic_status_in(workspace_root, project_id)
}

#[tauri::command]
fn semantic_index_status(
    project_id: String,
    state: State<'_, WorkspaceState>,
) -> Result<SemanticIndexStatus, String> {
    let project_id = validate_id(&project_id, "Project ID")?;
    semantic_status_in(&state.root, &project_id)
}

#[tauri::command]
fn prepare_semantic_index(
    project_id: String,
    state: State<'_, WorkspaceState>,
) -> Result<SemanticIndexStatus, String> {
    if state.read_only {
        return Err("This workspace is already open in another writer and is read-only".to_owned());
    }
    let project_id = validate_id(&project_id, "Project ID")?;
    prepare_semantic_index_in(&state.root, &project_id)
}

fn read_semantic_records(semantic_root: &Path) -> Result<Vec<SemanticSourceRecord>, String> {
    let text = fs::read_to_string(semantic_root.join("records.jsonl"))
        .map_err(|error| format!("Semantic sources are not prepared: {error}"))?;
    text.lines()
        .filter(|line| !line.trim().is_empty())
        .map(|line| {
            serde_json::from_str::<SemanticSourceRecord>(line).map_err(|error| {
                format!("Semantic source catalog is corrupt and can be rebuilt: {error}")
            })
        })
        .collect()
}

fn ann_safe_vector(vector: &[f32]) -> Vec<f32> {
    let magnitude = vector.iter().map(|value| value * value).sum::<f32>().sqrt();
    let scale = if magnitude > 0.0 {
        1.0 / magnitude
    } else {
        1.0
    };
    vector.iter().map(|value| value * scale).collect()
}

fn build_semantic_ann(
    semantic_root: &Path,
    generation: u64,
    dimension: u32,
    records: &[SemanticSourceRecord],
    vector_bytes: &[u8],
) -> Result<SemanticAnnMetadata, String> {
    let mut vectors = Vec::<(Vec<f32>, usize)>::new();
    for (record_index, record) in records.iter().enumerate() {
        if !record.active || record.embedding_state != "ready" {
            continue;
        }
        let offset = record
            .vector_offset
            .ok_or_else(|| "A ready semantic record has no vector offset".to_owned())?
            as usize;
        let end = offset
            .checked_add(dimension as usize * 4)
            .ok_or_else(|| "Semantic ANN vector offset overflowed".to_owned())?;
        if end > vector_bytes.len() {
            return Err("Semantic vectors are truncated; rebuild the index".to_owned());
        }
        let vector = (0..dimension as usize)
            .map(|index| {
                let start = offset + index * 4;
                f32::from_le_bytes(
                    vector_bytes[start..start + 4]
                        .try_into()
                        .expect("validated vector slice"),
                )
            })
            .collect::<Vec<_>>();
        vectors.push((ann_safe_vector(&vector), record_index));
    }
    if vectors.len() < SEMANTIC_ANN_MIN_RECORDS {
        return Err("The project does not need an ANN index yet".to_owned());
    }

    // Euclidean distance on unit vectors has the same cosine ranking but
    // supplies a metric for graph traversal. Keep original dot scores below.
    // Version 1 sidecars remain disposable; compatibility chooses exact search.
    let mut hnsw = Hnsw::<f32, DistL2>::new(
        SEMANTIC_ANN_M,
        vectors.len(),
        16,
        SEMANTIC_ANN_EF_CONSTRUCTION,
        DistL2 {},
    );
    hnsw.modify_level_scale(0.5);
    // Preserve the diversity heuristic instead of filling links with pruned,
    // tightly clustered neighbours. Disperse construction order so adjacent
    // project records do not create poorly connected clusters. IDs still point
    // to the original record order; no authoritative data is reordered.
    let mut insertion_order = (0..vectors.len()).collect::<Vec<_>>();
    insertion_order.sort_unstable_by_key(|index| {
        let mut hash = (*index as u64).wrapping_add(0x9e37_79b9_7f4a_7c15);
        hash = (hash ^ (hash >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
        hash = (hash ^ (hash >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
        hash ^ (hash >> 31)
    });
    for index in insertion_order {
        let (vector, id) = &vectors[index];
        hnsw.insert_slice((vector.as_slice(), *id));
    }
    hnsw.set_searching_mode(true);

    // Refuse publication of a graph that cannot recover its own known vectors.
    // A failed derivative leaves the authoritative embeddings/exact search intact.
    let stride = (vectors.len() / 16).max(1);
    for (vector, _) in vectors.iter().step_by(stride).take(16) {
        if hnsw.search(vector, 1, SEMANTIC_ANN_EF_SEARCH).first().is_none_or(|hit| hit.distance > 1e-5) {
            return Err("ANN self-retrieval validation failed; exact search remains available".to_owned());
        }
    }

    let staging_basename = format!("{SEMANTIC_ANN_BASENAME}-staging-{}", uuid::Uuid::new_v4());
    let staging_graph = semantic_root.join(format!("{staging_basename}.hnsw.graph"));
    let staging_data = semantic_root.join(format!("{staging_basename}.hnsw.data"));
    if let Err(error) = hnsw.file_dump(semantic_root, &staging_basename) {
        let _ = fs::remove_file(&staging_graph);
        let _ = fs::remove_file(&staging_data);
        return Err(format!("Could not persist the ANN graph: {error}"));
    }
    let graph_bytes = fs::read(&staging_graph)
        .map_err(|error| format!("Could not read staged ANN graph: {error}"))?;
    let data_bytes = fs::read(&staging_data)
        .map_err(|error| format!("Could not read staged ANN data: {error}"))?;
    let (graph_path, data_path) = semantic_ann_paths(semantic_root);
    atomic_write(&graph_path, &graph_bytes)?;
    atomic_write(&data_path, &data_bytes)?;
    invalidate_semantic_ann_cache(semantic_root);
    let _ = fs::remove_file(staging_graph);
    let _ = fs::remove_file(staging_data);
    Ok(SemanticAnnMetadata {
        schema_version: SEMANTIC_ANN_SCHEMA_VERSION,
        engine: "hnsw_rs".to_owned(),
        engine_version: "0.3.4".to_owned(),
        platform: semantic_ann_platform(),
        generation,
        dimension,
        indexed_count: vectors.len(),
        max_connections: SEMANTIC_ANN_M,
        ef_construction: SEMANTIC_ANN_EF_CONSTRUCTION,
        ef_search: SEMANTIC_ANN_EF_SEARCH,
        graph_bytes: graph_bytes.len() as u64,
        data_bytes: data_bytes.len() as u64,
        graph_sha256: Sha256::digest(&graph_bytes)
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect(),
        data_sha256: Sha256::digest(&data_bytes)
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect(),
        built_at_unix_ms: unix_millis(),
    })
}

fn semantic_ann_neighbor_lists(
    semantic_root: &Path,
    manifest: &SemanticIndexManifest,
    vectors: &[Vec<f32>],
    neighbor_count: usize,
) -> Result<Vec<Vec<usize>>, String> {
    if !semantic_ann_is_compatible(semantic_root, manifest) {
        return Err("Build the project ANN index before large-library clustering".to_owned());
    }
    let queries = vectors
        .iter()
        .map(|vector| ann_safe_vector(vector))
        .collect::<Vec<_>>();
    let ef_search = manifest
        .ann
        .as_ref()
        .map_or(SEMANTIC_ANN_EF_SEARCH, |ann| ann.ef_search)
        .max(neighbor_count)
        .min(manifest.indexed_count.max(neighbor_count));
    std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        with_semantic_ann(semantic_root, manifest, |cached| {
            cached
                .index
                .parallel_search(&queries, neighbor_count, ef_search)
                .into_iter()
                .map(|neighbors| {
                    neighbors
                        .into_iter()
                        .map(|neighbor| neighbor.d_id)
                        .collect()
                })
                .collect()
        })
    }))
    .map_err(|_| "The ANN search failed; rebuild it before large-library clustering".to_owned())?
}

#[tauri::command]
fn list_semantic_sources(
    project_id: String,
    state: State<'_, WorkspaceState>,
) -> Result<Vec<SemanticSourceRecord>, String> {
    let project_id = validate_id(&project_id, "Project ID")?;
    let semantic_root = project_root(&state.root, &project_id)?.join("semantic");
    read_semantic_records(&semantic_root)
}

fn commit_semantic_embeddings_in(
    workspace_root: &Path,
    project_id: &str,
    model_id: &str,
    model_revision: &str,
    dimension: u32,
    embeddings: Vec<SemanticEmbeddingInput>,
) -> Result<SemanticIndexStatus, String> {
    if model_id.trim().is_empty() || model_revision.trim().is_empty() {
        return Err("Semantic model identity is required".to_owned());
    }
    if dimension == 0 || dimension > 16_384 {
        return Err("Semantic embedding dimension is invalid".to_owned());
    }
    let semantic_root = project_root(workspace_root, project_id)?.join("semantic");
    let manifest_path = semantic_root.join("semantic-manifest.json");
    let text = fs::read_to_string(&manifest_path)
        .map_err(|error| format!("Could not read semantic manifest: {error}"))?;
    let mut manifest: SemanticIndexManifest = serde_json::from_str(&text)
        .map_err(|error| format!("Semantic manifest is corrupt: {error}"))?;
    let mut records = read_semantic_records(&semantic_root)?;
    let mut incoming = HashMap::new();
    for embedding in embeddings {
        if embedding.vector.len() != dimension as usize
            || embedding.vector.iter().any(|value| !value.is_finite())
        {
            return Err(format!(
                "Embedding {} has invalid values or dimensions",
                embedding.record_id
            ));
        }
        if incoming
            .insert(embedding.record_id.clone(), embedding.vector)
            .is_some()
        {
            return Err(format!(
                "Embedding {} was submitted more than once",
                embedding.record_id
            ));
        }
    }
    let old_vector_bytes = if manifest.embedding_dimension == Some(dimension) {
        fs::read(semantic_root.join("embeddings.f32")).unwrap_or_default()
    } else {
        Vec::new()
    };
    let mut vector_bytes =
        Vec::with_capacity((incoming.len() + records.len()) * dimension as usize * 4);
    let mut indexed_count = 0;
    for record in &mut records {
        if let Some(vector) = incoming.remove(&record.record_id) {
            let offset = vector_bytes.len() as u64;
            for value in vector {
                vector_bytes.extend_from_slice(&value.to_le_bytes());
            }
            record.embedding_state = "ready".to_owned();
            record.vector_offset = Some(offset);
            indexed_count += 1;
        } else if record.active && record.embedding_state == "ready" {
            let Some(start) = record.vector_offset.map(|offset| offset as usize) else {
                record.embedding_state = "pending".to_owned();
                continue;
            };
            let Some(end) = start.checked_add(dimension as usize * 4) else {
                record.embedding_state = "pending".to_owned();
                record.vector_offset = None;
                continue;
            };
            if end > old_vector_bytes.len() {
                record.embedding_state = "pending".to_owned();
                record.vector_offset = None;
                continue;
            }
            let offset = vector_bytes.len() as u64;
            vector_bytes.extend_from_slice(&old_vector_bytes[start..end]);
            record.vector_offset = Some(offset);
            indexed_count += 1;
        } else {
            record.embedding_state = if record.active {
                "pending"
            } else {
                "unavailable"
            }
            .to_owned();
            record.vector_offset = None;
        }
    }
    if !incoming.is_empty() {
        return Err("Embedding results include unknown project sources".to_owned());
    }
    let mut record_bytes = Vec::new();
    for record in &records {
        serde_json::to_writer(&mut record_bytes, record)
            .map_err(|error| format!("Could not serialize semantic record: {error}"))?;
        record_bytes.push(b'\n');
    }
    atomic_write(&semantic_root.join("embeddings.f32"), &vector_bytes)?;
    atomic_write(&semantic_root.join("records.jsonl"), &record_bytes)?;
    manifest.model_id = Some(model_id.to_owned());
    manifest.model_revision = Some(model_revision.to_owned());
    manifest.embedding_dimension = Some(dimension);
    manifest.indexed_count = indexed_count;
    manifest.failed_count = records
        .iter()
        .filter(|record| record.embedding_state == "failed")
        .count();
    manifest.state = if indexed_count == records.iter().filter(|record| record.active).count() {
        "ready"
    } else {
        "partial"
    }
    .to_owned();
    manifest.updated_at_unix_ms = unix_millis();
    manifest.schema_version = 2;
    manifest.ann = None;
    manifest.ann_build_error = None;
    if indexed_count >= SEMANTIC_ANN_MIN_RECORDS {
        match build_semantic_ann(
            &semantic_root,
            manifest.generation,
            dimension,
            &records,
            &vector_bytes,
        ) {
            Ok(ann) => manifest.ann = Some(ann),
            Err(error) => manifest.ann_build_error = Some(error),
        }
    }
    let bytes = serde_json::to_vec_pretty(&manifest)
        .map_err(|error| format!("Could not serialize semantic manifest: {error}"))?;
    atomic_write(&manifest_path, &bytes)?;
    semantic_status_in(workspace_root, project_id)
}

#[tauri::command]
fn commit_semantic_embeddings(
    project_id: String,
    model_id: String,
    model_revision: String,
    dimension: u32,
    embeddings: Vec<SemanticEmbeddingInput>,
    state: State<'_, WorkspaceState>,
) -> Result<SemanticIndexStatus, String> {
    if state.read_only {
        return Err("This workspace is already open in another writer and is read-only".to_owned());
    }
    let project_id = validate_id(&project_id, "Project ID")?;
    commit_semantic_embeddings_in(
        &state.root,
        &project_id,
        &model_id,
        &model_revision,
        dimension,
        embeddings,
    )
}

fn rebuild_semantic_ann_in(
    workspace_root: &Path,
    project_id: &str,
) -> Result<SemanticIndexStatus, String> {
    let semantic_root = project_root(workspace_root, project_id)?.join("semantic");
    let manifest_path = semantic_root.join("semantic-manifest.json");
    let mut manifest: SemanticIndexManifest = serde_json::from_str(
        &fs::read_to_string(&manifest_path)
            .map_err(|error| format!("Could not read semantic manifest: {error}"))?,
    )
    .map_err(|error| format!("Semantic manifest is corrupt and must be rebuilt: {error}"))?;
    if !semantic_authoritative_files_valid(&semantic_root, &manifest) {
        return Err("The authoritative semantic vectors are incomplete; rebuild embeddings before repairing ANN acceleration".to_owned());
    }
    if manifest.indexed_count < SEMANTIC_ANN_MIN_RECORDS {
        manifest.ann = None;
        manifest.ann_build_error = None;
    } else {
        let dimension = manifest
            .embedding_dimension
            .ok_or_else(|| "The semantic index has no vector dimension".to_owned())?;
        let records = read_semantic_records(&semantic_root)?;
        let vector_bytes = fs::read(semantic_root.join("embeddings.f32"))
            .map_err(|error| format!("Could not read semantic vectors: {error}"))?;
        match build_semantic_ann(
            &semantic_root,
            manifest.generation,
            dimension,
            &records,
            &vector_bytes,
        ) {
            Ok(ann) => {
                manifest.ann = Some(ann);
                manifest.ann_build_error = None;
            }
            Err(error) => {
                manifest.ann = None;
                manifest.ann_build_error = Some(error.clone());
            }
        }
    }
    manifest.schema_version = 2;
    manifest.updated_at_unix_ms = unix_millis();
    atomic_write(
        &manifest_path,
        &serde_json::to_vec_pretty(&manifest)
            .map_err(|error| format!("Could not save semantic manifest: {error}"))?,
    )?;
    semantic_status_in(workspace_root, project_id)
}

#[tauri::command]
fn rebuild_semantic_ann(
    project_id: String,
    state: State<'_, WorkspaceState>,
) -> Result<SemanticIndexStatus, String> {
    if state.read_only {
        return Err("This workspace is already open in another writer and is read-only".to_owned());
    }
    let project_id = validate_id(&project_id, "Project ID")?;
    rebuild_semantic_ann_in(&state.root, &project_id)
}

fn semantic_ann_ranked_search(
    semantic_root: &Path,
    manifest: &SemanticIndexManifest,
    query: &[f32],
    requested: usize,
    excluded_record_id: Option<&str>,
) -> Result<Vec<SemanticSearchResult>, String> {
    let dimension = manifest
        .embedding_dimension
        .ok_or_else(|| "The semantic index has no vectors yet".to_owned())?
        as usize;
    let candidate_count = (requested.saturating_mul(8))
        .max(128)
        .min(manifest.indexed_count.max(1));
    let safe_query = ann_safe_vector(query);
    let ef_search = manifest
        .ann
        .as_ref()
        .map_or(SEMANTIC_ANN_EF_SEARCH, |ann| ann.ef_search)
        .max(candidate_count)
        .min(manifest.indexed_count.max(candidate_count));
    with_semantic_ann(semantic_root, manifest, |cached| {
        let candidates = cached.index.search(&safe_query, candidate_count, ef_search);
        let mut results = Vec::with_capacity(candidates.len());
        for neighbor in candidates {
            let Some(record) = cached.records.get(neighbor.d_id) else {
                continue;
            };
            if !record.active
                || record.embedding_state != "ready"
                || excluded_record_id == Some(record.record_id.as_str())
            {
                continue;
            }
            let Some(offset) = record.vector_offset.map(|value| value as usize) else {
                continue;
            };
            let Some(end) = offset.checked_add(dimension * 4) else {
                continue;
            };
            if end > cached.vector_bytes.len() {
                continue;
            }
            let score = query
                .iter()
                .enumerate()
                .map(|(index, query_value)| {
                    let start = offset + index * 4;
                    query_value
                        * f32::from_le_bytes(
                            cached.vector_bytes[start..start + 4]
                                .try_into()
                                .expect("validated cached vector slice"),
                        )
                })
                .sum::<f32>();
            results.push(SemanticSearchResult {
                record_id: record.record_id.clone(),
                score,
            });
        }
        results.sort_by(|left, right| {
            right
                .score
                .total_cmp(&left.score)
                .then_with(|| left.record_id.cmp(&right.record_id))
        });
        results.truncate(requested);
        results
    })
}

fn semantic_search_in(
    workspace_root: &Path,
    project_id: &str,
    query: &[f32],
    limit: usize,
    excluded_record_id: Option<&str>,
) -> Result<Vec<SemanticSearchResult>, String> {
    let semantic_root = project_root(workspace_root, project_id)?.join("semantic");
    let manifest_text = fs::read_to_string(semantic_root.join("semantic-manifest.json"))
        .map_err(|_| "Build the project semantic index before searching".to_owned())?;
    let manifest: SemanticIndexManifest = serde_json::from_str(&manifest_text)
        .map_err(|_| "The semantic index is corrupt and must be rebuilt".to_owned())?;
    if !semantic_authoritative_files_valid(&semantic_root, &manifest) {
        return Err(
            "The authoritative semantic index is incomplete; rebuild embeddings".to_owned(),
        );
    }
    let dimension = manifest
        .embedding_dimension
        .ok_or_else(|| "The semantic index has no vectors yet".to_owned())?
        as usize;
    if query.len() != dimension || query.iter().any(|value| !value.is_finite()) {
        return Err("Search vector does not match this project's semantic model".to_owned());
    }
    let requested = limit.clamp(1, 200);
    if manifest.indexed_count >= SEMANTIC_ANN_MIN_RECORDS
        && semantic_ann_is_compatible(&semantic_root, &manifest)
    {
        if let Ok(results) = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            semantic_ann_ranked_search(
                &semantic_root,
                &manifest,
                query,
                requested,
                excluded_record_id,
            )
        })) {
            if let Ok(results) = results {
                if results.len()
                    >= requested.min(
                        manifest
                            .indexed_count
                            .saturating_sub(usize::from(excluded_record_id.is_some())),
                    )
                {
                    return Ok(results);
                }
            }
        }
    }
    let vector_bytes = fs::read(semantic_root.join("embeddings.f32"))
        .map_err(|_| "The semantic vector file is missing; rebuild the index".to_owned())?;
    let records = read_semantic_records(&semantic_root)?;
    let mut results = Vec::new();
    for record in records {
        if !record.active
            || record.embedding_state != "ready"
            || excluded_record_id == Some(record.record_id.as_str())
        {
            continue;
        }
        let Some(offset) = record.vector_offset.map(|value| value as usize) else {
            continue;
        };
        let byte_length = dimension
            .checked_mul(4)
            .ok_or_else(|| "Semantic vector dimension overflowed".to_owned())?;
        let end = offset
            .checked_add(byte_length)
            .ok_or_else(|| "Semantic vector offset overflowed".to_owned())?;
        if end > vector_bytes.len() {
            return Err("The semantic vector file is truncated; rebuild the index".to_owned());
        }
        let mut score = 0.0_f32;
        for (index, query_value) in query.iter().enumerate() {
            let start = offset + index * 4;
            let value = f32::from_le_bytes(vector_bytes[start..start + 4].try_into().unwrap());
            score += query_value * value;
        }
        results.push(SemanticSearchResult {
            record_id: record.record_id,
            score,
        });
    }
    results.sort_by(|left, right| {
        right
            .score
            .total_cmp(&left.score)
            .then_with(|| left.record_id.cmp(&right.record_id))
    });
    results.truncate(requested);
    Ok(results)
}

#[tauri::command]
fn search_semantic_index(
    project_id: String,
    query: Vec<f32>,
    limit: usize,
    state: State<'_, WorkspaceState>,
) -> Result<Vec<SemanticSearchResult>, String> {
    let project_id = validate_id(&project_id, "Project ID")?;
    semantic_search_in(&state.root, &project_id, &query, limit, None)
}

#[tauri::command]
fn find_similar_semantic(
    project_id: String,
    record_id: String,
    limit: usize,
    state: State<'_, WorkspaceState>,
) -> Result<Vec<SemanticSearchResult>, String> {
    let project_id = validate_id(&project_id, "Project ID")?;
    let semantic_root = project_root(&state.root, &project_id)?.join("semantic");
    let manifest: SemanticIndexManifest = serde_json::from_str(
        &fs::read_to_string(semantic_root.join("semantic-manifest.json"))
            .map_err(|_| "Build the project semantic index before searching".to_owned())?,
    )
    .map_err(|_| "The semantic index is corrupt and must be rebuilt".to_owned())?;
    let dimension = manifest
        .embedding_dimension
        .ok_or_else(|| "The semantic index has no vectors yet".to_owned())?
        as usize;
    let records = read_semantic_records(&semantic_root)?;
    let record = records
        .iter()
        .find(|entry| entry.record_id == record_id && entry.embedding_state == "ready")
        .ok_or_else(|| "This asset is not in the current semantic index".to_owned())?;
    let offset = record
        .vector_offset
        .ok_or_else(|| "This asset has no semantic vector".to_owned())? as usize;
    let bytes = fs::read(semantic_root.join("embeddings.f32"))
        .map_err(|_| "The semantic vector file is missing; rebuild the index".to_owned())?;
    let end = offset
        .checked_add(dimension * 4)
        .ok_or_else(|| "Semantic vector offset overflowed".to_owned())?;
    if end > bytes.len() {
        return Err("The semantic vector file is truncated; rebuild the index".to_owned());
    }
    let query = (0..dimension)
        .map(|index| {
            let start = offset + index * 4;
            f32::from_le_bytes(bytes[start..start + 4].try_into().unwrap())
        })
        .collect::<Vec<_>>();
    semantic_search_in(&state.root, &project_id, &query, limit, Some(&record_id))
}

fn perceptual_difference_hash(path: &Path) -> Option<u64> {
    let pixels = image::open(path)
        .ok()?
        .resize_exact(9, 8, image::imageops::FilterType::Triangle)
        .to_luma8();
    let mut hash = 0_u64;
    for y in 0..8 {
        for x in 0..8 {
            if pixels.get_pixel(x, y)[0] > pixels.get_pixel(x + 1, y)[0] {
                hash |= 1 << (y * 8 + x);
            }
        }
    }
    Some(hash)
}

fn semantic_analysis_in(
    workspace_root: &Path,
    project_id: &str,
) -> Result<SemanticAnalysis, String> {
    let semantic_root = project_root(workspace_root, project_id)?.join("semantic");
    let manifest: SemanticIndexManifest = serde_json::from_str(
        &fs::read_to_string(semantic_root.join("semantic-manifest.json"))
            .map_err(|_| "Build the project semantic index before analyzing it".to_owned())?,
    )
    .map_err(|_| "The semantic index is corrupt and must be rebuilt".to_owned())?;
    let dimension = manifest
        .embedding_dimension
        .ok_or_else(|| "The semantic index has no vectors yet".to_owned())?
        as usize;
    let bytes = fs::read(semantic_root.join("embeddings.f32"))
        .map_err(|_| "The semantic vector file is missing; rebuild the index".to_owned())?;
    let indexed_records = read_semantic_records(&semantic_root)?
        .into_iter()
        .enumerate()
        .filter(|(_, record)| record.active && record.embedding_state == "ready")
        .collect::<Vec<_>>();
    let records = indexed_records
        .iter()
        .map(|(_, record)| record.clone())
        .collect::<Vec<_>>();
    let original_to_local = indexed_records
        .iter()
        .enumerate()
        .map(|(local, (original, _))| (*original, local))
        .collect::<HashMap<_, _>>();
    let mut vectors = Vec::with_capacity(records.len());
    for record in &records {
        let offset = record
            .vector_offset
            .ok_or_else(|| "A semantic record has no vector offset".to_owned())?
            as usize;
        let end = offset
            .checked_add(dimension * 4)
            .ok_or_else(|| "Semantic vector offset overflowed".to_owned())?;
        if end > bytes.len() {
            return Err("The semantic vector file is truncated; rebuild the index".to_owned());
        }
        vectors.push(
            (0..dimension)
                .map(|index| {
                    let start = offset + index * 4;
                    f32::from_le_bytes(bytes[start..start + 4].try_into().unwrap())
                })
                .collect::<Vec<_>>(),
        );
    }
    let score = |left: usize, right: usize| {
        vectors[left]
            .iter()
            .zip(&vectors[right])
            .map(|(a, b)| a * b)
            .sum::<f32>()
    };
    let candidate_lists = if records.len() > 2_500 {
        semantic_ann_neighbor_lists(&semantic_root, &manifest, &vectors, 33)?
            .into_iter()
            .enumerate()
            .map(|(left, neighbors)| {
                neighbors
                    .into_iter()
                    .filter_map(|original| original_to_local.get(&original).copied())
                    .filter(|right| *right != left)
                    .collect::<Vec<_>>()
            })
            .collect::<Vec<_>>()
    } else {
        (0..records.len())
            .map(|left| {
                (0..records.len())
                    .filter(|right| *right != left)
                    .collect::<Vec<_>>()
            })
            .collect::<Vec<_>>()
    };
    let hashes = records
        .iter()
        .map(|record| {
            let path = PathBuf::from(&record.relative_path);
            let resolved = if path.is_absolute() {
                path
            } else {
                workspace_root.join(path)
            };
            perceptual_difference_hash(&resolved)
        })
        .collect::<Vec<_>>();
    let mut near_duplicates = Vec::new();
    let mut compared_pairs = HashSet::<(usize, usize)>::new();
    for left in 0..records.len() {
        for candidate in &candidate_lists[left] {
            let (left, right) = if left < *candidate {
                (left, *candidate)
            } else {
                (*candidate, left)
            };
            if left == right || !compared_pairs.insert((left, right)) {
                continue;
            }
            let embedding_score = score(left, right);
            let perceptual_distance = hashes[left]
                .zip(hashes[right])
                .map(|(a, b)| (a ^ b).count_ones());
            if embedding_score >= 0.88 && perceptual_distance.is_some_and(|distance| distance <= 10)
            {
                near_duplicates.push(SemanticNearDuplicate {
                    left_record_id: records[left].record_id.clone(),
                    right_record_id: records[right].record_id.clone(),
                    embedding_score,
                    perceptual_distance: perceptual_distance.unwrap(),
                });
            }
        }
    }
    near_duplicates.sort_by(|left, right| {
        left.perceptual_distance
            .cmp(&right.perceptual_distance)
            .then_with(|| right.embedding_score.total_cmp(&left.embedding_score))
    });

    let k = 5_usize.min(records.len().saturating_sub(1));
    let neighbors = (0..records.len())
        .map(|left| {
            let mut ranked = candidate_lists[left]
                .iter()
                .copied()
                .map(|right| (right, score(left, right)))
                .filter(|(_, similarity)| *similarity >= 0.72)
                .collect::<Vec<_>>();
            ranked.sort_by(|a, b| b.1.total_cmp(&a.1));
            ranked.truncate(k);
            ranked
        })
        .collect::<Vec<_>>();
    let mut parent = (0..records.len()).collect::<Vec<_>>();
    fn root(parent: &mut [usize], mut value: usize) -> usize {
        while parent[value] != value {
            parent[value] = parent[parent[value]];
            value = parent[value];
        }
        value
    }
    for left in 0..records.len() {
        for (right, _) in &neighbors[left] {
            if !neighbors[*right]
                .iter()
                .any(|(candidate, _)| *candidate == left)
            {
                continue;
            }
            let left_root = root(&mut parent, left);
            let right_root = root(&mut parent, *right);
            if left_root != right_root {
                parent[right_root] = left_root;
            }
        }
    }
    let mut components: HashMap<usize, Vec<usize>> = HashMap::new();
    for index in 0..records.len() {
        let component = root(&mut parent, index);
        components.entry(component).or_default().push(index);
    }
    let mut clusters = components
        .into_values()
        .filter(|members| members.len() >= 2)
        .map(|members| {
            let representative = *members
                .iter()
                .max_by(|left, right| {
                    let left_sum = members
                        .iter()
                        .filter(|other| *other != *left)
                        .map(|other| score(**left, *other))
                        .sum::<f32>();
                    let right_sum = members
                        .iter()
                        .filter(|other| *other != *right)
                        .map(|other| score(**right, *other))
                        .sum::<f32>();
                    left_sum.total_cmp(&right_sum)
                })
                .unwrap();
            let mut total = 0.0;
            let mut pairs = 0;
            for left in 0..members.len() {
                for right in left + 1..members.len() {
                    total += score(members[left], members[right]);
                    pairs += 1;
                }
            }
            SemanticCluster {
                id: format!(
                    "semantic-cluster-{}",
                    records[representative]
                        .record_id
                        .replace(':', "-")
                        .replace('/', "-")
                ),
                record_ids: members
                    .iter()
                    .map(|index| records[*index].record_id.clone())
                    .collect(),
                representative_record_id: records[representative].record_id.clone(),
                average_score: if pairs > 0 { total / pairs as f32 } else { 1.0 },
            }
        })
        .collect::<Vec<_>>();
    clusters.sort_by(|left, right| {
        right
            .record_ids
            .len()
            .cmp(&left.record_ids.len())
            .then_with(|| left.id.cmp(&right.id))
    });
    Ok(SemanticAnalysis {
        near_duplicates,
        clusters,
        analyzed_count: records.len(),
    })
}

#[tauri::command]
fn analyze_semantic_index(
    project_id: String,
    state: State<'_, WorkspaceState>,
) -> Result<SemanticAnalysis, String> {
    let project_id = validate_id(&project_id, "Project ID")?;
    semantic_analysis_in(&state.root, &project_id)
}

/// Return installed font families without requiring a network service or a bundled font pack.
/// The frontend adds its curated fallbacks so this remains useful on minimal Windows images.
#[tauri::command]
fn list_system_fonts() -> Result<Vec<String>, String> {
    let mut families = HashSet::new();
    #[cfg(target_os = "windows")]
    {
        for key in [
            r"HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Fonts",
            r"HKCU\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Fonts",
        ] {
            if let Ok(output) = Command::new("reg").args(["query", key]).output() {
                let text = String::from_utf8_lossy(&output.stdout);
                for line in text.lines() {
                    if let Some((name, _)) = line.split_once("REG_") {
                        let family = name
                            .trim()
                            .trim_end_matches(" (TrueType)")
                            .trim_end_matches(" (OpenType)")
                            .trim();
                        if !family.is_empty() {
                            families.insert(family.to_owned());
                        }
                    }
                }
            }
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        if let Ok(output) = Command::new("fc-list").args([":", "family"]).output() {
            for line in String::from_utf8_lossy(&output.stdout).lines() {
                if let Some(family) = line.split(',').next() {
                    let family = family.trim();
                    if !family.is_empty() {
                        families.insert(family.to_owned());
                    }
                }
            }
        }
    }
    let mut result = families.into_iter().collect::<Vec<_>>();
    result.sort_by_key(|family| family.to_lowercase());
    Ok(result)
}

#[tauri::command]
async fn import_asset(
    project_id: String,
    source_path: String,
    state: State<'_, WorkspaceState>,
) -> Result<AssetRecord, String> {
    if state.read_only {
        return Err("This workspace is already open in another writer and is read-only".to_owned());
    }
    let root = state.root.clone();
    tauri::async_runtime::spawn_blocking(move || {
        import_asset_into(&root, &project_id, Path::new(&source_path))
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
fn open_asset_with(application_path: String, asset_path: String) -> Result<(), String> {
    let application = PathBuf::from(application_path.trim());
    let asset = PathBuf::from(asset_path.trim());
    if application.as_os_str().is_empty() || asset.as_os_str().is_empty() {
        return Err("Choose an application and an asset".to_owned());
    }
    if !application.is_file() {
        return Err(format!(
            "Application was not found: {}",
            application.display()
        ));
    }
    if !asset.is_file() {
        return Err(format!("Asset was not found: {}", asset.display()));
    }
    Command::new(&application)
        .arg(&asset)
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("Could not launch {}: {error}", application.display()))
}

#[tauri::command]
fn read_text_asset(
    project_id: String,
    relative_path: String,
    state: State<'_, WorkspaceState>,
) -> Result<String, String> {
    let relative = validate_relative_path(&relative_path)?;
    let target = state.root.join(relative);
    let project = project_root(&state.root, &project_id)?;
    let canonical_target = target
        .canonicalize()
        .map_err(|error| format!("Could not open {}: {error}", target.display()))?;
    let canonical_project = project
        .canonicalize()
        .map_err(|error| format!("Could not open project storage: {error}"))?;
    if !canonical_target.starts_with(&canonical_project) {
        return Err("Text asset is outside this project's portable storage".to_owned());
    }
    let extension = canonical_target
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    if !matches!(
        extension.as_str(),
        "htm" | "html" | "md" | "markdown" | "txt"
    ) {
        return Err(
            "Only HTML, Markdown, and plain-text assets can be opened as editable captures"
                .to_owned(),
        );
    }
    let byte_length = canonical_target
        .metadata()
        .map_err(|error| format!("Could not inspect {}: {error}", canonical_target.display()))?
        .len();
    if byte_length > 24 * 1024 * 1024 {
        return Err("Text asset is larger than the 24 MB editable-capture limit".to_owned());
    }
    fs::read_to_string(&canonical_target).map_err(|error| {
        format!(
            "Could not decode {} as UTF-8 text: {error}",
            canonical_target.display()
        )
    })
}

#[tauri::command]
fn audit_assets(
    assets: Vec<AssetAuditRequest>,
    state: State<'_, WorkspaceState>,
) -> Result<Vec<AssetAuditResult>, String> {
    assets
        .into_iter()
        .map(|asset| {
            let relative = validate_relative_path(&asset.relative_path)?;
            let target = state.root.join(relative);
            let actual_byte_length = target
                .metadata()
                .ok()
                .filter(|metadata| metadata.is_file())
                .map(|metadata| metadata.len());
            let status = match actual_byte_length {
                None => {
                    let managed_exists = asset
                        .managed_relative_path
                        .as_deref()
                        .and_then(|path| validate_relative_path(path).ok())
                        .map(|path| state.root.join(path).is_file())
                        .unwrap_or(false);
                    if managed_exists {
                        "moved"
                    } else {
                        "missing"
                    }
                }
                Some(length) if length != asset.byte_length => "modified",
                Some(_) => "available",
            };
            Ok(AssetAuditResult {
                id: asset.id,
                status: status.to_owned(),
                actual_byte_length,
            })
        })
        .collect()
}

#[tauri::command]
fn materialize_asset(
    project_id: String,
    asset_id: String,
    source_relative_path: String,
    display_name: String,
    virtual_folder: String,
    extension: String,
    existing_relative_path: Option<String>,
    state: State<'_, WorkspaceState>,
) -> Result<MaterializedAsset, String> {
    if state.read_only {
        return Err("This workspace is already open in another writer and is read-only".to_owned());
    }
    materialize_asset_view(
        &state.root,
        &project_id,
        &asset_id,
        &source_relative_path,
        &display_name,
        &virtual_folder,
        &extension,
        existing_relative_path.as_deref(),
    )
}

#[tauri::command]
fn preview_managed_assets(
    project_id: String,
    requests: Vec<ManagedPreviewRequest>,
    state: State<'_, WorkspaceState>,
) -> Result<Vec<MaterializedAsset>, String> {
    let project = project_root(&state.root, &project_id)?;
    let library = project.join("assets/library");
    let mut reserved = std::collections::HashSet::<String>::new();
    let mut results = Vec::with_capacity(requests.len());
    for request in requests {
        let asset_id = validate_id(&request.asset_id, "Asset ID")?;
        let mut folder = library.clone();
        for segment in request
            .virtual_folder
            .split(['/', '\\'])
            .filter(|segment| !segment.trim().is_empty())
            .take(8)
        {
            folder.push(safe_library_segment(segment, "Unsorted"));
        }
        let extension = safe_library_segment(request.extension.trim_start_matches('.'), "bin");
        let stem = safe_library_segment(
            request
                .display_name
                .trim_end_matches(&format!(".{extension}")),
            "Asset",
        );
        let old_target = request
            .existing_relative_path
            .as_deref()
            .and_then(|relative| validate_relative_path(relative).ok())
            .map(|relative| state.root.join(relative));
        let available = |candidate: &Path, reserved: &std::collections::HashSet<String>| {
            let key = candidate.to_string_lossy().to_ascii_lowercase();
            (!candidate.exists() || old_target.as_ref() == Some(&candidate.to_path_buf()))
                && !reserved.contains(&key)
        };
        let mut target = folder.join(format!("{stem}.{extension}"));
        if !available(&target, &reserved) {
            for number in 2..10_000 {
                let candidate = folder.join(format!("{stem} ({number}).{extension}"));
                if available(&candidate, &reserved) {
                    target = candidate;
                    break;
                }
            }
        }
        reserved.insert(target.to_string_lossy().to_ascii_lowercase());
        let relative = target
            .strip_prefix(&state.root)
            .map_err(|_| "Managed preview escaped the workspace".to_owned())?;
        results.push(MaterializedAsset {
            id: asset_id,
            managed_relative_path: relative.to_string_lossy().replace('\\', "/"),
        });
    }
    Ok(results)
}

#[tauri::command]
fn rollback_managed_assets(
    project_id: String,
    entries: Vec<ManagedRollbackEntry>,
    state: State<'_, WorkspaceState>,
) -> Result<(), String> {
    if state.read_only {
        return Err("This workspace is read-only".to_owned());
    }
    let library = project_root(&state.root, &project_id)?.join("assets/library");
    for entry in entries {
        let current = state
            .root
            .join(validate_relative_path(&entry.current_relative_path)?);
        if !current.starts_with(&library) {
            return Err("Rollback target is outside the managed library".to_owned());
        }
        if let Some(previous_relative) = entry.previous_relative_path {
            let previous = state.root.join(validate_relative_path(&previous_relative)?);
            if !previous.starts_with(&library) || previous.exists() {
                return Err("Previous managed name cannot be restored safely".to_owned());
            }
            if let Some(parent) = previous.parent() {
                fs::create_dir_all(parent)
                    .map_err(|error| format!("Could not restore folder: {error}"))?;
            }
            fs::rename(current, previous)
                .map_err(|error| format!("Could not roll back managed name: {error}"))?;
        } else if current.is_file() {
            fs::remove_file(current)
                .map_err(|error| format!("Could not remove new managed name: {error}"))?;
        }
    }
    Ok(())
}

#[tauri::command]
fn import_model_bundle(
    project_id: String,
    source_path: String,
    state: State<'_, WorkspaceState>,
) -> Result<ModelBundleRecord, String> {
    if state.read_only {
        return Err("This workspace is read-only".to_owned());
    }
    import_model_bundle_into(&state.root, &project_id, Path::new(&source_path))
}

fn collect_reference_files(
    folder: &Path,
    files: &mut Vec<ReferenceFile>,
    limit: usize,
) -> Result<(), String> {
    if files.len() >= limit {
        return Ok(());
    }
    for entry in
        fs::read_dir(folder).map_err(|error| format!("Could not read reference folder: {error}"))?
    {
        if files.len() >= limit {
            break;
        }
        let entry = entry.map_err(|error| format!("Could not read reference entry: {error}"))?;
        let path = entry.path();
        if path.is_dir() {
            collect_reference_files(&path, files, limit)?;
            continue;
        }
        let extension = safe_extension(&path);
        if [
            "avif", "bmp", "gif", "heic", "jpeg", "jpg", "png", "tif", "tiff", "webp",
        ]
        .contains(&extension.as_str())
        {
            files.push(ReferenceFile {
                path: path.to_string_lossy().to_string(),
                name: path
                    .file_name()
                    .and_then(|value| value.to_str())
                    .unwrap_or("Image")
                    .to_owned(),
                extension,
            });
        }
    }
    Ok(())
}

#[tauri::command]
fn scan_reference_library(path: String) -> Result<Vec<ReferenceFile>, String> {
    let root = PathBuf::from(path);
    if !root.is_dir() {
        return Err("Only image folders are supported by the local reader at present".to_owned());
    }
    let mut files = Vec::new();
    collect_reference_files(&root, &mut files, 10_000)?;
    files.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(files)
}

#[tauri::command]
fn repair_model_bundle(
    project_id: String,
    entry_relative_path: String,
    source_folder: String,
    missing_uris: Vec<String>,
    state: State<'_, WorkspaceState>,
) -> Result<Vec<String>, String> {
    if state.read_only {
        return Err("This workspace is read-only".to_owned());
    }
    let project = project_root(&state.root, &project_id)?;
    let entry = state
        .root
        .join(validate_relative_path(&entry_relative_path)?);
    let bundle = entry
        .parent()
        .ok_or_else(|| "Invalid model bundle path".to_owned())?;
    if !bundle.starts_with(project.join("assets/bundles")) {
        return Err("Model entry is outside bundle storage".to_owned());
    }
    let source = PathBuf::from(source_folder);
    let mut remaining = Vec::new();
    for uri in missing_uris {
        let relative = match validate_relative_path(&uri) {
            Ok(path) => path,
            Err(_) => {
                remaining.push(uri);
                continue;
            }
        };
        let candidate = source.join(&relative);
        if !candidate.is_file() {
            remaining.push(uri);
            continue;
        }
        let target = bundle.join(&relative);
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent)
                .map_err(|error| format!("Could not create repair folder: {error}"))?;
        }
        fs::copy(candidate, target).map_err(|error| format!("Could not repair {uri}: {error}"))?;
    }
    Ok(remaining)
}

#[tauri::command]
fn apisr_model_info(state: State<'_, WorkspaceState>) -> Result<ApisrModelInfo, String> {
    let relative_path = format!("models/{APISR_MODEL_FILENAME}");
    let target = state.root.join(&relative_path);
    if !target.is_file() {
        return Ok(ApisrModelInfo {
            installed: false,
            verified: false,
            relative_path,
            byte_length: 0,
        });
    }
    let (hash, byte_length) = sha256_file(&target)?;
    Ok(ApisrModelInfo {
        installed: true,
        verified: hash == APISR_MODEL_SHA256,
        relative_path,
        byte_length,
    })
}

#[tauri::command]
fn install_apisr_model(
    source_path: String,
    state: State<'_, WorkspaceState>,
) -> Result<ApisrModelInfo, String> {
    if state.read_only {
        return Err("This workspace is already open in another writer and is read-only".to_owned());
    }
    let source = PathBuf::from(source_path);
    if !source.is_file() {
        return Err("Choose the APISR FP16 ONNX model file".to_owned());
    }
    let (hash, byte_length) = sha256_file(&source)?;
    if hash != APISR_MODEL_SHA256 {
        return Err("This is not the verified APISR FP16 model. The FP32 model is intentionally unsupported.".to_owned());
    }
    let models = state.root.join("models");
    fs::create_dir_all(&models)
        .map_err(|error| format!("Could not create {}: {error}", models.display()))?;
    let target = models.join(APISR_MODEL_FILENAME);
    if source.canonicalize().ok() != target.canonicalize().ok() {
        let temp = models.join(format!("{APISR_MODEL_FILENAME}.installing"));
        fs::copy(&source, &temp)
            .map_err(|error| format!("Could not copy APISR FP16 model: {error}"))?;
        OpenOptions::new()
            .write(true)
            .open(&temp)
            .and_then(|file| file.sync_all())
            .map_err(|error| format!("Could not flush APISR FP16 model: {error}"))?;
        if target.exists() {
            fs::remove_file(&target)
                .map_err(|error| format!("Could not replace APISR model: {error}"))?;
        }
        fs::rename(&temp, &target)
            .map_err(|error| format!("Could not finish APISR model installation: {error}"))?;
    }
    Ok(ApisrModelInfo {
        installed: true,
        verified: true,
        relative_path: format!("models/{APISR_MODEL_FILENAME}"),
        byte_length,
    })
}

fn decoded_header(request: &tauri::ipc::Request<'_>, name: &str) -> Result<String, String> {
    let raw = request
        .headers()
        .get(name)
        .ok_or_else(|| format!("Missing {name} header"))?
        .to_str()
        .map_err(|_| format!("Invalid {name} header"))?;
    percent_encoding::percent_decode_str(raw)
        .decode_utf8()
        .map(|value| value.into_owned())
        .map_err(|_| format!("Invalid encoded {name} header"))
}

#[tauri::command]
fn save_generated_image(
    request: tauri::ipc::Request<'_>,
    state: State<'_, WorkspaceState>,
) -> Result<AssetRecord, String> {
    if state.read_only {
        return Err("This workspace is already open in another writer and is read-only".to_owned());
    }
    let project_id = validate_id(&decoded_header(&request, "project-id")?, "Project ID")?;
    let project_name = safe_library_segment(
        &decoded_header(&request, "project-name")?,
        "Untitled Project",
    );
    let board_name = safe_library_segment(&decoded_header(&request, "board-name")?, "Board");
    let requested_name =
        safe_library_segment(&decoded_header(&request, "file-name")?, "APISR-output.png");
    let bytes = match request.body() {
        tauri::ipc::InvokeBody::Raw(bytes) => bytes.as_slice(),
        _ => return Err("Generated images must be sent as binary data".to_owned()),
    };
    if bytes.is_empty() || bytes.len() > 1024 * 1024 * 1024 {
        return Err("Generated image is empty or exceeds the 1 GB output limit".to_owned());
    }
    let format = image::guess_format(bytes)
        .map_err(|_| "Generated output is not a supported image".to_owned())?;
    let extension = match format {
        image::ImageFormat::Png => "png",
        image::ImageFormat::Jpeg => "jpg",
        image::ImageFormat::WebP => "webp",
        _ => return Err("Generated outputs must be PNG, JPEG, or WebP".to_owned()),
    };
    let requested_stem = Path::new(&requested_name)
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("APISR-output");
    let stem = safe_library_segment(requested_stem, "APISR-output");
    let output_folder = project_root(&state.root, &project_id)?
        .join("outputs")
        .join(project_name)
        .join(board_name)
        .join("APISR");
    fs::create_dir_all(&output_folder).map_err(|error| {
        format!(
            "Could not create output folder {}: {error}",
            output_folder.display()
        )
    })?;
    let mut target = output_folder.join(format!("{stem}.{extension}"));
    if target.exists() {
        for number in 2..10_000 {
            let candidate = output_folder.join(format!("{stem} ({number}).{extension}"));
            if !candidate.exists() {
                target = candidate;
                break;
            }
        }
    }
    atomic_write(&target, bytes)?;
    let id = format!("generated-{}", uuid::Uuid::new_v4());
    let thumbnail_target = project_root(&state.root, &project_id)?
        .join("assets/thumbnails")
        .join(format!("{id}.png"));
    let relative = target
        .strip_prefix(&state.root)
        .map_err(|_| "Generated output escaped the workspace".to_owned())?
        .to_string_lossy()
        .replace('\\', "/");
    let thumbnail_relative_path = generate_thumbnail(&target, &thumbnail_target)?
        .then(|| format!("projects/{project_id}/assets/thumbnails/{id}.png"));
    Ok(AssetRecord {
        image_dimensions: image_dimensions_from_header(&target),
        id,
        relative_path: relative,
        original_name: target
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("APISR-output.png")
            .to_owned(),
        byte_length: bytes.len() as u64,
        extension: extension.to_owned(),
        deduplicated: false,
        thumbnail_relative_path,
        requires_tiled_preview: image_pyramid::needs_tiles(&target),
    })
}

#[tauri::command]
fn export_html(destination_path: String, contents: String) -> Result<SaveResult, String> {
    let destination = PathBuf::from(destination_path);
    let extension = destination
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    if !matches!(extension.as_str(), "html" | "htm") {
        return Err("HTML exports must use an .html or .htm extension".to_owned());
    }
    let bytes = contents.into_bytes();
    let backup_created = atomic_write(&destination, &bytes)?;
    Ok(SaveResult {
        relative_path: destination.to_string_lossy().to_string(),
        bytes_written: bytes.len(),
        backup_created,
    })
}

#[tauri::command]
fn export_binary(destination_path: String, bytes: Vec<u8>) -> Result<SaveResult, String> {
    let destination = PathBuf::from(destination_path);
    let extension = safe_extension(&destination);
    if extension == "bin" {
        return Err("Choose a file name with a valid extension".to_owned());
    }
    if bytes.is_empty() {
        return Err("There is no export data to write".to_owned());
    }
    if bytes.len() > 1_000_000_000 {
        return Err("The requested export is too large to write safely".to_owned());
    }
    let backup_created = atomic_write(&destination, &bytes)?;
    Ok(SaveResult {
        relative_path: destination.to_string_lossy().to_string(),
        bytes_written: bytes.len(),
        backup_created,
    })
}

fn copy_tree(source: &Path, destination: &Path) -> Result<u64, String> {
    fs::create_dir_all(destination)
        .map_err(|error| format!("Could not create {}: {error}", destination.display()))?;
    let mut bytes = 0;
    for entry in fs::read_dir(source)
        .map_err(|error| format!("Could not read {}: {error}", source.display()))?
    {
        let entry = entry.map_err(|error| format!("Could not read project entry: {error}"))?;
        let target = destination.join(entry.file_name());
        let name=entry.file_name().to_string_lossy().to_string();
        if name=="state.sqlite-wal"||name=="state.sqlite-shm"{continue;}
        if entry.path().is_dir() {
            bytes += copy_tree(&entry.path(), &target)?;
        } else if name=="state.sqlite" {
            project_storage::copy_database(source,&target)?;
            bytes+=target.metadata().map_err(|e|e.to_string())?.len();
        } else {
            bytes += fs::copy(entry.path(), &target).map_err(|error| {
                format!("Could not collect {}: {error}", entry.path().display())
            })?;
        }
    }
    Ok(bytes)
}

#[tauri::command]
fn collect_project(
    project_id: String,
    destination_path: String,
    state: State<'_, WorkspaceState>,
) -> Result<SaveResult, String> {
    let project_id = validate_id(&project_id, "Project ID")?;
    let source = project_root(&state.root, &project_id)?;
    if !source.join("project.json").is_file() && !source.join("state.sqlite").is_file() {
        return Err("Project data is missing".to_owned());
    }
    let destination_root = PathBuf::from(destination_path);
    if !destination_root.is_dir() {
        return Err("Choose an existing destination folder".to_owned());
    }
    let mut final_target = destination_root.join(&project_id);
    if final_target.exists() {
        for number in 2..10_000 {
            let candidate = destination_root.join(format!("{project_id} ({number})"));
            if !candidate.exists() {
                final_target = candidate;
                break;
            }
        }
    }
    let staging =
        destination_root.join(format!(".{project_id}-collecting-{}", uuid::Uuid::new_v4()));
    if source.join("state.sqlite").exists(){project_storage::request(source.clone(),project_id.clone(),"close",serde_json::json!({}))?;}
    let mut bytes = copy_tree(&source, &staging)?;
    let canonical=project_storage::finalize_collection(&staging)?;
    let portable=serde_json::to_vec_pretty(&canonical).map_err(|e|e.to_string())?;
    atomic_write(&staging.join("project.json"),&portable)?;bytes+=portable.len() as u64;
    fs::rename(&staging, &final_target)
        .map_err(|error| format!("Could not finalize collected project: {error}"))?;
    Ok(SaveResult {
        relative_path: final_target.to_string_lossy().to_string(),
        bytes_written: bytes as usize,
        backup_created: false,
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    install_panic_diagnostics();
    let workspace = initialize_workspace().unwrap_or_else(|error| {
        append_diagnostic(
            "native-crash.log",
            &format!("workspace initialization failed: {error}"),
        );
        panic!("failed to initialize portable workspace: {error}");
    });
    let log_directory = workspace.root.join("logs");
    let application = tauri::Builder::default()
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(log::LevelFilter::Info)
                .max_file_size(2_000_000)
                .targets([
                    Target::new(TargetKind::Folder {
                        path: log_directory,
                        file_name: Some("art-equation".to_owned()),
                    }),
                    Target::new(TargetKind::Stderr),
                ])
                .build(),
        )
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(workspace)
        .manage(window_chrome::ChromeState::default())
        .manage(codex_bridge::BridgeState::default())
        .manage(live_inspection::LiveState::default())
        .invoke_handler(tauri::generate_handler![
            window_chrome::set_window_chrome,
            engine_capabilities::inspect_engine_capabilities,
            launch_preferences::get_launch_preferences,
            launch_preferences::set_launch_preferences,
            experimental_compute::prepare_image_experimental,
            experimental_compute::prepare_jpeg_experimental,
            experimental_compute::inspect_preparation_session,
            codex_bridge::codex_connect,
            codex_bridge::codex_status,
            codex_bridge::codex_login,
            codex_bridge::codex_ask,
            codex_bridge::codex_cancel,
            codex_bridge::codex_tool_reply,
            codex_bridge::codex_disconnect,
            live_inspection::app_inspection_reply,
            workspace_info,
            record_frontend_diagnostic,
            record_performance_batch,
            project_b_preflight_context,
            record_project_b_preflight,
            list_projects,
            trash_project,
            list_trashed_projects,
            restore_trashed_project,
            load_json,
            list_recovery_entries,
            save_json,
            project_storage::project_storage_load,
            project_storage::project_storage_commit,
            project_storage::project_storage_status,
            project_storage::project_storage_snapshot,
            project_storage::project_storage_configure,
            ensure_project_workspace,
            ensure_managed_board_folders,
            semantic_index_status,
            prepare_semantic_index,
            list_semantic_sources,
            commit_semantic_embeddings,
            rebuild_semantic_ann,
            search_semantic_index,
            find_similar_semantic,
            analyze_semantic_index,
            list_system_fonts,
            font_resolver::resolve_system_font,
            font_resolver::resolve_system_font_fallbacks,
            import_asset,
            image_pyramid::start_image_pyramid,
            image_pyramid::image_pyramid_status,
            image_pyramid::cancel_image_pyramid,
            spawn_mini_bridge,
            mini_bridge_launch,
            launch_webgl_edition,
            list_project_trash,
            record_trash_entry,
            remove_trash_entry,
            move_path_to_trash,
            restore_trash_file,
            open_asset_with,
            scan_reference_library,
            import_model_bundle,
            repair_model_bundle,
            read_text_asset,
            audit_assets,
            materialize_asset,
            preview_managed_assets,
            rollback_managed_assets,
            apisr_model_info,
            install_apisr_model,
            save_generated_image,
            export_html,
            export_binary,
            collect_project,
            canvas_pipeline::canvas_segregate_primitives,
            canvas_pipeline::canvas_query_camera_culling,
            canvas_pipeline::canvas_benchmark_inking,
            canvas_pipeline::canvas_inspect_pipeline_profile,
            canvas_pipeline::canvas_compute_lod
        ])
        .on_window_event(window_chrome::window_event)
        .setup(|app| {
            let workspace = app.state::<WorkspaceState>();
            window_chrome::startup(app, &workspace.root);
            if mini_bridge_launch().is_none() { experimental_compute::startup(); }
            if mini_bridge_launch().is_none() {
                if let Err(error) = live_inspection::start(app.handle(), workspace.root.clone()) {
                    log::warn!("Live Codex inspection unavailable: {error}");
                }
            }
            app.asset_protocol_scope()
                .allow_directory(&workspace.root, true)?;
            log::info!(
                "workspace initialized at {} (read_only={})",
                workspace.root.display(),
                workspace.read_only
            );
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building Art Equation Studio");

    application.run(|app_handle, event| {
        if matches!(event, RunEvent::Exit) {
            experimental_compute::shutdown();
            codex_bridge::shutdown(&app_handle.state::<codex_bridge::BridgeState>());
            live_inspection::shutdown(&app_handle.state::<live_inspection::LiveState>());
            let workspace = app_handle.state::<WorkspaceState>();
            if workspace.owns_lock {
                let _ = fs::remove_file(&workspace.lock_path);
            }
        }
    });
}

#[cfg(test)]
mod tests {

    #[test]
    fn project_trash_moves_files_without_deleting_and_restores_them() {
        let root = env::temp_dir().join(format!("art-equation-trash-{}", uuid::Uuid::new_v4()));
        let originals = root.join("projects/project-x/assets/originals");
        fs::create_dir_all(&originals).unwrap();
        fs::write(originals.join("reference.png"), b"image-bytes").unwrap();

        let trash_path = move_path_to_trash_at(
            &root,
            "project-x",
            "projects/project-x/assets/originals/reference.png",
        )
        .unwrap();
        assert!(
            !originals.join("reference.png").exists(),
            "original must be moved, not copied"
        );
        assert!(
            root.join(&trash_path).is_file(),
            "file must physically exist in the project trash folder"
        );
        assert!(
            trash_path.starts_with("projects/project-x/trash/files/"),
            "trash copy must stay inside the project trash: {trash_path}"
        );

        restore_trash_file_at(
            &root,
            "project-x",
            &trash_path,
            "projects/project-x/assets/originals/reference.png",
        )
        .unwrap();
        assert!(originals.join("reference.png").is_file());
        assert!(
            !root.join(&trash_path).exists(),
            "restore must move the file back out of trash"
        );

        // Restoring over an existing file must be refused, never overwritten.
        let trash_path_again = move_path_to_trash_at(
            &root,
            "project-x",
            "projects/project-x/assets/originals/reference.png",
        )
        .unwrap();
        fs::write(originals.join("reference.png"), b"conflicting-new-file").unwrap();
        assert!(restore_trash_file_at(
            &root,
            "project-x",
            &trash_path_again,
            "projects/project-x/assets/originals/reference.png"
        )
        .is_err());
        assert_eq!(
            fs::read(originals.join("reference.png")).unwrap(),
            b"conflicting-new-file",
            "a refused restore must leave the existing file untouched"
        );

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn trash_file_moves_are_timestamped_so_names_never_collide() {
        let root =
            env::temp_dir().join(format!("art-equation-trash-names-{}", uuid::Uuid::new_v4()));
        let originals = root.join("projects/project-x/assets/originals");
        fs::create_dir_all(&originals).unwrap();
        fs::write(originals.join("a.png"), b"one").unwrap();

        let first = move_path_to_trash_at(
            &root,
            "project-x",
            "projects/project-x/assets/originals/a.png",
        )
        .unwrap();
        fs::write(originals.join("a.png"), b"two").unwrap();
        let second = move_path_to_trash_at(
            &root,
            "project-x",
            "projects/project-x/assets/originals/a.png",
        )
        .unwrap();
        assert_ne!(
            first, second,
            "two trashed copies of the same name must not collide"
        );
        assert!(root.join(&first).is_file() && root.join(&second).is_file());

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn trash_restore_rejects_paths_outside_the_project_trash() {
        let root =
            env::temp_dir().join(format!("art-equation-trash-guard-{}", uuid::Uuid::new_v4()));
        let outside = root.join("projects/project-x/assets/keep.png");
        fs::create_dir_all(outside.parent().unwrap()).unwrap();
        fs::write(&outside, b"keep").unwrap();

        assert!(restore_trash_file_at(
            &root,
            "project-x",
            "projects/project-x/assets/keep.png",
            "projects/project-x/assets/other.png"
        )
        .is_err());
        assert!(restore_trash_file_at(
            &root,
            "project-x",
            "../escape.png",
            "projects/project-x/assets/other.png"
        )
        .is_err());
        assert!(
            outside.is_file(),
            "guard failures must never touch workspace files"
        );

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn trash_index_roundtrip_replaces_by_id_and_removes_entries() {
        let root =
            env::temp_dir().join(format!("art-equation-trash-index-{}", uuid::Uuid::new_v4()));
        let trash_dir = project_trash_dir(&root, "project-x").unwrap();

        let entry = |title: &str| {
            serde_json::json!({
                "id": "entry-1",
                "kind": "canvas-node",
                "title": title,
                "deletedAtUnixMs": 1_700_000_000_000_i64,
                "boardId": "master-reference-board",
            })
        };

        record_trash_entry_at(&root, "project-x", entry("First title")).unwrap();
        record_trash_entry_at(&root, "project-x", serde_json::json!({"kind": "asset"}))
            .unwrap_err();
        assert_eq!(
            read_trash_index_at(&trash_dir).len(),
            1,
            "entries without ids are rejected"
        );

        record_trash_entry_at(&root, "project-x", entry("Updated title")).unwrap();
        let entries = read_trash_index_at(&trash_dir);
        assert_eq!(
            entries.len(),
            1,
            "recording the same id replaces, not duplicates"
        );
        assert_eq!(entries[0]["title"], "Updated title");

        remove_trash_entry_at(&root, "project-x", "entry-1").unwrap();
        assert!(read_trash_index_at(&trash_dir).is_empty());
        assert!(remove_trash_entry_at(&root, "project-x", "entry-1").is_err());

        fs::remove_dir_all(root).unwrap();
    }

    use super::*;

    #[test]
    fn rejects_paths_outside_workspace() {
        assert!(validate_relative_path("projects/project-a/project.json").is_ok());
        assert!(validate_relative_path("../outside.json").is_err());
        assert!(validate_relative_path("projects/../../outside.json").is_err());
        assert!(validate_relative_path("C:\\outside.json").is_err());
        assert!(validate_relative_path("").is_err());
    }

    #[test]
    fn project_ids_are_filesystem_safe() {
        assert!(validate_id("rainee-redesign_01", "Project ID").is_ok());
        assert!(validate_id("../outside", "Project ID").is_err());
        assert!(validate_id("has spaces", "Project ID").is_err());
    }

    #[test]
    fn project_discovery_keeps_board_sets_separate_and_sorts_recent_first() {
        let root = env::temp_dir().join(format!("art-equation-projects-{}", uuid::Uuid::new_v4()));
        let projects = root.join("projects");
        fs::create_dir_all(projects.join("rainee-redesign")).unwrap();
        fs::create_dir_all(projects.join("second-project")).unwrap();
        fs::write(projects.join("rainee-redesign/project.json"), br#"{"id":"rainee-redesign","title":"Rainee Stripper","status":"review","projectCoverAssetId":"cover-asset","updatedAt":"2026-08-28T10:00:00Z","boards":[{},{},{},{},{},{},{},{},{},{}],"assets":[{"id":"cover-asset","relativePath":"projects/rainee-redesign/assets/cover.png","thumbnailRelativePath":"projects/rainee-redesign/thumbnails/cover.webp"}]}"#).unwrap();
        fs::write(projects.join("second-project/project.json"), br#"{"id":"second-project","title":"Another Project","updatedAt":"2026-08-29T10:00:00Z","boards":[{},{}],"assets":[]}"#).unwrap();

        let found = discover_projects(&root).unwrap();
        assert_eq!(found.len(), 2);
        assert_eq!(found[0].id, "second-project");
        assert_eq!(found[0].board_count, 2);
        assert_eq!(found[1].id, "rainee-redesign");
        assert_eq!(found[1].board_count, 10);
        assert_eq!(found[1].status.as_deref(), Some("review"));
        assert_eq!(
            found[1].cover_relative_path.as_deref(),
            Some("projects/rainee-redesign/thumbnails/cover.webp")
        );

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn semantic_index_preparation_is_project_local_and_rebuildable() {
        let root = env::temp_dir().join(format!("art-equation-semantic-{}", uuid::Uuid::new_v4()));
        let project = root.join("projects/project-semantic");
        fs::create_dir_all(project.join("assets/originals/aa")).unwrap();
        fs::create_dir_all(project.join("assets/originals/bb")).unwrap();
        image::DynamicImage::new_rgb8(16, 16)
            .save(project.join("assets/originals/aa/image.png"))
            .unwrap();
        image::DynamicImage::new_rgb8(16, 16)
            .save(project.join("assets/originals/bb/image-copy.png"))
            .unwrap();
        fs::write(project.join("project.json"), br#"{"id":"project-semantic","assets":[{"id":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","kind":"image","relativePath":"projects/project-semantic/assets/originals/aa/image.png","byteLength":100,"status":"available"},{"id":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","kind":"image","relativePath":"projects/project-semantic/assets/originals/bb/image-copy.png","byteLength":100,"status":"available"},{"id":"video-1","kind":"video","relativePath":"projects/project-semantic/assets/video.mp4","byteLength":10,"status":"available"}],"referenceCrops":[{"id":"crop-1","sourcePath":"C:/missing/crop.png"}]}"#).unwrap();

        let first = prepare_semantic_index_in(&root, "project-semantic").unwrap();
        assert_eq!(first.state, "prepared");
        assert_eq!(first.source_count, 3);
        assert_eq!(first.indexed_count, 0);
        assert_eq!(first.generation, 1);
        assert!(project.join("semantic/semantic-manifest.json").is_file());
        let records = fs::read_to_string(project.join("semantic/records.jsonl")).unwrap();
        assert!(records.contains("managedAsset"));
        assert!(records.contains("savedCrop"));
        assert!(!records.contains("video-1"));

        let second = prepare_semantic_index_in(&root, "project-semantic").unwrap();
        // A metadata-only integrity scan does not invalidate an unchanged index.
        assert_eq!(second.generation, 1);
        assert!(project.join("semantic/records.jsonl.backup").is_file());

        let completed = commit_semantic_embeddings_in(
            &root,
            "project-semantic",
            "Xenova/clip-vit-base-patch16",
            "private-pinned-v1",
            4,
            vec![
                SemanticEmbeddingInput {
                    record_id:
                        "asset:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
                            .to_owned(),
                    vector: vec![0.5, 0.5, 0.5, 0.5],
                },
                SemanticEmbeddingInput {
                    record_id:
                        "asset:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
                            .to_owned(),
                    vector: vec![0.5, 0.5, 0.5, 0.5],
                },
            ],
        )
        .unwrap();
        assert_eq!(completed.state, "ready");
        assert_eq!(completed.indexed_count, 2);
        assert_eq!(
            fs::metadata(project.join("semantic/embeddings.f32"))
                .unwrap()
                .len(),
            32
        );
        assert!(fs::read_to_string(project.join("semantic/records.jsonl"))
            .unwrap()
            .contains("vectorOffset"));
        let matches =
            semantic_search_in(&root, "project-semantic", &[0.5, 0.5, 0.5, 0.5], 10, None).unwrap();
        assert_eq!(matches.len(), 2);
        assert_eq!(
            matches[0].record_id,
            "asset:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
        );
        assert!((matches[0].score - 1.0).abs() < f32::EPSILON);
        let analysis = semantic_analysis_in(&root, "project-semantic").unwrap();
        assert_eq!(analysis.near_duplicates.len(), 1);
        assert_eq!(analysis.clusters.len(), 1);
        assert_eq!(analysis.clusters[0].record_ids.len(), 2);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn large_semantic_index_uses_hnsw_and_falls_back_when_sidecar_is_damaged() {
        let root = env::temp_dir().join(format!(
            "art-equation-semantic-ann-{}",
            uuid::Uuid::new_v4()
        ));
        let project = root.join("projects/project-ann");
        fs::create_dir_all(&project).unwrap();
        let assets = (0..2_600)
            .map(|index| {
                serde_json::json!({
                    "id": format!("image-{index:04}"), "kind": "image",
                    "relativePath": format!("projects/project-ann/assets/originals/{index:04}.png"),
                    "byteLength": 100, "status": "available"
                })
            })
            .collect::<Vec<_>>();
        fs::write(
            project.join("project.json"),
            serde_json::to_vec(&serde_json::json!({ "id": "project-ann", "assets": assets }))
                .unwrap(),
        )
        .unwrap();
        prepare_semantic_index_in(&root, "project-ann").unwrap();

        let normalize = |mut vector: Vec<f32>| {
            let magnitude = vector.iter().map(|value| value * value).sum::<f32>().sqrt();
            vector.iter_mut().for_each(|value| *value /= magnitude);
            vector
        };
        let embeddings = (0..2_600)
            .map(|index| SemanticEmbeddingInput {
                record_id: format!("asset:image-{index:04}"),
                vector: normalize(
                    (0..16)
                        .map(|dimension| (((index + 1) * (dimension + 3)) as f32 * 0.173_205).sin())
                        .collect(),
                ),
            })
            .collect::<Vec<_>>();
        let query = embeddings[1_321].vector.clone();
        let known_queries = [1,325,650,1000,1321,1950,2455].map(|index| embeddings[index].vector.clone());
        let status = commit_semantic_embeddings_in(
            &root,
            "project-ann",
            "test-clip",
            "pinned",
            16,
            embeddings,
        )
        .unwrap();
        assert_eq!(status.search_engine, "hnsw");
        assert_eq!(status.ann_state, "ready");
        assert_eq!(status.ann_indexed_count, 2_600);
        assert!(project.join("semantic/semantic-ann.hnsw.graph").is_file());
        assert!(project.join("semantic/semantic-ann.hnsw.data").is_file());

        let matches = semantic_search_in(&root, "project-ann", &query, 20, None).unwrap();
        assert!(
            matches[0].score > 0.999,
            "HNSW self-query did not return a near-perfect match: {:?}",
            matches[0]
        );
        for known in known_queries {
            let results = semantic_search_in(&root, "project-ann", &known, 20, None).unwrap();
            assert!(results[0].score > 0.999, "Persisted metric index must recover known source vectors");
        }

        fs::write(project.join("semantic/semantic-ann.hnsw.graph"), b"damaged").unwrap();
        let degraded = semantic_status_in(&root, "project-ann").unwrap();
        assert_eq!(degraded.state, "ready");
        assert_eq!(degraded.search_engine, "exact");
        assert_eq!(degraded.ann_state, "rebuildRequired");
        let fallback = semantic_search_in(&root, "project-ann", &query, 20, None).unwrap();
        assert!(fallback[0].score > 0.999);
        let repaired = rebuild_semantic_ann_in(&root, "project-ann").unwrap();
        assert_eq!(repaired.search_engine, "hnsw");
        assert_eq!(repaired.ann_state, "ready");
        fs::write(project.join("semantic/embeddings.f32"), b"truncated").unwrap();
        let broken_authoritative = semantic_status_in(&root, "project-ann").unwrap();
        assert_eq!(broken_authoritative.state, "rebuildRequired");
        assert!(semantic_search_in(&root, "project-ann", &query, 20, None).is_err());
        assert!(rebuild_semantic_ann_in(&root, "project-ann").is_err());
        invalidate_semantic_ann_cache(&project.join("semantic"));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    #[ignore = "release-mode large-library performance and recall benchmark"]
    fn benchmark_semantic_ann_5000_vectors() {
        const COUNT: usize = 5_000;
        const DIMENSION: usize = 512;
        const QUERY_COUNT: usize = 100;
        const K: usize = 10;
        let root = env::temp_dir().join(format!(
            "art-equation-semantic-bench-{}",
            uuid::Uuid::new_v4()
        ));
        let project = root.join("projects/project-bench");
        fs::create_dir_all(&project).unwrap();
        let assets = (0..COUNT).map(|index| serde_json::json!({
            "id": format!("bench-{index:05}"), "kind": "image",
            "relativePath": format!("projects/project-bench/assets/originals/{index:05}.png"),
            "byteLength": 100, "status": "available"
        })).collect::<Vec<_>>();
        fs::write(
            project.join("project.json"),
            serde_json::to_vec(&serde_json::json!({ "id": "project-bench", "assets": assets }))
                .unwrap(),
        )
        .unwrap();
        prepare_semantic_index_in(&root, "project-bench").unwrap();
        let corpus = (0..COUNT)
            .map(|index| {
                let mut vector = (0..DIMENSION)
                    .map(|dimension| {
                        let phase = ((index + 11) * (dimension + 7)) as f32 * 0.017_453_3;
                        phase.sin() + (phase * 0.37).cos() * 0.31
                    })
                    .collect::<Vec<_>>();
                let magnitude = vector.iter().map(|value| value * value).sum::<f32>().sqrt();
                vector.iter_mut().for_each(|value| *value /= magnitude);
                vector
            })
            .collect::<Vec<_>>();
        let embeddings = corpus
            .iter()
            .enumerate()
            .map(|(index, vector)| SemanticEmbeddingInput {
                record_id: format!("asset:bench-{index:05}"),
                vector: vector.clone(),
            })
            .collect();
        let build_started = std::time::Instant::now();
        let status = commit_semantic_embeddings_in(
            &root,
            "project-bench",
            "test-clip",
            "pinned",
            DIMENSION as u32,
            embeddings,
        )
        .unwrap();
        let build_elapsed = build_started.elapsed();
        assert_eq!(status.search_engine, "hnsw");

        let query_indices = (0..QUERY_COUNT)
            .map(|index| (index * 47) % COUNT)
            .collect::<Vec<_>>();
        let _ =
            semantic_search_in(&root, "project-bench", &corpus[query_indices[0]], K, None).unwrap();
        let ann_started = std::time::Instant::now();
        let ann_results = query_indices
            .iter()
            .map(|index| {
                semantic_search_in(&root, "project-bench", &corpus[*index], K, None).unwrap()
            })
            .collect::<Vec<_>>();
        let ann_elapsed = ann_started.elapsed();
        let exact_started = std::time::Instant::now();
        let exact_results = query_indices
            .iter()
            .map(|query_index| {
                let mut ranked = corpus
                    .iter()
                    .enumerate()
                    .map(|(index, vector)| {
                        (
                            index,
                            corpus[*query_index]
                                .iter()
                                .zip(vector)
                                .map(|(left, right)| left * right)
                                .sum::<f32>(),
                        )
                    })
                    .collect::<Vec<_>>();
                ranked.sort_by(|left, right| {
                    right
                        .1
                        .total_cmp(&left.1)
                        .then_with(|| left.0.cmp(&right.0))
                });
                ranked.truncate(K);
                ranked
                    .into_iter()
                    .map(|(index, _)| format!("asset:bench-{index:05}"))
                    .collect::<HashSet<_>>()
            })
            .collect::<Vec<_>>();
        let exact_elapsed = exact_started.elapsed();
        let recalled = ann_results
            .iter()
            .zip(&exact_results)
            .map(|(ann, exact)| {
                ann.iter()
                    .filter(|result| exact.contains(&result.record_id))
                    .count()
            })
            .sum::<usize>();
        let recall = recalled as f32 / (QUERY_COUNT * K) as f32;
        println!("semantic ANN benchmark: build={build_elapsed:?}, 100 cached ANN queries={ann_elapsed:?}, 100 exact scans={exact_elapsed:?}, recall@10={recall:.3}");
        assert!(
            recall >= 0.95,
            "recall@10 fell below the 0.95 quality floor: {recall:.3}"
        );
        invalidate_semantic_ann_cache(&project.join("semantic"));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn asset_imports_are_content_addressed_and_deduplicated() {
        let root = env::temp_dir().join(format!("art-equation-assets-{}", uuid::Uuid::new_v4()));
        let source = root.join("incoming").join("Reference.PNG");
        fs::create_dir_all(source.parent().unwrap()).unwrap();
        fs::write(&source, b"same bytes, same asset").unwrap();

        let first = import_asset_into(&root, "project-a", &source).unwrap();
        let second = import_asset_into(&root, "project-a", &source).unwrap();
        assert_eq!(first.id, second.id);
        assert_eq!(first.extension, "png");
        assert!(!first.deduplicated);
        assert!(second.deduplicated);
        assert!(root.join(first.relative_path).exists());

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn stale_lock_is_recovered_but_live_lock_is_respected() {
        let root = env::temp_dir().join(format!("art-equation-lock-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        let lock = root.join(LOCK_FILENAME);

        fs::write(&lock, "pid=4294967295\nstartedAtUnixMs=0").unwrap();
        let (owns_recovered, read_only_recovered) = acquire_workspace_lock(&lock).unwrap();
        assert!(owns_recovered);
        assert!(!read_only_recovered);

        fs::write(
            &lock,
            format!("pid={}\nstartedAtUnixMs=0", std::process::id()),
        )
        .unwrap();
        let (owns_live, read_only_live) = acquire_workspace_lock(&lock).unwrap();
        assert!(!owns_live);
        assert!(read_only_live);

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn image_import_generates_a_bounded_thumbnail() {
        let root = env::temp_dir().join(format!("art-equation-thumb-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        let source = root.join("large-reference.png");
        image::DynamicImage::new_rgb8(1600, 900)
            .save(&source)
            .unwrap();

        let imported = import_asset_into(&root, "project-thumb", &source).unwrap();
        assert_eq!(imported.image_dimensions, Some(SourceImageDimensions { width: 1600, height: 900 }));
        let thumbnail = imported
            .thumbnail_relative_path
            .expect("thumbnail should be generated");
        let dimensions = image::image_dimensions(root.join(thumbnail)).unwrap();
        assert!(dimensions.0 <= 768);
        assert!(dimensions.1 <= 768);

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn image_header_dimensions_follow_camera_orientation() {
        use image::metadata::Orientation;
        for orientation in [Orientation::Rotate90, Orientation::Rotate270, Orientation::Rotate90FlipH, Orientation::Rotate270FlipH] {
            assert_eq!(oriented_image_dimensions(30, 10, orientation), Some(SourceImageDimensions { width: 10, height: 30 }));
        }
        assert_eq!(oriented_image_dimensions(30, 10, Orientation::FlipHorizontal), Some(SourceImageDimensions { width: 30, height: 10 }));
        assert_eq!(oriented_image_dimensions(0, 10, Orientation::NoTransforms), None);
        let root = env::temp_dir().join(format!("art-equation-oriented-image-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        let source = root.join("camera.jpg");
        image::DynamicImage::new_rgb8(30, 10).save(&source).unwrap();
        let encoded = fs::read(&source).unwrap();
        // JPEG APP1 containing a little-endian TIFF orientation=6 (90 degrees).
        let exif = [b'E',b'x',b'i',b'f',0,0,b'I',b'I',42,0,8,0,0,0,1,0,0x12,1,3,0,1,0,0,0,6,0,0,0,0,0,0,0];
        let mut oriented = encoded[..2].to_vec();
        oriented.extend_from_slice(&[0xff, 0xe1, 0, (exif.len() + 2) as u8]);
        oriented.extend_from_slice(&exif);
        oriented.extend_from_slice(&encoded[2..]);
        fs::write(&source, oriented).unwrap();
        assert_eq!(image_dimensions_from_header(&source), Some(SourceImageDimensions { width: 10, height: 30 }));
        let thumbnail = root.join("preview.png");
        assert!(generate_thumbnail(&source, &thumbnail).unwrap());
        assert_eq!(image::image_dimensions(thumbnail).unwrap(), (10, 30));
        assert!(image_dimensions_from_header(&root.join("missing.png")).is_none());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn managed_library_names_are_zero_copy_and_sanitized() {
        let root = env::temp_dir().join(format!("art-equation-library-{}", uuid::Uuid::new_v4()));
        let source = root.join("incoming").join("camera.mov");
        fs::create_dir_all(source.parent().unwrap()).unwrap();
        fs::write(&source, b"large media placeholder").unwrap();
        let imported = import_asset_into(&root, "project-library", &source).unwrap();
        let managed = materialize_asset_view(
            &root,
            "project-library",
            &imported.id,
            &imported.relative_path,
            "Camera: Walkthrough",
            "Environment/Video*",
            "mov",
            None,
        )
        .unwrap();
        let managed_path = root.join(&managed.managed_relative_path);
        assert!(managed_path.exists());
        assert!(managed.managed_relative_path.contains("Environment/Video_"));
        assert_eq!(
            fs::read(&managed_path).unwrap(),
            fs::read(root.join(imported.relative_path)).unwrap()
        );
        fs::remove_file(&managed_path).unwrap();
        assert!(root
            .join("projects/project-library/Video/Mov")
            .read_dir()
            .unwrap()
            .next()
            .is_some());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn html_export_rejects_unexpected_file_types() {
        let result = export_html("not-a-document.exe".to_owned(), "<p>Safe</p>".to_owned());
        assert!(result.is_err());
    }

    #[test]
    fn binary_export_writes_a_user_selected_image_file() {
        let root = env::temp_dir().join(format!("art-equation-export-{}", uuid::Uuid::new_v4()));
        let target = root.join("board-image.avif");
        let result = export_binary(target.to_string_lossy().to_string(), vec![0, 1, 2, 3]).unwrap();
        assert_eq!(result.bytes_written, 4);
        assert_eq!(fs::read(target).unwrap(), vec![0, 1, 2, 3]);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn atomic_write_preserves_previous_version() {
        let root = env::temp_dir().join(format!("art-equation-test-{}", uuid::Uuid::new_v4()));
        let target = root.join("project.json");

        assert!(!atomic_write(&target, br#"{"version":1}"#).expect("first save should work"));
        assert!(atomic_write(&target, br#"{"version":2}"#).expect("second save should work"));
        assert_eq!(fs::read_to_string(&target).unwrap(), r#"{"version":2}"#);
        assert_eq!(
            fs::read_to_string(root.join("project.json.backup")).unwrap(),
            r#"{"version":1}"#
        );

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn board_style_fields_survive_project_json_round_trip() {
        let root = env::temp_dir().join(format!("art-equation-style-{}", uuid::Uuid::new_v4()));
        let target = root.join("project.json");
        let project = serde_json::json!({
            "schemaVersion": 7,
            "id": "style-project",
            "boards": [{
                "id": "board-1",
                "nodes": [
                    {
                        "id": "shape-1",
                        "kind": "shape",
                        "shapeType": "rectangle",
                        "color": "#c04d7a",
                        "strokeColor": "#29c7bd",
                        "strokeWidth": 8,
                        "cornerRadius": 24,
                        "opacity": 0.55
                    },
                    {
                        "id": "image-1",
                        "kind": "image",
                        "imageTransform": { "opacity": 0.62, "blendMode": "multiply" }
                    },
                    {
                        "id": "path-1",
                        "kind": "shape",
                        "shapeType": "path",
                        "vectorFillRule": "evenodd",
                        "vectorStrokeJoin": "round",
                        "vectorStrokeCap": "square",
                        "vectorTransform": { "scaleX": -1, "skewX": 18 },
                        "vectorPath": {
                            "version": 1,
                            "closed": true,
                            "points": [
                                { "x": 0, "y": 0, "handleOut": { "x": 20, "y": 0 }, "handleMode": "smooth" },
                                { "x": 80, "y": 40, "handleIn": { "x": -20, "y": 0 } },
                                { "x": 0, "y": 80 }
                            ]
                        }
                    }
                ]
            }]
        });
        let bytes = serde_json::to_vec_pretty(&project).unwrap();
        atomic_write(&target, &bytes).unwrap();
        let restored: Value = serde_json::from_slice(&fs::read(&target).unwrap()).unwrap();
        let shape = &restored["boards"][0]["nodes"][0];
        assert_eq!(shape["color"], "#c04d7a");
        assert_eq!(shape["strokeColor"], "#29c7bd");
        assert_eq!(shape["strokeWidth"], 8);
        assert_eq!(shape["cornerRadius"], 24);
        assert_eq!(shape["opacity"], 0.55);
        let image = &restored["boards"][0]["nodes"][1]["imageTransform"];
        assert_eq!(image["opacity"], 0.62);
        assert_eq!(image["blendMode"], "multiply");
        let path = &restored["boards"][0]["nodes"][2]["vectorPath"];
        assert_eq!(path["version"], 1);
        assert_eq!(path["closed"], true);
        assert_eq!(path["points"][0]["handleOut"]["x"], 20);
        assert_eq!(path["points"][0]["handleMode"], "smooth");
        let path_node = &restored["boards"][0]["nodes"][2];
        assert_eq!(path_node["vectorFillRule"], "evenodd");
        assert_eq!(path_node["vectorStrokeJoin"], "round");
        assert_eq!(path_node["vectorStrokeCap"], "square");
        assert_eq!(path_node["vectorTransform"]["scaleX"], -1);
        assert_eq!(path_node["vectorTransform"]["skewX"], 18);
        fs::remove_dir_all(root).unwrap();
    }
}
