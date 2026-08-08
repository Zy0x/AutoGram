import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import {
  Zap,
  Folder,
  ArrowRightLeft,
  Plus,
  Star,
  Settings,
  Key,
  X,
  Maximize2,
  MoreVertical,
  Pencil,
  Trash2,
  Loader2,
} from 'lucide-react';
import {
  loadSelectableSessions,
  getSessionMetadata,
  setSessionAlias,
  deleteSessionLocalData,
  type SessionOption,
} from '../../lib/telegram';
import { getCachedAvatar, requestAvatar } from '../../lib/media/avatarBatcher';

import { bootstrapSecureCredentials, useApiCredentialsStatus } from '../../lib/tauri/secureCredentials';
import { useGitHubUpdater } from '../../lib/tauri/githubUpdater';

interface SessionLauncherProps {
  onSelectMode: (sessionName: string, mode: 'drives' | 'forwarder') => void;
  onOpenAccounts: () => void;
  onOpenSettings: () => void;
  onOpenApiSetup: () => void;
}

export function SessionLauncher({
  onSelectMode,
  onOpenAccounts,
  onOpenSettings,
  onOpenApiSetup,
}: SessionLauncherProps) {
  const { t } = useTranslation();
  const { hasError: hasApiError } = useApiCredentialsStatus();
  const { status: updateStatus, latestVersion, releaseUrl, checkNow: recheckUpdate } = useGitHubUpdater();
  const [sessions, setSessions] = useState<SessionOption[]>([]);
  const [avatars, setAvatars] = useState<Record<string, string>>({});
  const [avatarErrors, setAvatarErrors] = useState<Set<string>>(new Set());
  const [defaultSession, setDefaultSession] = useState<string>(() => {
    return localStorage.getItem('autogram_default_session') || '';
  });
  const [previewPhoto, setPreviewPhoto] = useState<{
    url: string;
    title: string;
    subtitle: string;
  } | null>(null);

  const [activeMenuSession, setActiveMenuSession] = useState<string | null>(null);
  const [editingSession, setEditingSession] = useState<SessionOption | null>(null);
  const [aliasInput, setAliasInput] = useState<string>('');
  const [deletingSessionStep1, setDeletingSessionStep1] = useState<SessionOption | null>(null);
  const [deletingSessionStep2, setDeletingSessionStep2] = useState<SessionOption | null>(null);
  const [isDeleting, setIsDeleting] = useState<boolean>(false);

  useEffect(() => {
    const handleOutsideClick = () => {
      setActiveMenuSession(null);
    };
    window.addEventListener('click', handleOutsideClick);
    return () => window.removeEventListener('click', handleOutsideClick);
  }, []);

  const refreshSessions = useCallback((force = false) => {
    loadSelectableSessions({ verify: true, force })
      .then((res: SessionOption[]) => {
        if (Array.isArray(res)) {
          setSessions(res);
          if (!defaultSession && res.length > 0) {
            setDefaultSession(res[0].name);
          }

          // Fetch self profile photo for each session
          bootstrapSecureCredentials()
            .then(({ apiId, apiHash }) => {
              res.forEach((sess) => {
                const cached = (sess as any).photoBase64 || getCachedAvatar(0, sess.name);
                if (cached) {
                  setAvatars((prev) => ({ ...prev, [sess.name]: cached }));
                }
                requestAvatar(
                  { session: sess.name, apiId: String(apiId || ''), apiHash: String(apiHash || '') },
                  0
                )
                  .then((url) => {
                    if (url) {
                      setAvatars((prev) => ({ ...prev, [sess.name]: url }));
                    }
                  })
                  .catch(() => {});
              });
            })
            .catch(() => {});
        }
      })
      .catch(() => {});
  }, [defaultSession]);

  useEffect(() => {
    refreshSessions(true);
    const interval = setInterval(() => {
      refreshSessions(true);
    }, 10000);
    return () => clearInterval(interval);
  }, [refreshSessions]);

  const handlePingSession = (sessionName: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setSessions((prev) =>
      prev.map((s) => (s.name === sessionName ? { ...s, status: 'checking' } : s))
    );
    refreshSessions(true);
  };

  // Handle Esc key to close photo preview modal
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && previewPhoto) {
        setPreviewPhoto(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [previewPhoto]);

  const handleSetDefault = (name: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setDefaultSession(name);
    localStorage.setItem('autogram_default_session', name);
  };

  const displaySessions: SessionOption[] = sessions.length > 0 ? sessions : [
    {
      name: 'Lavender',
      label: 'Lavender (@lv_drr)',
      status: 'active',
      latencyMs: 15,
      isPremium: true,
      datacenterId: 4,
    } as SessionOption,
  ];

  return (
    <div
      style={{
        minHeight: '100vh',
        width: '100vw',
        background: 'radial-gradient(ellipse at top, #111827 0%, #060911 100%)',
        color: '#f8fafc',
        display: 'flex',
        flexDirection: 'column',
        boxSizing: 'border-box',
        overflow: 'auto',
      }}
    >
      {/* TOP LAUNCHER NAVBAR */}
      <header
        style={{
          height: '64px',
          padding: '0 32px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
          background: 'rgba(9, 14, 26, 0.7)',
          backdropFilter: 'blur(16px)',
          position: 'sticky',
          top: 0,
          zIndex: 50,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div
            style={{
              width: '38px',
              height: '38px',
              borderRadius: '10px',
              background: 'linear-gradient(135deg, #0284c7 0%, #4f46e5 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 4px 12px rgba(56, 189, 248, 0.3)',
              flexShrink: 0,
            }}
          >
            <Zap size={20} style={{ color: '#ffffff' }} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', height: '38px' }}>
            <h2 style={{ margin: 0, fontSize: '1.12rem', fontWeight: 800, color: '#f8fafc', lineHeight: 1.1, letterSpacing: '-0.02em' }}>
              {t('nav.launcher_brand')}
            </h2>
            <span style={{ fontSize: '0.72rem', color: '#94a3b8', fontWeight: 500, lineHeight: 1.15, display: 'block', marginTop: '2px' }}>
              {t('nav.launcher_engine')}
            </span>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <button
            type="button"
            onClick={onOpenAccounts}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              padding: '8px 14px',
              borderRadius: '10px',
              background: 'rgba(56, 189, 248, 0.12)',
              border: '1px solid rgba(56, 189, 248, 0.3)',
              color: '#38bdf8',
              fontSize: '0.82rem',
              fontWeight: 600,
              cursor: 'pointer',
              transition: 'all 0.15s ease',
            }}
          >
            <Plus size={15} />
            <span>{t('nav.add_session')}</span>
          </button>

          <button
            type="button"
            onClick={onOpenApiSetup}
            className={hasApiError ? 'api-credentials-btn-error' : undefined}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              padding: '0 12px',
              height: '36px',
              borderRadius: '10px',
              fontSize: '0.82rem',
              fontWeight: 600,
              cursor: 'pointer',
              transition: 'all 0.15s ease',
              ...(hasApiError
                ? {}
                : {
                    background: 'rgba(56, 189, 248, 0.12)',
                    border: '1px solid rgba(56, 189, 248, 0.3)',
                    color: '#38bdf8',
                  }),
            }}
            title={hasApiError ? t('ui.generated.api_id_hash_belum_terisi_buka_settings_dan_simpa_9ccf412') : t('settings.api_config')}
            aria-label={t('settings.api_config')}
          >
            <Key size={15} />
            <span>{t('nav.api_credentials_btn')}</span>
          </button>

          <button
            type="button"
            onClick={onOpenSettings}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              padding: '0 12px',
              height: '36px',
              borderRadius: '10px',
              background: 'rgba(255, 255, 255, 0.05)',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              color: '#94a3b8',
              fontSize: '0.82rem',
              fontWeight: 500,
              cursor: 'pointer',
            }}
            title={t('nav.general_settings')}
            aria-label={t('nav.general_settings')}
          >
            <Settings size={15} />
            <span>{t('nav.settings')}</span>
          </button>
        </div>
      </header>

      {/* HERO SECTION */}
      <main style={{ flex: 1, maxWidth: '1120px', width: '100%', margin: '0 auto', padding: '40px 24px 60px', boxSizing: 'border-box' }}>
        <div style={{ textAlign: 'center', marginBottom: '40px' }}>
          <h1 style={{ fontSize: '2.1rem', fontWeight: 800, margin: '0 0 10px 0', letterSpacing: '-0.02em' }}>
            {t('nav.launcher_title')}
          </h1>
          <p style={{ fontSize: '0.92rem', color: '#94a3b8', margin: 0, maxWidth: '620px', marginInline: 'auto', lineHeight: 1.5 }}>
            {t('nav.launcher_subtitle')}
          </p>
        </div>

        {/* SESSION CARDS GRID */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))',
            gap: '24px',
            maxWidth: '1080px',
            margin: '0 auto',
          }}
        >
          {displaySessions.map((sess) => {
            const isDefault = defaultSession === sess.name;
            const displayName = sess.label || sess.name;
            const avatarUrl = avatars[sess.name] || getCachedAvatar(0, sess.name);
            const showAvatar = Boolean(avatarUrl && !avatarErrors.has(sess.name));

            return (
              <div
                key={sess.name}
                style={{
                  borderRadius: '20px',
                  background: 'linear-gradient(150deg, rgba(20, 26, 38, 0.85) 0%, rgba(11, 16, 26, 0.95) 100%)',
                  border: isDefault ? '1.5px solid #38bdf8' : '1px solid rgba(255, 255, 255, 0.1)',
                  boxShadow: isDefault
                    ? '0 20px 40px -15px rgba(56, 189, 248, 0.25), inset 0 1px rgba(255,255,255,0.1)'
                    : '0 16px 36px -15px rgba(0, 0, 0, 0.5), inset 0 1px rgba(255,255,255,0.05)',
                  padding: '24px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '20px',
                  position: 'relative',
                  backdropFilter: 'blur(16px)',
                  transition: 'all 0.2s ease',
                }}
              >
                {/* DEFAULT BADGE / SET DEFAULT BUTTON */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', minHeight: '26px' }}>
                  <div
                    onClick={(e) => handlePingSession(sess.name, e)}
                    title={t('nav.ping_tooltip', { defaultValue: 'Klik untuk uji ping koneksi real-time' })}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '7px',
                      cursor: 'pointer',
                      padding: '2px 0',
                      userSelect: 'none',
                    }}
                  >
                    {sess.status === 'expired' || sess.status === 'unauthorized' ? (
                      <>
                        <span
                          className="ag-status-dot-pulse"
                          style={{
                            width: '7px',
                            height: '7px',
                            borderRadius: '50%',
                            backgroundColor: '#ef4444',
                            color: '#ef4444',
                          }}
                        />
                        <span style={{ fontSize: '0.76rem', color: '#fca5a5', fontWeight: 600 }}>
                          {t('nav.connection_expired')}
                        </span>
                      </>
                    ) : sess.status === 'checking' ? (
                      <>
                        <span
                          className="ag-status-dot-pulse"
                          style={{
                            width: '7px',
                            height: '7px',
                            borderRadius: '50%',
                            backgroundColor: '#38bdf8',
                            color: '#38bdf8',
                          }}
                        />
                        <span style={{ fontSize: '0.76rem', color: '#38bdf8', fontWeight: 600 }}>
                          {t('nav.connection_checking')}
                        </span>
                      </>
                    ) : sess.status === 'error' || sess.status === 'offline' ? (
                      <>
                        <span
                          className="ag-status-dot-pulse"
                          style={{
                            width: '7px',
                            height: '7px',
                            borderRadius: '50%',
                            backgroundColor: '#f59e0b',
                            color: '#f59e0b',
                          }}
                        />
                        <span style={{ fontSize: '0.76rem', color: '#fbbf24', fontWeight: 600 }}>
                          {t('nav.connection_error')}
                        </span>
                      </>
                    ) : (
                      <>
                        <span
                          className="ag-status-dot-pulse"
                          style={{
                            width: '7px',
                            height: '7px',
                            borderRadius: '50%',
                            backgroundColor: '#10b981',
                            color: '#10b981',
                          }}
                        />
                        <span style={{ fontSize: '0.76rem', color: '#34d399', fontWeight: 600 }}>
                          {t('nav.connection_strong', { latency: sess.latencyMs || 15 })}
                        </span>
                      </>
                    )}
                  </div>

                  {/* RIGHT GROUP: SET DEFAULT + THREE DOTS SIDE-BY-SIDE */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <button
                      type="button"
                      onClick={(e) => handleSetDefault(sess.name, e)}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '5px',
                        padding: isDefault ? '3px 10px' : '3px 6px',
                        borderRadius: '10px',
                        background: isDefault ? 'rgba(56, 189, 248, 0.12)' : 'transparent',
                        border: isDefault ? '1px solid rgba(56, 189, 248, 0.35)' : '1px solid transparent',
                        color: isDefault ? '#38bdf8' : '#64748b',
                        fontSize: '0.73rem',
                        fontWeight: isDefault ? 600 : 500,
                        cursor: 'pointer',
                        transition: 'all 0.18s ease',
                      }}
                      onMouseEnter={(e) => {
                        const starIcon = e.currentTarget.querySelector('svg');
                        if (isDefault) {
                          e.currentTarget.style.background = 'rgba(56, 189, 248, 0.22)';
                          e.currentTarget.style.borderColor = '#38bdf8';
                          e.currentTarget.style.color = '#e0f2fe';
                          e.currentTarget.style.boxShadow = '0 0 12px rgba(56, 189, 248, 0.35)';
                          if (starIcon) starIcon.style.transform = 'rotate(15deg) scale(1.15)';
                        } else {
                          e.currentTarget.style.color = '#38bdf8';
                          e.currentTarget.style.background = 'rgba(56, 189, 248, 0.08)';
                          e.currentTarget.style.borderColor = 'rgba(56, 189, 248, 0.2)';
                          if (starIcon) starIcon.style.transform = 'rotate(15deg)';
                        }
                      }}
                      onMouseLeave={(e) => {
                        const starIcon = e.currentTarget.querySelector('svg');
                        if (isDefault) {
                          e.currentTarget.style.background = 'rgba(56, 189, 248, 0.12)';
                          e.currentTarget.style.borderColor = 'rgba(56, 189, 248, 0.35)';
                          e.currentTarget.style.color = '#38bdf8';
                          e.currentTarget.style.boxShadow = 'none';
                          if (starIcon) starIcon.style.transform = 'rotate(0deg) scale(1)';
                        } else {
                          e.currentTarget.style.background = 'transparent';
                          e.currentTarget.style.borderColor = 'transparent';
                          e.currentTarget.style.color = '#64748b';
                          if (starIcon) starIcon.style.transform = 'rotate(0deg)';
                        }
                      }}
                    >
                      <Star
                        size={12}
                        fill={isDefault ? '#38bdf8' : 'none'}
                        style={{ transition: 'transform 0.18s ease, fill 0.18s ease, color 0.18s ease' }}
                      />
                      <span>{isDefault ? t('nav.default_badge') : t('nav.set_as_default')}</span>
                    </button>

                    {/* THREE-DOT MENU BUTTON & DROPDOWN */}
                    <div style={{ position: 'relative' }}>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setActiveMenuSession(activeMenuSession === sess.name ? null : sess.name);
                        }}
                        style={{
                          background: 'transparent',
                          border: 'none',
                          color: '#94a3b8',
                          padding: '4px',
                          borderRadius: '8px',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          transition: 'all 0.15s ease',
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)';
                          e.currentTarget.style.color = '#f8fafc';
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.background = 'transparent';
                          e.currentTarget.style.color = '#94a3b8';
                        }}
                        title="Menu Akun"
                      >
                        <MoreVertical size={16} />
                      </button>

                      {/* DROPDOWN MENU */}
                      {activeMenuSession === sess.name && (
                        <div
                          style={{
                            position: 'absolute',
                            top: '100%',
                            right: 0,
                            marginTop: '6px',
                            width: '160px',
                            background: 'rgba(15, 23, 42, 0.95)',
                            border: '1px solid rgba(255, 255, 255, 0.12)',
                            borderRadius: '12px',
                            boxShadow: '0 10px 30px rgba(0, 0, 0, 0.6), 0 0 1px rgba(255,255,255,0.2)',
                            backdropFilter: 'blur(16px)',
                            zIndex: 100,
                            padding: '6px',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '2px',
                          }}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button
                            type="button"
                            onClick={() => {
                              setActiveMenuSession(null);
                              setEditingSession(sess);
                              setAliasInput(sess.label || sess.name);
                            }}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: '8px',
                              width: '100%',
                              padding: '8px 10px',
                              background: 'transparent',
                              border: 'none',
                              borderRadius: '8px',
                              color: '#e2e8f0',
                              fontSize: '0.8rem',
                              fontWeight: 500,
                              cursor: 'pointer',
                              transition: 'all 0.15s ease',
                              textAlign: 'left',
                            }}
                            onMouseEnter={(e) => {
                              e.currentTarget.style.background = 'rgba(56, 189, 248, 0.15)';
                              e.currentTarget.style.color = '#38bdf8';
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.background = 'transparent';
                              e.currentTarget.style.color = '#e2e8f0';
                            }}
                          >
                            <Pencil size={14} style={{ color: '#38bdf8' }} />
                            {t('nav.menu_edit_account')}
                          </button>

                          <button
                            type="button"
                            onClick={() => {
                              setActiveMenuSession(null);
                              setDeletingSessionStep1(sess);
                            }}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: '8px',
                              width: '100%',
                              padding: '8px 10px',
                              background: 'transparent',
                              border: 'none',
                              borderRadius: '8px',
                              color: '#fca5a5',
                              fontSize: '0.8rem',
                              fontWeight: 500,
                              cursor: 'pointer',
                              transition: 'all 0.15s ease',
                              textAlign: 'left',
                            }}
                            onMouseEnter={(e) => {
                              e.currentTarget.style.background = 'rgba(239, 68, 68, 0.18)';
                              e.currentTarget.style.color = '#ef4444';
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.background = 'transparent';
                              e.currentTarget.style.color = '#fca5a5';
                            }}
                          >
                            <Trash2 size={14} style={{ color: '#ef4444' }} />
                            {t('nav.menu_delete_account')}
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* ACCOUNT PROFILE HEADER */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                  <div
                    onClick={() => {
                      if (showAvatar && avatarUrl) {
                        const meta = getSessionMetadata(sess.name);
                        const displayId = meta?.telegramUserId ? String(meta.telegramUserId) : sess.name.replace(/^session_/, '');
                        setPreviewPhoto({
                          url: avatarUrl,
                          title: displayName,
                          subtitle: t('nav.session_id_value', { session: displayId }),
                        });
                      }
                    }}
                    title={showAvatar ? t('nav.view_profile_photo') : undefined}
                    style={{
                      width: '52px',
                      height: '52px',
                      borderRadius: '16px',
                      background: 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)',
                      border: showAvatar
                        ? '1.5px solid rgba(56, 189, 248, 0.5)'
                        : '1px solid rgba(255,255,255,0.12)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '1.3rem',
                      fontWeight: 700,
                      color: '#38bdf8',
                      overflow: 'hidden',
                      flexShrink: 0,
                      cursor: showAvatar ? 'pointer' : 'default',
                      position: 'relative',
                      transition: 'transform 0.18s ease, border-color 0.18s ease, box-shadow 0.18s ease',
                    }}
                    onMouseEnter={(e) => {
                      if (showAvatar) {
                        e.currentTarget.style.transform = 'scale(1.06)';
                        e.currentTarget.style.borderColor = '#38bdf8';
                        e.currentTarget.style.boxShadow = '0 0 16px rgba(56, 189, 248, 0.4)';
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (showAvatar) {
                        e.currentTarget.style.transform = 'scale(1)';
                        e.currentTarget.style.borderColor = 'rgba(56, 189, 248, 0.5)';
                        e.currentTarget.style.boxShadow = 'none';
                      }
                    }}
                  >
                    {showAvatar ? (
                      <>
                        <img
                          src={avatarUrl!}
                          alt={displayName}
                          onError={() => setAvatarErrors((prev) => new Set(prev).add(sess.name))}
                          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                        />
                        <div
                          style={{
                            position: 'absolute',
                            inset: 0,
                            background: 'rgba(0,0,0,0.3)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            opacity: 0,
                            transition: 'opacity 0.18s ease',
                          }}
                          className="ag-avatar-zoom-overlay"
                        >
                          <Maximize2 size={16} style={{ color: '#ffffff' }} />
                        </div>
                      </>
                    ) : (
                      displayName.charAt(0).toUpperCase()
                    )}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {displayName}
                      </h3>
                      {(sess as any).premium && (
                        <span
                          style={{
                            fontSize: '0.65rem',
                            padding: '2px 6px',
                            borderRadius: '6px',
                            background: 'linear-gradient(135deg, #818cf8 0%, #c084fc 100%)',
                            color: '#ffffff',
                            fontWeight: 700,
                          }}
                        >
                          {t('ui.generated.premium_71c7725')}
                        </span>
                      )}
                    </div>
                    <span style={{ fontSize: '0.78rem', color: '#94a3b8' }}>
                      {(() => {
                        const meta = getSessionMetadata(sess.name);
                        const displayId = meta?.telegramUserId ? String(meta.telegramUserId) : sess.name.replace(/^session_/, '');
                        return t('nav.session_id_value', { session: displayId });
                      })()} {(sess as any).datacenterId ? `· DC${(sess as any).datacenterId}` : ''}
                    </span>
                  </div>
                </div>

                <hr style={{ border: 0, borderTop: '1px solid rgba(255,255,255,0.06)', margin: 0 }} />

                {sess.status === 'expired' || sess.status === 'unauthorized' ? (
                  <div
                    style={{
                      padding: '14px 16px',
                      borderRadius: '14px',
                      background: 'rgba(239, 68, 68, 0.12)',
                      border: '1px solid rgba(239, 68, 68, 0.35)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: '12px',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
                      <X size={18} style={{ color: '#ef4444', flexShrink: 0 }} />
                      <span style={{ fontSize: '0.78rem', color: '#fca5a5', fontWeight: 500 }}>
                        {t('nav.session_expired_desc')}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={onOpenAccounts}
                      style={{
                        padding: '8px 14px',
                        borderRadius: '10px',
                        background: 'linear-gradient(135deg, rgba(239, 68, 68, 0.3), rgba(225, 29, 72, 0.4))',
                        border: '1px solid rgba(248, 113, 113, 0.6)',
                        color: '#ffffff',
                        fontSize: '0.78rem',
                        fontWeight: 600,
                        cursor: 'pointer',
                        whiteSpace: 'nowrap',
                        boxShadow: '0 4px 12px rgba(239, 68, 68, 0.25)',
                        transition: 'all 0.15s ease',
                      }}
                    >
                      {t('nav.relogin_button')}
                    </button>
                  </div>
                ) : (
                  /* MODE ACTION BUTTONS */
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                    {/* BUKA DRIVES */}
                    <button
                      type="button"
                      onClick={() => onSelectMode(sess.name, 'drives')}
                      style={{
                        padding: '14px 16px',
                        borderRadius: '14px',
                        background: 'linear-gradient(135deg, rgba(56, 189, 248, 0.15) 0%, rgba(3, 105, 161, 0.25) 100%)',
                        border: '1px solid rgba(56, 189, 248, 0.35)',
                        color: '#bae6fd',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        gap: '8px',
                        cursor: 'pointer',
                        transition: 'all 0.18s ease',
                        textAlign: 'center',
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.transform = 'translateY(-2px)';
                        e.currentTarget.style.borderColor = '#38bdf8';
                        e.currentTarget.style.boxShadow = '0 8px 20px rgba(56, 189, 248, 0.25)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.transform = 'translateY(0)';
                        e.currentTarget.style.borderColor = 'rgba(56, 189, 248, 0.35)';
                        e.currentTarget.style.boxShadow = 'none';
                      }}
                    >
                      <Folder size={22} style={{ color: '#38bdf8' }} />
                      <div>
                        <strong style={{ display: 'block', fontSize: '0.92rem', color: '#f8fafc' }}>
                          {t('nav.open_drives')}
                        </strong>
                        <span style={{ fontSize: '0.72rem', color: '#94a3b8' }}>{t('nav.drives_workspace_desc')}</span>
                      </div>
                    </button>

                    {/* BUKA FORWARDER */}
                    <button
                      type="button"
                      onClick={() => onSelectMode(sess.name, 'forwarder')}
                      style={{
                        padding: '14px 16px',
                        borderRadius: '14px',
                        background: 'linear-gradient(135deg, rgba(99, 102, 241, 0.15) 0%, rgba(67, 56, 202, 0.25) 100%)',
                        border: '1px solid rgba(99, 102, 241, 0.35)',
                        color: '#c7d2fe',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        gap: '8px',
                        cursor: 'pointer',
                        transition: 'all 0.18s ease',
                        textAlign: 'center',
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.transform = 'translateY(-2px)';
                        e.currentTarget.style.borderColor = '#818cf8';
                        e.currentTarget.style.boxShadow = '0 8px 20px rgba(99, 102, 241, 0.25)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.transform = 'translateY(0)';
                        e.currentTarget.style.borderColor = 'rgba(99, 102, 241, 0.35)';
                        e.currentTarget.style.boxShadow = 'none';
                      }}
                    >
                      <ArrowRightLeft size={22} style={{ color: '#818cf8' }} />
                      <div>
                        <strong style={{ display: 'block', fontSize: '0.92rem', color: '#f8fafc' }}>
                          {t('nav.open_forwarder')}
                        </strong>
                        <span style={{ fontSize: '0.72rem', color: '#94a3b8' }}>{t('nav.forwarder_workspace_desc')}</span>
                      </div>
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </main>

      {/* PHOTO PREVIEW LIGHTBOX MODAL */}
      {previewPhoto && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 99999,
            background: 'rgba(6, 9, 17, 0.85)',
            backdropFilter: 'blur(16px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '24px',
          }}
          onClick={() => setPreviewPhoto(null)}
        >
          <div
            style={{
              position: 'relative',
              maxWidth: '520px',
              width: '100%',
              background: 'linear-gradient(150deg, rgba(20, 26, 38, 0.95) 0%, rgba(11, 16, 26, 0.98) 100%)',
              border: '1px solid rgba(255, 255, 255, 0.15)',
              borderRadius: '24px',
              padding: '32px',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.7), 0 0 30px rgba(56, 189, 248, 0.25)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => setPreviewPhoto(null)}
              style={{
                position: 'absolute',
                top: '16px',
                right: '16px',
                width: '36px',
                height: '36px',
                borderRadius: '50%',
                background: 'rgba(255, 255, 255, 0.08)',
                border: '1px solid rgba(255, 255, 255, 0.12)',
                color: '#f8fafc',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
              title={t('nav.close_preview')}
            >
              <X size={18} />
            </button>

            <div
              style={{
                width: '320px',
                height: '320px',
                maxWidth: '80vw',
                maxHeight: '80vw',
                borderRadius: '50%',
                overflow: 'hidden',
                border: '3px solid rgba(56, 189, 248, 0.6)',
                boxShadow: '0 12px 32px rgba(0, 0, 0, 0.6), 0 0 24px rgba(56, 189, 248, 0.3)',
                marginBottom: '20px',
                background: '#0f172a',
              }}
            >
              <img
                src={previewPhoto.url}
                alt={previewPhoto.title}
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              />
            </div>

            <h3 style={{ margin: '0 0 4px 0', fontSize: '1.25rem', fontWeight: 800, color: '#f8fafc', textAlign: 'center' }}>
              {previewPhoto.title}
            </h3>
            <span style={{ fontSize: '0.82rem', color: '#94a3b8', textAlign: 'center' }}>
              {previewPhoto.subtitle}
            </span>
          </div>
        </div>
      )}

      {/* EDIT ACCOUNT MODAL */}
      {editingSession && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.75)',
            backdropFilter: 'blur(8px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
            padding: '20px',
          }}
          onClick={() => setEditingSession(null)}
        >
          <div
            style={{
              width: '100%',
              maxWidth: '420px',
              background: 'linear-gradient(150deg, #1e293b 0%, #0f172a 100%)',
              border: '1px solid rgba(56, 189, 248, 0.35)',
              borderRadius: '20px',
              padding: '24px',
              boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.8), 0 0 20px rgba(56, 189, 248, 0.15)',
              display: 'flex',
              flexDirection: 'column',
              gap: '18px',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <Pencil size={20} style={{ color: '#38bdf8' }} />
                <div>
                  <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700, color: '#f8fafc' }}>
                    {t('nav.modal_edit_title')}
                  </h3>
                  <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>
                    {t('nav.modal_edit_subtitle')}
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setEditingSession(null)}
                style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer' }}
              >
                <X size={18} />
              </button>
            </div>

            <div>
              <input
                type="text"
                value={aliasInput}
                onChange={(e) => setAliasInput(e.target.value)}
                placeholder={t('nav.modal_edit_placeholder')}
                autoFocus
                style={{
                  width: '100%',
                  padding: '12px 14px',
                  borderRadius: '12px',
                  background: 'rgba(0, 0, 0, 0.35)',
                  border: '1px solid rgba(255, 255, 255, 0.15)',
                  color: '#ffffff',
                  fontSize: '0.9rem',
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    setSessionAlias(editingSession.name, aliasInput);
                    setEditingSession(null);
                    refreshSessions(true);
                  }
                }}
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '4px' }}>
              <button
                type="button"
                onClick={() => setEditingSession(null)}
                style={{
                  padding: '8px 16px',
                  borderRadius: '10px',
                  background: 'rgba(255, 255, 255, 0.05)',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  color: '#94a3b8',
                  fontSize: '0.82rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                {t('nav.modal_cancel')}
              </button>
              <button
                type="button"
                onClick={() => {
                  setSessionAlias(editingSession.name, aliasInput);
                  setEditingSession(null);
                  refreshSessions(true);
                }}
                style={{
                  padding: '8px 18px',
                  borderRadius: '10px',
                  background: 'linear-gradient(135deg, #0284c7 0%, #2563eb 100%)',
                  border: 'none',
                  color: '#ffffff',
                  fontSize: '0.82rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                  boxShadow: '0 4px 14px rgba(2, 132, 199, 0.4)',
                }}
              >
                {t('nav.modal_save')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* DELETE STEP 1 CONFIRMATION MODAL */}
      {deletingSessionStep1 && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.75)',
            backdropFilter: 'blur(8px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
            padding: '20px',
          }}
          onClick={() => setDeletingSessionStep1(null)}
        >
          <div
            style={{
              width: '100%',
              maxWidth: '440px',
              background: 'linear-gradient(150deg, #1e1b2e 0%, #0f172a 100%)',
              border: '1px solid rgba(239, 68, 68, 0.4)',
              borderRadius: '20px',
              padding: '24px',
              boxShadow: '0 25px 50px -12px rgba(239, 68, 68, 0.3)',
              display: 'flex',
              flexDirection: 'column',
              gap: '18px',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <div
                style={{
                  width: '40px',
                  height: '40px',
                  borderRadius: '12px',
                  background: 'rgba(239, 68, 68, 0.2)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                <Trash2 size={20} style={{ color: '#ef4444' }} />
              </div>
              <div>
                <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700, color: '#f8fafc' }}>
                  {t('nav.modal_delete_step1_title')}
                </h3>
                <span style={{ fontSize: '0.78rem', color: '#fca5a5' }}>
                  {t('nav.modal_delete_step1_step_badge')}
                </span>
              </div>
            </div>

            <p style={{ margin: 0, fontSize: '0.88rem', color: '#cbd5e1', lineHeight: 1.6, textAlign: 'justify', textJustify: 'inter-word' }}>
              {t('nav.modal_delete_step1_msg', { name: deletingSessionStep1.label || deletingSessionStep1.name })}
            </p>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <button
                type="button"
                onClick={() => setDeletingSessionStep1(null)}
                style={{
                  padding: '8px 16px',
                  borderRadius: '10px',
                  background: 'rgba(255, 255, 255, 0.05)',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  color: '#94a3b8',
                  fontSize: '0.82rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                {t('nav.modal_cancel')}
              </button>
              <button
                type="button"
                onClick={() => {
                  const target = deletingSessionStep1;
                  setDeletingSessionStep1(null);
                  setDeletingSessionStep2(target);
                }}
                style={{
                  padding: '8px 18px',
                  borderRadius: '10px',
                  background: 'linear-gradient(135deg, #dc2626 0%, #b91c1c 100%)',
                  border: 'none',
                  color: '#ffffff',
                  fontSize: '0.82rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                  boxShadow: '0 4px 14px rgba(220, 38, 38, 0.4)',
                }}
              >
                {t('nav.modal_delete_step1_proceed')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* DELETE STEP 2 PURGE OPTIONS MODAL */}
      {deletingSessionStep2 && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.75)',
            backdropFilter: 'blur(8px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
            padding: '20px',
          }}
          onClick={() => !isDeleting && setDeletingSessionStep2(null)}
        >
          <div
            style={{
              width: '100%',
              maxWidth: '470px',
              background: 'linear-gradient(150deg, #1e1b2e 0%, #0f172a 100%)',
              border: '1px solid rgba(239, 68, 68, 0.4)',
              borderRadius: '20px',
              padding: '24px',
              boxShadow: '0 25px 50px -12px rgba(239, 68, 68, 0.3)',
              display: 'flex',
              flexDirection: 'column',
              gap: '18px',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <div
                style={{
                  width: '40px',
                  height: '40px',
                  borderRadius: '12px',
                  background: 'rgba(239, 68, 68, 0.2)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                <Folder size={20} style={{ color: '#f87171' }} />
              </div>
              <div>
                <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700, color: '#f8fafc' }}>
                  {t('nav.modal_delete_step2_title')}
                </h3>
                <span style={{ fontSize: '0.78rem', color: '#fca5a5' }}>
                  {t('nav.modal_delete_step2_step_badge')}
                </span>
              </div>
            </div>

            <p style={{ margin: 0, fontSize: '0.88rem', color: '#cbd5e1', lineHeight: 1.6, textAlign: 'justify', textJustify: 'inter-word' }}>
              {t('nav.modal_delete_step2_msg', { name: deletingSessionStep2.label || deletingSessionStep2.name })}
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '4px' }}>
              <button
                type="button"
                disabled={isDeleting}
                onClick={async () => {
                  setIsDeleting(true);
                  try {
                    const targetName = deletingSessionStep2.name;
                    await invoke('delete_session_rust', { session: targetName });
                    deleteSessionLocalData(targetName, false);
                    if (defaultSession === targetName) {
                      localStorage.removeItem('autogram_default_session');
                      setDefaultSession('');
                    }
                    setDeletingSessionStep2(null);
                    refreshSessions(true);
                  } catch (e) {
                    console.error(e);
                  } finally {
                    setIsDeleting(false);
                  }
                }}
                style={{
                  padding: '12px 16px',
                  borderRadius: '12px',
                  background: 'rgba(255, 255, 255, 0.05)',
                  border: '1px solid rgba(255, 255, 255, 0.15)',
                  color: '#e2e8f0',
                  fontSize: '0.85rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  transition: 'all 0.15s ease',
                  textAlign: 'left',
                }}
              >
                {isDeleting && <Loader2 size={16} className="animate-spin" />}
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  <span style={{ fontSize: '0.85rem', fontWeight: 600, color: '#e2e8f0' }}>
                    {t('nav.modal_delete_session_only')}
                  </span>
                  <span style={{ fontSize: '0.74rem', color: '#94a3b8', fontWeight: 400 }}>
                    {t('nav.modal_delete_session_only_sub')}
                  </span>
                </div>
              </button>

              <button
                type="button"
                disabled={isDeleting}
                onClick={async () => {
                  setIsDeleting(true);
                  try {
                    const targetName = deletingSessionStep2.name;
                    await invoke('delete_session_rust', { session: targetName });
                    deleteSessionLocalData(targetName, true);
                    if (defaultSession === targetName) {
                      localStorage.removeItem('autogram_default_session');
                      setDefaultSession('');
                    }
                    setDeletingSessionStep2(null);
                    refreshSessions(true);
                  } catch (e) {
                    console.error(e);
                  } finally {
                    setIsDeleting(false);
                  }
                }}
                style={{
                  padding: '12px 16px',
                  borderRadius: '12px',
                  background: 'linear-gradient(135deg, rgba(239, 68, 68, 0.25) 0%, rgba(185, 28, 28, 0.35) 100%)',
                  border: '1px solid rgba(248, 113, 113, 0.6)',
                  color: '#fca5a5',
                  fontSize: '0.85rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  boxShadow: '0 4px 14px rgba(239, 68, 68, 0.25)',
                  transition: 'all 0.15s ease',
                  textAlign: 'left',
                }}
              >
                {isDeleting && <Loader2 size={16} className="animate-spin" />}
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  <span style={{ fontSize: '0.85rem', fontWeight: 600, color: '#fca5a5' }}>
                    {t('nav.modal_delete_with_cache')}
                  </span>
                  <span style={{ fontSize: '0.74rem', color: '#f87171', fontWeight: 400, opacity: 0.9 }}>
                    {t('nav.modal_delete_with_cache_sub')}
                  </span>
                </div>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* FOOTER BAR */}
      <footer
        style={{
          padding: '16px 32px',
          borderTop: '1px solid rgba(255, 255, 255, 0.06)',
          background: 'rgba(6, 9, 17, 0.8)',
          fontSize: '0.78rem',
          color: '#64748b',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <span>{t('nav.launcher_footer_engine')}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {updateStatus === 'updateAvailable' ? (
            <a
              href={releaseUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px',
                padding: '4px 12px',
                borderRadius: '8px',
                background: 'linear-gradient(135deg, rgba(245, 158, 11, 0.18), rgba(217, 119, 6, 0.28))',
                border: '1px solid rgba(245, 158, 11, 0.55)',
                color: '#fef08a',
                fontWeight: 600,
                fontSize: '0.78rem',
                textDecoration: 'none',
                boxShadow: '0 0 14px rgba(245, 158, 11, 0.35)',
                transition: 'all 0.15s ease',
              }}
              title={t('nav.updater_available', { version: latestVersion })}
            >
              <span
                style={{
                  display: 'inline-block',
                  width: '7px',
                  height: '7px',
                  borderRadius: '50%',
                  backgroundColor: '#f59e0b',
                  boxShadow: '0 0 10px rgba(245, 158, 11, 0.95), 0 0 18px rgba(245, 158, 11, 0.6), 0 0 4px #f59e0b',
                }}
              />
              <span>{t('nav.updater_available', { version: latestVersion })}</span>
            </a>
          ) : updateStatus === 'checking' ? (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', color: '#94a3b8' }}>
              <Loader2 size={12} className="animate-spin" style={{ color: '#38bdf8' }} />
              {t('nav.updater_checking')}
            </span>
          ) : (
            <button
              type="button"
              onClick={() => void recheckUpdate()}
              style={{
                background: 'transparent',
                border: 'none',
                color: '#94a3b8',
                fontSize: '0.78rem',
                fontWeight: 500,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px',
                padding: 0,
              }}
              title={t('nav.updater_up_to_date')}
            >
              <span
                style={{
                  display: 'inline-block',
                  width: '7px',
                  height: '7px',
                  borderRadius: '50%',
                  backgroundColor: '#10b981',
                  boxShadow: '0 0 10px rgba(16, 185, 129, 0.95), 0 0 18px rgba(16, 185, 129, 0.6), 0 0 4px #10b981',
                }}
              />
              <span>{t('nav.updater_up_to_date')}</span>
            </button>
          )}
        </div>
      </footer>
    </div>
  );
}
