"""
duplicate_checker.py (Revised — Enhanced 4-Step Intelligent Check)
────────────────────────────────────────────────────────────────────
Multi-level duplicate lookup for Fast Forward, Media Studio upload,
and the new Smart Scanner-based transfer pipeline.

Check Result enum
─────────────────
    SKIP           — File confirmed alive at destination; skip upload.
    REUPLOAD_AUTO  — File was at destination but now gone (>7 days or
                     guardrail disabled); re-upload immediately.
    REUPLOAD_GUARD — File gone recently (≤ guardrail_threshold_days);
                     wait for user batch confirmation.
    UPLOAD_NEW     — No duplicate found; fresh upload.

Keys stored in duplicate_history.file_unique_id
────────────────────────────────────────────────
    - msgid:{source_entity}:{source_message_id}  (FF native)
    - {telegram_file_unique_id}
    - hash:{sha256}
    - name:{file_name}|{file_size}
    - fp:{fingerprint_hash}                      (NEW — multi-tier)
"""
from __future__ import annotations

import logging
import time
from enum import Enum
from typing import Any, Callable, Dict, List, Optional, Tuple

from database.db import get_connection

log = logging.getLogger(__name__)


class CheckResult(Enum):
    SKIP           = "skip"
    REUPLOAD_AUTO  = "reupload_auto"
    REUPLOAD_GUARD = "reupload_guard"
    UPLOAD_NEW     = "upload_new"


class DuplicateChecker:
    """
    Multi-level duplicate lookup.
    All legacy methods are preserved for backward compatibility with
    FastForward and the old media_studio paths.
    """

    def __init__(
        self,
        target_entity_id: str,
        *,
        guardrail_enabled:       bool = True,
        guardrail_threshold_days: int = 7,
    ):
        self.target_entity_id         = str(target_entity_id)
        self.guardrail_enabled        = guardrail_enabled
        self.guardrail_threshold_days = guardrail_threshold_days

    # ═══════════════════════════════════════════════════════════════
    # LEGACY API (unchanged — used by fast_forward.py, forwarder.py)
    # ═══════════════════════════════════════════════════════════════

    def get_duplicate_message_id(
        self,
        file_unique_id=None,
        file_hash=None,
        file_name=None,
        file_size=None,
    ) -> Optional[int]:
        """Return existing target_message_id if a match is found (legacy)."""
        conn = get_connection()
        cursor = conn.cursor()
        try:
            if file_unique_id:
                cursor.execute(
                    "SELECT target_message_id FROM duplicate_history "
                    "WHERE file_unique_id = ? AND target_entity_id = ?",
                    (str(file_unique_id), self.target_entity_id),
                )
                row = cursor.fetchone()
                if row:
                    return row[0]

            if file_hash:
                cursor.execute(
                    "SELECT target_message_id FROM duplicate_history "
                    "WHERE file_unique_id = ? AND target_entity_id = ?",
                    (f"hash:{file_hash}", self.target_entity_id),
                )
                row = cursor.fetchone()
                if row:
                    return row[0]

            if file_name is not None and file_size is not None:
                cursor.execute(
                    "SELECT target_message_id FROM duplicate_history "
                    "WHERE file_unique_id = ? AND target_entity_id = ?",
                    (f"name:{file_name}|{file_size}", self.target_entity_id),
                )
                row = cursor.fetchone()
                if row:
                    return row[0]
        finally:
            conn.close()
        return None

    def get_duplicate_message_ids(self, keys: List[str]) -> Dict[str, int]:
        """Batch lookup — returns {key: target_message_id} (legacy)."""
        unique_keys = list(dict.fromkeys(str(k) for k in keys if k is not None))
        if not unique_keys:
            return {}
        conn = get_connection()
        cursor = conn.cursor()
        found: Dict[str, int] = {}
        try:
            for start in range(0, len(unique_keys), 400):
                chunk = unique_keys[start:start + 400]
                placeholders = ",".join("?" for _ in chunk)
                cursor.execute(
                    f"SELECT file_unique_id, target_message_id "
                    f"FROM duplicate_history "
                    f"WHERE target_entity_id = ? AND file_unique_id IN ({placeholders})",
                    (self.target_entity_id, *chunk),
                )
                for key, target_message_id in cursor.fetchall():
                    found[str(key)] = target_message_id
        finally:
            conn.close()
        return found

    def log(
        self,
        file_unique_id,
        target_message_id: int,
        file_hash=None,
        file_name=None,
        file_size=None,
        fingerprint_hash: Optional[str] = None,
        media_type: Optional[str] = None,
        target_topic_id: Optional[int] = None,
        first_uploaded_at: Optional[int] = None,
    ) -> None:
        """Store duplicate record(s) after a successful upload."""
        from database.queries import log_duplicate
        now = first_uploaded_at or int(time.time())

        if file_unique_id:
            log_duplicate(str(file_unique_id), self.target_entity_id, target_message_id)
        if file_hash:
            log_duplicate(f"hash:{file_hash}", self.target_entity_id, target_message_id)
        if file_name is not None and file_size is not None:
            log_duplicate(f"name:{file_name}|{file_size}", self.target_entity_id, target_message_id)
        if fingerprint_hash:
            log_duplicate(f"fp:{fingerprint_hash}", self.target_entity_id, target_message_id)

        # Enrich the just-inserted rows with metadata
        if fingerprint_hash or media_type or target_topic_id or first_uploaded_at:
            conn = get_connection()
            try:
                updates: Dict[str, Any] = {}
                if fingerprint_hash:
                    updates["fingerprint_hash"] = fingerprint_hash
                if media_type:
                    updates["media_type"] = media_type
                if target_topic_id is not None:
                    updates["target_topic_id"] = target_topic_id
                if first_uploaded_at:
                    updates["first_uploaded_at"] = first_uploaded_at
                if updates:
                    set_clause = ", ".join(f"{k}=?" for k in updates)
                    conn.execute(
                        f"UPDATE duplicate_history SET {set_clause} "
                        f"WHERE target_entity_id=? AND target_message_id=?",
                        (*updates.values(), self.target_entity_id, target_message_id),
                    )
                    conn.commit()
            except Exception:
                pass
            finally:
                conn.close()

    def delete_duplicate_by_message_id(self, target_message_id: int) -> None:
        conn = get_connection()
        cursor = conn.cursor()
        try:
            cursor.execute(
                "DELETE FROM duplicate_history "
                "WHERE target_message_id = ? AND target_entity_id = ?",
                (target_message_id, self.target_entity_id),
            )
            conn.commit()
        except Exception:
            pass
        finally:
            conn.close()

    @staticmethod
    def msgid_key(source_entity_id, source_message_id) -> str:
        return f"msgid:{source_entity_id}:{source_message_id}"

    # ═══════════════════════════════════════════════════════════════
    # NEW API — 4-Step Intelligent Check (Media Studio)
    # ═══════════════════════════════════════════════════════════════

    async def check_item(
        self,
        source_fp,                              # MediaFingerprint of source file
        scanner,                                # SmartScanner instance (has .index)
        *,
        client_resilient,                       # TelegramResilientClient
        entity,                                 # resolved Telethon entity
        emit_fn: Optional[Callable] = None,
        force_upload: bool = False,
    ) -> Tuple[CheckResult, Optional[int], str]:
        """
        4-Step intelligent duplicate check for a source file.

        Returns
        -------
        (CheckResult, duplicate_message_id_or_None, reason_str)
        """
        if force_upload:
            return CheckResult.UPLOAD_NEW, None, "force_upload"

        emit = emit_fn or (lambda t, **kw: None)

        # ── STEP 1: In-Memory Scan Index (O(1)) ─────────────────────
        mid = scanner.lookup(source_fp, strict=False)
        if mid is not None:
            return CheckResult.SKIP, mid, "pre_scan_index_hit"

        # ── STEP 2: destination_scan_cache DB lookup ─────────────────
        db_mid, db_entry = self._lookup_scan_cache(source_fp)
        if db_mid is not None and db_entry:
            is_alive   = bool(db_entry.get("is_alive", True))
            verified_at = db_entry.get("verified_at") or 0
            age_since_verify = time.time() - verified_at

            if is_alive:
                if age_since_verify < 3600:  # < 1 hour → trust cache
                    return CheckResult.SKIP, db_mid, "db_cache_fresh"
                else:
                    # Deep verify: message still exists?
                    verdict = await self._deep_verify(
                        db_mid, client_resilient, entity
                    )
                    if verdict == "exists":
                        self._update_verified_at(db_mid)
                        return CheckResult.SKIP, db_mid, "db_cache_deep_verified"
                    else:
                        # Mark dead in cache
                        deleted_at = int(time.time())
                        self._mark_dead_in_cache(db_mid, deleted_at)
                        return self._decide_reupload(deleted_at, db_mid, source_fp)
            else:
                # Already known dead
                deleted_at = db_entry.get("delete_detected_at") or int(time.time())
                return self._decide_reupload(deleted_at, db_mid, source_fp)

        # ── STEP 3: duplicate_history (legacy DB) ────────────────────
        hist_mid = self._lookup_history(source_fp)
        if hist_mid is not None:
            verdict = await self._deep_verify(hist_mid, client_resilient, entity)
            if verdict == "exists":
                return CheckResult.SKIP, hist_mid, "history_deep_verified"
            else:
                # Remove stale record from history
                self.delete_duplicate_by_message_id(hist_mid)
                # Mark as recently deleted (assume now as detection time)
                deleted_at = int(time.time())
                return self._decide_reupload(deleted_at, hist_mid, source_fp)

        # ── STEP 4: Not found anywhere → fresh upload ────────────────
        return CheckResult.UPLOAD_NEW, None, "no_duplicate_found"

    # ── private helpers ─────────────────────────────────────────────

    def _lookup_scan_cache(
        self, fp
    ) -> Tuple[Optional[int], Optional[Dict]]:
        """Query destination_scan_cache for a matching entry."""
        conn = get_connection()
        try:
            rows = []
            params_list: List[Tuple] = []

            if fp.primary_hash:
                params_list.append((fp.primary_hash,))
            for sh in (fp.secondary_hashes or []):
                params_list.append((sh,))

            for (fhash,) in params_list:
                row = conn.execute("""
                    SELECT message_id, is_alive, verified_at, delete_detected_at,
                           file_name, file_size, scanned_at
                    FROM destination_scan_cache
                    WHERE target_entity_id=? AND fingerprint_hash=?
                      AND is_alive=1
                    ORDER BY scanned_at DESC LIMIT 1
                """, (self.target_entity_id, fhash)).fetchone()
                if row:
                    return row[0], {
                        "message_id":        row[0],
                        "is_alive":          row[1],
                        "verified_at":       row[2],
                        "delete_detected_at":row[3],
                        "file_name":         row[4],
                        "file_size":         row[5],
                    }

            # Name+size fallback
            if fp.file_name and fp.file_size:
                row = conn.execute("""
                    SELECT message_id, is_alive, verified_at, delete_detected_at
                    FROM destination_scan_cache
                    WHERE target_entity_id=? AND file_name=? AND file_size=?
                      AND is_alive=1
                    ORDER BY scanned_at DESC LIMIT 1
                """, (self.target_entity_id, fp.file_name.lower(), fp.file_size)).fetchone()
                if row:
                    return row[0], {
                        "message_id":        row[0],
                        "is_alive":          bool(row[1]),
                        "verified_at":       row[2],
                        "delete_detected_at":row[3],
                    }

            return None, None
        finally:
            conn.close()

    def _lookup_history(self, fp) -> Optional[int]:
        """Look up duplicate_history using fingerprint + legacy keys."""
        keys: List[str] = []
        if fp.primary_hash:
            keys.append(f"fp:{fp.primary_hash}")
        if fp.sha256:
            keys.append(f"hash:{fp.sha256}")
        if fp.file_name and fp.file_size:
            keys.append(f"name:{fp.file_name}|{fp.file_size}")
        if fp.file_unique_id:
            keys.append(fp.file_unique_id)
        if not keys:
            return None
        found = self.get_duplicate_message_ids(keys)
        for k in keys:
            if k in found:
                return found[k]
        return None

    async def _deep_verify(
        self, message_id: int, client_resilient, entity
    ) -> str:
        """
        Confirm the message still exists and its media is accessible.
        Returns: 'exists' | 'deleted' | 'ghost'
        """
        try:
            msgs = await client_resilient.get_messages_safe(entity, ids=[message_id])
            if not msgs or not msgs[0]:
                return "deleted"
            msg = msgs[0]
            if getattr(msg, "action", None):
                return "deleted"  # service message

            media = (
                getattr(msg, "photo", None)
                or getattr(msg, "video", None)
                or getattr(msg, "document", None)
                or getattr(msg, "audio", None)
            )
            if not media:
                return "deleted"

            # Optionally deep verify file accessibility via get_file
            file_obj = await client_resilient.get_file_safe(media)
            if file_obj is None:
                return "ghost"
            return "exists"
        except Exception as exc:
            log.debug("[DupChecker] deep_verify error for msg %d: %s", message_id, exc)
            return "ghost"

    def _decide_reupload(
        self, deleted_at: int, orig_mid: int, fp
    ) -> Tuple[CheckResult, Optional[int], str]:
        """Decide between REUPLOAD_AUTO and REUPLOAD_GUARD."""
        age_days = (time.time() - deleted_at) / 86400
        if not self.guardrail_enabled or age_days > self.guardrail_threshold_days:
            return CheckResult.REUPLOAD_AUTO, orig_mid, "old_deletion_auto_reupload"
        return CheckResult.REUPLOAD_GUARD, orig_mid, "recent_deletion_guardrail"

    def _mark_dead_in_cache(self, message_id: int, deleted_at: int) -> None:
        conn = get_connection()
        try:
            conn.execute("""
                UPDATE destination_scan_cache
                SET is_alive=0, delete_detected_at=?
                WHERE target_entity_id=? AND message_id=?
            """, (deleted_at, self.target_entity_id, message_id))
            conn.commit()
        except Exception:
            pass
        finally:
            conn.close()

    def _update_verified_at(self, message_id: int) -> None:
        conn = get_connection()
        try:
            conn.execute("""
                UPDATE destination_scan_cache
                SET verified_at=?
                WHERE target_entity_id=? AND message_id=?
            """, (int(time.time()), self.target_entity_id, message_id))
            conn.commit()
        except Exception:
            pass
        finally:
            conn.close()

    # ── Scan cache persistence ───────────────────────────────────────

    def upsert_scan_cache(self, entries: List[Dict]) -> None:
        """Bulk-upsert scan index entries from SmartScanner into destination_scan_cache."""
        if not entries:
            return
        conn = get_connection()
        try:
            conn.executemany("""
                INSERT INTO destination_scan_cache
                    (target_entity_id, topic_id, file_unique_id, file_name,
                     file_size, media_type, fingerprint_tier, fingerprint_hash,
                     width, height, duration, mime_type, message_id,
                     scanned_at, is_alive)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                ON CONFLICT(target_entity_id, topic_id, message_id) DO UPDATE SET
                    file_unique_id   = excluded.file_unique_id,
                    fingerprint_hash = excluded.fingerprint_hash,
                    fingerprint_tier = excluded.fingerprint_tier,
                    scanned_at       = excluded.scanned_at,
                    is_alive         = 1,
                    delete_detected_at = NULL
            """, [
                (
                    e["target_entity_id"],
                    e.get("topic_id"),
                    e.get("file_unique_id"),
                    e.get("file_name"),
                    e.get("file_size"),
                    e.get("media_type", "unknown"),
                    e.get("fingerprint_tier", 4),
                    e.get("fingerprint_hash"),
                    e.get("width"),
                    e.get("height"),
                    e.get("duration"),
                    e.get("mime_type"),
                    e["message_id"],
                    e.get("scanned_at", int(time.time())),
                    1,
                )
                for e in entries
            ])
            conn.commit()
        except Exception as exc:
            log.warning("[DupChecker] upsert_scan_cache failed: %s", exc)
        finally:
            conn.close()

    def load_scan_cache(self, topic_id: Optional[int] = None) -> List[Dict]:
        """Load all alive entries from destination_scan_cache for this entity."""
        conn = get_connection()
        try:
            rows = conn.execute("""
                SELECT message_id, fingerprint_hash, file_unique_id,
                       file_name, file_size, is_alive, verified_at,
                       delete_detected_at, scanned_at
                FROM destination_scan_cache
                WHERE target_entity_id=? AND is_alive=1
                  AND (? IS NULL OR topic_id=? OR topic_id IS NULL)
                ORDER BY scanned_at DESC
            """, (self.target_entity_id, topic_id, topic_id)).fetchall()
            return [
                {
                    "message_id":        r[0],
                    "fingerprint_hash":  r[1],
                    "file_unique_id":    r[2],
                    "file_name":         r[3],
                    "file_size":         r[4],
                    "is_alive":          bool(r[5]),
                    "verified_at":       r[6],
                    "delete_detected_at":r[7],
                    "scanned_at":        r[8],
                }
                for r in rows
            ]
        finally:
            conn.close()
