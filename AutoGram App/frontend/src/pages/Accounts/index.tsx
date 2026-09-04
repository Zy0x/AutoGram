import { useState, useEffect, useRef } from 'react';
import { Users, Phone, Key, Plus, RefreshCcw, Lock, Trash2, ArrowLeft, QrCode, Smartphone, Pencil, X, Eye, EyeOff, KeyRound, HelpCircle, Send, ShieldAlert, Sparkles } from 'lucide-react';
import 'react-phone-number-input/style.css';
import PhoneInput, { getCountryCallingCode } from 'react-phone-number-input';
import { useTranslation } from 'react-i18next';
import { createPortal } from 'react-dom';
import QRCode from 'qrcode';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getApiCredentials } from '../../lib/tauri/secureCredentials';
import { tgAuthStatus, tgListSessions, tgLogin, saveSessionMetadata, notifySessionMetadataChanged } from '../../lib/telegram';
import { invalidateSessionListCache } from '../../lib/telegram';
import { getCachedAvatar, requestAvatar } from '../../lib/media/avatarBatcher';
import { getSessionMetadata } from '../../lib/telegram/core/sessionPicker';
import { ConfirmModal } from '../../components/common/ConfirmModal';
import { useMouseBackNavigation } from '../../lib/platform/mouseBackGesture';

export interface AccountsProps {
  isModal?: boolean;
  onClose?: () => void;
  onAccountAdded?: () => void;
}

const safeGetCallingCode = (val: string) => {
  if (!val) return '';
  try {
    return getCountryCallingCode(val as any);
  } catch (e) {
    return '';
  }
};

const CustomCountrySelect = ({ value, onChange, options, iconComponent: Icon }: any) => {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const ref = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen && ref.current) {
      const rect = ref.current.getBoundingClientRect();
      setPos({ top: rect.bottom + 8, left: rect.left });
    }
  }, [isOpen]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        ref.current && !ref.current.contains(target) &&
        (!dropdownRef.current || !dropdownRef.current.contains(target))
      ) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div 
      ref={ref} 
      className="PhoneInputCountry"
      style={{ cursor: 'pointer', height: '100%' }}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setIsOpen(!isOpen);
      }}
    >
      {Icon && <Icon country={value} label={t('ui.generated.country_d523ebb')} />}
      <div className="PhoneInputCountrySelectArrow" style={{ marginLeft: '4px', borderStyle: 'solid', borderWidth: '4px 4px 0 4px', borderColor: 'var(--text-muted) transparent transparent transparent' }} />
      
      {isOpen && createPortal(
        <div 
          ref={dropdownRef}
          style={{ 
          position: 'fixed', top: pos.top, left: pos.left, width: '280px', 
          maxHeight: '250px', overflowY: 'auto',
          background: 'var(--bg-secondary, #1a1b23)', border: '1px solid var(--border)',
          borderRadius: '8px',
          boxShadow: '0 10px 40px rgba(0,0,0,0.8)', zIndex: 9999,
          display: 'flex', flexDirection: 'column'
        }}
        onClick={(e) => e.stopPropagation()}
        >
           <div style={{ padding: '8px', borderBottom: '1px solid var(--border)', position: 'sticky', top: 0, background: 'var(--bg-secondary, #1a1b23)', zIndex: 2 }}>
             <input 
               autoFocus
               type="text" 
               placeholder={t('accounts.search_country_ph')}
               value={search}
               onChange={e => setSearch(e.target.value)}
               style={{ width: '100%', padding: '8px 12px', background: 'rgba(0,0,0,0.2)', border: '1px solid var(--border)', borderRadius: '4px', color: '#fff', outline: 'none' }}
             />
           </div>
           {options.filter((o: any) => o.label && o.label.toLowerCase().includes(search.toLowerCase())).map((o: any) => (
             <div 
               key={o.value || 'zz'}
               onClick={(e) => {
                 e.preventDefault();
                 e.stopPropagation();
                 onChange(o.value);
                 setIsOpen(false);
                 setSearch('');
               }}
               style={{ padding: '10px 12px', display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', fontSize: '0.9rem', borderBottom: '1px solid rgba(255,255,255,0.05)' }}
               onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}
               onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
             >
               {Icon && <Icon country={o.value} label={o.label} />}
               <span style={{ color: 'var(--text-main)', flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{o.label}</span>
               {o.value && <span style={{ color: 'var(--text-muted)' }}>+{safeGetCallingCode(o.value)}</span>}
             </div>
           ))}
        </div>,
        document.body
      )}
    </div>
  )
}

export function Accounts({ isModal = false, onClose, onAccountAdded }: AccountsProps = {}) {
  const { t } = useTranslation();
  const [sessions, setSessions] = useState<{
    name: string;
    status?: string;
    userFullName?: string;
    username?: string;
    photoBase64?: string;
    latencyMs?: number;
    isPremium?: boolean;
  }[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  // Track sessions where photoBase64 failed to render (show initials instead)
  const [avatarErrors, setAvatarErrors] = useState<Set<string>>(new Set());
  
  // Active Sessions State — multi-account for Media Studio / Jobs pickers.
  // First entry is the default boot target; others remain switchable.
  const [activeSessions, setActiveSessions] = useState<string[]>(() => {
    try {
      const stored = JSON.parse(localStorage.getItem('ACTIVE_SESSIONS') || '[]');
      return Array.isArray(stored) ? stored.map(String).filter(Boolean).slice(0, 12) : [];
    } catch { return []; }
  });

  useEffect(() => {
    localStorage.setItem('ACTIVE_SESSIONS', JSON.stringify(activeSessions));
  }, [activeSessions]);

  const toggleSession = (name: string) => {
    setActiveSessions((prev) => {
      if (prev.includes(name)) {
        // Keep at least zero or remaining; allow deselect
        return prev.filter((n) => n !== name);
      }
      // Newest activation becomes default (first) for Media Studio boot
      return [name, ...prev.filter((n) => n !== name)].slice(0, 12);
    });
  };

  // Custom Session Aliases state (Post-login rename)
  const [renameTarget, setRenameTarget] = useState<{ name: string; currentAlias: string } | null>(null);
  const [aliasInput, setAliasInput] = useState('');
  const [sessionAliases, setSessionAliases] = useState<Record<string, string>>(() => {
    try {
      return JSON.parse(localStorage.getItem('CUSTOM_SESSION_ALIASES') || '{}');
    } catch {
      return {};
    }
  });

  const handleSaveAlias = () => {
    if (!renameTarget) return;
    const updated = { ...sessionAliases };
    const val = aliasInput.trim();
    if (val) {
      updated[renameTarget.name] = val;
    } else {
      delete updated[renameTarget.name];
    }
    setSessionAliases(updated);
    localStorage.setItem('CUSTOM_SESSION_ALIASES', JSON.stringify(updated));
    invalidateSessionListCache();
    notifySessionMetadataChanged();
    setRenameTarget(null);
  };

  // Wizard State
  const [isWizardOpen, setIsWizardOpen] = useState(false);
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [sessionName, setSessionName] = useState("");
  const [phone, setPhone] = useState<string | undefined>("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [passwordHint, setPasswordHint] = useState("");
  const [authNotice, setAuthNotice] = useState("");
  
  // QR & Method Login State
  const [loginMethod, setLoginMethod] = useState<'qr' | 'phone' | 'string_session'>('qr');
  const [stringSessionInput, setStringSessionInput] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isForgotPasswordOpen, setIsForgotPasswordOpen] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const resendTimerRef = useRef<any>(null);

  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [qrExpiresIn, setQrExpiresIn] = useState<number>(0);
  const unlistenQrRef = useRef<(() => void) | null>(null);
  const qrCountdownTimerRef = useRef<any>(null);
  const pendingQrSessionRef = useRef<{
    sessionName: string;
    qrDataUrl: string;
    expiresAt: number;
  } | null>(null);
  const lastQrRequestTimeRef = useRef<number>(0);

  const stopQrTimers = async (forceCancel = false) => {
    if (unlistenQrRef.current) {
      unlistenQrRef.current();
      unlistenQrRef.current = null;
    }
    if (qrCountdownTimerRef.current) {
      clearInterval(qrCountdownTimerRef.current);
      qrCountdownTimerRef.current = null;
    }
    if (forceCancel) {
      if (sessionName) {
        try {
          await invoke('cancel_rust_qr_login', { session: sessionName });
        } catch {}
      }
      pendingQrSessionRef.current = null;
    }
  };

  useEffect(() => {
    return () => {
      stopQrTimers();
      if (resendTimerRef.current) clearInterval(resendTimerRef.current);
    };
  }, []);

  const [isProcessing, setIsProcessing] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    if (isWizardOpen && step === 1 && loginMethod === 'qr') {
      const nowSec = Math.floor(Date.now() / 1000);
      const cached = pendingQrSessionRef.current;

      // REUSE active pending QR session if still valid (prevents Telegram MTProto FLOOD_WAIT on rapid open/close)
      if (cached && cached.expiresAt > nowSec + 5 && cached.qrDataUrl) {
        setSessionName(cached.sessionName);
        setQrDataUrl(cached.qrDataUrl);
        const rem = cached.expiresAt - nowSec;
        setQrExpiresIn(rem);
        setIsProcessing(false);

        if (qrCountdownTimerRef.current) clearInterval(qrCountdownTimerRef.current);
        qrCountdownTimerRef.current = setInterval(() => {
          const remaining = cached.expiresAt - Math.floor(Date.now() / 1000);
          if (remaining <= 0) {
            setQrExpiresIn(0);
            if (qrCountdownTimerRef.current) clearInterval(qrCountdownTimerRef.current);
          } else {
            setQrExpiresIn(remaining);
          }
        }, 1000);
        return;
      }

      if (!qrDataUrl && !isProcessing && !errorMsg) {
        handleStartQrLogin();
      }
    }
  }, [isWizardOpen, step, loginMethod]);

  useEffect(() => {
    if (isWizardOpen && step === 2) {
      setResendCooldown(60);
      if (resendTimerRef.current) clearInterval(resendTimerRef.current);
      resendTimerRef.current = setInterval(() => {
        setResendCooldown((prev) => {
          if (prev <= 1) {
            clearInterval(resendTimerRef.current);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }
    return () => {
      if (resendTimerRef.current) clearInterval(resendTimerRef.current);
    };
  }, [isWizardOpen, step]);

  const loadSessions = async () => {
    setIsLoading(true);
    setErrorMsg('');
    setAvatarErrors(new Set());
    try {
      // Purge legacy corrupted photoBase64 fields from local storage session metadata
      try {
        const rawMeta = localStorage.getItem('AUTOGRAM_SESSION_METADATA');
        if (rawMeta) {
          const store = JSON.parse(rawMeta);
          let changed = false;
          for (const k of Object.keys(store)) {
            if (store[k]?.photoBase64) {
              delete store[k].photoBase64;
              changed = true;
            }
          }
          if (changed) localStorage.setItem('AUTOGRAM_SESSION_METADATA', JSON.stringify(store));
        }
      } catch {}

      // Ensure API credentials recovered (secure store / worker .env) before list
      const { bootstrapSecureCredentials } = await import('../../lib/tauri/secureCredentials');
      const { apiId, apiHash } = await bootstrapSecureCredentials();

      const list = await tgListSessions();
      setSessions(
        list.map((s) => {
          const meta = getSessionMetadata(s.name);
          const cachedUrl = getCachedAvatar(0, s.name);
          return {
            name: s.name,
            status: s.status,
            userFullName: meta?.userFullName,
            username: meta?.username,
            photoBase64: cachedUrl || undefined,
            isPremium: Boolean(meta?.isPremium),
          };
        })
      );
      setIsLoading(false);
      const validNames = list.map((s: any) => s.name);
      // Keep multi-active targets (Media Studio / Jobs switch). Never clamp to 1.
      setActiveSessions((prev) => {
        const kept = prev.filter((p) => validNames.includes(p)).slice(0, 12);
        return kept;
      });

      if (!apiId || !apiHash) {
        setErrorMsg(
          t('accounts.error_api_required') ||
            t('ui.generated.api_id_hash_belum_terisi_buka_settings_untuk_men_d015fa3')
        );
        return;
      }

      await Promise.all(
        list.map(async (saved) => {
          const started = performance.now();
          const result = await tgAuthStatus({
            session: saved.name,
            apiId: Number(apiId),
            apiHash,
          });
          const latencyMs = Math.max(0, Math.round(performance.now() - started));
          const connected = !!result?.ok && !!result.data?.authorized;
          const user = result?.data?.user;
          const userFullName = user?.firstName || undefined;
          const username = user?.username ? `@${user.username}` : undefined;
          const isPremium = Boolean(user?.isPremium);

          // REAL-SYNC PHOTO DIRECTLY FROM RUST TELEGRAM BACKEND FOR THIS EXACT SESSION
          let realPhoto = user?.photoBase64 || getCachedAvatar(0, saved.name) || undefined;

          if (connected) {
            // Fetch via requestAvatar (same engine used by Media Drives sidebar)
            if (!realPhoto) {
              try {
                const downloaded = await requestAvatar(
                  { session: saved.name, apiId: String(apiId), apiHash },
                  0
                );
                if (downloaded) {
                  realPhoto = downloaded;
                }
              } catch (err) {
                console.warn(`[Accounts] requestAvatar error for ${saved.name}:`, err);
              }
            }
          }

          console.log(`[Accounts] Session '${saved.name}': connected=${connected}, photoBase64 length=${realPhoto ? realPhoto.length : 0}`);

          if (realPhoto) {
            setAvatarErrors((prev) => {
              const next = new Set(prev);
              next.delete(saved.name);
              return next;
            });
          }

          if (connected || user) {
            saveSessionMetadata(saved.name, {
              userFullName,
              username: user?.username || undefined,
              isPremium,
            });
          }

          setSessions((current) =>
            current.map((row) =>
              row.name === saved.name
                ? {
                    ...row,
                    status: connected ? 'connected' : result?.error ? 'error' : 'expired',
                    userFullName,
                    username,
                    photoBase64: realPhoto,
                    latencyMs,
                    isPremium,
                  }
                : row
            )
          );
        })
      );
    } catch (e) {
      const msg = String((e as Error)?.message || e);
      if (/requires desktop|requires tauri/i.test(msg)) {
        setErrorMsg(
          t('ui.generated.daftar_session_butuh_aplikasi_desktop_autogram_b_f2e6f20')
        );
      } else {
        console.error(e);
        setErrorMsg(msg);
      }
      // Do not clear existing sessions on transient failure
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadSessions();
    if (isModal) {
      openWizard();
    }
  }, [isModal]);

  const closeWizard = async () => {
    if (isProcessing) return;
    const nowSec = Math.floor(Date.now() / 1000);
    const cached = pendingQrSessionRef.current;

    // Only cancel and delete session if QR has expired or is invalid
    if (!cached || cached.expiresAt <= nowSec) {
      await stopQrTimers(true);
      if (sessionName) {
        const current = sessions.find((s) => s.name === sessionName);
        if (!current || current.status !== 'connected') {
          try {
            await invoke('delete_session_rust', { session: sessionName });
          } catch {}
        }
      }
    }
    setIsWizardOpen(false);
    loadSessions();
    if (isModal) {
      onClose?.();
    }
  };

  // Mouse Back Button (Button 3) & Trackpad Swipe Navigation for Accounts
  useMouseBackNavigation(
    {
      onBack: () => {
        if (isForgotPasswordOpen) {
          setIsForgotPasswordOpen(false);
          return true;
        }
        if (isWizardOpen) {
          if (step > 1) {
            setStep(step === 3 ? 2 : 1);
            return true;
          }
          void closeWizard();
          return true;
        }
        if (isModal && onClose) {
          onClose();
          return true;
        }
        return false;
      },
    },
    [isForgotPasswordOpen, isWizardOpen, step, isModal, onClose]
  );

  const openWizard = () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const cached = pendingQrSessionRef.current;
    
    setStep(1);
    setLoginMethod("qr");

    if (cached && cached.expiresAt > nowSec + 5) {
      setSessionName(cached.sessionName);
      setQrDataUrl(cached.qrDataUrl);
      setQrExpiresIn(cached.expiresAt - nowSec);
    } else {
      stopQrTimers(true);
      setQrDataUrl(null);
      setQrExpiresIn(0);
      setSessionName("");
    }

    setPhone("");
    setCode("");
    setPassword("");
    setPasswordHint("");
    setStringSessionInput("");
    setShowPassword(false);
    setIsForgotPasswordOpen(false);
    setErrorMsg("");
    setAuthNotice("");
    setIsWizardOpen(true);
  };

  const finishAuthorization = async (name: string) => {
    const { apiId, apiHash } = await getApiCredentials();
    let verified = false;
    let userLabel = '';
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const status = await tgAuthStatus({
        session: name,
        apiId: Number(apiId),
        apiHash,
      });
      if (status?.ok && status.data?.authorized) {
        verified = true;
        const user = status.data.user;
        userLabel = user?.username
          ? `${user.firstName ? `${user.firstName} ` : ''}(@${user.username})`
          : user?.firstName || '';
        break;
      }
      await new Promise((resolve) => window.setTimeout(resolve, 350 + attempt * 150));
    }
    if (!verified) {
      setErrorMsg(t('accounts.unverified_connection'));
      setIsProcessing(false);
      return false;
    }
    await stopQrTimers();
    invalidateSessionListCache();
    notifySessionMetadataChanged();
    // New login becomes default (first) but keep other active accounts for Studio/Jobs switch
    setActiveSessions((prev) => [name, ...prev.filter((n) => n !== name)].slice(0, 12));
    setAuthNotice(`Terkoneksi dan terverifikasi${userLabel ? ` sebagai ${userLabel}` : ''}.`);
    setIsWizardOpen(false);
    setIsProcessing(false);
    await loadSessions();
    if (isModal) {
      onAccountAdded?.();
      onClose?.();
    }
    return true;
  };

  const handleStartQrLogin = async (forceNew = false) => {
    const now = Date.now();
    // Cooldown protection: minimum 3 seconds between fresh request triggers
    if (!forceNew && now - lastQrRequestTimeRef.current < 3000) {
      return;
    }
    lastQrRequestTimeRef.current = now;

    let activeSessionName = sessionName.trim();
    if (!activeSessionName || forceNew) {
      activeSessionName = `session_${Math.floor(Date.now() / 1000)}`;
      setSessionName(activeSessionName);
    }

    if (!(await checkApiCredentials())) return;

    await stopQrTimers(true);
    setIsProcessing(true);
    setErrorMsg('');
    setQrDataUrl(null);

    try {
      const { apiId, apiHash } = await getApiCredentials();

      if (isTauri()) {
        const unlisten = await listen<any>('qr-event', async (event) => {
          const payload = event.payload || {};
          if (payload.session && payload.session !== activeSessionName) return;

          if (payload.status === 'already_authorized') {
            pendingQrSessionRef.current = null;
            await finishAuthorization(activeSessionName);
          } else if (payload.status === 'qr_code' && payload.url) {
            const dataUrl = await QRCode.toDataURL(payload.url, { margin: 2, width: 240 });
            setQrDataUrl(dataUrl);

            const exp = Number(payload.expires) || 0;
            const nowSec = Math.floor(Date.now() / 1000);
            const rem = Math.max(0, exp - nowSec) || 60;
            setQrExpiresIn(rem);
            setIsProcessing(false);

            // Cache active QR session so rapid open/close doesn't spam Telegram MTProto API
            pendingQrSessionRef.current = {
              sessionName: activeSessionName,
              qrDataUrl: dataUrl,
              expiresAt: exp > 0 ? exp : nowSec + rem,
            };

            if (qrCountdownTimerRef.current) clearInterval(qrCountdownTimerRef.current);
            qrCountdownTimerRef.current = setInterval(() => {
              setQrExpiresIn((prev) => {
                const next = Math.max(0, prev - 1);
                if (next === 0 && qrCountdownTimerRef.current) {
                  clearInterval(qrCountdownTimerRef.current);
                }
                return next;
              });
            }, 1000);
          } else if (payload.status === 'success') {
            pendingQrSessionRef.current = null;
            await finishAuthorization(activeSessionName);
          } else if (payload.status === '2fa_required') {
            await stopQrTimers();
            setPasswordHint(String(payload.password_hint || ''));
            setStep(3);
            setIsProcessing(false);
          } else if (payload.status === 'error') {
            await stopQrTimers(true);
            const rawErr = String(payload.error || 'Gagal login via QR code');
            const floodMatch = rawErr.match(/FLOOD_WAIT_?(\d+)/i) || rawErr.match(/wait (?:for )?(\d+) sec/i);
            if (floodMatch) {
              const waitSec = floodMatch[1];
              setErrorMsg(t('accounts.flood_wait_notice', { seconds: waitSec }));
            } else {
              setErrorMsg(rawErr);
            }
            setIsProcessing(false);
          }
        });

        unlistenQrRef.current = unlisten;

        await invoke('start_rust_qr_login', {
          session: activeSessionName,
          apiId: Number(apiId),
          apiHash: apiHash || '',
        });
      } else {
        throw new Error('Login Telegram hanya tersedia di aplikasi desktop AutoGram.');
      }
    } catch (e: any) {
      const rawErr = String(e?.message || e);
      const floodMatch = rawErr.match(/FLOOD_WAIT_?(\d+)/i) || rawErr.match(/wait (?:for )?(\d+) sec/i);
      if (floodMatch) {
        const waitSec = floodMatch[1];
        setErrorMsg(t('accounts.flood_wait_notice', { seconds: waitSec }));
      } else {
        setErrorMsg(rawErr);
      }
      setIsProcessing(false);
    }
  };

  const [deleteTargetSession, setDeleteTargetSession] = useState<string | null>(null);

  const handleDeleteSession = (name: string) => {
    setDeleteTargetSession(name);
  };

  const executeDeleteSession = async () => {
    const name = deleteTargetSession;
    if (!name) return;
    setDeleteTargetSession(null);

    setIsLoading(true);
    setSessions((prev) => prev.filter((s) => s.name !== name));
    setActiveSessions((prev) => prev.filter((p) => p !== name));

    try {
      if (isTauri()) {
        try {
          await invoke('delete_session_rust', { session: name });
        } catch {}
      }

      invalidateSessionListCache();
      await loadSessions();
    } catch (e) {
      console.error(e);
      await loadSessions();
    } finally {
      setIsLoading(false);
    }
  };

  const checkApiCredentials = async () => {
    const { apiId, apiHash } = await getApiCredentials();
    if (!apiId || !apiHash) {
      setErrorMsg(t('accounts.error_api_required'));
      return false;
    }
    return true;
  };

  const handleError = (data: any) => {
    const raw = String(data?.error || data?.message || data || '').trim();
    const rawLower = raw.toLowerCase();

    const floodMatch = raw.match(/FLOOD_WAIT_?(\d+)/i) || raw.match(/wait (?:for )?(\d+) sec/i);
    if (data.error === 'flood_wait' || floodMatch) {
      const sec = data.seconds || (floodMatch ? Number(floodMatch[1]) : 60);
      const minutes = Math.ceil(sec / 60);
      const waitTime = minutes > 60 ? `${Math.ceil(minutes / 60)} jam` : `${minutes} menit`;
      setErrorMsg(t('error.flood_wait', { time: waitTime }));
    } else if (rawLower.includes('code_expired') || rawLower.includes('phone_code_expired')) {
      setErrorMsg(t('error.code_expired'));
      setStep(1);
    } else if (rawLower.includes('invalid_api_id') || rawLower.includes('api_id_invalid')) {
      setErrorMsg(t('error.invalid_api_id'));
    } else if (rawLower.includes('phone_banned') || rawLower.includes('phone_number_banned')) {
      setErrorMsg(t('error.phone_banned'));
    } else if (rawLower.includes('password_flood') || rawLower.includes('phone_password_flood')) {
      setErrorMsg(t('error.password_flood'));
    } else if (rawLower.includes('auth_key_unregistered')) {
      setErrorMsg(t('error.auth_key_unregistered'));
    } else if (rawLower.includes('signup_required') || rawLower.includes('sign_up_required')) {
      setErrorMsg(t('error.signup_required'));
    } else if (rawLower.includes('phone_number_unoccupied')) {
      setErrorMsg(t('error.phone_number_unoccupied'));
    } else if (rawLower.includes('phone_number_invalid')) {
      setErrorMsg(t('error.phone_number_invalid'));
    } else if (rawLower.includes('session_password_needed')) {
      setErrorMsg(t('error.session_password_needed'));
      setStep(3);
    } else if (rawLower.includes('timeout')) {
      setErrorMsg(t('error.timeout'));
    } else if (rawLower.includes('db_locked')) {
      setErrorMsg(t('error.db_locked'));
    } else if (rawLower.includes('invalid_otp') || rawLower.includes('phone_code_invalid')) {
      setErrorMsg(t('error.invalid_otp'));
    } else if (rawLower.includes('invalid_password') || rawLower.includes('password_hash_invalid')) {
      setErrorMsg(t('error.invalid_password'));
    } else {
      setErrorMsg(raw || t('accounts.status_error'));
    }
  };

  const handleImportStringSession = async () => {
    if (!stringSessionInput.trim()) {
      setErrorMsg(t('accounts.error_fields_required'));
      return;
    }
    if (!(await checkApiCredentials())) return;

    setIsProcessing(true);
    setErrorMsg('');
    try {
      const val = stringSessionInput.trim();
      let targetSession = sessionName.trim();
      if (!targetSession) {
        targetSession = `session_${Math.floor(Date.now() / 1000)}`;
        setSessionName(targetSession);
      }

      // Check if it's a Bot Token
      if (/^\d+:[A-Za-z0-9_-]{35,}$/.test(val)) {
        const { apiId, apiHash } = await getApiCredentials();
        const result = await invoke<any>('tg_login_bot', {
          request: {
            session: targetSession,
            apiId: Number(apiId),
            apiHash,
            botToken: val,
          },
        }).catch(() => null);

        if (result?.ok) {
          await finishAuthorization(targetSession);
          return;
        }
      }

      // Standard Telethon/Grammers Session Import
      const result = await invoke<any>('tg_import_telethon_session', { session: val }).catch((e) => ({ ok: false, error: String(e) }));
      if (result?.ok) {
        await finishAuthorization(targetSession);
      } else {
        setErrorMsg(result?.userMessage || result?.error || t('error.string_session_invalid'));
      }
    } catch (e: any) {
      setErrorMsg(String(e?.message || e));
    } finally {
      setIsProcessing(false);
    }
  };

  const handleSendCode = async () => {
    if (!phone) {
      setErrorMsg(t('accounts.error_fields_required'));
      return;
    }

    let targetSession = sessionName.trim();
    if (!targetSession) {
      const cleanPhone = phone.replace(/\D/g, '');
      targetSession = cleanPhone ? `tg_${cleanPhone}` : `session_${Math.floor(Date.now() / 1000)}`;
      setSessionName(targetSession);
    }

    if (!(await checkApiCredentials())) return;

    const finalPhone = phone;
    setIsProcessing(true);
    setErrorMsg('');
    try {
      const { apiId, apiHash } = await getApiCredentials();
      const result = await tgLogin({
        session: sessionName,
        phone: finalPhone || '',
        apiId: Number(apiId),
        apiHash,
      });
      const data = result?.data;

      if (!result?.ok || !data) {
        handleError({ error: result?.userMessage || result?.error?.message || result?.error?.code || 'Gagal mengirim kode login.' });
      } else if (data.status === 'already_authorized' || data.status === 'authorized') {
        await finishAuthorization(sessionName);
      } else if (data.status === 'code_sent') {
        setPhone(finalPhone);
        setStep(2);
      }
    } catch (e: any) {
      setErrorMsg(String(e));
    } finally {
      setIsProcessing(false);
    }
  };

  const handleSignIn = async () => {
    if (!code) return;

    setIsProcessing(true);
    setErrorMsg('');

    try {
      const { apiId, apiHash } = await getApiCredentials();
      const result = await tgLogin({
        session: sessionName,
        phone: phone || '',
        code,
        apiId: Number(apiId),
        apiHash,
      });
      const data = result?.data;

      if (!result?.ok || !data) {
        handleError({ error: result?.userMessage || result?.error?.message || result?.error?.code || 'Kode login ditolak.' });
      } else if (data.status === 'password_required' || data.needsPassword) {
        setPasswordHint(data.passwordHint || '');
        setStep(3);
      } else if (data.status === 'authorized') {
        await finishAuthorization(sessionName);
      }
    } catch (e) {
      setErrorMsg(String(e));
    } finally {
      setIsProcessing(false);
    }
  };

  const handleSignIn2FA = async () => {
    if (!password) return;

    setIsProcessing(true);
    setErrorMsg('');

    try {
      const { apiId, apiHash } = await getApiCredentials();
      const result = await tgLogin({
        session: sessionName,
        password,
        apiId: Number(apiId),
        apiHash,
      });
      const data = result?.data;

      if (!result?.ok || !data) {
        handleError({ error: result?.userMessage || result?.error?.message || result?.error?.code || 'Password 2FA ditolak.' });
      } else if (data.status === 'authorized') {
        await finishAuthorization(sessionName);
      }
    } catch (e) {
      setErrorMsg(String(e));
    } finally {
      setIsProcessing(false);
    }
  };

  if (isModal) {
    return isWizardOpen ? (
      <div className="modal-overlay" onClick={closeWizard}>
        <div className="modal-content" onClick={(e) => e.stopPropagation()}>
          <div className="modal-header" style={{ display: 'flex', alignItems: 'center', gap: '12px', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              {step > 1 && (
                <button 
                  onClick={() => setStep(step === 3 ? 2 : 1)} 
                  disabled={isProcessing}
                  style={{ 
                    background: 'transparent', 
                    border: 'none', 
                    color: 'var(--text-muted)', 
                    cursor: 'pointer', 
                    padding: '4px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderRadius: '6px',
                    transition: 'all 0.2s',
                  }}
                  onMouseOver={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}
                  onMouseOut={(e) => e.currentTarget.style.background = 'transparent'}
                  title={t('accounts.go_back')}
                >
                  <ArrowLeft size={20} />
                </button>
              )}
              <h3 style={{ margin: 0, fontSize: '1.1rem' }}>
                {step === 1
                  ? t('accounts.step_connect')
                  : step === 2
                    ? t('accounts.step_verify')
                    : t('accounts.step_2fa')}
              </h3>
            </div>
            <button
              type="button"
              onClick={closeWizard}
              disabled={isProcessing}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--text-muted, #94a3b8)',
                cursor: 'pointer',
                padding: '4px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: '6px',
                transition: 'all 0.2s',
              }}
              title={t('nav.modal_cancel', { defaultValue: 'Batal' })}
            >
              <X size={18} />
            </button>
          </div>
                    <div className="modal-body" style={{ padding: '16px 20px' }}>
            {errorMsg && (
              <div style={{ background: 'rgba(239, 68, 68, 0.1)', color: '#ef4444', padding: '10px 14px', borderRadius: '8px', marginBottom: '14px', fontSize: '0.85rem' }}>
                {errorMsg}
              </div>
            )}
            
            {step === 1 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {/* Method Tabs */}
                <div style={{ display: 'flex', gap: '6px', background: 'rgba(255, 255, 255, 0.04)', padding: '4px', borderRadius: '12px', border: '1px solid rgba(255, 255, 255, 0.08)' }}>
                  <button
                    type="button"
                    onClick={() => { setLoginMethod('qr'); }}
                    style={{
                      flex: 1,
                      padding: '8px 10px',
                      borderRadius: '8px',
                      border: 'none',
                      background: loginMethod === 'qr' ? 'linear-gradient(135deg, #0284c7 0%, #0369a1 100%)' : 'transparent',
                      color: loginMethod === 'qr' ? '#ffffff' : '#94a3b8',
                      fontWeight: '600',
                      fontSize: '0.8rem',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '6px',
                      boxShadow: loginMethod === 'qr' ? '0 4px 14px rgba(2, 132, 199, 0.35)' : 'none',
                      transition: 'all 0.2s ease',
                    }}
                  >
                    <QrCode size={14} /> {t('accounts.tab_qr')}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setLoginMethod('phone'); }}
                    style={{
                      flex: 1,
                      padding: '8px 10px',
                      borderRadius: '8px',
                      border: 'none',
                      background: loginMethod === 'phone' ? 'linear-gradient(135deg, #0284c7 0%, #0369a1 100%)' : 'transparent',
                      color: loginMethod === 'phone' ? '#ffffff' : '#94a3b8',
                      fontWeight: '600',
                      fontSize: '0.8rem',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '6px',
                      boxShadow: loginMethod === 'phone' ? '0 4px 14px rgba(2, 132, 199, 0.35)' : 'none',
                      transition: 'all 0.2s ease',
                    }}
                  >
                    <Phone size={14} /> {t('accounts.tab_phone')}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setLoginMethod('string_session'); }}
                    style={{
                      flex: 1,
                      padding: '8px 10px',
                      borderRadius: '8px',
                      border: 'none',
                      background: loginMethod === 'string_session' ? 'linear-gradient(135deg, #0284c7 0%, #0369a1 100%)' : 'transparent',
                      color: loginMethod === 'string_session' ? '#ffffff' : '#94a3b8',
                      fontWeight: '600',
                      fontSize: '0.8rem',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '6px',
                      boxShadow: loginMethod === 'string_session' ? '0 4px 14px rgba(2, 132, 199, 0.35)' : 'none',
                      transition: 'all 0.2s ease',
                    }}
                  >
                    <KeyRound size={14} /> {t('accounts.tab_string_session')}
                  </button>
                </div>

                {loginMethod === 'qr' ? (
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px', marginTop: '2px', width: '100%' }}>
                    {!qrDataUrl ? (
                      isProcessing ? (
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '24px 16px', gap: '10px', width: '100%' }}>
                          <RefreshCcw className="spin" size={28} color="var(--primary)" />
                          <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                            {t('accounts.qr_generating')}
                          </span>
                        </div>
                      ) : (
                        <button className="btn btn-primary" style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }} onClick={() => handleStartQrLogin(true)}>
                          <RefreshCcw size={16} /> {t('accounts.btn_reload_qr')}
                        </button>
                      )
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px', width: '100%' }}>
                        <div style={{ background: '#ffffff', padding: '10px', borderRadius: '14px', boxShadow: '0 10px 28px rgba(0,0,0,0.5), 0 0 16px rgba(56, 189, 248, 0.12)', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                          <img src={qrDataUrl} alt={t('ui.generated.telegram_login_qr_code_3f083b9')} style={{ width: '165px', height: '165px', display: 'block', borderRadius: '4px' }} />
                          {qrExpiresIn > 0 ? (
                            <span style={{ fontSize: '0.72rem', color: '#0284c7', fontWeight: 700, marginTop: '6px', padding: '2px 8px', borderRadius: '20px', background: 'rgba(2, 132, 199, 0.1)' }}>
                              {t('accounts.valid_for', { seconds: qrExpiresIn })}
                            </span>
                          ) : (
                            <span style={{ fontSize: '0.72rem', color: '#ef4444', fontWeight: 700, marginTop: '6px', padding: '2px 8px', borderRadius: '20px', background: 'rgba(239, 68, 68, 0.1)' }}>
                              {t('accounts.status_expired')}
                            </span>
                          )}
                        </div>

                        {qrExpiresIn === 0 && (
                          <button className="btn btn-primary" style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }} onClick={() => handleStartQrLogin(true)}>
                            <RefreshCcw size={16} /> {t('accounts.btn_reload_qr')}
                          </button>
                        )}

                        <div
                          style={{
                            width: '100%',
                            padding: '12px 14px',
                            borderRadius: '14px',
                            background: 'rgba(255, 255, 255, 0.025)',
                            border: '1px solid rgba(255, 255, 255, 0.08)',
                            boxSizing: 'border-box',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '8px',
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <Smartphone size={15} style={{ color: '#38bdf8' }} />
                            <span
                              style={{
                                fontSize: '0.72rem',
                                fontWeight: 700,
                                color: '#38bdf8',
                                letterSpacing: '0.05em',
                                textTransform: 'uppercase',
                              }}
                            >
                              {t('accounts.qr_instructions_title')}
                            </span>
                          </div>

                          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                            {[
                              t('accounts.qr_step_1'),
                              t('accounts.qr_step_2'),
                              t('accounts.qr_step_3'),
                              t('accounts.qr_step_4'),
                            ].map((stepText, index) => (
                              <div
                                key={index}
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: '10px',
                                  padding: '5px 10px',
                                  borderRadius: '8px',
                                  background: 'rgba(255, 255, 255, 0.02)',
                                  border: '1px solid rgba(255, 255, 255, 0.04)',
                                }}
                              >
                                <span
                                  style={{
                                    width: '20px',
                                    height: '20px',
                                    borderRadius: '50%',
                                    background: 'rgba(56, 189, 248, 0.15)',
                                    border: '1px solid rgba(56, 189, 248, 0.3)',
                                    color: '#38bdf8',
                                    fontSize: '0.7rem',
                                    fontWeight: 700,
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    flexShrink: 0,
                                  }}
                                >
                                  {index + 1}
                                </span>
                                <span style={{ fontSize: '0.8rem', color: '#e2e8f0', lineHeight: 1.35, fontWeight: 500 }}>
                                  {stepText}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>

                        <div style={{ fontSize: '0.75rem', color: '#64748b', textAlign: 'center', lineHeight: 1.4, marginTop: '2px' }}>
                          {t('accounts.qr_auto_refresh_hint')}
                        </div>
                      </div>
                    )}
                  </div>
                ) : loginMethod === 'phone' ? (
                  <>
                    <div className="input-group" style={{ marginBottom: 0 }}>
                      <label className="input-label" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <Phone size={14} /> {t('accounts.phone_number')}
                      </label>
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <PhoneInput
                          id="phone-input"
                          countrySelectComponent={CustomCountrySelect}
                          placeholder={t('accounts.ph_phone_short')}
                          value={phone}
                          onChange={setPhone}
                          onKeyDown={(e: any) => { 
                            if (e.key === 'Enter') {
                              if (sessionName && phone && !isProcessing) handleSendCode();
                              else if (!sessionName) document.getElementById('session-name-input')?.focus();
                            }
                          }}
                          autoComplete="off"
                          international
                          withCountryCallingCode
                          className="input-field phone-input-container"
                          disabled={isProcessing}
                          style={{ width: '100%' }}
                        />
                      </div>
                    </div>
                    <button className="btn btn-primary" onClick={handleSendCode} disabled={isProcessing || !phone}>
                      {isProcessing ? <RefreshCcw className="spin" size={18} /> : t('accounts.send_code')}
                    </button>
                  </>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    <div className="input-group" style={{ marginBottom: 0 }}>
                      <label className="input-label" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <KeyRound size={14} /> {t('accounts.string_session_label')}
                      </label>
                      <textarea
                        className="input-field"
                        rows={3}
                        placeholder={t('accounts.string_session_ph')}
                        value={stringSessionInput}
                        onChange={(e) => setStringSessionInput(e.target.value)}
                        disabled={isProcessing}
                        style={{
                          width: '100%',
                          fontFamily: 'monospace',
                          fontSize: '0.8rem',
                          resize: 'vertical',
                          padding: '10px 12px',
                        }}
                      />
                    </div>

                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: '8px',
                        padding: '10px 12px',
                        borderRadius: '10px',
                        background: 'rgba(56, 189, 248, 0.06)',
                        border: '1px solid rgba(56, 189, 248, 0.15)',
                        fontSize: '0.78rem',
                        color: '#94a3b8',
                        lineHeight: 1.4,
                      }}
                    >
                      <Sparkles size={16} style={{ color: '#38bdf8', flexShrink: 0, marginTop: '2px' }} />
                      <span>{t('accounts.string_session_desc')}</span>
                    </div>

                    <button
                      className="btn btn-primary"
                      onClick={handleImportStringSession}
                      disabled={isProcessing || !stringSessionInput.trim()}
                      style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
                    >
                      {isProcessing ? <RefreshCcw className="spin" size={18} /> : (
                        <>
                          <KeyRound size={16} /> {t('accounts.btn_import_session')}
                        </>
                      )}
                    </button>
                  </div>
                )}
              </div>
            )}

            {step === 2 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    padding: '10px 14px',
                    borderRadius: '12px',
                    background: 'rgba(56, 189, 248, 0.08)',
                    border: '1px solid rgba(56, 189, 248, 0.2)',
                  }}
                >
                  <Send size={18} style={{ color: '#38bdf8', flexShrink: 0 }} />
                  <span style={{ fontSize: '0.82rem', color: '#e2e8f0', lineHeight: 1.4 }}>
                    {t('accounts.code_delivery_info')}
                  </span>
                </div>

                <div className="input-group" style={{ marginBottom: 0 }}>
                  <label className="input-label" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Key size={14} /> {t('accounts.otp_code')}
                  </label>
                  <input
                    type="text"
                    className="input-field"
                    placeholder={t('accounts.ph_code_example')}
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && code && !isProcessing) handleSignIn();
                    }}
                    disabled={isProcessing}
                    autoFocus
                    style={{ letterSpacing: '0.2em', textAlign: 'center', fontSize: '1.2rem', fontWeight: 700 }}
                  />
                </div>

                <button
                  className="btn btn-primary"
                  onClick={handleSignIn}
                  disabled={isProcessing || !code.trim()}
                  style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
                >
                  {isProcessing ? <RefreshCcw className="spin" size={18} /> : t('accounts.verify_code')}
                </button>

                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', paddingTop: '4px' }}>
                  {resendCooldown > 0 ? (
                    <span style={{ fontSize: '0.8rem', color: '#64748b' }}>
                      {t('accounts.resend_code_in', { seconds: resendCooldown })}
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={handleSendCode}
                      disabled={isProcessing}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: '#38bdf8',
                        fontSize: '0.82rem',
                        fontWeight: 600,
                        cursor: 'pointer',
                        padding: '4px 8px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        textDecoration: 'underline',
                      }}
                    >
                      <RefreshCcw size={13} /> {t('accounts.resend_code_now')}
                    </button>
                  )}
                </div>
              </div>
            )}

            {step === 3 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '0.88rem', lineHeight: 1.45 }}>
                  {t('accounts.2fa_desc')}
                </p>

                {passwordHint && (
                  <div
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '6px',
                      padding: '6px 12px',
                      borderRadius: '8px',
                      background: 'rgba(245, 158, 11, 0.12)',
                      border: '1px solid rgba(245, 158, 11, 0.25)',
                      color: '#fbbf24',
                      fontSize: '0.8rem',
                      fontWeight: 600,
                      width: 'fit-content',
                    }}
                  >
                    <Sparkles size={14} />
                    {t('accounts.password_hint_badge', { hint: passwordHint })}
                  </div>
                )}

                <div className="input-group" style={{ marginBottom: 0 }}>
                  <label className="input-label" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Lock size={14} /> {t('accounts.2fa_password')}
                  </label>
                  <div style={{ position: 'relative', width: '100%' }}>
                    <input
                      type={showPassword ? 'text' : 'password'}
                      className="input-field"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && password && !isProcessing) handleSignIn2FA();
                      }}
                      disabled={isProcessing}
                      autoFocus
                      style={{ width: '100%', paddingRight: '40px' }}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      style={{
                        position: 'absolute',
                        right: '10px',
                        top: '50%',
                        transform: 'translateY(-50%)',
                        background: 'none',
                        border: 'none',
                        color: 'var(--text-muted, #94a3b8)',
                        cursor: 'pointer',
                        padding: '4px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                      title={showPassword ? t('accounts.hide_password') : t('accounts.show_password')}
                    >
                      {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </div>

                <button
                  className="btn btn-primary"
                  onClick={handleSignIn2FA}
                  disabled={isProcessing || !password.trim()}
                  style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
                >
                  {isProcessing ? <RefreshCcw className="spin" size={18} /> : t('accounts.submit_password')}
                </button>

                <div style={{ display: 'flex', justifyContent: 'center', paddingTop: '2px' }}>
                  <button
                    type="button"
                    onClick={() => setIsForgotPasswordOpen(true)}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: '#94a3b8',
                      fontSize: '0.78rem',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '5px',
                      transition: 'color 0.2s',
                    }}
                    onMouseOver={(e) => (e.currentTarget.style.color = '#38bdf8')}
                    onMouseOut={(e) => (e.currentTarget.style.color = '#94a3b8')}
                  >
                    <HelpCircle size={14} /> {t('accounts.forgot_password_btn')}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    ) : null;
  }

  return (
    <main className="main-content page-stack">
      <header className="page-header">
        <h2 className="title">{t('accounts.title')}</h2>
        <p className="subtitle">{t('accounts.subtitle')}</p>
      </header>

      {authNotice && (
        <div className="alert alert-success" role="status">
          {authNotice}
        </div>
      )}

      <div className="grid-layout" style={{ gridTemplateColumns: '1fr' }}>
        <div className="glass-panel card">
          <div className="card-header card-header-spread">
            <div className="title-with-icon">
              <Users size={20} color="var(--primary)" aria-hidden />
              <h3 style={{ margin: 0 }}>{t('accounts.saved_sessions')}</h3>
            </div>
            <div className="page-header-actions">
                <button type="button" className="btn btn-primary" onClick={openWizard}>
                  <Plus size={16} /> {t('accounts.btn_add')}
                </button>
            </div>
          </div>
          
          <div className="card-body">
            {!isLoading && sessions.length > 0 && (
              <p style={{ color: 'var(--text-muted)', margin: '0 0 12px', fontSize: '0.85rem', lineHeight: 1.45 }}>
                {t('accounts.multi_account_hint')}
                {activeSessions.length > 0
                  ? ` · ${activeSessions.length} ${t('accounts.active_count_suffix')}`
                  : ` · ${t('accounts.no_active_targets')}`}
              </p>
            )}
            {isLoading ? (
              <div className="title-with-icon" style={{ color: 'var(--text-muted)' }}>
                <RefreshCcw size={16} className="spin" /> {t('accounts.loading_sessions')}
              </div>
            ) : sessions.length === 0 ? (
              <p style={{ color: 'var(--text-muted)', margin: 0 }}>{t('accounts.no_accounts')}</p>
            ) : (
              sessions.map((s, idx) => (
                <div key={idx} className="list-row">
                  <div className="list-row-main">
                    {(() => {
                        const showPhoto = !!s.photoBase64 && s.photoBase64.length > 0 && !avatarErrors.has(s.name);
                        const displayForAvatar = sessionAliases[s.name] || s.userFullName || s.name;
                        return (
                          <div style={{ position: 'relative', flexShrink: 0 }}>
                            <div
                              className="avatar-circle"
                              style={{
                                width: '44px',
                                height: '44px',
                                borderRadius: '50%',
                                overflow: 'hidden',
                                padding: 0,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                background: showPhoto ? 'transparent' : 'rgba(255, 174, 0, 0.15)',
                              }}
                            >
                              {showPhoto ? (
                                <img
                                  src={s.photoBase64}
                                  alt={displayForAvatar}
                                  style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%', display: 'block' }}
                                  onError={() => {
                                    console.error(`[Accounts] Avatar image failed to load for session ${s.name}:`, s.photoBase64?.slice(0, 60));
                                    setAvatarErrors(prev => new Set([...prev, s.name]));
                                  }}
                                />
                              ) : (
                                <Users size={20} color="var(--primary)" aria-hidden />
                              )}
                            </div>
                            {/* OFFICIAL TELEGRAM PREMIUM GRADIENT STAR BADGE */}
                            {s.isPremium && (
                              <div
                                style={{
                                  position: 'absolute',
                                  bottom: '-2px',
                                  right: '-2px',
                                  width: '18px',
                                  height: '18px',
                                  borderRadius: '50%',
                                  background: 'linear-gradient(135deg, #ec4899, #8b5cf6, #3b82f6)',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  boxShadow: '0 0 8px rgba(139, 92, 246, 0.6)',
                                  border: '2px solid var(--bg-primary, #0f172a)',
                                  zIndex: 2,
                                }}
                                title={t('ui.generated.akun_telegram_premium_terverifikasi_45d82a2')}
                              >
                                <svg width="10" height="10" viewBox="0 0 24 24" fill="#ffffff">
                                  <path d="M12 1.5l3.09 6.26L22 8.77l-5 4.87 1.18 6.88L12 17.27l-6.18 3.25L7 13.64l-5-4.87 6.91-1.01L12 1.5z"/>
                                </svg>
                              </div>
                            )}
                          </div>
                        );
                      })()}
                    <div style={{ minWidth: 0 }}>
                      {(() => {
                        const customAlias = sessionAliases[s.name];
                        const displayTitle = customAlias || s.userFullName || (s.name.startsWith('session_') ? `Sesi #${s.name.replace(/^session_/, '')}` : s.name);
                        return (
                          <h4 style={{ margin: 0, opacity: s.status === 'expired' ? 0.7 : 1, wordBreak: 'break-word', display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                            <span style={{ fontSize: '1rem', fontWeight: '600', color: 'var(--text-main)' }}>
                              {displayTitle}
                            </span>
                            {s.username && (
                              <span style={{ fontSize: '0.825rem', fontWeight: 'normal', color: 'var(--text-muted)' }}>
                                ({s.username.startsWith('@') ? s.username : `@${s.username}`})
                              </span>
                            )}
                            {customAlias && s.userFullName && customAlias !== s.userFullName && (
                              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 'normal', opacity: 0.7 }}>
                                · {s.userFullName}
                              </span>
                            )}
                          </h4>
                        );
                      })()}
                      <span className={`session-status status-${s.status || 'ok'}`}>
                        {s.status === 'connected'
                          ? `${t('accounts.status_connected')}${s.latencyMs != null ? ` · ${s.latencyMs} ms` : ''}`
                          : s.status === 'checking' || s.status === 'migration_required'
                            ? t('accounts.status_checking')
                            : s.status === 'expired'
                              ? t('accounts.status_expired')
                              : t('accounts.status_error')}
                      </span>
                    </div>
                  </div>
                  <div className="list-row-actions" style={{ opacity: s.status === 'connected' ? 1 : 0.65 }}>
                    <div className="title-with-icon" style={{ gap: '0.5rem' }}>
                      <span style={{ fontSize: '0.85rem', color: activeSessions.includes(s.name) ? 'var(--primary)' : 'var(--text-muted)', fontWeight: activeSessions.includes(s.name) ? '600' : 'normal' }}>
                        {activeSessions.includes(s.name) ? t('accounts.active_target') : t('accounts.inactive')}
                      </span>
                      <div 
                        role="switch"
                        aria-checked={activeSessions.includes(s.name)}
                        tabIndex={0}
                        onClick={() =>
                          (s.status === 'connected' ||
                            s.status === 'checking' ||
                            s.status === 'migration_required' ||
                            !s.status) &&
                          toggleSession(s.name)
                        }
                        onKeyDown={(e) => {
                          if (
                            (s.status === 'connected' ||
                              s.status === 'checking' ||
                              s.status === 'migration_required' ||
                              !s.status) &&
                            (e.key === 'Enter' || e.key === ' ')
                          ) {
                            e.preventDefault();
                            toggleSession(s.name);
                          }
                        }}
                        className={`session-toggle ${activeSessions.includes(s.name) ? 'on' : ''}`}
                      >
                        <div className="session-toggle-knob" />
                      </div>
                    </div>
                    
                    <button 
                      type="button"
                      onClick={() => {
                        setRenameTarget({ name: s.name, currentAlias: sessionAliases[s.name] || '' });
                        setAliasInput(sessionAliases[s.name] || s.userFullName || '');
                      }}
                      className="btn btn-secondary btn-icon"
                      title={t('accounts.edit_alias_title')}
                      style={{ padding: '6px 8px' }}
                    >
                      <Pencil size={16} />
                    </button>

                    <button 
                      type="button"
                      onClick={() => handleDeleteSession(s.name)}
                      className="btn btn-secondary btn-icon btn-danger-soft"
                      title={t('accounts.delete_title')}
                      style={{ padding: '6px 8px' }}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Login Wizard Modal */}
      {isWizardOpen && (
        <div className="modal-overlay" onClick={closeWizard}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div className="modal-header" style={{ display: 'flex', alignItems: 'center', gap: '12px', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                {step > 1 && (
                  <button 
                    onClick={() => setStep(step === 3 ? 2 : 1)} 
                    disabled={isProcessing}
                    style={{ 
                      background: 'transparent', 
                      border: 'none', 
                      color: 'var(--text-muted)', 
                      cursor: 'pointer', 
                      padding: '4px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      borderRadius: '6px',
                      transition: 'all 0.2s',
                    }}
                    onMouseOver={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}
                    onMouseOut={(e) => e.currentTarget.style.background = 'transparent'}
                    title={t('accounts.go_back')}
                  >
                    <ArrowLeft size={20} />
                  </button>
                )}
                <h3 style={{ margin: 0, fontSize: '1.1rem' }}>
                  {step === 1
                    ? t('accounts.step_connect')
                    : step === 2
                      ? t('accounts.step_verify')
                      : t('accounts.step_2fa')}
                </h3>
              </div>
              <button
                type="button"
                onClick={closeWizard}
                disabled={isProcessing}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--text-muted, #94a3b8)',
                  cursor: 'pointer',
                  padding: '4px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: '6px',
                  transition: 'all 0.2s',
                }}
                title={t('nav.modal_cancel', { defaultValue: 'Batal' })}
              >
                <X size={18} />
              </button>
            </div>
            
            <div className="modal-body" style={{ padding: '24px' }}>
              {errorMsg && (
                <div style={{ background: 'rgba(239, 68, 68, 0.1)', color: '#ef4444', padding: '12px', borderRadius: '8px', marginBottom: '20px', fontSize: '0.9rem' }}>
                  {errorMsg}
                </div>
              )}
              
              {step === 1 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                  {/* Method Tabs */}
                  <div style={{ display: 'flex', gap: '8px', background: 'rgba(255, 255, 255, 0.04)', padding: '5px', borderRadius: '12px', border: '1px solid rgba(255, 255, 255, 0.08)' }}>
                    <button
                      type="button"
                      onClick={() => { setLoginMethod('qr'); }}
                      style={{
                        flex: 1,
                        padding: '10px 12px',
                        borderRadius: '8px',
                        border: 'none',
                        background: loginMethod === 'qr' ? 'linear-gradient(135deg, #0284c7 0%, #0369a1 100%)' : 'transparent',
                        color: loginMethod === 'qr' ? '#ffffff' : '#94a3b8',
                        fontWeight: '600',
                        fontSize: '0.85rem',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '8px',
                        boxShadow: loginMethod === 'qr' ? '0 4px 14px rgba(2, 132, 199, 0.35)' : 'none',
                        transition: 'all 0.2s ease',
                      }}
                    >
                      <QrCode size={16} /> {t('accounts.tab_qr')}
                    </button>
                    <button
                      type="button"
                      onClick={() => { setLoginMethod('phone'); }}
                      style={{
                        flex: 1,
                        padding: '10px 12px',
                        borderRadius: '8px',
                        border: 'none',
                        background: loginMethod === 'phone' ? 'linear-gradient(135deg, #0284c7 0%, #0369a1 100%)' : 'transparent',
                        color: loginMethod === 'phone' ? '#ffffff' : '#94a3b8',
                        fontWeight: '600',
                        fontSize: '0.85rem',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '8px',
                        boxShadow: loginMethod === 'phone' ? '0 4px 14px rgba(2, 132, 199, 0.35)' : 'none',
                        transition: 'all 0.2s ease',
                      }}
                    >
                      <Phone size={16} /> {t('accounts.tab_phone')}
                    </button>
                    <button
                      type="button"
                      onClick={() => { setLoginMethod('string_session'); }}
                      style={{
                        flex: 1,
                        padding: '10px 12px',
                        borderRadius: '8px',
                        border: 'none',
                        background: loginMethod === 'string_session' ? 'linear-gradient(135deg, #0284c7 0%, #0369a1 100%)' : 'transparent',
                        color: loginMethod === 'string_session' ? '#ffffff' : '#94a3b8',
                        fontWeight: '600',
                        fontSize: '0.85rem',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '8px',
                        boxShadow: loginMethod === 'string_session' ? '0 4px 14px rgba(2, 132, 199, 0.35)' : 'none',
                        transition: 'all 0.2s ease',
                      }}
                    >
                      <KeyRound size={16} /> {t('accounts.tab_string_session')}
                    </button>
                  </div>

                  {loginMethod === 'qr' ? (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px', marginTop: '2px', width: '100%' }}>
                      {!qrDataUrl ? (
                        isProcessing ? (
                          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '24px 16px', gap: '10px', width: '100%' }}>
                            <RefreshCcw className="spin" size={28} color="var(--primary)" />
                            <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                              {t('accounts.qr_generating')}
                            </span>
                          </div>
                        ) : (
                          <button className="btn btn-primary" style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }} onClick={() => handleStartQrLogin(true)}>
                            <RefreshCcw size={16} /> {t('accounts.btn_reload_qr')}
                          </button>
                        )
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px', width: '100%' }}>
                          <div style={{ background: '#ffffff', padding: '10px', borderRadius: '14px', boxShadow: '0 10px 28px rgba(0,0,0,0.5), 0 0 16px rgba(56, 189, 248, 0.12)', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                            <img src={qrDataUrl} alt={t('ui.generated.telegram_login_qr_code_3f083b9')} style={{ width: '165px', height: '165px', display: 'block', borderRadius: '4px' }} />
                            {qrExpiresIn > 0 ? (
                              <span style={{ fontSize: '0.72rem', color: '#0284c7', fontWeight: 700, marginTop: '6px', padding: '2px 8px', borderRadius: '20px', background: 'rgba(2, 132, 199, 0.1)' }}>
                                {t('accounts.valid_for', { seconds: qrExpiresIn })}
                              </span>
                            ) : (
                              <span style={{ fontSize: '0.72rem', color: '#ef4444', fontWeight: 700, marginTop: '6px', padding: '2px 8px', borderRadius: '20px', background: 'rgba(239, 68, 68, 0.1)' }}>
                                {t('accounts.status_expired')}
                              </span>
                            )}
                          </div>

                          {qrExpiresIn === 0 && (
                            <button className="btn btn-primary" style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }} onClick={() => handleStartQrLogin(true)}>
                              <RefreshCcw size={16} /> {t('accounts.btn_reload_qr')}
                            </button>
                          )}

                          <div
                            style={{
                              width: '100%',
                              padding: '12px 14px',
                              borderRadius: '14px',
                              background: 'rgba(255, 255, 255, 0.025)',
                              border: '1px solid rgba(255, 255, 255, 0.08)',
                              boxSizing: 'border-box',
                              display: 'flex',
                              flexDirection: 'column',
                              gap: '8px',
                            }}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                              <Smartphone size={15} style={{ color: '#38bdf8' }} />
                              <span
                                style={{
                                  fontSize: '0.72rem',
                                  fontWeight: 700,
                                  color: '#38bdf8',
                                  letterSpacing: '0.05em',
                                  textTransform: 'uppercase',
                                }}
                              >
                                {t('accounts.qr_instructions_title')}
                              </span>
                            </div>

                            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                              {[
                                t('accounts.qr_step_1'),
                                t('accounts.qr_step_2'),
                                t('accounts.qr_step_3'),
                                t('accounts.qr_step_4'),
                              ].map((stepText, index) => (
                                <div
                                  key={index}
                                  style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '10px',
                                    padding: '5px 10px',
                                    borderRadius: '8px',
                                    background: 'rgba(255, 255, 255, 0.02)',
                                    border: '1px solid rgba(255, 255, 255, 0.04)',
                                  }}
                                >
                                  <span
                                    style={{
                                      width: '20px',
                                      height: '20px',
                                      borderRadius: '50%',
                                      background: 'rgba(56, 189, 248, 0.15)',
                                      border: '1px solid rgba(56, 189, 248, 0.3)',
                                      color: '#38bdf8',
                                      fontSize: '0.7rem',
                                      fontWeight: 700,
                                      display: 'flex',
                                      alignItems: 'center',
                                      justifyContent: 'center',
                                      flexShrink: 0,
                                    }}
                                  >
                                    {index + 1}
                                  </span>
                                  <span style={{ fontSize: '0.8rem', color: '#e2e8f0', lineHeight: 1.35, fontWeight: 500 }}>
                                    {stepText}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>

                          <div style={{ fontSize: '0.75rem', color: '#64748b', textAlign: 'center', lineHeight: 1.4, marginTop: '2px' }}>
                            {t('accounts.qr_auto_refresh_hint')}
                          </div>
                        </div>
                      )}
                    </div>
                  ) : loginMethod === 'phone' ? (
                    <>
                      <div className="input-group" style={{ marginBottom: 0 }}>
                        <label className="input-label" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <Phone size={14} /> {t('accounts.phone_number')}
                        </label>
                        <div style={{ display: 'flex', gap: '8px' }}>
                          <PhoneInput
                            id="phone-input"
                            countrySelectComponent={CustomCountrySelect}
                            placeholder={t('accounts.ph_phone_short')}
                            value={phone}
                            onChange={setPhone}
                            onKeyDown={(e: any) => { 
                              if (e.key === 'Enter') {
                                if (sessionName && phone && !isProcessing) handleSendCode();
                                else if (!sessionName) document.getElementById('session-name-input')?.focus();
                              }
                            }}
                            autoComplete="off"
                            international
                            withCountryCallingCode
                            className="input-field phone-input-container"
                            disabled={isProcessing}
                            style={{ width: '100%' }}
                          />
                        </div>
                      </div>
                      <button className="btn btn-primary" onClick={handleSendCode} disabled={isProcessing || !phone}>
                        {isProcessing ? <RefreshCcw className="spin" size={18} /> : t('accounts.send_code')}
                      </button>
                    </>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                      <div className="input-group" style={{ marginBottom: 0 }}>
                        <label className="input-label" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <KeyRound size={14} /> {t('accounts.string_session_label')}
                        </label>
                        <textarea
                          className="input-field"
                          rows={3}
                          placeholder={t('accounts.string_session_ph')}
                          value={stringSessionInput}
                          onChange={(e) => setStringSessionInput(e.target.value)}
                          disabled={isProcessing}
                          style={{
                            width: '100%',
                            fontFamily: 'monospace',
                            fontSize: '0.8rem',
                            resize: 'vertical',
                            padding: '10px 12px',
                          }}
                        />
                      </div>

                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'flex-start',
                          gap: '8px',
                          padding: '10px 12px',
                          borderRadius: '10px',
                          background: 'rgba(56, 189, 248, 0.06)',
                          border: '1px solid rgba(56, 189, 248, 0.15)',
                          fontSize: '0.78rem',
                          color: '#94a3b8',
                          lineHeight: 1.4,
                        }}
                      >
                        <Sparkles size={16} style={{ color: '#38bdf8', flexShrink: 0, marginTop: '2px' }} />
                        <span>{t('accounts.string_session_desc')}</span>
                      </div>

                      <button
                        className="btn btn-primary"
                        onClick={handleImportStringSession}
                        disabled={isProcessing || !stringSessionInput.trim()}
                        style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
                      >
                        {isProcessing ? <RefreshCcw className="spin" size={18} /> : (
                          <>
                            <KeyRound size={16} /> {t('accounts.btn_import_session')}
                          </>
                        )}
                      </button>
                    </div>
                  )}
                </div>
              )}

              {step === 2 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '10px',
                      padding: '12px 16px',
                      borderRadius: '12px',
                      background: 'rgba(56, 189, 248, 0.08)',
                      border: '1px solid rgba(56, 189, 248, 0.2)',
                    }}
                  >
                    <Send size={20} style={{ color: '#38bdf8', flexShrink: 0 }} />
                    <span style={{ fontSize: '0.85rem', color: '#e2e8f0', lineHeight: 1.4 }}>
                      {t('accounts.code_delivery_info')}
                    </span>
                  </div>

                  <div className="input-group" style={{ marginBottom: 0 }}>
                    <label className="input-label" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <Key size={14} /> {t('accounts.otp_code')}
                    </label>
                    <input
                      type="text"
                      className="input-field"
                      placeholder={t('accounts.ph_code_example')}
                      value={code}
                      onChange={(e) => setCode(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && code && !isProcessing) handleSignIn();
                      }}
                      disabled={isProcessing}
                      autoFocus
                      style={{ letterSpacing: '0.2em', textAlign: 'center', fontSize: '1.25rem', fontWeight: 700 }}
                    />
                  </div>

                  <button
                    className="btn btn-primary"
                    onClick={handleSignIn}
                    disabled={isProcessing || !code.trim()}
                    style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
                  >
                    {isProcessing ? <RefreshCcw className="spin" size={18} /> : t('accounts.verify_code')}
                  </button>

                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', paddingTop: '4px' }}>
                    {resendCooldown > 0 ? (
                      <span style={{ fontSize: '0.82rem', color: '#64748b' }}>
                        {t('accounts.resend_code_in', { seconds: resendCooldown })}
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={handleSendCode}
                        disabled={isProcessing}
                        style={{
                          background: 'none',
                          border: 'none',
                          color: '#38bdf8',
                          fontSize: '0.85rem',
                          fontWeight: 600,
                          cursor: 'pointer',
                          padding: '4px 8px',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px',
                          textDecoration: 'underline',
                        }}
                      >
                        <RefreshCcw size={14} /> {t('accounts.resend_code_now')}
                      </button>
                    )}
                  </div>
                </div>
              )}

              {step === 3 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '0.9rem', lineHeight: 1.45 }}>
                    {t('accounts.2fa_desc')}
                  </p>

                  {passwordHint && (
                    <div
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '6px',
                        padding: '6px 12px',
                        borderRadius: '8px',
                        background: 'rgba(245, 158, 11, 0.12)',
                        border: '1px solid rgba(245, 158, 11, 0.25)',
                        color: '#fbbf24',
                        fontSize: '0.82rem',
                        fontWeight: 600,
                        width: 'fit-content',
                      }}
                    >
                      <Sparkles size={14} />
                      {t('accounts.password_hint_badge', { hint: passwordHint })}
                    </div>
                  )}

                  <div className="input-group" style={{ marginBottom: 0 }}>
                    <label className="input-label" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <Lock size={14} /> {t('accounts.2fa_password')}
                    </label>
                    <div style={{ position: 'relative', width: '100%' }}>
                      <input
                        type={showPassword ? 'text' : 'password'}
                        className="input-field"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && password && !isProcessing) handleSignIn2FA();
                        }}
                        disabled={isProcessing}
                        autoFocus
                        style={{ width: '100%', paddingRight: '40px' }}
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        style={{
                          position: 'absolute',
                          right: '10px',
                          top: '50%',
                          transform: 'translateY(-50%)',
                          background: 'none',
                          border: 'none',
                          color: 'var(--text-muted, #94a3b8)',
                          cursor: 'pointer',
                          padding: '4px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                        title={showPassword ? t('accounts.hide_password') : t('accounts.show_password')}
                      >
                        {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                      </button>
                    </div>
                  </div>

                  <button
                    className="btn btn-primary"
                    onClick={handleSignIn2FA}
                    disabled={isProcessing || !password.trim()}
                    style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
                  >
                    {isProcessing ? <RefreshCcw className="spin" size={18} /> : t('accounts.submit_password')}
                  </button>

                  <div style={{ display: 'flex', justifyContent: 'center', paddingTop: '2px' }}>
                    <button
                      type="button"
                      onClick={() => setIsForgotPasswordOpen(true)}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: '#94a3b8',
                        fontSize: '0.8rem',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '5px',
                        transition: 'color 0.2s',
                      }}
                      onMouseOver={(e) => (e.currentTarget.style.color = '#38bdf8')}
                      onMouseOut={(e) => (e.currentTarget.style.color = '#94a3b8')}
                    >
                      <HelpCircle size={14} /> {t('accounts.forgot_password_btn')}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {isForgotPasswordOpen && (
        <div className="modal-backdrop" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(5px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 15000, padding: '16px' }} onClick={() => setIsForgotPasswordOpen(false)}>
          <div
            className="glass-panel"
            onClick={(e) => e.stopPropagation()}
            style={{ width: '100%', maxWidth: '440px', padding: '24px', borderRadius: '16px', background: 'var(--bg-secondary, #1a1b23)', border: '1px solid var(--border)', boxShadow: '0 20px 50px rgba(0,0,0,0.7)' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div
                  style={{
                    width: '36px',
                    height: '36px',
                    borderRadius: '10px',
                    background: 'rgba(56, 189, 248, 0.15)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#38bdf8',
                  }}
                >
                  <ShieldAlert size={20} />
                </div>
                <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 700 }}>
                  {t('accounts.forgot_password_title')}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setIsForgotPasswordOpen(false)}
                style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', padding: '4px' }}
              >
                <X size={18} />
              </button>
            </div>

            <p style={{ color: '#cbd5e1', fontSize: '0.85rem', lineHeight: 1.55, margin: '0 0 20px' }}>
              {t('accounts.forgot_password_desc')}
            </p>

            <button
              type="button"
              className="btn btn-primary"
              onClick={() => setIsForgotPasswordOpen(false)}
              style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            >
              {t('accounts.btn_got_it')}
            </button>
          </div>
        </div>
      )}

      <ConfirmModal
        isOpen={Boolean(deleteTargetSession)}
        title={t('accounts.delete_session_title')}
        description={t('accounts.delete_confirm', { name: deleteTargetSession || '' })}
        variant="danger"
        confirmText={t('common.delete')}
        cancelText={t('common.cancel')}
        onConfirm={executeDeleteSession}
        onCancel={() => setDeleteTargetSession(null)}
      />

      {renameTarget && (
        <div className="modal-backdrop" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, padding: '16px' }}>
          <div className="glass-panel" style={{ width: '100%', maxWidth: '420px', padding: '24px', borderRadius: '12px', background: 'var(--bg-secondary, #1a1b23)', border: '1px solid var(--border)', boxShadow: '0 20px 50px rgba(0,0,0,0.6)' }}>
            <h3 style={{ margin: '0 0 8px', fontSize: '1.1rem' }}>{t('accounts.rename_modal_title')}</h3>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', margin: '0 0 16px', lineHeight: 1.45 }}>
              {t('accounts.rename_modal_desc')}
            </p>
            <div className="input-group" style={{ marginBottom: '20px' }}>
              <label className="input-label">{t('accounts.custom_alias_label')}</label>
              <input
                type="text"
                className="input-field"
                placeholder={t('accounts.custom_alias_ph')}
                value={aliasInput}
                onChange={(e) => setAliasInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSaveAlias();
                }}
                autoFocus
              />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <button type="button" className="btn btn-secondary" onClick={() => setRenameTarget(null)}>
                {t('accounts.cancel')}
              </button>
              <button type="button" className="btn btn-primary" onClick={handleSaveAlias}>
                {t('accounts.save')}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
