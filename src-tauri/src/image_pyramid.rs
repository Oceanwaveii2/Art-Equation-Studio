//! Project-owned derived display pyramids. Originals are never rewritten.
use super::WorkspaceState;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    fs::{self, File},
    io::{Read, Write},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex, OnceLock,
    },
    time::{Duration, Instant},
};
use tauri::State;

const VERSION: &str = "libvips-8.18.2-pyramid-1";
const TILE: u32 = 512;
const OVERLAP: u32 = 1;
type Jobs = HashMap<String, (PyramidJob, Arc<AtomicBool>)>;
static JOBS: OnceLock<Mutex<Jobs>> = OnceLock::new();

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ImagePyramid {
    pub schema_version: u32,
    pub generator: String,
    pub source_sha256: String,
    pub width: u32,
    pub height: u32,
    pub tile_size: u32,
    pub overlap: u32,
    pub max_level: u32,
    pub format: String,
    pub tiles_relative_path: String,
    pub poster_relative_path: String,
    pub manifest_relative_path: String,
    pub tile_count: u64,
    pub generated_bytes: u64,
    pub display_color_space: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PyramidJob {
    pub id: String,
    pub project_id: String,
    pub asset_id: String,
    pub phase: String,
    pub elapsed_ms: u128,
    pub pyramid: Option<ImagePyramid>,
    pub error: Option<String>,
}

fn jobs() -> &'static Mutex<Jobs> {
    JOBS.get_or_init(|| Mutex::new(HashMap::new()))
}
fn phase(id: &str, value: &str) {
    if let Ok(mut jobs) = jobs().lock() {
        if let Some((job, _)) = jobs.get_mut(id) {
            job.phase = value.into();
        }
    }
}

pub(crate) fn vips_tool(name: &str) -> Result<PathBuf, String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let filename = format!("{name}.exe");
    #[allow(unused_mut)] // Debug builds append the source-relative tool directory.
    let mut candidates = vec![exe
        .parent()
        .unwrap_or(Path::new("."))
        .join("tools/libvips/vips-dev-8.18/bin")
        .join(&filename)];
    #[cfg(debug_assertions)]
    candidates.push(
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../tools/libvips/vips-dev-8.18/bin")
            .join(&filename),
    );
    candidates.into_iter().find(|p| p.is_file()).ok_or_else(|| "Large-image tools are missing. Run scripts/install-image-tools.ps1, or use a release containing the image tools.".into())
}

fn command(tool: &str) -> Result<Command, String> {
    let mut command = Command::new(vips_tool(tool)?);
    command
        .env("VIPS_CONCURRENCY", preparation_workers().to_string())
        .env("VIPS_DISC_THRESHOLD", "64m");
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    Ok(command)
}

fn worker_count(cores: usize, available_bytes: u64) -> usize {
    let reserved = if cores >= 4 { 2 } else { 1 };
    cores.saturating_sub(reserved).div_ceil(2).max(1).min(4).min((available_bytes / (512 * 1024 * 1024)).max(1) as usize)
}
pub(crate) fn preparation_workers() -> usize {
    let cores = std::thread::available_parallelism().map(usize::from).unwrap_or(1);
    let mut system = sysinfo::System::new(); system.refresh_memory();
    worker_count(cores, system.available_memory())
}

fn check_cancel(cancel: &AtomicBool) -> Result<(), String> {
    if cancel.load(Ordering::Acquire) {
        Err("Image preparation cancelled".into())
    } else {
        Ok(())
    }
}

fn run_vips(args: &[String], staging: &Path, cancel: &AtomicBool) -> Result<(), String> {
    check_cancel(cancel)?;
    let log_path = staging.join("worker.log");
    let log = File::create(&log_path).map_err(|e| e.to_string())?;
    let mut child = command("vips")?
        .args(args)
        .arg("--vips-cache-max-memory=67108864")
        .env("TMPDIR", staging)
        .env("TEMP", staging)
        .env("TMP", staging)
        .stdout(Stdio::null())
        .stderr(Stdio::from(log))
        .spawn()
        .map_err(|e| format!("Could not start image preparation: {e}"))?;
    loop {
        if cancel.load(Ordering::Acquire) {
            let _ = child.kill();
            let _ = child.wait();
            return Err("Image preparation cancelled".into());
        }
        if let Some(status) = child.try_wait().map_err(|e| e.to_string())? {
            if status.success() {
                return Ok(());
            }
            let detail = fs::read_to_string(&log_path).unwrap_or_default();
            return Err(format!(
                "Image preparation failed: {}",
                detail.chars().take(1500).collect::<String>()
            ));
        }
        std::thread::sleep(Duration::from_millis(40));
    }
}

fn header(source: &Path, field: &str) -> Result<u32, String> {
    let result = command("vipsheader")?
        .args(["-f", field])
        .arg(source)
        .output()
        .map_err(|e| e.to_string())?;
    if !result.status.success() {
        return Err(format!("Could not read image {field}"));
    }
    String::from_utf8_lossy(&result.stdout)
        .trim()
        .parse()
        .map_err(|_| format!("Invalid image {field}"))
}

pub(crate) fn needs_tiles(source: &Path) -> bool {
    image::image_dimensions(source)
        .map(|(w, h)| w.max(h) > 8192 || w as u64 * h as u64 > 32_000_000)
        .unwrap_or(false)
}

/// A bounded import preview, so a huge source is not decoded by Rust or the UI
/// before the user has a chance to prepare its pyramid.
pub(crate) fn large_thumbnail(source: &Path, target: &Path) -> Result<bool, String> {
    if !needs_tiles(source) {
        return Ok(false);
    }
    let temporary = target.with_extension("preparing.png");
    let status = command("vips")?
        .args(["thumbnail"])
        .arg(source)
        .arg(&temporary)
        .args([
            "768",
            "--height=768",
            "--size=down",
            "--export-profile=srgb",
            "--vips-cache-max-memory=67108864",
        ])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map_err(|e| e.to_string())?;
    if !status.success() {
        let _ = fs::remove_file(&temporary);
        return Err("Could not prepare the large-image preview".into());
    }
    fs::rename(temporary, target).map_err(|e| e.to_string())?;
    Ok(true)
}

fn digest(source: &Path, cancel: &AtomicBool) -> Result<String, String> {
    let mut file = File::open(source).map_err(|e| e.to_string())?;
    let mut hasher = Sha256::new();
    let mut buffer = [0u8; 65536];
    loop {
        check_cancel(cancel)?;
        let n = file.read(&mut buffer).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        hasher.update(&buffer[..n]);
    }
    Ok(hasher
        .finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect())
}

fn still_image(source: &Path) -> Result<(), String> {
    let extension = source
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if !["png", "jpg", "jpeg", "tif", "tiff", "bmp"].contains(&extension.as_str()) {
        return Err(
            "Tiled preparation currently supports still PNG, JPEG, TIFF and BMP images.".into(),
        );
    }
    if extension == "png" {
        use std::io::{Seek, SeekFrom};
        let mut file = File::open(source).map_err(|e| e.to_string())?;
        let length = file.metadata().map_err(|e| e.to_string())?.len();
        let mut chunk = [0u8; 8];
        file.read_exact(&mut chunk).map_err(|e| e.to_string())?;
        if &chunk != b"\x89PNG\r\n\x1a\n" {
            return Err("Invalid PNG header".into());
        }
        for _ in 0..4096 {
            file.read_exact(&mut chunk).map_err(|e| e.to_string())?;
            let size = u32::from_be_bytes(chunk[..4].try_into().unwrap()) as u64;
            match &chunk[4..] {
                b"acTL" => return Err("Animated PNG stays on the live-image renderer.".into()),
                b"IDAT" => return Ok(()),
                _ => {}
            }
            let next = file
                .stream_position()
                .map_err(|e| e.to_string())?
                .checked_add(size + 4)
                .ok_or("Invalid PNG chunks")?;
            if next > length {
                return Err("Invalid PNG chunk length".into());
            }
            file.seek(SeekFrom::Start(next))
                .map_err(|e| e.to_string())?;
        }
        return Err("PNG animation status could not be verified within 4096 chunks.".into());
    }
    if header(source, "n-pages").unwrap_or(1) > 1 {
        return Err(
            "Multi-page images need an explicit page selection before tiled preparation.".into(),
        );
    }
    Ok(())
}

fn inspect_tiles(
    base: &Path,
    width: u32,
    height: u32,
    max_level: u32,
    cancel: &AtomicBool,
) -> Result<(u64, u64), String> {
    if width == 0
        || height == 0
        || width > 262144
        || height > 262144
        || width as u64 * height as u64 > 1_000_000_000
        || max_level != 32 - (width.max(height) - 1).leading_zeros()
    {
        return Err("Invalid pyramid dimensions".into());
    }
    let mut tasks = Vec::new();
    for level in 0..=max_level {
        let factor = 1u64 << (max_level - level);
        let w = (width as u64).div_ceil(factor) as u32;
        let h = (height as u64).div_ceil(factor) as u32;
        for row in 0..h.div_ceil(TILE) {
            for col in 0..w.div_ceil(TILE) {
                check_cancel(cancel)?;
                let tile = base
                    .join(level.to_string())
                    .join(format!("{col}_{row}.png"));
                let expected_w =
                    TILE.min(w - col * TILE) + u32::from(col > 0) + u32::from((col + 1) * TILE < w);
                let expected_h =
                    TILE.min(h - row * TILE) + u32::from(row > 0) + u32::from((row + 1) * TILE < h);
                tasks.push((tile, expected_w, expected_h));
            }
        }
    }
    // At most four bounded 514x514 decodes. Merge by stable tile index; the
    // result and first error are independent of thread completion order.
    let next = std::sync::atomic::AtomicUsize::new(0);
    let mut completed = std::thread::scope(|scope| {
        let mut handles = Vec::new();
        for _ in 0..preparation_workers().min(tasks.len()).max(1) {
            let tasks = &tasks; let next = &next;
            handles.push(scope.spawn(move || {
                let mut rows = Vec::new();
                loop {
                    let index = next.fetch_add(1, Ordering::Relaxed);
                    let Some((tile, expected_w, expected_h)) = tasks.get(index) else { break };
                    let result = (|| -> Result<u64,String> {
                        check_cancel(cancel)?;
                        let actual = image::image_dimensions(tile).map_err(|e| format!("Incomplete tile {}: {e}", tile.display()))?;
                        if actual != (*expected_w,*expected_h) { return Err("Tile dimensions do not match the pyramid contract".into()); }
                        image::open(tile).map_err(|e| format!("Corrupt tile {}: {e}", tile.display()))?;
                        Ok(fs::metadata(tile).map_err(|e|e.to_string())?.len())
                    })();
                    rows.push((index,result));
                }
                rows
            }));
        }
        let mut rows = Vec::new();
        for handle in handles { rows.extend(handle.join().map_err(|_| "Tile validation worker failed".to_owned())?); }
        Ok::<_,String>(rows)
    })?;
    completed.sort_by_key(|row| row.0);
    let mut bytes = 0;
    for (_, result) in completed { bytes += result?; }
    Ok((tasks.len() as u64, bytes))
}

fn prepare(
    root: &Path,
    project: &str,
    source: &Path,
    job: &str,
    cancel: &AtomicBool,
) -> Result<ImagePyramid, String> {
    phase(job, "inspecting");
    still_image(source)?;
    let width = header(source, "width")?;
    let height = header(source, "height")?;
    if width == 0
        || height == 0
        || width > 262144
        || height > 262144
        || width as u64 * height as u64 > 1_000_000_000
    {
        return Err(
            "Image exceeds this preparation version's 262,144-edge / 1-gigapixel limit.".into(),
        );
    }
    let sha = digest(source, cancel)?;
    let project_root = super::project_root(root, project)?
        .canonicalize()
        .map_err(|e| e.to_string())?;
    let parent = project_root.join("assets/pyramids");
    fs::create_dir_all(&parent).map_err(|e| e.to_string())?;
    let parent = parent.canonicalize().map_err(|e| e.to_string())?;
    if !parent.starts_with(&project_root) {
        return Err("Pyramid destination escapes the project".into());
    }
    let key = format!("{sha}-v1");
    let final_path = parent.join(&key);
    for entry in fs::read_dir(&parent).map_err(|e| e.to_string())?.flatten() {
        check_cancel(cancel)?;
        let name = entry.file_name().to_string_lossy().to_string();
        if name != key && !name.starts_with(&format!("{key}-")) {
            continue;
        }
        let cached = match entry.path().canonicalize() {
            Ok(path) if path.parent() == Some(parent.as_path()) => path,
            _ => continue,
        };
        if let Ok(bytes) = fs::read(cached.join("manifest.json")) {
            if let Ok(manifest) = serde_json::from_slice::<ImagePyramid>(&bytes) {
                let relative = format!("projects/{project}/assets/pyramids/{name}");
                let poster_valid = image::image_dimensions(cached.join("poster.png"))
                    .map(|(w, h)| w > 0 && h > 0 && w <= 1024 && h <= 1024)
                    .unwrap_or(false)
                    && image::open(cached.join("poster.png")).is_ok();
                if manifest.schema_version == 1
                    && manifest.format == "png"
                    && manifest.source_sha256 == sha
                    && manifest.generator == VERSION
                    && manifest.tile_size == TILE
                    && manifest.overlap == OVERLAP
                    && manifest.tiles_relative_path == format!("{relative}/image_files")
                    && manifest.poster_relative_path == format!("{relative}/poster.png")
                    && manifest.manifest_relative_path == format!("{relative}/manifest.json")
                    && poster_valid
                    && inspect_tiles(
                        &cached.join("image_files"),
                        manifest.width,
                        manifest.height,
                        manifest.max_level,
                        cancel,
                    )
                    .is_ok()
                {
                    return Ok(manifest);
                }
            }
        }
        // Damaged derivatives stay available for inspection; reuse a valid repair.
    }
    let key = if final_path.exists() {
        format!("{key}-{}", uuid::Uuid::new_v4())
    } else {
        key
    };
    let final_path = parent.join(&key);
    let staging = parent.join(format!(".{key}.preparing-{job}"));
    fs::create_dir(&staging).map_err(|e| e.to_string())?;
    let result = (|| {
        let normalized = staging.join("normalized.v");
        phase(job, "normalizing");
        // thumbnail retains aspect, applies EXIF rotation and converts the
        // embedded profile to sRGB. At original max edge it does not downsample.
        run_vips(
            &[
                "thumbnail".into(),
                source.to_string_lossy().into(),
                normalized.to_string_lossy().into(),
                width.max(height).to_string(),
                format!("--height={}", width.max(height)),
                "--size=down".into(),
                "--export-profile=srgb".into(),
            ],
            &staging,
            cancel,
        )?;
        let width = header(&normalized, "width")?;
        let height = header(&normalized, "height")?;
        phase(job, "tiling");
        run_vips(
            &[
                "dzsave".into(),
                normalized.to_string_lossy().into(),
                staging.join("image").to_string_lossy().into(),
                "--tile-size=512".into(),
                "--overlap=1".into(),
                "--suffix=.png".into(),
                "--depth=onepixel".into(),
                "--keep=icc".into(),
            ],
            &staging,
            cancel,
        )?;
        phase(job, "poster");
        run_vips(
            &[
                "thumbnail".into(),
                normalized.to_string_lossy().into(),
                staging.join("poster.png").to_string_lossy().into(),
                "1024".into(),
                "--height=1024".into(),
                "--size=down".into(),
            ],
            &staging,
            cancel,
        )?;
        let max_level = 32 - (width.max(height) - 1).leading_zeros();
        phase(job, "verifying");
        let (tile_count, tile_bytes) = inspect_tiles(
            &staging.join("image_files"),
            width,
            height,
            max_level,
            cancel,
        )?;
        if digest(source, cancel)? != sha {
            return Err(
                "The source changed during preparation. Retry with the current file.".into(),
            );
        }
        // These are generated files within the checked staging directory only.
        fs::remove_file(&normalized).map_err(|e| e.to_string())?;
        let _ = fs::remove_file(staging.join("worker.log"));
        let relative = format!("projects/{project}/assets/pyramids/{key}");
        let manifest = ImagePyramid {
            schema_version: 1,
            generator: VERSION.into(),
            source_sha256: sha,
            width,
            height,
            tile_size: TILE,
            overlap: OVERLAP,
            max_level,
            format: "png".into(),
            tiles_relative_path: format!("{relative}/image_files"),
            poster_relative_path: format!("{relative}/poster.png"),
            manifest_relative_path: format!("{relative}/manifest.json"),
            tile_count,
            generated_bytes: tile_bytes
                + fs::metadata(staging.join("poster.png"))
                    .map_err(|e| e.to_string())?
                    .len(),
            display_color_space: "sRGB display derivative; original preserved".into(),
        };
        let mut file = File::create(staging.join("manifest.json")).map_err(|e| e.to_string())?;
        file.write_all(&serde_json::to_vec_pretty(&manifest).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
        file.sync_all().map_err(|e| e.to_string())?;
        drop(file);
        check_cancel(cancel)?;
        fs::rename(&staging, &final_path).map_err(|e| e.to_string())?;
        Ok(manifest)
    })();
    if result.is_err() && staging.exists() {
        let resolved = staging.canonicalize().map_err(|e| e.to_string())?;
        if resolved.parent() == Some(parent.as_path()) {
            let _ = fs::remove_dir_all(resolved);
        }
    }
    result
}

fn project_source(root: &Path, project: &str, relative_path: &str) -> Result<PathBuf, String> {
    let project_root = super::project_root(root, project)?
        .canonicalize()
        .map_err(|e| e.to_string())?;
    let relative = Path::new(relative_path);
    if relative.is_absolute()
        || relative
            .components()
            .any(|c| !matches!(c, std::path::Component::Normal(_)))
    {
        return Err("Image path must be project-relative".into());
    }
    let source = root
        .join(relative)
        .canonicalize()
        .map_err(|e| e.to_string())?;
    if !source.is_file() || !source.starts_with(project_root.join("assets")) {
        return Err("Image must belong to this project's assets".into());
    }
    Ok(source)
}

#[tauri::command]
pub(crate) fn start_image_pyramid(
    project_id: String,
    asset_id: String,
    relative_path: String,
    state: State<'_, WorkspaceState>,
) -> Result<PyramidJob, String> {
    if state.read_only {
        return Err("This workspace is read-only".into());
    }
    let project = super::validate_id(&project_id, "Project ID")?;
    let asset = super::validate_id(&asset_id, "Asset ID")?;
    let source = project_source(&state.root, &project, &relative_path)?;
    vips_tool("vips")?;
    let mut registry = jobs().lock().map_err(|e| e.to_string())?;
    if registry
        .values()
        .any(|(j, _)| !["complete", "failed", "cancelled"].contains(&j.phase.as_str()))
    {
        return Err("An image is already being prepared. Finish or cancel it first.".into());
    }
    if registry.len() >= 8 {
        registry.clear();
    }
    let id = uuid::Uuid::new_v4().to_string();
    let job = PyramidJob {
        id: id.clone(),
        project_id: project.clone(),
        asset_id: asset,
        phase: "queued".into(),
        elapsed_ms: 0,
        pyramid: None,
        error: None,
    };
    let cancel = Arc::new(AtomicBool::new(false));
    registry.insert(id.clone(), (job.clone(), cancel.clone()));
    let root = state.root.clone();
    std::thread::spawn(move || {
        let started = Instant::now();
        let result = prepare(&root, &project, &source, &id, &cancel);
        if let Ok(mut jobs) = jobs().lock() {
            if let Some((job, _)) = jobs.get_mut(&id) {
                job.elapsed_ms = started.elapsed().as_millis();
                match result {
                    Ok(pyramid) => {
                        job.phase = "complete".into();
                        job.pyramid = Some(pyramid);
                    }
                    Err(error) => {
                        job.phase = if cancel.load(Ordering::Acquire) {
                            "cancelled"
                        } else {
                            "failed"
                        }
                        .into();
                        job.error = Some(error);
                    }
                }
            }
        }
    });
    Ok(job)
}

#[tauri::command]
pub(crate) fn image_pyramid_status(job_id: String) -> Result<PyramidJob, String> {
    jobs()
        .lock()
        .map_err(|e| e.to_string())?
        .get(&job_id)
        .map(|(job, _)| job.clone())
        .ok_or("Image preparation job is no longer available".into())
}

#[tauri::command]
pub(crate) fn cancel_image_pyramid(job_id: String) -> Result<(), String> {
    let jobs = jobs().lock().map_err(|e| e.to_string())?;
    let (_, cancel) = jobs
        .get(&job_id)
        .ok_or("Image preparation job is no longer available")?;
    cancel.store(true, Ordering::Release);
    Ok(())
}

#[cfg(test)]
mod tests {
    #[test]
    fn preparation_reserves_cores_and_limits_memory() {
        for cores in [1,2,4,8,64] { let workers = super::worker_count(cores, 8 * 1024 * 1024 * 1024); assert!((1..=4).contains(&workers)); if cores >= 4 { assert!(workers <= cores - 2); } }
        assert_eq!(super::worker_count(64,512 * 1024 * 1024),1);
        assert_eq!(super::worker_count(1,0),1);
    }
    use super::*;
    #[test]
    fn real_pyramid_is_complete_reusable_and_preserves_original() {
        let root = std::env::temp_dir().join(format!(
            "art-equation-pyramid-test-{}",
            uuid::Uuid::new_v4()
        ));
        let asset_dir = root.join("projects/test-project/assets/originals");
        fs::create_dir_all(&asset_dir).unwrap();
        let source = asset_dir.join("source.png");
        image::DynamicImage::new_rgba8(1301, 769)
            .save(&source)
            .unwrap();
        assert!(project_source(
            &root,
            "test-project",
            "projects/test-project/assets/originals/source.png"
        )
        .is_ok());
        assert!(project_source(&root, "test-project", "../source.png").is_err());
        assert!(project_source(&root, "test-project", source.to_str().unwrap()).is_err());
        fs::create_dir_all(root.join("projects/other/assets")).unwrap();
        fs::write(
            root.join("projects/other/assets/other.png"),
            b"not an image",
        )
        .unwrap();
        assert!(project_source(&root, "test-project", "projects/other/assets/other.png").is_err());
        assert!(still_image(&root.join("projects/other/assets/other.png")).is_err());
        let cancel = AtomicBool::new(false);
        let before = digest(&source, &cancel).unwrap();
        let manifest = prepare(&root, "test-project", &source, "test-job", &cancel).unwrap();
        assert_eq!((manifest.width, manifest.height), (1301, 769));
        assert!(manifest.tile_count > 10);
        assert_eq!(digest(&source, &cancel).unwrap(), before);
        assert_eq!(
            prepare(&root, "test-project", &source, "retry", &cancel)
                .unwrap()
                .manifest_relative_path,
            manifest.manifest_relative_path
        );
        assert!(root.join(&manifest.poster_relative_path).is_file());
        fs::write(
            root.join(&manifest.manifest_relative_path),
            b"broken manifest",
        )
        .unwrap();
        let repaired = prepare(&root, "test-project", &source, "repair", &cancel).unwrap();
        assert_ne!(
            repaired.manifest_relative_path,
            manifest.manifest_relative_path
        );
        assert!(root.join(&repaired.poster_relative_path).is_file());
        assert_eq!(
            prepare(&root, "test-project", &source, "reuse-repair", &cancel)
                .unwrap()
                .manifest_relative_path,
            repaired.manifest_relative_path
        );
        let damaged_tile = root
            .join(&repaired.tiles_relative_path)
            .join(format!("{}/0_0.png", repaired.max_level));
        let mut truncated = fs::read(&damaged_tile).unwrap();
        truncated.truncate(40);
        fs::write(&damaged_tile, truncated).unwrap();
        let repaired = prepare(&root, "test-project", &source, "repair-pixels", &cancel).unwrap();
        assert!(image::open(
            root.join(&repaired.tiles_relative_path)
                .join(format!("{}/0_0.png", repaired.max_level))
        )
        .is_ok());
        // An interrupted staging directory cannot be mistaken for a published cache.
        let abandoned = asset_dir
            .parent()
            .unwrap()
            .join("pyramids/.interrupted.preparing-old-job");
        fs::create_dir_all(&abandoned).unwrap();
        assert_eq!(
            prepare(&root, "test-project", &source, "restart", &cancel)
                .unwrap()
                .manifest_relative_path,
            repaired.manifest_relative_path
        );
        assert!(inspect_tiles(&root, 1, 1, 100, &cancel).is_err());
        cancel.store(true, Ordering::Release);
        assert!(prepare(&root, "test-project", &source, "cancel", &cancel).is_err());
        let validated = root.canonicalize().unwrap();
        assert!(validated.starts_with(std::env::temp_dir().canonicalize().unwrap()));
        fs::remove_dir_all(validated).unwrap();
    }
    #[test]
    fn animated_png_is_not_frozen_into_tiles() {
        let source =
            Path::new(env!("CARGO_MANIFEST_DIR")).join("../scripts/fixtures/retained-animated.png");
        assert!(still_image(&source).unwrap_err().contains("Animated PNG"));
    }

    #[test]
    fn cancelling_a_running_worker_reaps_the_process() {
        let staging =
            std::env::temp_dir().join(format!("art-equation-cancel-test-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&staging).unwrap();
        let cancelled = Arc::new(AtomicBool::new(false));
        let signal = cancelled.clone();
        let trigger = std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(20));
            signal.store(true, Ordering::Release);
        });
        let started = Instant::now();
        let result = run_vips(
            &[
                "gaussnoise".into(),
                staging.join("noise.v").to_string_lossy().into(),
                "8192".into(),
                "8192".into(),
            ],
            &staging,
            &cancelled,
        );
        trigger.join().unwrap();
        assert!(result.unwrap_err().contains("cancelled"));
        assert!(started.elapsed() < Duration::from_secs(5));
        // Windows refuses this cleanup if the cancelled child still holds output.
        let checked = staging.canonicalize().unwrap();
        assert_eq!(
            checked.parent(),
            Some(std::env::temp_dir().canonicalize().unwrap().as_path())
        );
        fs::remove_dir_all(checked).unwrap();
    }

    #[test]
    #[ignore = "Generates real small and >GPU-limit pyramids for the browser integration suite"]
    fn browser_pyramid_fixtures() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../tmp/pyramid-fixtures");
        let assets = root.join("projects/test-project/assets/originals");
        fs::create_dir_all(&assets).unwrap();
        for (name, width, height) in [("small", 1301, 769), ("giant", 40001, 1025)] {
            let source = assets.join(format!("{name}.png"));
            if !source.exists() {
                let image = image::RgbaImage::from_fn(width, height, |x, y| {
                    image::Rgba([
                        ((x / 64 * 37) % 256) as u8,
                        ((y / 64 * 53) % 256) as u8,
                        ((x / 256 + y / 128) * 29 % 256) as u8,
                        if (x / 256 + y / 256) % 3 == 0 {
                            128
                        } else {
                            255
                        },
                    ])
                });
                image.save(&source).unwrap();
            }
            let before = digest(&source, &AtomicBool::new(false)).unwrap();
            let started = Instant::now();
            let manifest = prepare(
                &root,
                "test-project",
                &source,
                name,
                &AtomicBool::new(false),
            )
            .unwrap();
            assert_eq!(digest(&source, &AtomicBool::new(false)).unwrap(), before);
            fs::write(
                root.join(format!("{name}.json")),
                serde_json::to_vec_pretty(&manifest).unwrap(),
            )
            .unwrap();
            println!(
                "{name}: {}x{}, {} tiles, {} bytes, {:?}",
                manifest.width,
                manifest.height,
                manifest.tile_count,
                manifest.generated_bytes,
                started.elapsed()
            );
        }
        let source = assets.join("giant.png");
        assert!(needs_tiles(&source));
        let preview = root.join("large-import-preview.png");
        assert!(large_thumbnail(&source, &preview).unwrap());
        let (w, h) = image::image_dimensions(preview).unwrap();
        assert!(w <= 768 && h <= 768);
    }
}
