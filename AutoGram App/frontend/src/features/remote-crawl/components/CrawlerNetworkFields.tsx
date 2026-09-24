import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { DEFAULT_CRAWL_REQUEST, type CrawlNetworkOptions } from '../domain/types';

interface Props {
  value?: CrawlNetworkOptions;
  headersText: string;
  rulesText: string;
  onChange: (value: CrawlNetworkOptions) => void;
  onHeadersChange: (value: string) => void;
  onRulesChange: (value: string) => void;
}

export function CrawlerNetworkFields({ value, headersText, rulesText, onChange, onHeadersChange, onRulesChange }: Props) {
  const { t } = useTranslation();
  const id = useId();
  const network = value || DEFAULT_CRAWL_REQUEST.network!;
  const patch = (next: Partial<CrawlNetworkOptions>) => onChange({ ...network, ...next });
  return <div className="crawler-fields">
    <label className="crawler-field" htmlFor={`${id}-agent`}><span>{t('crawler.userAgent')}</span>
      <input id={`${id}-agent`} value={network.userAgent} maxLength={512} required onChange={event => patch({ userAgent: event.target.value })} /></label>
    <label className="crawler-field" htmlFor={`${id}-proxy`}><span>{t('crawler.proxy')}</span>
      <input id={`${id}-proxy`} value={network.proxyUrl} maxLength={4096} placeholder={t('crawler.placeholder_proxy')}
        onChange={event => patch({ proxyUrl: event.target.value })} /></label>
    <p className="crawler-hint">{t('crawler.proxy_hint')}</p>
    <div className="crawler-limit-grid">
      {(['timeoutSeconds', 'retries'] as const).map(key => <label key={key} className="crawler-field" htmlFor={`${id}-${key}`}>
        <span>{t(`crawler.${key}`)}</span><input id={`${id}-${key}`} type="number" step={1} required
          min={key === 'retries' ? 0 : 5} max={key === 'retries' ? 5 : 120}
          value={Number.isNaN(network[key]) ? '' : network[key]} onChange={event => patch({ [key]: event.target.valueAsNumber })} />
      </label>)}
    </div>
    <label className="crawler-field" htmlFor={`${id}-headers`}><span>{t('crawler.headers')}</span>
      <textarea id={`${id}-headers`} value={headersText} rows={3} maxLength={12000} spellCheck={false}
        placeholder={t('crawler.placeholder_headers')} onChange={event => onHeadersChange(event.target.value)} /></label>
    <p className="crawler-hint">{t('crawler.headers_hint')}</p>
    <label className="crawler-field" htmlFor={`${id}-rules`}><span>{t('crawler.rules')}</span>
      <textarea id={`${id}-rules`} value={rulesText} rows={4} maxLength={12000} spellCheck={false}
        placeholder={t('crawler.placeholder_rules')} onChange={event => onRulesChange(event.target.value)} /></label>
    <p className="crawler-hint">{t('crawler.rules_hint')}</p>
  </div>;
}
