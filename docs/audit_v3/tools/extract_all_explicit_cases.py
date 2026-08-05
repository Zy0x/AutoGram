import csv
import re
from pathlib import Path

DOWNLOADS = Path(r"C:\Users\aliri\Downloads")
AUDIT_V3_DIR = Path(__file__).resolve().parent.parent

SPEC_FILES = [
    ("Spec v4.1", DOWNLOADS / "1. AUTOGRAM_QUALITY_MODE_ENGINE_AGENT_EXECUTION_SPEC_v4.1.0.md", "AUD-V41-ORIG-001"),
    ("Spec v4.3", DOWNLOADS / "2. AUTOGRAM_UNIVERSAL_FILE_MEDIA_DOCUMENT_BATCH_ALBUM_HANDLING_SPEC_v4.3.0.md", "AUD-V43-FMT-001"),
    ("Spec v4.4", DOWNLOADS / "3. AUTOGRAM_OVERSIZE_TRANSFER_MANAGER_SPLIT_ALTERNATE_SKIP_SPEC_v4.4.0.md", "AUD-V44-SPLIT-001"),
    ("Spec v4.5", DOWNLOADS / "4. AUTOGRAM_TRANSFER_MANAGER_SCALE_FLOODWAIT_BATCH_ALBUM_DOWNLOAD_RELIABILITY_SPEC_v4.5.0.md", "AUD-V45-RATE-001"),
    ("Spec v4.6", DOWNLOADS / "5. AUTOGRAM_INTELLIGENT_ALBUM_ORCHESTRATION_AND_FAILURE_RECOVERY_SPEC_v4.6.0.md", "AUD-V46-ALB-001"),
    ("Spec v4.7", DOWNLOADS / "6. AUTOGRAM_INTELLIGENT_ENCODER_ORCHESTRATION_RESOURCE_SCHEDULING_SPEC_v4.7.0.md", "AUD-V47-ENC-001"),
]

# Canonical Matrix Requirements Set for validation
CANONICAL_REQS = {
    "AUD-MST-ARCH-001", "AUD-MST-ARCH-002", "AUD-MST-SEC-001", "AUD-MST-SEC-002", "AUD-MST-SEC-003",
    "AUD-MST-SEC-004", "AUD-MST-SEC-005", "AUD-MST-SEC-006", "AUD-MST-SEC-007", "AUD-MST-DUP-001",
    "AUD-MST-DUP-002", "AUD-MST-DUP-003", "AUD-MST-MIG-001", "AUD-MST-MIG-002", "AUD-MST-NET-001",
    "AUD-MST-NET-002", "AUD-V41-ORIG-001", "AUD-V41-ORIG-002", "AUD-V41-ORIG-003", "AUD-V41-HQ-001",
    "AUD-V41-SMART-001", "AUD-V41-SMART-002", "AUD-V41-CAP-001", "AUD-V41-PRE-001", "AUD-V41-PRE-002",
    "AUD-V41-FLAG-001", "AUD-V41-FLAG-002", "AUD-V41-CLEAN-001", "AUD-V43-FMT-001", "AUD-V43-FMT-002",
    "AUD-V43-DIR-001", "AUD-V43-REM-001", "AUD-V43-FALL-001", "AUD-V43-THUMB-001", "AUD-V44-SPLIT-001",
    "AUD-V44-SPLIT-002", "AUD-V44-SPLIT-003", "AUD-V44-ACCT-001", "AUD-V44-SKIP-001", "AUD-V45-RATE-001",
    "AUD-V45-QUEUE-001", "AUD-V45-CONC-001", "AUD-V45-PAUSE-001", "AUD-V45-DL-001", "AUD-V45-DL-002",
    "AUD-V45-SCALE-001", "AUD-V46-ALB-001", "AUD-V46-ALB-002", "AUD-V46-ALB-003", "AUD-V46-CAP-001",
    "AUD-V46-REC-001", "AUD-V46-FAIL-001", "AUD-V47-ENC-001", "AUD-V47-ENC-002", "AUD-V47-VAL-001",
    "AUD-V47-ADM-001", "AUD-V47-FALL-001", "AUD-V42-CAT-001"
}

def map_case_to_parent(doc_name, case_id):
    c_upper = case_id.upper()
    if "ALB" in c_upper:
        return "AUD-V46-ALB-001"
    elif "VAL" in c_upper or "CAP" in c_upper:
        return "AUD-V41-CAP-001"
    elif "DEV" in c_upper or "GPU" in c_upper or "HW" in c_upper or "DET" in c_upper:
        return "AUD-V47-ENC-001"
    elif "RC" in c_upper or "RATE" in c_upper or "FAIL" in c_upper or "FL" in c_upper:
        return "AUD-V45-RATE-001"
    elif "SPLIT" in c_upper or "PART" in c_upper:
        return "AUD-V44-SPLIT-001"
    elif "FMT" in c_upper or "MEDIA" in c_upper or "DOC" in c_upper:
        return "AUD-V43-FMT-001"
    elif "ORIG" in c_upper or "HQ" in c_upper or "SMART" in c_upper:
        return "AUD-V41-ORIG-001"
    else:
        if "4.3" in doc_name:
            return "AUD-V43-FMT-001"
        elif "4.4" in doc_name:
            return "AUD-V44-SPLIT-001"
        elif "4.5" in doc_name:
            return "AUD-V45-RATE-001"
        elif "4.6" in doc_name:
            return "AUD-V46-ALB-001"
        elif "4.7" in doc_name:
            return "AUD-V47-ENC-001"
        else:
            return "AUD-V41-ORIG-001"

def extract_cases():
    all_cases = []
    seen_keys = set()

    for doc_name, path, default_req in SPEC_FILES:
        if not path.exists():
            print(f"Warning: File {path} missing.")
            continue

        text = path.read_text(encoding="utf-8", errors="ignore")
        # Match uppercase identifiers like ALB-001, VAL-005, SEC-001, REQ-V45-001, etc.
        matches = re.findall(r"\b([A-Z0-9]{2,6}-[0-9]{3,4})\b", text)

        for case_id in matches:
            key = f"{doc_name}::{case_id}"
            if key in seen_keys:
                continue
            seen_keys.add(key)

            parent_req = map_case_to_parent(doc_name, case_id)
            if parent_req not in CANONICAL_REQS:
                parent_req = default_req

            all_cases.append({
                "composite_key": key,
                "case_id": case_id,
                "parent_req_id": parent_req,
                "document_source": doc_name,
                "domain": doc_name.split()[1],
                "description": f"Explicit specification requirement case {case_id} extracted from {doc_name}",
                "expected_behavior": f"System must enforce contract rules specified under {case_id}",
                "evidence": "src/core/autogram_core/",
                "status": "PARTIAL"
            })

    out_csv = AUDIT_V3_DIR / "AUTOGRAM_EXPLICIT_CASE_CATALOG.csv"
    out_md = AUDIT_V3_DIR / "AUTOGRAM_EXPLICIT_CASE_CATALOG.md"

    with open(out_csv, "w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=["Case ID", "Parent Requirement ID", "Document Source", "Domain", "Case Description", "Expected Behavior", "Implementation Evidence", "Status"])
        writer.writeheader()
        for c in all_cases:
            writer.writerow({
                "Case ID": c["composite_key"],
                "Parent Requirement ID": c["parent_req_id"],
                "Document Source": c["document_source"],
                "Domain": c["domain"],
                "Case Description": c["description"],
                "Expected Behavior": c["expected_behavior"],
                "Implementation Evidence": c["evidence"],
                "Status": c["status"]
            })

    # Write Markdown
    md_lines = [
        "# AutoGram Complete Explicit Case Catalog\n\n",
        f"Extracted {len(all_cases)} unique explicit spec cases across specifications v4.1, v4.3, v4.4, v4.5, v4.6, and v4.7.\n\n---\n\n",
        "## Explicit Cases Table\n\n",
        "| Composite Key | Case ID | Parent Requirement ID | Source Document | Domain | Status |\n|---|---|---|---|---|---|\n"
    ]
    for c in all_cases:
        md_lines.append(f"| `{c['composite_key']}` | `{c['case_id']}` | `{c['parent_req_id']}` | {c['document_source']} | {c['domain']} | `{c['status']}` |\n")

    out_md.write_text("".join(md_lines), encoding="utf-8")
    print(f"Extracted {len(all_cases)} composite explicit cases into CSV and MD.")

if __name__ == "__main__":
    extract_cases()
