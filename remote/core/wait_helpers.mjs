/**
 * Pure wait/probe helpers for remote cold-start ensure path.
 * Unit-tested — keep free of Node spawn / network side effects.
 */

/**
 * Build adaptive poll intervals that sum to roughly maxWaitMs.
 * Starts fast (cold Vite often answers within a few seconds once node is up),
 * then backs off so we do not hammer a still-compiling server.
 *
 * @param {number} maxWaitMs total budget
 * @param {{ initialMs?: number, maxIntervalMs?: number, backoff?: number }} [opts]
 * @returns {number[]} interval lengths in ms
 */
export function computePollSchedule(
  maxWaitMs,
  { initialMs = 200, maxIntervalMs = 800, backoff = 1.35 } = {}
) {
  const budget = Math.max(0, Math.floor(Number(maxWaitMs) || 0));
  if (budget <= 0) return [];
  const start = Math.max(50, Math.floor(Number(initialMs) || 200));
  const cap = Math.max(start, Math.floor(Number(maxIntervalMs) || 800));
  const growth = Math.max(1.01, Number(backoff) || 1.35);

  const intervals = [];
  let used = 0;
  let next = start;
  while (used < budget) {
    const remaining = budget - used;
    const step = Math.min(next, remaining, cap);
    intervals.push(step);
    used += step;
    next = Math.min(cap, Math.ceil(next * growth));
  }
  return intervals;
}

/**
 * Sum of schedule (may equal maxWaitMs within rounding).
 * @param {number[]} schedule
 */
export function scheduleTotalMs(schedule) {
  if (!Array.isArray(schedule)) return 0;
  return schedule.reduce((a, b) => a + (Number(b) || 0), 0);
}

/**
 * Early-exit: probe already OK → stop regardless of remaining budget.
 * @param {boolean} probeOk
 * @param {number} elapsedMs
 * @param {number} maxWaitMs
 */
export function shouldContinuePolling(probeOk, elapsedMs, maxWaitMs) {
  if (probeOk) return false;
  return elapsedMs < maxWaitMs;
}

/**
 * Format one ensure-log phase line (stable for tests + log grepping).
 * @param {string} phase e.g. VITE_PROBE | VITE_START | FRONTEND | CDP | HEAL | DONE
 * @param {number} elapsedMs since ensure START
 * @param {string} [detail]
 */
export function formatPhaseLine(phase, elapsedMs, detail = '') {
  const p = String(phase || 'PHASE').toUpperCase().replace(/\s+/g, '_');
  const ms = Math.max(0, Math.round(Number(elapsedMs) || 0));
  const d = detail != null && String(detail).length ? ` ${String(detail)}` : '';
  return `PHASE ${p} +${ms}ms${d}`;
}

/**
 * Cap a subprocess wait so cold-start ensure cannot hang forever on heal.
 * @param {number} requestedMs
 * @param {{ minMs?: number, maxMs?: number }} [opts]
 */
export function clampHealTimeoutMs(requestedMs, { minMs = 3000, maxMs = 20_000 } = {}) {
  const n = Number(requestedMs);
  const v = Number.isFinite(n) ? n : maxMs;
  return Math.min(Math.max(v, minMs), maxMs);
}

/**
 * Human status line for last-run-status.txt during long cold starts.
 * @param {string} phase
 * @param {number} elapsedMs
 * @param {string} [hint]
 */
export function formatProgressStatus(phase, elapsedMs, hint = '') {
  const sec = Math.max(0, Math.round((Number(elapsedMs) || 0) / 1000));
  const h = hint ? ` — ${hint}` : '';
  return `WORKING ${phase} (${sec}s)${h}`;
}

/**
 * Worst-case ensure-remote.ps1 sequential phase budgets (ms).
 * Must stay under silent-launch.vbs ENSURE_DEADLINE_MIN with reboot overhead.
 * Keep in sync with ensure-remote.ps1 Wait-Until / WaitForExit values.
 */
export const ENSURE_PHASE_BUDGETS_MS = Object.freeze({
  viteWait: 55_000,
  viteEnsureNode: 25_000,
  viteWait2: 15_000,
  cdpWait: 20_000,
  heal: 12_000,
  /** cold PS/Node/WebView2 overhead allowance after reboot */
  coldOverhead: 90_000,
});

/** Parent VBS wait for ensure mode (minutes). Matches silent-launch ENSURE_DEADLINE_MIN. */
export const ENSURE_PARENT_WAIT_MINUTES = 5;

/**
 * Sum of phase budgets (ms) for ensure child.
 * @param {typeof ENSURE_PHASE_BUDGETS_MS} [budgets]
 */
export function ensureChildWorstCaseMs(budgets = ENSURE_PHASE_BUDGETS_MS) {
  const b = budgets || ENSURE_PHASE_BUDGETS_MS;
  return (
    (Number(b.viteWait) || 0) +
    (Number(b.viteEnsureNode) || 0) +
    (Number(b.viteWait2) || 0) +
    (Number(b.cdpWait) || 0) +
    (Number(b.heal) || 0) +
    (Number(b.coldOverhead) || 0)
  );
}

/**
 * Parent deadline must cover child worst-case (no FAIL while ensure still OK).
 * @param {number} parentWaitMinutes
 * @param {number} [childWorstCaseMs]
 */
export function parentDeadlineCoversChild(parentWaitMinutes, childWorstCaseMs) {
  const parentMs = Math.max(0, Number(parentWaitMinutes) || 0) * 60_000;
  const child = Number.isFinite(childWorstCaseMs)
    ? childWorstCaseMs
    : ensureChildWorstCaseMs();
  return parentMs >= child;
}

/**
 * Whether VBS should kill the ensure process on wait timeout.
 * Always true when timed out without OK status — prevents orphan writing OK later.
 */
export function shouldKillEnsureOnParentTimeout(statusText, timedOut) {
  if (!timedOut) return false;
  const s = String(statusText || '').trim().toUpperCase();
  if (s.startsWith('OK')) return false;
  return true;
}
