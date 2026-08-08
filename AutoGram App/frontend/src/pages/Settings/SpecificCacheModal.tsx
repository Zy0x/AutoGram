import { useState, useEffect } from 'react';
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

export function SpecificCacheModal({ isOpen, onClose, onRefreshGlobalSize }: SpecificCacheModalProps) {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<'system' | 'session'>('system');
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // System Cache state
  const [clearingItem, setClearingItem] = useState<string | null>(null);

  // Per-Session state
  const [sessions, setSessions] = useState<Array<{ name: string; userFullName?: string; phone?: string }>>([]);
  const [selectedSession, setSelectedSession] = useState<string>('');
  const [sessionKeysCount, setSessionKeysCount] = useState<number>(0);

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

  useEffect(() => {
    if (!selectedSession) {
      setSessionKeysCount(0);
      return;
    }
    // Calculate localStorage keys belonging to this session
    let count = 0;
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (
        key &&
        (key.includes(selectedSession) ||
          key === `autogram_drive_locations_v1_${selectedSession}` ||
          key === `autogram_drive_sidebar_v1_${selectedSession}` ||
          key === `autogram_drive_topics_v1_${selectedSession}` ||
          key === `autogram_drive_scroll_v1_${selectedSession}` ||
          key === `autogram_drive_peer_v2_${selectedSession}`)
      ) {
        count++;
      }
    }
    setSessionKeysCount(count);
  }, [selectedSession]);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
  };

  if (!isOpen) return null;

  const handleClearAvatar = async () => {
    setClearingItem('avatar');
    try {
      clearAvatarCache();
      showToast(t('ui.generated.cache_avatar_berhasil_dibersihkan_a12b34c'));
      onRefreshGlobalSize?.();
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
      onRefreshGlobalSize?.();
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
      onRefreshGlobalSize?.();
    } finally {
      setClearingItem(null);
    }
  };

  const handleClearZipNav = async () => {
    setClearingItem('zip');
    try {
      clearZipBrowserCache();
      showToast(t('ui.generated.cache_zip_navigasi_berhasil_dibersihkan_d012f34'));
      onRefreshGlobalSize?.();
    } finally {
      setClearingItem(null);
    }
  };

  const handleClearUploadQueue = async () => {
    setClearingItem('upload');
    try {
      localStorage.removeItem('autogram_drive_upload_queue');
      showToast(t('ui.generated.cache_antrean_upload_berhasil_dibersihkan_f901a23'));
      onRefreshGlobalSize?.();
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
      onRefreshGlobalSize?.();
    } finally {
      setClearingItem(null);
    }
  };

  const handleClearSessionCache = () => {
    if (!selectedSession) return;
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (
        key &&
        (key.includes(selectedSession) ||
          key === `autogram_drive_locations_v1_${selectedSession}` ||
          key === `autogram_drive_sidebar_v1_${selectedSession}` ||
          key === `autogram_drive_topics_v1_${selectedSession}` ||
          key === `autogram_drive_scroll_v1_${selectedSession}` ||
          key === `autogram_drive_peer_v2_${selectedSession}`)
      ) {
        keysToRemove.push(key);
      }
    }
    for (const key of keysToRemove) {
      localStorage.removeItem(key);
    }

    // SessionStorage
    const sessionStoreKeys: string[] = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const key = sessionStorage.key(i);
      if (key && key.includes(selectedSession)) {
        sessionStoreKeys.push(key);
      }
    }
    for (const key of sessionStoreKeys) {
      sessionStorage.removeItem(key);
    }

    setSessionKeysCount(0);
    showToast(t('ui.generated.cache_sesi_berhasil_dibersihkan_e567a89'));
    onRefreshGlobalSize?.();
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
        background: 'rgba(3, 7, 18, 0.75)',
        backdropFilter: 'blur(8px)',
        animation: 'apiBackdropFadeIn 0.22s ease-out',
        padding: '16px',
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '640px',
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
        <div style={{ padding: '20px 24px', maxHeight: '420px', overflowY: 'auto' }}>
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

          {/* TAB 1: SYSTEM SPECIFIC CACHES */}
          {activeTab === 'system' && (
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
                  style={{
                    marginTop: '14px',
                    alignSelf: 'flex-start',
                    background: 'rgba(239, 68, 68, 0.15)',
                    color: '#fca5a5',
                    border: '1px solid rgba(239, 68, 68, 0.3)',
                    borderRadius: '8px',
                    padding: '6px 12px',
                    fontSize: '0.76rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                  }}
                >
                  <RotateCcw size={13} />
                  <span>
                    {clearingItem === 'avatar'
                      ? '...'
                      : t('ui.generated.bersihkan_cache_avatar_b8c07e0')}
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
                  style={{
                    marginTop: '14px',
                    alignSelf: 'flex-start',
                    background: 'rgba(245, 158, 11, 0.15)',
                    color: '#fcd34d',
                    border: '1px solid rgba(245, 158, 11, 0.3)',
                    borderRadius: '8px',
                    padding: '6px 12px',
                    fontSize: '0.76rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                  }}
                >
                  <Trash2 size={13} />
                  <span>
                    {clearingItem === 'temp'
                      ? '...'
                      : t('ui.generated.bersihkan_file_temporary_c6cb410')}
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
                  style={{
                    marginTop: '14px',
                    alignSelf: 'flex-start',
                    background: 'rgba(56, 189, 248, 0.15)',
                    color: '#38bdf8',
                    border: '1px solid rgba(56, 189, 248, 0.3)',
                    borderRadius: '8px',
                    padding: '6px 12px',
                    fontSize: '0.76rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                  }}
                >
                  <RotateCcw size={13} />
                  <span>
                    {clearingItem === 'thumbs'
                      ? '...'
                      : t('ui.generated.bersihkan_cache_thumbnail_a8712bc')}
                  </span>
                </button>
              </div>

              {/* ZIP & Nav History */}
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
                  style={{
                    marginTop: '14px',
                    alignSelf: 'flex-start',
                    background: 'rgba(168, 85, 247, 0.15)',
                    color: '#c084fc',
                    border: '1px solid rgba(168, 85, 247, 0.3)',
                    borderRadius: '8px',
                    padding: '6px 12px',
                    fontSize: '0.76rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                  }}
                >
                  <RotateCcw size={13} />
                  <span>
                    {clearingItem === 'zip'
                      ? '...'
                      : t('ui.generated.bersihkan_cache_zip_b8901cd')}
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
                  disabled={clearingItem === 'upload'}
                  style={{
                    marginTop: '14px',
                    alignSelf: 'flex-start',
                    background: 'rgba(34, 197, 94, 0.15)',
                    color: '#4ade80',
                    border: '1px solid rgba(34, 197, 94, 0.3)',
                    borderRadius: '8px',
                    padding: '6px 12px',
                    fontSize: '0.76rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                  }}
                >
                  <Trash2 size={13} />
                  <span>
                    {clearingItem === 'upload'
                      ? '...'
                      : t('ui.generated.bersihkan_antrean_upload_d901e23')}
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
                  disabled={clearingItem === 'ui'}
                  style={{
                    marginTop: '14px',
                    alignSelf: 'flex-start',
                    background: 'rgba(245, 158, 11, 0.15)',
                    color: '#fbbf24',
                    border: '1px solid rgba(245, 158, 11, 0.3)',
                    borderRadius: '8px',
                    padding: '6px 12px',
                    fontSize: '0.76rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                  }}
                >
                  <RotateCcw size={13} />
                  <span>
                    {clearingItem === 'ui'
                      ? '...'
                      : t('ui.generated.reset_preferensi_ui_e123f45')}
                  </span>
                </button>
              </div>
            </div>
          )}

          {/* TAB 2: PER-SESSION ACCOUNT CACHE */}
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
                <div
                  style={{
                    background: 'rgba(255, 255, 255, 0.025)',
                    border: '1px solid rgba(255, 255, 255, 0.07)',
                    borderRadius: '14px',
                    padding: '16px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '12px',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <strong style={{ fontSize: '0.9rem', color: '#f8fafc' }}>
                        {t('ui.generated.ringkasan_cache_sesi_e567f89')}
                      </strong>
                      <p style={{ margin: 0, fontSize: '0.76rem', color: '#94a3b8', marginTop: '2px' }}>
                        {t('ui.generated.penyimpanan_navigasi_lokasi_dan_peer_sesi_ini_a123b45')}
                      </p>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <span
                        style={{
                          display: 'inline-block',
                          padding: '4px 10px',
                          borderRadius: '8px',
                          background: 'rgba(168, 85, 247, 0.15)',
                          color: '#c084fc',
                          fontSize: '0.82rem',
                          fontWeight: 700,
                        }}
                      >
                        {sessionKeysCount} {t('ui.generated.entri_terdeteksi_c123d45')}
                      </span>
                    </div>
                  </div>

                  <div
                    style={{
                      paddingTop: '12px',
                      borderTop: '1px solid rgba(255, 255, 255, 0.06)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                    }}
                  >
                    <span style={{ fontSize: '0.78rem', color: '#94a3b8' }}>
                      {t('ui.generated.menghapus_cache_sesi_ini_tidak_mengeluarkan_akun_b901c23')}
                    </span>
                    <button
                      type="button"
                      onClick={handleClearSessionCache}
                      disabled={sessionKeysCount === 0}
                      style={{
                        padding: '7px 14px',
                        borderRadius: '8px',
                        background: sessionKeysCount > 0 ? 'rgba(239, 68, 68, 0.18)' : 'rgba(255, 255, 255, 0.05)',
                        border: sessionKeysCount > 0 ? '1px solid rgba(239, 68, 68, 0.35)' : '1px solid transparent',
                        color: sessionKeysCount > 0 ? '#fca5a5' : '#64748b',
                        fontSize: '0.78rem',
                        fontWeight: 600,
                        cursor: sessionKeysCount > 0 ? 'pointer' : 'not-allowed',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                      }}
                    >
                      <Trash2 size={14} />
                      <span>{t('ui.generated.hapus_cache_sesi_ini_f456a78')}</span>
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
