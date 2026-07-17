"""Cooperative pause via execution status in DB."""
from __future__ import annotations

from database.queries import get_execution


# Only active stop requests — do NOT include terminal PAUSED/STOPPED
# (avoids mis-classifying a finished run, and stale reads).
PAUSE_STATUSES = {"PAUSING", "STOPPING", "CANCELLED"}


def should_pause(execution_id) -> bool:
    if not execution_id:
        return False
    try:
        ex = get_execution(execution_id)
        if not ex:
            return False
        status = str(ex.get("status") or "").strip().upper()
        return status in PAUSE_STATUSES
    except Exception:
        return False


def resolve_final_state(
    *,
    paused: bool,
    failed_count: int,
    processed_count: int,
    limit: int,
    natural_end: bool = False,
) -> str:
    """
    Prefer COMPLETED/PARTIAL when planned work is done, even if pause was
    requested on the last tick (race with limit / iterator end).
    """
    limit = int(limit or 0)
    work_done = natural_end or (limit > 0 and processed_count >= limit)
    if paused and not work_done:
        return "PAUSED"
    if failed_count > 0:
        return "PARTIAL_SUCCESS"
    return "COMPLETED"
