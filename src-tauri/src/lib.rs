mod export;
mod fonts;
mod metadata;
mod persistence;

use std::path::Path;
use tauri::Manager;
use tauri_plugin_fs::FsExt;

#[tauri::command]
async fn read_photo_metadata(
    app: tauri::AppHandle,
    path: String,
) -> Result<metadata::MetadataReadResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let image_path = Path::new(&path);
        if !app.fs_scope().is_allowed(image_path)
            && !app.asset_protocol_scope().is_allowed(image_path)
        {
            return Err("This photo was not selected through Lustra.".to_owned());
        }
        Ok(metadata::read_photo_metadata_file(image_path))
    })
    .await
    .map_err(|error| error.to_string())?
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
