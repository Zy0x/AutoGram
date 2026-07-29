/**
 * Drag-and-drop for AutoGram Drive.
 *
 * Tauri/WebView2 HTML5 DataTransfer is unreliable (empty types mid-dragover,
 * drop sometimes never fires, File.path often empty). We use:
 *  1) In-memory payload for internal media drags
 *  2) Geometry hit-testing for green row highlights
 *  3) Pointer-driven custom drag (primary — most reliable in WebView2)
 *  4) Tauri onDragDropEvent paths for OS file upload (not HTML5 File.path)
 */

export const DRIVE_DND_MIME = 'application/x-autogram-drive';

export type DriveDragPayload = {
  messageIds: number[];
  fromFolderId: number | null;
};

/** Drag a Drive folder row to reparent under another folder */
export type DriveFolderDragPayload = {
  folderId: number;
  folderName: string;
};

export type DriveDropTarget = {
  kind: 'saved' | 'drive' | 'chat';
  id: number | null;
  label: string;
};

/** Live payload while an internal media drag is active */
let activePayload: DriveDragPayload | null = null;
/** Live payload while dragging a folder for reparent */
let activeFolderPayload: DriveFolderDragPayload | null = null;
let dragGeneration = 0;
/** true while custom pointer-drag is following the cursor */
let pointerDragActive = false;
/** Last sidebar row highlighted during internal drag (drop fallback) */
let lastHoverDropKey: string | null = null;

/**
 * Last OS file paths seen from Tauri drag-drop (or HTML5 with path).
 * HTML5 File.path is often empty in Tauri 2 — Tauri event fills this.
 */
let lastOsPaths: string[] = [];

const dragUiListeners = new Set<() => void>();

export function subscribeDriveDragUi(fn: () => void): () => void {
  dragUiListeners.add(fn);
  return () => {
    dragUiListeners.delete(fn);
  };
}

function notifyDragUi() {
  dragUiListeners.forEach((fn) => {
    try {
      fn();
    } catch {
      /* ignore */
    }
  });
}

export function isInternalMediaDragActive(): boolean {
  return activePayload != null;
}

export function isFolderReparentDragActive(): boolean {
  return activeFolderPayload != null;
}

export function getActiveFolderDrag(): DriveFolderDragPayload | null {
  return activeFolderPayload;
}

export function beginFolderDrag(payload: DriveFolderDragPayload): void {
  activeFolderPayload = {
    folderId: payload.folderId,
    folderName: payload.folderName,
  };
  // Clear media drag if any
  activePayload = null;
  notifyDragUi();
}

export function endFolderDrag(): void {
  if (!activeFolderPayload) return;
  activeFolderPayload = null;
  notifyDragUi();
}

export function isPointerDriveDragActive(): boolean {
  return pointerDragActive;
}

export function getActiveDriveDrag(): DriveDragPayload | null {
  return activePayload;
}

export function beginDriveDrag(payload: DriveDragPayload): number {
  activePayload = {
    messageIds: [...payload.messageIds],
    fromFolderId: payload.fromFolderId,
  };
  dragGeneration += 1;
  notifyDragUi();
  return dragGeneration;
}

export function endDriveDrag(gen?: number): void {
  if (gen != null && gen !== dragGeneration) return;
  const had = activePayload != null || pointerDragActive;
  activePayload = null;
  pointerDragActive = false;
  // keep lastHoverDropKey until drop handler reads it (cleared in setPointerDriveDragActive(false) / clear)
  if (had) notifyDragUi();
}

export function setPointerDriveDragActive(on: boolean): void {
  if (pointerDragActive === on) return;
  pointerDragActive = on;
  if (!on) lastHoverDropKey = null;
  notifyDragUi();
}

/** Sidebar sets this while pointer hovers a drop row during internal drag. */
export function setLastHoverDropKey(key: string | null): void {
  lastHoverDropKey = key;
}

export function getLastHoverDropKey(): string | null {
  return lastHoverDropKey;
}

export function getLastOsPaths(): string[] {
  return lastOsPaths.slice();
}

export function clearLastOsPaths(): void {
  lastOsPaths = [];
}

/** 1×1 transparent pixel — hide browser default drag image (we draw custom ghost). */
let emptyDragImg: HTMLImageElement | null = null;
function getEmptyDragImage(): HTMLImageElement | null {
  if (typeof Image === 'undefined') return null;
  if (emptyDragImg) return emptyDragImg;
  try {
    const img = new Image(1, 1);
    img.src =
      'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
    emptyDragImg = img;
    return img;
  } catch {
    return null;
  }
}

export function setDriveDragData(dt: DataTransfer, payload: DriveDragPayload): void {
  beginDriveDrag(payload);
  const json = JSON.stringify(payload);
  try {
    dt.setData(DRIVE_DND_MIME, json);
  } catch {
    /* custom MIME may be rejected */
  }
  try {
    dt.setData('text/plain', `autogram-drive:${json}`);
  } catch {
    /* ignore */
  }
  try {
    // 'all' / copyMove: WebView2 often shows 🚫 if effectAllowed is only 'move'
    // while dropEffect is not set on every dragover target.
    dt.effectAllowed = 'all';
  } catch {
    try {
      dt.effectAllowed = 'copyMove';
    } catch {
      /* ignore */
    }
  }
  // Suppress native ghost; custom chip follows cursor
  try {
    const img = getEmptyDragImage();
    if (img) dt.setDragImage(img, 0, 0);
  } catch {
    /* ignore */
  }
}

function parsePayloadJson(raw: string): DriveDragPayload | null {
  if (!raw) return null;
  try {
    const p = JSON.parse(raw);
    if (!p || !Array.isArray(p.messageIds) || !p.messageIds.length) return null;
    const messageIds = p.messageIds
      .map((x: unknown) => Number(x))
      .filter((n: number) => Number.isFinite(n));
    if (!messageIds.length) return null;
    const from =
      p.fromFolderId === null || p.fromFolderId === undefined || p.fromFolderId === 'me'
        ? null
        : Number(p.fromFolderId);
    return {
      messageIds,
      fromFolderId: from != null && Number.isFinite(from) ? from : null,
    };
  } catch {
    return null;
  }
}

export function getDriveDragData(dt?: DataTransfer | null): DriveDragPayload | null {
  if (activePayload?.messageIds?.length) {
    return {
      messageIds: [...activePayload.messageIds],
      fromFolderId: activePayload.fromFolderId,
    };
  }
  if (!dt) return null;
  let raw = '';
  try {
    raw = dt.getData(DRIVE_DND_MIME) || '';
  } catch {
    raw = '';
  }
  if (!raw) {
    try {
      const plain = dt.getData('text/plain') || '';
      if (plain.startsWith('autogram-drive:')) raw = plain.slice('autogram-drive:'.length);
    } catch {
      raw = '';
    }
  }
  return parsePayloadJson(raw);
}

export function canAcceptDriveDrop(dt: DataTransfer, mediaDragActive?: boolean): boolean {
  if (mediaDragActive || activePayload || pointerDragActive) return true;
  if (lastOsPaths.length > 0) return true;
  return hasOsFiles(dt) || hasDriveDragTypes(dt);
}

export function hasDriveDragTypes(dt: DataTransfer): boolean {
  const types = Array.from(dt.types || []).map((t) => String(t).toLowerCase());
  return (
    types.includes(DRIVE_DND_MIME.toLowerCase()) ||
    types.includes('text/plain') ||
    types.some((t) => t.includes('autogram') || t.includes('plain'))
  );
}

export function hasDriveDrag(dt: DataTransfer): boolean {
  return canAcceptDriveDrop(dt, false);
}

export function hasOsFiles(dt: DataTransfer): boolean {
  if (lastOsPaths.length > 0) return true;
  return Array.from(dt.types || []).some((t) => String(t).toLowerCase() === 'files');
}

/**
 * True only for OS / Explorer file drags (upload).
 * Google Drive model: internal media move must NOT show "drop to upload" overlay.
 *
 * Internal signals (any one → not external):
 *  - in-memory payload / pointer drag
 *  - our MIME / autogram text payload
 */
/**
 * Set dropEffect for the current drag mode so the cursor is not 🚫.
 * Call after preventDefault() on dragenter/dragover.
 */
export function applyDropEffect(
  dt: DataTransfer | null | undefined,
  mode: 'move' | 'copy' | 'none' = 'move'
): void {
  if (!dt) return;
  try {
    dt.dropEffect = mode;
  } catch {
    /* ignore */
  }
}

export function isExternalOsFileDrag(dt?: DataTransfer | null): boolean {
  // Active internal media drag always wins
  if (activePayload != null || pointerDragActive) return false;

  if (dt) {
    // Our custom payload in DataTransfer
    try {
      const types = Array.from(dt.types || []).map((t) => String(t).toLowerCase());
      if (types.includes(DRIVE_DND_MIME.toLowerCase())) return false;
      if (types.some((t) => t.includes('autogram'))) return false;
      // text/plain with our prefix (set during internal HTML5 drag)
      try {
        const plain = dt.getData('text/plain') || '';
        if (plain.startsWith('autogram-drive:')) return false;
      } catch {
        /* getData may throw mid-dragover in some engines — ignore */
      }
    } catch {
      /* ignore */
    }
  }

  // Tauri cached absolute paths from onDragDropEvent
  if (lastOsPaths.length > 0) return true;

  if (!dt) return false;
  return hasOsFiles(dt);
}

/**
 * Normalize a raw path from Tauri / File.path / file:// URL to a usable local path.
 */
export function normalizeOsPath(raw: unknown): string {
  if (raw == null) return '';
  let s = String(raw).trim().replace(/^["']|["']$/g, '');
  if (!s) return '';
  // file:///C:/Users/... or file://localhost/C:/...
  if (/^file:/i.test(s)) {
    try {
      const u = new URL(s);
      let p = decodeURIComponent(u.pathname || '');
      // Windows: /C:/Users → C:\Users
      if (/^\/[A-Za-z]:\//.test(p)) {
        p = p.slice(1);
      }
      s = p.replace(/\//g, '\\');
    } catch {
      s = s.replace(/^file:\/\//i, '').replace(/^\/([A-Za-z]:)/, '$1');
      s = s.replace(/\//g, '\\');
    }
  }
  // Long-path / UNC prefixes
  s = s.replace(/^\\\\\?\\UNC\\/i, '\\\\').replace(/^\\\\\?\\/i, '');
  return s.trim();
}

function uniquePaths(paths: unknown[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of paths) {
    // Support { path: "..." } objects if a host ever wraps them
    const raw =
      typeof p === 'object' && p != null && 'path' in (p as object)
        ? (p as { path: unknown }).path
        : p;
    const s = normalizeOsPath(raw);
    if (!s) continue;
    // Absolute: Win drive, UNC, Unix root
    const ok =
      /^[A-Za-z]:[\\/]/.test(s) ||
      s.startsWith('\\\\') ||
      s.startsWith('/') ||
      s.includes('\\');
    if (!ok) continue;
    const key = s.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

/** Merge absolute paths into the OS-drop cache (enter/over/drop). */
export function setLastOsPaths(paths: unknown): void {
  const arr = Array.isArray(paths) ? paths : [paths];
  const next = uniquePaths(arr);
  if (!next.length) return;
  // Merge with existing (over may arrive in chunks)
  lastOsPaths = uniquePaths([...lastOsPaths, ...next]);
}

/**
 * Extract absolute filesystem paths from a drop.
 * Prefer Tauri-cached paths (onDragDropEvent); fall back to File.path polyfill.
 * Does NOT clear the cache — call clearLastOsPaths() after a successful upload start.
 */
export function extractOsPaths(dt?: DataTransfer | null): string[] {
  if (lastOsPaths.length) return lastOsPaths.slice();
  if (!dt) return [];
  const list = Array.from(dt.files || []);
  const fromFiles = list
    .map((f: File & { path?: string; webkitRelativePath?: string }) => {
      // Tauri / WebView2 may expose File.path
      const p = (f as File & { path?: string }).path;
      if (p && typeof p === 'string') return p;
      // Some builds put absolute path in name when path empty (rare)
      const n = f.name || '';
      if (/^[A-Za-z]:[\\/]/.test(n) || n.startsWith('\\\\')) return n;
      return '';
    })
    .filter(Boolean);
  return uniquePaths(fromFiles);
}

/**
 * Wait briefly for Tauri onDragDropEvent to populate lastOsPaths
 * (HTML5 drop often races and File.path is empty in WebView2).
 */
export function waitForOsPaths(ms = 450): Promise<string[]> {
  if (lastOsPaths.length) return Promise.resolve(lastOsPaths.slice());
  const start = Date.now();
  return new Promise((resolve) => {
    const tick = () => {
      if (lastOsPaths.length) {
        resolve(lastOsPaths.slice());
        return;
      }
      if (Date.now() - start >= ms) {
        resolve(lastOsPaths.slice());
        return;
      }
      window.setTimeout(tick, 40);
    };
    tick();
  });
}

/** Take and clear cached OS paths (single consumer). */
export function takeLastOsPaths(): string[] {
  const out = lastOsPaths.slice();
  lastOsPaths = [];
  return out;
}

export function sameDriveLocation(a: number | null, b: number | null): boolean {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  return Number(a) === Number(b);
}

/**
 * True if (x,y) is inside the visible clip of overflow ancestors (scroll panes).
 * Prevents virtualized chat rows that still have layout boxes above the list
 * from stealing drop targets over Drive folders / Saved.
 */
function pointInScrollClips(node: HTMLElement, clientX: number, clientY: number): boolean {
  let el: HTMLElement | null = node.parentElement;
  while (el && el !== document.body) {
    const st = typeof getComputedStyle === 'function' ? getComputedStyle(el) : null;
    const oy = st?.overflowY || '';
    const ox = st?.overflowX || '';
    const scrolls =
      oy === 'auto' ||
      oy === 'scroll' ||
      oy === 'hidden' ||
      ox === 'auto' ||
      ox === 'scroll' ||
      ox === 'hidden';
    if (scrolls) {
      const r = el.getBoundingClientRect();
      // 1px tolerance for subpixel
      if (
        clientX < r.left - 1 ||
        clientX > r.right + 1 ||
        clientY < r.top - 1 ||
        clientY > r.bottom + 1
      ) {
        return false;
      }
    }
    el = el.parentElement;
  }
  return true;
}

function collectDropNodes(root?: Element | null): HTMLElement[] {
  const scope: ParentNode = root || document;
  try {
    return Array.from(scope.querySelectorAll('[data-drop-key]')) as HTMLElement[];
  } catch {
    if (typeof document === 'undefined') return [];
    return Array.from(document.querySelectorAll('[data-drop-key]')) as HTMLElement[];
  }
}

function bestKeyByGeometry(
  nodes: HTMLElement[],
  clientX: number,
  clientY: number,
  pad: number
): string | null {
  let best: { key: string; dist: number; strict: boolean } | null = null;
  for (const node of nodes) {
    const key = node.getAttribute('data-drop-key');
    if (!key) continue;
    const r = node.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    if (!pointInScrollClips(node, clientX, clientY)) continue;
    const strict =
      clientX >= r.left &&
      clientX <= r.right &&
      clientY >= r.top &&
      clientY <= r.bottom;
    const loose =
      clientX >= r.left - pad &&
      clientX <= r.right + pad &&
      clientY >= r.top - pad &&
      clientY <= r.bottom + pad;
    if (!strict && !loose) continue;
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const dist = (clientX - cx) ** 2 + (clientY - cy) ** 2;
    if (
      !best ||
      // Prefer strict (point inside row) over pad-only
      (strict && !best.strict) ||
      (strict === best.strict && dist < best.dist)
    ) {
      best = { key, dist, strict };
    }
  }
  return best?.key ?? null;
}

/**
 * Hit-test drop rows (WebView-safe).
 * 1) elementsFromPoint — respects overflow clip (must still be near the row box)
 * 2) Geometry: strict contain first, then pad; skip clipped virtual rows
 */
export function pickDropKeyAtPoint(
  clientX: number,
  clientY: number,
  root?: Element | null
): string | null {
  if (!root && (typeof document === 'undefined' || !document)) return null;
  const pad = 14;

  // Primary: paint stack (clipped overflow children omitted by the browser)
  try {
    const stack =
      typeof document.elementsFromPoint === 'function'
        ? document.elementsFromPoint(clientX, clientY)
        : ([document.elementFromPoint?.(clientX, clientY)].filter(Boolean) as Element[]);
    for (const el of stack) {
      const row = (el as HTMLElement).closest?.('[data-drop-key]') as HTMLElement | null;
      if (!row) continue;
      if (root && !root.contains(row)) continue;
      const k = row.getAttribute('data-drop-key');
      if (!k) continue;
      const r = row.getBoundingClientRect();
      // Reject stack hits that only graze via a huge/stale box outside the point
      if (
        clientX < r.left - pad ||
        clientX > r.right + pad ||
        clientY < r.top - pad ||
        clientY > r.bottom + pad
      ) {
        continue;
      }
      if (!pointInScrollClips(row, clientX, clientY)) continue;
      return k;
    }
  } catch {
    /* ignore */
  }

  return bestKeyByGeometry(collectDropNodes(root), clientX, clientY, pad);
}

export function parseDropKey(
  key: string
): { kind: DriveDropTarget['kind']; id: number | null } | null {
  const idx = key.indexOf(':');
  if (idx < 0) return null;
  const kind = key.slice(0, idx) as DriveDropTarget['kind'];
  const idPart = key.slice(idx + 1);
  if (kind === 'saved') return { kind: 'saved', id: null };
  if (kind !== 'drive' && kind !== 'chat') return null;
  const id = Number(idPart);
  if (!Number.isFinite(id)) return null;
  return { kind, id };
}

/** Min pointer movement (px) before treating interaction as drag (not click/select) */
export const DRAG_THRESHOLD_PX = 6;

/**
 * Edge band (px) inside chat list for auto-scroll during drag.
 * Tall enough that aiming near the last rows still triggers downward scroll.
 */
/**
 * Edge band height (px) for drag auto-scroll.
 * Outer portion stays slower; extreme edge ramps up (still usable on Drives).
 */
export const DRAG_SCROLL_EDGE_PX = 88;

/** Extra px below/above the list box that still triggers scroll */
export const DRAG_SCROLL_OUTSIDE_PX = 72;

/**
 * Scroll step per animation frame while pointer is in the edge band (legacy flat step).
 */
export const DRAG_SCROLL_STEP_PX = 3.5;

/**
 * Proportional edge scroll (px/frame @ ~60fps).
 * Balanced: easy to scroll Drives mid-band, faster only at very top/bottom.
 *   ~1.8 px/f ≈ 110 px/s (entry)
 *   ~11 px/f  ≈ 660 px/s (extreme edge only)
 */
export const DRAG_SCROLL_STEP_MIN_PX = 1.8;
export const DRAG_SCROLL_STEP_MAX_PX = 11;

/**
 * Ease exponent for edge depth → speed.
 * ~2.1 = gradual ramp (not as sluggish as 3.2).
 */
export const DRAG_SCROLL_EASE_POWER = 2.1;

/** After *fast* auto-scroll near Drives, ignore drop (ms) */
export const DROP_SCROLL_GUARD_MS = 200;
/** Must hover a Drive/Folder target this long before drop is accepted (ms) */
export const DROP_DRIVE_DWELL_MS = 120;
/** Last-frame scroll magnitude (px) considered "fast" for accidental-drop guard */
export const DROP_SCROLL_FAST_PX = 4.0;

let lastSidebarScrollAt = 0;
let lastSidebarScrollPx = 0;
let lastStableHoverKey: string | null = null;
let lastStableHoverAt = 0;

/** Call whenever sidebar auto-scroll moves during drag */
export function noteSidebarDragScroll(px: number): void {
  lastSidebarScrollAt = performance.now();
  lastSidebarScrollPx = Math.abs(px);
}

/** Track hover stability for dwell-to-drop on Drive rows */
export function noteSidebarDragHover(key: string | null): void {
  const now = performance.now();
  if (key !== lastStableHoverKey) {
    lastStableHoverKey = key;
    lastStableHoverAt = now;
  }
}

export function isDriveDropKey(key: string | null | undefined): boolean {
  return typeof key === 'string' && key.startsWith('drive:');
}

/**
 * Block accidental drop onto Drive/Folder while still scrolling (fly-by).
 * Chat/saved targets are not guarded — only drives hierarchy.
 */
export function shouldBlockDriveDrop(key: string | null | undefined): boolean {
  if (!isDriveDropKey(key)) return false;
  const now = performance.now();
  const sinceScroll = now - lastSidebarScrollAt;
  const wasFast = lastSidebarScrollPx >= DROP_SCROLL_FAST_PX;
  // Fast auto-scroll only: block until cooldown (slow crawl still allows dwell→drop)
  if (wasFast && sinceScroll < DROP_SCROLL_GUARD_MS) return true;
  // Brief cool-off after any scroll so fly-by doesn't arm green immediately
  if (sinceScroll < 70) return true;
  // Require stable hover dwell on the same drive key
  if (key !== lastStableHoverKey) return true;
  if (now - lastStableHoverAt < DROP_DRIVE_DWELL_MS) return true;
  return false;
}

export function clearSidebarDragScrollGuard(): void {
  lastSidebarScrollAt = 0;
  lastSidebarScrollPx = 0;
  lastStableHoverKey = null;
  lastStableHoverAt = 0;
}

/**
 * True when drop key points at the same peer the drag started from
 * (dropping here is a no-op / invalid target).
 */
export function isDropKeySameAsSource(
  key: string | null | undefined,
  fromFolderId: number | null | undefined
): boolean {
  if (!key) return false;
  const parsed = parseDropKey(key);
  if (!parsed) return false;
  if (parsed.kind === 'saved') {
    return fromFolderId == null;
  }
  if (parsed.kind === 'drive' || parsed.kind === 'chat') {
    return sameDriveLocation(parsed.id, fromFolderId ?? null);
  }
  return false;
}

/** Source folder for active internal media drag (null = Saved Messages). */
export function getDragSourceFolderId(): number | null | undefined {
  if (!activePayload) return undefined;
  return activePayload.fromFolderId;
}
