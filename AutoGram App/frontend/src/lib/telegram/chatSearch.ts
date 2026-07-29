/**
 * Fast chat / location filter for 1k–10k dialogs.
 * Precomputes a single haystack string per chat so search is one includes() per row.
 * Universal location search (Google Drive–style) also filters Drive folders + Saved.
 */
import type { DriveChat, DriveFolder } from './driveTypes';

export type ChatSearchEntry = {
  chat: DriveChat;
  /** lowercase name + username + id for substring search */
  hay: string;
};

export function buildChatSearchIndex(chats: DriveChat[]): ChatSearchEntry[] {
  const out: ChatSearchEntry[] = [];
  for (const c of chats) {
    if (c.is_drive_folder) continue;
    const name = (c.name || '').toLowerCase();
    const user = (c.username || '').toLowerCase();
    const id = String(c.id);
    out.push({
      chat: c,
      hay: `${name}\n${user}\n${id}\n${(c.title_raw || '').toLowerCase()}\n${(c.type || '').toLowerCase()}`,
    });
  }
  return out;
}

function queryTokens(query: string): string[] {
  return (query || '')
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
}

function hayMatchesTokens(hay: string, tokens: string[]): boolean {
  for (const t of tokens) {
    if (!hay.includes(t)) return false;
  }
  return true;
}

/**
 * Multi-token AND search (space-separated). Empty query returns all (as chats).
 */
export function filterChatsFast(index: ChatSearchEntry[], query: string): DriveChat[] {
  const tokens = queryTokens(query);
  if (!tokens.length) {
    return index.map((e: any) => e.chat);
  }

  const out: DriveChat[] = [];
  for (const e of index) {
    if (hayMatchesTokens(e.hay, tokens)) out.push(e.chat);
  }
  return out;
}

/** Filter Drive [TD] folders by name / raw title / id (same multi-token AND). */
export function filterFoldersFast(folders: DriveFolder[], query: string): DriveFolder[] {
  const tokens = queryTokens(query);
  if (!tokens.length) return folders;
  const out: DriveFolder[] = [];
  for (const f of folders) {
    const hay = `${(f.name || '').toLowerCase()}\n${(f.title_raw || '').toLowerCase()}\n${String(f.id)}`;
    if (hayMatchesTokens(hay, tokens)) out.push(f);
  }
  return out;
}

/** One row in the sidebar Drive folder tree (folder-in-folder). */
export type FolderTreeRow = {
  folder: DriveFolder;
  depth: number;
  hasChildren: boolean;
};

function folderNameKey(f: DriveFolder): string {
  return (f.name || '').toLowerCase();
}

/**
 * Flatten nested Drive folders for sidebar (DFS preorder).
 * `parent_id` on a folder points at the parent Drive peer id.
 * Orphans (parent missing) render as roots. When `expandedIds` is null, expand all.
 */
export function buildFolderTreeRows(
  folders: DriveFolder[],
  opts?: { expandedIds?: Set<number> | null; forceFlat?: boolean }
): FolderTreeRow[] {
  if (!folders.length) return [];
  if (opts?.forceFlat) {
    return folders.map((folder) => ({ folder, depth: 0, hasChildren: false }));
  }

  const byId = new Map<number, DriveFolder>();
  for (const f of folders) byId.set(f.id, f);

  const children = new Map<number, DriveFolder[]>();
  const roots: DriveFolder[] = [];
  for (const f of folders) {
    const pid = f.parent_id;
    if (pid != null && byId.has(pid) && pid !== f.id) {
      const list = children.get(pid) || [];
      list.push(f);
      children.set(pid, list);
    } else {
      roots.push(f);
    }
  }
  for (const list of children.values()) {
    list.sort((a, b) => folderNameKey(a).localeCompare(folderNameKey(b)));
  }
  roots.sort((a, b) => folderNameKey(a).localeCompare(folderNameKey(b)));

  const expandAll = opts?.expandedIds == null;
  const expanded = opts?.expandedIds;
  const out: FolderTreeRow[] = [];

  const walk = (f: DriveFolder, depth: number) => {
    const kids = children.get(f.id) || [];
    const hasChildren = kids.length > 0;
    out.push({ folder: f, depth, hasChildren });
    if (!hasChildren) return;
    if (!expandAll && expanded && !expanded.has(f.id)) return;
    for (const c of kids) walk(c, depth + 1);
  };

  for (const r of roots) walk(r, 0);
  return out;
}

/** Ancestor folder ids from a node up to roots (for auto-expand active path). */
export function folderAncestorIds(folders: DriveFolder[], folderId: number | null | undefined): number[] {
  if (folderId == null) return [];
  const byId = new Map(folders.map((f) => [f.id, f]));
  const out: number[] = [];
  let cur = byId.get(folderId);
  const seen = new Set<number>();
  while (cur?.parent_id != null && byId.has(cur.parent_id) && !seen.has(cur.parent_id)) {
    seen.add(cur.parent_id);
    out.push(cur.parent_id);
    cur = byId.get(cur.parent_id);
  }
  return out;
}

/** Direct child folder ids of a parent. */
export function folderDirectChildIds(folders: DriveFolder[], parentId: number): number[] {
  return folders.filter((f) => f.parent_id === parentId && f.id !== parentId).map((f) => f.id);
}

/** True if setting folderId's parent to newParentId would create a cycle. */
export function wouldCreateFolderCycle(
  folders: DriveFolder[],
  folderId: number,
  newParentId: number | null | undefined
): boolean {
  if (newParentId == null) return false;
  if (newParentId === folderId) return true;
  const byId = new Map(folders.map((f) => [f.id, f]));
  let cur = byId.get(newParentId);
  const seen = new Set<number>([folderId]);
  while (cur) {
    if (cur.id === folderId) return true;
    if (seen.has(cur.id)) break;
    seen.add(cur.id);
    if (cur.parent_id == null || !byId.has(cur.parent_id)) break;
    cur = byId.get(cur.parent_id);
  }
  return false;
}

export type DriveBreadcrumbSeg = {
  id: number | null;
  label: string;
  kind: 'start' | 'drive' | 'chat' | 'saved' | 'topic';
};

/**
 * Multi-level breadcrumb for Drive: Start / Root / … / Current [/ Topic]
 * Ancestors ordered root → leaf (current last).
 */
export function buildDriveBreadcrumbSegments(
  folders: DriveFolder[],
  opts: {
    locationKind: 'saved' | 'drive' | 'chat';
    activePeerId: number | null;
    chats?: { id: number; name: string }[];
    topicTitle?: string | null;
    topicId?: number | null;
  }
): DriveBreadcrumbSeg[] {
  const segs: DriveBreadcrumbSeg[] = [{ id: null, label: 'Start', kind: 'start' }];
  if (opts.locationKind === 'saved') {
    segs.push({ id: null, label: 'Saved Messages', kind: 'saved' });
    return segs;
  }
  if (opts.locationKind === 'drive' && opts.activePeerId != null) {
    const ancestors = folderAncestorIds(folders, opts.activePeerId).reverse();
    for (const aid of ancestors) {
      const f = folders.find((x) => x.id === aid);
      segs.push({ id: aid, label: f?.name || `Folder ${aid}`, kind: 'drive' });
    }
    const cur = folders.find((x) => x.id === opts.activePeerId);
    segs.push({
      id: opts.activePeerId,
      label: cur?.name || `Folder ${opts.activePeerId}`,
      kind: 'drive',
    });
  } else if (opts.locationKind === 'chat' && opts.activePeerId != null) {
    const c = opts.chats?.find((x) => x.id === opts.activePeerId);
    segs.push({
      id: opts.activePeerId,
      label: c?.name || `Chat ${opts.activePeerId}`,
      kind: 'chat',
    });
  }
  if (opts.topicTitle) {
    segs.push({ id: opts.topicId ?? null, label: opts.topicTitle, kind: 'topic' });
  }
  return segs;
}

/** Mark orphan folders (parent missing) — pure helper for UI if backend omits flag. */
export function withFolderOrphanFlags(folders: DriveFolder[]): DriveFolder[] {
  const ids = new Set(folders.map((f) => f.id));
  return folders.map((f) => ({
    ...f,
    is_orphan: f.parent_id != null && f.parent_id !== f.id && !ids.has(f.parent_id),
  }));
}

/**
 * Whether Saved Messages should appear under a universal location query.
 * Empty query → always show.
 */
export function matchesSavedMessagesQuery(query: string): boolean {
  const tokens = queryTokens(query);
  if (!tokens.length) return true;
  const hay =
    'saved messages\npesan tersimpan\nsaved\nme\nsaya\nfavorit\nbookmark\ntd saved';
  return hayMatchesTokens(hay, tokens);
}
