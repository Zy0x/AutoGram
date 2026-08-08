import { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  X,
  UserCheck,
  RotateCcw,
  Trash2,
  Image,
  FolderArchive,
  CheckCircle2,
  HardDrive,
  User,
  SlidersHorizontal,
  Upload,
  Sliders,
  MapPin,
  FolderTree,
  MessageSquare,
  Users,
  Folder,
} from 'lucide-react';

import { clearThumbCache } from '../../lib/media/thumbBatcher';
import { clearAvatarCache } from '../../lib/media/avatarBatcher';
import { clearPreviewCache } from '../../lib/media/previewCache';
import { clearZipBrowserCache } from '../../components/drive/DriveZipBrowser/zipUtils';
import { clearPersistentThumbs } from '../../lib/media/thumbPersistentCache';
import { tgListSessions } from '../../lib/telegram/core/telegramBackend';
import { getSessionMetadata } from '../../lib/telegram/core/sessionPicker';

interface SpecificCacheModalProps {
  isOpen: boolean;
  onClose: () => void;
  onRefreshGlobalSize?: () => void;
}

interface SessionBuckets {
  locations: string[];
  sidebar: string[];
  topics: string[];
  peer: string[];
  chatFolder: string[];
  state: string[];
}

export function SpecificCacheModal({ isOpen, onClose, onRefreshGlobalSize }: SpecificCacheModalProps) {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<'system' | 'session'>('system');
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // System Cache state
  const [clearingItem, setClearingItem] = useState<string | null>(null);

  // Per-Session state
  const [sessions, setSessions] = useState<Array<{ name: string; userFullName?: string; phone?: string }>>([]);
  const [selectedSession, setSelectedSession] = useState<string>('');

  // LocalStorage keys existence trigger to re-evaluate empty states
  const [cacheVersion, setCacheVersion] = useState<number>(0);

  const triggerCacheRefresh = () => {
    setCacheVersion((v) => v + 1);
    onRefreshGlobalSize?.();
  };

  useEffect(() => {
    if (!isOpen) return;

    // Load active sessions
    tgListSessions()
      .then((res) => {
        const rawList = Array.isArray(res) ? res : (res as any)?.sessions || [];
        const list = rawList.map((s: any) => {
          const name = s.name || s.session_name || '';
          const meta = getSessionMetadata(name);
          return {
            name,
            userFullName: meta?.userFullName || s.user_full_name || name,
            phone: meta?.phone || s.phone || '',
          };
        });
        setSessions(list);
        if (list.length > 0 && !selectedSession) {
          setSelectedSession(list[0].name);
        }
      })
      .catch(() => {});
  }, [isOpen]);

  // Dynamic Bucket Classification for 100% Complete & Leak-Proof Session Cache Categorization
  const sessionBuckets = useMemo<SessionBuckets>(() => {
    const buckets: SessionBuckets = {
      locations: [],
      sidebar: [],
      topics: [],
      peer: [],
      chatFolder: [],
      state: [],
    };

    if (!selectedSession) return buckets;

    const classifyKey = (key: string) => {
      if (!key) return;

      const lower = key.toLowerCase();
      if (lower.includes('location') || lower.includes('root') || lower.includes('path')) {
        buckets.locations.push(key);
      } else if (lower.includes('sidebar') || lower.includes('tree') || lower.includes('expanded')) {
        buckets.sidebar.push(key);
      } else if (lower.includes('topic') || lower.includes('thread') || lower.includes('forum')) {
        buckets.topics.push(key);
      } else if (lower.includes('peer') || lower.includes('access_hash') || lower.includes('entity')) {
        buckets.peer.push(key);
      } else if (lower.includes('chat_folder') || lower.includes('filter') || lower.includes('folder_id')) {
        buckets.chatFolder.push(key);
      } else {
        // Guaranteed fallback for any other session key (scroll, view state, etc.)
        buckets.state.push(key);
      }
    };

    // Scan localStorage for selectedSession
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.includes(selectedSession)) {
        classifyKey(key);
      }
    }

    // Scan sessionStorage for selectedSession
    for (let i = 0; i < sessionStorage.length; i++) {
      const key = sessionStorage.key(i);
      if (key && key.includes(selectedSession)) {
        classifyKey(key);
      }
    }

    return buckets;
  }, [selectedSession, cacheVersion]);

  const sessionKeysCount =
    sessionBuckets.locations.length +
    sessionBuckets.sidebar.length +
    sessionBuckets.topics.length +
    sessionBuckets.peer.length +
    sessionBuckets.chatFolder.length +
    sessionBuckets.state.length;

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
  };

  if (!isOpen) return null;

  // --- TAB 1: SYSTEM GLOBAL CACHE HANDLERS ---
  const handleClearAvatar = async () => {
    setClearingItem('avatar');
    try {
      clearAvatarCache();
      showToast(t('ui.generated.cache_avatar_berhasil_dibersihkan_a12b34c'));
      triggerCacheRefresh();
    } finally {
      setClearingItem(null);
    }
  };

  const handleClearTempFiles = async () => {
    setClearingItem('temp');
    try {
      try {
        const { cacheClearDisk } = await import('../../lib/db/jobsApi');
        await cacheClearDisk();
      } catch {}
      showToast(t('ui.generated.file_temporary_chunk_berhasil_dibersihkan_b567d89'));
      triggerCacheRefresh();
    } finally {
      setClearingItem(null);
    }
  };

  const handleClearThumbnails = async () => {
    setClearingItem('thumbs');
    try {
      clearThumbCache();
      clearPreviewCache();
      await clearPersistentThumbs();
      showToast(t('ui.generated.cache_thumbnail_pratinjau_berhasil_dibersihkan_c789e01'));
      triggerCacheRefresh();
    } finally {
      setClearingItem(null);
    }
  };

  const handleClearZipNav = async () => {
    setClearingItem('zip');
    try {
      clearZipBrowserCache();
      showToast(t('ui.generated.cache_zip_navigasi_berhasil_dibersihkan_d012f34'));
      triggerCacheRefresh();
    } finally {
      setClearingItem(null);
    }
  };

  const handleClearGlobalLocations = () => {
    setClearingItem('locs_global');
    try {
      const keys: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith('autogram_drive_locations_v1_')) keys.push(k);
      }
      keys.forEach((k) => localStorage.removeItem(k));
      showToast(t('ui.generated.cache_navigasi_lokasi_semua_akun_b123a45') + ' dibersihkan!');
      triggerCacheRefresh();
    } finally {
      setClearingItem(null);
    }
  };

  const handleClearGlobalSidebar = () => {
    setClearingItem('sidebar_global');
    try {
      const keys: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith('autogram_drive_sidebar_v1_')) keys.push(k);
      }
      keys.forEach((k) => localStorage.removeItem(k));
      showToast(t('ui.generated.cache_pohon_sidebar_semua_akun_f345a67') + ' dibersihkan!');
      triggerCacheRefresh();
    } finally {
      setClearingItem(null);
    }
  };

  const handleClearGlobalTopics = () => {
    setClearingItem('topics_global');
    try {
      const keys: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith('autogram_drive_topics_v1_')) keys.push(k);
      }
      keys.forEach((k) => localStorage.removeItem(k));
      showToast(t('ui.generated.cache_topik_forum_semua_akun_c678d90') + ' dibersihkan!');
      triggerCacheRefresh();
    } finally {
      setClearingItem(null);
    }
  };

  const handleClearGlobalPeer = () => {
    setClearingItem('peer_global');
    try {
      const keys: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && (k.startsWith('autogram_drive_peer_v2_') || k === 'autogram_drive_peer')) keys.push(k);
      }
      keys.forEach((k) => localStorage.removeItem(k));
      showToast(t('ui.generated.metadata_peer_channel_semua_akun_d901e23') + ' dibersihkan!');
      triggerCacheRefresh();
    } finally {
      setClearingItem(null);
    }
  };

  const handleClearGlobalChatFolders = () => {
    setClearingItem('chat_folders_global');
    try {
      const keys: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith('autogram_chat_folder_')) keys.push(k);
      }
      keys.forEach((k) => localStorage.removeItem(k));
      showToast(t('ui.generated.cache_filter_folder_chat_semua_akun_f345a67') + ' dibersihkan!');
      triggerCacheRefresh();
    } finally {
      setClearingItem(null);
    }
  };

  const handleClearGlobalScroll = () => {
    setClearingItem('scroll_global');
    try {
      const keys: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith('autogram_drive_scroll_v1_')) keys.push(k);
      }
      keys.forEach((k) => localStorage.removeItem(k));
      showToast(t('ui.generated.cache_scroll_state_workspace_sesi_e123a45') + ' dibersihkan!');
      triggerCacheRefresh();
    } finally {
      setClearingItem(null);
    }
  };

  const handleClearUploadQueue = async () => {
    setClearingItem('upload');
    try {
      localStorage.removeItem('autogram_drive_upload_queue');
      showToast(t('ui.generated.cache_antrean_upload_berhasil_dibersihkan_f901a23'));
      triggerCacheRefresh();
    } finally {
      setClearingItem(null);
    }
  };

  const handleResetUiPreferences = async () => {
    setClearingItem('ui');
    try {
      const keys = [
        'autogram_drive_view_mode',
        'autogram_drive_grid_zoom',
        'autogram_drive_sort_mode',
        'autogram_drive_thumb_quality',
        'autogram_drive_task_manager_minimized',
      ];
      for (const k of keys) localStorage.removeItem(k);
      showToast(t('ui.generated.preferensi_ui_berhasil_direset_b123c45'));
      triggerCacheRefresh();
    } finally {
      setClearingItem(null);
    }
  };

  const handleClearAllSystemCaches = async () => {
    setClearingItem('all_system');
    try {
      clearAvatarCache();
      try {
        const { cacheClearDisk } = await import('../../lib/db/jobsApi');
        await cacheClearDisk();
      } catch {}
      clearThumbCache();
      clearPreviewCache();
      await clearPersistentThumbs();
      clearZipBrowserCache();
      handleClearGlobalLocations();
      handleClearGlobalSidebar();
      handleClearGlobalTopics();
      handleClearGlobalPeer();
      handleClearGlobalChatFolders();
      handleClearGlobalScroll();
      localStorage.removeItem('autogram_drive_upload_queue');
      const uiKeys = [
        'autogram_drive_view_mode',
        'autogram_drive_grid_zoom',
        'autogram_drive_sort_mode',
        'autogram_drive_thumb_quality',
        'autogram_drive_task_manager_minimized',
      ];
      for (const k of uiKeys) localStorage.removeItem(k);

      showToast(t('ui.generated.pembersihan_total_cache_sistem_a123f45') + ' berhasil!');
      triggerCacheRefresh();
    } finally {
      setClearingItem(null);
    }
  };

  // --- TAB 2: ITEMISED PER-SESSION CACHE HANDLERS ---
  const handleClearBucket = (bucketKeys: string[], title: string) => {
    if (!selectedSession || bucketKeys.length === 0) return;
    bucketKeys.forEach((key) => {
      localStorage.removeItem(key);
      sessionStorage.removeItem(key);
    });
    showToast(`${title} dibersihkan!`);
    triggerCacheRefresh();
  };

  const handleClearSessionLocations = () =>
    handleClearBucket(sessionBuckets.locations, t('ui.generated.cache_lokasi_folder_sesi_a901b23'));

  const handleClearSessionSidebar = () =>
    handleClearBucket(sessionBuckets.sidebar, t('ui.generated.cache_pohon_sidebar_sesi_f678b90'));

  const handleClearSessionTopics = () =>
    handleClearBucket(sessionBuckets.topics, t('ui.generated.cache_topik_forum_sesi_a890f12'));

  const handleClearSessionPeer = () =>
    handleClearBucket(sessionBuckets.peer, t('ui.generated.metadata_peer_channel_sesi_b345c67'));

  const handleClearSessionChatFolder = () =>
    handleClearBucket(sessionBuckets.chatFolder, t('ui.generated.cache_filter_folder_chat_sesi_a123b45'));

  const handleClearSessionScroll = () =>
    handleClearBucket(sessionBuckets.state, t('ui.generated.cache_scroll_state_workspace_sesi_e123a45'));

  const handleClearSessionCache = () => {
    if (!selectedSession) return;
    const allBucketKeys = [
      ...sessionBuckets.locations,
      ...sessionBuckets.sidebar,
      ...sessionBuckets.topics,
      ...sessionBuckets.peer,
      ...sessionBuckets.chatFolder,
      ...sessionBuckets.state,
    ];

    allBucketKeys.forEach((key) => {
      localStorage.removeItem(key);
      sessionStorage.removeItem(key);
    });

    showToast(t('ui.generated.cache_sesi_berhasil_dibersihkan_e567a89'));
    triggerCacheRefresh();
  };

  // --- DYNAMIC CACHE PRESENCE CHECKS (TAB 1 GLOBAL) ---
  const hasGlobalLocations = Object.keys(localStorage).some((k) => k.startsWith('autogram_drive_locations_v1_'));
  const hasGlobalSidebar = Object.keys(localStorage).some((k) => k.startsWith('autogram_drive_sidebar_v1_'));
  const hasGlobalTopics = Object.keys(localStorage).some((k) => k.startsWith('autogram_drive_topics_v1_'));
  const hasGlobalPeer = Object.keys(localStorage).some(
    (k) => k.startsWith('autogram_drive_peer_v2_') || k === 'autogram_drive_peer'
  );
  const hasGlobalChatFolders = Object.keys(localStorage).some((k) => k.startsWith('autogram_chat_folder_'));
  const hasGlobalScroll = Object.keys(localStorage).some((k) => k.startsWith('autogram_drive_scroll_v1_'));
  const hasGlobalUpload = localStorage.getItem('autogram_drive_upload_queue') !== null;
  const hasGlobalUi =
    localStorage.getItem('autogram_drive_view_mode') !== null ||
    localStorage.getItem('autogram_drive_grid_zoom') !== null ||
    localStorage.getItem('autogram_drive_sort_mode') !== null;

  // --- DYNAMIC CACHE PRESENCE CHECKS (TAB 2 SESSION) ---
  const hasSessionLocations = sessionBuckets.locations.length > 0;
  const hasSessionSidebar = sessionBuckets.sidebar.length > 0;
  const hasSessionTopics = sessionBuckets.topics.length > 0;
  const hasSessionPeer = sessionBuckets.peer.length > 0;
  const hasSessionChatFolder = sessionBuckets.chatFolder.length > 0;
  const hasSessionScroll = sessionBuckets.state.length > 0;
  const hasSessionTotal = sessionKeysCount > 0;

  // Reusable button styling for active vs darkened/disabled states
  const getBtnStyle = (hasData: boolean, activeColor: string, activeBg: string, activeBorder: string) => {
    if (!hasData) {
      return {
        marginTop: '14px',
        alignSelf: 'flex-start' as const,
        background: 'rgba(255, 255, 255, 0.03)',
        color: '#475569',
        border: '1px solid rgba(255, 255, 255, 0.06)',
        borderRadius: '8px',
        padding: '6px 12px',
        fontSize: '0.76rem',
        fontWeight: 600,
        cursor: 'not-allowed' as const,
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        opacity: 0.45,
        transition: 'all 0.18s ease',
      };
    }
    return {
      marginTop: '14px',
      alignSelf: 'flex-start' as const,
      background: activeBg,
      color: activeColor,
      border: activeBorder,
      borderRadius: '8px',
      padding: '6px 12px',
      fontSize: '0.76rem',
      fontWeight: 600,
      cursor: 'pointer' as const,
      display: 'flex',
      alignItems: 'center',
      gap: '6px',
      opacity: 1,
      transition: 'all 0.18s ease',
    };
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(3, 7, 18, 0.78)',
        backdropFilter: 'blur(8px)',
        animation: 'apiBackdropFadeIn 0.22s ease-out',
        padding: '16px',
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '720px',
          background: 'linear-gradient(160deg, rgba(15, 23, 42, 0.96) 0%, rgba(10, 15, 30, 0.98) 100%)',
          border: '1px solid rgba(56, 189, 248, 0.25)',
          borderRadius: '20px',
          boxShadow: '0 25px 60px rgba(0, 0, 0, 0.6), 0 0 30px rgba(56, 189, 248, 0.12)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          animation: 'apiCardPopIn 0.26s cubic-bezier(0.16, 1, 0.3, 1)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* MODAL HEADER */}
        <div
          style={{
            padding: '20px 24px 16px 24px',
            borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div
              style={{
                width: '38px',
                height: '38px',
                borderRadius: '12px',
                background: 'rgba(56, 189, 248, 0.14)',
                border: '1px solid rgba(56, 189, 248, 0.3)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#38bdf8',
              }}
            >
              <SlidersHorizontal size={20} />
            </div>
            <div>
              <h3 style={{ margin: 0, fontSize: '1.12rem', fontWeight: 800, color: '#f8fafc' }}>
                {t('ui.generated.kelola_cache_spesifik_per_sesi_98a71b2')}
              </h3>
              <p style={{ margin: 0, fontSize: '0.78rem', color: '#94a3b8', marginTop: '2px' }}>
                {t('ui.generated.pembersihan_cache_spesifik_sistem_dan_per_akun_f345a90')}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            style={{
              background: 'rgba(255, 255, 255, 0.06)',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              borderRadius: '10px',
              width: '32px',
              height: '32px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#94a3b8',
              cursor: 'pointer',
              transition: 'all 0.18s ease',
            }}
          >
            <X size={18} />
          </button>
        </div>

        {/* TAB NAVIGATION */}
        <div
          style={{
            display: 'flex',
            gap: '8px',
            padding: '12px 24px',
            background: 'rgba(0, 0, 0, 0.2)',
            borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
          }}
        >
          <button
            type="button"
            onClick={() => setActiveTab('system')}
            style={{
              flex: 1,
              padding: '8px 14px',
              borderRadius: '10px',
              fontSize: '0.85rem',
              fontWeight: 600,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              cursor: 'pointer',
              transition: 'all 0.18s ease',
              border: activeTab === 'system' ? '1px solid rgba(56, 189, 248, 0.4)' : '1px solid transparent',
              background: activeTab === 'system' ? 'rgba(56, 189, 248, 0.15)' : 'transparent',
              color: activeTab === 'system' ? '#38bdf8' : '#94a3b8',
            }}
          >
            <HardDrive size={15} />
            <span>{t('ui.generated.cache_spesifik_sistem_8712ab3')}</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('session')}
            style={{
              flex: 1,
              padding: '8px 14px',
              borderRadius: '10px',
              fontSize: '0.85rem',
              fontWeight: 600,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              cursor: 'pointer',
              transition: 'all 0.18s ease',
              border: activeTab === 'session' ? '1px solid rgba(168, 85, 247, 0.4)' : '1px solid transparent',
              background: activeTab === 'session' ? 'rgba(168, 85, 247, 0.15)' : 'transparent',
              color: activeTab === 'session' ? '#c084fc' : '#94a3b8',
            }}
          >
            <UserCheck size={15} />
            <span>{t('ui.generated.cache_per_sesi_akun_c901e23')}</span>
          </button>
        </div>

        {/* MODAL BODY */}
        <div style={{ padding: '20px 24px', maxHeight: '480px', overflowY: 'auto' }}>
          {/* TOAST BANNER */}
          {toastMessage && (
            <div
              style={{
                marginBottom: '16px',
                padding: '10px 14px',
                borderRadius: '10px',
                background: 'rgba(34, 197, 94, 0.15)',
                border: '1px solid rgba(34, 197, 94, 0.35)',
                color: '#4ade80',
                fontSize: '0.82rem',
                fontWeight: 600,
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
              }}
            >
              <CheckCircle2 size={16} />
              <span>{toastMessage}</span>
            </div>
          )}

          {/* TAB 1: SYSTEM SPECIFIC CACHES (Clear 1:1 Global Master + Extended System Storage) */}
          {activeTab === 'system' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '22px' }}>
              {/* SECTION 1: MASTER GLOBAL 1:1 WITH SESSION */}
              <div>
                <div
                  style={{
                    fontSize: '0.78rem',
                    fontWeight: 700,
                    color: '#38bdf8',
                    marginBottom: '10px',
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                  }}
                >
                  <HardDrive size={14} />
                  <span>{t('ui.generated.indukkan_cache_lintas_akun_master_b123c45')}</span>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
                  {/* 1. Global Folder Locations */}
                  <div
                    style={{
                      background: 'rgba(255, 255, 255, 0.03)',
                      border: '1px solid rgba(255, 255, 255, 0.07)',
                      borderRadius: '12px',
                      padding: '14px',
                      display: 'flex',
                      flexDirection: 'column',
                      justifyContent: 'space-between',
                    }}
                  >
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                        <MapPin size={16} style={{ color: '#f87171' }} />
                        <strong style={{ fontSize: '0.88rem', color: '#f8fafc' }}>
                          {t('ui.generated.cache_navigasi_lokasi_semua_akun_b123a45')}
                        </strong>
                      </div>
                      <p style={{ fontSize: '0.75rem', color: '#94a3b8', margin: 0, lineHeight: 1.45 }}>
                        {t('ui.generated.hapus_seluruh_riwayat_navigasi_folder_semua_ak_c567d89')}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={handleClearGlobalLocations}
                      disabled={!hasGlobalLocations || clearingItem === 'locs_global'}
                      style={getBtnStyle(
                        hasGlobalLocations,
                        '#fca5a5',
                        'rgba(239, 68, 68, 0.15)',
                        '1px solid rgba(239, 68, 68, 0.3)'
                      )}
                    >
                      <Trash2 size={13} />
                      <span>
                        {clearingItem === 'locs_global' ? '...' : t('ui.generated.hapus_lokasi_global_e890f12')}
                      </span>
                    </button>
                  </div>

                  {/* 2. Global Sidebar Tree */}
                  <div
                    style={{
                      background: 'rgba(255, 255, 255, 0.03)',
                      border: '1px solid rgba(255, 255, 255, 0.07)',
                      borderRadius: '12px',
                      padding: '14px',
                      display: 'flex',
                      flexDirection: 'column',
                      justifyContent: 'space-between',
                    }}
                  >
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                        <FolderTree size={16} style={{ color: '#38bdf8' }} />
                        <strong style={{ fontSize: '0.88rem', color: '#f8fafc' }}>
                          {t('ui.generated.cache_pohon_sidebar_semua_akun_f345a67')}
                        </strong>
                      </div>
                      <p style={{ fontSize: '0.75rem', color: '#94a3b8', margin: 0, lineHeight: 1.45 }}>
                        {t('ui.generated.hapus_status_buka_tutup_folder_sidebar_semua_a_d890e12')}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={handleClearGlobalSidebar}
                      disabled={!hasGlobalSidebar || clearingItem === 'sidebar_global'}
                      style={getBtnStyle(
                        hasGlobalSidebar,
                        '#38bdf8',
                        'rgba(56, 189, 248, 0.15)',
                        '1px solid rgba(56, 189, 248, 0.3)'
                      )}
                    >
                      <Trash2 size={13} />
                      <span>
                        {clearingItem === 'sidebar_global' ? '...' : t('ui.generated.hapus_sidebar_global_a123b45')}
                      </span>
                    </button>
                  </div>

                  {/* 3. Global Forum Topics */}
                  <div
                    style={{
                      background: 'rgba(255, 255, 255, 0.03)',
                      border: '1px solid rgba(255, 255, 255, 0.07)',
                      borderRadius: '12px',
                      padding: '14px',
                      display: 'flex',
                      flexDirection: 'column',
                      justifyContent: 'space-between',
                    }}
                  >
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                        <MessageSquare size={16} style={{ color: '#c084fc' }} />
                        <strong style={{ fontSize: '0.88rem', color: '#f8fafc' }}>
                          {t('ui.generated.cache_topik_forum_semua_akun_c678d90')}
                        </strong>
                      </div>
                      <p style={{ fontSize: '0.75rem', color: '#94a3b8', margin: 0, lineHeight: 1.45 }}>
                        {t('ui.generated.hapus_seluruh_daftar_topik_obrolan_semua_akun_e123f45')}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={handleClearGlobalTopics}
                      disabled={!hasGlobalTopics || clearingItem === 'topics_global'}
                      style={getBtnStyle(
                        hasGlobalTopics,
                        '#c084fc',
                        'rgba(168, 85, 247, 0.15)',
                        '1px solid rgba(168, 85, 247, 0.3)'
                      )}
                    >
                      <Trash2 size={13} />
                      <span>
                        {clearingItem === 'topics_global' ? '...' : t('ui.generated.hapus_topik_global_b567c89')}
                      </span>
                    </button>
                  </div>

                  {/* 4. Global Peer Metadata */}
                  <div
                    style={{
                      background: 'rgba(255, 255, 255, 0.03)',
                      border: '1px solid rgba(255, 255, 255, 0.07)',
                      borderRadius: '12px',
                      padding: '14px',
                      display: 'flex',
                      flexDirection: 'column',
                      justifyContent: 'space-between',
                    }}
                  >
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                        <Users size={16} style={{ color: '#60a5fa' }} />
                        <strong style={{ fontSize: '0.88rem', color: '#f8fafc' }}>
                          {t('ui.generated.metadata_peer_channel_semua_akun_d901e23')}
                        </strong>
                      </div>
                      <p style={{ fontSize: '0.75rem', color: '#94a3b8', margin: 0, lineHeight: 1.45 }}>
                        {t('ui.generated.hapus_cache_nama_channel_dan_metadata_semua_a_f456a78')}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={handleClearGlobalPeer}
                      disabled={!hasGlobalPeer || clearingItem === 'peer_global'}
                      style={getBtnStyle(
                        hasGlobalPeer,
                        '#60a5fa',
                        'rgba(96, 165, 250, 0.15)',
                        '1px solid rgba(96, 165, 250, 0.3)'
                      )}
                    >
                      <Trash2 size={13} />
                      <span>
                        {clearingItem === 'peer_global' ? '...' : t('ui.generated.hapus_peer_global_c890d12')}
                      </span>
                    </button>
                  </div>

                  {/* 5. Global Chat Folder Filters */}
                  <div
                    style={{
                      background: 'rgba(255, 255, 255, 0.03)',
                      border: '1px solid rgba(255, 255, 255, 0.07)',
                      borderRadius: '12px',
                      padding: '14px',
                      display: 'flex',
                      flexDirection: 'column',
                      justifyContent: 'space-between',
                    }}
                  >
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                        <Folder size={16} style={{ color: '#4ade80' }} />
                        <strong style={{ fontSize: '0.88rem', color: '#f8fafc' }}>
                          {t('ui.generated.cache_filter_folder_chat_semua_akun_f345a67')}
                        </strong>
                      </div>
                      <p style={{ fontSize: '0.75rem', color: '#94a3b8', margin: 0, lineHeight: 1.45 }}>
                        {t('ui.generated.hapus_filter_folder_obrolan_aktif_untuk_seluru_d890e12')}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={handleClearGlobalChatFolders}
                      disabled={!hasGlobalChatFolders || clearingItem === 'chat_folders_global'}
                      style={getBtnStyle(
                        hasGlobalChatFolders,
                        '#4ade80',
                        'rgba(34, 197, 94, 0.15)',
                        '1px solid rgba(34, 197, 94, 0.3)'
                      )}
                    >
                      <Trash2 size={13} />
                      <span>
                        {clearingItem === 'chat_folders_global'
                          ? '...'
                          : t('ui.generated.hapus_filter_global_a123b45')}
                      </span>
                    </button>
                  </div>

                  {/* 6. Global Scroll & Workspace State */}
                  <div
                    style={{
                      background: 'rgba(255, 255, 255, 0.03)',
                      border: '1px solid rgba(255, 255, 255, 0.07)',
                      borderRadius: '12px',
                      padding: '14px',
                      display: 'flex',
                      flexDirection: 'column',
                      justifyContent: 'space-between',
                    }}
                  >
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                        <SlidersHorizontal size={16} style={{ color: '#fbbf24' }} />
                        <strong style={{ fontSize: '0.88rem', color: '#f8fafc' }}>
                          {t('ui.generated.cache_scroll_state_workspace_semua_akun_a123f45')}
                        </strong>
                      </div>
                      <p style={{ fontSize: '0.75rem', color: '#94a3b8', margin: 0, lineHeight: 1.45 }}>
                        {t('ui.generated.hapus_posisi_scroll_dan_preferensi_tampilan_ter_b456c78')}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={handleClearGlobalScroll}
                      disabled={!hasGlobalScroll || clearingItem === 'scroll_global'}
                      style={getBtnStyle(
                        hasGlobalScroll,
                        '#fbbf24',
                        'rgba(245, 158, 11, 0.15)',
                        '1px solid rgba(245, 158, 11, 0.3)'
                      )}
                    >
                      <RotateCcw size={13} />
                      <span>
                        {clearingItem === 'scroll_global' ? '...' : t('ui.generated.hapus_state_d789e01')}
                      </span>
                    </button>
                  </div>
                </div>
              </div>

              {/* SECTION 2: PHYSICAL SYSTEM STORAGE & BROAD SCOPE CACHES */}
              <div>
                <div
                  style={{
                    fontSize: '0.78rem',
                    fontWeight: 700,
                    color: '#fbbf24',
                    marginBottom: '10px',
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                  }}
                >
                  <Sliders size={14} />
                  <span>{t('ui.generated.cache_fisik_penyimpanan_sistem_d567e89')}</span>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
                  {/* Avatar Cache */}
                  <div
                    style={{
                      background: 'rgba(255, 255, 255, 0.03)',
                      border: '1px solid rgba(255, 255, 255, 0.07)',
                      borderRadius: '12px',
                      padding: '14px',
                      display: 'flex',
                      flexDirection: 'column',
                      justifyContent: 'space-between',
                    }}
                  >
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                        <User size={16} style={{ color: '#fca5a5' }} />
                        <strong style={{ fontSize: '0.88rem', color: '#f8fafc' }}>
                          {t('ui.generated.cache_avatar_foto_profil_fd75268')}
                        </strong>
                      </div>
                      <p style={{ fontSize: '0.75rem', color: '#94a3b8', margin: 0, lineHeight: 1.45 }}>
                        {t('ui.generated.hapus_seluruh_cache_foto_profil_lokal_dari_memor_6b0ce9a')}
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={handleClearAvatar}
                      disabled={clearingItem === 'avatar'}
                      style={getBtnStyle(
                        true,
                        '#fca5a5',
                        'rgba(239, 68, 68, 0.15)',
                        '1px solid rgba(239, 68, 68, 0.3)'
                      )}
                    >
                      <RotateCcw size={13} />
                      <span>
                        {clearingItem === 'avatar' ? '...' : t('ui.generated.bersihkan_cache_avatar_b8c07e0')}
                      </span>
                    </button>
                  </div>

                  {/* Temporary Files */}
                  <div
                    style={{
                      background: 'rgba(255, 255, 255, 0.03)',
                      border: '1px solid rgba(255, 255, 255, 0.07)',
                      borderRadius: '12px',
                      padding: '14px',
                      display: 'flex',
                      flexDirection: 'column',
                      justifyContent: 'space-between',
                    }}
                  >
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                        <Trash2 size={16} style={{ color: '#fcd34d' }} />
                        <strong style={{ fontSize: '0.88rem', color: '#f8fafc' }}>
                          {t('ui.generated.file_temporary_chunk_split_794ad52')}
                        </strong>
                      </div>
                      <p style={{ fontSize: '0.75rem', color: '#94a3b8', margin: 0, lineHeight: 1.45 }}>
                        {t('ui.generated.hapus_berkas_sementara_tmp_dan_part_volume_split_63d7fed')}
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={handleClearTempFiles}
                      disabled={clearingItem === 'temp'}
                      style={getBtnStyle(
                        true,
                        '#fcd34d',
                        'rgba(245, 158, 11, 0.15)',
                        '1px solid rgba(245, 158, 11, 0.3)'
                      )}
                    >
                      <Trash2 size={13} />
                      <span>
                        {clearingItem === 'temp' ? '...' : t('ui.generated.bersihkan_file_temporary_c6cb410')}
                      </span>
                    </button>
                  </div>

                  {/* Thumbnails & Previews */}
                  <div
                    style={{
                      background: 'rgba(255, 255, 255, 0.03)',
                      border: '1px solid rgba(255, 255, 255, 0.07)',
                      borderRadius: '12px',
                      padding: '14px',
                      display: 'flex',
                      flexDirection: 'column',
                      justifyContent: 'space-between',
                    }}
                  >
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                        <Image size={16} style={{ color: '#38bdf8' }} />
                        <strong style={{ fontSize: '0.88rem', color: '#f8fafc' }}>
                          {t('ui.generated.cache_thumbnail_pratinjau_f901ab2')}
                        </strong>
                      </div>
                      <p style={{ fontSize: '0.75rem', color: '#94a3b8', margin: 0, lineHeight: 1.45 }}>
                        {t('ui.generated.hapus_bingkai_pratinjau_dan_thumbnail_media_4e12c34')}
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={handleClearThumbnails}
                      disabled={clearingItem === 'thumbs'}
                      style={getBtnStyle(
                        true,
                        '#38bdf8',
                        'rgba(56, 189, 248, 0.15)',
                        '1px solid rgba(56, 189, 248, 0.3)'
                      )}
                    >
                      <RotateCcw size={13} />
                      <span>
                        {clearingItem === 'thumbs' ? '...' : t('ui.generated.bersihkan_cache_thumbnail_a8712bc')}
                      </span>
                    </button>
                  </div>

                  {/* ZIP Archive */}
                  <div
                    style={{
                      background: 'rgba(255, 255, 255, 0.03)',
                      border: '1px solid rgba(255, 255, 255, 0.07)',
                      borderRadius: '12px',
                      padding: '14px',
                      display: 'flex',
                      flexDirection: 'column',
                      justifyContent: 'space-between',
                    }}
                  >
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                        <FolderArchive size={16} style={{ color: '#c084fc' }} />
                        <strong style={{ fontSize: '0.88rem', color: '#f8fafc' }}>
                          {t('ui.generated.cache_zip_navigasi_folder_b123d45')}
                        </strong>
                      </div>
                      <p style={{ fontSize: '0.75rem', color: '#94a3b8', margin: 0, lineHeight: 1.45 }}>
                        {t('ui.generated.bersihkan_ekstraksi_zip_dan_riwayat_folder_5f67e89')}
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={handleClearZipNav}
                      disabled={clearingItem === 'zip'}
                      style={getBtnStyle(
                        true,
                        '#c084fc',
                        'rgba(168, 85, 247, 0.15)',
                        '1px solid rgba(168, 85, 247, 0.3)'
                      )}
                    >
                      <RotateCcw size={13} />
                      <span>
                        {clearingItem === 'zip' ? '...' : t('ui.generated.bersihkan_cache_zip_b8901cd')}
                      </span>
                    </button>
                  </div>

                  {/* Upload Queue & Staging */}
                  <div
                    style={{
                      background: 'rgba(255, 255, 255, 0.03)',
                      border: '1px solid rgba(255, 255, 255, 0.07)',
                      borderRadius: '12px',
                      padding: '14px',
                      display: 'flex',
                      flexDirection: 'column',
                      justifyContent: 'space-between',
                    }}
                  >
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                        <Upload size={16} style={{ color: '#4ade80' }} />
                        <strong style={{ fontSize: '0.88rem', color: '#f8fafc' }}>
                          {t('ui.generated.cache_antrean_upload_staging_f123a45')}
                        </strong>
                      </div>
                      <p style={{ fontSize: '0.75rem', color: '#94a3b8', margin: 0, lineHeight: 1.45 }}>
                        {t('ui.generated.hapus_antrean_upload_tertunda_dan_staging_b678c90')}
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={handleClearUploadQueue}
                      disabled={!hasGlobalUpload || clearingItem === 'upload'}
                      style={getBtnStyle(
                        hasGlobalUpload,
                        '#4ade80',
                        'rgba(34, 197, 94, 0.15)',
                        '1px solid rgba(34, 197, 94, 0.3)'
                      )}
                    >
                      <Trash2 size={13} />
                      <span>
                        {clearingItem === 'upload' ? '...' : t('ui.generated.bersihkan_antrean_upload_d901e23')}
                      </span>
                    </button>
                  </div>

                  {/* Layout & UI Preferences */}
                  <div
                    style={{
                      background: 'rgba(255, 255, 255, 0.03)',
                      border: '1px solid rgba(255, 255, 255, 0.07)',
                      borderRadius: '12px',
                      padding: '14px',
                      display: 'flex',
                      flexDirection: 'column',
                      justifyContent: 'space-between',
                    }}
                  >
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                        <Sliders size={16} style={{ color: '#fbbf24' }} />
                        <strong style={{ fontSize: '0.88rem', color: '#f8fafc' }}>
                          {t('ui.generated.cache_tampilan_preferensi_ui_a234b56')}
                        </strong>
                      </div>
                      <p style={{ fontSize: '0.75rem', color: '#94a3b8', margin: 0, lineHeight: 1.45 }}>
                        {t('ui.generated.reset_pengaturan_zoom_grid_modus_tampilan_sortir_c789d01')}
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={handleResetUiPreferences}
                      disabled={!hasGlobalUi || clearingItem === 'ui'}
                      style={getBtnStyle(
                        hasGlobalUi,
                        '#fbbf24',
                        'rgba(245, 158, 11, 0.15)',
                        '1px solid rgba(245, 158, 11, 0.3)'
                      )}
                    >
                      <RotateCcw size={13} />
                      <span>
                        {clearingItem === 'ui' ? '...' : t('ui.generated.reset_preferensi_ui_e123f45')}
                      </span>
                    </button>
                  </div>
                </div>
              </div>

              {/* MASTER SYSTEM SUMMARY & CLEAR ALL BANNER */}
              <div
                style={{
                  background: 'rgba(239, 68, 68, 0.04)',
                  border: '1px solid rgba(239, 68, 68, 0.18)',
                  borderRadius: '14px',
                  padding: '14px 18px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginTop: '4px',
                }}
              >
                <div>
                  <strong style={{ fontSize: '0.88rem', color: '#f8fafc', display: 'block' }}>
                    {t('ui.generated.pembersihan_total_cache_sistem_a123f45')}
                  </strong>
                  <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>
                    {t('ui.generated.hapus_seluruh_cache_spesifik_sistem_memori_a_b456c78')}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={handleClearAllSystemCaches}
                  disabled={clearingItem === 'all_system'}
                  style={getBtnStyle(
                    true,
                    '#fca5a5',
                    'rgba(239, 68, 68, 0.18)',
                    '1px solid rgba(239, 68, 68, 0.35)'
                  )}
                >
                  <Trash2 size={14} />
                  <span>
                    {clearingItem === 'all_system' ? '...' : t('ui.generated.hapus_seluruh_cache_sistem_d901e23')}
                  </span>
                </button>
              </div>
            </div>
          )}

          {/* TAB 2: PER-SESSION ACCOUNT CACHE (Strict 1:1 Match with Master Section 1) */}
          {activeTab === 'session' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, color: '#f8fafc', marginBottom: '6px' }}>
                  {t('ui.generated.pilih_sesi_akun_telegram_d012a34')}
                </label>

                {sessions.length === 0 ? (
                  <div
                    style={{
                      padding: '14px',
                      background: 'rgba(255, 255, 255, 0.03)',
                      borderRadius: '10px',
                      color: '#94a3b8',
                      fontSize: '0.82rem',
                    }}
                  >
                    {t('ui.generated.tidak_ada_sesi_aktif_ditemukan_f123b45')}
                  </div>
                ) : (
                  <select
                    value={selectedSession}
                    onChange={(e) => setSelectedSession(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '10px 14px',
                      borderRadius: '10px',
                      background: 'rgba(15, 23, 42, 0.8)',
                      border: '1px solid rgba(168, 85, 247, 0.3)',
                      color: '#f8fafc',
                      fontSize: '0.85rem',
                      outline: 'none',
                    }}
                  >
                    {sessions.map((s) => (
                      <option key={s.name} value={s.name}>
                        {s.userFullName} ({s.name}) {s.phone ? `• ${s.phone}` : ''}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              {selectedSession && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                  {/* 6 SPECIFIC ITEM CARDS IN 2x3 GRID */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
                    {/* 1. Folder Locations (Session) */}
                    <div
                      style={{
                        background: 'rgba(255, 255, 255, 0.03)',
                        border: '1px solid rgba(255, 255, 255, 0.07)',
                        borderRadius: '12px',
                        padding: '14px',
                        display: 'flex',
                        flexDirection: 'column',
                        justifyContent: 'space-between',
                      }}
                    >
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <MapPin size={16} style={{ color: '#f87171' }} />
                            <strong style={{ fontSize: '0.88rem', color: '#f8fafc' }}>
                              {t('ui.generated.cache_lokasi_folder_sesi_a901b23')}
                            </strong>
                          </div>
                          <span style={{ fontSize: '0.72rem', color: hasSessionLocations ? '#fca5a5' : '#64748b', fontWeight: 600 }}>
                            {sessionBuckets.locations.length} {t('ui.generated.entri_terdeteksi_c123d45')}
                          </span>
                        </div>
                        <p style={{ fontSize: '0.75rem', color: '#94a3b8', margin: 0, lineHeight: 1.45 }}>
                          {t('ui.generated.hapus_riwayat_navigasi_folder_dan_lokasi_aktif_s_c456d78')}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={handleClearSessionLocations}
                        disabled={!hasSessionLocations}
                        style={getBtnStyle(
                          hasSessionLocations,
                          '#fca5a5',
                          'rgba(239, 68, 68, 0.15)',
                          '1px solid rgba(239, 68, 68, 0.3)'
                        )}
                      >
                        <Trash2 size={13} />
                        <span>{t('ui.generated.hapus_lokasi_e123a45')}</span>
                      </button>
                    </div>

                    {/* 2. Sidebar Tree (Session) */}
                    <div
                      style={{
                        background: 'rgba(255, 255, 255, 0.03)',
                        border: '1px solid rgba(255, 255, 255, 0.07)',
                        borderRadius: '12px',
                        padding: '14px',
                        display: 'flex',
                        flexDirection: 'column',
                        justifyContent: 'space-between',
                      }}
                    >
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <FolderTree size={16} style={{ color: '#38bdf8' }} />
                            <strong style={{ fontSize: '0.88rem', color: '#f8fafc' }}>
                              {t('ui.generated.cache_pohon_sidebar_sesi_f678b90')}
                            </strong>
                          </div>
                          <span style={{ fontSize: '0.72rem', color: hasSessionSidebar ? '#38bdf8' : '#64748b', fontWeight: 600 }}>
                            {sessionBuckets.sidebar.length} {t('ui.generated.entri_terdeteksi_c123d45')}
                          </span>
                        </div>
                        <p style={{ fontSize: '0.75rem', color: '#94a3b8', margin: 0, lineHeight: 1.45 }}>
                          {t('ui.generated.hapus_status_buka_tutup_folder_pada_sidebar_sesi_b123c45')}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={handleClearSessionSidebar}
                        disabled={!hasSessionSidebar}
                        style={getBtnStyle(
                          hasSessionSidebar,
                          '#38bdf8',
                          'rgba(56, 189, 248, 0.15)',
                          '1px solid rgba(56, 189, 248, 0.3)'
                        )}
                      >
                        <Trash2 size={13} />
                        <span>{t('ui.generated.hapus_sidebar_d456e78')}</span>
                      </button>
                    </div>

                    {/* 3. Forum Topics (Session) */}
                    <div
                      style={{
                        background: 'rgba(255, 255, 255, 0.03)',
                        border: '1px solid rgba(255, 255, 255, 0.07)',
                        borderRadius: '12px',
                        padding: '14px',
                        display: 'flex',
                        flexDirection: 'column',
                        justifyContent: 'space-between',
                      }}
                    >
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <MessageSquare size={16} style={{ color: '#c084fc' }} />
                            <strong style={{ fontSize: '0.88rem', color: '#f8fafc' }}>
                              {t('ui.generated.cache_topik_forum_sesi_a890f12')}
                            </strong>
                          </div>
                          <span style={{ fontSize: '0.72rem', color: hasSessionTopics ? '#c084fc' : '#64748b', fontWeight: 600 }}>
                            {sessionBuckets.topics.length} {t('ui.generated.entri_terdeteksi_c123d45')}
                          </span>
                        </div>
                        <p style={{ fontSize: '0.75rem', color: '#94a3b8', margin: 0, lineHeight: 1.45 }}>
                          {t('ui.generated.hapus_daftar_topik_dan_utas_obrolan_sesi_ini_c345d67')}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={handleClearSessionTopics}
                        disabled={!hasSessionTopics}
                        style={getBtnStyle(
                          hasSessionTopics,
                          '#c084fc',
                          'rgba(168, 85, 247, 0.15)',
                          '1px solid rgba(168, 85, 247, 0.3)'
                        )}
                      >
                        <Trash2 size={13} />
                        <span>{t('ui.generated.hapus_topik_e890f12')}</span>
                      </button>
                    </div>

                    {/* 4. Peer Metadata (Session) */}
                    <div
                      style={{
                        background: 'rgba(255, 255, 255, 0.03)',
                        border: '1px solid rgba(255, 255, 255, 0.07)',
                        borderRadius: '12px',
                        padding: '14px',
                        display: 'flex',
                        flexDirection: 'column',
                        justifyContent: 'space-between',
                      }}
                    >
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <Users size={16} style={{ color: '#60a5fa' }} />
                            <strong style={{ fontSize: '0.88rem', color: '#f8fafc' }}>
                              {t('ui.generated.metadata_peer_channel_sesi_b345c67')}
                            </strong>
                          </div>
                          <span style={{ fontSize: '0.72rem', color: hasSessionPeer ? '#60a5fa' : '#64748b', fontWeight: 600 }}>
                            {sessionBuckets.peer.length} {t('ui.generated.entri_terdeteksi_c123d45')}
                          </span>
                        </div>
                        <p style={{ fontSize: '0.75rem', color: '#94a3b8', margin: 0, lineHeight: 1.45 }}>
                          {t('ui.generated.hapus_cache_nama_channel_dan_metadata_entitas_s_d890e12')}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={handleClearSessionPeer}
                        disabled={!hasSessionPeer}
                        style={getBtnStyle(
                          hasSessionPeer,
                          '#60a5fa',
                          'rgba(96, 165, 250, 0.15)',
                          '1px solid rgba(96, 165, 240, 0.3)'
                        )}
                      >
                        <Trash2 size={13} />
                        <span>{t('ui.generated.hapus_peer_f123a45')}</span>
                      </button>
                    </div>

                    {/* 5. Chat Folder Filter (Session) */}
                    <div
                      style={{
                        background: 'rgba(255, 255, 255, 0.03)',
                        border: '1px solid rgba(255, 255, 255, 0.07)',
                        borderRadius: '12px',
                        padding: '14px',
                        display: 'flex',
                        flexDirection: 'column',
                        justifyContent: 'space-between',
                      }}
                    >
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <Folder size={16} style={{ color: '#4ade80' }} />
                            <strong style={{ fontSize: '0.88rem', color: '#f8fafc' }}>
                              {t('ui.generated.cache_filter_folder_chat_sesi_a123b45')}
                            </strong>
                          </div>
                          <span style={{ fontSize: '0.72rem', color: hasSessionChatFolder ? '#4ade80' : '#64748b', fontWeight: 600 }}>
                            {sessionBuckets.chatFolder.length} {t('ui.generated.entri_terdeteksi_c123d45')}
                          </span>
                        </div>
                        <p style={{ fontSize: '0.75rem', color: '#94a3b8', margin: 0, lineHeight: 1.45 }}>
                          {t('ui.generated.hapus_filter_folder_obrolan_aktif_untuk_sesi_ini_c567d89')}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={handleClearSessionChatFolder}
                        disabled={!hasSessionChatFolder}
                        style={getBtnStyle(
                          hasSessionChatFolder,
                          '#4ade80',
                          'rgba(34, 197, 94, 0.15)',
                          '1px solid rgba(34, 197, 94, 0.3)'
                        )}
                      >
                        <Trash2 size={13} />
                        <span>{t('ui.generated.hapus_filter_folder_e890f12')}</span>
                      </button>
                    </div>

                    {/* 6. Scroll & Workspace State (Session) */}
                    <div
                      style={{
                        background: 'rgba(255, 255, 255, 0.03)',
                        border: '1px solid rgba(255, 255, 255, 0.07)',
                        borderRadius: '12px',
                        padding: '14px',
                        display: 'flex',
                        flexDirection: 'column',
                        justifyContent: 'space-between',
                      }}
                    >
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <SlidersHorizontal size={16} style={{ color: '#fbbf24' }} />
                            <strong style={{ fontSize: '0.88rem', color: '#f8fafc' }}>
                              {t('ui.generated.cache_scroll_state_workspace_sesi_e123a45')}
                            </strong>
                          </div>
                          <span style={{ fontSize: '0.72rem', color: hasSessionScroll ? '#fbbf24' : '#64748b', fontWeight: 600 }}>
                            {sessionBuckets.state.length} {t('ui.generated.entri_terdeteksi_c123d45')}
                          </span>
                        </div>
                        <p style={{ fontSize: '0.75rem', color: '#94a3b8', margin: 0, lineHeight: 1.45 }}>
                          {t('ui.generated.hapus_posisi_scroll_dan_preferensi_tampilan_ter_b456c78')}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={handleClearSessionScroll}
                        disabled={!hasSessionScroll}
                        style={getBtnStyle(
                          hasSessionScroll,
                          '#fbbf24',
                          'rgba(245, 158, 11, 0.15)',
                          '1px solid rgba(245, 158, 11, 0.3)'
                        )}
                      >
                        <RotateCcw size={13} />
                        <span>{t('ui.generated.hapus_state_d789e01')}</span>
                      </button>
                    </div>
                  </div>

                  {/* MASTER SESSION SUMMARY & CLEAR ALL BANNER */}
                  <div
                    style={{
                      background: 'rgba(239, 68, 68, 0.04)',
                      border: '1px solid rgba(239, 68, 68, 0.18)',
                      borderRadius: '14px',
                      padding: '14px 18px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      marginTop: '4px',
                    }}
                  >
                    <div>
                      <strong style={{ fontSize: '0.88rem', color: '#f8fafc', display: 'block' }}>
                        {t('ui.generated.pembersihan_total_cache_sesi_c890f12')}
                      </strong>
                      <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>
                        {sessionKeysCount} {t('ui.generated.entri_terdeteksi_c123d45')} • {t('ui.generated.menghapus_cache_sesi_ini_tidak_mengeluarkan_akun_b901c23')}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={handleClearSessionCache}
                      disabled={!hasSessionTotal}
                      style={getBtnStyle(
                        hasSessionTotal,
                        '#fca5a5',
                        'rgba(239, 68, 68, 0.18)',
                        '1px solid rgba(239, 68, 68, 0.35)'
                      )}
                    >
                      <Trash2 size={14} />
                      <span>{t('ui.generated.hapus_seluruh_cache_sesi_f456a78')}</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
