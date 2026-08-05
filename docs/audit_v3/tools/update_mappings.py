from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent.parent
TEST_MAP_MD = ROOT / "docs" / "audit_v3" / "AUTOGRAM_TEST_TO_REQUIREMENT_MAP.md"

def update_mappings():
    content = TEST_MAP_MD.read_text(encoding="utf-8")
    
    replacements = [
        ("`binary_volume_split.rs` | `AUD-V44-SPLIT-001`", "`binary_volume_split.rs` | `AUD-V44-SPLIT-001, AUD-V44-SPLIT-002`"),
        ("`hash_util.rs` | `AUD-MST-DUP-002`", "`hash_util.rs` | `AUD-MST-DUP-001, AUD-MST-DUP-002, AUD-MST-DUP-003`"),
        ("`quality.rs` | `AUD-V41-ORIG-003`", "`quality.rs` | `AUD-V41-ORIG-003, AUD-V43-FALL-001`"),
        ("`media_prep.rs` | `AUD-V41-SMART-002`", "`media_prep.rs` | `AUD-V41-SMART-001, AUD-V41-SMART-002`"),
        ("`caption.rs` | `AUD-V46-CAP-001`", "`caption.rs` | `AUD-V46-CAP-001, AUD-V46-FAIL-001`"),
    ]
    
    for old_s, new_s in replacements:
        content = content.replace(old_s, new_s)
        
    TEST_MAP_MD.write_text(content, encoding="utf-8")
    print("Test map mappings updated.")

if __name__ == "__main__":
    update_mappings()
