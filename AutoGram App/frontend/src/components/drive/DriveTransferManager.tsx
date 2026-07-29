/**
 * Floating Transfer Manager — IDM-like expanded panel + Google Drive-style FAB.
 */
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
import type { TransferSession } from '../../lib/telegram/driveTypes';
import {
  formatDriveBytes,
  formatTransferEta,
  formatTransferSpeed,
} from '../../lib/telegram/driveTypes';
import {
  activeItemName,
  countByStatus,
  sessionVisible,
} from '../../lib/media/transferProgress';
import { copyTextWithFallback } from '../../lib/utils/debugMode';

type Props = {
  session: TransferSession;
  minimized: boolean;
  /** When true and session empty, still show panel shell (opened from topbar). */
  forceShow?: boolean;
  onToggleMinimize: () => void;
  onPause?: () => void;
  onResume?: () => void;
  onStop?: () => void;
  onClearDone?: () => void;
  onDismiss?: () => void;
  /** Open last download folder in system explorer */
  onOpenDownloadFolder?: () => void;
  downloadFolderPath?: string | null;
  /** Retry failed items (re-run last failed batch if possible) */
  onRetryFailed?: () => void;
  canRetryFailed?: boolean;
};

function StatusIcon({ status }: { status: string }) {
  // skipped: treated as done visually (green check), badge shows separately
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
}: Props) {
  const hasSession = sessionVisible(session);
  const visible = hasSession || forceShow;
  const counts = useMemo(() => countByStatus(session), [session]);
  const isUpload = session.direction === 'upload';
  const isMove = session.direction === 'move';
  const DirIcon = isMove ? FolderInput : isUpload ? Upload : Download;
  const isPreparing = session.items.some((i: any) => i.status === 'preparing');
  const encodeItem = session.items.find(
    (item: any) => item.phase === 'reencode' && item.status === 'preparing'
  );
  const displayPercent = encodeItem ? encodeItem.percent : session.overallPercent;
  const phaseLabel = isPreparing
    ? 'Re-encode'
    : isMove
      ? session.label?.startsWith('Salin')
        ? 'Menyalin'
        : 'Memindahkan'
      : isUpload
        ? 'Mengunggah'
        : 'Mengunduh';
  const activeName = activeItemName(session);
  const hasFinished = counts.done + counts.failed + counts.skipped + counts.needsVerification > 0;
  const isEmptyShell = !hasSession && forceShow;
  // Soft-pause only holds *next* files. With a single file already running there is
  // nothing left to hold — mid-file pause is not supported by Telegram/Telethon.
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
  // Move batch: pause not supported (sequential RPC); Stop cancels remaining
  const [showLogs, setShowLogs] = useState(false);
  const [copyMsg, setCopyMsg] = useState<string | null>(null);
  const debugLogs = session.debugLogs || [];

  useEffect(() => {
    // Auto-open log panel when debug lines arrive (Debug Mode / FALLBACK)
    if (debugLogs.length > 0 && debugLogs.some((l: any) => /FALLBACK|ERROR|FAILED/i.test(l))) {
      setShowLogs(true);
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

  // Minimized: compact Google Drive–style pill
  if (minimized) {
    if (!hasSession) return null;
    const pct = Math.min(100, Math.max(0, displayPercent));
    const statusLine = session.active
      ? phaseLabel
      : counts.failed
        ? 'Gagal'
        : counts.needsVerification
          ? 'Perlu verifikasi'
        : 'Selesai';
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
        title={`${tip} — klik untuk buka`}
        aria-label={`Transfer manager: ${tip}. Klik untuk membuka.`}
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
      aria-label="Transfer Manager"
      aria-live="polite"
      // Prevent accidental close — no outside-click dismiss
      onMouseDown={(e) => e.stopPropagation()}
    >
      <header className="tm-head">
        <div className="tm-head-title">
          <span className={`tm-dir-badge ${isUpload ? 'up' : 'down'}`}>
            <DirIcon size={14} />
          </span>
          <div className="tm-head-text">
            <strong>Transfer Manager</strong>
            <span className="tm-head-sub">
              {isEmptyShell
                ? 'Belum ada transfer'
                : session.active
                  ? session.paused
                    ? 'Dijeda'
                    : phaseLabel
                  : counts.failed
                    ? 'Selesai dengan error'
                    : counts.needsVerification
                      ? `${counts.needsVerification} perlu verifikasi`
                    : counts.skipped > 0 && counts.done === 0
                      ? `${counts.skipped} dilewati`
                      : counts.skipped > 0
                        ? `Selesai · ${counts.skipped} dilewati`
                        : counts.done
                          ? 'Selesai'
                          : 'Siap'}
              {!isEmptyShell && session.label ? ` · ${session.label}` : ''}
            </span>
          </div>
        </div>
        <div className="tm-head-actions">
          <button
            type="button"
            className="tm-icon-btn"
            onClick={onToggleMinimize}
            title="Minimize ke pojok (panel tetap bisa dibuka lagi)"
            aria-label="Minimize"
          >
            <Minimize2 size={15} />
          </button>
          <button
            type="button"
            className="tm-icon-btn"
            onClick={() => {
              // Always minimize first — never wipe history on X
              onToggleMinimize();
            }}
            title="Sembunyikan panel (minimize)"
            aria-label="Sembunyikan"
          >
            <X size={15} />
          </button>
        </div>
      </header>

      {isEmptyShell ? (
        <div className="tm-empty">
          <p>Belum ada unduhan/unggahan.</p>
          <p className="tm-hint">
            Mulai unduh atau unggah — progress akan tampil di sini. Panel tidak hilang saat
            klik di luar area drive.
          </p>
        </div>
      ) : (
        <>
          <div className="tm-summary">
            <div className="tm-summary-row">
              <span className="tm-summary-pct">{displayPercent.toFixed(1)}%</span>
              <span className="tm-summary-stats">
                {counts.total > 0 && (
                  <span>
                    {counts.done}/{counts.total} commit
                    {counts.skipped > 0 && (
                      <span className="tm-skip-badge" title="File dilewati karena sudah ada di tujuan">
                        &nbsp;·&nbsp;{counts.skipped} dilewati
                      </span>
                    )}
                    {(session as any).reuploadedCount > 0 && (
                      <span className="tm-reupload-badge" title="File dihapus dari tujuan lalu diunggah ulang otomatis">
                        &nbsp;·&nbsp;<RotateCcw size={11} style={{display:'inline',verticalAlign:'middle'}} />&nbsp;{(session as any).reuploadedCount} re-upload
                      </span>
                    )}
                    {counts.needsVerification > 0 && (
                      <span className="tm-skip-badge" title="Commit ambigu; AutoGram tidak mengunggah ulang byte">
                        &nbsp;·&nbsp;{counts.needsVerification} perlu verifikasi
                      </span>
                    )}
                  </span>
                )}
                {encodeItem && !!encodeItem.encodeSpeed && (
                  <span>{encodeItem.encodeSpeed.toFixed(2)}× realtime</span>
                )}
                {encodeItem && !!encodeItem.fps && <span>{encodeItem.fps.toFixed(0)} FPS</span>}
                {!encodeItem && session.speed_mb_s > 0.02 && (
                  <span>{formatTransferSpeed(session.speed_mb_s)}</span>
                )}
                {session.peak_mb_s > 0 && session.active && (
                  <span className="tm-muted">puncak {session.peak_mb_s.toFixed(2)}</span>
                )}
                {encodeItem && encodeItem.encodeEtaSeconds != null && (
                  <span>ETA {formatTransferEta(encodeItem.encodeEtaSeconds)}</span>
                )}
                {!encodeItem && session.active && session.etaSeconds != null && (
                  <span>ETA {formatTransferEta(session.etaSeconds)}</span>
                )}
              </span>
            </div>
            <div
              className="tm-bar"
              role="progressbar"
              aria-valuenow={Math.round(displayPercent)}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <div
                className="tm-bar-fill"
                style={{ width: `${Math.min(100, Math.max(0, displayPercent))}%` }}
              />
            </div>
            {encodeItem?.estimatedOutputBytes ? (
              <div className="tm-bytes">
                Perkiraan output {formatDriveBytes(encodeItem.estimatedOutputBytes)}
              </div>
            ) : !encodeItem && (session.transferred > 0 || session.total > 0) && (
              <div className="tm-bytes">
                {formatDriveBytes(session.transferred)}
                {session.total > 0 ? ` / ${formatDriveBytes(session.total)}` : ''}
              </div>
            )}
            {session.banner && <div className="tm-banner">{session.banner}</div>}
            {/* Scan progress indicator — shown during SmartScanner pre-scan phase */}
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
                ✓ Scan: {(session as any).scanStats.totalScanned} pesan · {(session as any).scanStats.dbCachedLoaded} cache · {(session as any).scanStats.newFromTg} Telegram
              </div>
            )}
            {session.active && remainingAfterActive > 0 && (
              <p className="tm-hint">
                Pause menahan file berikutnya (file yang sedang jalan tetap diselesaikan).
              </p>
            )}
            {session.active && session.items.length <= 1 && !session.paused && (
              <p className="tm-hint">
                File tunggal tidak bisa dijeda di tengah jalan (batas Telegram). Gunakan{' '}
                <strong>Stop</strong> untuk membatalkan.
              </p>
            )}
          </div>

          {session.active && (
            <div className="tm-controls">
              {canResume ? (
                <button type="button" className="tm-btn primary" onClick={onResume}>
                  <Play size={14} /> Resume
                </button>
              ) : pauseUseful && remainingAfterActive > 0 ? (
                <button
                  type="button"
                  className="tm-btn"
                  onClick={onPause}
                  disabled={!canPause || !onPause}
                  title={pauseTitle}
                >
                  <Pause size={14} /> Pause
                </button>
              ) : null}
              <button type="button" className="tm-btn danger" onClick={onStop} disabled={!onStop}>
                <Square size={13} /> Stop
              </button>
              <button
                type="button"
                className="tm-btn ghost"
                onClick={onToggleMinimize}
                title="Minimize ke pojok"
              >
                <Maximize2 size={13} style={{ transform: 'scaleX(-1)' }} />
                Sembunyikan
              </button>
            </div>
          )}

          {!session.active && (
            <div className="tm-controls">
              <button
                type="button"
                className="tm-btn ghost"
                onClick={onToggleMinimize}
                title="Minimize ke pojok — buka lagi lewat FAB atau tombol top bar"
              >
                <Minimize2 size={13} /> Sembunyikan
              </button>
              {downloadFolderPath && onOpenDownloadFolder && (
                <button
                  type="button"
                  className="tm-btn primary"
                  onClick={onOpenDownloadFolder}
                  title={downloadFolderPath}
                >
                  <FolderOpen size={13} /> Buka folder
                </button>
              )}
              {canRetryFailed && onRetryFailed && counts.failed > 0 && (
                <button
                  type="button"
                  className="tm-btn"
                  onClick={onRetryFailed}
                  title="Ulangi file yang gagal"
                >
                  <RotateCcw size={13} /> Retry gagal ({counts.failed})
                </button>
              )}
              {hasFinished && onClearDone && (
                <button type="button" className="tm-btn ghost" onClick={onClearDone}>
                  Clear selesai
                </button>
              )}
              {onDismiss && (
                <button
                  type="button"
                  className="tm-btn ghost"
                  onClick={onDismiss}
                  title="Hapus riwayat transfer dari panel"
                >
                  Tutup riwayat
                </button>
              )}
            </div>
          )}

          <ul className="tm-list" aria-label="Daftar file transfer">
            {session.items.map((it: any) => (
              <li key={it.id} className={`tm-row status-${it.status}`}>
                <StatusIcon status={it.status} />
                <div className="tm-row-body">
                  <div className="tm-row-name-container">
                    <div className="tm-row-name" title={it.name}>
                      {it.name}
                    </div>
                    {it.destination && (
                      <span className="tm-row-dest" title={`Tujuan: ${it.destination}`}>
                        {it.destination}
                      </span>
                    )}
                  </div>
                  <div className="tm-row-meta">
                    {(it.status === 'done' || it.status === 'skipped') && <span>Selesai</span>}
                    {it.status === 'skipped' && (
                      <span
                        className="tm-skip-badge-pill"
                        title={it.note || 'File sudah ada di tujuan — tidak diunggah ulang'}
                        aria-label={`Dilewati: ${it.note || 'duplikat'}`}
                      >
                        <SkipForward size={9} />
                        Dilewati
                      </span>
                    )}
                    {it.status === 'failed' && (
                      <span className="tm-err-text">{it.error || 'Gagal'}</span>
                    )}
                    {it.status === 'cancelled' && <span>Dibatalkan</span>}
                    {it.status === 'uploaded' && <span>Media terdaftar</span>}
                    {it.status === 'waiting_commit' && <span>Menunggu urutan commit</span>}
                    {it.status === 'committing' && <span>Mengirim pesanâ€¦</span>}
                    {it.status === 'needs_verification' && (
                      <span className="tm-err-text">Perlu verifikasi â€” tidak diunggah ulang</span>
                    )}
                    {it.status === 'queued' && <span>Antre</span>}
                    {it.status === 'paused' && <span>Dijeda</span>}
                    {it.status === 'preparing' && (
                      <span>{it.phase === 'reencode' ? 'Re-encode' : 'Menyiapkan…'}</span>
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
                          <span>{it.encodeSpeed.toFixed(2)}×</span>
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
                        className="tm-mini-fill"
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
          Log debug ({debugLogs.length})
        </button>
        {showLogs && (
          <div className="tm-debug-body">
            <div className="tm-debug-actions">
              <span className="tm-debug-hint" title="worker/temp/transfer_debug.txt">
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
                    setCopyMsg(ok ? 'Tersalin' : 'Gagal salin — pilih teks manual');
                    window.setTimeout(() => setCopyMsg(null), 2000);
                  });
                }}
                title="Salin log ke clipboard (fallback textarea jika API diblokir)"
              >
                <Copy size={12} /> {copyMsg || 'Salin'}
              </button>
            </div>
            <pre className="tm-debug-pre" aria-label="Transfer debug log">
              {debugLogs.length
                ? debugLogs.join('\n')
                : 'Belum ada log di panel. Aktifkan Debug Mode di Settings, atau unggah/unduh lagi. Cari FALLBACK / PROGRESS.'}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
