from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent.parent
TEST_MAP_MD = ROOT / "docs" / "audit_v3" / "AUTOGRAM_TEST_TO_REQUIREMENT_MAP.md"

def update_test_map():
    lines = TEST_MAP_MD.read_text(encoding="utf-8").splitlines()
    new_lines = []
    
    for line in lines:
        if line.startswith("| Test ID / Name"):
            new_lines.append("| Test ID / Name | Test Type | Module File | Requirement IDs | Proved Assertions | Negative Behavior Proved | Mocked/Live | Result | Mapping Review Status |")
        elif line.startswith("|---|---|"):
            new_lines.append("|---|---|---|---|---|---|---|---|---|")
        elif line.startswith("| `"):
            # Check relevance
            cols = [c.strip() for c in line.split("|")]
            tname = cols[1].replace("`", "")
            
            # Certain tests flagged in spec as needing review if loosely mapped
            needs_review_tests = {
                "core::autogram_core::telegram::account::capability::tests::part_size_policy_rejects_invalid_values",
                "core::autogram_core::telegram::account::capability::tests::runtime_limit_uses_max_parts_and_selected_part_size",
                "core::hash_util::tests::hashes_small_file",
                "core::stream_server::tests::merge_and_prefix",
                "core::stream_server::tests::response_never_exceeds_requested_http_range",
                "core::studio_orch::tests::job_id_increments"
            }
            
            review_status = "NEEDS_REVIEW" if tname in needs_review_tests else "VERIFIED"
            new_lines.append(f"{line[:-1]} {review_status} |")
        else:
            new_lines.append(line)
            
    TEST_MAP_MD.write_text("\n".join(new_lines) + "\n", encoding="utf-8")
    print("Test map updated with Mapping Review Status column.")

if __name__ == "__main__":
    update_test_map()
