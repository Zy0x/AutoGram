import {
  MessageSquare,
  Users,
  Hash,
  Bot,
} from 'lucide-react';
import React, { useEffect, useState } from 'react';
import type { DriveCredentials } from '../../../lib/driveApi';
import type { DriveChat, DriveChatFolder, DriveFolder } from '../../../lib/driveTypes';
import type { DriveDropTarget } from '../../../lib/driveDrag';
import type { DriveRecent } from '../../../lib/driveRecents';
import {
  applyDropEffect,
  beginFolderDrag,
  endFolderDrag,
  getActiveFolderDrag,
  hasOsFiles,
  isFolderReparentDragActive,
  isInternalMediaDragActive,
  isPointerDriveDragActive,
  shouldBlockDriveDrop,
} from '../../../lib/driveDrag';
import { getCachedAvatar, requestAvatar } from '../../../lib/avatarBatcher';

export const LS_SEC_FOLDERS = 'td_sec_folders_open';
export const LS_SEC_CHATS = 'td_sec_chats_open';
export const LS_SEC_RECENTS = 'td_sec_recents_open';
export const TELEGRAM_FOLDER_COLORS = ['#ef4444', '#f59e0b', '#8b5cf6', '#22c55e', '#06b6d4', '#3b82f6', '#ec4899'];

export function telegramFolderColor(color?: number | null): string {
  return color != null && color >= 0
    ? TELEGRAM_FOLDER_COLORS[color % TELEGRAM_FOLDER_COLORS.length]
    : '#8b5cf6';
}

export function readSecOpen(key: string, fallback = true): boolean {
  try {
    const v = localStorage.getItem(key);
    if (v === '0') return false;
    if (v === '1') return true;
  } catch {
    /* ignore */
  }
  return fallback;
}

export function writeSecOpen(key: string, open: boolean): void {
  try {
    localStorage.setItem(key, open ? '1' : '0');
  } catch {
    /* ignore */
  }
}

export type DriveSidebarProps = {
  folders: DriveFolder[];
  chats: DriveChat[];
  chatFolders?: DriveChatFolder[];
  activeChatFolderId?: number;
  onSelectChatFolder?: (id: number) => void;
  activePeerId: number | null;
  locationKind: 'saved' | 'drive' | 'chat';
  onSelectSaved: () => void;
  onSelectDrive: (id: number) => void;
  onSelectChat: (id: number) => void;
  /** Create root Drive, or Folder when opts.parentId / current Drive/Folder set */
  onCreate: (opts?: { parentId?: number | null }) => void;
  onRefresh: () => void;
  loadingFolders?: boolean;
  loadingChats?: boolean;
  session: string;
  sessions: string[];
  onSessionChange: (s: string) => void;
  statusText?: string;
  connected?: boolean;
  collapsed: boolean;
  onToggleCollapse: () => void;
  /** Universal location query — filters Saved, Drives/Folders, and chats */
  chatQuery: string;
  onChatQuery: (q: string) => void;
  drawerOpen?: boolean;
  onCloseDrawer?: () => void;
  chatsHasMore?: boolean;
  chatsLoadingMore?: boolean;
  onLoadMoreChats?: () => void;
  onExitToApp?: () => void;
  onDropOnLocation?: (target: DriveDropTarget, e: React.DragEvent) => void;
  mediaDragActive?: boolean;
  /**
   * Peer/folder the drag started from — rows matching this are invalid drop
   * targets (same location). undefined = not known / no internal drag.
   */
  dragSourceFolderId?: number | null;
  /** API credentials — needed to load real profile photos */
  creds?: DriveCredentials | null;
  /** Recent locations for quick jump */
  recents?: DriveRecent[];
  onSelectRecent?: (r: DriveRecent) => void;
  /** Pinned favorites */
  pins?: DriveRecent[];
  onSelectPin?: (r: DriveRecent) => void;
  /** Right-click on Saved / Drive folder / chat row */
  onLocationContextMenu?: (info: {
    locationKind: 'saved' | 'drive' | 'chat';
    id: number | null;
    name: string;
    x: number;
    y: number;
  }) => void;
  /**
   * Folder reparent via DnD: drag folder A onto folder B.
   * targetId null = not used (only drive targets).
   */
  onFolderReparentDrop?: (info: {
    folderId: number;
    folderName: string;
    targetId: number;
    targetName: string;
  }) => void;
  /** Soft channel-limit banner text (optional override) */
  channelLimitWarning?: string | null;
  /** Real-time ping and connection strength state */
  pingState?: {
    status: 'offline' | 'disconnected' | 'excellent' | 'good' | 'fair' | 'poor' | 'transferring';
    ms: number | null;
  };
};

export function ChatIcon({ type }: { type: string }) {
  if (type === 'user') return <Users size={16} />;
  if (type === 'bot') return <Bot size={16} />;
  if (type === 'group') return <MessageSquare size={16} />;
  return <Hash size={16} />;
}

/** Real Telegram profile photo with lucide/type fallback */
export function PeerAvatar({
  peerId,
  creds,
  fallback,
  title,
}: {
  peerId: number;
  creds: DriveCredentials | null | undefined;
  fallback: React.ReactNode;
  title?: string;
}) {
  const cached = getCachedAvatar(peerId);
  const [url, setUrl] = useState<string | null>(() =>
    cached === undefined ? null : cached
  );
  const [broken, setBroken] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setBroken(false);
    const hit = getCachedAvatar(peerId);
    if (hit !== undefined) {
      setUrl(hit);
      return;
    }
    setUrl(null);
    if (!creds) return;
    void requestAvatar(creds, peerId).then((u: string | null) => {
      if (!cancelled) setUrl(u);
    });
    return () => {
      cancelled = true;
    };
  }, [peerId, creds]);

  if (url && !broken) {
    return (
      <img
        className="td-peer-avatar"
        src={url}
        alt=""
        title={title}
        draggable={false}
        loading="lazy"
        decoding="async"
        onError={() => setBroken(true)}
      />
    );
  }
  return <span className="td-peer-avatar-fallback">{fallback}</span>;
}

export function dropKey(kind: string, id: number | null) {
  return `${kind}:${id ?? 'me'}`;
}

export function parseDropKey(key: string): { kind: DriveDropTarget['kind']; id: number | null } | null {
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

export type DropRowProps = {
  dropKeyStr: string;
  className: string;
  title: string;
  isOver: boolean;
  /** Same as drag source — not a valid drop target for internal media */
  invalidTarget?: boolean;
  dragLive: boolean;
  /** Folder-reparent drag is active (green targets on other drive folders) */
  folderDragLive?: boolean;
  onActivate: () => void;
  /** Double-click (e.g. expand/collapse tree) — does not replace single-click select */
  onDoubleActivate?: () => void;
  onHover: (key: string | null) => void;
  onDropTarget: (key: string, e: React.DragEvent) => void;
  acceptDrop: (e: React.DragEvent) => boolean;
  children: React.ReactNode;
  style?: React.CSSProperties;
  onContextMenu?: (e: React.MouseEvent) => void;
  /** Make row a drag source for Drive/Folder reparent */
  folderDragSource?: { folderId: number; folderName: string } | null;
};

export function DropRow({
  dropKeyStr,
  className,
  title,
  isOver,
  invalidTarget,
  dragLive,
  folderDragLive,
  onActivate,
  onDoubleActivate,
  onHover,
  onDropTarget,
  acceptDrop,
  children,
  style,
  onContextMenu,
  folderDragSource,
}: DropRowProps) {
  const anyDrag = dragLive || !!folderDragLive;
  const allow = (e: React.DragEvent) =>
    dragLive || !!folderDragLive || acceptDrop(e) || isFolderReparentDragActive();

  return (
    <div
      role="button"
      tabIndex={0}
      data-drop-key={dropKeyStr}
      data-drop-invalid={invalidTarget ? '1' : '0'}
      draggable={!!folderDragSource}
      className={`${className}${isOver && !invalidTarget ? ' is-drop-over' : ''}${
        isOver && invalidTarget ? ' is-drop-invalid' : ''
      }${anyDrag ? ' dnd-ready' : ''}${invalidTarget && anyDrag ? ' dnd-self' : ''}${
        folderDragSource && getActiveFolderDrag()?.folderId === folderDragSource.folderId
          ? ' is-folder-dragging'
          : ''
      }`}
      style={style}
      title={
        invalidTarget && anyDrag
          ? 'Lokasi sumber — pilih chat/folder lain'
          : folderDragSource
            ? `${title} · seret ke folder lain untuk pindah`
            : title
      }
      onClick={onActivate}
      onDoubleClick={(e) => {
        if (!onDoubleActivate || dragLive || folderDragLive) return;
        e.preventDefault();
        e.stopPropagation();
        onDoubleActivate();
      }}
      onContextMenu={(e) => {
        if (!onContextMenu || dragLive || folderDragLive) return;
        e.preventDefault();
        e.stopPropagation();
        onContextMenu(e);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onActivate();
        }
        // ArrowRight/Left toggle tree when handler provided
        if (onDoubleActivate && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
          e.preventDefault();
          e.stopPropagation();
          onDoubleActivate();
        }
      }}
      onDragStart={(e) => {
        if (!folderDragSource) return;
        e.stopPropagation();
        beginFolderDrag(folderDragSource);
        try {
          e.dataTransfer.setData('text/plain', `folder:${folderDragSource.folderId}`);
          e.dataTransfer.setData(
            'application/x-autogram-folder',
            String(folderDragSource.folderId)
          );
          e.dataTransfer.effectAllowed = 'move';
          // Transparent drag image — less “stuck” native glyph in WebView2
          const img = document.createElement('div');
          img.textContent = folderDragSource.folderName;
          img.style.cssText =
            'position:fixed;top:-999px;left:-999px;padding:6px 10px;border-radius:8px;background:#1e293b;color:#f1f5f9;font:600 12px system-ui;border:1px solid #3b82f6;';
          document.body.appendChild(img);
          e.dataTransfer.setDragImage(img, 12, 12);
          window.setTimeout(() => img.remove(), 0);
        } catch {
          /* ignore */
        }
      }}
      onDragEnd={() => {
        endFolderDrag();
        onHover(null);
      }}
      onDragEnter={(e) => {
        if (!allow(e)) return;
        e.preventDefault();
        e.stopPropagation();
        if (invalidTarget && anyDrag) applyDropEffect(e.dataTransfer, 'none');
        else if (folderDragLive || isFolderReparentDragActive())
          applyDropEffect(e.dataTransfer, 'move');
        else if (dragLive || isInternalMediaDragActive()) applyDropEffect(e.dataTransfer, 'move');
        else if (hasOsFiles(e.dataTransfer)) applyDropEffect(e.dataTransfer, 'copy');
        else applyDropEffect(e.dataTransfer, 'move');
        onHover(dropKeyStr);
      }}
      onDragOver={(e) => {
        if (!allow(e)) return;
        e.preventDefault();
        e.stopPropagation();
        if (invalidTarget && anyDrag) {
          applyDropEffect(e.dataTransfer, 'none');
        } else if (folderDragLive || isFolderReparentDragActive()) {
          applyDropEffect(e.dataTransfer, 'move');
        } else if (dragLive || isInternalMediaDragActive()) {
          applyDropEffect(e.dataTransfer, 'move');
        } else if (hasOsFiles(e.dataTransfer)) {
          applyDropEffect(e.dataTransfer, 'copy');
        } else {
          applyDropEffect(e.dataTransfer, 'move');
        }
        onHover(dropKeyStr);
      }}
      onDragLeave={(e) => {
        // WebView often gives relatedTarget=null mid-drag — don't clear green on child hops
        const rel = e.relatedTarget as Node | null;
        if (!rel) return;
        if (e.currentTarget.contains(rel)) return;
        onHover(null);
      }}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onHover(null);
        // Pointer internal drag: SpeedTest pointerup owns completion
        if (isPointerDriveDragActive()) return;
        if (invalidTarget && anyDrag && !hasOsFiles(e.dataTransfer)) {
          endFolderDrag();
          return;
        }
        if (shouldBlockDriveDrop(dropKeyStr)) {
          endFolderDrag();
          return;
        }
        onDropTarget(dropKeyStr, e);
      }}
    >
      {children}
    </div>
  );
}
