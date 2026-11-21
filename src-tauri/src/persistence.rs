mod sqlite;

use serde::Serialize;
use serde_json::{Map, Value};
use sqlite::Database;
use std::{
    collections::BTreeSet,
    fs::{self, OpenOptions},
    io::{self, Write},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex,
    },
};
use tauri::{AppHandle, Manager};
use tauri_plugin_fs::FsExt;

const SESSIONS: &str = "sessions";
const LEGACY_SESSION_BACKUP: &str = "sessions.migration-backup.v1";
const PRE_UPDATE_SESSION_BACKUP: &str = "sessions.pre-update.json";
pub(crate) const SESSION_SNAPSHOT_VERSION: u64 = 3;
const METADATA_CORRECTIONS: &str = "metadata_corrections";
const MAX_THUMBNAIL_BYTES: usize = 256 * 1024;

// The session archive and its derived cache are changed through the same writer.
static STORAGE: Mutex<()> = Mutex::new(());
static NEXT_TEMP_FILE: AtomicU64 = AtomicU64::new(0);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RestoredSessions {
    snapshot: Option<Value>,
    missing_paths: Vec<String>,
}

async fn with_storage<T: Send + 'static>(
    app: AppHandle,
    task: impl FnOnce(AppHandle, &Path) -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = STORAGE.lock().map_err(|error| error.to_string())?;
        let data_dir = app
            .path()
            .app_data_dir()
            .map_err(|error| error.to_string())?;
        fs::create_dir_all(&data_dir).map_err(|error| error.to_string())?;
        task(app, &data_dir)
    })
    .await
    .map_err(|error| error.to_string())?
}

fn database(data_dir: &Path) -> Result<Database, String> {
    Database::open(&data_dir.join("sessions.sqlite3"))
}

fn read_record(database: &Database, key: &str) -> Result<Option<Value>, String> {
    database
        .read(key)?
        .map(|text| serde_json::from_str(&text).map_err(|error| error.to_string()))
        .transpose()
}

fn snapshot_version_supported(snapshot: &Value) -> bool {
    snapshot
        .get("version")
        .and_then(Value::as_u64)
        .is_some_and(|version| (1..=SESSION_SNAPSHOT_VERSION).contains(&version))
}

fn read_pre_update_backup(data_dir: &Path) -> Result<Option<Value>, String> {
    match fs::read(data_dir.join(PRE_UPDATE_SESSION_BACKUP)) {
        Ok(bytes) => {
            let snapshot: Value = serde_json::from_slice(&bytes)
                .map_err(|error| format!("The pre-update session backup is invalid: {error}"))?;
            if snapshot.is_object() && snapshot_version_supported(&snapshot) {
                Ok(Some(snapshot))
            } else {
                Err("The pre-update session backup uses an unsupported format.".into())
            }
        }
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error.to_string()),
    }
}

fn recover_session_snapshot(
    current: Result<Option<Value>, String>,
    data_dir: &Path,
) -> Result<Option<Value>, String> {
    let current_error = match current {
        Ok(Some(snapshot)) if snapshot.is_object() && snapshot_version_supported(&snapshot) => {
            return Ok(Some(snapshot));
        }
        Ok(None) => None,
        Ok(Some(_)) => Some("The saved session uses an unsupported format.".to_owned()),
        Err(error) => Some(error),
    };
    match read_pre_update_backup(data_dir) {
        Ok(Some(snapshot)) => Ok(Some(snapshot)),
        Ok(None) if current_error.is_none() => Ok(None),
        Ok(None) => Err(format!(
            "{} No compatible pre-update session backup was found.",
            current_error.unwrap()
        )),
        Err(backup_error) => Err(format!(
            "Could not restore the saved session ({}; backup: {backup_error}).",
            current_error.unwrap_or_else(|| "no current session snapshot".into())
        )),
    }
}

fn preserve_v1_session_before_upgrade(
    database: &Database,
    previous: Option<&Value>,
    next: &Value,
) -> Result<(), String> {
    let is_v1_to_v2 = previous
        .and_then(|snapshot| snapshot.get("version"))
        .and_then(Value::as_u64)
        == Some(1)
        && next.get("version").and_then(Value::as_u64) == Some(2);
    if is_v1_to_v2 && read_record(database, LEGACY_SESSION_BACKUP)?.is_none() {
        let previous = previous.expect("checked above");
        let serialized = serde_json::to_string(previous).map_err(|error| error.to_string())?;
        database.write(LEGACY_SESSION_BACKUP, &serialized)?;
    }
    Ok(())
}

fn image_path(path: &Path) -> bool {
    path.is_absolute()
        && path
            .extension()
            .and_then(|extension| extension.to_str())
            .is_some_and(|extension| {
                matches!(
                    extension.to_ascii_lowercase().as_str(),
                    "jpg" | "jpeg" | "png" | "webp"
                )
            })
}

fn source_paths(snapshot: &Value) -> Result<BTreeSet<&str>, String> {
    let mut paths = BTreeSet::new();
    let mut pending = vec![snapshot];
    while let Some(next) = pending.pop() {
        match next {
            Value::Object(object)
                if object.get("kind").and_then(Value::as_str) == Some("path")
                    && object.contains_key("path") =>
            {
                let path = object
                    .get("path")
                    .and_then(Value::as_str)
                    .filter(|path| image_path(Path::new(path)))
                    .ok_or("A saved photo has an invalid source path.")?;
                paths.insert(path);
            }
            Value::Object(object) => pending.extend(object.values()),
            Value::Array(items) => pending.extend(items),
            _ => {}
        }
    }
    Ok(paths)
}

#[tauri::command]
pub(crate) async fn load_sessions(app: AppHandle) -> Result<RestoredSessions, String> {
    with_storage(app, |app, data_dir| {
        let current = database(data_dir).and_then(|database| read_record(&database, SESSIONS));
        let snapshot = recover_session_snapshot(current, data_dir)?;
        let mut missing_paths = Vec::new();
        if let Some(snapshot) = &snapshot {
            let asset_scope = app.asset_protocol_scope();
            let fs_scope = app.fs_scope();
            for raw in source_paths(snapshot)? {
                let path = Path::new(raw);
                if !path.is_file() {
                    missing_paths.push(raw.to_owned());
                    continue;
                }
                // Each path was authorized when first written to the database.
                fs_scope
                    .allow_file(path)
                    .map_err(|error| error.to_string())?;
                asset_scope
                    .allow_file(path)
                    .map_err(|error| error.to_string())?;
            }
        }
        Ok(RestoredSessions {
            snapshot,
            missing_paths,
        })
    })
    .await
}

#[tauri::command]
pub(crate) async fn save_sessions(app: AppHandle, snapshot: Value) -> Result<(), String> {
    with_storage(app, move |app, data_dir| {
        if !snapshot.is_object() {
            return Err("Invalid Lustra session data.".into());
        }
        let database = database(data_dir)?;
        let previous = read_record(&database, SESSIONS)?;
        let saved_paths = previous
            .as_ref()
            .map(source_paths)
            .transpose()?
            .unwrap_or_default();
        let fs_scope = app.fs_scope();
        let asset_scope = app.asset_protocol_scope();
        for raw in source_paths(&snapshot)? {
            let path = Path::new(raw);
            // Tauri's native drop extends the asset scope even when the filesystem plugin was
            // not the caller. Previous paths can remain in the archive if the file is missing.
            if !saved_paths.contains(raw)
                && !fs_scope.is_allowed(path)
                && !asset_scope.is_allowed(path)
            {
                return Err("A photo was not selected through Lustra.".into());
            }
        }
        let serialized = serde_json::to_string(&snapshot).map_err(|error| error.to_string())?;
        preserve_v1_session_before_upgrade(&database, previous.as_ref(), &snapshot)?;
        database.write(SESSIONS, &serialized)?;
        // Cache eviction is advisory once the edit transaction has committed.
        let _ = prune_thumbnails(data_dir, &snapshot);
        Ok(())
    })
    .await
}

pub(crate) async fn backup_sessions_before_update(app: AppHandle) -> Result<(), String> {
    with_storage(app, |_app, data_dir| backup_session_record(data_dir)).await
}

fn backup_session_record(data_dir: &Path) -> Result<(), String> {
    let database = database(data_dir)?;
    let Some(snapshot) = database.read(SESSIONS)? else {
        return Ok(());
    };
    let parsed: Value = serde_json::from_str(&snapshot)
        .map_err(|error| format!("Could not validate the saved session before update: {error}"))?;
    if !parsed.is_object() {
        return Err("Could not validate the saved session before update.".into());
    }
    write_atomically(
        &data_dir.join(PRE_UPDATE_SESSION_BACKUP),
        snapshot.as_bytes(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        fs, process,
        time::{SystemTime, UNIX_EPOCH},
    };

    #[test]
    fn backs_up_v1_archive_before_first_v2_overwrite() {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let folder =
            std::env::temp_dir().join(format!("lustra-session-migration-{}-{now}", process::id()));
        fs::create_dir(&folder).unwrap();
        let database = Database::open(&folder.join("sessions.sqlite3")).unwrap();
        let v1: Value = serde_json::from_str(r#"{"version":1,"active":{"id":"kept"}}"#).unwrap();
        let v2: Value = serde_json::from_str(r#"{"version":2,"active":{"id":"new"}}"#).unwrap();
        database
            .write(SESSIONS, &serde_json::to_string(&v1).unwrap())
            .unwrap();

        preserve_v1_session_before_upgrade(&database, Some(&v1), &v2).unwrap();
        database
            .write(SESSIONS, &serde_json::to_string(&v2).unwrap())
            .unwrap();

        assert_eq!(read_record(&database, SESSIONS).unwrap(), Some(v2));
        assert_eq!(
            read_record(&database, LEGACY_SESSION_BACKUP).unwrap(),
            Some(v1)
        );
        let _ = fs::remove_dir_all(folder);
    }

    #[test]
    fn writes_a_pre_update_copy_of_the_saved_session_atomically() {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let folder = std::env::temp_dir().join(format!("lustra-update-backup-{}-{now}", process::id()));
        fs::create_dir(&folder).unwrap();
        let database = Database::open(&folder.join("sessions.sqlite3")).unwrap();
        let snapshot = r#"{"version":3,"active":{"id":"current"}}"#;
        database.write(SESSIONS, snapshot).unwrap();

        backup_session_record(&folder).unwrap();

        assert_eq!(
            fs::read_to_string(folder.join("sessions.pre-update.json")).unwrap(),
            snapshot
        );
        let recovered = recover_session_snapshot(
            Ok(Some(serde_json::json!({ "version": 4, "active": {} }))),
            &folder,
        )
        .unwrap();
        assert_eq!(recovered, Some(serde_json::from_str(snapshot).unwrap()));
        let _ = fs::remove_dir_all(folder);
    }
}

#[tauri::command]
pub(crate) async fn read_metadata_corrections(app: AppHandle) -> Result<Option<Value>, String> {
    with_storage(app, |_app, data_dir| {
        read_record(&database(data_dir)?, METADATA_CORRECTIONS)
    })
    .await
}

#[tauri::command]
pub(crate) async fn write_metadata_corrections(app: AppHandle, value: Value) -> Result<(), String> {
    with_storage(app, move |_app, data_dir| {
        let serialized = serde_json::to_string(&value).map_err(|error| error.to_string())?;
        database(data_dir)?.write(METADATA_CORRECTIONS, &serialized)
    })
    .await
}

fn preference_file(data_dir: &Path) -> PathBuf {
    data_dir.join("preferences.json")
}

fn preferences(data_dir: &Path) -> Result<Map<String, Value>, String> {
    match fs::read(preference_file(data_dir)) {
        Ok(bytes) => serde_json::from_slice(&bytes).map_err(|error| error.to_string()),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(Map::new()),
        Err(error) => Err(error.to_string()),
    }
}

fn write_atomically(path: &Path, contents: &[u8]) -> Result<(), String> {
    let parent = path.parent().ok_or("Missing storage directory.")?;
    let sequence = NEXT_TEMP_FILE.fetch_add(1, Ordering::Relaxed);
    let temporary = parent.join(format!(".write-{}-{sequence}", std::process::id()));
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temporary)
        .map_err(|error| error.to_string())?;
    let result = file.write_all(contents).and_then(|()| file.sync_all());
    drop(file);
    let result = result.and_then(|()| fs::rename(&temporary, path));
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result.map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) async fn load_preferences(app: AppHandle, key: String) -> Result<Option<Value>, String> {
    with_storage(app, move |_app, data_dir| {
        Ok(preferences(data_dir)?.remove(&key))
    })
    .await
}

#[tauri::command]
pub(crate) async fn save_preferences(
    app: AppHandle,
    key: String,
    value: Value,
) -> Result<(), String> {
    with_storage(app, move |_app, data_dir| {
        let mut preferences = preferences(data_dir)?;
        preferences.insert(key, value);
        let serialized =
            serde_json::to_vec_pretty(&preferences).map_err(|error| error.to_string())?;
        write_atomically(&preference_file(data_dir), &serialized)
    })
    .await
}

fn cache_dir(data_dir: &Path) -> PathBuf {
    data_dir.join("recent-session-thumbnails")
}

fn valid_session_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 64
        && id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
}

fn thumbnail_path(data_dir: &Path, session_id: &str) -> Result<PathBuf, String> {
    if !valid_session_id(session_id) {
        return Err("Invalid session identifier.".into());
    }
    Ok(cache_dir(data_dir).join(format!("{session_id}.jpg")))
}

fn cache_entries(data_dir: &Path) -> io::Result<Vec<fs::DirEntry>> {
    match fs::read_dir(cache_dir(data_dir)) {
        Ok(entries) => entries.collect(),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(Vec::new()),
        Err(error) => Err(error),
    }
}

fn recent_ids(snapshot: &Value) -> impl Iterator<Item = &str> {
    snapshot
        .get("recent")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|session| session.get("id"))
        .filter_map(Value::as_str)
}

fn prune_thumbnails(data_dir: &Path, snapshot: &Value) -> io::Result<()> {
    let ids: BTreeSet<_> = recent_ids(snapshot).collect();
    for entry in cache_entries(data_dir)? {
        let path = entry.path();
        let id = path.file_stem().and_then(|stem| stem.to_str());
        if path.extension().is_some_and(|extension| extension == "jpg")
            && id.is_some_and(|id| valid_session_id(id) && !ids.contains(id))
        {
            fs::remove_file(path)?;
        }
    }
    Ok(())
}

#[tauri::command]
pub(crate) async fn load_session_thumbnail(
    app: AppHandle,
    session_id: String,
) -> Result<Option<Vec<u8>>, String> {
    with_storage(app, move |_app, data_dir| {
        match fs::read(thumbnail_path(data_dir, &session_id)?) {
            Ok(bytes) if bytes.len() <= MAX_THUMBNAIL_BYTES => Ok(Some(bytes)),
            Ok(_) => Ok(None),
            Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(None),
            Err(error) => Err(error.to_string()),
        }
    })
    .await
}

#[tauri::command]
pub(crate) async fn save_session_thumbnail(
    app: AppHandle,
    session_id: String,
    bytes: Vec<u8>,
) -> Result<(), String> {
    with_storage(app, move |_app, data_dir| {
        if bytes.len() > MAX_THUMBNAIL_BYTES || !bytes.starts_with(&[0xff, 0xd8, 0xff]) {
            return Err("Invalid session thumbnail.".into());
        }
        let snapshot = read_record(&database(data_dir)?, SESSIONS)?;
        if snapshot
            .as_ref()
            .is_some_and(|snapshot| recent_ids(snapshot).any(|id| id == session_id))
        {
            fs::create_dir_all(cache_dir(data_dir)).map_err(|error| error.to_string())?;
            write_atomically(&thumbnail_path(data_dir, &session_id)?, &bytes)?;
        }
        Ok(())
    })
    .await
}

#[tauri::command]
pub(crate) async fn thumbnail_cache_size(app: AppHandle) -> Result<u64, String> {
    with_storage(app, |_app, data_dir| {
        cache_entries(data_dir)
            .and_then(|entries| {
                entries
                    .iter()
                    .try_fold(0, |total, entry| Ok(total + entry.metadata()?.len()))
            })
            .map_err(|error| error.to_string())
    })
    .await
}

#[tauri::command]
pub(crate) async fn clear_thumbnail_cache(app: AppHandle) -> Result<(), String> {
    with_storage(app, |_app, data_dir| {
        match fs::remove_dir_all(cache_dir(data_dir)) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(error.to_string()),
        }
    })
    .await
}

/// Send the native Quit command through the same flush-on-close path as the window button.
#[cfg(target_os = "macos")]
pub(crate) fn install_quit_menu(app: &tauri::App) -> tauri::Result<()> {
    use tauri::menu::{MenuItem, MenuItemKind};

    let Some(menu) = app.menu() else {
        return Ok(());
    };
    let Some(MenuItemKind::Submenu(app_menu)) = menu.items()?.into_iter().next() else {
        return Ok(());
    };
    let Some(last) = app_menu.items()?.len().checked_sub(1) else {
        return Ok(());
    };
    let quit = MenuItem::with_id(
        app,
        "lustra-save-and-quit",
        "Quit Lustra",
        true,
        Some("Cmd+Q"),
    )?;
    app_menu.remove_at(last)?;
    app_menu.append(&quit)?;
    app.on_menu_event(|app, event| {
        if event.id() == "lustra-save-and-quit" {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.close();
            }
        }
    });
    Ok(())
}
