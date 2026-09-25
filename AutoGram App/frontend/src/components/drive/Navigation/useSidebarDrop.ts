import { useCallback, useEffect, useRef, useState } from 'react';
import type { DriveFolder } from '../../../lib/telegram/driveTypes';
import {
  applyDropEffect,
  canAcceptDriveDrop,
  clearSidebarDragScrollGuard,
  endFolderDrag,
  getActiveFolderDrag,
  getLastHoverDropKey,
  hasOsFiles,
  isDropKeySameAsSource,
  isFolderReparentDragActive,
  isInternalMediaDragActive,
  isPointerDriveDragActive,
  noteSidebarDragHover,
  noteSidebarDragScroll,
  parseDropKey,
  pickDropKeyAtPoint,
  setLastHoverDropKey,
  shouldBlockDriveDrop,
  subscribeDriveDragUi,
  wouldCreateFolderCycle,
  type DriveDropTarget,
} from '../../../lib/telegram';
import { parseChatFolderDropKey } from '../utils/chatFolderDrop';

export type SidebarTab = 'saved' | 'recent' | 'drives' | 'chats' | 'home' | 'pins';

export interface UseSidebarDropOptions {
  folders: DriveFolder[];
  activePeerId?: number | null;
  locationKind?: string;
  onSelectSaved?: () => void;
  onSelectDrive?: (folderId: number) => void;
  onSelectChat?: (chatId: number) => void;
  setTreeExpanded?: React.Dispatch<React.SetStateAction<Set<number>>>;
  openFoldersSection: () => void;
  openChatsSection: () => void;
  sidebarRef: React.RefObject<HTMLElement | null>;
  navRef: React.RefObject<HTMLElement | null>;
  chatListRef: React.RefObject<HTMLDivElement | null>;
  folderStackRef: React.RefObject<HTMLDivElement | null>;
  chatFoldersScrollerRef: React.RefObject<HTMLDivElement | null>;
  onLoadMoreChats?: () => void;
  scheduleTabSwitch: (tab: SidebarTab) => void;
  cancelTabSwitch: () => void;
  scheduleChatFolderSwitch: (folderId: number) => void;
  cancelChatFolderSwitch: () => void;
  isSelf: (key: string) => boolean;
  onFolderReparentDrop?: (payload: {
    folderId: number;
    folderName: string;
    targetId: number;
    targetName: string;
  }) => void;
  onDropOnLocation?: (loc: DriveDropTarget, e: React.DragEvent) => void;
  labelMap: React.MutableRefObject<Map<string, string>>;
  mediaDragActive?: boolean;
  dragSourceFolderId?: number | null;
}

export interface UseSidebarDropResult {
  overKey: string | null;
  setOverKey: React.Dispatch<React.SetStateAction<string | null>>;
  springHoverKey: string | null;
  dragLive: boolean;
  folderDragLive: boolean;
  anyDragLive: boolean;
  acceptDrop: (e: React.DragEvent) => boolean;
  handleHover: (key: string | null) => void;
  handleDropKey: (key: string, e: React.DragEvent | DragEvent) => void;
  clearSpringTimer: () => void;
}

export function useSidebarDrop({
  folders,
  activePeerId,
  locationKind,
  onSelectSaved,
  onSelectDrive,
  onSelectChat,
  setTreeExpanded,
  openFoldersSection,
  openChatsSection,
  sidebarRef,
  navRef,
  chatListRef,
  folderStackRef,
  chatFoldersScrollerRef,
  onLoadMoreChats,
  scheduleTabSwitch,
  cancelTabSwitch,
  scheduleChatFolderSwitch,
  cancelChatFolderSwitch,
  isSelf,
  onFolderReparentDrop,
  onDropOnLocation,
  labelMap,
  mediaDragActive,
  dragSourceFolderId,
}: UseSidebarDropOptions): UseSidebarDropResult {
  const [overKey, setOverKey] = useState<string | null>(null);
  const [springHoverKey, setSpringHoverKey] = useState<string | null>(null);

  /** Immediate flag — does not wait for React setState after dragstart */
  const [liveInternalDrag, setLiveInternalDrag] = useState(() => isInternalMediaDragActive());
  const [liveFolderDrag, setLiveFolderDrag] = useState(() => isFolderReparentDragActive());
  const [isExternalDragLive, setIsExternalDragLive] = useState(false);

  const isExternalDragActiveRef = useRef(false);
  const springTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const leaveGraceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastHoveredLocationRef = useRef<string | null>(null);

  const onSelectSavedRef = useRef(onSelectSaved);
  onSelectSavedRef.current = onSelectSaved;
  const onSelectDriveRef = useRef(onSelectDrive);
  onSelectDriveRef.current = onSelectDrive;
  const onSelectChatRef = useRef(onSelectChat);
  onSelectChatRef.current = onSelectChat;
  const openFoldersSectionRef = useRef(openFoldersSection);
  openFoldersSectionRef.current = openFoldersSection;
  const openChatsSectionRef = useRef(openChatsSection);
  openChatsSectionRef.current = openChatsSection;

  const locationKindRef = useRef(locationKind);
  locationKindRef.current = locationKind;
  const activePeerIdRef = useRef(activePeerId);
  activePeerIdRef.current = activePeerId;
  const isSelfRef = useRef(isSelf);
  isSelfRef.current = isSelf;

  const clearSpringTimer = useCallback(() => {
    if (leaveGraceTimerRef.current) {
      clearTimeout(leaveGraceTimerRef.current);
      leaveGraceTimerRef.current = null;
    }
    if (springTimerRef.current) {
      clearTimeout(springTimerRef.current);
      springTimerRef.current = null;
    }
    setSpringHoverKey(null);
    lastHoveredLocationRef.current = null;
  }, []);

  const scheduleLocationSwitch = useCallback(
    (key: string | null) => {
      if (!key) {
        // Micro-grace timer before clearing spring state (avoids cancelling on 1px row border gaps)
        if (!leaveGraceTimerRef.current && springTimerRef.current) {
          leaveGraceTimerRef.current = setTimeout(() => {
            leaveGraceTimerRef.current = null;
            clearSpringTimer();
          }, 120);
        }
        return;
      }

      if (leaveGraceTimerRef.current) {
        clearTimeout(leaveGraceTimerRef.current);
        leaveGraceTimerRef.current = null;
      }

      if (lastHoveredLocationRef.current === key && springTimerRef.current !== null) {
        return;
      }

      if (springTimerRef.current) {
        clearTimeout(springTimerRef.current);
        springTimerRef.current = null;
      }

      const isSaved = key.startsWith('saved');
      const isDrive = key.startsWith('drive:');
      const isChat = key.startsWith('chat:');

      if (!isSaved && !isDrive && !isChat) {
        clearSpringTimer();
        return;
      }

      // If reparenting folder, don't allow spring-opening invalid cycle descendants
      if (isFolderReparentDragActive() && isSelfRef.current(key)) {
        clearSpringTimer();
        return;
      }

      lastHoveredLocationRef.current = key;
      setSpringHoverKey(key);

      springTimerRef.current = setTimeout(() => {
        springTimerRef.current = null;
        setSpringHoverKey(null);

        if (isSaved) {
          if (locationKindRef.current !== 'saved') {
            onSelectSavedRef.current?.();
          }
        } else if (isDrive) {
          const folderId = Number(key.slice('drive:'.length));
          if (Number.isFinite(folderId)) {
            if (locationKindRef.current !== 'drive' || activePeerIdRef.current !== folderId) {
              onSelectDriveRef.current?.(folderId);
            }
            // Auto-expand folder tree so nested subfolders are revealed for deep dragging
            setTreeExpanded?.((prev) => {
              if (prev.has(folderId)) return prev;
              const next = new Set(prev);
              next.add(folderId);
              return next;
            });
            openFoldersSectionRef.current?.();
          }
        } else if (isChat) {
          const chatId = Number(key.slice('chat:'.length));
          if (Number.isFinite(chatId)) {
            if (locationKindRef.current !== 'chat' || activePeerIdRef.current !== chatId) {
              onSelectChatRef.current?.(chatId);
            }
            openChatsSectionRef.current?.();
          }
        }
      }, 550);
    },
    [clearSpringTimer, setTreeExpanded]
  );

  // Subscribe so green targets activate the same tick as beginDriveDrag()
  useEffect(() => {
    return subscribeDriveDragUi(() => {
      setLiveInternalDrag(isInternalMediaDragActive());
      setLiveFolderDrag(isFolderReparentDragActive());
      if (
        !isInternalMediaDragActive() &&
        !isFolderReparentDragActive() &&
        !isExternalDragActiveRef.current &&
        typeof document !== 'undefined' &&
        !document.body.classList.contains('td-dnd-external')
      ) {
        setOverKey(null);
      }
    });
  }, []);

  const dragLive = !!(mediaDragActive || liveInternalDrag || isInternalMediaDragActive());
  const folderDragLive = !!(liveFolderDrag || isFolderReparentDragActive());
  const anyDragLive = dragLive || folderDragLive || isExternalDragLive;

  const acceptDrop = useCallback(
    (e: React.DragEvent) =>
      canAcceptDriveDrop(
        e.dataTransfer,
        mediaDragActive || dragLive || isInternalMediaDragActive()
      ) || isFolderReparentDragActive(),
    [mediaDragActive, dragLive]
  );

  const handleHover = useCallback(
    (key: string | null) => {
      noteSidebarDragHover(key);
      if (key && shouldBlockDriveDrop(key)) {
        setOverKey(null);
        return;
      }
      setOverKey(key);
      if (key) setLastHoverDropKey(key);
    },
    []
  );

  const handleDropKey = useCallback(
    (key: string, e: React.DragEvent | DragEvent) => {
      clearSpringTimer();
      // Accidental drop while scrolling past Drives (fly-by)
      if (shouldBlockDriveDrop(key)) {
        endFolderDrag();
        return;
      }
      const folderDrag = getActiveFolderDrag();
      if (folderDrag && onFolderReparentDrop) {
        const parsed = parseDropKey(key);
        if (
          parsed?.kind === 'drive' &&
          parsed.id != null &&
          parsed.id !== folderDrag.folderId &&
          !wouldCreateFolderCycle(folders, folderDrag.folderId, parsed.id)
        ) {
          const label = labelMap.current.get(key) || key;
          onFolderReparentDrop({
            folderId: folderDrag.folderId,
            folderName: folderDrag.folderName,
            targetId: parsed.id,
            targetName: label,
          });
        }
        endFolderDrag();
        return;
      }
      if (!onDropOnLocation) return;
      const parsed = parseDropKey(key);
      if (!parsed) return;
      const label = labelMap.current.get(key) || key;
      onDropOnLocation({ kind: parsed.kind, id: parsed.id, label }, e as React.DragEvent);
    },
    [onDropOnLocation, onFolderReparentDrop, folders, clearSpringTimer, labelMap]
  );

  const handleDropKeyRef = useRef(handleDropKey);
  handleDropKeyRef.current = handleDropKey;

  // External OS drag lifecycle listeners
  useEffect(() => {
    const onDragEnter = (e: DragEvent) => {
      if (e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files')) {
        isExternalDragActiveRef.current = true;
        setIsExternalDragLive(true);
      }
    };
    const onDragOver = (e: DragEvent) => {
      if (e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files')) {
        isExternalDragActiveRef.current = true;
        setIsExternalDragLive(true);
      }
    };
    const onDragLeave = (e: DragEvent) => {
      if (
        e.clientX <= 0 ||
        e.clientY <= 0 ||
        e.clientX >= window.innerWidth ||
        e.clientY >= window.innerHeight
      ) {
        isExternalDragActiveRef.current = false;
        setIsExternalDragLive(false);
        clearSpringTimer();
        setOverKey(null);
      }
    };
    const onDropEnd = () => {
      isExternalDragActiveRef.current = false;
      setIsExternalDragLive(false);
      clearSpringTimer();
      setOverKey(null);
    };

    const onOsDragMove = (e: Event) => {
      const detail = (e as CustomEvent).detail as { clientX: number; clientY: number } | undefined;
      if (detail && typeof detail.clientX === 'number') {
        isExternalDragActiveRef.current = true;
        setIsExternalDragLive(true);

        const root = sidebarRef.current || navRef.current;
        const side = (sidebarRef.current || navRef.current)?.getBoundingClientRect();
        if (side && detail.clientX >= side.left - 24 && detail.clientX <= side.right + 24) {
          let key: string | null = null;
          if (typeof document !== 'undefined') {
            const hitEl = document.elementFromPoint(detail.clientX, detail.clientY);
            const hitRow = hitEl?.closest<HTMLElement>('.td-sidebar [data-drop-key], [data-drop-key]');
            key = hitRow?.getAttribute('data-drop-key') || null;
          }
          if (!key) {
            key = pickDropKeyAtPoint(detail.clientX, detail.clientY, root);
          }
          if (key && shouldBlockDriveDrop(key)) {
            setOverKey(null);
            scheduleLocationSwitch(null);
            return;
          }
          setOverKey(key);
          if (key) setLastHoverDropKey(key);

          if (key?.startsWith('tab:')) {
            scheduleTabSwitch(key.slice('tab:'.length) as SidebarTab);
            cancelChatFolderSwitch();
            scheduleLocationSwitch(null);
          } else if (parseChatFolderDropKey(key) != null) {
            cancelTabSwitch();
            scheduleChatFolderSwitch(parseChatFolderDropKey(key)!);
            scheduleLocationSwitch(null);
          } else if (key && (key.startsWith('drive:') || key.startsWith('chat:') || key.startsWith('saved'))) {
            cancelTabSwitch();
            cancelChatFolderSwitch();
            scheduleLocationSwitch(key);
          } else {
            cancelTabSwitch();
            cancelChatFolderSwitch();
            scheduleLocationSwitch(null);
          }
        } else {
          setOverKey(null);
          scheduleLocationSwitch(null);
        }
      }
    };

    const onOsDragEnd = () => {
      isExternalDragActiveRef.current = false;
      setIsExternalDragLive(false);
      clearSpringTimer();
      setOverKey(null);
    };

    window.addEventListener('dragenter', onDragEnter, { capture: true, passive: true });
    window.addEventListener('dragover', onDragOver, { capture: true, passive: true });
    window.addEventListener('dragleave', onDragLeave, { capture: true, passive: true });
    window.addEventListener('drop', onDropEnd, { capture: true, passive: true });
    window.addEventListener('dragend', onDropEnd, { capture: true, passive: true });
    window.addEventListener('autogram-os-drag-move', onOsDragMove);
    window.addEventListener('autogram-os-drag-end', onOsDragEnd);

    return () => {
      window.removeEventListener('dragenter', onDragEnter, { capture: true });
      window.removeEventListener('dragover', onDragOver, { capture: true });
      window.removeEventListener('dragleave', onDragLeave, { capture: true });
      window.removeEventListener('drop', onDropEnd, { capture: true });
      window.removeEventListener('dragend', onDropEnd, { capture: true });
      window.removeEventListener('autogram-os-drag-move', onOsDragMove);
      window.removeEventListener('autogram-os-drag-end', onOsDragEnd);
    };
  }, [
    clearSpringTimer,
    scheduleLocationSwitch,
    scheduleTabSwitch,
    cancelTabSwitch,
    scheduleChatFolderSwitch,
    cancelChatFolderSwitch,
    sidebarRef,
    navRef,
  ]);

  // Document-level tracking & 60fps edge auto-scroll engine
  useEffect(() => {
    if (!anyDragLive) {
      setOverKey(null);
      clearSidebarDragScrollGuard();
      clearSpringTimer();
      return;
    }

    const hit = (clientX: number, clientY: number) => {
      const hitEl = typeof document !== 'undefined' ? document.elementFromPoint(clientX, clientY) : null;
      const hitRow = hitEl?.closest<HTMLElement>('.td-sidebar [data-drop-key], [data-drop-key]');
      if (hitRow) {
        const k = hitRow.getAttribute('data-drop-key');
        if (k) return k;
      }
      const root = sidebarRef.current || navRef.current;
      return pickDropKeyAtPoint(clientX, clientY, root);
    };

    let lastY = 0;
    let lastX = 0;
    let hasPointer = false;
    let raf = 0;
    let loadMoreCool = 0;
    let scrollCarry = 0;
    let currentVelocity = 0;
    let lastFrameAt = performance.now();
    let wheelScrollUntil = 0;
    let velocityAfterWheel = 0;

    const canScroll = (el: HTMLElement, dir: 'up' | 'down') => {
      if (dir === 'up') return el.scrollTop > 1;
      return el.scrollTop + el.clientHeight < el.scrollHeight - 2;
    };

    const applyScroll = (el: HTMLElement, dir: 'up' | 'down', step: number) => {
      scrollCarry += Math.max(0, step);
      if (scrollCarry < 0.1) return;
      const px = scrollCarry;
      scrollCarry = 0;
      noteSidebarDragScroll(px);
      if (dir === 'up') el.scrollTop = Math.max(0, el.scrollTop - px);
      else {
        el.scrollTop = Math.min(
          Math.max(0, el.scrollHeight - el.clientHeight),
          el.scrollTop + px
        );
      }
    };

    let lastHoverTime = 0;
    const applyHoverKey = (key: string | null) => {
      noteSidebarDragHover(key);
      if (key && shouldBlockDriveDrop(key)) {
        setOverKey(null);
        return;
      }
      if (currentVelocity > 700) {
        setOverKey(null);
        return;
      }
      const now = Date.now();
      if (now - lastHoverTime > 40 || !key) {
        lastHoverTime = now;
        setOverKey((prev) => (prev === key ? prev : key));
        if (key) setLastHoverDropKey(key);
      }
    };

    const tryLoadMore = (el: HTMLElement) => {
      if (
        el.scrollTop + el.clientHeight >= el.scrollHeight - Math.max(360, el.clientHeight * 0.75) &&
        Date.now() - loadMoreCool > 350
      ) {
        loadMoreCool = Date.now();
        onLoadMoreChats?.();
      }
    };

    const performDragAutoScroll = (_x: number, y: number, deltaSeconds: number) => {
      if (Date.now() < wheelScrollUntil) {
        currentVelocity = currentVelocity * 0.8;
        return;
      }
      if (velocityAfterWheel > 0) {
        currentVelocity = Math.max(currentVelocity, velocityAfterWheel);
        velocityAfterWheel = 0;
      }
      const side = sidebarRef.current?.getBoundingClientRect();
      if (!side) return;

      const chatEl = chatListRef.current;
      const foldersEl = folderStackRef.current;
      const navEl = navRef.current;

      const chatRect = chatEl?.getBoundingClientRect();
      const foldersRect = foldersEl?.getBoundingClientRect();
      const navRect = navEl?.getBoundingClientRect();

      const isOverChat = !!chatRect && y >= chatRect.top - 10 && y <= chatRect.bottom + 10;
      const isOverFolders = !!foldersRect && y >= foldersRect.top - 10 && y <= foldersRect.bottom + 10;

      let primaryTarget: HTMLElement | null = null;
      let targetRect: DOMRect | null = null;

      if (isOverChat && chatEl && chatEl.scrollHeight > chatEl.clientHeight + 2) {
        primaryTarget = chatEl;
        targetRect = chatRect;
      } else if (isOverFolders && foldersEl && foldersEl.scrollHeight > foldersEl.clientHeight + 2) {
        primaryTarget = foldersEl;
        targetRect = foldersRect;
      } else if (navEl && navEl.scrollHeight > navEl.clientHeight + 2) {
        primaryTarget = navEl;
        targetRect = navRect || side;
      }

      if (!primaryTarget || !targetRect) {
        currentVelocity = currentVelocity * 0.82;
        return;
      }

      const HOT_ZONE_BOTTOM = 88;
      const HOT_ZONE_TOP = 64;
      let dir: 'up' | 'down' | null = null;
      let dist = 0;
      let maxDepth = 120;

      if (y >= targetRect.bottom - HOT_ZONE_BOTTOM) {
        dir = 'down';
        dist = y - (targetRect.bottom - HOT_ZONE_BOTTOM);
        maxDepth = 120;
      } else if (y <= targetRect.top + HOT_ZONE_TOP) {
        dir = 'up';
        dist = targetRect.top + HOT_ZONE_TOP - y;
        maxDepth = 100;
      }

      if (!dir) {
        currentVelocity = currentVelocity * 0.38;
        if (currentVelocity < 8) currentVelocity = 0;
        return;
      }

      const ratio = Math.max(0.0, Math.min(1.0, dist / maxDepth));
      const targetVelocity = 520 + Math.pow(ratio, 1.35) * 2480;
      const smoothing = 1 - Math.exp(-12 * deltaSeconds);
      currentVelocity += (targetVelocity - currentVelocity) * smoothing;
      const activeStep = Math.max(1, currentVelocity * deltaSeconds);

      if (canScroll(primaryTarget, dir)) {
        applyScroll(primaryTarget, dir, activeStep);
        if (dir === 'down' && primaryTarget === chatEl) {
          tryLoadMore(chatEl);
        }
      } else if (navEl && primaryTarget !== navEl && canScroll(navEl, dir)) {
        applyScroll(navEl, dir, activeStep);
      }
    };

    const edgeScroll = () => {
      const frameAt = performance.now();
      const deltaSeconds = Math.min(0.032, Math.max(0.001, (frameAt - lastFrameAt) / 1000));
      lastFrameAt = frameAt;
      if (hasPointer) {
        const side = sidebarRef.current?.getBoundingClientRect();
        if (side) {
          const left = side.left - 24;
          const right = side.right + 24;
          const inX = lastX >= left && lastX <= right;
          if (inX) {
            const chipScroller = chatFoldersScrollerRef.current;
            if (chipScroller) {
              const chipR = chipScroller.getBoundingClientRect();
              if (lastY >= chipR.top - 24 && lastY <= chipR.bottom + 30) {
                const edgeZone = 75;
                if (lastX >= chipR.right - edgeZone) {
                  const depth = Math.min(1, Math.max(0.2, (lastX - (chipR.right - edgeZone)) / edgeZone));
                  chipScroller.scrollLeft += Math.max(4, Math.floor(depth * 18));
                } else if (lastX <= chipR.left + edgeZone) {
                  const depth = Math.min(1, Math.max(0.2, (chipR.left + edgeZone - lastX) / edgeZone));
                  chipScroller.scrollLeft -= Math.max(4, Math.floor(depth * 18));
                }
              }
            }
            performDragAutoScroll(lastX, lastY, deltaSeconds);
          }
        }
      }
      raf = requestAnimationFrame(edgeScroll);
    };
    raf = requestAnimationFrame(edgeScroll);

    const onDragOver = (e: DragEvent) => {
      if (isPointerDriveDragActive() && !isFolderReparentDragActive()) {
        lastX = e.clientX;
        lastY = e.clientY;
        hasPointer = true;
        e.preventDefault();
        const key = hit(e.clientX, e.clientY);
        applyHoverKey(key);
        if (key && (key.startsWith('drive:') || key.startsWith('chat:') || key.startsWith('saved'))) {
          scheduleLocationSwitch(key);
        } else {
          scheduleLocationSwitch(null);
        }
        return;
      }
      e.preventDefault();
      lastX = e.clientX;
      lastY = e.clientY;
      hasPointer = true;
      const key = hit(e.clientX, e.clientY);
      if (key?.startsWith('tab:')) {
        scheduleTabSwitch(key.slice('tab:'.length) as SidebarTab);
        cancelChatFolderSwitch();
        scheduleLocationSwitch(null);
      } else if (parseChatFolderDropKey(key) != null) {
        cancelTabSwitch();
        scheduleChatFolderSwitch(parseChatFolderDropKey(key)!);
        scheduleLocationSwitch(null);
      } else if (key && (key.startsWith('drive:') || key.startsWith('chat:') || key.startsWith('saved'))) {
        cancelTabSwitch();
        cancelChatFolderSwitch();
        scheduleLocationSwitch(key);
      } else {
        cancelTabSwitch();
        cancelChatFolderSwitch();
        scheduleLocationSwitch(null);
      }

      const folderDrag = getActiveFolderDrag();
      if (folderDrag || isFolderReparentDragActive()) {
        const invalid = !key || isSelf(key) || shouldBlockDriveDrop(key);
        applyDropEffect(e.dataTransfer, invalid ? 'none' : 'move');
        applyHoverKey(invalid ? null : key);
        return;
      }
      const self =
        !!key &&
        dragSourceFolderId !== undefined &&
        isDropKeySameAsSource(key, dragSourceFolderId ?? null);
      if (isInternalMediaDragActive() || dragLive) {
        const blockDrive = shouldBlockDriveDrop(key);
        applyDropEffect(e.dataTransfer, self || blockDrive ? 'none' : 'move');
        applyHoverKey(self || blockDrive ? null : key);
      } else if (hasOsFiles(e.dataTransfer as DataTransfer)) {
        applyDropEffect(e.dataTransfer, 'copy');
        applyHoverKey(key);
      } else {
        applyDropEffect(e.dataTransfer, 'none');
        applyHoverKey(null);
      }
    };

    const onDragEnter = (e: DragEvent) => {
      if (isPointerDriveDragActive() && !isFolderReparentDragActive()) return;
      e.preventDefault();
      if (isFolderReparentDragActive() || isInternalMediaDragActive() || dragLive) {
        applyDropEffect(e.dataTransfer, 'move');
      } else if (hasOsFiles(e.dataTransfer as DataTransfer)) {
        applyDropEffect(e.dataTransfer, 'copy');
      }
    };

    const onDrop = (e: DragEvent) => {
      clearSpringTimer();
      if (isPointerDriveDragActive() && !isFolderReparentDragActive()) {
        e.preventDefault();
        e.stopPropagation();
        setOverKey(null);
        return;
      }
      const dt = e.dataTransfer;
      const isOs = !!(dt && hasOsFiles(dt));
      const isFolderDrag = isFolderReparentDragActive() || !!getActiveFolderDrag();
      const isInternal = isInternalMediaDragActive() || mediaDragActive;
      if (!isInternal && !isOs && !isFolderDrag) return;
      const key = hit(e.clientX, e.clientY) || getLastHoverDropKey();
      if (!key) {
        if (isFolderDrag) endFolderDrag();
        return;
      }
      if (isSelf(key)) {
        if (isFolderDrag) endFolderDrag();
        e.preventDefault();
        e.stopPropagation();
        setOverKey(null);
        return;
      }
      if (shouldBlockDriveDrop(key)) {
        e.preventDefault();
        e.stopPropagation();
        setOverKey(null);
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      setOverKey(null);
      handleDropKeyRef.current(key, e);
    };

    const onPointerMove = (e: PointerEvent) => {
      if (
        !isInternalMediaDragActive() &&
        !mediaDragActive &&
        !dragLive &&
        !isPointerDriveDragActive() &&
        !isFolderReparentDragActive() &&
        !folderDragLive
      )
        return;
      lastX = e.clientX;
      lastY = e.clientY;
      hasPointer = true;

      const stack = document.elementsFromPoint(e.clientX, e.clientY);
      for (const node of stack) {
        if (!(node instanceof Element)) continue;
        const toggle = node.closest('.td-section-toggle');
        if (!toggle) continue;
        const label = (toggle.textContent || '').toLowerCase();
        if (label.includes('chat')) {
          openChatsSection();
          window.requestAnimationFrame(() => {
            toggle.scrollIntoView({ block: 'nearest', inline: 'nearest' });
            const nav = navRef.current;
            if (nav) {
              const tr = toggle.getBoundingClientRect();
              const nr = nav.getBoundingClientRect();
              if (tr.bottom > nr.bottom - 8) {
                nav.scrollTop += tr.bottom - nr.bottom + 48;
              }
            }
          });
        } else if (label.includes('drive')) {
          openFoldersSection();
        }
        break;
      }

      const key = hit(e.clientX, e.clientY);
      if (key && key.startsWith('tab:')) {
        const tab = key.slice('tab:'.length) as SidebarTab;
        scheduleTabSwitch(tab);
        cancelChatFolderSwitch();
        scheduleLocationSwitch(null);
      } else if (parseChatFolderDropKey(key) != null) {
        cancelTabSwitch();
        scheduleChatFolderSwitch(parseChatFolderDropKey(key)!);
        scheduleLocationSwitch(null);
      } else if (key && (key.startsWith('drive:') || key.startsWith('chat:') || key.startsWith('saved'))) {
        cancelTabSwitch();
        cancelChatFolderSwitch();
        scheduleLocationSwitch(key);
      } else {
        cancelTabSwitch();
        cancelChatFolderSwitch();
        scheduleLocationSwitch(null);
      }
      applyHoverKey(key);
    };

    const onWheel = (e: WheelEvent) => {
      const isDragging =
        isPointerDriveDragActive() ||
        isInternalMediaDragActive() ||
        mediaDragActive ||
        dragLive ||
        folderDragLive ||
        isFolderReparentDragActive() ||
        isExternalDragActiveRef.current;

      if (!isDragging) return;

      const side = sidebarRef.current?.getBoundingClientRect();
      if (!side) return;
      if (e.clientX < side.left - 24 || e.clientX > side.right + 24) return;
      if (Math.abs(e.deltaY) < 0.6 && Math.abs(e.deltaX) < 0.6) return;

      hasPointer = true;

      const chatEl = chatListRef.current;
      const foldersEl = folderStackRef.current;
      const navEl = navRef.current;

      const chatRect = chatEl?.getBoundingClientRect();
      const foldersRect = foldersEl?.getBoundingClientRect();

      const isOverChat = !!chatRect && e.clientY >= chatRect.top && e.clientY <= chatRect.bottom;
      const isOverFolders = !!foldersRect && e.clientY >= foldersRect.top && e.clientY <= foldersRect.bottom;

      let primaryTarget: HTMLElement | null = null;
      if (isOverChat && chatEl && chatEl.scrollHeight > chatEl.clientHeight) {
        primaryTarget = chatEl;
      } else if (isOverFolders && foldersEl && foldersEl.scrollHeight > foldersEl.clientHeight) {
        primaryTarget = foldersEl;
      } else if (navEl && navEl.scrollHeight > navEl.clientHeight) {
        primaryTarget = navEl;
      }

      const pixelDelta = e.deltaY;
      const isTrackpad = Math.abs(pixelDelta) < 60 && e.deltaMode === 0;
      const cooldownDuration = isTrackpad ? 60 : 220;
      wheelScrollUntil = Date.now() + cooldownDuration;
      if (!isTrackpad) {
        velocityAfterWheel = Math.max(velocityAfterWheel, Math.min(1800, Math.abs(pixelDelta) * 12));
      }

      const target = primaryTarget || navEl;
      if (target) {
        const oldTop = target.scrollTop;
        target.scrollTop = Math.max(
          0,
          Math.min(target.scrollHeight - target.clientHeight, oldTop + pixelDelta)
        );
        const consumed = target.scrollTop - oldTop;
        const remaining = pixelDelta - consumed;

        if (Math.abs(remaining) > 0.5 && navEl && navEl !== target && navEl.scrollHeight > navEl.clientHeight) {
          navEl.scrollTop = Math.max(
            0,
            Math.min(navEl.scrollHeight - navEl.clientHeight, navEl.scrollTop + remaining)
          );
        }

        if (pixelDelta > 0 && target === chatEl) {
          tryLoadMore(chatEl);
        }
      }

      const key = hit(e.clientX, e.clientY);
      applyHoverKey(key);
    };

    const onPointerUp = () => {
      clearSpringTimer();
      window.setTimeout(() => {
        setOverKey(null);
      }, 0);
    };

    const clear = () => {
      clearSpringTimer();
      setOverKey(null);
    };

    document.addEventListener('dragover', onDragOver, true);
    document.addEventListener('dragenter', onDragEnter, true);
    document.addEventListener('drop', onDrop, true);
    document.addEventListener('pointermove', onPointerMove, true);
    document.addEventListener('mousemove', onPointerMove as any, true);
    document.addEventListener('pointerup', onPointerUp, true);
    document.addEventListener('mouseup', onPointerUp, true);
    document.addEventListener('wheel', onWheel, { capture: true, passive: false });
    window.addEventListener('dragend', clear, true);

    return () => {
      cancelAnimationFrame(raf);
      clearSpringTimer();
      document.removeEventListener('dragover', onDragOver, true);
      document.removeEventListener('dragenter', onDragEnter, true);
      document.removeEventListener('drop', onDrop, true);
      document.removeEventListener('pointermove', onPointerMove, true);
      document.removeEventListener('mousemove', onPointerMove as any, true);
      document.removeEventListener('pointerup', onPointerUp, true);
      document.removeEventListener('mouseup', onPointerUp, true);
      document.removeEventListener('wheel', onWheel, true);
      window.removeEventListener('dragend', clear, true);
    };
  }, [
    anyDragLive,
    dragLive,
    folderDragLive,
    mediaDragActive,
    dragSourceFolderId,
    folders,
    isSelf,
    onLoadMoreChats,
    openChatsSection,
    openFoldersSection,
    scheduleTabSwitch,
    cancelTabSwitch,
    scheduleChatFolderSwitch,
    cancelChatFolderSwitch,
    scheduleLocationSwitch,
    clearSpringTimer,
    sidebarRef,
    navRef,
    chatListRef,
    folderStackRef,
    chatFoldersScrollerRef,
  ]);

  return {
    overKey,
    setOverKey,
    springHoverKey,
    dragLive,
    folderDragLive,
    anyDragLive,
    acceptDrop,
    handleHover,
    handleDropKey,
    clearSpringTimer,
  };
}
