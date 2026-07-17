/**
 * Node built-in test runner — no vitest dependency in remote/.
 *   node --test core/wait_helpers.test.mjs
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  clampHealTimeoutMs,
  computePollSchedule,
  ENSURE_PARENT_WAIT_MINUTES,
  ENSURE_PHASE_BUDGETS_MS,
  ensureChildWorstCaseMs,
  formatPhaseLine,
  formatProgressStatus,
  parentDeadlineCoversChild,
  scheduleTotalMs,
  shouldContinuePolling,
  shouldKillEnsureOnParentTimeout,
} from './wait_helpers.mjs';

describe('computePollSchedule', () => {
  it('returns empty for zero budget', () => {
    assert.deepEqual(computePollSchedule(0), []);
    assert.deepEqual(computePollSchedule(-1), []);
  });

  it('covers budget with early-exit friendly short first intervals', () => {
    const s = computePollSchedule(5000, { initialMs: 200, maxIntervalMs: 800, backoff: 1.35 });
    assert.ok(s.length >= 3);
    assert.ok(s[0] <= 250, `first poll should be fast, got ${s[0]}`);
    assert.ok(scheduleTotalMs(s) >= 5000);
    assert.ok(scheduleTotalMs(s) <= 5000 + 800);
  });

  it('never exceeds maxIntervalMs per step', () => {
    const s = computePollSchedule(30_000, { initialMs: 200, maxIntervalMs: 600, backoff: 2 });
    for (const step of s) {
      assert.ok(step <= 600, `step ${step} > 600`);
    }
  });
});

describe('shouldContinuePolling', () => {
  it('stops immediately when probe OK (early exit)', () => {
    assert.equal(shouldContinuePolling(true, 0, 60_000), false);
    assert.equal(shouldContinuePolling(true, 59_000, 60_000), false);
  });

  it('continues while down and under budget', () => {
    assert.equal(shouldContinuePolling(false, 0, 1000), true);
    assert.equal(shouldContinuePolling(false, 999, 1000), true);
    assert.equal(shouldContinuePolling(false, 1000, 1000), false);
  });
});

describe('formatPhaseLine', () => {
  it('emits greppable PHASE markers with elapsed', () => {
    const line = formatPhaseLine('vite probe', 1234, 'up');
    assert.match(line, /^PHASE VITE_PROBE \+1234ms up$/);
  });
});

describe('clampHealTimeoutMs', () => {
  it('clamps into safe ensure window', () => {
    assert.equal(clampHealTimeoutMs(100), 3000);
    assert.equal(clampHealTimeoutMs(12_000), 12_000);
    assert.equal(clampHealTimeoutMs(999_999), 20_000);
    assert.equal(clampHealTimeoutMs(NaN), 20_000);
  });
});

describe('formatProgressStatus', () => {
  it('shows WORKING so cold start is not blank', () => {
    const s = formatProgressStatus('Vite', 4500, 'starting node');
    assert.match(s, /^WORKING Vite \(5s\)/);
    assert.match(s, /starting node/);
  });
});

describe('parent ensure deadline vs child budgets', () => {
  it('5 minute parent covers worst-case child phases + cold overhead', () => {
    const child = ensureChildWorstCaseMs(ENSURE_PHASE_BUDGETS_MS);
    // 55+25+15+20+12+90 = 217s < 300s
    assert.ok(child < ENSURE_PARENT_WAIT_MINUTES * 60_000);
    assert.equal(parentDeadlineCoversChild(ENSURE_PARENT_WAIT_MINUTES, child), true);
    // Regress: 2 minute parent does NOT cover (skeptic bug)
    assert.equal(parentDeadlineCoversChild(2, child), false);
  });

  it('phase budgets match ensure-remote.ps1 documented caps', () => {
    assert.equal(ENSURE_PHASE_BUDGETS_MS.viteWait, 55_000);
    assert.equal(ENSURE_PHASE_BUDGETS_MS.viteEnsureNode, 25_000);
    assert.equal(ENSURE_PHASE_BUDGETS_MS.viteWait2, 15_000);
    assert.equal(ENSURE_PHASE_BUDGETS_MS.cdpWait, 20_000);
    assert.equal(ENSURE_PHASE_BUDGETS_MS.heal, 12_000);
  });

  it('kills ensure on timeout unless status already OK', () => {
    assert.equal(shouldKillEnsureOnParentTimeout('WORKING Vite (30s)', true), true);
    assert.equal(shouldKillEnsureOnParentTimeout('STARTING ensure...', true), true);
    assert.equal(shouldKillEnsureOnParentTimeout('OK remote ready', true), false);
    assert.equal(shouldKillEnsureOnParentTimeout('WORKING', false), false);
  });
});
