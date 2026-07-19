"""
transfer_state_manager.py
──────────────────────────
Manages full state persistence for Media Studio transfers, enabling
pause/resume capability.

State is stored in the `transfer_state` SQLite table and JSON-serialised
sub-fields for scan index and queues.

Usage:
    mgr = TransferStateManager(job_id, source_path, target_entity_id, config)
    await mgr.save_pre_scan(scan_index, scan_stats)
    await mgr.save_progress(pending_queue, completed_items, counts)
    # On resume:
    state = mgr.load()
    if state:
        scan_index = state["scan_index"]
        pending    = state["pending_queue"]
"""
from __future__ import annotations

import json
import logging
import time
from typing import Any, Dict, List, Optional

log = logging.getLogger(__name__)


class TransferStateManager:
    """
    Persist and restore transfer state for a single Media Studio job.
    """

    def __init__(
        self,
        job_id: str,
        source_path: str,
        target_entity_id: str,
        config: Dict[str, Any],
    ):
        self.job_id           = job_id
        self.source_path      = source_path
        self.target_entity_id = str(target_entity_id)
        self.config           = config

    # ── create / update ─────────────────────────────────────────────

    def create(self, total_files: int) -> None:
        """Insert initial transfer_state row."""
        from database.db import get_connection
        conn = get_connection()
        try:
            conn.execute("""
                INSERT OR IGNORE INTO transfer_state
                    (job_id, source_path, target_entity_id,
                     target_topic_id, transfer_mode, duplicate_policy,
                     scan_mode, guardrail_enabled, guardrail_threshold_days,
                     topic_scope, max_reupload_per_hour,
                     status, total_files, created_at, last_activity_at)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            """, (
                self.job_id,
                self.source_path,
                self.target_entity_id,
                self.config.get("target_topic_id"),
                self.config.get("transfer_mode", "upload"),
                self.config.get("duplicate_policy", "SKIP"),
                self.config.get("scan_mode", "smart"),
                1 if self.config.get("guardrail_enabled", True) else 0,
                int(self.config.get("guardrail_threshold_days", 7)),
                self.config.get("topic_scope", "selected_plus_general"),
                int(self.config.get("max_reupload_per_hour", 10)),
                "created",
                total_files,
                int(time.time()),
                int(time.time()),
            ))
            conn.commit()
        except Exception as exc:
            log.warning("[TransferState] create failed: %s", exc)
        finally:
            conn.close()

    def update_status(self, status: str) -> None:
        self._update(status=status)

    def save_scan_started(self) -> None:
        self._update(status="pre_scanning", started_at=int(time.time()))

    def save_scan_complete(
        self,
        scan_index: Dict[str, int],
        scan_stats: Dict[str, Any],
    ) -> None:
        self._update(
            scan_index_json=json.dumps(scan_index, separators=(",", ":")),
            scan_stats_json=json.dumps(scan_stats, separators=(",", ":")),
        )

    def save_progress(
        self,
        pending_queue: List[str],
        guardrail_queue: List[Dict],
        completed_items: List[Dict],
        counts: Dict[str, int],
    ) -> None:
        self._update(
            pending_queue_json=json.dumps(pending_queue, separators=(",", ":")),
            guardrail_queue_json=json.dumps(guardrail_queue, separators=(",", ":")),
            completed_items_json=json.dumps(completed_items, separators=(",", ":")),
            processed_files=counts.get("processed", 0),
            skipped_files=counts.get("skipped", 0),
            reuploaded_files=counts.get("reuploaded", 0),
            uploaded_files=counts.get("uploaded", 0),
            failed_files=counts.get("failed", 0),
            guardrail_pending_files=counts.get("guardrail_pending", 0),
            last_activity_at=int(time.time()),
        )

    def save_completed(self, counts: Dict[str, int]) -> None:
        self._update(
            status="completed",
            completed_at=int(time.time()),
            processed_files=counts.get("processed", 0),
            skipped_files=counts.get("skipped", 0),
            reuploaded_files=counts.get("reuploaded", 0),
            uploaded_files=counts.get("uploaded", 0),
            failed_files=counts.get("failed", 0),
        )

    def save_paused(self) -> None:
        self._update(status="paused", paused_at=int(time.time()))

    def save_resumed(self) -> None:
        self._update(status="running", resumed_at=int(time.time()))

    def save_error(self, error_msg: str) -> None:
        from database.db import get_connection
        conn = get_connection()
        try:
            conn.execute("""
                UPDATE transfer_state
                SET error_count = error_count + 1,
                    last_error = ?,
                    last_activity_at = ?
                WHERE job_id = ?
            """, (str(error_msg)[:1000], int(time.time()), self.job_id))
            conn.commit()
        except Exception:
            pass
        finally:
            conn.close()

    # ── load ────────────────────────────────────────────────────────

    def load(self) -> Optional[Dict[str, Any]]:
        """
        Load saved state. Returns None if no state exists or it's not resumable.
        """
        from database.db import get_connection
        conn = get_connection()
        try:
            row = conn.execute("""
                SELECT job_id, status, scan_index_json, scan_stats_json,
                       pending_queue_json, guardrail_queue_json, completed_items_json,
                       total_files, processed_files, skipped_files,
                       reuploaded_files, uploaded_files, failed_files,
                       guardrail_pending_files, paused_at, circuit_breaker_state
                FROM transfer_state WHERE job_id = ?
            """, (self.job_id,)).fetchone()
        finally:
            conn.close()

        if not row:
            return None

        status = row[1]
        if status in ("completed", "cancelled"):
            return None

        def _loads(s):
            if not s:
                return None
            try:
                return json.loads(s)
            except Exception:
                return None

        return {
            "job_id":         row[0],
            "status":         status,
            "scan_index":     _loads(row[2]) or {},
            "scan_stats":     _loads(row[3]) or {},
            "pending_queue":  _loads(row[4]) or [],
            "guardrail_queue":_loads(row[5]) or [],
            "completed_items":_loads(row[6]) or [],
            "total_files":    row[7],
            "processed_files":row[8],
            "skipped_files":  row[9],
            "reuploaded_files":row[10],
            "uploaded_files": row[11],
            "failed_files":   row[12],
            "guardrail_pending": row[13],
            "paused_at":      row[14],
            "circuit_breaker_state": row[15],
        }

    # ── audit log ───────────────────────────────────────────────────

    def log_audit(
        self,
        event_type: str,
        *,
        file_path: Optional[str] = None,
        file_name: Optional[str] = None,
        fingerprint_hash: Optional[str] = None,
        message_id: Optional[int] = None,
        details: Optional[Dict] = None,
    ) -> None:
        from database.db import get_connection
        conn = get_connection()
        try:
            conn.execute("""
                INSERT INTO transfer_audit_log
                    (job_id, timestamp, event_type, file_path, file_name,
                     fingerprint_hash, message_id, details_json)
                VALUES (?,?,?,?,?,?,?,?)
            """, (
                self.job_id,
                int(time.time()),
                event_type,
                file_path,
                file_name,
                fingerprint_hash,
                message_id,
                json.dumps(details, separators=(",", ":"), default=str) if details else None,
            ))
            conn.commit()
        except Exception as exc:
            log.debug("[TransferState] audit log failed: %s", exc)
        finally:
            conn.close()

    # ── internal ────────────────────────────────────────────────────

    def _update(self, **fields) -> None:
        from database.db import get_connection
        if not fields:
            return
        fields["last_activity_at"] = int(time.time())
        set_parts = ", ".join(f"{k} = ?" for k in fields)
        values    = list(fields.values()) + [self.job_id]
        conn = get_connection()
        try:
            conn.execute(
                f"UPDATE transfer_state SET {set_parts} WHERE job_id = ?",
                values,
            )
            conn.commit()
        except Exception as exc:
            log.debug("[TransferState] update failed: %s", exc)
        finally:
            conn.close()
