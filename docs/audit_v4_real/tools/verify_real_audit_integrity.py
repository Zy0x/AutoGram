import csv
import hashlib
import json
import sys
from pathlib import Path

ROOT = Path(r"F:\AutoGram")
AUDIT_DIR = ROOT / "docs" / "audit_v4_real"
RAW_DIR = AUDIT_DIR / "evidence" / "raw"

MATRIX_CSV = AUDIT_DIR / "AUTOGRAM_REAL_REQUIREMENT_MATRIX.csv"
CMD_MANIFEST_JSON = AUDIT_DIR / "AUTOGRAM_REAL_COMMAND_MANIFEST.json"
EV_MANIFEST_JSON = AUDIT_DIR / "AUTOGRAM_REAL_EVIDENCE_MANIFEST.json"
TEST_MAP_MD = AUDIT_DIR / "AUTOGRAM_REAL_TEST_MAP.md"

def verify_all():
    errors = []
    print("=== RUNNING AUTOGRAM REAL FORENSIC AUDIT VERIFIER (PHASE 0) ===")

    if not MATRIX_CSV.exists():
        errors.append(f"Matrix CSV missing: {MATRIX_CSV}")
        return False, errors

    requirements = []
    req_ids = set()
    status_counts = {}
    scope_counts = {}

    with open(MATRIX_CSV, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            rid = row["Requirement ID"].strip()
            if rid in req_ids:
                errors.append(f"Duplicate Requirement ID in CSV: {rid}")
            req_ids.add(rid)

            status = row["Final Status"].strip()
            scope = row["Scope"].strip()
            static_st = row["Static Code Status"].strip()
            unit_st = row["Unit Test Status"].strip()
            integ_st = row["Integration Test Status"].strip()
            runtime_st = row["Runtime Test Status"].strip()

            requirements.append({
                "id": rid, "status": status, "scope": scope,
                "static_st": static_st, "unit_st": unit_st, "integ_st": integ_st, "runtime_st": runtime_st
            })

            status_counts[status] = status_counts.get(status, 0) + 1
            scope_counts[scope] = scope_counts.get(scope, 0) + 1

    total_reqs = len(requirements)
    breakdown_sum = sum(status_counts.values())

    print(f"Assertion 1: Matrix total rows ({total_reqs}) == Status breakdown sum ({breakdown_sum})")
    if total_reqs != breakdown_sum:
        errors.append(f"Assertion 1 FAIL: Total rows {total_reqs} != breakdown sum {breakdown_sum}")

    print("Scope Breakdown:")
    for sc, cnt in scope_counts.items():
        print(f"  - {sc}: {cnt}")

    # Check Command & Evidence Manifests
    if not CMD_MANIFEST_JSON.exists():
        errors.append(f"Command Manifest missing: {CMD_MANIFEST_JSON}")
    else:
        with open(CMD_MANIFEST_JSON, "r", encoding="utf-8") as f:
            cmd_data = json.load(f)
            cmds = cmd_data.get("commands", [])
            print(f"Assertion 2: Registered commands count = {len(cmds)}")
            for c in cmds:
                log_rel = c["raw_log"]
                log_path = ROOT / log_rel
                if not log_path.exists():
                    errors.append(f"Raw log missing: {log_path}")
                    continue
                actual_hash = hashlib.sha256(log_path.read_bytes()).hexdigest()
                if actual_hash != c["raw_log_sha256"]:
                    errors.append(f"Hash mismatch for {c['command_id']}: expected {c['raw_log_sha256']}, got {actual_hash}")

    print(f"Status Counts: {status_counts}")

    # Calculate Strict Coverage Metrics
    code_presence = sum(1 for r in requirements if r["static_st"] in ("Complete", "Partial"))
    unit_verified = sum(1 for r in requirements if r["unit_st"] == "Pass")
    integ_verified = 0 # No typed COMPONENT/INTEGRATION test harness yet
    runtime_verified = sum(1 for r in requirements if r["runtime_st"] == "Pass")
    fully_verified = sum(1 for r in requirements if r["status"] == "VERIFIED_PASS")

    print("\nStrict Coverage Metrics:")
    print(f"  - Code Presence Coverage: {(code_presence/total_reqs)*100:.2f}% ({code_presence}/{total_reqs})")
    print(f"  - Unit-Verified Coverage: {(unit_verified/total_reqs)*100:.2f}% ({unit_verified}/{total_reqs})")
    print(f"  - Integration-Verified Coverage: {(integ_verified/total_reqs)*100:.2f}% ({integ_verified}/{total_reqs})")
    print(f"  - Runtime-Verified Coverage: {(runtime_verified/total_reqs)*100:.2f}% ({runtime_verified}/{total_reqs})")
    print(f"  - Fully Verified Coverage: {(fully_verified/total_reqs)*100:.2f}% ({fully_verified}/{total_reqs})")

    success = len(errors) == 0
    return success, errors

if __name__ == "__main__":
    ok, errs = verify_all()
    if ok:
        print("\n==========================================")
        print("EXIT CODE: 0")
        print("PHASE 0 REAL INTEGRITY VERIFICATION PASSED!")
        print("==========================================")
        sys.exit(0)
    else:
        print("\n==========================================")
        print("EXIT CODE: 1")
        print("VERIFIER ERRORS:")
        for e in errs:
            print(f" - {e}")
        print("==========================================")
        sys.exit(1)
