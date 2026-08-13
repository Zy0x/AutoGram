import { useTranslation } from 'react-i18next';
import { useEffect, useMemo, useState } from 'react';
import {
  Upload,
  Download,
  Pause,
  Play,
  Square,
  Minimize2,
  Maximize2,
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
  unresolvedTransfer?: {
    transferId: string;
    totalItems: number;
    remainingItems: number;
    chatId?: string;
  } | null;
  onResumeUnresolved?: () => void;
  onClearUnresolved?: () => void;
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
  unresolvedTransfer,
  onResumeUnresolved,
  onClearUnresolved,
}: Props) {
  const { t } = useTranslation();
  const hasSession = sessionVisible(session);
  const visible = hasSession || forceShow || Boolean(unresolvedTransfer);
  const counts = useMemo(() => countByStatus(session), [session]);
  const isUpload = session?.direction === 'upload';
  const isMove = session?.direction === 'move';
  const DirIcon = isMove ? FolderInput : isUpload ? Upload : Download;
  const itemsList = session && Array.isArray(session.items) ? session.items : [];
  const isPreparing = itemsList.some((i: any) => i.status === 'preparing');
  const encodeItem = itemsList.find(
    (item: any) => item.phase === 'reencode' && item.status === 'preparing'
  );

  const { jobs } = useTransferProgressStore();
  const activeJob = jobs.find((j) => j.activeStage !== 'idle' && j.activeStage !== 'done') || jobs[0];

  const currentStage: 'encode' | 'upload' | 'download' = activeJob
    ? activeJob.activeStage === 'idle' || activeJob.activeStage === 'done'
      ? isUpload ? 'upload' : 'download'
      : activeJob.activeStage
    : isPreparing ? 'encode' : isUpload ? 'upload' : 'download';

  const liveStageProgress = activeJob ? activeJob[currentStage] : null;

  // Use aggregate session.overallPercent for stable multi-item progress
  const aggregatePercent = Math.min(100, Math.max(0, session?.overallPercent ?? 0));
  const realTimePercent = aggregatePercent;

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

  const hasEncodePhase = itemsList.some((i: any) => i.status === 'preparing' || i.phase === 'reencode');
  const hasUploadPhase = itemsList.some((i: any) => i.status === 'active' || i.phase === 'upload');
  const hasCommitPhase = itemsList.some((i: any) => i.status === 'waiting_commit' || i.status === 'committing' || i.status === 'uploaded');

  const phaseLabel = isPreparing || currentStage === 'encode'
    ? t('speedtest.transfer_phase_encode')
    : isMove
      ? session.label?.startsWith('Salin')
        ? 'Menyalin'
        : 'Memindahkan'
      : currentStage === 'upload'
        ? t('speedtest.transfer_phase_upload')
        : 'Downloading';
  const activeName = activeItemName(session);
  const hasFinished = counts.done + counts.failed + counts.skipped + counts.needsVerification > 0;
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
      ? 'Pindah/salin: gunakan Stop untuk batalkan sisa antrean'
      : remainingAfterActive > 0
        ? 'Jeda: file yang sedang jalan diselesaikan, file berikutnya ditahan'
        : session.items.length <= 1
          ? 'File tunggal: tidak bisa dijeda di tengah unduhan. Gunakan Stop untuk batalkan.'
          : 'Semua file sudah berjalan / selesai — tidak ada antrean yang bisa dijeda';

  const [showLogs, setShowLogs] = useState(false);
  const [copyMsg, setCopyMsg] = useState<string | null>(null);
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
      : counts.failed
        ? 'Gagal'
        : counts.needsVerification
          ? 'Perlu verifikasi'
        : t("speedtest.tm_status_done");
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
          (counts.failed || counts.needsVerification) && !session.active ? 'is-error' : '',
          isUpload ? 'dir-up' : 'dir-down',
        ]
          .filter(Boolean)
          .join(' ')}
        onClick={onToggleMinimize}
        title={`${tip} — ${t('speedtest.click_to_open')}`}
        aria-label={`Transfer manager: ${tip}. ${t('speedtest.click_to_open')}.`}
      >
        <span className="tm-fab-orb" aria-hidden>
          <ProgressRing percent={pct} size={38} stroke={2.5} />
          <span className="tm-fab-ico">
            {session.active ? (
              <DirIcon size={15} strokeWidth={2.4} />
            ) : counts.failed || counts.needsVerification ? (
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

  return (
    <div
      className={`tm-panel ${session.active ? 'active' : ''} ${isUpload ? 'up' : 'down'}`}
      role="dialog"
      aria-label={t('speedtest.topbar_tm_aria')}
      aria-live="polite"
      onMouseDown={(e) => e.stopPropagation()}
    >
      <header className="tm-head">
        <div className="tm-head-title">
          <span className={`tm-dir-badge ${isUpload ? 'up' : 'down'}`}>
            <DirIcon size={14} />
          </span>
          <div className="tm-head-text">
            <strong>{t("speedtest.tm_title")}</strong>
            <span className="tm-head-sub">
              {isEmptyShell
                ? t("speedtest.tm_no_transfers")
                : session.active
                  ? session.paused
                    ? t("speedtest.tm_status_paused")
                    : `${currentStage === 'encode' ? 'Re-encode' : currentStage === 'upload' ? 'Uploading' : 'Downloading'}${session.label ? ` → ${session.label}` : ''}`
                  : counts.failed
                    ? t("speedtest.tm_status_error")
                    : counts.needsVerification
                      ? t("speedtest.tm_status_need_verify", { count: counts.needsVerification })
                    : counts.skipped > 0 && counts.done === 0
                      ? t("speedtest.tm_status_skipped", { count: counts.skipped })
                      : counts.skipped > 0
                        ? t("speedtest.tm_status_done_skipped", { count: counts.skipped })
                        : counts.done
                          ? t('jobs.status_completed')
                          : t("speedtest.tm_status_ready")}
            </span>
          </div>
        </div>
        <div className="tm-head-actions">
          <button
            type="button"
            className="tm-icon-btn"
            onClick={onToggleMinimize}
            title={t("speedtest.tm_minimize")}
            aria-label={t('ui.generated.minimize_1c5b768')}
          >
            <Minimize2 size={15} />
          </button>
          <button
            type="button"
            className="tm-icon-btn"
            onClick={() => {
              onToggleMinimize();
            }}
            title={t('speedtest.minimize_panel')}
            aria-label={t('speedtest.show_less')}
          >
            <X size={15} />
          </button>
        </div>
      </header>

      {unresolvedTransfer && (
        <div className="tm-recovery-card" style={{ padding: '10px 14px', margin: '8px 12px', background: 'rgba(234, 179, 8, 0.12)', border: '1px solid rgba(234, 179, 8, 0.3)', borderRadius: '8px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 600, fontSize: '12.5px', color: '#eab308' }}>
            <AlertCircle size={14} />
            <span>{t('speedtest.transfer_unresolved_title')}</span>
          </div>
          <p style={{ margin: 0, fontSize: '11.5px', opacity: 0.85 }}>
            {t('speedtest.transfer_unresolved_desc', { remaining: unresolvedTransfer.remainingItems, total: unresolvedTransfer.totalItems })}
          </p>
          <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
            {onResumeUnresolved && (
              <button type="button" className="td-chip-btn" onClick={onResumeUnresolved} style={{ fontSize: '11px', padding: '3px 8px' }}>
                <Play size={12} style={{ marginRight: 4 }} />
                <span>{t('speedtest.transfer_unresolved_resume')}</span>
              </button>
            )}
            {onClearUnresolved && (
              <button type="button" className="td-chip-btn" onClick={onClearUnresolved} style={{ fontSize: '11px', padding: '3px 8px' }}>
                <X size={12} style={{ marginRight: 4 }} />
                <span>{t('speedtest.transfer_unresolved_clear')}</span>
              </button>
            )}
          </div>
        </div>
      )}

      {session.active && (
        <div className="tm-phase-pills" style={{ display: 'flex', gap: '6px', padding: '6px 14px 2px', fontSize: '11px' }}>
          <span style={{ padding: '2px 8px', borderRadius: '12px', background: hasEncodePhase ? 'rgba(59, 130, 246, 0.2)' : 'rgba(255, 255, 255, 0.05)', color: hasEncodePhase ? '#60a5fa' : 'inherit', fontWeight: hasEncodePhase ? 600 : 400 }}>
            {t('speedtest.transfer_phase_encode')}
          </span>
          <span style={{ padding: '2px 8px', borderRadius: '12px', background: hasUploadPhase ? 'rgba(59, 130, 246, 0.2)' : 'rgba(255, 255, 255, 0.05)', color: hasUploadPhase ? '#60a5fa' : 'inherit', fontWeight: hasUploadPhase ? 600 : 400 }}>
            {t('speedtest.transfer_phase_upload')}
          </span>
          <span style={{ padding: '2px 8px', borderRadius: '12px', background: hasCommitPhase ? 'rgba(168, 85, 247, 0.2)' : 'rgba(255, 255, 255, 0.05)', color: hasCommitPhase ? '#c084fc' : 'inherit', fontWeight: hasCommitPhase ? 600 : 400 }}>
            {t('speedtest.transfer_phase_commit')}
          </span>
        </div>
      )}

      {isEmptyShell ? (
        <div className="tm-empty">
          <p>{t("speedtest.tm_empty_title")}</p>
          <p className="tm-hint">
            {t('ui.generated.mulai_unduh_atau_unggah_progress_akan_tampil_di__51dedb7')}
          </p>
        </div>
      ) : (
        <>
          <div className="tm-summary">
            <div className="tm-summary-row">
              <span className="tm-summary-pct">{realTimePercent.toFixed(1)}%</span>
              <span className="tm-summary-stats">
                {counts.total > 0 && (
                  <span>
                    {counts.done}/{counts.total} {t('ui.generated.commit_4015b57')}
                    {counts.skipped > 0 && (
                      <span className="tm-skip-badge" title={t("speedtest.tm_skipped_hint")}>
                        &nbsp;·&nbsp;{counts.skipped} {t('ui.generated.dilewati_4a805bc')}
                      </span>
                    )}
                    {(session as any).reuploadedCount > 0 && (
                      <span className="tm-reupload-badge" title={t("speedtest.tm_reupload_hint")}>
                        &nbsp;·&nbsp;<RotateCcw size={11} style={{display:'inline',verticalAlign:'middle'}} />&nbsp;{(session as any).reuploadedCount} {t('ui.generated.re_upload_74ad44c')}
                      </span>
                    )}
                    {counts.needsVerification > 0 && (
                      <span className="tm-skip-badge" title={t("speedtest.tm_verify_hint")}>
                        &nbsp;·&nbsp;{counts.needsVerification} {t('ui.generated.perlu_verifikasi_101c413')}
                      </span>
                    )}
                  </span>
                )}
                {liveStageProgress?.fps != null && (
                  <span>{liveStageProgress.fps.toFixed(0)} {t('ui.generated.fps_fce204a')}</span>
                )}
                {encodeItem && !liveStageProgress?.fps && !!encodeItem.fps && (
                  <span>{encodeItem.fps.toFixed(0)} {t('ui.generated.fps_fce204a')}</span>
                )}
                {encodeItem && !!encodeItem.encodeSpeed && (
                  <span>{encodeItem.encodeSpeed.toFixed(2)}{t('ui.generated.realtime_5408b2c')}</span>
                )}
                {realTimeSpeedStr && (
                  <span>{realTimeSpeedStr}</span>
                )}
                {session.peak_mb_s > 0 && session.active && (
                  <span className="tm-muted">{t('ui.generated.puncak_62737da')} {session.peak_mb_s.toFixed(2)} {t('ui.generated.mb_s_44acadb')}</span>
                )}
                {realTimeEtaStr && (
                  <span>{t('ui.generated.eta_3044d4f')} {realTimeEtaStr}</span>
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
                className={`tm-bar-fill stage-${currentStage}`}
                style={{ width: `${Math.min(100, Math.max(0, realTimePercent))}%` }}
              />
            </div>
            {liveStageProgress && liveStageProgress.totalBytes > 0 ? (
              <div className="tm-bytes">
                {formatDriveBytes(liveStageProgress.currentBytes)} / {formatDriveBytes(liveStageProgress.totalBytes)}
              </div>
            ) : encodeItem?.estimatedOutputBytes ? (
              <div className="tm-bytes">
                {t('ui.generated.perkiraan_output_5002fa3')} {formatDriveBytes(encodeItem.estimatedOutputBytes)}
              </div>
            ) : (session.transferred > 0 || session.total > 0) && (
              <div className="tm-bytes">
                {formatDriveBytes(session.transferred)}
                {session.total > 0 ? ` / ${formatDriveBytes(session.total)}` : ''}
              </div>
            )}
            {session.banner && <div className="tm-banner">{session.banner}</div>}
            {(session as any).scanPhase && (session as any).scanPhase !== 'done' && (
              <div className="tm-scan-progress">
                <Loader2 size={11} className="tm-ico spin" style={{display:'inline',verticalAlign:'middle',marginRight:4}} />
                <span>
                  {(session as any).scanPhase === 'cache_warmup' && 'Memuat cache duplikat…'}
                  {(session as any).scanPhase === 'recent' && `Memindai 1.000 pesan terakhir… (${(session as any).scanScanned ?? 0})`}
                  {(session as any).scanPhase === 'sampling' && `Sampling adaptif… (${(session as any).scanScanned ?? 0} dipindai)`}
                  {(session as any).scanPhase === 'forensic' && `Pemindaian forensik… (${(session as any).scanScanned ?? 0} pesan)`}
                  {!['cache_warmup','recent','sampling','forensic'].includes((session as any).scanPhase) && `Memindai…`}
                </span>
              </div>
            )}
            {(session as any).scanPhase === 'done' && (session as any).scanStats && (
              <div className="tm-scan-done">
                {t('ui.generated.scan_8194d17')} {(session as any).scanStats.totalScanned} {t('ui.generated.pesan_1a37732')} {(session as any).scanStats.dbCachedLoaded} {t('ui.generated.cache_655107f')} {(session as any).scanStats.newFromTg} {t('speedtest.perspective_telegram_short')}
              </div>
            )}
            {session.active && remainingAfterActive > 0 && (
              <p className="tm-hint">
                {t('ui.generated.pause_menahan_file_berikutnya_file_yang_sedang_j_9a25631')}
              </p>
            )}
            {session.active && session.items.length <= 1 && !session.paused && (
              <p className="tm-hint">
                {t('ui.generated.file_tunggal_tidak_bisa_dijeda_di_tengah_jalan_b_94c23ed')}{' '}
                <strong>{t('ui.generated.stop_9e25347')}</strong> {t('ui.generated.untuk_membatalkan_ebbd9b2')}
              </p>
            )}
          </div>

          {session.active && (
            <div className="tm-controls">
              {canResume ? (
                <button type="button" className="tm-btn primary" onClick={onResume}>
                  <Play size={14} /> {t('ui.generated.resume_b3bd0b5')}
                </button>
              ) : pauseUseful && remainingAfterActive > 0 ? (
                <button
                  type="button"
                  className="tm-btn"
                  onClick={onPause}
                  disabled={!canPause || !onPause}
                  title={pauseTitle}
                >
                  <Pause size={14} /> {t('ui.generated.pause_781961b')}
                </button>
              ) : null}
              <button type="button" className="tm-btn danger" onClick={onStop} disabled={!onStop}>
                <Square size={13} /> {t('ui.generated.stop_9e25347')}
              </button>
              <button
                type="button"
                className="tm-btn ghost"
                onClick={onToggleMinimize}
                title={t("speedtest.tm_minimize")}
              >
                <Maximize2 size={13} style={{ transform: 'scaleX(-1)' }} />
                {t('speedtest.show_less')}
              </button>
            </div>
          )}

          {!session.active && (
            <div className="tm-controls">
              <button
                type="button"
                className="tm-btn ghost"
                onClick={onToggleMinimize}
                title={t('speedtest.minimize_corner_tooltip')}
              >
                <Minimize2 size={13} /> {t('speedtest.show_less')}
              </button>
              {downloadFolderPath && onOpenDownloadFolder && (
                <button
                  type="button"
                  className="tm-btn primary"
                  onClick={onOpenDownloadFolder}
                  title={downloadFolderPath}
                >
                  <FolderOpen size={13} /> {t('speedtest.zip_open_folder')}
                </button>
              )}
              {canRetryFailed && onRetryFailed && counts.failed > 0 && (
                <button
                  type="button"
                  className="tm-btn"
                  onClick={onRetryFailed}
                  title={t('speedtest.retry_failed_files')}
                >
                  <RotateCcw size={13} /> {t('ui.generated.retry_gagal_24b252c')}{counts.failed})
                </button>
              )}
              {hasFinished && onClearDone && (
                <button type="button" className="tm-btn ghost" onClick={onClearDone}>
                  {t('ui.generated.clear_selesai_9193a9c')}
                </button>
              )}
              {onDismiss && (
                <button
                  type="button"
                  className="tm-btn ghost"
                  onClick={onDismiss}
                  title={t('speedtest.clear_transfer_history')}
                >
                  {t('ui.generated.tutup_riwayat_1b533f7')}
                </button>
              )}
            </div>
          )}

          <ul className="tm-list" aria-label={t('ui.generated.daftar_file_transfer_0308efc')}>
            {session.items.map((it: any) => (
              <li key={it.id} className={`tm-row status-${it.status}`}>
                <StatusIcon status={it.status} />
                <div className="tm-row-body">
                  <div className="tm-row-name-container">
                    <div className="tm-row-name" title={it.name}>
                      {it.name}
                    </div>
                    {it.destination && (
                      <span className="tm-row-dest" title={t("speedtest.tm_dest_tooltip", { dest: it.destination })}>
                        {it.destination}
                      </span>
                    )}
                  </div>
                  <div className="tm-row-meta">
                    {(it.status === 'done' || it.status === 'skipped') && <span>{t('speedtest.status_done')}</span>}
                    {it.status === 'skipped' && (
                      <span
                        className="tm-skip-badge-pill"
                        title={it.note || t('speedtest.file_exists_no_reupload')}
                        aria-label={`Dilewati: ${it.note || 'duplikat'}`}
                      >
                        <SkipForward size={9} />
                        {t('ui.generated.dilewati_4a88a03')}
                      </span>
                    )}
                    {it.status === 'failed' && (
                      <span className="tm-err-text">{it.error || t('ui.generated.gagal_224bc6b')}</span>
                    )}
                    {it.status === 'cancelled' && <span>{t('ui.generated.dibatalkan_1ed2b47')}</span>}
                    {it.status === 'uploaded' && <span>{t('ui.generated.media_terdaftar_d5fe3dc')}</span>}
                    {it.status === 'waiting_commit' && <span>{t('ui.generated.menunggu_urutan_commit_c65f549')}</span>}
                    {it.status === 'committing' && <span>{t('ui.generated.mengirim_pesan_3bb2873')}</span>}
                    {it.status === 'needs_verification' && (
                      <span className="tm-err-text">{t('ui.generated.perlu_verifikasi_tidak_diunggah_ulang_c7ea45a')}</span>
                    )}
                    {it.status === 'queued' && <span>{t('ui.generated.antre_c004b83')}</span>}
                    {it.status === 'paused' && <span>{t('jobs.status_paused')}</span>}
                    {it.status === 'preparing' && (
                      <span>{it.phase === 'reencode' ? t('speedtest.preflight_transform_reencode') : t('ui.generated.menyiapkan_36dd6d6')}</span>
                    )}
                    {(it.status === 'active' || it.status === 'preparing' || it.status === 'uploaded' || it.status === 'waiting_commit' || it.status === 'committing') && (
                      <>
                        <span>{it.percent.toFixed(0)}%</span>
                        {it.phase === 'reencode' && (it.encoderBackend || it.encoderName) && (
                          <span className="tm-encoder-badge" title={it.fallbackReason || undefined}>
                            {encoderLabel(it)}
                          </span>
                        )}
                        {it.phase === 'reencode' && !!it.fps && <span>{it.fps.toFixed(0)} {t('ui.generated.fps_fce204a')}</span>}
                        {it.phase === 'reencode' && !!it.encodeSpeed && (
                          <span>{it.encodeSpeed.toFixed(2)}{t('ui.generated.text_67fba2f')}</span>
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
                        className={`tm-mini-fill stage-${currentStage}`}
                        style={{ width: `${Math.min(100, Math.max(0, it.percent))}%` }}
                      />
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      <div className="tm-debug">
        <button
          type="button"
          className="tm-debug-toggle"
          onClick={() => setShowLogs((v) => !v)}
          aria-expanded={showLogs}
        >
          {showLogs ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          {t("speedtest.tm_log_debug", { count: debugLogs.length })}
        </button>
        {showLogs && (
          <div className="tm-debug-body">
            <div className="tm-debug-actions">
              <span className="tm-debug-hint" title={t('ui.generated.worker_temp_transfer_debug_txt_58b8a85')}>
                File: worker/temp/transfer_debug.txt
              </span>
              <button
                type="button"
                className="tm-btn ghost"
                disabled={!debugLogs.length && !session.banner}
                onClick={() => {
                  const text =
                    debugLogs.join('\n') ||
                    session.banner ||
                    '(log kosong — aktifkan Debug Mode di Settings untuk log penuh)';
                  void copyTextWithFallback(text).then((ok: any) => {
                    setCopyMsg(ok ? t('speedtest.zip_btn_copied') : t('ui.generated.gagal_salin_pilih_teks_manual_ea572ad'));
                    window.setTimeout(() => setCopyMsg(null), 2000);
                  });
                }}
                title={t('speedtest.copy_log_clipboard')}
              >
                <Copy size={12} /> {copyMsg || t('ui.generated.salin_276d054')}
              </button>
            </div>
            <pre className="tm-debug-pre" aria-label={t('ui.generated.transfer_debug_log_9d4658a')}>
              {debugLogs.length
                ? debugLogs.join('\n')
                : t('ui.generated.belum_ada_log_di_panel_aktifkan_debug_mode_di_se_742b245')}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
