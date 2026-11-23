use serde::{Deserialize, Serialize};
use std::{
    collections::HashSet,
    fs::{self, Metadata, OpenOptions},
    io::{self, Write},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU64, AtomicU8, AtomicUsize, Ordering},
        mpsc, Arc, Mutex,
    },
};
use tauri::{ipc::Channel, AppHandle, Manager};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_fs::FsExt;

#[cfg(target_os = "macos")]
mod macos;
mod metadata;
#[cfg(target_os = "macos")]
use macos as platform;

#[cfg(not(target_os = "macos"))]
mod platform {
    use super::{ExportFormat, ExportJob, ExportSettings, Path};

    pub fn available(_: ExportFormat) -> bool {
        false
    }

    pub fn memory_bytes() -> u64 {
        0
    }

    pub fn render(_: &Path, _: &ExportJob, _: &ExportSettings) -> Result<Vec<u8>, String> {
        Err("Native image export is unavailable on this platform.".to_owned())
    }
}

static DESTINATION: Mutex<Option<DestinationGrant>> = Mutex::new(None);
static ACTIVE: Mutex<Option<ActiveRun>> = Mutex::new(None);
static RUN_SEQUENCE: AtomicU64 = AtomicU64::new(1);
const RUNNING: u8 = 0;
const KEEP_OUTPUTS: u8 = 1;
const DELETE_OUTPUTS: u8 = 2;
const FINISHED: u8 = 3;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ExportFormat {
    Jpeg,
    Png,
    Webp,
}

impl ExportFormat {
    fn extension(self) -> &'static str {
        match self {
            Self::Jpeg => "jpg",
            Self::Png => "png",
            Self::Webp => "webp",
        }
    }
}

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "lowercase")]
enum OriginalSize {
    Original,
}

#[derive(Clone, Copy, Deserialize)]
#[serde(untagged)]
enum ExportSize {
    Original(OriginalSize),
    ShortEdge(u32),
}

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "lowercase")]
enum ColorSpace {
    Srgb,
    Original,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportSettings {
    format: ExportFormat,
    size: ExportSize,
    quality: u8,
    keep_camera: bool,
    keep_lens: bool,
    keep_exposure: bool,
    keep_date: bool,
    keep_gps: bool,
    keep_serial: bool,
    apply_metadata_corrections: bool,
    color_space: ColorSpace,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportJob {
    id: String,
    path: PathBuf,
    frame: Frame,
    #[serde(default)]
    crop: Crop,
    #[serde(default)]
    text: Vec<TextItem>,
    #[serde(default)]
    metadata: MetadataCorrections,
}

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Crop {
    #[serde(default)]
    x: f64,
    #[serde(default)]
    y: f64,
    #[serde(default = "one")]
    width: f64,
    #[serde(default = "one")]
    height: f64,
    #[serde(default)]
    rotation: f64,
}
fn one() -> f64 {
    1.0
}
impl Default for Crop {
    fn default() -> Self {
        Self {
            x: 0.0,
            y: 0.0,
            width: 1.0,
            height: 1.0,
            rotation: 0.0,
        }
    }
}

#[derive(Clone, Default, Deserialize)]
pub struct MetadataCorrections {
    camera: Option<String>,
    lens: Option<String>,
}

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "lowercase")]
enum FrameStyle {
    None,
    Black,
    White,
    Blurred,
    #[serde(alias = "softWhite")]
    SoftWhite,
    #[serde(alias = "softBlack")]
    SoftBlack,
    Custom,
    #[serde(alias = "ambientGradient")]
    AmbientGradient,
    #[serde(alias = "edgeStretch")]
    EdgeStretch,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Frame {
    style: FrameStyle,
    #[serde(default)]
    custom_color: Option<String>,
    top: f64,
    bottom: f64,
    left: f64,
    right: f64,
    blur_strength: f64,
    background_brightness: f64,
    #[serde(default = "full_opacity")]
    background_opacity: f64,
    show_inset: bool,
    show_shadow: bool,
    #[serde(default = "ambient_intensity_default")]
    ambient_intensity: f64,
    #[serde(default = "ambient_softness_default")]
    ambient_softness: f64,
    #[serde(default)]
    ambient_brightness: f64,
    #[serde(default = "ambient_source_default")]
    ambient_color_source: String,
    #[serde(default = "edge_mode_default")]
    edge_stretch_mode: String,
    #[serde(default = "edge_blur_default")]
    edge_stretch_blur: f64,
    #[serde(default = "edge_fade_default")]
    edge_stretch_fade: f64,
}

fn ambient_intensity_default() -> f64 {
    85.0
}
fn ambient_softness_default() -> f64 {
    65.0
}
fn ambient_source_default() -> String {
    "fullImage".to_owned()
}
fn edge_mode_default() -> String {
    "extend".to_owned()
}
fn edge_blur_default() -> f64 {
    8.0
}
fn edge_fade_default() -> f64 {
    12.0
}

fn full_opacity() -> f64 {
    100.0
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TextItem {
    text: String,
    #[serde(default = "bottom_left")]
    anchor: String,
    x: f64,
    y: f64,
    size: f64,
    font_family: String,
    weight: u32,
    color: String,
    #[serde(default)]
    opacity: Option<f64>,
    #[serde(default)]
    anchor_mode: Option<String>,
}

fn bottom_left() -> String {
    "bottom-left".to_owned()
}

#[derive(Clone, Copy, Debug, Default)]
#[repr(C)]
struct Rect {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

struct Layout {
    width: u32,
    height: u32,
    image: Rect,
    visible_image: Rect,
}

fn layout(
    frame: &Frame,
    source_width: u32,
    source_height: u32,
    size: ExportSize,
) -> Result<Layout, String> {
    if source_width == 0 || source_height == 0 {
        return Err("Invalid image or canvas dimensions.".to_owned());
    }

    if matches!(frame.style, FrameStyle::None) {
        let edge = match size {
            ExportSize::Original(OriginalSize::Original) => None,
            ExportSize::ShortEdge(edge) if edge > 0 => Some(edge),
            ExportSize::ShortEdge(_) => return Err("Invalid export size.".to_owned()),
        };
        let scale = edge
            .map(|value| f64::from(value) / f64::from(source_width.min(source_height)))
            .unwrap_or(1.0);
        let width = (f64::from(source_width) * scale).round().max(1.0) as u32;
        let height = (f64::from(source_height) * scale).round().max(1.0) as u32;
        if u64::from(width) * u64::from(height) > 90_000_000 || width > 32_768 || height > 32_768 {
            return Err(
                "The output dimensions are too large. Choose a smaller export size.".to_owned(),
            );
        }
        let image = Rect {
            x: 0.0,
            y: 0.0,
            width: f64::from(width),
            height: f64::from(height),
        };
        return Ok(Layout {
            width,
            height,
            image,
            visible_image: image,
        });
    }

    // Padding values remain percentages of the completed canvas, matching the
    // editor and existing presets. Solve that relationship algebraically so
    // that the full source image always fits inside the padded canvas.
    let fraction = |value: f64| {
        if value.is_finite() {
            value.clamp(0.0, 49.0) / 100.0
        } else {
            0.0
        }
    };
    let left = fraction(frame.left);
    let right = fraction(frame.right);
    let top = fraction(frame.top);
    let bottom = fraction(frame.bottom);
    let inner_width = 1.0 - left - right;
    let inner_height = 1.0 - top - bottom;
    let source_width = f64::from(source_width);
    let source_height = f64::from(source_height);
    let canvas_width_exact = source_width / inner_width;
    let canvas_height_exact = source_height / inner_height;
    let scale = match size {
        ExportSize::Original(OriginalSize::Original) => 1.0,
        ExportSize::ShortEdge(edge) if edge > 0 => {
            f64::from(edge) / canvas_width_exact.min(canvas_height_exact)
        }
        ExportSize::ShortEdge(_) => return Err("Invalid export size.".to_owned()),
    };
    // Round canvas dimensions up after applying one uniform image scale. The
    // fractional remainder becomes at most one extra pixel of outer padding,
    // preventing the canvas edge from clipping any part of the source image.
    let width = (canvas_width_exact * scale).ceil().max(1.0) as u32;
    let height = (canvas_height_exact * scale).ceil().max(1.0) as u32;
    if u64::from(width) * u64::from(height) > 90_000_000 || width > 32_768 || height > 32_768 {
        return Err(
            "The output dimensions are too large. Choose a smaller export size.".to_owned(),
        );
    }

    let image_width = source_width * scale;
    let image_height = source_height * scale;
    let image = Rect {
        x: f64::from(width) * left,
        y: f64::from(height) * top,
        width: image_width,
        height: image_height,
    };

    Ok(Layout {
        width,
        height,
        image,
        visible_image: image,
    })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportCapabilities {
    formats: Vec<ExportFormat>,
    metadata_formats: Vec<ExportFormat>,
    icc_formats: Vec<ExportFormat>,
}

#[tauri::command]
pub fn get_export_capabilities() -> ExportCapabilities {
    let formats = [ExportFormat::Jpeg, ExportFormat::Png, ExportFormat::Webp]
        .into_iter()
        .filter(|format| platform::available(*format))
        .collect::<Vec<_>>();
    ExportCapabilities {
        metadata_formats: formats.clone(),
        icc_formats: formats.clone(),
        formats,
    }
}

#[derive(Deserialize, Serialize)]
struct DestinationGrant {
    path: PathBuf,
    identity: (u64, u64),
}

fn grant_path(app: &AppHandle) -> Option<PathBuf> {
    app.path()
        .app_data_dir()
        .ok()
        .map(|directory| directory.join("export-destination.json"))
}

fn save_grant(app: &AppHandle, grant: &DestinationGrant) -> io::Result<()> {
    let path = grant_path(app)
        .ok_or_else(|| io::Error::other("Application data directory unavailable"))?;
    let directory = path
        .parent()
        .ok_or_else(|| io::Error::other("Invalid application data directory"))?;
    fs::create_dir_all(directory)?;
    let nonce = RUN_SEQUENCE.fetch_add(1, Ordering::Relaxed);
    let temporary = directory.join(format!(
        "export-destination-{}-{nonce}.tmp",
        std::process::id()
    ));
    let metadata = write_new(&temporary, &serde_json::to_vec(grant)?)?;
    let temporary = TemporaryOutput::new(temporary, &metadata);
    fs::rename(&temporary.path, path)
}

#[tauri::command]
pub async fn choose_export_destination(
    app: AppHandle,
    default_path: Option<PathBuf>,
    title: Option<String>,
) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut dialog = app
            .dialog()
            .file()
            .set_title(title.as_deref().unwrap_or("Choose export folder"));
        if let Some(path) = default_path.filter(|path| path.is_dir()) {
            dialog = dialog.set_directory(path);
        }
        let Some(selected) = dialog.blocking_pick_folder() else {
            return Ok(None);
        };
        let path = selected.into_path().map_err(|error| error.to_string())?;
        let path = path.canonicalize().map_err(|error| error.to_string())?;
        let displayed_path = path
            .to_str()
            .ok_or("The destination path is not valid UTF-8.")?
            .to_owned();
        let metadata = path.metadata().map_err(|error| error.to_string())?;
        let grant = DestinationGrant {
            path,
            identity: file_identity(&metadata),
        };
        let mut destination = DESTINATION.lock().map_err(|error| error.to_string())?;
        let _ = save_grant(&app, &grant);
        *destination = Some(grant);
        Ok(Some(displayed_path))
    })
    .await
    .map_err(|error| error.to_string())?
}

fn authorized_destination(app: &AppHandle, path: &Path) -> Option<PathBuf> {
    let resolved = path.canonicalize().ok()?;
    let metadata = resolved.metadata().ok()?;
    let mut stored = DESTINATION.lock().ok()?;
    if stored.is_none() {
        let path = grant_path(app)?;
        let bytes = fs::read(path).ok()?;
        *stored = serde_json::from_slice(&bytes).ok();
    }
    let grant = stored.as_ref()?;
    (metadata.is_dir() && grant.path == resolved && grant.identity == file_identity(&metadata))
        .then_some(resolved)
}

#[tauri::command]
pub fn check_export_destination(app: AppHandle, destination: PathBuf) -> bool {
    authorized_destination(&app, &destination).is_some()
}

#[derive(Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CancelPolicy {
    Keep,
    Delete,
}

struct ActiveRun {
    id: String,
    status: Arc<AtomicU8>,
}

#[derive(Clone, Serialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum ExportEvent {
    Photo {
        id: String,
        outcome: ExportOutcome,
        processed: usize,
        total: usize,
    },
    Finished {
        cancelled: bool,
        cleanup_errors: Vec<String>,
        deleted_ids: Vec<String>,
    },
}

#[derive(Clone, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum ExportOutcome {
    Success { path: String },
    Failed { message: String },
}

#[tauri::command]
pub fn begin_export(
    app: AppHandle,
    destination: PathBuf,
    jobs: Vec<ExportJob>,
    settings: ExportSettings,
    on_event: Channel<ExportEvent>,
) -> Result<String, String> {
    let destination = authorized_destination(&app, &destination)
        .ok_or("Select the destination folder in Lustra before exporting.")?;
    if jobs.is_empty() {
        return Err("There are no photos to export.".to_owned());
    }
    if jobs.iter().any(|job| !job.path.is_absolute()) {
        return Err("Every export job needs an absolute source path.".to_owned());
    }
    let unique_ids: HashSet<_> = jobs.iter().map(|job| &job.id).collect();
    if unique_ids.len() != jobs.len() {
        return Err("The export batch contains duplicate job IDs.".to_owned());
    }
    if !platform::available(settings.format) {
        return Err("This output format is unavailable on this computer.".to_owned());
    }
    if matches!(settings.size, ExportSize::ShortEdge(edge) if ![720, 1080, 1440, 2160].contains(&edge))
    {
        return Err("The short edge needs to be 720, 1080, 1440, or 2160 pixels.".to_owned());
    }
    if !(1..=100).contains(&settings.quality) {
        return Err("Quality must be between 1 and 100.".to_owned());
    }

    let mut active = ACTIVE.lock().map_err(|error| error.to_string())?;
    if active.is_some() {
        return Err("An export is already running.".to_owned());
    }
    let id = format!(
        "{}-{}",
        std::process::id(),
        RUN_SEQUENCE.fetch_add(1, Ordering::Relaxed)
    );
    let status = Arc::new(AtomicU8::new(RUNNING));
    *active = Some(ActiveRun {
        id: id.clone(),
        status: status.clone(),
    });
    let worker_id = id.clone();
    tauri::async_runtime::spawn_blocking(move || {
        run_export(
            app,
            destination,
            &jobs,
            &settings,
            on_event,
            status,
            &worker_id,
        )
    });
    Ok(id)
}

#[tauri::command]
pub fn cancel_export(run_id: String, policy: CancelPolicy) -> Result<(), String> {
    let active = ACTIVE.lock().map_err(|error| error.to_string())?;
    let Some(run) = active.as_ref().filter(|run| run.id == run_id) else {
        return Ok(());
    };
    let status = match policy {
        CancelPolicy::Keep => KEEP_OUTPUTS,
        CancelPolicy::Delete => DELETE_OUTPUTS,
    };
    let _ = run
        .status
        .compare_exchange(RUNNING, status, Ordering::AcqRel, Ordering::Acquire);
    Ok(())
}

struct OutputFile {
    path: PathBuf,
    metadata: Metadata,
}

fn render_one(
    app: &AppHandle,
    destination: &Path,
    job: &ExportJob,
    settings: &ExportSettings,
    status: &AtomicU8,
    run_id: &str,
    index: usize,
) -> Result<Option<OutputFile>, String> {
    let source = job
        .path
        .canonicalize()
        .map_err(|error| format!("Cannot access the source photo: {error}"))?;
    if !source.is_file()
        || !(app.fs_scope().is_allowed(&source) || app.asset_protocol_scope().is_allowed(&source))
    {
        return Err("The source photo needs to be selected or relinked in Lustra.".to_owned());
    }
    let is_photo = source.extension().is_some_and(|extension| {
        ["jpg", "jpeg", "png", "webp"]
            .iter()
            .any(|supported| extension.eq_ignore_ascii_case(supported))
    });
    if !is_photo {
        return Err("The source is not a supported image file.".to_owned());
    }

    let bytes = platform::render(&source, job, settings)?;
    if status.load(Ordering::Acquire) != RUNNING {
        return Ok(None);
    }

    let metadata = metadata::filtered_exif(&source, settings, &job.metadata)?;
    let bytes = match metadata {
        Some(metadata) => metadata::attach_exif(bytes, metadata, settings.format)?,
        None => bytes,
    };
    if status.load(Ordering::Acquire) != RUNNING {
        return Ok(None);
    }

    let stem = job
        .path
        .file_stem()
        .and_then(|stem| stem.to_str())
        .ok_or("Invalid photo filename.")?;
    write_output(destination, stem, settings.format, &bytes, run_id, index)
        .map(Some)
        .map_err(|error| format!("Cannot write the output file: {error}"))
}

fn run_export(
    app: AppHandle,
    destination: PathBuf,
    jobs: &[ExportJob],
    settings: &ExportSettings,
    events: Channel<ExportEvent>,
    status: Arc<AtomicU8>,
    run_id: &str,
) {
    let cpu_count = std::thread::available_parallelism().map_or(1, usize::from);
    let worker_count = if matches!(settings.size, ExportSize::Original(_))
        || cpu_count < 6
        || platform::memory_bytes() < 12 * 1024 * 1024 * 1024
    {
        1
    } else {
        jobs.len().min(2)
    };
    let next_job = AtomicUsize::new(0);
    let (sent, received) = mpsc::channel();
    let mut written = Vec::new();
    let mut processed = 0;

    std::thread::scope(|scope| {
        for _ in 0..worker_count {
            let sent = sent.clone();
            let next_job = &next_job;
            let status = &status;
            let app = &app;
            let destination = &destination;
            scope.spawn(move || {
                while status.load(Ordering::Acquire) == RUNNING {
                    let index = next_job.fetch_add(1, Ordering::Relaxed);
                    let Some(job) = jobs.get(index) else { break };
                    let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                        render_one(app, destination, job, settings, status, run_id, index)
                    }))
                    .unwrap_or_else(|_| Err("The image renderer stopped unexpectedly.".to_owned()));
                    if sent.send((job, outcome)).is_err() {
                        break;
                    }
                }
            });
        }
        drop(sent);
        for (job, result) in received {
            let outcome = match result {
                Ok(Some(output)) => {
                    let path = output.path.to_string_lossy().into_owned();
                    written.push((job.id.clone(), output));
                    ExportOutcome::Success { path }
                }
                Ok(None) => continue,
                Err(message) => ExportOutcome::Failed { message },
            };
            processed += 1;
            if events
                .send(ExportEvent::Photo {
                    id: job.id.clone(),
                    outcome,
                    processed,
                    total: jobs.len(),
                })
                .is_err()
            {
                let _ = status.compare_exchange(
                    RUNNING,
                    KEEP_OUTPUTS,
                    Ordering::AcqRel,
                    Ordering::Acquire,
                );
            }
        }
    });

    let final_status = status.swap(FINISHED, Ordering::AcqRel);
    let mut cleanup_errors = Vec::new();
    let mut deleted_ids = Vec::new();
    if final_status == DELETE_OUTPUTS {
        for (id, output) in written {
            match remove_output(&output) {
                Ok(()) => deleted_ids.push(id),
                Err(error) => cleanup_errors.push(format!("{}: {error}", output.path.display())),
            }
        }
    }
    if let Ok(mut active) = ACTIVE.lock() {
        *active = None;
    }
    let _ = events.send(ExportEvent::Finished {
        cancelled: final_status != RUNNING,
        cleanup_errors,
        deleted_ids,
    });
}

struct TemporaryOutput {
    path: PathBuf,
    identity: (u64, u64),
}

impl TemporaryOutput {
    fn new(path: PathBuf, metadata: &Metadata) -> Self {
        Self {
            path,
            identity: file_identity(metadata),
        }
    }
}

impl Drop for TemporaryOutput {
    fn drop(&mut self) {
        remove_if_owned(&self.path, self.identity);
    }
}

fn remove_if_owned(path: &Path, identity: (u64, u64)) {
    if fs::symlink_metadata(path)
        .is_ok_and(|file| file.is_file() && file_identity(&file) == identity)
    {
        let _ = fs::remove_file(path);
    }
}

fn write_new(path: &Path, bytes: &[u8]) -> io::Result<Metadata> {
    let mut file = OpenOptions::new().write(true).create_new(true).open(path)?;
    let result = (|| {
        file.write_all(bytes)?;
        file.sync_all()?;
        file.metadata()
    })();
    if result.is_err() {
        let identity = file.metadata().ok().as_ref().map(file_identity);
        drop(file);
        if let Some(identity) = identity {
            remove_if_owned(path, identity);
        }
    }
    result
}

fn write_output(
    directory: &Path,
    stem: &str,
    format: ExportFormat,
    bytes: &[u8],
    run_id: &str,
    index: usize,
) -> io::Result<OutputFile> {
    let temporary_path = directory.join(format!(".lustra-export-{run_id}-{index}.tmp"));
    let metadata = write_new(&temporary_path, bytes)?;
    let temporary = TemporaryOutput::new(temporary_path, &metadata);
    let mut can_link = true;
    for number in 1..=10_000 {
        let extra = if number == 1 {
            String::new()
        } else {
            format!("_{number}")
        };
        let path = directory.join(format!("{stem}_framed{extra}.{}", format.extension()));
        if can_link {
            match fs::hard_link(&temporary.path, &path) {
                Ok(()) => return Ok(OutputFile { path, metadata }),
                Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
                Err(error)
                    if [
                        io::ErrorKind::Unsupported,
                        io::ErrorKind::PermissionDenied,
                        io::ErrorKind::CrossesDevices,
                    ]
                    .contains(&error.kind()) =>
                {
                    can_link = false
                }
                Err(error) => return Err(error),
            }
        }

        // Some removable and network volumes cannot create hard links. Use a
        // no-replace create there and remove an incomplete file on write failure.
        match write_new(&path, bytes) {
            Ok(metadata) => return Ok(OutputFile { path, metadata }),
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(error),
        }
    }
    Err(io::Error::new(
        io::ErrorKind::AlreadyExists,
        "All numbered output names already exist.",
    ))
}

fn remove_output(output: &OutputFile) -> io::Result<()> {
    let current = match fs::symlink_metadata(&output.path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(error),
    };
    if !current.is_file()
        || current.len() != output.metadata.len()
        || current.modified().ok() != output.metadata.modified().ok()
        || file_identity(&current) != file_identity(&output.metadata)
    {
        return Err(io::Error::other(
            "The file changed after export and was left in place.",
        ));
    }
    fs::remove_file(&output.path)
}

#[cfg(unix)]
fn file_identity(metadata: &Metadata) -> (u64, u64) {
    use std::os::unix::fs::MetadataExt;
    (metadata.dev(), metadata.ino())
}

#[cfg(not(unix))]
fn file_identity(metadata: &Metadata) -> (u64, u64) {
    let created = metadata
        .created()
        .ok()
        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok());
    created.map_or((0, 0), |time| {
        (time.as_secs(), u64::from(time.subsec_nanos()))
    })
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::*;
    use exif::{experimental::Writer, Field, In, Reader, Tag, Value};
    use std::io::Cursor;

    // A 3×2 RGB image with red and green rows, independent of any system photos.
    const SOURCE_PNG: &[u8] = &[
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44,
        0x52, 0x00, 0x00, 0x00, 0x03, 0x00, 0x00, 0x00, 0x02, 0x08, 0x02, 0x00, 0x00, 0x00, 0x12,
        0x16, 0xf1, 0x4d, 0x00, 0x00, 0x00, 0x11, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0xf8,
        0xcf, 0xc0, 0x00, 0x41, 0x30, 0xfa, 0x3f, 0x03, 0x00, 0x3e, 0xd5, 0x05, 0xfb, 0xa8, 0x2e,
        0x2f, 0x4d, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
    ];

    struct ScratchDirectory(PathBuf);

    impl ScratchDirectory {
        fn new() -> Self {
            let nonce = RUN_SEQUENCE.fetch_add(1, Ordering::Relaxed);
            let path = std::env::temp_dir()
                .join(format!("lustra-export-test-{}-{nonce}", std::process::id()));
            fs::create_dir(&path).unwrap();
            Self(path)
        }
    }

    impl Drop for ScratchDirectory {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn frame() -> Frame {
        Frame {
            style: FrameStyle::Blurred,
            custom_color: None,
            top: 0.0,
            bottom: 0.0,
            left: 0.0,
            right: 0.0,
            blur_strength: 30.0,
            background_brightness: 80.0,
            background_opacity: 70.0,
            show_inset: true,
            show_shadow: true,
            ambient_intensity: 85.0,
            ambient_softness: 65.0,
            ambient_brightness: 0.0,
            ambient_color_source: "fullImage".into(),
            edge_stretch_mode: "extend".into(),
            edge_stretch_blur: 8.0,
            edge_stretch_fade: 12.0,
        }
    }

    #[test]
    fn original_size_adds_padding_without_resizing_or_cropping_source() {
        let mut frame = frame();
        frame.left = 10.0;
        frame.bottom = 20.0;
        let output = layout(
            &frame,
            600,
            400,
            ExportSize::Original(OriginalSize::Original),
        )
        .unwrap();
        assert_eq!((output.width, output.height), (667, 500));
        assert_eq!(output.image.width, 600.0);
        assert_eq!(output.image.height, 400.0);
        assert_eq!(output.image.x, f64::from(output.width) * 0.1);
        assert_eq!(output.image.y, f64::from(output.height) * 0.0);
        assert_eq!(output.visible_image.width, output.image.width);
        assert_eq!(output.visible_image.height, output.image.height);
    }

    #[test]
    fn none_original_size_ignores_saved_padding_and_preserves_source_dimensions() {
        let mut settings = frame();
        settings.style = FrameStyle::None;
        settings.left = 18.0;
        settings.top = 12.0;
        let result = layout(
            &settings,
            1600,
            900,
            ExportSize::Original(OriginalSize::Original),
        )
        .unwrap();
        assert_eq!((result.width, result.height), (1600, 900));
        assert_eq!(
            (
                result.image.x,
                result.image.y,
                result.image.width,
                result.image.height
            ),
            (0.0, 0.0, 1600.0, 900.0)
        );
    }

    #[test]
    fn short_edge_scales_complete_canvas_and_keeps_source_aspect_ratio() {
        let mut frame = frame();
        frame.left = 10.0;
        frame.bottom = 20.0;
        let output = layout(&frame, 600, 400, ExportSize::ShortEdge(720)).unwrap();
        assert_eq!((output.width, output.height), (960, 720));
        assert!((output.image.width / output.image.height - 1.5).abs() < f64::EPSILON);
        assert_eq!(output.image.x, 96.0);
        assert_eq!(output.visible_image.width, output.image.width);
        assert_eq!(output.visible_image.height, output.image.height);
    }

    #[test]
    fn frame_style_colors_are_written_to_png_pixels_without_changing_the_source() {
        let directory = ScratchDirectory::new();
        let path = directory.0.join("source.png");
        fs::write(&path, SOURCE_PNG).unwrap();
        let settings = ExportSettings {
            format: ExportFormat::Png,
            size: ExportSize::Original(OriginalSize::Original),
            quality: 90,
            keep_camera: false,
            keep_lens: false,
            keep_exposure: false,
            keep_date: false,
            keep_gps: false,
            keep_serial: false,
            apply_metadata_corrections: false,
            color_space: ColorSpace::Srgb,
        };
        for (style, custom_color, expected) in [
            (FrameStyle::Black, None, [0x00, 0x00, 0x00]),
            (FrameStyle::SoftBlack, None, [0x24, 0x24, 0x24]),
            (FrameStyle::White, None, [0xFF, 0xFF, 0xFF]),
            (FrameStyle::SoftWhite, None, [0xFA, 0xFA, 0xF8]),
            (FrameStyle::Custom, Some("#123ABC"), [0x12, 0x3A, 0xBC]),
            (FrameStyle::AmbientGradient, None, [0x45, 0x48, 0x42]),
            (FrameStyle::EdgeStretch, None, [0x45, 0x48, 0x42]),
        ] {
            let mut export_frame = frame();
            export_frame.style = style;
            export_frame.custom_color = custom_color.map(str::to_owned);
            export_frame.left = 50.0;
            if matches!(style, FrameStyle::EdgeStretch) {
                export_frame.edge_stretch_fade = 0.0;
            }
            let job = ExportJob {
                path: path.clone(),
                id: "frame-color-pixel".to_owned(),
                frame: export_frame,
                crop: Crop::default(),
                text: vec![],
                metadata: MetadataCorrections {
                    camera: None,
                    lens: None,
                },
            };
            let bytes = platform::render(&path, &job, &settings).unwrap();
            let mut decoder = png::Decoder::new(Cursor::new(bytes));
            decoder
                .set_transformations(png::Transformations::EXPAND | png::Transformations::STRIP_16);
            let mut reader = decoder.read_info().unwrap();
            let mut pixels = vec![0; reader.output_buffer_size().unwrap()];
            let info = reader.next_frame(&mut pixels).unwrap();
            let pixel = match info.color_type {
                png::ColorType::Rgb | png::ColorType::Rgba => &pixels[0..3],
                other => panic!("Unexpected PNG color type: {other:?}"),
            };
            if matches!(style, FrameStyle::AmbientGradient | FrameStyle::EdgeStretch) {
                assert_ne!(
                    pixel, expected,
                    "generated frame edge should contain photo-derived color"
                );
            } else {
                assert_eq!(pixel, expected);
            }
        }
        assert_eq!(fs::read(path).unwrap(), SOURCE_PNG);
    }

    #[test]
    fn soft_black_style_name_deserializes_from_existing_camel_case_ui_value() {
        assert!(matches!(
            serde_json::from_str::<FrameStyle>("\"softBlack\""),
            Ok(FrameStyle::SoftBlack)
        ));
    }

    #[test]
    fn ambient_gradient_style_and_old_frame_settings_deserialize_safely() {
        let value = serde_json::json!({
            "style":"ambientGradient", "top":0, "bottom":0, "left":0, "right":0,
            "blurStrength":0, "backgroundBrightness":100, "showInset":false, "showShadow":false
        });
        let parsed: Frame = serde_json::from_value(value).unwrap();
        assert!(matches!(parsed.style, FrameStyle::AmbientGradient));
        assert_eq!(parsed.ambient_intensity, 85.0);
        assert_eq!(parsed.ambient_softness, 65.0);
        assert_eq!(parsed.ambient_brightness, 0.0);
        assert_eq!(parsed.ambient_color_source, "fullImage");
    }

    #[test]
    fn none_frame_and_old_text_items_deserialize_with_safe_defaults() {
        assert!(matches!(
            serde_json::from_str::<FrameStyle>("\"none\""),
            Ok(FrameStyle::None)
        ));
        let item: TextItem = serde_json::from_value(serde_json::json!({
            "text": "{camera}", "x": 34, "y": -34, "size": 28,
            "fontFamily": "Arial", "weight": 400, "color": "#ffffff"
        }))
        .unwrap();
        assert_eq!(item.opacity, None);
        assert_eq!(item.anchor_mode, None);
    }

    #[test]
    fn crop_defaults_for_legacy_jobs_and_clamps_geometry() {
        let legacy: Crop = serde_json::from_str("{}").unwrap();
        assert_eq!(
            (
                legacy.x,
                legacy.y,
                legacy.width,
                legacy.height,
                legacy.rotation
            ),
            (0.0, 0.0, 1.0, 1.0, 0.0)
        );
        let crop: Crop = serde_json::from_value(
            serde_json::json!({"x":0.8,"y":0.1,"width":1.0,"height":0.5,"rotation":12.75}),
        )
        .unwrap();
        assert_eq!(crop.rotation, 12.75);
        assert!((crop.width.clamp(0.001, 1.0 - crop.x) - 0.2).abs() < 1e-12);
    }

    #[test]
    fn crop_changes_original_output_dimensions_without_mutating_source() {
        let directory = ScratchDirectory::new();
        let path = directory.0.join("crop-source.png");
        fs::write(&path, SOURCE_PNG).unwrap();
        let source_before = fs::read(&path).unwrap();
        let mut export_frame = frame();
        export_frame.style = FrameStyle::None;
        let job = ExportJob {
            id: "crop-test".into(),
            path: path.clone(),
            frame: export_frame,
            crop: Crop {
                x: 0.0,
                y: 0.0,
                width: 0.5,
                height: 1.0,
                rotation: 12.75,
            },
            text: vec![],
            metadata: MetadataCorrections::default(),
        };
        let mut settings = ExportSettings {
            format: ExportFormat::Png,
            size: ExportSize::Original(OriginalSize::Original),
            quality: 90,
            keep_camera: false,
            keep_lens: false,
            keep_exposure: false,
            keep_date: false,
            keep_gps: false,
            keep_serial: false,
            apply_metadata_corrections: false,
            color_space: ColorSpace::Srgb,
        };
        for format in [ExportFormat::Png, ExportFormat::Jpeg, ExportFormat::Webp] {
            settings.format = format;
            let bytes = platform::render(&path, &job, &settings).unwrap();
            match format {
                ExportFormat::Png => {
                    let decoder = png::Decoder::new(Cursor::new(bytes));
                    let info = decoder.read_info().unwrap().info().clone();
                    assert_eq!((info.width, info.height), (3, 2));
                }
                ExportFormat::Jpeg => assert!(bytes.starts_with(&[0xff, 0xd8])),
                ExportFormat::Webp => {
                    assert!(bytes.starts_with(b"RIFF"));
                    assert_eq!(&bytes[8..12], b"WEBP");
                    assert_eq!(&bytes[12..16], b"VP8X");
                    assert_ne!(bytes[20] & 0x20, 0);
                }
            }
        }
        assert_eq!(fs::read(path).unwrap(), source_before);
    }

    #[test]
    fn edge_stretch_and_legacy_defaults_deserialize() {
        let frame: Frame = serde_json::from_str(r#"{"style":"edgeStretch","top":0,"bottom":0,"left":0,"right":0,"blurStrength":18,"backgroundBrightness":100,"showInset":false,"showShadow":false}"#).unwrap();
        assert!(matches!(frame.style, FrameStyle::EdgeStretch));
        assert_eq!(frame.edge_stretch_mode, "extend");
        assert_eq!(frame.edge_stretch_blur, 8.0);
        assert_eq!(frame.edge_stretch_fade, 12.0);
    }

    #[test]
    fn cancellation_cleanup_skips_files_replaced_after_export() {
        let directory = ScratchDirectory::new();
        let existing = directory.0.join("photo_framed.jpg");
        fs::write(&existing, b"existing").unwrap();
        let output = write_output(
            &directory.0,
            "photo",
            ExportFormat::Jpeg,
            b"export",
            "test",
            0,
        )
        .unwrap();
        assert_eq!(output.path.file_name().unwrap(), "photo_framed_2.jpg");
        assert_eq!(fs::read(&existing).unwrap(), b"existing");
        let replacement = directory.0.join("other.jpg");
        fs::write(&replacement, b"export").unwrap();
        fs::rename(replacement, &output.path).unwrap();
        assert!(remove_output(&output).is_err());
        assert_eq!(fs::read(&output.path).unwrap(), b"export");
    }

    #[test]
    fn native_formats_embed_allowed_exif_without_sensitive_fields() {
        let directory = ScratchDirectory::new();
        let path = directory.0.join("source.png");
        let fields = [
            (Tag::Make, Value::Ascii(vec![b"NIKON".to_vec()])),
            (Tag::Model, Value::Ascii(vec![b"Old Camera".to_vec()])),
            (Tag::LensModel, Value::Ascii(vec![b"Old Lens".to_vec()])),
            (
                Tag::BodySerialNumber,
                Value::Ascii(vec![b"private".to_vec()]),
            ),
            (Tag::GPSLatitudeRef, Value::Ascii(vec![b"N".to_vec()])),
        ]
        .map(|(tag, value)| Field {
            tag,
            value,
            ifd_num: In::PRIMARY,
        });
        let mut writer = Writer::new();
        for field in &fields {
            writer.push_field(field);
        }
        let mut payload = Cursor::new(Vec::new());
        writer.write(&mut payload, false).unwrap();
        let source =
            metadata::attach_exif(SOURCE_PNG.to_vec(), payload.into_inner(), ExportFormat::Png)
                .unwrap();
        fs::write(&path, &source).unwrap();

        let mut custom_frame = frame();
        custom_frame.style = FrameStyle::EdgeStretch;
        custom_frame.edge_stretch_mode = "mirror".into();
        custom_frame.edge_stretch_blur = 12.0;
        custom_frame.edge_stretch_fade = 18.0;
        let job = ExportJob {
            path: path.clone(),
            id: "test".to_owned(),
            frame: custom_frame,
            crop: Crop::default(),
            text: vec![TextItem {
                text: "Lustra".to_owned(),
                anchor: "bottom-center".to_owned(),
                x: 0.0,
                y: -34.0,
                size: 36.0,
                font_family: "Arial".to_owned(),
                weight: 700,
                color: "#ffffff".to_owned(),
                opacity: None,
                anchor_mode: None,
            }],
            metadata: MetadataCorrections {
                camera: Some("NIKON New Camera".to_owned()),
                lens: None,
            },
        };
        for format in get_export_capabilities().formats {
            let settings = ExportSettings {
                format,
                size: ExportSize::ShortEdge(720),
                quality: 90,
                keep_camera: true,
                keep_lens: false,
                keep_exposure: false,
                keep_date: false,
                keep_gps: false,
                keep_serial: false,
                apply_metadata_corrections: true,
                color_space: ColorSpace::Srgb,
            };
            let pixels = platform::render(&path, &job, &settings).unwrap();
            if format == ExportFormat::Png {
                let mut without_text = job.clone();
                without_text.text.clear();
                let clean_pixels = platform::render(&path, &without_text, &settings).unwrap();
                assert_ne!(
                    pixels, clean_pixels,
                    "watermark text should be composited into PNG pixels"
                );

                let mut transparent = job.clone();
                transparent.text[0].opacity = Some(0.0);
                let transparent_pixels = platform::render(&path, &transparent, &settings).unwrap();
                assert_ne!(
                    pixels, transparent_pixels,
                    "watermark opacity should affect the rendered pixels"
                );
            }
            let exif = metadata::filtered_exif(&path, &settings, &job.metadata)
                .unwrap()
                .unwrap();
            let framed = metadata::attach_exif(pixels, exif, format).unwrap();
            let name = directory.0.join(format!("framed.{}", format.extension()));
            fs::write(&name, &framed).unwrap();
            let parsed = Reader::new()
                .read_from_container(&mut Cursor::new(framed))
                .unwrap();
            let camera = parsed.get_field(Tag::Model, In::PRIMARY).unwrap();
            assert!(matches!(&camera.value, Value::Ascii(values) if values[0] == b"New Camera"));
            for tag in [Tag::LensModel, Tag::BodySerialNumber, Tag::GPSLatitudeRef] {
                assert!(parsed.get_field(tag, In::PRIMARY).is_none());
            }

            // A native decoder must still accept the file after metadata insertion.
            assert!(platform::render(&name, &job, &settings).is_ok());
        }
        assert_eq!(fs::read(path).unwrap(), source);
    }
}
