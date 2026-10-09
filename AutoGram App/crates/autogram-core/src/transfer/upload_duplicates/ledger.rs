use super::*;
use crate::transfer::cloud_upload::{UploadError, UploadStore};
use rusqlite::params;
use std::collections::BTreeMap;

impl UploadStore {
    pub(super) fn duplicate_candidates(
        &self,
        query: &DuplicateQuery,
    ) -> Result<CandidateBatch, UploadError> {
        query.validate()?;
        let origin = query.origin.as_ref().map(VerifiedUploadOrigin::identity);
        let same_location = origin.filter(|id| {
            id.peer_kind() == query.destination.peer_kind
                && id.peer_id() == query.destination.peer_id
                && id.topic_id() == query.destination.topic_id
        });
        let message = same_location.map(|id| id.message_id());
        let document = origin.map(|id| id.media_id().to_string());
        let rows = self.inspect_ledger(|conn| {
            let mut stmt = conn.prepare("SELECT telegram_message_id,telegram_unique_id,prepared_sha256,filename,file_size
            FROM upload_ledger WHERE account_id=?1 AND destination_id=?2 AND topic_id=?3 AND file_size=?7
            ORDER BY CASE WHEN telegram_message_id=?4 THEN 0 WHEN telegram_unique_id=?5 THEN 1
            WHEN prepared_sha256=?6 THEN 2 ELSE 3 END, updated_at DESC LIMIT ?8").map_err(|_| UploadError::Database)?;
            let rows = stmt.query_map(
                params![
                    query.destination.scope.account_id(),
                    query.destination.dialog_id(),
                    query.destination.topic_id.unwrap_or(0),
                    message,
                    document,
                    query.source.sha256,
                    query.source.size as i64,
                    (MAX_DUPLICATE_CANDIDATES + 1) as i64
                ],
                |row| Ok((
                    row.get::<_,Option<i64>>(0)?,
                    row.get::<_,Option<String>>(1)?,
                    row.get::<_,String>(2)?,
                    row.get::<_,String>(3)?,
                    row.get::<_,i64>(4)?
                ))
            ).map_err(|_| UploadError::Database)?;
            rows.collect::<Result<Vec<_>,_>>().map_err(|_| UploadError::Database)
        })?;
        let truncated = rows.len() > MAX_DUPLICATE_CANDIDATES;
        let mut candidates = BTreeMap::<i32, DuplicateCandidate>::new();
        if let Some(id) = same_location {
            candidates.insert(
                id.message_id(),
                DuplicateCandidate {
                    message_id: id.message_id(),
                    document_id: id.media_id(),
                    size: query.source.size,
                    filename: None,
                    level: DuplicateLevel::MessageId,
                },
            );
        }
        let mut unverified_rows = 0;
        for (msg, uid, sha, filename, size) in rows.into_iter().take(MAX_DUPLICATE_CANDIDATES) {
            let Some(msg) = msg.and_then(|v| i32::try_from(v).ok()).filter(|v| *v > 0) else {
                unverified_rows += 1;
                continue;
            };
            let Some(doc) = uid.and_then(|s| s.parse::<i64>().ok()).filter(|v| *v != 0) else {
                unverified_rows += 1;
                continue;
            };
            let level =
                if same_location.is_some_and(|id| id.message_id() == msg && id.media_id() == doc) {
                    DuplicateLevel::MessageId
                } else if origin.is_some_and(|id| id.media_id() == doc) {
                    DuplicateLevel::DocumentId
                } else if sha == query.source.sha256 {
                    DuplicateLevel::Sha256
                } else if filename.to_lowercase() == query.filename.to_lowercase() {
                    DuplicateLevel::FilenameSize
                } else {
                    continue;
                };
            let candidate = DuplicateCandidate {
                message_id: msg,
                document_id: doc,
                size: size as u64,
                filename: Some(filename),
                level,
            };
            candidates
                .entry(msg)
                .and_modify(|prior| {
                    if level < prior.level {
                        *prior = candidate.clone();
                    }
                })
                .or_insert(candidate);
        }
        let mut candidates: Vec<_> = candidates.into_values().collect();
        candidates.sort_by_key(|candidate| (candidate.level, candidate.message_id));
        Ok(CandidateBatch {
            candidates,
            truncated,
            unverified_rows,
        })
    }
}
