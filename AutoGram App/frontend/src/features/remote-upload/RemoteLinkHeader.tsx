import { Link2, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { RemoteCrawlerLauncher } from '../remote-crawl';

export function RemoteLinkHeader({ url, submitting, onClose, onUseLinks }: {
  url: string; submitting: boolean; onClose: () => void; onUseLinks: (urls: string[]) => void;
}) {
  const { t } = useTranslation();
  return <header className="td-confirm-head" style={{ flexWrap: 'wrap' }}>
    <span className="td-confirm-icon input td-remote-head-icon" aria-hidden><Link2 size={20} strokeWidth={2.25} /></span>
    <div className="td-confirm-head-text">
      <h2>{t('drive.remote_upload_url_title')}</h2>
      <p className="td-confirm-desc">{t('drive.remote_upload_url_subtitle')}</p>
    </div>
    <RemoteCrawlerLauncher initialUrl={url} disabled={submitting} onUseLinks={onUseLinks} />
    <button type="button" className="td-confirm-close" onClick={onClose} disabled={submitting} aria-label={t('drive.preview_close_btn')}>
      <X size={18} />
    </button>
  </header>;
}
