"""
Read proxy / VPN optimizer settings injected by Rust (AUTOGRAM_* env).
Applied to Telethon clients so desktop network settings actually affect MTProto.
"""
from __future__ import annotations

import os
from typing import Any, Dict, Optional, Tuple


def _env_bool(key: str, default: bool = False) -> bool:
    v = (os.environ.get(key) or "").strip().lower()
    if not v:
        return default
    return v in ("1", "true", "yes", "on")


def _env_int(key: str, default: int) -> int:
    try:
        return int(os.environ.get(key) or default)
    except Exception:
        return default


def proxy_enabled() -> bool:
    return _env_bool("AUTOGRAM_PROXY_ENABLED", False)


def vpn_mode() -> bool:
    return _env_bool("AUTOGRAM_VPN_MODE", False)


def build_telethon_proxy() -> Optional[Any]:
    """
    Return Telethon-compatible proxy dict, or None.
    Prefer python_socks ProxyType when available.
    """
    if not proxy_enabled():
        return None
    host = (os.environ.get("AUTOGRAM_PROXY_HOST") or "").strip()
    if not host:
        return None
    port = _env_int("AUTOGRAM_PROXY_PORT", 1080)
    ptype = (os.environ.get("AUTOGRAM_PROXY_TYPE") or "socks5").strip().lower()
    user = (os.environ.get("AUTOGRAM_PROXY_USER") or "").strip() or None
    password = (os.environ.get("AUTOGRAM_PROXY_PASS") or "").strip() or None
    secret = (os.environ.get("AUTOGRAM_PROXY_SECRET") or "").strip() or None

    # MTProto proxy (Telegram-native)
    if ptype in ("mtproto", "mtproxy", "mtp"):
        # Telethon: (socks.MTPROXY, host, port, secret_bytes)
        try:
            import socks  # type: ignore

            sec = secret or ""
            if sec.startswith("dd") or sec.startswith("ee"):
                # raw hex or tg secret
                try:
                    secret_bytes = bytes.fromhex(sec)
                except Exception:
                    secret_bytes = sec.encode("utf-8")
            else:
                try:
                    secret_bytes = bytes.fromhex(sec)
                except Exception:
                    secret_bytes = sec.encode("utf-8")
            return (socks.MTPROXY, host, port, secret_bytes)
        except Exception:
            # Fallback: cannot use MTPROXY without PySocks extras
            pass

    # SOCKS5 / HTTP via python_socks (preferred by modern Telethon)
    try:
        from python_socks import ProxyType  # type: ignore

        type_map = {
            "socks5": ProxyType.SOCKS5,
            "socks4": ProxyType.SOCKS4,
            "http": ProxyType.HTTP,
            "https": ProxyType.HTTP,
        }
        pt = type_map.get(ptype, ProxyType.SOCKS5)
        return {
            "proxy_type": pt,
            "addr": host,
            "port": port,
            "username": user,
            "password": password,
            "rdns": True,
        }
    except Exception:
        pass

    # Legacy tuple form (PySocks)
    try:
        import socks  # type: ignore

        kind = socks.SOCKS5
        if ptype in ("http", "https"):
            kind = socks.HTTP
        elif ptype == "socks4":
            kind = socks.SOCKS4
        if user:
            return (kind, host, port, True, user, password)
        return (kind, host, port)
    except Exception:
        pass

    return None


def telethon_client_kwargs() -> Dict[str, Any]:
    """Extra kwargs for TelegramClient(...) from env."""
    kw: Dict[str, Any] = {}
    proxy = build_telethon_proxy()
    if proxy is not None:
        kw["proxy"] = proxy

    mult = max(1, _env_int("AUTOGRAM_VPN_TIMEOUT_MULT", 1 if not vpn_mode() else 3))
    # Telethon uses connection_retries + retry_delay; timeout is per-request
    conn_retries = _env_int("AUTOGRAM_CONNECTION_RETRIES", 15 if vpn_mode() else 10)
    req_retries = _env_int("AUTOGRAM_REQUEST_RETRIES", 10)
    retry_delay = max(1, _env_int("AUTOGRAM_RETRY_DELAY", 3 if vpn_mode() else 2))

    # When VPN mode on, be more patient
    if vpn_mode():
        conn_retries = max(conn_retries, 15 * mult // 2)
        retry_delay = max(retry_delay, min(8, mult + 1))

    kw["connection_retries"] = max(conn_retries, 5)
    kw["retry_delay"] = retry_delay
    kw["auto_reconnect"] = True

    # flood_sleep_threshold: respect long FloodWait when VPN/flood respect on
    if _env_bool("AUTOGRAM_FLOOD_RESPECT", True):
        kw["flood_sleep_threshold"] = 86400
    else:
        kw["flood_sleep_threshold"] = 60

    # Keepalive hint stored for drive_serve (not a Telethon ctor arg)
    kw["_autogram_request_retries"] = req_retries
    kw["_autogram_keepalive_sec"] = _env_int("AUTOGRAM_KEEPALIVE_SEC", 45)
    return kw


def apply_client_post_create(client: Any, kw: Dict[str, Any]) -> None:
    """Apply fields that are not TelegramClient constructor kwargs."""
    rr = kw.pop("_autogram_request_retries", None)
    if rr is not None:
        try:
            client.request_retries = int(rr)
        except Exception:
            pass
    # strip private keys if any remain
    for k in list(kw.keys()):
        if k.startswith("_autogram_"):
            kw.pop(k, None)


def connection_summary() -> Dict[str, Any]:
    return {
        "proxy_enabled": proxy_enabled(),
        "proxy_type": os.environ.get("AUTOGRAM_PROXY_TYPE"),
        "proxy_host": os.environ.get("AUTOGRAM_PROXY_HOST"),
        "proxy_port": os.environ.get("AUTOGRAM_PROXY_PORT"),
        "vpn_mode": vpn_mode(),
        "timeout_mult": os.environ.get("AUTOGRAM_VPN_TIMEOUT_MULT"),
    }
