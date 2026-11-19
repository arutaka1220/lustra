mod export;
mod fonts;
mod persistence;

use exif::{In, Reader, Tag, Value};
use serde::Serialize;
use std::{fs::File, io::BufReader, path::Path};
use tauri::Manager;
use tauri_plugin_fs::FsExt;

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
struct PhotoMetadata {
    camera: Option<String>,
    lens: Option<String>,
    focal_length: Option<String>,
    date: Option<String>,
    aperture: Option<String>,
    shutter_speed: Option<String>,
    iso: Option<String>,
}

fn field_text(exif: &exif::Exif, tag: Tag) -> Option<String> {
    exif.get_field(tag, In::PRIMARY)
        .map(|field| match &field.value {
            Value::Ascii(values) => values
                .first()
                .map(|value| String::from_utf8_lossy(value).trim().to_owned())
                .unwrap_or_default(),
            _ => field.display_value().to_string().trim().to_owned(),
        })
        .filter(|value| !value.is_empty())
}

#[tauri::command]
async fn read_photo_metadata(app: tauri::AppHandle, path: String) -> Result<PhotoMetadata, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let image_path = Path::new(&path);
        if !app.fs_scope().is_allowed(image_path)
            && !app.asset_protocol_scope().is_allowed(image_path)
        {
            return Err("This photo was not selected through Lustra.".to_owned());
        }
        metadata_from_file(image_path)
    })
    .await
    .map_err(|error| error.to_string())?
}

fn metadata_from_file(image_path: &Path) -> Result<PhotoMetadata, String> {
    let file = File::open(image_path).map_err(|error| error.to_string())?;
    let exif = Reader::new()
        .read_from_container(&mut BufReader::new(file))
        .map_err(|error| error.to_string())?;

    let make = field_text(&exif, Tag::Make);
    let model = field_text(&exif, Tag::Model);
    let camera = match (make, model) {
        (Some(make), Some(model)) if model.to_lowercase().starts_with(&make.to_lowercase()) => {
            Some(model)
        }
        (Some(make), Some(model)) => Some(format!("{make} {model}")),
        (Some(make), None) => Some(make),
        (None, model) => model,
    };

    Ok(PhotoMetadata {
        camera,
        lens: field_text(&exif, Tag::LensModel),
        focal_length: field_text(&exif, Tag::FocalLength).map(|value| format!("{value} mm")),
        date: field_text(&exif, Tag::DateTimeOriginal),
        aperture: field_text(&exif, Tag::FNumber).map(|value| format!("f/{value}")),
        shutter_speed: field_text(&exif, Tag::ExposureTime).map(|value| format!("{value} s")),
        iso: field_text(&exif, Tag::PhotographicSensitivity),
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            #[cfg(target_os = "macos")]
            persistence::install_quit_menu(app)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            read_photo_metadata,
            fonts::list_font_families,
            persistence::load_sessions,
            persistence::save_sessions,
            persistence::load_preferences,
            persistence::save_preferences,
            persistence::read_metadata_corrections,
            persistence::write_metadata_corrections,
            persistence::load_session_thumbnail,
            persistence::save_session_thumbnail,
            persistence::thumbnail_cache_size,
            persistence::clear_thumbnail_cache,
            export::get_export_capabilities,
            export::choose_export_destination,
            export::check_export_destination,
            export::begin_export,
            export::cancel_export,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Lustra");
}
