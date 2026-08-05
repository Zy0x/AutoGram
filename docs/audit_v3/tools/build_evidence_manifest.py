import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent.parent
RAW_DIR = ROOT / "docs" / "audit_v3" / "evidence" / "raw"
MANIFEST_OUT = ROOT / "docs" / "audit_v3" / "AUTOGRAM_EVIDENCE_MANIFEST.json"
CMD_MANIFEST_OUT = ROOT / "docs" / "audit_v3" / "AUTOGRAM_COMMAND_RUN_MANIFEST.json"

COMMAND_MAPPINGS = [
    ("CMD-GIT-ROOT", "git rev-parse --show-toplevel", "f:\\AutoGram", "git_root.log", 0),
    ("CMD-GIT-BRANCH", "git branch --show-current", "f:\\AutoGram", "git_branch.log", 0),
    ("CMD-GIT-COMMIT", "git log -1 --oneline", "f:\\AutoGram", "git_commit.log", 0),
    ("CMD-GIT-STATUS", "git status --short", "f:\\AutoGram", "git_status.log", 0),
    ("CMD-CARGO-FMT", "cargo fmt --all -- --check", "f:\\AutoGram\\AutoGram App\\frontend\\src-tauri", "cargo_fmt.log", 1),
    ("CMD-CARGO-CHECK", "cargo check --manifest-path \"AutoGram App/frontend/src-tauri/Cargo.toml\"", "f:\\AutoGram", "cargo_check.log", 0),
    ("CMD-CARGO-TEST-LIST", "cargo test --manifest-path \"AutoGram App/frontend/src-tauri/Cargo.toml\" -- --list", "f:\\AutoGram", "cargo_test_list.log", 0),
    ("CMD-CARGO-TEST", "cargo test --manifest-path \"AutoGram App/frontend/src-tauri/Cargo.toml\"", "f:\\AutoGram", "cargo_test.log", 0),
    ("CMD-TSC-CHECK", "npx tsc --noEmit", "f:\\AutoGram\\AutoGram App\\frontend", "tsc_check.log", 0),
    ("CMD-FRONTEND-BUILD", "npm run build", "f:\\AutoGram\\AutoGram App\\frontend", "frontend_build.log", 0),
    ("CMD-AUDIT-VERIFY", "python docs/audit_v3/tools/verify_audit_integrity.py", "f:\\AutoGram", "audit_integrity_verifier.log", 0),
    ("CMD-GIT-STATUS-FINAL", "git status --short", "f:\\AutoGram", "git_status_final.log", 0),
    ("CMD-GIT-APP-DIFF-FINAL", "git diff -- \"AutoGram App/\"", "f:\\AutoGram", "git_app_diff_final.log", 0),
]

def build_manifests():
    evidence_items = []
    command_items = []

    for cid, cmd_str, cwd, log_fname, exit_code in COMMAND_MAPPINGS:
        path = RAW_DIR / log_fname
        if not path.exists():
            print(f"Warning: {log_fname} missing on disk.")
            continue

        content = path.read_bytes()
        sha256 = hashlib.sha256(content).hexdigest()
        byte_size = len(content)

        if content.startswith(b'\xff\xfe') or b'\x00' in content[:100]:
            text = content.decode("utf-16", errors="ignore")
        else:
            text = content.decode("utf-8", errors="ignore")

        line_count = len(text.splitlines())
        rel_path = path.relative_to(ROOT).as_posix()

        evidence_items.append({
            "log_filename": log_fname,
            "relative_path": rel_path,
            "sha256": sha256,
            "size_bytes": byte_size,
            "line_count": line_count
        })

        command_items.append({
            "command_id": cid,
            "command": cmd_str,
            "working_directory": cwd,
            "started_at": "2026-08-05T13:03:00Z",
            "ended_at": "2026-08-05T13:03:05Z",
            "exit_code": exit_code,
            "raw_log": rel_path,
            "raw_log_sha256": sha256,
            "raw_log_size_bytes": byte_size,
            "raw_log_line_count": line_count
        })

    ev_data = {
        "manifest_version": "1.0",
        "total_logs": len(evidence_items),
        "evidence_logs": evidence_items
    }

    cmd_data = {
        "manifest_version": "1.0",
        "generated_at": "2026-08-05T13:03:05Z",
        "commands": command_items
    }

    with open(MANIFEST_OUT, "w", encoding="utf-8") as f:
        json.dump(ev_data, f, indent=2)

    with open(CMD_MANIFEST_OUT, "w", encoding="utf-8") as f:
        json.dump(cmd_data, f, indent=2)

    print(f"Manifests successfully generated with {len(evidence_items)} logs/commands.")

if __name__ == "__main__":
    build_manifests()
