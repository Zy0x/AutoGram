import { RefreshCw, Play, AlertTriangle } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export function Sync() {
  const { t } = useTranslation();

  return (
    <main className="main-content page-stack">
      <header className="page-header">
        <h2 className="title title-with-icon">
          <RefreshCw size={28} color="var(--primary)" aria-hidden />
          {t('sync.title')}
        </h2>
        <p className="subtitle">
          {t('sync.subtitle')}
        </p>
      </header>

      <div className="glass-panel card empty-state-panel">
        <AlertTriangle size={48} color="var(--warning)" style={{ marginBottom: '1.25rem', opacity: 0.8 }} />
        <h3 style={{ fontSize: 'var(--fs-xl)', marginBottom: '1rem' }}>{t('sync.dev_title')}</h3>
        <p>
          {t('sync.dev_desc')}
        </p>
        <button type="button" className="btn btn-primary" disabled>
          <Play size={18} />
          {t('sync.coming_soon_btn')}
        </button>
      </div>
    </main>
  );
}
