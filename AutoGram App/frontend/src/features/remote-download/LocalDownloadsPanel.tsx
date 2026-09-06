import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Download, Pause, Play, Square, X, ChevronDown, ChevronUp } from 'lucide-react';
import { formatDriveBytes } from '../../lib/telegram/driveTypes';
import { controlLocalDownload, isLocalDownloadTerminal, refreshLocalDownloads, useLocalDownloads } from './service';
import './localDownloads.css';

export function LocalDownloadsPanel() {
  const { t } = useTranslation();
  const { jobs, hidden, error } = useLocalDownloads();
  const [minimized, setMinimized] = useState(false);
  const [speed, setSpeed] = useState(0);
  const sample = useRef({ at: performance.now(), bytes: 0 });
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try { await refreshLocalDownloads(); } catch {
        // Start reports missing commands explicitly on an old desktop binary.
      }
      if (!stopped) timer = setTimeout(poll, 700);
    }
    void poll();
    return () => { stopped = true; clearTimeout(timer); };
  }, []);
  const bytes = jobs.reduce((n, j) => n + j.downloaded, 0);
  useEffect(() => {
    const now = performance.now();
    setSpeed(Math.max(0, (bytes - sample.current.bytes) * 1000 / Math.max(1, now - sample.current.at)));
    sample.current = { at: now, bytes };
  }, [jobs, bytes]);
  if (hidden || !jobs.length) return null;
  const active = jobs.some(j => !isLocalDownloadTerminal(j.state));
  return <section className="local-download-panel" aria-label={t('drive_tools.local_download_title')}>
    <header>
      <Download size={20} /><strong>{t('drive_tools.local_download_title')}</strong>
      <button type="button" aria-label={t('drive_tools.local_download_toggle')} onClick={() => setMinimized(!minimized)}>
        {minimized ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
      </button>
      {!active && <button type="button" aria-label={t('common.close')} onClick={() => useLocalDownloads.setState({ hidden: true })}><X size={18} /></button>}
    </header>
    {!minimized && <>
      <p>{t('drive_tools.local_download_isolated')}</p>
      <p>{formatDriveBytes(bytes)} · {t('drive_tools.local_download_speed', { speed: formatDriveBytes(active ? speed : 0) })}</p>
      {error && <p role="alert">{t('drive_tools.local_download_control_error')}</p>}
      <div className="local-download-items">
        {jobs.map(job => {
          const terminal = isLocalDownloadTerminal(job.state);
          return <article key={job.id}>
            <strong title={job.filename}>{job.filename}</strong><small title={job.directory}>{job.directory}</small>
            <span>{t(`drive_tools.local_download_state_${job.state}`)}
              {!terminal && job.phase !== 'download' && ` · ${t(`drive_tools.local_download_phase_${job.phase}`)}`}</span>
            <progress max={job.total || 1} value={job.state === 'done' ? job.total || 1 : job.total ? Math.min(job.downloaded, job.total) : undefined} />
            <small>{job.state === 'done' ? formatDriveBytes(job.outputBytes) : `${formatDriveBytes(job.downloaded)} / ${job.total ? formatDriveBytes(job.total) : t('drive_tools.local_download_unknown')}`}</small>
            {job.error && <p role="alert">{t(`drive_tools.${job.error}`, { defaultValue: t('drive_tools.local_download_failed_hint') })}</p>}
            {!terminal && <div className="local-download-actions">
              <button type="button" disabled={job.state === 'cancelling'} onClick={() => void controlLocalDownload(job.id, job.state === 'paused' ? 'resume' : 'pause')}>
                {job.state === 'paused' ? <Play size={16} /> : <Pause size={16} />}
                {t(job.state === 'paused' ? 'drive_tools.local_download_resume' : 'drive_tools.local_download_pause')}
              </button>
              <button type="button" disabled={job.state === 'cancelling'} onClick={() => void controlLocalDownload(job.id, 'cancel')}>
                <Square size={16} />{t('drive_tools.local_download_cancel')}
              </button>
            </div>}
          </article>;
        })}
      </div>
    </>}
  </section>;
}
