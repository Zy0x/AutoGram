import datetime
import hashlib
import json
import os
import subprocess
import time
from pathlib import Path

ROOT = Path(r"F:\AutoGram")
AUDIT_DIR = ROOT / "docs" / "audit_v4_real"
RAW_DIR = AUDIT_DIR / "evidence" / "raw"

RAW_DIR.mkdir(parents=True, exist_ok=True)
(AUDIT_DIR / "evidence" / "code").mkdir(parents=True, exist_ok=True)
(AUDIT_DIR / "evidence" / "runtime").mkdir(parents=True, exist_ok=True)
(AUDIT_DIR / "tools").mkdir(parents=True, exist_ok=True)

COMMANDS = [
    ("CMD-01-GIT-TOPLEVEL", ["git", "rev-parse", "--show-toplevel"], ROOT, "git_toplevel.log"),
    ("CMD-02-GIT-BRANCH", ["git", "branch", "--show-current"], ROOT, "git_branch.log"),
    ("CMD-03-GIT-REVPARSE", ["git", "rev-parse", "HEAD"], ROOT, "git_revparse.log"),
    ("CMD-04-GIT-STATUS", ["git", "status", "--short"], ROOT, "git_status.log"),
    ("CMD-05-GIT-DIFFSTAT", ["git", "diff", "--stat"], ROOT, "git_diffstat.log"),
    ("CMD-06-GIT-DIFFCHECK", ["git", "diff", "--check"], ROOT, "git_diffcheck.log"),
    ("CMD-07-GIT-DIFFAPP", ["git", "diff", "--", "AutoGram App/"], ROOT, "git_diffapp.log"),
    ("CMD-08-CARGO-METADATA", ["cargo", "metadata", "--no-deps"], ROOT / "AutoGram App" / "frontend" / "src-tauri", "cargo_metadata.log"),
    ("CMD-09-CARGO-FMT", ["cargo", "fmt", "--all", "--", "--check"], ROOT / "AutoGram App" / "frontend" / "src-tauri", "cargo_fmt.log"),
    ("CMD-10-CARGO-CHECK", ["cargo", "check", "--manifest-path", "AutoGram App/frontend/src-tauri/Cargo.toml"], ROOT, "cargo_check.log"),
    ("CMD-11-CARGO-TEST-LIST", ["cargo", "test", "--manifest-path", "AutoGram App/frontend/src-tauri/Cargo.toml", "--", "--list"], ROOT, "cargo_test_list.log"),
    ("CMD-12-CARGO-TEST", ["cargo", "test", "--manifest-path", "AutoGram App/frontend/src-tauri/Cargo.toml"], ROOT, "cargo_test.log"),
    ("CMD-13-CARGO-CLIPPY", ["cargo", "clippy", "--manifest-path", "AutoGram App/frontend/src-tauri/Cargo.toml", "--all-targets", "--all-features", "--", "-D", "warnings"], ROOT, "cargo_clippy.log"),
    ("CMD-14-NODE-VER", ["node", "--version"], ROOT, "node_version.log"),
    ("CMD-15-NPM-VER", ["npm", "--version"], ROOT, "npm_version.log"),
    ("CMD-16-TSC-CHECK", ["npx.cmd", "tsc", "--noEmit"], ROOT / "AutoGram App" / "frontend", "tsc_check.log"),
    ("CMD-17-NPM-TEST", ["npm.cmd", "test", "--", "--run"], ROOT / "AutoGram App" / "frontend", "npm_test.log"),
    ("CMD-18-NPM-BUILD", ["npm.cmd", "run", "build"], ROOT / "AutoGram App" / "frontend", "npm_build.log"),
    ("CMD-19-FFMPEG-VER", ["ffmpeg", "-version"], ROOT, "ffmpeg_version.log"),
    ("CMD-20-FFPROBE-VER", ["ffprobe", "-version"], ROOT, "ffprobe_version.log"),
    ("CMD-21-FFMPEG-ENCODERS", ["ffmpeg", "-hide_banner", "-encoders"], ROOT, "ffmpeg_encoders.log"),
    ("CMD-22-FFMPEG-DECODERS", ["ffmpeg", "-hide_banner", "-decoders"], ROOT, "ffmpeg_decoders.log"),
    ("CMD-23-FFMPEG-FILTERS", ["ffmpeg", "-hide_banner", "-filters"], ROOT, "ffmpeg_filters.log"),
    ("CMD-24-FFMPEG-HWACCELS", ["ffmpeg", "-hide_banner", "-hwaccels"], ROOT, "ffmpeg_hwaccels.log"),
]

def run_all():
    cmd_manifest = []
    ev_manifest = []

    print(f"Executing {len(COMMANDS)} Phase 0 CLI verification commands...")

    for cid, cmd_list, cwd, log_name in COMMANDS:
        log_path = RAW_DIR / log_name
        start_time = datetime.datetime.now(datetime.timezone.utc).isoformat()
        t0 = time.time()

        try:
            res = subprocess.run(cmd_list, cwd=cwd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding="utf-8", errors="ignore")
            stdout_str = res.stdout or ""
            exit_code = res.returncode
        except Exception as e:
            stdout_str = f"Execution failed: {str(e)}\n"
            exit_code = 127

        t1 = time.time()
        end_time = datetime.datetime.now(datetime.timezone.utc).isoformat()
        duration_sec = round(t1 - t0, 3)

        log_path.write_text(stdout_str, encoding="utf-8")
        raw_bytes = log_path.read_bytes()
        sha256 = hashlib.sha256(raw_bytes).hexdigest()
        byte_size = len(raw_bytes)
        line_count = len(stdout_str.splitlines())

        cmd_manifest.append({
            "command_id": cid,
            "command": " ".join(cmd_list),
            "working_directory": str(cwd),
            "started_at": start_time,
            "ended_at": end_time,
            "duration_seconds": duration_sec,
            "exit_code": exit_code,
            "raw_log": f"docs/audit_v4_real/evidence/raw/{log_name}",
            "raw_log_sha256": sha256,
            "raw_log_size_bytes": byte_size,
            "raw_log_line_count": line_count
        })

        ev_manifest.append({
            "log_filename": log_name,
            "relative_path": f"docs/audit_v4_real/evidence/raw/{log_name}",
            "sha256": sha256,
            "size_bytes": byte_size,
            "line_count": line_count,
            "command_id": cid
        })

        print(f"[{cid}] exit: {exit_code} | duration: {duration_sec}s | log: {log_name} ({byte_size} bytes)")

    cmd_data = {
        "manifest_version": "4.0",
        "generated_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "total_commands": len(cmd_manifest),
        "commands": cmd_manifest
    }
    (AUDIT_DIR / "AUTOGRAM_REAL_COMMAND_MANIFEST.json").write_text(json.dumps(cmd_data, indent=2), encoding="utf-8")

    ev_data = {
        "manifest_version": "4.0",
        "generated_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "total_logs": len(ev_manifest),
        "evidence_logs": ev_manifest
    }
    (AUDIT_DIR / "AUTOGRAM_REAL_EVIDENCE_MANIFEST.json").write_text(json.dumps(ev_data, indent=2), encoding="utf-8")

    print("\nPhase 0 CLI commands executed successfully and manifests generated.")

if __name__ == "__main__":
    run_all()
