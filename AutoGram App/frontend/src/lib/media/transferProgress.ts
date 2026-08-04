/**
 * Pure reducer for Media Studio transfer progress events.
 * Keeps filenames, bytes, ETA — never overwrites names with message ids.
 */
import type {
  TransferDirection,
  TransferItem,
  TransferItemStatus,
  TransferSession,
} from '../telegram/driveTypes';
import { EMPTY_TRANSFER_SESSION } from '../telegram/driveTypes';

export type ProgressEvent = {
  type?: string;
  payload?: Record<string, unknown>;
  [key: string]: unknown;
};

function payloadOf(ev: ProgressEvent): Record<string, unknown> {
  if (ev.payload && typeof ev.payload === 'object') {
    return { ...ev, ...(ev.payload as Record<string, unknown>) };
  }
  return ev as Record<string, unknown>;
}

function num(v: unknown, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function str(v: unknown): string {
  return v == null ? '' : String(v);
}

function basename(path: string): string {
  const s = path.replace(/\\/g, '/');
  const i = s.lastIndexOf('/');
  return i >= 0 ? s.slice(i + 1) : s;
}

function computeEta(
  transferred: number,
  total: number,
  speed_mb_s: number
): number | null {
  if (total <= 0 || transferred >= total) return null;
  if (!Number.isFinite(speed_mb_s) || speed_mb_s < 0.05) return null;
  const remain = total - transferred;
  const bytesPerSec = speed_mb_s * 1024 * 1024;
  if (bytesPerSec <= 0) return null;
  return remain / bytesPerSec;
}

function ensureItem(
  items: TransferItem[],
  index: number,
  direction: TransferDirection,
  patch?: Partial<TransferItem>
): TransferItem[] {
  const next = items.slice();
  while (next.length <= index) {
    const i = next.length;
    next.push({
      id: `${direction}-${i}`,
      index: i,
      name: `File ${i + 1}`,
      direction,
      status: 'queued',
      percent: 0,
      transferred: 0,
      total: 0,
      speed_mb_s: 0,
    });
  }
  if (patch) {
    next[index] = { ...next[index], ...patch, index, id: next[index].id };
  }
  return next;
}

export function recomputeOverall(session: TransferSession): TransferSession {
  const items = session.items;
  const n = items.length;
  let transferred = session.transferred;
  let total = session.total;
  let overall = session.overallPercent;

  if (n > 0) {
    const itemTransferred = items.reduce((s, i) => s + (i.transferred || 0), 0);
    if (itemTransferred > transferred) transferred = itemTransferred;

    const itemTotals = items.reduce((s, i) => s + (i.total || 0), 0);
    if (itemTotals > total) total = itemTotals;

    if (total > 0) {
      overall = Math.min(100, (transferred / total) * 100);
    } else {
      const sumPct = items.reduce((s, i) => {
        if (
          i.status === 'done' ||
          i.status === 'skipped' ||
          i.status === 'failed' ||
          i.status === 'cancelled' ||
          i.status === 'needs_verification'
        ) return s + 100;
        return s + (i.percent || 0);
      }, 0);
      overall = sumPct / n;
    }
  }

  return {
    ...session,
    transferred,
    total,
    overallPercent: Math.round(overall * 100) / 100,
    etaSeconds: computeEta(transferred, total, session.speed_mb_s),
  };
}

export type SeedTransferOpts = {
  direction: TransferDirection;
  names: string[];
  label?: string;
  totals?: number[];
  jobKey?: string;
  destination?: string;
  destinations?: string[];
};

/** Create a fresh session when user starts an upload/download. */
export function seedTransferSession(opts: SeedTransferOpts): TransferSession {
  const direction = opts.direction;
  const jobKey = opts.jobKey || `${direction}-${Date.now()}`;
  const items: TransferItem[] = opts.names.map((name, index) => ({
    id: `${jobKey}-${index}`,
    index,
    name: name || `File ${index + 1}`,
    direction,
    status: 'queued' as const,
    percent: 0,
    transferred: 0,
    total: opts.totals?.[index] ?? 0,
    speed_mb_s: 0,
    destination: opts.destinations?.[index] ?? opts.destination ?? opts.label ?? '',
  }));
  const total = items.reduce((s, i) => s + (i.total || 0), 0);
  return {
    ...EMPTY_TRANSFER_SESSION,
    jobKey,
    direction,
    active: true,
    paused: false,
    label: opts.label || '',
    items,
    total,
    startedAt: Date.now(),
  };
}

export function markTransferFinished(
  session: TransferSession,
  status: 'done' | 'cancelled' | 'failed' = 'done'
): TransferSession {
  const items = session.items.map((it) => {
    if (it.status === 'done' || it.status === 'failed' || it.status === 'cancelled' || it.status === 'skipped' || it.status === 'needs_verification') return it;
    if (status === 'cancelled') {
      return { ...it, status: 'cancelled' as const };
    }
    if (status === 'failed') {
      return {
        ...it,
        status: 'failed' as const,
        error: it.error || session.banner || 'Gagal',
      };
    }
    // status === 'done': complete anything still open
    if (
      it.status === 'active' ||
      it.status === 'preparing' ||
      it.status === 'queued' ||
      it.status === 'paused'
    ) {
      return { ...it, status: 'done' as const, percent: 100 };
    }
    return it;
  });
  const finished = recomputeOverall({
    ...session,
    active: false,
    paused: false,
    items,
    speed_mb_s: 0,
    etaSeconds: null,
    banner: status === 'failed' ? session.banner : undefined,
  });
  return {
    ...finished,
    overallPercent: status === 'done' && !items.some((i) => i.status === 'failed' || i.status === 'cancelled') ? 100 : finished.overallPercent,
  };
}

export function clearFinishedItems(session: TransferSession): TransferSession {
  const items = session.items.filter(
    (i) => i.status !== 'done' && i.status !== 'failed' && i.status !== 'cancelled' && i.status !== 'skipped' && i.status !== 'needs_verification'
  );
  if (!items.length && !session.active) {
    return { ...EMPTY_TRANSFER_SESSION };
  }
  return recomputeOverall({ ...session, items });
}

export function setSessionPaused(session: TransferSession, paused: boolean): TransferSession {
  if (!session.active) return session;
  const items = session.items.map((it) => {
    if (!paused) {
      if (it.status === 'paused') return { ...it, status: 'queued' as const };
      return it;
    }
    // Soft-pause: only queued items show paused; active keeps running until done
    if (it.status === 'queued') return { ...it, status: 'paused' as const };
    return it;
  });
  return {
    ...session,
    paused,
    items,
    banner: paused
      ? 'Dijeda — file aktif selesai dulu, berikutnya ditahan'
      : undefined,
  };
}

function appendDebugLog(session: TransferSession, logLine: string): string[] {
  const prev = session.debugLogs || [];
  const timeStr = new Date().toLocaleTimeString('id-ID', { hour12: false });
  const entry = `[${timeStr}] ${logLine}`;
  const next = [...prev, entry];
  return next.length > 200 ? next.slice(next.length - 200) : next;
}

/**
 * Apply a worker [EVENT] line payload to the transfer session.
 */
export function applyTransferEvent(
  session: TransferSession,
  ev: ProgressEvent
): TransferSession {
  const t = str(ev.type || '');
  const p = payloadOf(ev);

  if (t === 'StudioStarted' || t === 'DriveListStarted') {
    const mode = str(p.mode || '').toLowerCase();
    const direction: TransferDirection =
      mode.includes('download') || session.direction === 'download'
        ? 'download'
        : mode.includes('upload')
          ? 'upload'
          : session.direction || 'upload';
    const n = Math.max(num(p.items, session.items.length || 0), session.items.length);
    let items = session.items.slice();
    if (items.length < n) {
      for (let i = items.length; i < n; i++) {
        items = ensureItem(items, i, direction);
      }
    }
    const totalBytes = num(p.total_bytes, session.total);
    const debugLogs = appendDebugLog(session, `Mulai transfer ${direction} (${n} item)`);
    return recomputeOverall({
      ...session,
      debugLogs,
      active: true,
      direction,
      items,
      total: totalBytes > 0 ? totalBytes : session.total,
      label: session.label,
    });
  }

  if (t === 'StudioItemPrepare') {
    const index = num(p.index, 0);
    const name = basename(str(p.path || p.file_name || '')) || undefined;
    const phase = str(p.phase || 'prepare');
    const items = ensureItem(session.items, index, session.direction, {
      status: 'preparing',
      phase: phase === 'probe' ? 'probe' : phase,
      percent: phase === 'reencoded' ? session.items[index]?.percent ?? 100 : 3,
      encoderBackend: str(p.encoder_backend || session.items[index]?.encoderBackend || '') || undefined,
      encoderName: str(p.encoder_name || session.items[index]?.encoderName || '') || undefined,
      decoderName: str(p.decoder_name || session.items[index]?.decoderName || '') || undefined,
      estimatedOutputBytes: num(p.output_bytes, session.items[index]?.estimatedOutputBytes || 0) || undefined,
      ...(name ? { name } : {}),
    });
    const debugLogs = appendDebugLog(session, `Item ${index + 1} (${name || 'File'}): Menyiapkan (${phase})`);
    return {
      ...session,
      debugLogs,
      active: true,
      items,
      banner:
        phase === 'probe'
          ? 'Menyiapkan video (probe/re-encode)…'
          : phase === 'reencoded'
            ? 'Re-encode selesai — mulai unggah…'
            : phase === 'prepare_failed' || phase === 'rejected_oversize'
              ? p.budget_failure || p.size_fit_required
                ? 'Prepare gagal: file melebihi batas unggah akun (bukan unggah file asli).'
                : str(p.error || '')
                  ? `Prepare gagal: ${str(p.error)}`
                  : 'Prepare gagal — unggahan dihentikan.'
              : undefined,
      overallPercent: Math.max(session.overallPercent, phase === 'reencoded' ? 5 : 2),
    };
  }

  if (t === 'StudioReencodeStarted') {
    const index = num(p.index, 0);
    const planned =
      num(p.planned_target_bytes, 0) ||
      num(p.budget_bytes, 0) ||
      num(p.estimated_output_bytes, 0);
    const items = ensureItem(session.items, index, session.direction, {
      status: 'preparing',
      phase: 'reencode',
      percent: 0,
      transferred: 0,
      speed_mb_s: 0,
      encoderBackend: str(p.backend || '') || undefined,
      encoderName: str(p.encoder || '') || undefined,
      decoderName: str(p.decoder || '') || undefined,
      fallbackReason: str(p.fallback_reason || '') || undefined,
      encodeEtaSeconds: null,
      // Seed estimate from account-budget plan (not unconstrained ffmpeg guess)
      ...(planned > 0 ? { estimatedOutputBytes: planned } : {}),
    });
    const backend = str(p.backend || '').toUpperCase();
    const encoder = str(p.encoder || 'H.264');
    return {
      ...session,
      active: true,
      items,
      banner: `Re-encode ${backend || 'GPU'} · ${encoder}`,
    };
  }

  if (t === 'StudioReencodeProgress') {
    const index = num(p.index, 0);
    const prevEst = session.items[index]?.estimatedOutputBytes || 0;
    const est = num(p.estimated_output_bytes, 0);
    // Prefer worker budget-capped estimate; never clear a planned seed with 0
    const nextEst = est > 0 ? est : prevEst || undefined;
    const items = ensureItem(session.items, index, session.direction, {
      status: 'preparing',
      phase: 'reencode',
      percent: Math.max(0, Math.min(100, num(p.percent, session.items[index]?.percent || 0))),
      fps: num(p.fps, 0),
      encodeSpeed: num(p.speed_x, 0),
      estimatedOutputBytes: nextEst,
      encodeEtaSeconds: p.eta_s == null ? null : num(p.eta_s, 0),
      encoderBackend: str(p.backend || session.items[index]?.encoderBackend || '') || undefined,
      encoderName: str(p.encoder || session.items[index]?.encoderName || '') || undefined,
      decoderName: str(p.decoder || session.items[index]?.decoderName || '') || undefined,
    });
    return { ...session, active: true, items, banner: undefined };
  }

  if (t === 'StudioReencodeDone') {
    const index = num(p.index, 0);
    const outBytes = num(p.output_bytes ?? p.total, 0);
    const items = ensureItem(session.items, index, session.direction, {
      status: 'preparing',
      phase: 'reencode',
      percent: 100,
      estimatedOutputBytes: outBytes || session.items[index]?.estimatedOutputBytes || undefined,
      ...(outBytes > 0 ? { total: outBytes } : {}),
      encodeEtaSeconds: null,
      encoderBackend: str(p.backend || session.items[index]?.encoderBackend || '') || undefined,
      encoderName: str(p.encoder || session.items[index]?.encoderName || '') || undefined,
      decoderName: str(p.decoder || session.items[index]?.decoderName || '') || undefined,
      fallbackReason: str(p.fallback_reason || session.items[index]?.fallbackReason || '') || undefined,
    });
    return { ...session, active: true, items, banner: 'Re-encode selesai · menyiapkan upload' };
  }

  if (t === 'StudioItemPhase') {
    const index = num(p.index ?? p.item_index, 0);
    const phase = str(p.phase || '').toLowerCase();
    const status: TransferItemStatus =
      phase === 'media_registered'
        ? 'uploaded'
        : phase === 'waiting_commit'
          ? 'waiting_commit'
          : phase === 'committing'
            ? 'committing'
            : phase === 'preflight' || phase === 'media_registering'
              ? 'preparing'
              : session.items[index]?.status || 'active';
    const items = ensureItem(session.items, index, session.direction, {
      status,
      phase,
      ...(phase === 'media_registered' ? { percent: 100 } : {}),
    });
    return recomputeOverall({ ...session, active: true, items, banner: undefined });
  }

  if (t === 'StudioItemStarted' || t === 'DriveItemStarted') {
    const index = num(p.index ?? p.item_index, 0);
    const name =
      basename(str(p.path || p.file_name || p.name || '')) || undefined;
    const size = num(p.size, 0);
    const items = ensureItem(session.items, index, session.direction, {
      status: 'active',
      ...(name ? { name } : {}),
      ...(size > 0 ? { total: size } : {}),
    });
    // Mark other non-terminal as not active (except parallel cases keep previous)
    return recomputeOverall({
      ...session,
      active: true,
      items,
      banner: undefined,
    });
  }

  if (t === 'StudioProgress' || t === 'DriveProgress') {
    const phaseRaw = str(p.phase || '').toLowerCase();
    const direction: TransferDirection =
      phaseRaw === 'download'
        ? 'download'
        : phaseRaw === 'upload'
          ? 'upload'
          : session.direction;

    const index = num(p.item_index ?? p.index, 0);
    const itemsTotal = num(p.items_total, session.items.length);
    let items = session.items.slice();
    if (itemsTotal > items.length) {
      for (let i = items.length; i < itemsTotal; i++) {
        items = ensureItem(items, i, direction);
      }
    }

    // Prefer explicit item_* ; treat 0 as valid. Fall back to overall transferred.
    const hasItemCur = p.item_current != null && p.item_current !== '';
    const itemCurrent = hasItemCur ? num(p.item_current, 0) : num(p.transferred, 0);
    const eventItemTotal = num(p.item_total ?? p.total ?? 0, 0);
    const perTransferred = itemCurrent;
    const perTotal =
      eventItemTotal > 0
        ? eventItemTotal
        : items[index]?.total || 0;
    const eventPct = num(p.percent, -1);
    const perPct =
      perTotal > 0
        ? Math.min(100, (perTransferred / perTotal) * 100)
        : eventPct >= 0
          ? eventPct
          : items[index]?.percent ?? 0;

    const fileName = basename(str(p.file_name || p.path || ''));
    items = ensureItem(items, index, direction, {
      status: phaseRaw === 'reencode' ? 'preparing' : 'active',
      phase: phaseRaw || (direction === 'download' ? 'download' : 'upload'),
      percent: Math.round(perPct * 100) / 100,
      transferred: perTransferred,
      ...(perTotal > 0 ? { total: perTotal } : {}),
      speed_mb_s: num(p.speed_mb_s, items[index]?.speed_mb_s ?? 0),
      // Never replace existing name with empty or msg-id style
      ...(fileName && !/^\d+$/.test(fileName) ? { name: fileName } : {}),
    });

    const overallTransferred = num(p.transferred, session.transferred);
    const overallTotal = num(p.total, session.total);
    // Worker emits recent-window speed (not lifetime avg diluted by prepare/stall)
    const speed = num(p.speed_mb_s, session.speed_mb_s);
    const peak = Math.max(session.peak_mb_s, num(p.peak_mb_s, 0));
    let overallPercent = eventPct >= 0 ? eventPct : session.overallPercent;
    if (overallTotal > 0 && overallTransferred >= 0) {
      overallPercent = Math.min(100, (overallTransferred / overallTotal) * 100);
    }
    // Never go backwards on a live transfer (avoids 5% → 0% flicker)
    overallPercent = Math.max(session.overallPercent, overallPercent);

    const next = recomputeOverall({
      ...session,
      active: true,
      direction,
      items,
      transferred: Math.max(session.transferred, overallTransferred),
      total: overallTotal > 0 ? overallTotal : session.total,
      speed_mb_s: speed,
      peak_mb_s: peak,
      overallPercent,
      banner: undefined,
    });
    // Prefer worker-computed ETA when present (same windowed rate as speed meter)
    if (p.eta_s != null && p.eta_s !== '') {
      const eta = num(p.eta_s, -1);
      if (eta >= 0) {
        return { ...next, etaSeconds: eta };
      }
    }
    return next;
  }

  if (t === 'StudioItemDone' || t === 'DriveItemDone') {
    const index = num(p.index ?? p.item_index, 0);
    const statusRaw = str(p.status || 'done').toLowerCase();
    const note = str(p.note || '');
    // Detect skip: backend sends status='skipped' OR status='done' with a 'Duplicate skipped' note
    const isSkipped =
      statusRaw === 'skipped' ||
      (statusRaw === 'done' && /duplicate.?skipped|dilewati/i.test(note));
    const needsVerification = statusRaw === 'needs_verification';
    const ok = !isSkipped && !needsVerification && (statusRaw === 'done' || statusRaw === 'ok' || statusRaw === 'success');
    const err = str(p.error || '');
    const name = basename(str(p.path || p.file_name || ''));
    const size = num(p.size, 0);
    const mid = num(p.message_id ?? p.messageId, 0);
    const prev = session.items[index];
    // Never downgrade a successful item to failed — even if messageId was not
    // stored yet (StudioItemDone done without mid), or mid arrives with failed.
    const alreadyDone = prev?.status === 'done';
    const prevMid =
      num((prev as { messageId?: number } | undefined)?.messageId, 0) ||
      num((prev as { message_id?: number } | undefined)?.message_id, 0);
    const alreadyCommitted = alreadyDone || prevMid > 0;
    // Skipped takes precedence only if not already committed as a real success
    const finalSkipped = isSkipped && !alreadyCommitted;
    const hasCommitProof = ok || t !== 'StudioItemDone' || mid > 0 || alreadyCommitted;
    const finalOk = !finalSkipped && (ok || alreadyCommitted || mid > 0);
    const skipNote = finalSkipped
      ? (note || 'Duplikat dilewati — sudah ada di tujuan')
      : undefined;
    const logText = `Item ${index + 1} (${name || `File ${index + 1}`}): ${finalOk ? 'SELESAI' : finalSkipped ? 'DILEWATI' : 'GAGAL'} ${mid > 0 ? `[msg_id: ${mid}]` : ''} ${err ? `err: ${err}` : ''}`.trim();
    const debugLogs = appendDebugLog(session, logText);
    const items = ensureItem(session.items, index, session.direction, {
      status: needsVerification ? 'needs_verification' : finalSkipped ? 'skipped' : finalOk ? 'done' : 'failed',
      percent: (needsVerification || finalSkipped || finalOk) ? 100 : session.items[index]?.percent ?? 0,
      ...(size > 0
        ? {
            total: size,
            transferred: (needsVerification || finalSkipped || finalOk) ? size : session.items[index]?.transferred ?? 0,
          }
        : (needsVerification || finalSkipped || finalOk)
          ? { transferred: session.items[index]?.total || session.items[index]?.transferred || 0 }
          : {}),
      ...(name ? { name } : {}),
      ...(finalOk ? { error: undefined, note: undefined } : {}),
      ...(finalSkipped ? { note: skipNote, error: undefined } : {}),
      ...(needsVerification ? { note: note || 'Commit perlu diverifikasi; byte tidak diunggah ulang.', error: err || undefined } : {}),
      ...(!finalOk && !finalSkipped && err ? { error: err } : {}),
      ...(mid > 0 ? { messageId: mid } : {}),
      speed_mb_s: 0,
    });
    return recomputeOverall({
      ...session,
      debugLogs,
      items,
      committedCount: items.filter((i) => i.status === 'done').length,
      needsVerificationCount: items.filter((i) => i.status === 'needs_verification').length,
      banner: (finalOk || finalSkipped) ? undefined : session.banner,
    });
  }

  if (t === 'FloodWait') {
    const seconds = num(p.seconds ?? (p as any).payload?.seconds, 0);
    return {
      ...session,
      active: true,
      banner: `Menunggu Telegram (FloodWait) ${seconds || '?'} detik…`,
    };
  }

  if (t === 'FloodWaitTick') {
    const remaining = num(p.remaining ?? (p as any).payload?.remaining, 0);
    return {
      ...session,
      active: true,
      banner: `Menunggu Telegram (FloodWait): sisa ${remaining || '?'} detik…`,
    };
  }

  if (t === 'FloodWaitResolved') {
    return {
      ...session,
      active: true,
      banner: undefined,
    };
  }

  if (t === 'StudioPaused' || t === 'DrivePaused') {
    return setSessionPaused(session, true);
  }

  if (t === 'StudioResumed' || t === 'DriveResumed') {
    return setSessionPaused(session, false);
  }

  if (t === 'StudioFinished' || t === 'DriveDownloadDone') {
    // Never synthesize success. Every upload item must have a terminal event
    // with message_id, verified duplicate, explicit failure, or verification state.
    const items = session.items.map((it) => {
      if (
        it.status === 'done' ||
        it.status === 'failed' ||
        it.status === 'cancelled' ||
        it.status === 'skipped' ||
        it.status === 'needs_verification'
      ) {
        return it;
      }
      if (t === 'DriveDownloadDone') return { ...it, status: 'done' as const, percent: 100 };
      return {
        ...it,
        status: 'failed' as const,
        error: it.error || 'Worker selesai tanpa bukti terminal/message_id.',
      };
    });
    const anyFailed = items.some((i) => i.status === 'failed' || i.status === 'needs_verification');
    const finished = recomputeOverall({
      ...session,
      active: false,
      paused: false,
      items,
      speed_mb_s: 0,
      etaSeconds: null,
      banner: anyFailed ? session.banner || 'Selesai dengan error' : undefined,
    });
    return {
      ...finished,
      overallPercent: finished.overallPercent,
      committedCount: items.filter((i) => i.status === 'done').length,
      needsVerificationCount: items.filter((i) => i.status === 'needs_verification').length,
    };
  }

  if (t === 'StudioFailed' || t === 'DriveFailed') {
    let err = str(p.error || p.message || 'Transfer gagal');
    const low = err.toLowerCase();
    if (
      low.includes('database is locked') ||
      low.includes('database locked') ||
      low.includes('sqlite_busy')
    ) {
      err =
        'Session Telegram sedang dipakai proses lain. Coba unduh lagi — sistem akan melepaskan drive-serve otomatis.';
    }
    // If every item already committed successfully, do not paint the session as gagal.
    const allDone =
      session.items.length > 0 &&
      session.items.every((i) => i.status === 'done' || i.status === 'cancelled');
    const anyDone = session.items.some((i) => i.status === 'done');
    if (allDone) {
      return markTransferFinished(
        { ...session, banner: undefined },
        'done'
      );
    }
    if (anyDone) {
      return markTransferFinished(
        {
          ...session,
          banner: `Selesai sebagian — ${err}`,
        },
        'failed'
      );
    }
    return markTransferFinished({ ...session, banner: err }, 'failed');
  }

  if (t === 'StudioWarning' || t === 'StudioInfo') {
    const msg = str(p.message || '');
    if (!msg) return session;
    return { ...session, banner: msg };
  }

  if (t === 'TransferLog' || t === 'DebugLog') {
    const level = str(p.level || 'INFO');
    const phase = str(p.phase || '');
    const scope = str(p.scope || '');
    const msg = str(p.message || p.msg || '');
    const line = [
      level,
      scope ? `{${scope}}` : '',
      phase ? `[${phase}]` : '',
      msg,
      p.error ? `err=${p.error}` : '',
      p.transferred != null ? `${p.transferred}/${p.file_size ?? '?'}` : '',
    ]
      .filter(Boolean)
      .join(' ');
    const prevLogs = session.debugLogs || [];
    if (prevLogs[prevLogs.length - 1] === line) return session;
    const logs = [...prevLogs, line].slice(-80);
    // Surface critical fallback on banner so user sees re-download reason
    const isFallback =
      /FALLBACK|re-download|incomplete|FAILED/i.test(msg) || level === 'ERROR';
    return {
      ...session,
      debugLogs: logs,
      banner: isFallback ? msg.slice(0, 160) : session.banner,
    };
  }

  // ── Scan Progress Events (new SmartScanner protocol) ─────────────────
  if (t === 'StudioScanProgress') {
    const phase = str(p.phase || 'scanning');
    const scanned = num(p.scanned, session.scanScanned ?? 0);
    const totalEst = p.totalEstimated != null ? num(p.totalEstimated, 0) || null : null;
    const phaseLabelMap: Record<string, string> = {
      cache_warmup: 'Memuat cache…',
      recent:    'Memindai 1.000 pesan terakhir…',
      sampling:  'Sampling adaptif riwayat…',
      forensic:  'Pemindaian forensik (semua pesan)…',
    };
    const bannerText = phaseLabelMap[phase] ?? `Memindai destination… (${scanned} pesan)`;
    return {
      ...session,
      active: true,
      scanPhase: phase,
      scanScanned: scanned,
      scanTotal: totalEst,
      banner: bannerText,
    };
  }

  if (t === 'StudioScanComplete') {
    const stats = p.scanStats as Record<string, unknown> | undefined;
    const indexSize = num(p.indexSize, 0);
    const duration = num(p.durationSeconds, 0);
    const cached = stats ? num(stats.dbCachedLoaded, 0) : 0;
    const fromTg  = stats ? num(stats.newFromTg, 0) : 0;
    const bannerText = `Pemindaian selesai — ${indexSize} entri (${cached} cache + ${fromTg} Telegram) dalam ${duration.toFixed(1)}s`;
    return {
      ...session,
      active: true,
      scanPhase: 'done',
      scanScanned: num(p.indexSize, session.scanScanned),
      scanStats: stats
        ? {
            recentScanned:  num(stats.recentScanned,  0),
            sampledScanned: num(stats.sampledScanned, 0),
            dbCachedLoaded: num(stats.dbCachedLoaded, 0),
            newFromTg:      num(stats.newFromTg,      0),
            duplicateHits:  num(stats.duplicateHits,  0),
            skippedNoMedia: num(stats.skippedNoMedia, 0),
            circuitOpen:    Boolean(stats.circuitOpen),
            totalScanned:   num(stats.totalScanned,   0),
          }
        : session.scanStats,
      banner: bannerText,
    };
  }

  // ── Reupload Badge Event ──────────────────────────────────────────────
  if (t === 'StudioItemReupload') {
    const index  = num(p.index, 0);
    const mid    = num(p.message_id ?? p.messageId, 0);
    const origMid = num(p.originalMessageId ?? p.original_message_id, 0);
    const reason = str(p.reuploadReason ?? p.reupload_reason ?? 'deleted_from_destination');
    const deletedAt = num(p.deletedAt ?? p.deleted_at, 0);
    const items = ensureItem(session.items, index, session.direction, {
      reuploaded: true,
      reuploadReason: reason,
      ...(mid > 0 ? { messageId: mid } : {}),
      ...(origMid > 0 ? { originalMessageId: origMid } : {}),
      ...(deletedAt > 0 ? { deletedAt } : {}),
      note: 'File dihapus dari tujuan lalu diunggah ulang',
    });
    const reuploadedCount = items.filter((i) => (i as any).reuploaded).length;
    return {
      ...session,
      items,
      reuploadedCount,
    };
  }

  return session;
}

/** Parse raw stdout line `[TRANSFER]` / `[DEBUG]` JSON into session debug log. */
export function applyTransferStdoutLine(
  session: TransferSession,
  line: string
): TransferSession {
  const text = String(line || '');
  let marker = '';
  let idx = text.indexOf('[TRANSFER]');
  if (idx >= 0) marker = '[TRANSFER]';
  else {
    idx = text.indexOf('[DEBUG]');
    if (idx >= 0) marker = '[DEBUG]';
  }
  if (idx < 0 || !marker) return session;
  const raw = text.slice(idx + marker.length).trim();
  let pretty = raw;
  try {
    const o = JSON.parse(raw) as Record<string, unknown>;
    pretty = [
      o.level || 'INFO',
      o.scope ? `{${o.scope}}` : '',
      o.phase ? `[${o.phase}]` : '',
      o.msg || o.message || '',
      o.error ? `err=${o.error}` : '',
    ]
      .filter(Boolean)
      .join(' ');
    const isFallback =
      /FALLBACK|re-download|incomplete/i.test(String(o.msg || '')) ||
      o.level === 'ERROR';
    const prevLogs = session.debugLogs || [];
    if (prevLogs[prevLogs.length - 1] === pretty) {
      return isFallback
        ? { ...session, banner: String(o.msg || pretty).slice(0, 160) }
        : session;
    }
    const logs = [...prevLogs, pretty].slice(-80);
    return {
      ...session,
      debugLogs: logs,
      banner: isFallback ? String(o.msg || pretty).slice(0, 160) : session.banner,
    };
  } catch {
    const prevLogs = session.debugLogs || [];
    const rawLine = raw.slice(0, 200);
    if (prevLogs[prevLogs.length - 1] === rawLine) return session;
    const logs = [...prevLogs, rawLine].slice(-80);
    return { ...session, debugLogs: logs };
  }
}

export function sessionVisible(session?: TransferSession | null): boolean {
  if (!session) return false;
  if (session.active) return true;
  if (Array.isArray(session.items) && session.items.length > 0) return true;
  return false;
}

export function activeItemName(session?: TransferSession | null): string {
  if (!session || !Array.isArray(session.items)) return '';
  const a = session.items.find((i) =>
    i.status === 'active' ||
    i.status === 'preparing' ||
    i.status === 'uploaded' ||
    i.status === 'waiting_commit' ||
    i.status === 'committing'
  );
  if (a) return a.name;
  const q = session.items.find((i) => i.status === 'queued' || i.status === 'paused');
  return q?.name || session.label || '';
}

export function countByStatus(session?: TransferSession | null) {
  const items = session && Array.isArray(session.items) ? session.items : [];
  const c = { done: 0, failed: 0, active: 0, queued: 0, skipped: 0, needsVerification: 0, total: items.length };
  for (const it of items) {
    if (it.status === 'done') c.done++;
    else if (it.status === 'skipped') c.skipped++;
    else if (it.status === 'needs_verification') c.needsVerification++;
    else if (it.status === 'failed' || it.status === 'cancelled') c.failed++;
    else if (it.status === 'active' || it.status === 'preparing' || it.status === 'uploaded' || it.status === 'waiting_commit' || it.status === 'committing') c.active++;
    else c.queued++;
  }
  return c;
}

/** Badge for Transfer Manager toolbar button. */
export type TransferBadge = {
  count: number;
  kind: 'busy' | 'error' | 'done' | 'none';
};

/**
 * Number shown on Transfer Manager icon:
 * - busy: files still in progress (active + queued)
 * - error: failed/cancelled when idle
 * - done: completed count (brief history)
 */
export function transferBadge(session: TransferSession): TransferBadge {
  if (!session || (!session.active && !session.items.length)) {
    return { count: 0, kind: 'none' };
  }
  const c = countByStatus(session);
  if (session.active) {
    const n = Math.max(1, c.active + c.queued);
    return { count: n, kind: 'busy' };
  }
  if (c.failed > 0) {
    return { count: c.failed, kind: 'error' };
  }
  if (c.done > 0) {
    return { count: c.done, kind: 'done' };
  }
  return { count: 0, kind: 'none' };
}
