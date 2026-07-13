import os
import sys
import json
import asyncio
from telethon import functions
from core.client import create_client
from engine.forwarder import MigrationForwarder

# Menyimpan konfigurasi aktif
CONFIG = {
    "session_name": "default", # Nama file session (Multi-Account)
    "api_id": "",
    "api_hash": "",
    "source": "",
    "source_name": "",
    "source_topic_id": None,
    "dest": "",
    "dest_name": "",
    "transfer_mode": "Fast Forward",
    "duplicate_action": "Skip",
    "limit": 5,
    "fetch_direction": "Oldest First",
    "throttle": True,
    "media_filter": "Semua", 
    "min_size_mb": 0,
    "max_size_mb": 0, 
    "caption_rule": "Keep Original", 
    "dry_run": False
}

def clear_screen():
    os.system('cls' if os.name == 'nt' else 'clear')

def print_header():
    clear_screen()
    print("==================================================")
    print("   AUTOGRAM MIGRATION PLATFORM - CLI TEST MODE    ")
    print("==================================================")
    print(f" [AKUN AKTIF]  : {CONFIG['session_name']}.session")
    print(f" [API_ID/HASH] : {'[TERISI]' if CONFIG['api_id'] else '[KOSONG -> Fallback ke .env]'}")
    
    src_str = f"{CONFIG['source_name'] or CONFIG['source'] or '[BELUM DISET]'}"
    if CONFIG['source_topic_id']: src_str += f" (Topic: {CONFIG['source_topic_id']})"
    print(f" [SOURCE]      : {src_str}")
    
    print(f" [DESTINATION] : {CONFIG['dest_name'] or CONFIG['dest'] or '[BELUM DISET]'}")
    
    print(f" [MODE]        : {CONFIG['transfer_mode']}")
    print(f" [DUP ACTION]  : {CONFIG['duplicate_action']}")
    print(f" [LIMIT]       : {CONFIG['limit']} pesan ({CONFIG['fetch_direction']})")
    print(f" [THROTTLE]    : {'Aktif' if CONFIG['throttle'] else 'Nonaktif'}")
    print("------------------ ADVANCED ----------------------")
    print(f" [MEDIA FILTER]: {CONFIG['media_filter']}")
    print(f" [SIZE FILTER] : Min {CONFIG['min_size_mb']}MB | Max {CONFIG['max_size_mb'] if CONFIG['max_size_mb'] > 0 else 'Unlimited'}MB")
    print(f" [CAPTION]     : {CONFIG['caption_rule']}")
    print(f" [DRY RUN]     : {'[AKTIF] - SIMULASI SAJA' if CONFIG['dry_run'] else 'TIDAK'}")
    print("==================================================\n")

async def cli_auth_callback(prompt_text: str):
    return input(prompt_text + ": ")

def manage_session():
    """Manajemen Multi-Account / Load Session Telegram."""
    sessions_dir = os.path.join(os.path.dirname(__file__), 'sessions')
    os.makedirs(sessions_dir, exist_ok=True)
    
    files = [f for f in os.listdir(sessions_dir) if f.endswith('.session')]
    
    print("\n--- DAFTAR AKUN TELEGRAM (SESSIONS) ---")
    if files:
        for i, f in enumerate(files):
            print(f"{i+1}. {f}")
    else:
        print("Belum ada sesi yang tersimpan.")
        
    print("\nPilih tindakan:")
    print("A. Ketik ANGKA untuk memuat (Load) akun yang sudah ada.")
    print("B. Ketik NAMA BARU (tanpa spasi) untuk login akun baru.")
    print("C. Kosongkan (Enter) untuk batal.")
    
    choice = input("\nPilihan Anda: ").strip()
    if not choice:
        return
        
    if choice.isdigit() and 1 <= int(choice) <= len(files):
        # Load sesi lama
        selected_file = files[int(choice)-1]
        session_name = selected_file.replace('.session', '')
        CONFIG['session_name'] = session_name
        print(f"\n[SUCCESS] Berhasil berpindah ke akun: {session_name}")
    else:
        # Buat sesi baru
        safe_name = "".join([c for c in choice if c.isalnum() or c in ('_', '-')])
        CONFIG['session_name'] = safe_name
        print(f"\n[INFO] Sesi baru diset ke: {safe_name}. Anda akan diminta OTP saat koneksi pertama.")
    
    # Konfirmasi API
    from dotenv import load_dotenv
    load_dotenv()
    
    if not CONFIG['api_id'] and not os.getenv('API_ID'):
        print("\n* Catatan: API_ID belum diset di memori dan tidak ditemukan di .env.")
        api_ans = input("Ingin input API_ID/HASH manual sekarang? (y/n): ").lower()
        if api_ans == 'y':
            CONFIG['api_id'] = input("Masukkan API_ID: ")
            CONFIG['api_hash'] = input("Masukkan API_HASH: ")
    
    input("Tekan Enter untuk kembali...")

async def interactive_entity_picker(client, target_type="source"):
    """Fungsi pembantu untuk mencari dan memilih grup/channel serta topic secara visual."""
    keyword = input(f"\nMasukkan kata kunci pencarian untuk {target_type.upper()} (kosongkan untuk tampilkan 30 terbaru): ").strip().lower()
    
    print("Mencari percakapan...")
    dialogs = []
    async for dialog in client.iter_dialogs():
        if keyword in dialog.name.lower():
            dialogs.append(dialog)
        if len(dialogs) >= 30 and not keyword:
            break
            
    if not dialogs:
        print("Tidak ada grup/channel yang ditemukan dengan kata kunci tersebut.")
        input("Tekan Enter untuk kembali...")
        return

    print(f"\n--- HASIL PENCARIAN {target_type.upper()} ---")
    for i, d in enumerate(dialogs):
        print(f"{i+1}. {d.name} (ID: {d.id})")
        
    choice = input("\nPilih nomor (0 untuk batal): ")
    if not choice.isdigit() or int(choice) < 1 or int(choice) > len(dialogs):
        return
        
    selected = dialogs[int(choice)-1]
    entity_id = str(selected.id)
    entity_name = selected.name
    topic_id = None
    
    # Deteksi Forum Topic
    is_forum = getattr(selected.entity, "forum", False)
    if is_forum:
        print(f"\n[INFO] {entity_name} adalah Forum Group. Mencari topik...")
        try:
            result = await client(functions.messages.GetForumTopicsRequest(
                peer=selected.entity,
                offset_date=None,
                offset_id=0,
                offset_topic=0,
                limit=100
            ))
            if result.topics:
                print("\n--- DAFTAR TOPIK ---")
                print("0. Ambil dari seluruh grup (Bukan dari spesifik topik)")
                for i, t in enumerate(result.topics):
                    print(f"{i+1}. {t.title} (ID: {t.id})")
                    
                t_choice = input("\nPilih nomor topik (0 untuk seluruh grup): ")
                if t_choice.isdigit() and int(t_choice) > 0 and int(t_choice) <= len(result.topics):
                    topic_id = result.topics[int(t_choice)-1].id
        except Exception as e:
            print(f"Gagal mengambil topik: {e}")

    # Simpan ke config
    if target_type == "source":
        CONFIG['source'] = entity_id
        CONFIG['source_name'] = entity_name
        CONFIG['source_topic_id'] = topic_id
    else:
        CONFIG['dest'] = entity_id
        CONFIG['dest_name'] = entity_name
    
    print(f"\n[BERHASIL] {target_type.upper()} telah diset ke: {entity_name} {f'(Topic ID: {topic_id})' if topic_id else ''}")
    input("Tekan Enter untuk lanjut...")

async def setup_entities():
    try:
        client = await create_client(
            session_name=CONFIG['session_name'],
            api_id_arg=CONFIG['api_id'],
            api_hash_arg=CONFIG['api_hash'],
            phone_callback=lambda: cli_auth_callback("Masukkan Nomor HP"),
            code_callback=lambda: cli_auth_callback("Masukkan OTP"),
            password_callback=lambda: cli_auth_callback("Masukkan 2FA")
        )
    except Exception as e:
        print(f"\n[ERROR] Gagal login ke Telegram: {e}")
        input("Tekan Enter untuk kembali...")
        return
        
    print("\n1. Atur Source (Grup Asal)")
    print("2. Atur Destination (Channel Tujuan)")
    c = input("Pilihan: ")
    if c == '1':
        await interactive_entity_picker(client, "source")
    elif c == '2':
        await interactive_entity_picker(client, "dest")
        
    await client.disconnect()

def save_profile():
    profiles_dir = os.path.join(os.path.dirname(__file__), 'profiles')
    os.makedirs(profiles_dir, exist_ok=True)
    filename = input("\nMasukkan nama file untuk menyimpan profil (contoh: backup_kuliah): ").strip()
    if not filename:
        return
    if not filename.endswith('.json'):
        filename += '.json'
    
    filepath = os.path.join(profiles_dir, filename)
    with open(filepath, 'w') as f:
        json.dump(CONFIG, f, indent=4)
    print(f"\n[SUCCESS] Profil berhasil disimpan di {filepath}")
    input("Tekan Enter untuk kembali...")

def load_profile():
    profiles_dir = os.path.join(os.path.dirname(__file__), 'profiles')
    if not os.path.exists(profiles_dir):
        print("\nBelum ada profil yang tersimpan.")
        input("Tekan Enter untuk kembali...")
        return
        
    files = [f for f in os.listdir(profiles_dir) if f.endswith('.json')]
    if not files:
        print("\nBelum ada profil yang tersimpan.")
        input("Tekan Enter untuk kembali...")
        return
        
    print("\n--- DAFTAR PROFIL ---")
    for i, f in enumerate(files):
        print(f"{i+1}. {f}")
        
    choice = input("\nPilih profil yang ingin dimuat: ")
    if choice.isdigit() and 1 <= int(choice) <= len(files):
        filepath = os.path.join(profiles_dir, files[int(choice)-1])
        try:
            with open(filepath, 'r') as f:
                global CONFIG
                loaded_config = json.load(f)
                CONFIG.update(loaded_config)
            print(f"\n[SUCCESS] Profil '{files[int(choice)-1]}' berhasil dimuat!")
        except Exception as e:
            print(f"\n[ERROR] Gagal memuat profil: {e}")
    input("Tekan Enter untuk kembali...")

async def execute_migration():
    if not CONFIG['source'] or (not CONFIG['dest'] and not CONFIG['dry_run']):
        print("\n[ERROR] Source/Destination belum lengkap!")
        input("Tekan Enter untuk kembali...")
        return

    print("\n>>> MEMULAI PROSES", "SIMULASI" if CONFIG['dry_run'] else "MIGRASI", "...")
    
    try:
        client = await create_client(
            session_name=CONFIG['session_name'],
            api_id_arg=CONFIG['api_id'],
            api_hash_arg=CONFIG['api_hash'],
            phone_callback=lambda: cli_auth_callback("Masukkan Nomor HP"),
            code_callback=lambda: cli_auth_callback("Masukkan OTP"),
            password_callback=lambda: cli_auth_callback("Masukkan 2FA")
        )
    except Exception as e:
        print(f"\n[ERROR] Gagal login: {e}")
        input("Tekan Enter untuk kembali...")
        return
        
    source_id = int(CONFIG['source']) if str(CONFIG['source']).lstrip('-').isdigit() else CONFIG['source']
    dest_id = int(CONFIG['dest']) if str(CONFIG['dest']).lstrip('-').isdigit() else CONFIG['dest']
    forwarder = MigrationForwarder(client, source_id, dest_id, job_id=1, config=CONFIG)
    
    if not CONFIG['throttle']:
        forwarder.throttle.base_delay_min = 0
        forwarder.throttle.base_delay_max = 0

    await forwarder.execute_migration(limit=int(CONFIG['limit']))

    await client.disconnect()
    print("\n[SUCCESS] Eksekusi selesai. Klien telah diputus.")
    input("Tekan Enter untuk kembali ke Menu Utama...")

async def main_loop():
    while True:
        print_header()
        print("Menu Navigasi:")
        print("1. Manajemen Akun Telegram (Ganti / Load Session)")
        print("2. Set Source & Destination (Interactive Auto-Discovery)")
        print("3. Ubah Transfer Mode")
        print("4. Ubah Duplicate Action")
        print("5. Ubah Pengaturan Media Filter")
        print("6. Ubah Ukuran File (Size Filter)")
        print("7. Ubah Aturan Caption (Metadata)")
        print("8. Toggle Dry Run (Mode Simulasi)")
        print("9. Ubah Pengaturan Keamanan (Throttle & Limit)")
        print("10. Simpan Profil Saat Ini (Save Profile)")
        print("11. Muat Profil Tersimpan (Load Profile)")
        print("12. >> MULAI EKSEKUSI <<")
        print("0. Keluar")
        
        choice = input("\nPilih Menu (0-12): ")
        
        if choice == '1':
            manage_session()
        elif choice == '2':
            await setup_entities()
        elif choice == '3':
            modes = ["Fast Forward", "Clean Copy"]
            for i, m in enumerate(modes): print(f"{i+1}. {m}")
            idx = input("Pilihan: ")
            if idx.isdigit() and 1 <= int(idx) <= len(modes): CONFIG['transfer_mode'] = modes[int(idx)-1]
        elif choice == '4':
            actions = ["Skip", "Rename", "Replace", "Keep Both", "Ask User"]
            for i, a in enumerate(actions): print(f"{i+1}. {a}")
            idx = input("Pilihan: ")
            if idx.isdigit() and 1 <= int(idx) <= len(actions): CONFIG['duplicate_action'] = actions[int(idx)-1]
        elif choice == '5':
            filters = ["Semua", "Foto", "Video", "Dokumen", "Audio"]
            for i, f in enumerate(filters): print(f"{i+1}. {f}")
            idx = input("Pilihan: ")
            if idx.isdigit() and 1 <= int(idx) <= len(filters): CONFIG['media_filter'] = filters[int(idx)-1]
        elif choice == '6':
            min_mb = input("Minimal Size (MB) [0 untuk lewati]: ")
            max_mb = input("Maksimal Size (MB) [0 untuk unlimited]: ")
            if min_mb.isdigit(): CONFIG['min_size_mb'] = int(min_mb)
            if max_mb.isdigit(): CONFIG['max_size_mb'] = int(max_mb)
        elif choice == '7':
            caps = ["Keep Original", "Remove Caption", "Strip Links (Hapus URL)", "Custom Text"]
            for i, c in enumerate(caps): print(f"{i+1}. {c}")
            idx = input("Pilihan: ")
            if idx.isdigit() and 1 <= int(idx) <= len(caps):
                selected_cap = caps[int(idx)-1]
                if selected_cap == "Custom Text":
                    custom_text = input("Masukkan teks caption kustom: ")
                    CONFIG['caption_rule'] = f"Custom:{custom_text}"
                else:
                    CONFIG['caption_rule'] = selected_cap
        elif choice == '8':
            CONFIG['dry_run'] = not CONFIG['dry_run']
        elif choice == '9':
            limit = input("Batas pesan (default 5): ")
            if limit.isdigit(): CONFIG['limit'] = int(limit)
            
            print("\nArah Scan (Fetch Direction):")
            dirs = ["Terlama (Oldest First)", "Terbaru (Newest First)"]
            for i, d in enumerate(dirs): print(f"{i+1}. {d}")
            dir_choice = input("Pilihan: ")
            if dir_choice == '1': CONFIG['fetch_direction'] = "Oldest First"
            elif dir_choice == '2': CONFIG['fetch_direction'] = "Newest First"
            
            thr = input("Aktifkan Smart Throttle? (y/n): ")
            CONFIG['throttle'] = (thr.lower() == 'y')
        elif choice == '10':
            save_profile()
        elif choice == '11':
            load_profile()
        elif choice == '12':
            await execute_migration()
        elif choice == '0':
            sys.exit(0)

if __name__ == "__main__":
    try:
        asyncio.run(main_loop())
    except KeyboardInterrupt:
        sys.exit(0)
