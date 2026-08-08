import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
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
} from 'lucide-react';
import {
  loadSelectableSessions,
  type SessionOption,
} from '../../lib/telegram';
import { getCachedAvatar, requestAvatar } from '../../lib/media/avatarBatcher';

import { bootstrapSecureCredentials, useApiCredentialsStatus } from '../../lib/tauri/secureCredentials';
import { useGitHubUpdater } from '../../lib/tauri/githubUpdater';
import { Loader2 } from 'lucide-react';

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

  useEffect(() => {
    let active = true;
    loadSelectableSessions({ verify: true })
      .then((res: SessionOption[]) => {
        if (active && Array.isArray(res)) {
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
                    if (active && url) {
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

    return () => {
      active = false;
    };
  }, [defaultSession]);

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

  const displaySessions = sessions.length > 0 ? sessions : [
    {
      name: 'Lavender',
      label: 'Lavender (@lv_drr)',
      status: 'active',
      premium: true,
      datacenterId: 4,
    },
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
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span
                      style={{
                        width: '10px',
                        height: '10px',
                        borderRadius: '50%',
                        background: '#4ade80',
                        boxShadow: '0 0 10px #4ade80',
                      }}
                    />
                    <span style={{ fontSize: '0.78rem', color: '#4ade80', fontWeight: 600 }}>
                      {t('nav.connection_strong', { latency: 15 })}
                    </span>
                  </div>

                  <button
                    type="button"
                    onClick={(e) => handleSetDefault(sess.name, e)}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '4px',
                      padding: '3px 10px',
                      borderRadius: '12px',
                      background: isDefault ? 'rgba(56, 189, 248, 0.2)' : 'rgba(255, 255, 255, 0.05)',
                      border: isDefault ? '1px solid #38bdf8' : '1px solid rgba(255, 255, 255, 0.1)',
                      color: isDefault ? '#38bdf8' : '#64748b',
                      fontSize: '0.72rem',
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    <Star size={12} fill={isDefault ? '#38bdf8' : 'none'} />
                    {isDefault ? t('nav.default_badge') : t('nav.set_as_default')}
                  </button>
                </div>

                {/* ACCOUNT PROFILE HEADER */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                  <div
                    onClick={() => {
                      if (showAvatar && avatarUrl) {
                        setPreviewPhoto({
                          url: avatarUrl,
                          title: displayName,
                          subtitle: t('nav.session_id_value', { session: sess.name }),
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
                      {t('nav.session_id_value', { session: sess.name })} {(sess as any).datacenterId ? `· DC${(sess as any).datacenterId}` : ''}
                    </span>
                  </div>
                </div>

                <hr style={{ border: 0, borderTop: '1px solid rgba(255,255,255,0.06)', margin: 0 }} />

                {/* MODE ACTION BUTTONS */}
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
