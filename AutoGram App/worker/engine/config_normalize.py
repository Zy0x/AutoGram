"""
Normalize job/execution config from UI + CLI into a single canonical shape.
"""
from __future__ import annotations

import math
from typing import Any, Dict, Optional


def _finite_or(value: Any, default: float) -> float:
    if value is None:
        return default
    try:
        v = float(value)
        if math.isnan(v) or math.isinf(v):
            return default
        return v
    except (TypeError, ValueError):
        return default


def _as_bool(value: Any, default: bool = False) -> bool:
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return bool(value)
    s = str(value).strip().lower()
    if s in ("1", "true", "yes", "on"):
        return True
    if s in ("0", "false", "no", "off", ""):
        return False
    return default


def normalize_job_config(raw: Optional[Dict[str, Any]], cli: Optional[Any] = None) -> Dict[str, Any]:
    """
    Merge UI camelCase / snake_case config and optional argparse namespace into
    canonical keys used by engines.
    """
    cfg: Dict[str, Any] = dict(raw or {})

    # --- identity / chats ---
    if "source" in cfg and "source_chat" not in cfg:
        cfg["source_chat"] = cfg["source"]
    if "sourceValue" in cfg and "source_chat" not in cfg:
        cfg["source_chat"] = cfg["sourceValue"]
    if "destination" in cfg and "dest_chat" not in cfg:
        cfg["dest_chat"] = cfg["destination"]
    if "destValue" in cfg and "dest_chat" not in cfg:
        cfg["dest_chat"] = cfg["destValue"]

    # --- session ---
    if "session" in cfg and "session_name" not in cfg:
        cfg["session_name"] = cfg["session"]
    if "selectedSession" in cfg and "session_name" not in cfg:
        cfg["session_name"] = cfg["selectedSession"]

    # --- mode ---
    if "mode" in cfg and "transfer_mode" not in cfg:
        cfg["transfer_mode"] = cfg["mode"]
    # Keep both in sync for branch checks
    if cfg.get("transfer_mode") and not cfg.get("mode"):
        cfg["mode"] = cfg["transfer_mode"]
    if cfg.get("mode") and not cfg.get("transfer_mode"):
        cfg["transfer_mode"] = cfg["mode"]

    # --- quality / clean copy ---
    if "qualityMode" in cfg and "quality_mode" not in cfg:
        cfg["quality_mode"] = cfg["qualityMode"]
    if "cleanCopySubMode" in cfg and "clean_copy_submode" not in cfg:
        cfg["clean_copy_submode"] = cfg["cleanCopySubMode"]
    cfg.setdefault("quality_mode", "SMART")
    cfg.setdefault("clean_copy_submode", "Speed")

    # --- duplicate ---
    if "dupAction" in cfg and "duplicate_action" not in cfg:
        cfg["duplicate_action"] = cfg["dupAction"]
    cfg.setdefault("duplicate_action", "Skip")
    cfg["dupAction"] = cfg.get("duplicate_action", "Skip")

    # --- filters ---
    if "media" in cfg and "media_filter" not in cfg:
        cfg["media_filter"] = cfg["media"]
    if "mediaFilter" in cfg and "media_filter" not in cfg:
        cfg["media_filter"] = cfg["mediaFilter"]
    mf = cfg.get("media_filter", "all")
    if mf in ("Semua", "All", "ALL"):
        mf = "all"
    cfg["media_filter"] = mf

    if "size_min" in cfg and "size_min_mb" not in cfg:
        cfg["size_min_mb"] = cfg["size_min"]
    if "sizeMin" in cfg and "size_min_mb" not in cfg:
        cfg["size_min_mb"] = cfg["sizeMin"]
    # Legacy Fast Forward keys
    if "min_size_mb" in cfg and "size_min_mb" not in cfg:
        cfg["size_min_mb"] = cfg["min_size_mb"]
    if "size_max" in cfg and "size_max_mb" not in cfg:
        cfg["size_max_mb"] = cfg["size_max"]
    if "sizeMax" in cfg and "size_max_mb" not in cfg:
        cfg["size_max_mb"] = cfg["sizeMax"]
    if "max_size_mb" in cfg and "size_max_mb" not in cfg:
        cfg["size_max_mb"] = cfg["max_size_mb"]

    # null / missing max = unlimited (0 sentinel for filters)
    cfg["size_min_mb"] = _finite_or(cfg.get("size_min_mb"), 0.0)
    # Keep legacy aliases in sync so any path reading min_size_mb still works
    cfg["min_size_mb"] = cfg["size_min_mb"]
    max_raw = cfg.get("size_max_mb")
    if max_raw is None or max_raw == "" or max_raw == "Infinity":
        cfg["size_max_mb"] = 0.0  # 0 = no upper bound in filters
    else:
        cfg["size_max_mb"] = _finite_or(max_raw, 0.0)
    cfg["max_size_mb"] = cfg["size_max_mb"]

    # --- direction / album / caption ---
    if "fetchDirection" in cfg and "fetch_direction" not in cfg:
        cfg["fetch_direction"] = cfg["fetchDirection"]
    cfg.setdefault("fetch_direction", "Newest First")

    if "albumHandling" in cfg and "album_handling" not in cfg:
        cfg["album_handling"] = cfg["albumHandling"]
    cfg.setdefault("album_handling", "Follow Source")

    if "captionRule" in cfg and "caption_rule" not in cfg:
        cfg["caption_rule"] = cfg["captionRule"]
    cfg.setdefault("caption_rule", "Keep Original")

    if "enableCaptionRule" in cfg:
        cfg["enable_caption_rule"] = _as_bool(cfg["enableCaptionRule"], True)
    cfg.setdefault("enable_caption_rule", True)

    if "customCaption" in cfg and "custom_caption" not in cfg:
        cfg["custom_caption"] = cfg["customCaption"]
    cfg.setdefault("custom_caption", "")

    # If custom caption enabled with content, force caption_rule for process_caption
    if cfg.get("enable_caption_rule") and cfg.get("custom_caption"):
        # Only override when rule is custom-like or user filled custom field
        rule = str(cfg.get("caption_rule") or "")
        if "custom" in rule.lower() or cfg.get("custom_caption"):
            if rule in ("Custom Caption", "custom", "Custom"):
                cfg["caption_rule"] = f"custom:{cfg['custom_caption']}"

    if "hideTrace" in cfg and "hide_trace" not in cfg:
        cfg["hide_trace"] = _as_bool(cfg["hideTrace"], False)
    cfg.setdefault("hide_trace", False)

    # --- throttle ---
    if "delayMin" in cfg and "delay_min" not in cfg:
        cfg["delay_min"] = cfg["delayMin"]
    if "delayMax" in cfg and "delay_max" not in cfg:
        cfg["delay_max"] = cfg["delayMax"]
    cfg["delay_min"] = _finite_or(cfg.get("delay_min"), 2.0)
    cfg["delay_max"] = _finite_or(cfg.get("delay_max"), 5.0)
    if "throttle_active" not in cfg:
        # If delays differ from defaults substantially or enableThrottle was set
        cfg["throttle_active"] = _as_bool(cfg.get("enableThrottle"), False) or (
            cfg["delay_min"] != 2.0 or cfg["delay_max"] != 5.0
        )

    # --- dates ---
    if "startDate" in cfg and "start_date" not in cfg:
        cfg["start_date"] = cfg["startDate"] or None
    if "endDate" in cfg and "end_date" not in cfg:
        cfg["end_date"] = cfg["endDate"] or None
    if cfg.get("start_date") == "":
        cfg["start_date"] = None
    if cfg.get("end_date") == "":
        cfg["end_date"] = None

    # --- limit (0 = unlimited) ---
    if "enableLimit" in cfg and not _as_bool(cfg["enableLimit"], False):
        cfg["limit"] = 0
    try:
        lim = int(cfg.get("limit", 0) or 0)
    except (TypeError, ValueError):
        lim = 0
    if lim < 0:
        lim = 0
    cfg["limit"] = lim

    # --- flags ---
    if "autoFallback" in cfg and "auto_fallback" not in cfg:
        cfg["auto_fallback"] = _as_bool(cfg["autoFallback"], False)
    cfg["auto_fallback"] = _as_bool(cfg.get("auto_fallback"), False)

    if "dryRun" in cfg and "dry_run" not in cfg:
        cfg["dry_run"] = _as_bool(cfg["dryRun"], False)
    cfg["dry_run"] = _as_bool(cfg.get("dry_run"), False)

    # --- CLI overrides (only when explicitly meaningful) ---
    if cli is not None:
        if getattr(cli, "source", None):
            cfg["source_chat"] = cli.source
        if getattr(cli, "destination", None):
            cfg["dest_chat"] = cli.destination

        # limit: default argparse was 5 — treat "unset" via sentinel None after we change default
        cli_limit = getattr(cli, "limit", None)
        if cli_limit is not None and cli_limit >= 0:
            # Only override if user passed --limit explicitly (we use default=-1 for unset)
            if cli_limit != -1:
                cfg["limit"] = int(cli_limit)

        if getattr(cli, "dry_run", False):
            cfg["dry_run"] = True

        if getattr(cli, "api_id", None):
            cfg["api_id"] = cli.api_id
        if getattr(cli, "api_hash", None):
            cfg["api_hash"] = cli.api_hash

        sess = getattr(cli, "session", None)
        if sess and sess != "__DEFAULT_SESSION__":
            cfg["session_name"] = sess

        mode = getattr(cli, "mode", None)
        if mode and mode != "__DEFAULT_MODE__":
            cfg["transfer_mode"] = mode
            cfg["mode"] = mode

        media = getattr(cli, "media", None)
        if media and media != "__DEFAULT_MEDIA__":
            cfg["media_filter"] = "all" if media in ("Semua", "All") else media

        dup = getattr(cli, "duplicate_action", None)
        if dup and dup != "__DEFAULT_DUP__":
            cfg["duplicate_action"] = dup
            cfg["dupAction"] = dup

        if getattr(cli, "auto_fallback", False):
            cfg["auto_fallback"] = True

        if getattr(cli, "throttle", False):
            cfg["throttle_active"] = True

        caption = getattr(cli, "caption", None)
        if caption and caption != "__DEFAULT_CAPTION__":
            cfg["caption_rule"] = caption

        album = getattr(cli, "album_handling", None)
        if album and album != "__DEFAULT_ALBUM__":
            cfg["album_handling"] = album

        fetch = getattr(cli, "fetch_direction", None)
        if fetch and fetch != "__DEFAULT_FETCH__":
            cfg["fetch_direction"] = fetch

        if getattr(cli, "start_date", None):
            cfg["start_date"] = cli.start_date
        if getattr(cli, "end_date", None):
            cfg["end_date"] = cli.end_date

        dmin = getattr(cli, "delay_min", None)
        if dmin is not None and dmin != -1:
            cfg["delay_min"] = float(dmin)
        dmax = getattr(cli, "delay_max", None)
        if dmax is not None and dmax != -1:
            cfg["delay_max"] = float(dmax)

        smin = getattr(cli, "size_min", None)
        if smin is not None and smin != -1:
            cfg["size_min_mb"] = float(smin)
        smax = getattr(cli, "size_max", None)
        if smax is not None and smax != -1 and not (isinstance(smax, float) and math.isinf(smax)):
            cfg["size_max_mb"] = float(smax)

        if getattr(cli, "rerun_mode", None):
            cfg["rerun_mode"] = cli.rerun_mode

    # Topics from chat_id_topic format
    source_topic_id = None
    source_str = str(cfg.get("source_chat", "") or "")
    if "_" in source_str:
        try:
            source_topic_id = int(source_str.split("_")[1])
        except (IndexError, ValueError):
            pass
    dest_topic_id = None
    dest_str = str(cfg.get("dest_chat", "") or "")
    if "_" in dest_str:
        try:
            dest_topic_id = int(dest_str.split("_")[1])
        except (IndexError, ValueError):
            pass
    cfg["source_topic_id"] = source_topic_id
    cfg["dest_topic_id"] = dest_topic_id

    cfg.setdefault("session_name", "Lavender")
    cfg.setdefault("transfer_mode", "Clean Copy")
    cfg.setdefault("mode", cfg["transfer_mode"])
    cfg.setdefault("rerun_mode", "RESUME")
    cfg.setdefault("is_retry", False)

    return cfg


def effective_limit(config: Dict[str, Any]) -> int:
    """0 means unlimited."""
    try:
        return max(0, int(config.get("limit") or 0))
    except (TypeError, ValueError):
        return 0
