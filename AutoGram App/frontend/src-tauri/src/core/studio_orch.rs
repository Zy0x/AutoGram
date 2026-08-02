//! Studio orchestrator — Rust owns queue order.
//!
//! Upload steps use Grammers only. There is no Python/Telethon runtime fallback.

use serde::Serialize;
use serde_json::json;
use std::io::{BufRead, BufReader, Write};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicI64, Ordering};
use std::thread;
use std::time::Duration;

use super::grammers_ops::{self, resolve_sessions_dir};
use super::job_queue::{self, CreateTransferRequest, ItemState, TransferRecord, TransferState};
use super::media_prep;
use super::session_guard::{self, SessionPurpose};
use super::telegram_ops::TelegramIdentity;
use super::tg_log;

static ORCH_JOB_SEQ: AtomicI64 = AtomicI64::new(993_100);

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OrchStartResult {
    pub transfer_id: String,
    pub mode: String,
    pub items: usize,
    pub message: String,
}

/// Create queue entry only (UI may list it before run).
pub fn enqueue(req: CreateTransferRequest) -> Result<TransferRecord, String> {
    job_queue::create_transfer(req)
}

fn finalize_transfer(tid: &str, items_len: usize, mode: &str) -> OrchStartResult {
    if let Some(r) = job_queue::get_transfer(tid) {
        if r.state == TransferState::Running {
            let st = if r.failed_count == 0 && r.done_count > 0 {
                TransferState::Completed
            } else if r.done_count == 0 && r.failed_count > 0 {
                TransferState::Failed
            } else if r.done_count + r.failed_count >= r.items.len() {
                TransferState::Completed
            } else {
                TransferState::Failed
            };
            let _ = job_queue::set_transfer_state(tid, st);
        }
    }
    let final_rec = job_queue::get_transfer(tid);
    let msg = match final_rec {
        Some(r) if r.failed_count == 0 => {
            format!("Orchestrated upload complete: {} done", r.done_count)
        }
        Some(r) => format!(
            "Orchestrated upload finished: {} done, {} failed",
            r.done_count, r.failed_count
        ),
        None => "Orchestrated upload finished".into(),
    };
    OrchStartResult {
        transfer_id: tid.to_string(),
        mode: mode.into(),
        items: items_len,
        message: msg,
    }
}

fn run_orchestrated_grammers(
    app: Option<&tauri::AppHandle>,
    req: &CreateTransferRequest,
) -> Result<OrchStartResult, String> {
    let rec = job_queue::create_transfer(req.clone())?;
    let tid = rec.transfer_id.clone();
    job_queue::set_transfer_state(&tid, TransferState::Running)?;

    if let Some(app) = app {
        use tauri::Emitter;
        let _ = app.emit("transfer-event", serde_json::json!({
            "type": "StudioStarted",
            "items": rec.items.len(),
            "mode": "upload"
        }));
    }

    // Shared transfer lease — blocks exclusive Telethon dual-open, coexists with Studio.
    let session_name = req.session.trim();
    let _session_guard = if !session_name.is_empty() {
        Some(
            session_guard::SessionGuardToken::acquire(
                session_name,
                &format!("transfer-{tid}"),
                SessionPurpose::Transfer,
            )
            .map_err(|e| e.user_message())?,
        )
    } else {
        None
    };

    let sessions = resolve_sessions_dir(None);
    std::env::set_var("AUTOGRAM_SESSIONS_DIR", sessions.display().to_string());

    // Best-effort import Telethon session → Grammers JSON once
    let _ = grammers_ops::import_session_blocking(&sessions, &rec.session);

    let identity = TelegramIdentity {
        session: rec.session.clone(),
        api_id: rec.api_id,
        api_hash: req.api_hash.clone(),
    };

    // as_document from options
    let as_doc = rec
        .options
        .get("quality_mode")
        .and_then(|v| v.as_str())
        .map(|s| s.eq_ignore_ascii_case("ORIGINAL") || s.eq_ignore_ascii_case("DOCUMENT"))
        .unwrap_or(true)
        || rec
            .options
            .get("force_document")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
    let silent = rec
        .options
        .get("silent")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);

    tg_log::info(
        "studio_orch",
        "grammers_start",
        format!(
            "transfer={} items={} chat={}",
            tid,
            rec.items.len(),
            rec.chat_id
        ),
    );

    let album = rec
        .options
        .get("group_as_album")
        .and_then(|v| v.as_bool())
        .unwrap_or(false)
        || rec
            .options
            .get("groupAsAlbum")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);

    let topic_id = rec.topic_id.filter(|t| *t > 0).or_else(|| {
        rec.options
            .get("topic_id")
            .and_then(|v| v.as_i64())
            .or_else(|| rec.options.get("topicId").and_then(|v| v.as_i64()))
            .filter(|t| *t > 0)
    });

    // Grammers album: Telegram max 10 per send_album — chunk larger sets.
    if album && rec.items.len() >= 2 {
        let files: Vec<(String, String)> = rec
            .items
            .iter()
            .map(|it| (it.path.clone(), it.caption.clone()))
            .collect();
        for item in &rec.items {
            let _ = job_queue::update_item(&tid, item.index, ItemState::Uploading, None, None);
        }
        let mut any_ok = false;
        let mut first_err: Option<String> = None;
        let mut base = 0usize;
        while base < files.len() {
            let end = (base + 10).min(files.len());
            let chunk = &files[base..end];
            // Single leftover item in last chunk: use single upload
            if chunk.len() == 1 {
                match grammers_ops::upload_file_blocking_topic(
                    &sessions,
                    &identity,
                    &rec.chat_id,
                    &chunk[0].0,
                    &chunk[0].1,
                    as_doc,
                    silent,
                    base,
                    topic_id,
                ) {
                    Ok(r) => {
                        let st = match r.status.as_str() {
                            "done" | "success" => {
                                any_ok = true;
                                ItemState::Done
                            }
                            _ => ItemState::Failed,
                        };
                        let _ = job_queue::update_item(
                            &tid,
                            r.index,
                            st,
                            r.message_id,
                            r.error.clone(),
                        );
                        if r.error.is_some() && first_err.is_none() {
                            first_err = r.error;
                        }
                    }
                    Err(e) => {
                        first_err = Some(e.user_message());
                        let _ = job_queue::update_item(
                            &tid,
                            base,
                            ItemState::Failed,
                            None,
                            first_err.clone(),
                        );
                    }
                }
                base = end;
                continue;
            }
            match grammers_ops::upload_album_blocking(
                &sessions,
                &identity,
                &rec.chat_id,
                chunk,
                as_doc,
                silent,
                topic_id,
                base,
            ) {
                Ok(results) => {
                    for r in results {
                        let st = match r.status.as_str() {
                            "done" | "success" => {
                                any_ok = true;
                                ItemState::Done
                            }
                            _ => ItemState::Failed,
                        };
                        let _ = job_queue::update_item(
                            &tid,
                            r.index,
                            st,
                            r.message_id,
                            r.error.clone(),
                        );
                        if r.error.is_some() && first_err.is_none() {
                            first_err = r.error;
                        }
                    }
                }
                Err(e) => {
                    tg_log::warn("studio_orch", "grammers_album_fail", e.user_message());
                    first_err = Some(e.user_message());
                    for i in base..end {
                        let _ = job_queue::update_item(
                            &tid,
                            i,
                            ItemState::Failed,
                            None,
                            first_err.clone(),
                        );
                    }
                }
            }
            base = end;
        }
        if any_ok {
            return Ok(finalize_transfer(
                &tid,
                rec.items.len(),
                if rec.items.len() > 10 {
                    "rust_orch_grammers_album_chunked"
                } else {
                    "rust_orch_grammers_album"
                },
            ));
        }
        let _ = job_queue::set_transfer_state(&tid, TransferState::Failed);
        return Err(format!(
            "grammers album upload failed: {}",
            first_err.unwrap_or_else(|| "unknown".into())
        ));
    }

    let quality_mode = rec
        .options
        .get("quality_mode")
        .and_then(|v| v.as_str())
        .or_else(|| rec.options.get("qualityMode").and_then(|v| v.as_str()))
        .map(|s| s.to_string());

    let mut any_ok = false;
    let mut first_fatal: Option<String> = None;

    for item in &rec.items {
        let file_name = std::path::Path::new(&item.path)
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or(&item.path)
            .to_string();

        if let Some(app) = app {
            use tauri::Emitter;
            let _ = app.emit("transfer-event", serde_json::json!({
                "type": "StudioItemStarted",
                "index": item.index,
                "path": file_name,
                "size": item.size
            }));
        }

        let _ = job_queue::update_item(&tid, item.index, ItemState::Preparing, None, None);
        // Remote URL download + optional ffmpeg reencode (no Telethon)
        let (local_path, temp_cleanup) =
            match media_prep::prepare_upload_path(&item.path, quality_mode.as_deref(), app, item.index) {
                Ok(v) => v,
                Err(e) => {
                    let msg = format!("prepare: {e}");
                    let _ = job_queue::update_item(
                        &tid,
                        item.index,
                        ItemState::Failed,
                        None,
                        Some(msg.clone()),
                    );
                    if let Some(app) = app {
                        use tauri::Emitter;
                        let _ = app.emit("transfer-event", serde_json::json!({
                            "type": "StudioItemDone",
                            "index": item.index,
                            "status": "failed",
                            "error": msg,
                            "path": file_name
                        }));
                    }
                    if first_fatal.is_none() {
                        first_fatal = Some(msg);
                    }
                    continue;
                }
            };

        let _ = job_queue::update_item(&tid, item.index, ItemState::Uploading, None, None);
        if let Some(app) = app {
            use tauri::Emitter;
            let _ = app.emit("transfer-event", serde_json::json!({
                "type": "StudioProgress",
                "index": item.index,
                "percent": 40.0,
                "transferred": item.size / 2,
                "total": item.size,
                "phase": "upload"
            }));
        }

        match grammers_ops::upload_file_blocking_topic(
            &sessions,
            &identity,
            &rec.chat_id,
            &local_path,
            &item.caption,
            as_doc,
            silent,
            item.index,
            topic_id,
        ) {
            Ok(r) => {
                let st = match r.status.as_str() {
                    "done" | "success" => {
                        any_ok = true;
                        ItemState::Done
                    }
                    "skipped" => {
                        any_ok = true;
                        ItemState::Skipped
                    }
                    _ => ItemState::Failed,
                };
                let _ = job_queue::update_item(&tid, item.index, st.clone(), r.message_id, r.error.clone());
                if let Some(app) = app {
                    use tauri::Emitter;
                    let status_str = if st == ItemState::Done {
                        "done"
                    } else if st == ItemState::Skipped {
                        "skipped"
                    } else {
                        "failed"
                    };
                    let _ = app.emit("transfer-event", serde_json::json!({
                        "type": "StudioItemDone",
                        "index": item.index,
                        "status": status_str,
                        "message_id": r.message_id,
                        "error": r.error,
                        "path": file_name
                    }));
                }
                if r.error.is_some() && first_fatal.is_none() {
                    first_fatal = r.error;
                }
            }
            Err(e) => {
                let msg = e.user_message();
                tg_log::warn("studio_orch", "grammers_item_fail", &msg);
                let _ = job_queue::update_item(
                    &tid,
                    item.index,
                    ItemState::Failed,
                    None,
                    Some(msg.clone()),
                );
                if let Some(app) = app {
                    use tauri::Emitter;
                    let _ = app.emit("transfer-event", serde_json::json!({
                        "type": "StudioItemDone",
                        "index": item.index,
                        "status": "failed",
                        "error": msg,
                        "path": file_name
                    }));
                }
                if first_fatal.is_none() {
                    first_fatal = Some(msg);
                }
                if matches!(
                    e.code(),
                    super::tg_error::TgErrorCode::NotAuthorized
                        | super::tg_error::TgErrorCode::SessionMissing
                        | super::tg_error::TgErrorCode::SessionImportFailed
                        | super::tg_error::TgErrorCode::NotConfigured
                ) {
                    media_prep::cleanup_temp(temp_cleanup);
                    let _ = job_queue::set_transfer_state(&tid, TransferState::Failed);
                    if let Some(app) = app {
                        use tauri::Emitter;
                        let _ = app.emit("transfer-event", serde_json::json!({
                            "type": "StudioFailed",
                            "error": first_fatal.clone().unwrap_or_else(|| e.to_string())
                        }));
                    }
                    return Err(format!(
                        "grammers unavailable: {}",
                        first_fatal.unwrap_or_else(|| e.to_string())
                    ));
                }
            }
        }
        media_prep::cleanup_temp(temp_cleanup);
    }

    if !any_ok {
        let _ = job_queue::set_transfer_state(&tid, TransferState::Failed);
        if let Some(app) = app {
            use tauri::Emitter;
            let _ = app.emit("transfer-event", serde_json::json!({
                "type": "StudioFailed",
                "error": first_fatal.clone().unwrap_or_else(|| "unknown".into())
            }));
        }
        return Err(format!(
            "grammers upload all failed: {}",
            first_fatal.unwrap_or_else(|| "unknown".into())
        ));
    }

    if let Some(app) = app {
        use tauri::Emitter;
        let _ = app.emit("transfer-event", serde_json::json!({
            "type": "StudioFinished"
        }));
    }

    Ok(finalize_transfer(
        &tid,
        rec.items.len(),
        "rust_orch_grammers",
    ))
}

/// Run orchestrated transfer — **Grammers only** (Telethon studio-serve removed).
pub fn run_orchestrated_blocking(app: Option<&tauri::AppHandle>, req: &CreateTransferRequest) -> Result<OrchStartResult, String> {
    match run_orchestrated_grammers(app, req) {
        Ok(r) => {
            tg_log::info("studio_orch", "done", format!("mode={}", r.mode));
            Ok(r)
        }
        Err(e) => {
            tg_log::error("studio_orch", "grammers_failed", e.as_str());
            Err(format!(
                "Upload Grammers gagal (Telethon dinonaktifkan): {e}"
            ))
        }
    }
}

#[cfg(any())]
/// Historical source retained outside the compiled runtime for migration archaeology only.
fn run_orchestrated_telethon_blocking(
    req: &CreateTransferRequest,
    daemon: &std::path::Path,
    python: &std::path::Path,
    env_extra: &[(String, String)],
) -> Result<OrchStartResult, String> {
    let api_hash = req.api_hash.clone();
    let rec = job_queue::create_transfer(req.clone())?;
    let tid = rec.transfer_id.clone();
    job_queue::set_transfer_state(&tid, TransferState::Running)?;

    let mut cmd = Command::new(python);
    cmd.arg("-u");
    cmd.arg(daemon);
    cmd.args([
        "--action",
        "studio-serve",
        "--session",
        &rec.session,
        "--api-id",
        &rec.api_id.to_string(),
        "--api-hash",
        &api_hash,
    ]);
    cmd.stdin(Stdio::piped());
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());
    if let Some(parent) = daemon.parent() {
        cmd.current_dir(parent);
    }
    for (k, v) in env_extra {
        cmd.env(k, v);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
        cmd.creation_flags(CREATE_NO_WINDOW | CREATE_NEW_PROCESS_GROUP);
    }

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("spawn studio-serve: {e}"))?;
    let mut stdin = child
        .stdin
        .take()
        .ok_or_else(|| "no stdin for studio-serve".to_string())?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "no stdout for studio-serve".to_string())?;

    let mut reader = BufReader::new(stdout);
    let mut line = String::new();
    let mut ready = false;
    for _ in 0..200 {
        line.clear();
        match reader.read_line(&mut line) {
            Ok(0) => break,
            Ok(_) => {
                if line.contains("ready") {
                    ready = true;
                    break;
                }
            }
            Err(_) => break,
        }
    }
    if !ready {
        let _ = child.kill();
        return Err("studio-serve did not become ready".into());
    }

    let mut seq = 1i64;
    let mut write_cmd = |id: i64, mut body: serde_json::Value| -> Result<(), String> {
        if let Some(m) = body.as_object_mut() {
            m.insert("id".into(), json!(id.to_string()));
        }
        let line = serde_json::to_string(&body).map_err(|e| e.to_string())? + "\n";
        stdin
            .write_all(line.as_bytes())
            .map_err(|e| format!("stdin write: {e}"))?;
        stdin.flush().map_err(|e| format!("stdin flush: {e}"))
    };

    let mut read_reply = |want_id: &str| -> Result<serde_json::Value, String> {
        let mut line = String::new();
        for _ in 0..2000 {
            line.clear();
            let n = reader
                .read_line(&mut line)
                .map_err(|e| format!("stdout: {e}"))?;
            if n == 0 {
                return Err("studio-serve closed".into());
            }
            let t = line.trim();
            if !t.starts_with('{') {
                continue;
            }
            if t.contains("studio_event") {
                continue;
            }
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(t) {
                let id = v
                    .get("id")
                    .map(|x| match x {
                        serde_json::Value::String(s) => s.clone(),
                        serde_json::Value::Number(n) => n.to_string(),
                        _ => String::new(),
                    })
                    .unwrap_or_default();
                if id == want_id || want_id.is_empty() {
                    if v.get("ok").and_then(|x| x.as_bool()) == Some(false) {
                        let err = v
                            .get("error")
                            .and_then(|x| x.as_str())
                            .unwrap_or("studio step failed");
                        return Err(err.to_string());
                    }
                    return Ok(v);
                }
            }
        }
        Err("timeout waiting studio reply".into())
    };

    let begin_id = seq;
    seq += 1;
    write_cmd(
        begin_id,
        json!({
            "cmd": "begin",
            "session": rec.session,
            "api_id": rec.api_id,
            "api_hash": api_hash,
            "chat_id": rec.chat_id,
            "options": rec.options,
            "transfer_id": tid,
        }),
    )?;
    read_reply(&begin_id.to_string())?;

    for item in &rec.items {
        let _ = job_queue::update_item(&tid, item.index, ItemState::Uploading, None, None);
        let id_num = seq;
        seq += 1;
        write_cmd(
            id_num,
            json!({
                "cmd": "upload_one",
                "transfer_id": tid,
                "item": {
                    "path": item.path,
                    "caption": item.caption,
                    "index": item.index,
                    "item_id": item.item_id,
                }
            }),
        )?;
        match read_reply(&id_num.to_string()) {
            Ok(v) => {
                let result = v.get("result").cloned().unwrap_or(json!({}));
                let status = result
                    .get("status")
                    .and_then(|x| x.as_str())
                    .unwrap_or("failed");
                let mid = result.get("message_id").and_then(|x| x.as_i64());
                let err = result
                    .get("error")
                    .and_then(|x| x.as_str())
                    .map(|s| s.to_string());
                let st = match status {
                    "done" | "success" => ItemState::Done,
                    "skipped" => ItemState::Skipped,
                    _ => ItemState::Failed,
                };
                let _ = job_queue::update_item(&tid, item.index, st, mid, err);
            }
            Err(e) => {
                let _ = job_queue::update_item(&tid, item.index, ItemState::Failed, None, Some(e));
            }
        }
    }

    let fin = seq;
    let _ = write_cmd(fin, json!({"cmd": "finish"}));
    let _ = read_reply(&fin.to_string());
    let _ = write_cmd(fin + 1, json!({"cmd": "quit"}));
    thread::sleep(Duration::from_millis(200));
    let _ = child.kill();
    let _ = child.wait();

    Ok(finalize_transfer(
        &tid,
        rec.items.len(),
        "rust_orch_telethon_step",
    ))
}

pub fn next_orch_job_id() -> i64 {
    ORCH_JOB_SEQ.fetch_add(1, Ordering::SeqCst)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn job_id_increments() {
        let a = next_orch_job_id();
        let b = next_orch_job_id();
        assert!(b > a);
    }
}
