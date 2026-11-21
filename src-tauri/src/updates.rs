use std::sync::Mutex;

use serde::Serialize;
use tauri::{ipc::Channel, AppHandle, State};
use tauri_plugin_updater::{Update, UpdaterExt};

const RELEASE_FEED_BASE: &str = "https://raw.githubusercontent.com/arutaka1220/lustra/release-feed";
// The Rust persistence version must stay aligned with session-snapshot.ts.

#[derive(Default)]
pub(crate) struct PendingUpdate(Mutex<Option<DownloadedUpdate>>);

struct DownloadedUpdate {
    channel: String,
    update: Update,
    bytes: Vec<u8>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UpdateMetadata {
    version: String,
    current_version: String,
    notes: Option<String>,
    published_at: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(tag = "event", content = "data", rename_all = "camelCase")]
pub(crate) enum DownloadEvent {
    #[serde(rename_all = "camelCase")]
    Started {
        content_length: Option<u64>,
    },
    #[serde(rename_all = "camelCase")]
    Progress {
        chunk_length: usize,
    },
    Finished,
}

fn feed_url(channel: &str) -> Result<url::Url, String> {
    let filename = match channel {
        "stable" => "stable/stable.json",
        "beta" => "beta/beta.json",
        _ => return Err("Unsupported update channel.".into()),
    };
    url::Url::parse(&format!("{RELEASE_FEED_BASE}/{filename}")).map_err(|error| error.to_string())
}

fn supports_current_session_format(manifest: &serde_json::Value) -> bool {
    manifest
        .get("session_snapshot_versions")
        .and_then(serde_json::Value::as_array)
        .is_some_and(|versions| {
            versions
                .iter()
                .any(|version| {
                    version.as_u64() == Some(crate::persistence::SESSION_SNAPSHOT_VERSION)
                })
        })
}

#[tauri::command]
pub(crate) async fn fetch_update(
    app: AppHandle,
    pending_update: State<'_, PendingUpdate>,
    channel: String,
) -> Result<Option<UpdateMetadata>, String> {
    let pubkey = option_env!("LUSTRA_UPDATER_PUBKEY")
        .filter(|key| !key.trim().is_empty())
        .ok_or("Updater is not configured: embed LUSTRA_UPDATER_PUBKEY before building.")?;
    let update = app
        .updater_builder()
        .pubkey(pubkey)
        .endpoints(vec![feed_url(&channel)?])
        .map_err(|error| error.to_string())?
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|error| error.to_string())?
        .check()
        .await
        .map_err(|error| error.to_string())?;

    if update
        .as_ref()
        .is_some_and(|update| !supports_current_session_format(&update.raw_json))
    {
        return Err(
            "This update does not support the current session format. The update was stopped."
                .into(),
        );
    }

    let metadata = update.as_ref().map(|update| UpdateMetadata {
        version: update.version.clone(),
        current_version: update.current_version.clone(),
        notes: update.body.clone(),
        published_at: update.date.as_ref().map(|date| date.to_string()),
    });
    *pending_update.0.lock().map_err(|error| error.to_string())? =
        update.map(|update| DownloadedUpdate {
            channel,
            update,
            bytes: Vec::new(),
        });
    Ok(metadata)
}

#[tauri::command]
pub(crate) async fn download_update(
    pending_update: State<'_, PendingUpdate>,
    channel: String,
    on_event: Channel<DownloadEvent>,
) -> Result<(), String> {
    let pending = pending_update
        .0
        .lock()
        .map_err(|error| error.to_string())?
        .take()
        .ok_or("There is no pending update to download.")?;
    if pending.channel != channel {
        *pending_update.0.lock().map_err(|error| error.to_string())? = Some(pending);
        return Err("The update channel changed. Check for updates again.".into());
    }
    let update = pending.update;

    let mut started = false;
    let bytes = match update
        .download(
            |chunk_length, content_length| {
                if !started {
                    let _ = on_event.send(DownloadEvent::Started { content_length });
                    started = true;
                }
                let _ = on_event.send(DownloadEvent::Progress { chunk_length });
            },
            || {
                let _ = on_event.send(DownloadEvent::Finished);
            },
        )
        .await
    {
        Ok(bytes) => bytes,
        Err(error) => {
            *pending_update
                .0
                .lock()
                .map_err(|lock_error| lock_error.to_string())? = Some(DownloadedUpdate {
                channel,
                update,
                bytes: Vec::new(),
            });
            return Err(error.to_string());
        }
    };

    // Verify before keeping the package in memory. `install` verifies it again.
    update.verify(&bytes).map_err(|error| error.to_string())?;
    let slot = DownloadedUpdate {
        channel,
        update,
        bytes,
    };
    *pending_update.0.lock().map_err(|error| error.to_string())? = Some(slot);
    Ok(())
}

#[tauri::command]
pub(crate) async fn install_update(
    app: AppHandle,
    pending_update: State<'_, PendingUpdate>,
    channel: String,
) -> Result<(), String> {
    let downloaded = pending_update
        .0
        .lock()
        .map_err(|error| error.to_string())?
        .take()
        .ok_or("There is no verified update ready to install.")?;
    if downloaded.channel != channel {
        *pending_update.0.lock().map_err(|error| error.to_string())? = Some(downloaded);
        return Err("The update channel changed. Check for updates again.".into());
    }
    if downloaded.bytes.is_empty() {
        *pending_update.0.lock().map_err(|error| error.to_string())? = Some(downloaded);
        return Err("The update has not finished downloading.".into());
    }
    if let Err(error) = crate::persistence::backup_sessions_before_update(app.clone()).await {
        *pending_update
            .0
            .lock()
            .map_err(|lock_error| lock_error.to_string())? = Some(downloaded);
        return Err(error);
    }
    if let Err(error) = downloaded.update.install(&downloaded.bytes) {
        *pending_update
            .0
            .lock()
            .map_err(|lock_error| lock_error.to_string())? = Some(downloaded);
        return Err(error.to_string());
    }
    app.restart();
}

#[cfg(test)]
mod tests {
    use super::{feed_url, supports_current_session_format};

    #[test]
    fn selects_independent_stable_and_beta_feed_files() {
        assert_eq!(
            feed_url("stable").unwrap().as_str(),
            "https://raw.githubusercontent.com/arutaka1220/lustra/release-feed/stable/stable.json"
        );
        assert_eq!(
            feed_url("beta").unwrap().as_str(),
            "https://raw.githubusercontent.com/arutaka1220/lustra/release-feed/beta/beta.json"
        );
    }

    #[test]
    fn rejects_unknown_update_channels() {
        assert!(feed_url("nightly").is_err());
    }

    #[test]
    fn requires_update_feed_to_declare_current_session_compatibility() {
        assert!(supports_current_session_format(&serde_json::json!({
            "session_snapshot_versions": [1, 2, 3]
        })));
        assert!(!supports_current_session_format(&serde_json::json!({
            "session_snapshot_versions": [1, 2]
        })));
        assert!(!supports_current_session_format(&serde_json::json!({})));
    }
}
