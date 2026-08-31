import { useTranslation } from 'react-i18next';
import { useEffect, useMemo, useState } from 'react';
import {
  Upload,
  Download,
  Pause,
  Play,
  Square,
  Minimize2,
  X,
  Check,
  AlertCircle,
  Loader2,
  Clock,
  ChevronDown,
  ChevronRight,
  Copy,
  FolderInput,
  FolderOpen,
  RotateCcw,
  SkipForward,
  Bookmark,
  Trash2,
} from 'lucide-react';
import type { TransferSession } from '../../../lib/telegram/driveTypes';
import {
  formatDriveBytes,
  formatTransferEta,
  formatTransferSpeed,
} from '../../../lib/telegram/driveTypes';
import {
  activeItemName,
  countByStatus,
  sessionVisible,
} from '../../../lib/media/transferProgress';
import { copyTextWithFallback } from '../../../lib/utils/debugMode';
import {
  useTransferProgressStore,
  formatSpeedBytes,
  formatEtaSeconds,
} from '../../../stores/transferProgressStore';

type Props = {
  session: TransferSession;
  minimized: boolean;
  forceShow?: boolean;
  onToggleMinimize: () => void;
  onPause?: () => void;
  onResume?: () => void;
  onStop?: () => void;
  onClearDone?: () => void;
  onDismiss?: () => void;
  onOpenDownloadFolder?: () => void;
  downloadFolderPath?: string | null;
  onRetryFailed?: () => void;
  canRetryFailed?: boolean;
  onRemoveItem?: (itemId: string) => void;
  onRetryItem?: (item: any) => void;
};

function StatusIcon({ status }: { status: string }) {
  if (status === 'done' || status === 'skipped') return <Check size={14} className="tm-ico ok" />;
  if (status === 'reuploaded') return <RotateCcw size={14} className="tm-ico reupload" />;
  if (status === 'failed' || status === 'cancelled' || status === 'needs_verification')
    return <AlertCircle size={14} className="tm-ico err" />;
  if (status === 'active' || status === 'preparing' || status === 'uploaded' || status === 'waiting_commit' || status === 'committing')
    return <Loader2 size={14} className="tm-ico spin" />;
  if (status === 'paused') return <Pause size={14} className="tm-ico muted" />;
  return <Clock size={14} className="tm-ico muted" />;
}

function ProgressRing({
  percent,
  size = 40,
  stroke = 2.75,
}: {
  percent: number;
  size?: number;
  stroke?: number;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const p = Math.min(100, Math.max(0, percent));
  const offset = c - (p / 100) * c;
  return (
    <svg
      className="tm-ring"
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      aria-hidden
    >
      <circle
        className="tm-ring-bg"
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        strokeWidth={stroke}
      />
      <circle
        className="tm-ring-fg"
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        strokeWidth={stroke}
        strokeDasharray={c}
        strokeDashoffset={offset}
        strokeLinecap="round"
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
    </svg>
  );
}

function encoderLabel(item: TransferSession['items'][number]): string {
  const backend = (item.encoderBackend || '').toLowerCase();
  const family = backend === 'nvidia'
    ? 'NVIDIA NVENC'
    : backend === 'amd'
      ? 'AMD AMF'
      : backend === 'intel'
        ? 'Intel QSV'
        : backend === 'cpu'
          ? 'CPU x264'
          : item.encoderName || 'H.264';
  return item.decoderName ? `${family} · ${item.decoderName}` : family;
}

function formatDestination(dest: string | undefined, t: any): { label: string; isSaved: boolean } {
  if (!dest) return { label: '', isSaved: false };
  const trimmed = String(dest).trim().toLowerCase();
  if (trimmed === 'me' || trimmed === 'saved' || trimmed === 'saved messages' || trimmed === 'saved_messages') {
    return { label: t('drive.tm_dest_saved_messages'), isSaved: true };
  }
  return { label: dest, isSaved: false };
}

function formatItemError(errorStr: string | undefined, t: any): { summary: string; detail: string } {
  if (!errorStr) return { summary: t('drive.tm_stat_failed'), detail: '' };
  const s = String(errorStr);
  if (/status code 404|404 not found/i.test(s)) {
    return { summary: t('drive.tm_error_404'), detail: s };
  }
  if (/status code 403|403 forbidden/i.test(s)) {
    return { summary: t('drive.tm_error_403'), detail: s };
  }
  if (/status code 401|401 unauthorized/i.test(s)) {
    return { summary: t('drive.tm_error_401'), detail: s };
  }
  if (/status code 5\d\d|server error|bad gateway|gateway timeout/i.test(s)) {
    const codeMatch = s.match(/status code (\d+)/i);
    const code = codeMatch ? codeMatch[1] : '5xx';
    return { summary: t('drive.tm_error_server', { code }), detail: s };
  }
  if (/timeout|timed out|econnreset|econnrefused/i.test(s)) {
    return { summary: t('drive.tm_error_timeout'), detail: s };
  }
  if (/database is locked|sqlite_busy/i.test(s)) {
    return { summary: t('drive.tm_error_db_locked'), detail: s };
  }
  if (/flood_wait|floodwait/i.test(s)) {
    return { summary: t('drive.tm_error_flood'), detail: s };
  }
  return { summary: s.length > 70 ? `${s.slice(0, 67)}...` : s, detail: s };
}

export function DriveTransferManager({
  session,
  minimized,
  forceShow = false,
  onToggleMinimize,
  onPause,
  onResume,
  onStop,
  onClearDone,
  onDismiss,
  onOpenDownloadFolder,
  downloadFolderPath,
  onRetryFailed,
  canRetryFailed,
  onRemoveItem,
  onRetryItem,
}: Props) {
  const { t } = useTranslation();
  const hasSession = sessionVisible(session);
  const visible = hasSession || forceShow;
  const counts = useMemo(() => countByStatus(session), [session]);
  const isUpload = session?.direction === 'upload';
  const isMove = session?.direction === 'move';
  const DirIcon = isMove ? FolderInput : isUpload ? Upload : Download;
  const itemsList = session && Array.isArray(session.items) ? session.items : [];
  const isPreparing = itemsList.some((i: any) => i.status === 'preparing');
  const encodeItem = itemsList.find(
    (item: any) => item.phase === 'reencode' && item.status === 'preparing'
  );
  const displayPercent = session?.overallPercent ?? 0;
  const phaseClass = (item: any): 'prepare' | 'convert' | 'reencode' | 'remux' | 'upload' | 'download' | 'commit' => {
    const phase = String(item?.phase || '').toLowerCase();
    if (item?.status === 'committing' || item?.status === 'waiting_commit' || phase.includes('commit')) return 'commit';
    if (phase.includes('convert') || phase.includes('transcode')) return 'convert';
    if (phase.includes('reencode') || phase === 'encode') return 'reencode';
    if (phase.includes('remux')) return 'remux';
    if (phase === 'download' || item?.direction === 'download') return 'download';
    if (phase === 'upload' || phase === 'media_registering') return 'upload';
    return 'prepare';
  };
  const activeProgressItem = itemsList.find((item: any) =>
    ['active', 'preparing', 'uploaded', 'waiting_commit', 'committing'].includes(item.status)
  );
  const currentPhase = phaseClass(activeProgressItem || { direction: session.direction });
  const scanPhase = ['cache_warmup', 'recent', 'sampling', 'forensic'].includes(String((session as any).scanPhase))
    ? String((session as any).scanPhase)
    : 'scanning';

  const { jobs } = useTransferProgressStore();
  const activeJob = jobs.find((j) => j.activeStage !== 'idle' && j.activeStage !== 'done') || jobs[0];

  const currentStage: 'encode' | 'upload' | 'download' = activeJob
    ? activeJob.activeStage === 'idle' || activeJob.activeStage === 'done'
      ? isUpload ? 'upload' : 'download'
      : activeJob.activeStage
    : isPreparing ? 'encode' : isUpload ? 'upload' : 'download';

  const liveStageProgress = activeJob ? activeJob[currentStage] : null;

  // Accurately compute error/success states
  const isAllFailed = !session.active && counts.total > 0 && counts.failed === counts.total;
  const isPartialFailed = !session.active && counts.failed > 0 && (counts.done > 0 || counts.skipped > 0);

  // Real-time percent reflects actual successful progress
  const realTimePercent = isAllFailed
    ? 0
    : isPartialFailed && counts.total > 0
      ? Math.round(((counts.done + counts.skipped) / counts.total) * 1000) / 10
      : displayPercent;

  const realTimeSpeedStr = liveStageProgress && liveStageProgress.speed > 0
    ? formatSpeedBytes(liveStageProgress.speed)
    : (session?.speed_mb_s ?? 0) > 0.02 ? formatTransferSpeed(session.speed_mb_s) : '';

  const realTimeEtaStr = liveStageProgress && liveStageProgress.eta != null
    ? formatEtaSeconds(liveStageProgress.eta)
    : encodeItem?.encodeEtaSeconds != null
      ? formatTransferEta(encodeItem.encodeEtaSeconds)
      : session?.active && session?.etaSeconds != null
        ? formatTransferEta(session.etaSeconds)
        : '';

  const phaseLabel = isMove
    ? t('drive.tm_phase_move')
    : t(`drive.tm_phase_${currentPhase}`);
  const activeName = activeItemName(session);
  const isEmptyShell = !hasSession && forceShow;
  const remainingAfterActive = session.items.filter(
    (i: any) => i.status === 'queued' || i.status === 'paused'
  ).length;
  const pauseUseful =
    session.active && (remainingAfterActive > 0 || session.items.length > 1);
  const canPause =
    !isMove && pauseUseful && !session.paused && remainingAfterActive > 0;
  const canResume = !isMove && session.active && session.paused;
  const pauseTitle = !session.active
    ? undefined
    : isMove
      ? t('drive.tm_pause_move_unavailable')
      : remainingAfterActive > 0
        ? t('drive.tm_pause_safe_boundary')
        : session.items.length <= 1
          ? t('drive.tm_pause_single_unavailable')
          : t('drive.tm_pause_queue_empty');

  const [showLogs, setShowLogs] = useState(false);
  const [copyMsg, setCopyMsg] = useState<string | null>(null);
  const [copiedItemErrorId, setCopiedItemErrorId] = useState<string | null>(null);
  const debugLogs = session.debugLogs || [];

  useEffect(() => {
    if (debugLogs.length > 0 && debugLogs.some((l: any) => /FALLBACK|ERROR|FAILED/i.test(l))) {
      setShowLogs((prev) => (prev ? prev : true));
    }
  }, [debugLogs.length]);

  useEffect(() => {
    if (!visible || minimized) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onToggleMinimize();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [visible, minimized, onToggleMinimize]);

  if (minimized) {
    if (!hasSession) return null;
    const pct = Math.min(100, Math.max(0, realTimePercent));
    const statusLine = session.active
      ? phaseLabel
      : isAllFailed
        ? t('drive.tm_stat_failed')
        : isPartialFailed
          ? t('drive.tm_status_error')
          : counts.needsVerification
            ? t('drive.tm_stat_verify')
            : t('drive.tm_status_done');
    const tip = [
      `${statusLine} ${pct.toFixed(0)}%`,
      activeName,
      session.active && session.speed_mb_s > 0.05
        ? formatTransferSpeed(session.speed_mb_s)
        : '',
    ]
      .filter(Boolean)
      .join(' · ');
    const fileFrac =
      counts.total > 0
        ? `${counts.done}/${counts.total}`
        : '';

    return (
      <button
        type="button"
        className={[
          'tm-fab',
          session.active ? 'is-active' : 'is-idle',
          isAllFailed || counts.failed > 0 ? 'is-error' : '',
          isUpload ? 'dir-up' : 'dir-down',
        ]
          .filter(Boolean)
          .join(' ')}
        onClick={onToggleMinimize}
        title={`${tip} — ${t('drive.click_to_open')}`}
        aria-label={`Transfer manager: ${tip}. ${t('drive.click_to_open')}.`}
      >
        <span className="tm-fab-orb" aria-hidden>
          <ProgressRing percent={pct} size={38} stroke={2.5} />
          <span className="tm-fab-ico">
            {session.active ? (
              <DirIcon size={15} strokeWidth={2.4} />
            ) : isAllFailed || counts.failed > 0 || counts.needsVerification ? (
              <AlertCircle size={15} strokeWidth={2.4} />
            ) : (
              <Check size={15} strokeWidth={2.6} />
            )}
          </span>
        </span>
        <span className="tm-fab-meta">
          <span className="tm-fab-row1">
            <span className="tm-fab-pct">{pct.toFixed(0)}%</span>
            {fileFrac && <span className="tm-fab-frac">{fileFrac}</span>}
          </span>
          <span className="tm-fab-row2">
            <span className="tm-fab-status">{statusLine}</span>
            {session.active && session.speed_mb_s > 0.08 && (
              <span className="tm-fab-speed">{formatTransferSpeed(session.speed_mb_s)}</span>
            )}
          </span>
        </span>
      </button>
    );
  }

  if (!visible) return null;

  const subtitleText = isEmptyShell
    ? t('drive.tm_no_transfers')
    : session.active
      ? session.paused
        ? t('drive.tm_status_paused')
        : `${phaseLabel}${session.label ? ` → ${session.label}` : ''}`
      : isAllFailed
        ? t('drive.tm_status_all_failed', { count: counts.failed })
        : isPartialFailed
          ? t('drive.tm_status_partial_error', {
              done: counts.done + counts.skipped,
              total: counts.total,
              failed: counts.failed,
            })
          : counts.needsVerification > 0
            ? t('drive.tm_status_need_verify', { count: counts.needsVerification })
            : counts.skipped > 0 && counts.done === 0
              ? t('drive.tm_status_skipped', { count: counts.skipped })
              : counts.skipped > 0
                ? t('drive.tm_status_done_skipped', { count: counts.skipped })
                : counts.done > 0
                  ? t('jobs.status_completed')
                  : t('drive.tm_status_ready');

  const barModifier = isAllFailed
    ? 'bar-failed'
    : isPartialFailed
      ? 'bar-partial'
      : session.active
        ? `stage-${currentPhase}`
        : 'bar-done';

  return (
    <div
      className={`tm-panel ${session.active ? 'active' : ''} ${isUpload ? 'up' : 'down'} ${isAllFailed ? 'has-error' : ''}`}
      role="dialog"
      aria-label={t('drive.topbar_tm_aria')}
      aria-live="polite"
      onMouseDown={(e) => e.stopPropagation()}
    >
      <header className="tm-head">
        <div className="tm-head-title">
          <span className={`tm-dir-badge ${isAllFailed ? 'err' : isUpload ? 'up' : 'down'}`}>
            {isAllFailed ? <AlertCircle size={14} /> : <DirIcon size={14} />}
          </span>
          <div className="tm-head-text">
            <strong>{t('drive.tm_title')}</strong>
            <span className="tm-head-sub" title={subtitleText}>
              {subtitleText}
            </span>
          </div>
        </div>
        <div className="tm-head-actions">
          <button
            type="button"
            className="tm-icon-btn"
            onClick={onToggleMinimize}
            title={t('drive.tm_minimize')}
            aria-label={t('drive.tm_minimize')}
          >
            <Minimize2 size={15} />
          </button>
          <button
            type="button"
            className="tm-icon-btn"
            onClick={onToggleMinimize}
            title={t('drive.tm_close_panel')}
            aria-label={t('drive.tm_close_panel')}
          >
            <X size={15} />
          </button>
        </div>
      </header>

      {isEmptyShell ? (
        <div className="tm-empty">
          <p>{t('drive.tm_empty_title')}</p>
          <p className="tm-hint">
            {t('drive.tm_empty_hint')}
          </p>
        </div>
      ) : (
        <>
          <div className="tm-summary">
            <div className="tm-summary-row">
              <span className={`tm-summary-pct ${isAllFailed ? 'text-err' : ''}`}>
                {realTimePercent.toFixed(1)}%
              </span>
              <span className="tm-summary-stats">
                {counts.total > 0 && (
                  <span className="tm-stat-breakdown">
                    <span className="tm-stat-item">
                      {counts.done}/{counts.total} {t('drive.tm_stat_done')}
                    </span>
                    {counts.failed > 0 && (
                      <span className="tm-stat-item err" title={t('drive.tm_stat_failed_hint')}>
                        · {counts.failed} {t('drive.tm_stat_failed')}
                      </span>
                    )}
                    {counts.skipped > 0 && (
                      <span className="tm-skip-badge" title={t('drive.tm_skipped_hint')}>
                        · {counts.skipped} {t('drive.tm_stat_skipped')}
                      </span>
                    )}
                    {(session as any).reuploadedCount > 0 && (
                      <span className="tm-reupload-badge" title={t('drive.tm_reupload_hint')}>
                        · <RotateCcw size={11} style={{ display: 'inline', verticalAlign: 'middle' }} /> {(session as any).reuploadedCount} {t('drive.tm_stat_reupload')}
                      </span>
                    )}
                    {counts.needsVerification > 0 && (
                      <span className="tm-verify-badge" title={t('drive.tm_verify_hint')}>
                        · {counts.needsVerification} {t('drive.tm_stat_verify')}
                      </span>
                    )}
                  </span>
                )}
                {liveStageProgress?.fps != null && (
                  <span>{liveStageProgress.fps.toFixed(0)} FPS</span>
                )}
                {encodeItem && !liveStageProgress?.fps && !!encodeItem.fps && (
                  <span>{encodeItem.fps.toFixed(0)} FPS</span>
                )}
                {encodeItem && !!encodeItem.encodeSpeed && (
                  <span>{encodeItem.encodeSpeed.toFixed(2)}x</span>
                )}
                {realTimeSpeedStr && (
                  <span>{realTimeSpeedStr}</span>
                )}
                {session.peak_mb_s > 0 && session.active && (
                  <span className="tm-muted">{t('drive.tm_peak', { speed: session.peak_mb_s.toFixed(2) })}</span>
                )}
                {realTimeEtaStr && (
                  <span>{t('drive.tm_eta', { eta: realTimeEtaStr })}</span>
                )}
              </span>
            </div>
            <div
              className="tm-bar"
              role="progressbar"
              aria-valuenow={Math.round(realTimePercent)}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <div
                className={`tm-bar-fill ${barModifier}`}
                style={{ width: isAllFailed ? '100%' : `${Math.min(100, Math.max(0, realTimePercent))}%` }}
              />
            </div>
            {encodeItem?.estimatedOutputBytes && currentPhase === 'reencode' ? (
              <div className="tm-bytes">
                {t('drive.tm_estimated_output', { bytes: formatDriveBytes(encodeItem.estimatedOutputBytes) })}
              </div>
            ) : (session.transferred > 0 || session.total > 0) && (
              <div className="tm-bytes">
                {formatDriveBytes(session.transferred)}
                {session.total > 0 ? ` / ${formatDriveBytes(session.total)}` : ''}
              </div>
            )}
            {session.banner && (
              <div className={`tm-banner ${isAllFailed || counts.failed > 0 ? 'err' : ''}`}>
                <AlertCircle size={13} className="tm-banner-ico" />
                <span>{session.banner}</span>
              </div>
            )}
            {(session as any).scanPhase && (session as any).scanPhase !== 'done' && (
              <div className="tm-scan-progress">
                <Loader2 size={11} className="tm-ico spin" style={{ display: 'inline', verticalAlign: 'middle', marginRight: 4 }} />
                <span>
                  {t(`drive.tm_scan_${scanPhase}`, { count: (session as any).scanScanned ?? 0 })}
                </span>
              </div>
            )}
            {(session as any).scanPhase === 'done' && (session as any).scanStats && (
              <div className="tm-scan-done">
                {t('drive.tm_scan_done_summary', {
                  total: (session as any).scanStats.totalScanned,
                  cache: (session as any).scanStats.dbCachedLoaded,
                  fromTg: (session as any).scanStats.newFromTg,
                })}
              </div>
            )}
            {session.active && remainingAfterActive > 0 && (
              <p className="tm-hint">
                {t('drive.tm_hint_pause_safe')}
              </p>
            )}
            {session.active && session.items.length <= 1 && !session.paused && (
              <p className="tm-hint">
                {t('drive.tm_hint_pause_single')}
              </p>
            )}
          </div>

          {session.active && (
            <div className="tm-controls">
              {canResume ? (
                <button type="button" className="tm-btn primary" onClick={onResume}>
                  <Play size={14} /> {t('drive.tm_btn_resume')}
                </button>
              ) : pauseUseful && remainingAfterActive > 0 ? (
                <button
                  type="button"
                  className="tm-btn"
                  onClick={onPause}
                  disabled={!canPause || !onPause}
                  title={pauseTitle}
                >
                  <Pause size={14} /> {t('drive.tm_btn_pause')}
                </button>
              ) : null}
              <button type="button" className="tm-btn danger" onClick={onStop} disabled={!onStop}>
                <Square size={13} /> {t('drive.tm_btn_stop')}
              </button>
            </div>
          )}

          {!session.active && (
            <div className="tm-controls">
              {canRetryFailed && onRetryFailed && counts.failed > 0 && (
                <button
                  type="button"
                  className="tm-btn primary"
                  onClick={onRetryFailed}
                  title={t('drive.retry_failed_files')}
                >
                  <RotateCcw size={13} /> {t('drive.tm_retry_failed_count', { count: counts.failed })}
                </button>
              )}
              {downloadFolderPath && onOpenDownloadFolder && (
                <button
                  type="button"
                  className="tm-btn"
                  onClick={onOpenDownloadFolder}
                  title={downloadFolderPath}
                >
                  <FolderOpen size={13} /> {t('drive.zip_open_folder')}
                </button>
              )}
              {onClearDone && (counts.done > 0 || counts.skipped > 0) && counts.failed > 0 && (
                <button
                  type="button"
                  className="tm-btn secondary"
                  onClick={onClearDone}
                  title={t('drive.tm_clear_done')}
                >
                  <Check size={13} /> {t('drive.tm_clear_done')}
                </button>
              )}
              {onDismiss && (
                <button
                  type="button"
                  className="tm-btn danger-ghost"
                  onClick={onDismiss}
                  title={t('drive.clear_transfer_history')}
                >
                  <Trash2 size={13} /> {t('drive.clear_transfer_history')}
                </button>
              )}
            </div>
          )}

          <ul className="tm-list" aria-label={t('drive.tm_list_aria')}>
            {session.items.map((it: any) => {
              const destInfo = formatDestination(it.destination, t);
              const errInfo = formatItemError(it.error, t);

              return (
                <li key={it.id} className={`tm-row status-${it.status}`}>
                  <StatusIcon status={it.status} />
                  <div className="tm-row-body">
                    <div className="tm-row-name-container">
                      <div className="tm-row-name" title={it.name}>
                        {it.name}
                      </div>
                      {destInfo.label && (
                        <span
                          className={`tm-row-dest ${destInfo.isSaved ? 'is-saved' : ''}`}
                          title={t('drive.tm_dest_tooltip', { dest: destInfo.label })}
                        >
                          {destInfo.isSaved && <Bookmark size={10} className="tm-dest-ico" />}
                          {destInfo.label}
                        </span>
                      )}
                    </div>
                    <div className="tm-row-meta">
                      {(it.status === 'done' || it.status === 'skipped') && <span>{t('drive.status_done')}</span>}
                      {it.status === 'skipped' && (
                        <span
                          className="tm-skip-badge-pill"
                          title={it.note || t('drive.file_exists_no_reupload')}
                          aria-label={t('drive.tm_skipped_aria', { reason: it.note || t('drive.tm_duplicate_short') })}
                        >
                          <SkipForward size={9} />
                          {t('drive.tm_stat_skipped')}
                        </span>
                      )}
                      {it.status === 'failed' && (
                        <span className="tm-err-text" title={errInfo.detail || undefined}>
                          {errInfo.summary}
                        </span>
                      )}
                      {it.status === 'cancelled' && <span>{t('drive.tm_status_cancelled')}</span>}
                      {it.status === 'uploaded' && <span>{t('drive.tm_status_media_registered')}</span>}
                      {it.status === 'waiting_commit' && <span>{t('drive.tm_status_waiting_commit')}</span>}
                      {it.status === 'committing' && <span>{t('drive.tm_status_committing')}</span>}
                      {it.status === 'needs_verification' && (
                        <span className="tm-err-text">{t('drive.tm_status_needs_verify')}</span>
                      )}
                      {it.status === 'queued' && <span>{t('drive.tm_status_queued')}</span>}
                      {it.status === 'paused' && <span>{t('jobs.status_paused')}</span>}
                      {it.status === 'preparing' && (
                        <span>{it.phase === 'reencode' ? t('drive.preflight_transform_reencode') : t('drive.tm_phase_prepare')}</span>
                      )}
                      {(it.status === 'active' || it.status === 'preparing' || it.status === 'uploaded' || it.status === 'waiting_commit' || it.status === 'committing') && (
                        <>
                          <span>{it.percent.toFixed(0)}%</span>
                          {it.phase === 'reencode' && (it.encoderBackend || it.encoderName) && (
                            <span className="tm-encoder-badge" title={it.fallbackReason || undefined}>
                              {encoderLabel(it)}
                            </span>
                          )}
                          {it.phase === 'reencode' && !!it.fps && <span>{it.fps.toFixed(0)} FPS</span>}
                          {it.phase === 'reencode' && !!it.encodeSpeed && (
                            <span>{it.encodeSpeed.toFixed(2)}x</span>
                          )}
                          {it.phase === 'reencode' && !!it.estimatedOutputBytes && (
                            <span>≈ {formatDriveBytes(it.estimatedOutputBytes)}</span>
                          )}
                          {it.phase !== 'reencode' && (it.transferred > 0 || it.total > 0) && (
                            <span>
                              {formatDriveBytes(it.transferred)}
                              {it.total > 0 ? ` / ${formatDriveBytes(it.total)}` : ''}
                            </span>
                          )}
                          {it.phase !== 'reencode' && it.speed_mb_s > 0.02 && (
                            <span>{formatTransferSpeed(it.speed_mb_s)}</span>
                          )}
                        </>
                      )}
                    </div>
                    {(it.status === 'active' || it.status === 'preparing' || it.status === 'uploaded' || it.status === 'waiting_commit' || it.status === 'committing') && (
                      <div className="tm-mini-bar">
                        <div
                          className={`tm-mini-fill stage-${phaseClass(it)}`}
                          style={{ width: `${Math.min(100, Math.max(0, it.percent))}%` }}
                        />
                      </div>
                    )}
                  </div>
                  <div className="tm-row-actions">
                    {it.status === 'failed' && it.error && (
                      <button
                        type="button"
                        className="tm-row-btn"
                        onClick={() => {
                          void copyTextWithFallback(it.error).then((ok: boolean) => {
                            if (ok) {
                              setCopiedItemErrorId(it.id);
                              window.setTimeout(() => setCopiedItemErrorId(null), 1500);
                            }
                          });
                        }}
                        title={copiedItemErrorId === it.id ? t('drive.zip_btn_copied') : t('drive.tm_copy_error_tooltip')}
                        aria-label={t('drive.tm_copy_error_tooltip')}
                      >
                        {copiedItemErrorId === it.id ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
                      </button>
                    )}
                    {onRetryItem && it.status === 'failed' && (
                      <button
                        type="button"
                        className="tm-row-btn"
                        onClick={() => onRetryItem(it)}
                        title={t('drive.tm_retry_item_tooltip')}
                        aria-label={t('drive.tm_retry_item_tooltip')}
                      >
                        <RotateCcw size={12} />
                      </button>
                    )}
                    {onRemoveItem && !session.active && (
                      <button
                        type="button"
                        className="tm-row-btn hover-danger"
                        onClick={() => onRemoveItem(it.id)}
                        title={t('drive.tm_remove_item_tooltip')}
                        aria-label={t('drive.tm_remove_item_tooltip')}
                      >
                        <X size={12} />
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}

      {!isEmptyShell && debugLogs.length > 0 && (
        <div className="tm-debug">
          <button
            type="button"
            className="tm-debug-toggle"
            onClick={() => setShowLogs((v) => !v)}
            aria-expanded={showLogs}
          >
            {showLogs ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            {t('drive.tm_log_debug', { count: debugLogs.length })}
          </button>
          {showLogs && (
            <div className="tm-debug-body">
              <div className="tm-debug-actions">
                <span className="tm-debug-hint">
                  {t('drive.tm_debug_file_hint')}
                </span>
                <button
                  type="button"
                  className="tm-btn ghost"
                  disabled={!debugLogs.length && !session.banner}
                  onClick={() => {
                    const text =
                      debugLogs.join('\n') ||
                      session.banner ||
                      t('drive.tm_debug_empty_copy');
                    void copyTextWithFallback(text).then((ok: any) => {
                      setCopyMsg(ok ? t('drive.zip_btn_copied') : t('drive.tm_copy_failed'));
                      window.setTimeout(() => setCopyMsg(null), 2000);
                    });
                  }}
                  title={t('drive.copy_log_clipboard')}
                >
                  <Copy size={12} /> {copyMsg || t('drive.tm_copy_btn')}
                </button>
              </div>
              <pre className="tm-debug-pre" aria-label={t('drive.tm_debug_log_aria')}>
                {debugLogs.length
                  ? debugLogs.join('\n')
                  : t('drive.tm_debug_empty')}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
