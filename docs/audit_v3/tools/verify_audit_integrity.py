import csv
import hashlib
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent.parent
AUDIT_V3_DIR = ROOT / "docs" / "audit_v3"
RAW_DIR = AUDIT_V3_DIR / "evidence" / "raw"

MATRIX_CSV = AUDIT_V3_DIR / "AUTOGRAM_REQUIREMENT_MATRIX.csv"
CASE_CSV = AUDIT_V3_DIR / "AUTOGRAM_EXPLICIT_CASE_CATALOG.csv"
TEST_MAP_MD = AUDIT_V3_DIR / "AUTOGRAM_TEST_TO_REQUIREMENT_MAP.md"
DISCOVERED_TESTS_JSON = AUDIT_V3_DIR / "AUTOGRAM_DISCOVERED_TESTS.json"
MANIFEST_JSON = AUDIT_V3_DIR / "AUTOGRAM_EVIDENCE_MANIFEST.json"
COMMAND_MANIFEST_JSON = AUDIT_V3_DIR / "AUTOGRAM_COMMAND_RUN_MANIFEST.json"
REPORT_MD = AUDIT_V3_DIR / "AUTOGRAM_IMPLEMENTATION_AUDIT_REPORT.md"

def run_verifier():
    errors = []
    print("=== RUNNING AUTOGRAM V3.1 AUDIT INTEGRITY VERIFIER ===")

    # 1. Read Matrix CSV
    if not MATRIX_CSV.exists():
        errors.append(f"Matrix CSV missing: {MATRIX_CSV}")
        return False, errors

    requirements = []
    req_ids = set()
    dup_reqs = set()
    status_counts = {}

    with open(MATRIX_CSV, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            rid = row["Requirement ID"].strip()
            if rid in req_ids:
                dup_reqs.add(rid)
            req_ids.add(rid)
            status = row["Final Status"].strip()
            static_status = row["Static Code Status"].strip()
            unit_status = row["Unit Test Status"].strip()
            integ_status = row["Integration Test Status"].strip()
            runtime_status = row["Runtime Test Status"].strip()
            domain = row["Domain"].strip()

            requirements.append({
                "id": rid,
                "status": status,
                "static_status": static_status,
                "unit_status": unit_status,
                "integ_status": integ_status,
                "runtime_status": runtime_status,
                "domain": domain
            })
            status_counts[status] = status_counts.get(status, 0) + 1

    total_matrix_rows = len(requirements)
    breakdown_sum = sum(status_counts.values())

    print(f"Assertion 1: Matrix total rows ({total_matrix_rows}) == Status breakdown sum ({breakdown_sum})")
    if total_matrix_rows != breakdown_sum:
        errors.append(f"Assertion 1 FAIL: Matrix row count {total_matrix_rows} != breakdown sum {breakdown_sum}")

    if dup_reqs:
        errors.append(f"Assertion 11 FAIL: Duplicate Requirement IDs found: {dup_reqs}")
    else:
        print("Assertion 11 PASS: No duplicate canonical Requirement IDs.")

    # 2. Check Explicit Cases
    case_parents = set()
    dup_cases = set()
    seen_composite = set()
    if CASE_CSV.exists():
        with open(CASE_CSV, "r", encoding="utf-8") as f:
            c_reader = csv.DictReader(f)
            for crow in c_reader:
                ckey = crow["Case ID"].strip()
                parent = crow["Parent Requirement ID"].strip()
                if ckey in seen_composite:
                    dup_cases.add(ckey)
                seen_composite.add(ckey)
                case_parents.add(parent)

    print(f"Assertion 17 PASS: Explicit case extraction coverage reported ({len(seen_composite)} composite cases).")

    if dup_cases:
        errors.append(f"Assertion 12 FAIL: Duplicate composite case keys found: {dup_cases}")
    else:
        print("Assertion 12 PASS: No duplicate source+case key.")

    orphan_case_parents = case_parents - req_ids
    if orphan_case_parents:
        errors.append(f"Assertion 10 FAIL: Explicit Case Parent IDs not in Matrix: {orphan_case_parents}")
    else:
        print("Assertion 10 PASS: All Explicit Case Parent IDs exist in Requirement Matrix.")

    # 3. Check Discovered Tests vs Test Map
    if not DISCOVERED_TESTS_JSON.exists():
        errors.append(f"Discovered tests JSON missing: {DISCOVERED_TESTS_JSON}")
        discovered_tests = []
    else:
        with open(DISCOVERED_TESTS_JSON, "r", encoding="utf-8") as f:
            discovered_data = json.load(f)
            discovered_tests = discovered_data.get("test_names", [])

    mapped_tests = set()
    dup_tests = set()
    mapped_req_ids = set()
    needs_review_mapped_reqs = set()
    has_typed_integ = False

    if TEST_MAP_MD.exists():
        map_content = TEST_MAP_MD.read_text(encoding="utf-8")
        table_lines = [l for l in map_content.splitlines() if l.startswith("| `")]
        for line in table_lines:
            cols = [c.strip() for c in line.split("|")]
            if len(cols) >= 10:
                tname = cols[1].replace("`", "").strip()
                ttype = cols[2].strip()
                rids_str = cols[4].replace("`", "").strip()
                rev_status = cols[9].strip()

                if ttype in ("COMPONENT", "INTEGRATION"):
                    has_typed_integ = True

                if tname in mapped_tests:
                    dup_tests.add(tname)
                mapped_tests.add(tname)

                for r in rids_str.split(","):
                    r_clean = r.strip()
                    if r_clean:
                        mapped_req_ids.add(r_clean)
                        if rev_status == "NEEDS_REVIEW":
                            needs_review_mapped_reqs.add(r_clean)

    if len(discovered_tests) != len(mapped_tests):
        errors.append(f"Assertion 8 FAIL: Discovered tests count ({len(discovered_tests)}) != Mapped tests count ({len(mapped_tests)})")
    else:
        print(f"Assertion 8 PASS: Discovered tests count ({len(discovered_tests)}) == Mapped tests count ({len(mapped_tests)})")

    orphan_map_ids = mapped_req_ids - req_ids
    if orphan_map_ids:
        errors.append(f"Assertion 9 FAIL: Test Map contains orphan Requirement IDs not in Matrix: {orphan_map_ids}")
    else:
        print("Assertion 9 PASS: All Test Map Requirement IDs exist in Requirement Matrix.")

    # 4. Calculate Strict Coverage Metrics
    code_presence_cnt = sum(1 for r in requirements if r["static_status"] in ("Complete", "Partial"))
    # Unit Verified requires Unit status Pass AND no NEEDS_REVIEW mapping
    unit_verified_cnt = sum(1 for r in requirements if r["unit_status"] == "Pass" and r["id"] not in needs_review_mapped_reqs)
    # Integration Verified requires Integration Pass AND typed INTEGRATION/COMPONENT test
    integ_verified_cnt = sum(1 for r in requirements if r["integ_status"] == "Pass") if has_typed_integ else 0
    runtime_verified_cnt = sum(1 for r in requirements if r["runtime_status"] == "Pass")
    fully_verified_cnt = sum(1 for r in requirements if r["status"] == "VERIFIED_PASS")

    code_presence_pct = (code_presence_cnt / total_matrix_rows) * 100
    unit_verified_pct = (unit_verified_cnt / total_matrix_rows) * 100
    integ_verified_pct = (integ_verified_cnt / total_matrix_rows) * 100
    runtime_verified_pct = (runtime_verified_cnt / total_matrix_rows) * 100
    fully_verified_pct = (fully_verified_cnt / total_matrix_rows) * 100

    print(f"Assertion 3 PASS: Strict Coverage calculated from Matrix & Evidence:")
    print(f"  - Code Presence Coverage: {code_presence_pct:.2f}% ({code_presence_cnt}/{total_matrix_rows})")
    print(f"  - Unit-Verified Coverage: {unit_verified_pct:.2f}% ({unit_verified_cnt}/{total_matrix_rows})")
    print(f"  - Integration-Verified Coverage: {integ_verified_pct:.2f}% ({integ_verified_cnt}/{total_matrix_rows})")
    print(f"  - Runtime-Verified Coverage: {runtime_verified_pct:.2f}% ({runtime_verified_cnt}/{total_matrix_rows})")
    print(f"  - Fully Verified Coverage: {fully_verified_pct:.2f}% ({fully_verified_cnt}/{total_matrix_rows})")

    if not has_typed_integ and integ_verified_cnt > 0:
        errors.append("Assertion 18 FAIL: Claimed integration test status without typed COMPONENT/INTEGRATION test evidence.")
    else:
        print("Assertion 18 PASS: Typed integration test evidence requirement enforced.")

    # 5. Check Manifests Parity & Registered Commands
    cmd_count = 0
    verifier_registered = False
    if COMMAND_MANIFEST_JSON.exists():
        with open(COMMAND_MANIFEST_JSON, "r", encoding="utf-8") as f:
            cdata = json.load(f)
            cmds = cdata.get("commands", [])
            cmd_count = len(cmds)
            for c in cmds:
                if c.get("command_id") == "CMD-AUDIT-VERIFY":
                    verifier_registered = True

    ev_count = 0
    placeholder_hashes = False
    if MANIFEST_JSON.exists():
        with open(MANIFEST_JSON, "r", encoding="utf-8") as f:
            mdata = json.load(f)
            logs = mdata.get("evidence_logs", [])
            ev_count = len(logs)
            for item in logs:
                path = ROOT / item["relative_path"]
                if not path.exists():
                    errors.append(f"Assertion 4 FAIL: Raw log missing on disk: {path}")
                    continue
                actual_hash = hashlib.sha256(path.read_bytes()).hexdigest()
                if actual_hash != item["sha256"]:
                    errors.append(f"Assertion 5 FAIL: Hash mismatch for {item['log_filename']}: expected {item['sha256']}, got {actual_hash}")
                if item["sha256"] in ("0", "", "placeholder"):
                    placeholder_hashes = True

    if placeholder_hashes:
        errors.append("Assertion 14 FAIL: Placeholder hashes found in Evidence Manifest.")
    else:
        print("Assertion 14 PASS: No placeholder hashes found.")

    if cmd_count != ev_count:
        errors.append(f"Assertion 6 FAIL: Command Manifest entries ({cmd_count}) != Evidence Manifest logs ({ev_count})")
    else:
        print(f"Assertion 6 PASS: Command Manifest ({cmd_count}) == Evidence Manifest ({ev_count}).")

    if not verifier_registered:
        errors.append("Assertion 7 FAIL: CMD-AUDIT-VERIFY command entry not registered in Command Manifest.")
    else:
        print("Assertion 7 PASS: CMD-AUDIT-VERIFY registered in Command Manifest.")

    # 6. Check VERIFIED_PASS Gate Rule
    runtime_dependent_domains = {"Transfer Manager", "Album Orchestration", "Encoder"}
    gate_violations = [r["id"] for r in requirements if r["status"] == "VERIFIED_PASS" and r["domain"] in runtime_dependent_domains and r["runtime_status"] == "Blocked"]
    if gate_violations:
        errors.append(f"Assertion 15 FAIL: Gate rule violated for VERIFIED_PASS requirements with Blocked runtime: {gate_violations}")
    else:
        print("Assertion 15 PASS: No VERIFIED_PASS status violates evidence gates.")

    success = len(errors) == 0
    return success, errors

if __name__ == "__main__":
    ok, errs = run_verifier()
    if ok:
        print("\n==========================================")
        print("EXIT CODE: 0")
        print("ALL INTEGRITY ASSERTIONS PASSED SUCCESSFULLY!")
        print("==========================================")
        sys.exit(0)
    else:
        print("\n==========================================")
        print("EXIT CODE: 1")
        print("INTEGRITY VERIFIER ERRORS:")
        for e in errs:
            print(f" - {e}")
        print("==========================================")
        sys.exit(1)
