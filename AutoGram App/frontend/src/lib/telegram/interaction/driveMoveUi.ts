/**
 * External store for move-confirm dialog.
 * Snapshot is a version number so React always sees a changed primitive.
 */
import type { DriveConfirmState } from '../../../components/drive/Modals/DriveConfirmDialog';

type Bridge = {
  state: DriveConfirmState | null;
  version: number;
  listeners: Set<() => void>;
};

function bridge(): Bridge {
  const w = window as unknown as { __driveMoveUiStore?: Bridge };
  if (!w.__driveMoveUiStore) {
    w.__driveMoveUiStore = {
      state: null,
      version: 0,
      listeners: new Set(),
    };
  }
  return w.__driveMoveUiStore;
}

function emit(): void {
  const b = bridge();
  b.listeners.forEach((l) => {
    try {
      l();
    } catch (e) {
      console.error('driveMoveUi listener', e);
    }
  });
}

export function openDriveMoveConfirm(state: DriveConfirmState): void {
  const b = bridge();
  b.state = state;
  b.version += 1;
  try {
    (window as unknown as { __driveMoveOpen?: unknown }).__driveMoveOpen = {
      hasListeners: b.listeners.size,
      kind: state.kind,
      detail: state.detail,
      version: b.version,
      t: Date.now(),
    };
  } catch {
    /* ignore */
  }
  emit();
}

export function closeDriveMoveConfirm(): void {
  const b = bridge();
  if (b.state == null) return;
  b.state = null;
  b.version += 1;
  emit();
}

export function getDriveMoveConfirmSnapshot(): DriveConfirmState | null {
  return bridge().state;
}

/** Primitive snapshot for useSyncExternalStore (always changes on open/close) */
export function getDriveMoveConfirmVersion(): number {
  return bridge().version;
}

export function subscribeDriveMoveConfirmStore(onChange: () => void): () => void {
  const b = bridge();
  b.listeners.add(onChange);
  try {
    (window as unknown as { __subMoveConfirm?: boolean }).__subMoveConfirm = true;
    (window as unknown as { __subMoveListeners?: number }).__subMoveListeners = b.listeners.size;
  } catch {
    /* ignore */
  }
  return () => {
    /* retain — avoid 0-listener after StrictMode/HMR */
  };
}
