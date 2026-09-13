import { lazy, Suspense, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Network, Loader2 } from 'lucide-react';

const Workspace = lazy(() => import('./components/CrawlerWorkspace').then(module => ({ default: module.CrawlerWorkspace })));

export function RemoteCrawlerLauncher({ initialUrl, onUseLinks, disabled = false }: {
  initialUrl?: string; onUseLinks: (urls: string[]) => void; disabled?: boolean;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return <>
    <button type="button" className="td-remote-crawler-btn" disabled={disabled} onClick={() => setOpen(true)}>
      <Network size={15} aria-hidden="true" />
      <span>{t('crawler.launch')}</span>
    </button>
    {open && <Suspense fallback={<span role="status"><Loader2 size={18} className="spin" />{t('crawler.working')}</span>}>
      <Workspace initialUrl={initialUrl} onClose={() => setOpen(false)} onUseLinks={urls => { onUseLinks(urls); setOpen(false); }} />
    </Suspense>}
  </>;
}
