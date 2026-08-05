import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent.parent
LOG_FILE = ROOT / "docs" / "audit_v3" / "evidence" / "raw" / "cargo_test_list.log"
OUT_FILE = ROOT / "docs" / "audit_v3" / "AUTOGRAM_DISCOVERED_TESTS.json"

def parse_tests():
    if not LOG_FILE.exists():
        print("Log file missing:", LOG_FILE)
        return

    raw_bytes = LOG_FILE.read_bytes()
    if raw_bytes.startswith(b'\xff\xfe') or b'\x00' in raw_bytes[:100]:
        content = raw_bytes.decode("utf-16", errors="ignore")
    else:
        content = raw_bytes.decode("utf-8", errors="ignore")

    unique_tests = []
    seen = set()

    for line in content.splitlines():
        line_str = line.strip()
        if line_str.endswith(": test"):
            test_name = line_str[:-6].strip()
            if test_name and test_name not in seen:
                seen.add(test_name)
                unique_tests.append(test_name)

    data = {
        "discovered_test_count": len(unique_tests),
        "test_names": unique_tests
    }

    with open(OUT_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)

    print(f"Parsed {len(unique_tests)} unique tests into {OUT_FILE}")

if __name__ == "__main__":
    parse_tests()
