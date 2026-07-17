import asyncio
import random
from telethon.errors import FloodWaitError
import sys

class SmartThrottle:
    """
    Sistem penundaan eksekusi untuk meniru tindakan manusia (Human Behavior Mode) 
    dan menangani batas waktu dari API Telegram.
    """
    def __init__(self, base_delay_min=2.0, base_delay_max=5.0):
        configured_min = max(0.0, float(base_delay_min))
        configured_max = max(configured_min, float(base_delay_max))
        self.configured_delay_min = configured_min
        self.configured_delay_max = configured_max
        self.base_delay_min = configured_min
        self.base_delay_max = configured_max
        self.consecutive_errors = 0
        self.is_paused = False
        
        # Variabel Burst
        self.messages_in_burst = 0
        self.current_burst_limit = 0
        self._set_next_burst_limit("Fast Forward") # Default init

    def _set_next_burst_limit(self, mode: str):
        """Memilih target pesan berikutnya secara acak sebelum istirahat panjang"""
        if mode == "Fast Forward":
            # Forward dibatasi lebih ketat: istirahat setelah 30-55 pesan
            self.current_burst_limit = random.randint(30, 55)
        else:
            # Send/Clone sedikit lebih longgar: istirahat setelah 70-110 pesan
            self.current_burst_limit = random.randint(70, 110)

    async def human_delay(self, mode: str = "Fast Forward", batch_size: int = 1):
        """Tidur dengan durasi acak agar tidak terdeteksi sebagai spam bot. 
        Termasuk istirahat batching cerdas."""
        # 1. Istirahat reguler antar pesan
        delay = random.uniform(self.base_delay_min, self.base_delay_max)
        await asyncio.sleep(delay)
        
        # 2. Logika Burst
        self.messages_in_burst += max(1, int(batch_size or 1))
        
        if self.messages_in_burst >= self.current_burst_limit:
            # Istirahat panjang!
            rest_seconds = random.randint(35, 65)
            print(f"\n[BURST REST] Mencapai {self.messages_in_burst} pesan beruntun. Istirahat sejenak selama {rest_seconds} detik untuk mencegah ban...", flush=True)
            await asyncio.sleep(rest_seconds)
            
            # Reset dan tentukan limit baru secara acak
            self.messages_in_burst = 0
            self._set_next_burst_limit(mode)
            print(f"[BURST REST] Selesai. Melanjutkan tugas dengan batas adaptif berikutnya: {self.current_burst_limit} pesan.\n", flush=True)

    async def handle_flood_wait(self, error: FloodWaitError):
        """Menangani pesan FloodWaitError dari Telegram."""
        wait_seconds = error.seconds
        self.consecutive_errors += 1
        
        print(f"WARNING: FloodWait terdeteksi. Sistem memaksa tidur selama {wait_seconds} detik.", flush=True)
        
        # Tambahkan ekstra waktu acak untuk keamanan
        safe_wait = wait_seconds + random.uniform(2, 5)
        
        # Naikkan batas delay bawaan setiap kali terkena flood wait (Backoff mechanism)
        self.base_delay_min += 1
        self.base_delay_max += 2
        
        await asyncio.sleep(safe_wait)
        print("INFO: Melanjutkan proses setelah FloodWait.", flush=True)

    def reset_health(self):
        """Mereset metrik jika transfer berhasil beruntun."""
        self.consecutive_errors = max(0, self.consecutive_errors - 1)
        if self.consecutive_errors == 0:
            # Decay toward the user's configured baseline. Never jump a fast
            # profile up to the former hard-coded 2-5 second defaults.
            self.base_delay_min = max(
                self.configured_delay_min, self.base_delay_min - 0.5
            )
            self.base_delay_max = max(
                self.configured_delay_max, self.base_delay_max - 0.5
            )
