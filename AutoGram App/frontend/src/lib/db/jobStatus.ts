/**
 * Shared job status → UI action mapping.
 * Keep display and side-effects (startJob args) in sync.
 */

export type JobUiKind =
  | 'running'
  | 'paused'
  | 'completed'
  | 'partial'
  | 'failed'
  | 'ready'
  | 'starting';

export type JobPrimaryAction =
  | { kind: 'pause'; label: string }
  | { kind: 'resume'; label: string }
  | { kind: 'run'; label: string }
  | { kind: 'retry-failed'; label: string }
  | { kind: 'rerun'; label: string };

export function normalizeJobStatus(status: unknown): string {
  return String(status || 'READY').trim().toUpperCase();
}

export function resolveJobUiKind(
  job: { status?: string },
  opts: { isRunning?: boolean; runResult?: 'success' | 'failed' }
): JobUiKind {
  if (opts.isRunning) return 'running';

  const s = normalizeJobStatus(job.status);

  if (s === 'PAUSED' || s === 'PAUSING') return 'paused';
  if (s === 'FAILED' || opts.runResult === 'failed') return 'failed';
  if (s === 'PARTIAL_SUCCESS' || s === 'PARTIAL') return 'partial';
  if (s === 'COMPLETED') return 'completed';
  if (s === 'STARTING' || s === 'RUNNING') {
    // DB says starting/running but UI lost the process handle → treat as paused-ish ready
    if (s === 'STARTING') return 'starting';
    return 'ready';
  }
  if (s === 'READY' || s === 'IDLE' || !s) {
    // Stale runResult alone should not paint completed over READY
    if (opts.runResult === 'success' && s === 'COMPLETED') return 'completed';
    return 'ready';
  }
  // Fallback: prefer explicit terminal statuses over runResult
  if (opts.runResult === 'success') return 'completed';
  return 'ready';
}

export function jobStatusClass(kind: JobUiKind): string {
  switch (kind) {
    case 'running':
    case 'starting':
      return 'running';
    case 'completed':
    case 'partial':
      return 'completed';
    case 'failed':
      return 'failed';
    case 'paused':
    case 'ready':
    default:
      return 'paused';
  }
}

export function jobDisplayStatus(kind: JobUiKind, rawStatus?: string): string {
  switch (kind) {
    case 'running':
      return 'RUNNING';
    case 'starting':
      return 'STARTING';
    case 'paused':
      return 'PAUSED';
    case 'failed':
      return 'FAILED';
    case 'partial':
      return 'PARTIAL';
    case 'completed':
      return 'COMPLETED';
    case 'ready':
    default:
      return normalizeJobStatus(rawStatus) === 'READY' ? 'READY' : normalizeJobStatus(rawStatus) || 'READY';
  }
}

/** Primary CTA for job cards / runtime */
export function getPrimaryActions(kind: JobUiKind, failedCount = 0): JobPrimaryAction[] {
  switch (kind) {
    case 'running':
    case 'starting':
      return [{ kind: 'pause', label: 'Pause' }];
    case 'paused':
      return [{ kind: 'resume', label: 'Resume' }];
    case 'failed':
      return [
        {
          kind: 'retry-failed',
          label: failedCount > 0 ? `Retry Failed (${failedCount})` : 'Retry Failed',
        },
        { kind: 'rerun', label: 'Re-run' },
      ];
    case 'completed':
    case 'partial':
      return [{ kind: 'rerun', label: 'Re-run' }];
    case 'ready':
    default:
      return [{ kind: 'run', label: 'Run' }];
  }
}

/**
 * Map UI action → startJob(job, isRetry, isDryRun, rerunMode)
 * - run / resume → fresh execute-job (engine uses checkpoint + mapping skip = continue)
 * - retry-failed → retry-execution + RESUME
 * - rerun → handled by modal (caller passes mode)
 */
export function startArgsForAction(
  action: JobPrimaryAction['kind']
): { isRetry: boolean; isDryRun: boolean; rerunMode?: string } {
  switch (action) {
    case 'resume':
      // Continue same job config; Clean Copy engine resumes via checkpoint + VERIFIED skip
      return { isRetry: false, isDryRun: false };
    case 'run':
      return { isRetry: false, isDryRun: false };
    case 'retry-failed':
      return { isRetry: true, isDryRun: false, rerunMode: 'RESUME' };
    case 'rerun':
      // Modal supplies mode; default RESUME if called directly
      return { isRetry: true, isDryRun: false, rerunMode: 'RESUME' };
    default:
      return { isRetry: false, isDryRun: false };
  }
}
