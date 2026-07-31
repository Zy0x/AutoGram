//! SQLite Repository for Topic Media items, thumbnails, sync state, and downloads.

use rusqlite::{params, Connection, OptionalExtension};
use std::time::{SystemTime, UNIX_EPOCH};

use super::error::TopicMediaError;
use super::models::{TopicMediaContext, TopicMediaCursor, TopicMediaItem};
use crate::core::app_db::open_db;

fn now_unix() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

pub fn get_cached_page(
    ctx: &TopicMediaContext,
    filter_types: &[String],
    cursor: Option<TopicMediaCursor>,
    limit: usize,
) -> Result<Vec<TopicMediaItem>, TopicMediaError> {
    let conn = open_db().map_err(|e| TopicMediaError::Internal(e))?;

    // Environment wipe or startup purge of legacy non-media synthesized rows
    if std::env::var("AUTOGRAM_CLEAR_MEDIA_CACHE").map(|v| v == "1").unwrap_or(false) {
        let _ = conn.execute("DELETE FROM topic_media_items", []);
        crate::core::tg_log::info(
            "grammers",
            "media_cache_schema",
            "op=media_cache_schema database_name=autogram.db store_name=topic_media_items migration_action=clear row_count_after=0",
        );
    } else {
        let count_before: i64 = conn.query_row("SELECT COUNT(*) FROM topic_media_items", [], |r| r.get(0)).unwrap_or(0);
        let _ = conn.execute("DELETE FROM topic_media_items WHERE media_type = 'url' OR media_type NOT IN ('photo', 'video', 'document', 'audio')", []);
        let count_after: i64 = conn.query_row("SELECT COUNT(*) FROM topic_media_items", [], |r| r.get(0)).unwrap_or(0);
        crate::core::tg_log::info(
            "grammers",
            "media_cache_schema",
            format!("op=media_cache_schema database_name=autogram.db store_name=topic_media_items row_count_before={count_before} migration_action=purge_invalid row_count_after={count_after}"),
        );
    }

    let limit = limit.clamp(1, 100);

    let mut sql = String::from(
        "SELECT account_id, peer_id, topic_id, message_id, message_date, edit_date, grouped_id, \
         sender_id, caption, media_type, mime_type, file_name, file_size, document_id, access_hash, \
         dc_id, file_reference, width, height, duration_ms, has_server_thumb, has_video_thumb, \
         is_deleted, created_at, updated_at \
         FROM topic_media_items \
         WHERE account_id = ?1 AND peer_id = ?2 AND is_deleted = 0 AND media_type IN ('photo', 'video', 'document', 'audio')",
    );

    let mut params_vec: Vec<rusqlite::types::Value> = vec![
        ctx.account_id.clone().into(),
        ctx.peer_id.clone().into(),
    ];

    match ctx.scope_kind {
        super::models::MediaScopeKind::All => {
            // All Media: no topic_id restriction
        }
        super::models::MediaScopeKind::General => {
            let gen_id = ctx.topic_id.unwrap_or(0);
            let idx = params_vec.len() + 1;
            sql.push_str(&format!(" AND (topic_id IS NULL OR topic_id = 0 OR topic_id = 1 OR topic_id = ?{idx})"));
            params_vec.push(gen_id.into());
        }
        super::models::MediaScopeKind::Topic => {
            let tid = ctx.topic_id.unwrap_or(0);
            let idx = params_vec.len() + 1;
            sql.push_str(&format!(" AND topic_id = ?{idx}"));
            params_vec.push(tid.into());
        }
    }

    if !filter_types.is_empty() {
        let type_placeholders: Vec<String> = (0..filter_types.len())
            .map(|i| format!("?{}", params_vec.len() + i + 1))
            .collect();
        sql.push_str(&format!(" AND media_type IN ({})", type_placeholders.join(", ")));
        for ft in filter_types {
            params_vec.push(ft.clone().into());
        }
    }

    if let Some(c) = cursor {
        let idx1 = params_vec.len() + 1;
        let idx2 = params_vec.len() + 2;
        let idx3 = params_vec.len() + 3;
        sql.push_str(&format!(
            " AND (message_date < ?{idx1} OR (message_date = ?{idx2} AND message_id < ?{idx3}))"
        ));
        params_vec.push(c.message_date.into());
        params_vec.push(c.message_date.into());
        params_vec.push(c.message_id.into());
    }

    let limit_idx = params_vec.len() + 1;
    sql.push_str(&format!(" ORDER BY message_date DESC, message_id DESC LIMIT ?{limit_idx}"));
    params_vec.push((limit as i64).into());

    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(rusqlite::params_from_iter(params_vec), |row| {
        Ok(TopicMediaItem {
            account_id: row.get(0)?,
            peer_id: row.get(1)?,
            topic_id: row.get(2)?,
            message_id: row.get(3)?,
            message_date: row.get(4)?,
            edit_date: row.get(5)?,
            grouped_id: row.get(6)?,
            sender_id: row.get(7)?,
            caption: row.get(8)?,
            media_type: row.get(9)?,
            mime_type: row.get(10)?,
            file_name: row.get(11)?,
            file_size: row.get::<_, i64>(12)? as u64,
            document_id: row.get(13)?,
            access_hash: row.get(14)?,
            dc_id: row.get(15)?,
            file_reference: row.get(16)?,
            width: row.get(17)?,
            height: row.get(18)?,
            duration_ms: row.get(19)?,
            has_server_thumb: row.get::<_, i32>(20)? != 0,
            has_video_thumb: row.get::<_, i32>(21)? != 0,
            thumb_url: None,
            is_deleted: row.get::<_, i32>(22)? != 0,
            created_at: row.get(23)?,
            updated_at: row.get(24)?,
        })
    })?;

    let mut items = Vec::new();
    for item in rows {
        items.push(item?);
    }

    Ok(items)
}

pub fn upsert_topic_media_batch(
    items: &[TopicMediaItem],
) -> Result<(), TopicMediaError> {
    if items.is_empty() {
        return Ok(());
    }
    let mut conn = open_db().map_err(|e| TopicMediaError::Internal(e))?;
    let tx = conn.transaction()?;
    {
        let mut stmt = tx.prepare(
            "INSERT INTO topic_media_items ( \
                account_id, peer_id, topic_id, message_id, message_date, edit_date, grouped_id, \
                sender_id, caption, media_type, mime_type, file_name, file_size, document_id, access_hash, \
                dc_id, file_reference, width, height, duration_ms, has_server_thumb, has_video_thumb, \
                is_deleted, created_at, updated_at \
             ) VALUES ( \
                ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?24, ?25 \
             ) ON CONFLICT(account_id, peer_id, topic_id, message_id) DO UPDATE SET \
                message_date=excluded.message_date, edit_date=excluded.edit_date, caption=excluded.caption, \
                media_type=excluded.media_type, mime_type=excluded.mime_type, file_name=excluded.file_name, \
                file_size=excluded.file_size, document_id=excluded.document_id, access_hash=excluded.access_hash, \
                dc_id=excluded.dc_id, file_reference=excluded.file_reference, width=excluded.width, height=excluded.height, \
                duration_ms=excluded.duration_ms, has_server_thumb=excluded.has_server_thumb, has_video_thumb=excluded.has_video_thumb, \
                is_deleted=excluded.is_deleted, updated_at=excluded.updated_at"
        )?;

        let now = now_unix();
        for item in items {
            stmt.execute(params![
                item.account_id,
                item.peer_id,
                item.topic_id,
                item.message_id,
                item.message_date,
                item.edit_date,
                item.grouped_id,
                item.sender_id,
                item.caption,
                item.media_type,
                item.mime_type,
                item.file_name,
                item.file_size as i64,
                item.document_id,
                item.access_hash,
                item.dc_id,
                item.file_reference,
                item.width,
                item.height,
                item.duration_ms,
                if item.has_server_thumb { 1 } else { 0 },
                if item.has_video_thumb { 1 } else { 0 },
                if item.is_deleted { 1 } else { 0 },
                if item.created_at > 0 { item.created_at } else { now },
                now,
            ])?;
        }
    }
    tx.commit()?;
    Ok(())
}

pub fn mark_topic_media_deleted(
    ctx: &TopicMediaContext,
    message_ids: &[i64],
) -> Result<(), TopicMediaError> {
    if message_ids.is_empty() {
        return Ok(());
    }
    let mut conn = open_db().map_err(|e| TopicMediaError::Internal(e))?;
    let tx = conn.transaction()?;
    {
        let mut stmt = tx.prepare(
            "UPDATE topic_media_items SET is_deleted = 1, updated_at = ?1 \
             WHERE account_id = ?2 AND peer_id = ?3 AND topic_id = ?4 AND message_id = ?5",
        )?;
        let now = now_unix();
        for &mid in message_ids {
            stmt.execute(params![now, ctx.account_id, ctx.peer_id, ctx.topic_id, mid])?;
        }
    }
    tx.commit()?;
    Ok(())
}
