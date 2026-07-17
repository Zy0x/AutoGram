/**
 * Lightweight bug classifier for suite failures.
 */
export function analyzeFailure(caseId, detail) {
  const d = JSON.stringify(detail || {});
  if (/CDP|connect|ECONNREFUSED/i.test(d)) {
    return { level: 3, cause: 'remote_fundamental', hint: 'Start frontend with CDP :9222' };
  }
  if (/no cards|NO_CARDS/i.test(d)) {
    return { level: 2, cause: 'empty_media', hint: 'Select session + Saved Messages / reload' };
  }
  if (/hover|drop key|confirm/i.test(caseId + d)) {
    return { level: 2, cause: 'dnd_hit_test', hint: 'Check pickDropKeyAtPoint + section expand' };
  }
  return { level: 1, cause: 'unknown', hint: 'See screenshot + execution log' };
}
