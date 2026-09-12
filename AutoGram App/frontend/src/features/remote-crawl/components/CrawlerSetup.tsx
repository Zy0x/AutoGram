import { useId, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowRight, Globe2, List, Braces, ShieldCheck } from 'lucide-react';
import { CRAWL_KINDS, DEFAULT_CRAWL_REQUEST, MAX_LINKS, type CrawlEntry, type CrawlRequest } from '../domain/types';
import { generatePattern, parseLinkText, validateCrawlRequest } from '../domain/links';

type Mode = 'website' | 'list' | 'pattern';
interface Props {
  initialUrl?: string;
  busy: boolean;
  crawlActive?: boolean;
  onStart: (request: CrawlRequest, name: string) => Promise<void>;
  onBatch: (name: string, entries: CrawlEntry[]) => void;
  onError: (error: unknown) => void;
}

export function CrawlerSetup({ initialUrl = '', busy, crawlActive = false, onStart, onBatch, onError }: Props) {
  const { t } = useTranslation();
  const id = useId();
  const [mode, setMode] = useState<Mode>('website');
  const [name, setName] = useState('');
  const [inputs, setInputs] = useState({ website: initialUrl, list: initialUrl, pattern: '' });
  const [request, setRequest] = useState<CrawlRequest>({ ...DEFAULT_CRAWL_REQUEST, kinds: [...DEFAULT_CRAWL_REQUEST.kinds] });
  const [rulesText, setRulesText] = useState('');
  const modes = [{ value: 'website', icon: Globe2 }, { value: 'list', icon: List }, { value: 'pattern', icon: Braces }] as const;
  const limits = [
    { key: 'maxDepth', min: 0, max: 8, step: 1 },
    { key: 'maxPages', min: 1, max: 500, step: 1 },
    { key: 'maxResults', min: 1, max: MAX_LINKS, step: 1 },
    { key: 'concurrency', min: 1, max: 4, step: 1 },
    { key: 'delayMs', min: 250, max: 10000, step: 1 },
  ] as const;

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    try {
      const batchName = name.trim() || t(`crawler.default_name_${mode}`);
      if (mode === 'website') {
        if (!request.kinds.length) throw new Error('crawler.select_kind');
        // Validate expressions before asking the native crawler to start.
        if (request.includePattern) new RegExp(request.includePattern);
        if (request.excludePattern) new RegExp(request.excludePattern);
        if (request.selector) document.createDocumentFragment().querySelector(request.selector);
        const seeds = parseLinkText(inputs.website).map(entry => entry.url);
        if (seeds.length > 32) throw new Error('invalid_seeds');
        let rules = [];
        if (rulesText.trim()) { try { rules = JSON.parse(rulesText); } catch { throw new Error('crawler.invalid_rules'); } }
        await onStart(validateCrawlRequest({ ...request, seeds, rules, respectRobots: true }), batchName);
      } else {
        const entries = mode === 'pattern' ? generatePattern(inputs.pattern) : parseLinkText(inputs.list);
        if (!entries.length) throw new Error('crawler.empty_input');
        onBatch(batchName, entries);
      }
    } catch (error) {
      onError(error instanceof SyntaxError || (error instanceof DOMException && error.name === 'SyntaxError')
        ? new Error('crawler.invalid_filter') : error);
    }
  };

  return <form className="crawler-setup" onSubmit={event => { void submit(event); }}>
    <fieldset className="crawler-modes" disabled={busy}>
      <legend className="crawler-sr-only">{t('crawler.mode_label')}</legend>
      {modes.map(({ value, icon: Icon }) => <label key={value} className={mode === value ? 'is-active' : ''}>
        <input type="radio" name={`${id}-mode`} value={value} checked={mode === value} onChange={() => setMode(value)} />
        <Icon size={17} aria-hidden="true" /><span>{t(`crawler.mode_${value}`)}</span>
      </label>)}
    </fieldset>
    <fieldset className="crawler-fields" disabled={busy}>
      <label className="crawler-field" htmlFor={`${id}-name`}>
        <span>{t('crawler.name')}</span>
        <input id={`${id}-name`} value={name} maxLength={120} onChange={event => setName(event.target.value)}
          placeholder={t(`crawler.default_name_${mode}`)} autoComplete="off" />
      </label>
      <label className="crawler-field" htmlFor={`${id}-input`}>
        <span>{t(`crawler.input_${mode}`)}</span>
        <textarea id={`${id}-input`} value={inputs[mode]} rows={mode === 'pattern' ? 3 : 4} required
          maxLength={4 * 1024 * 1024} spellCheck={false} autoComplete="off" autoCapitalize="none"
          placeholder={t(`crawler.placeholder_${mode}`)} aria-describedby={`${id}-hint`}
          onChange={event => setInputs(current => ({ ...current, [mode]: event.target.value }))} />
      </label>
      <p id={`${id}-hint`} className="crawler-hint">{t(`crawler.hint_${mode}`)}</p>
      {mode === 'website' && <details className="crawler-advanced">
        <summary>{t('crawler.advanced')}</summary>
        <div className="crawler-limit-grid">
          {limits.map(({ key, min, max, step }) => <label key={key} className="crawler-field" htmlFor={`${id}-${key}`}>
            <span>{t(`crawler.${key}`)}</span>
            <input id={`${id}-${key}`} type="number" inputMode="numeric" min={min} max={max} step={step} required
              value={Number.isNaN(request[key]) ? '' : request[key]}
              onChange={event => setRequest(current => ({ ...current, [key]: event.target.valueAsNumber }))} />
          </label>)}
        </div>
        <label className="crawler-check"><input type="checkbox" checked={request.sameOrigin}
          onChange={event => setRequest(current => ({ ...current, sameOrigin: event.target.checked }))} />
          <span>{t('crawler.sameOrigin')}</span></label>
        <label className="crawler-check"><input type="checkbox" checked={request.directoryMode === true}
          onChange={event => setRequest(current => ({ ...current, directoryMode: event.target.checked }))} />
          <span>{t('crawler.directoryMode')}</span></label>
        <label className="crawler-field" htmlFor={`${id}-user-agent`}><span>{t('crawler.userAgent')}</span>
          <input id={`${id}-user-agent`} value={request.network?.userAgent || ''} maxLength={512}
            onChange={event => setRequest(current => ({ ...current, network: { ...DEFAULT_CRAWL_REQUEST.network!, ...current.network, userAgent: event.target.value } }))} /></label>
        <label className="crawler-field" htmlFor={`${id}-proxy`}><span>{t('crawler.proxy')}</span>
          <input id={`${id}-proxy`} value={request.network?.proxyUrl || ''} placeholder={t('crawler.placeholder_proxy')}
            onChange={event => setRequest(current => ({ ...current, network: { ...DEFAULT_CRAWL_REQUEST.network!, ...current.network, proxyUrl: event.target.value } }))} /></label>
        <label className="crawler-field" htmlFor={`${id}-rules`}><span>{t('crawler.rules')}</span>
          <textarea id={`${id}-rules`} value={rulesText} rows={3} maxLength={12000} spellCheck={false}
            placeholder={t('crawler.placeholder_rules')} onChange={event => setRulesText(event.target.value)} /></label>
        <fieldset className="crawler-kinds"><legend>{t('crawler.kinds')}</legend>
          {CRAWL_KINDS.map(kind => <label className="crawler-check" key={kind}>
            <input type="checkbox" checked={request.kinds.includes(kind)} onChange={event => setRequest(current => ({
              ...current, kinds: event.target.checked ? [...current.kinds, kind] : current.kinds.filter(item => item !== kind),
            }))} /><span>{t(`crawler.kind_${kind}`)}</span>
          </label>)}
        </fieldset>
        {(['selector', 'includePattern', 'excludePattern'] as const).map(key => <label key={key} className="crawler-field" htmlFor={`${id}-${key}`}>
          <span>{t(`crawler.${key}`)}</span>
          <input id={`${id}-${key}`} value={request[key]} maxLength={500} spellCheck={false} autoComplete="off"
            placeholder={t(`crawler.placeholder_${key}`)} onChange={event => setRequest(current => ({ ...current, [key]: event.target.value }))} />
        </label>)}
      </details>}
      {mode === 'website' && <p className="crawler-policy"><ShieldCheck size={16} aria-hidden="true" />{t('crawler.robots')}</p>}
      {mode === 'website' && crawlActive && <p className="crawler-hint">{t('crawler.queue_hint')}</p>}
      <button className="crawler-primary crawler-start" type="submit" disabled={busy || !inputs[mode].trim()}>
        {t(busy ? 'crawler.working' : `crawler.start_${mode}`)}<ArrowRight size={17} aria-hidden="true" />
      </button>
    </fieldset>
  </form>;
}
