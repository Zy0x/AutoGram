#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
AutoGram Multi-Batch Runner
Menjalankan pengunggahan berulang sebanyak N batch berturut-turut (misal 3 batch x 500 = 1.500 media).
Setiap batch dieksekusi dalam subproses bersih terisolasi.
"""

import sys
import time
import subprocess
from pathlib import Path

def main():
    repo_root = Path(__file__).resolve().parent.parent.parent
    uploader_py = repo_root / "tools" / "upload_donghua" / "upload_donghua.py"

    # Default: 3 batch @ 500 media = 1.500 media
    total_batches = int(sys.argv[1]) if len(sys.argv) > 1 else 3
    batch_limit = int(sys.argv[2]) if len(sys.argv) > 2 else 500
    topic_id = int(sys.argv[3]) if len(sys.argv) > 3 else 8

    print("=" * 80)
    print(f" AUTOGRAM MULTI-BATCH RUNNER: {total_batches} BATCH x {batch_limit} MEDIA (TOTAL: {total_batches * batch_limit})")
    print(f" Target Topik : Donghua NSFW (ID: {topic_id})")
    print("=" * 80 + "\n")

    start_all = time.time()
    for batch_num in range(1, total_batches + 1):
        print(f"\n{'#' * 80}")
        print(f"# MEMULAI BATCH {batch_num}/{total_batches} ({batch_limit} MEDIA)")
        print(f"{'#' * 80}\n")

        cmd = [
            sys.executable,
            "-u",
            str(uploader_py),
            "--topic", str(topic_id),
            "--limit", str(batch_limit)
        ]

        ret = subprocess.run(cmd)
        if ret.returncode != 0:
            print(f"\n[ERROR] Batch {batch_num} gagal dengan return code {ret.returncode}. Menghentikan batch berikutnya.")
            sys.exit(ret.returncode)

        print(f"\n✔ [BATCH {batch_num}/{total_batches} SUKSES]")
        if batch_num < total_batches:
            print("[COOLDOWN] Jeda 3 detik sebelum memulai batch berikutnya...")
            time.sleep(3)

    elapsed = time.time() - start_all
    print("\n" + "=" * 80)
    print(f" SELURUH {total_batches} BATCH (TOTAL {total_batches * batch_limit} MEDIA) SELESAI DALAM {int(elapsed // 60)}m {int(elapsed % 60)}s!")
    print("=" * 80 + "\n")

if __name__ == "__main__":
    main()
