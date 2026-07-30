import {
  ArrowRightLeft,
  HardDrive,
  Rocket,
  Users,
  ShieldCheck,
  Zap,
  MonitorSmartphone,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { isDesktop, canUseLocalTelegramWorker } from '../../lib/tauri/platform';
import { isMediaStudioAvailable } from '../../lib/tauri/capabilities';

type Props = {
  onNavigate?: (tab: string) => void;
};

export function Dashboard({ onNavigate }: Props) {
  const { t } = useTranslation();
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
          {t('dashboard.subtitle')}
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
          <h3 className="dash-pillar-title">{t('dashboard.forwarder_card_title')}</h3>
          <p className="dash-pillar-desc">
            {t('dashboard.forwarder_card_desc')}
          </p>
          <ul className="dash-pillar-list">
            <li>{t('dashboard.forwarder_step1')}</li>
            <li>{t('dashboard.forwarder_step2')}</li>
            <li>{t('dashboard.forwarder_step3')}</li>
          </ul>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => go('jobs')}
            disabled={!desktop}
          >
            {t('dashboard.open_forwarder')}
          </button>
        </article>

        <article className="dash-pillar glass-panel card">
          <div className="dash-pillar-icon" style={{ background: 'rgba(16,185,129,0.15)' }}>
            <HardDrive size={28} color="#10b981" aria-hidden />
          </div>
          <h3 className="dash-pillar-title">{t('dashboard.drives_card_title')}</h3>
          <p className="dash-pillar-desc">
            {t('dashboard.drives_card_desc')}
          </p>
          <ul className="dash-pillar-list">
            <li>{t('dashboard.drives_step1')}</li>
            <li>{t('dashboard.drives_step2')}</li>
            <li>{t('dashboard.drives_step3')}</li>
          </ul>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => go('media-studio')}
            disabled={!drivesOk}
            title={!drivesOk ? 'Drives hanya di desktop AutoGram' : undefined}
          >
            {t('dashboard.open_drives')}
          </button>
        </article>
      </section>

      <section className="dash-steps glass-panel card" aria-label="Langkah cepat">
        <h3 className="dash-section-title">{t('dashboard.workflow_title')}</h3>
        <ol className="dash-steps-list">
          <li>
            <button type="button" className="dash-step-link" onClick={() => go('accounts')}>
              <Users size={16} aria-hidden /> {t('dashboard.workflow_step1').split(' — ')[0]}
            </button>
            <span> — {t('dashboard.workflow_step1').split(' — ')[1]}</span>
          </li>
          <li>
            <button type="button" className="dash-step-link" onClick={() => go('jobs')}>
              <ArrowRightLeft size={16} aria-hidden /> {t('dashboard.workflow_step2').split(' — ')[0]}
            </button>
            <span> — {t('dashboard.workflow_step2').split(' — ')[1]}</span>
          </li>
          <li>
            <button
              type="button"
              className="dash-step-link"
              onClick={() => go('speedtest')}
              disabled={!drivesOk}
            >
              <HardDrive size={16} aria-hidden /> {t('dashboard.workflow_step3').split(' — ')[0]}
            </button>
            <span> — {t('dashboard.workflow_step3').split(' — ')[1]}</span>
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
