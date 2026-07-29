import {
  ArrowRightLeft,
  HardDrive,
  Rocket,
  Users,
  ShieldCheck,
  Zap,
  MonitorSmartphone,
} from 'lucide-react';
import { isDesktop, canUseLocalTelegramWorker } from '../lib/platform';
import { isMediaStudioAvailable } from '../lib/capabilities';

type Props = {
  onNavigate?: (tab: string) => void;
};

/**
 * Product hub — two clear parallel workspaces:
 * - Forwarder: migration / clean-copy jobs (Jobs workspace)
 * - Drives: Media Studio browse / preview / transfer
 *
 * Both may use the same Telegram session concurrently via Grammers
 * shared pool + session_guard (not exclusive dual-open).
 */
export function Dashboard({ onNavigate }: Props) {
  const desktop = isDesktop() && canUseLocalTelegramWorker();
  const drivesOk = isMediaStudioAvailable();
  const go = (tab: string) => onNavigate?.(tab);

  return (
    <main className="main-content page-stack">
      <header className="page-header">
        <h2 className="title title-with-icon">
          <Rocket size={24} color="var(--primary)" aria-hidden />
          AutoGram
        </h2>
        <p className="subtitle">
          Platform migrasi &amp; drive Telegram berbasis Rust. Dua jalur kerja jelas — bisa jalan
          paralel tanpa saling merebut session.
        </p>
      </header>

      {!desktop && (
        <div className="card glass-panel status-hero">
          <MonitorSmartphone size={32} color="var(--accent)" className="status-hero-icon" aria-hidden />
          <div className="status-hero-body">
            <h3>Mode Browser</h3>
            <p>
              UI pratinjau saja. Forwarder, Drives, dan Accounts penuh membutuhkan aplikasi desktop
              AutoGram (Tauri).
            </p>
          </div>
        </div>
      )}

      <section className="dash-pillars" aria-label="Jalur kerja utama">
        <article className="dash-pillar glass-panel card">
          <div className="dash-pillar-icon" style={{ background: 'rgba(59,130,246,0.15)' }}>
            <ArrowRightLeft size={28} color="var(--primary)" aria-hidden />
          </div>
          <h3 className="dash-pillar-title">Forwarder</h3>
          <p className="dash-pillar-desc">
            Migrasi chat → chat: <strong>Forward</strong> cepat atau <strong>Clean Copy</strong>{' '}
            (download + re-upload, dedupe 4 level, resume, FloodWait). Cocok untuk job panjang di
            latar.
          </p>
          <ul className="dash-pillar-list">
            <li>Pilih akun aktif di Accounts</li>
            <li>Buat job sumber → tujuan</li>
            <li>Jalankan &amp; pantau progres / resume</li>
          </ul>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => go('jobs')}
            disabled={!desktop}
          >
            Buka Forwarder
          </button>
        </article>

        <article className="dash-pillar glass-panel card">
          <div className="dash-pillar-icon" style={{ background: 'rgba(16,185,129,0.15)' }}>
            <HardDrive size={28} color="#10b981" aria-hidden />
          </div>
          <h3 className="dash-pillar-title">Drives</h3>
          <p className="dash-pillar-desc">
            Media Studio: jelajah chat, folder [TD], preview video/foto/dokumen, upload &amp;
            download. Dirancang cepat dan bisa ganti akun multi-active.
          </p>
          <ul className="dash-pillar-list">
            <li>Browse &amp; cari media</li>
            <li>Preview instan (stream progressive)</li>
            <li>Transfer lokal / remote URL</li>
          </ul>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => go('media-studio')}
            disabled={!drivesOk}
            title={!drivesOk ? 'Drives hanya di desktop AutoGram' : undefined}
          >
            Buka Drives
          </button>
        </article>
      </section>

      <section className="dash-steps glass-panel card" aria-label="Langkah cepat">
        <h3 className="dash-section-title">Alur singkat (3 langkah)</h3>
        <ol className="dash-steps-list">
          <li>
            <button type="button" className="dash-step-link" onClick={() => go('accounts')}>
              <Users size={16} aria-hidden /> 1. Hubungkan akun
            </button>
            <span> — login Grammers, aktifkan 1+ akun untuk switch cepat.</span>
          </li>
          <li>
            <button type="button" className="dash-step-link" onClick={() => go('jobs')}>
              <ArrowRightLeft size={16} aria-hidden /> 2. Forwarder
            </button>
            <span> — job migrasi (forward / clean copy) antar chat.</span>
          </li>
          <li>
            <button
              type="button"
              className="dash-step-link"
              onClick={() => go('speedtest')}
              disabled={!drivesOk}
            >
              <HardDrive size={16} aria-hidden /> 3. Drives
            </button>
            <span> — kelola media, preview, upload/download.</span>
          </li>
        </ol>
      </section>

      <section className="dash-safety glass-panel card" aria-label="Parallel safety">
        <h3 className="dash-section-title title-with-icon">
          <ShieldCheck size={18} color="var(--primary)" aria-hidden />
          Kerja paralel aman
        </h3>
        <div className="dash-safety-grid">
          <div>
            <Zap size={16} aria-hidden /> <strong>Satu pool Grammers per akun</strong>
            <p>Forwarder &amp; Drives berbagi koneksi MTProto yang sama — tidak dual-open Telethon.</p>
          </div>
          <div>
            <ShieldCheck size={16} aria-hidden /> <strong>Session guard</strong>
            <p>
              Migration / transfer / studio memakai lease <em>shared</em>. Operasi exclusive (login
              hapus session) menunggu giliran.
            </p>
          </div>
          <div>
            <HardDrive size={16} aria-hidden /> <strong>Ganti akun di Drives</strong>
            <p>UI di-wipe + gen guard agar data akun lama tidak bocor ke akun baru.</p>
          </div>
        </div>
      </section>
    </main>
  );
}
