import { useState, useEffect, memo } from 'react';
import { Network, Wifi, Save, Loader2, Zap } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { detectTauriRuntime } from '../../lib/tauri/platform';
import { invoke } from '@tauri-apps/api/core';

interface NetConfig {
  proxy: {
    enabled: boolean;
    proxyType: string;
    host: string;
    port: number;
    username: string;
    password: string;
    secret?: string;
  };
  vpn: {
    enabled: boolean;
    aggressiveRetry: boolean;
  };
}

export const NetworkSection = memo(function NetworkSection() {
  const { t } = useTranslation();
  const [netCfg, setNetCfg] = useState<NetConfig | null>(null);
  const [netMsg, setNetMsg] = useState<string | null>(null);
  const [netAvail, setNetAvail] = useState<boolean | null>(null);
  const [vpnHint, setVpnHint] = useState<boolean | null>(null);
  const [proxyStatus, setProxyStatus] = useState<{
    reachable: boolean;
    latencyMs: number;
    detail: string;
  } | null>(null);
  const [netBusy, setNetBusy] = useState(false);

  useEffect(() => {
    if (!detectTauriRuntime()) return;
    let active = true;
    (async () => {
      try {
        const raw = await invoke<string>('get_network_config');
        if (active && raw) setNetCfg(JSON.parse(raw));
      } catch {
        /* ignore */
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const saveNetwork = async () => {
    if (!netCfg || !detectTauriRuntime()) return;
    setNetBusy(true);
    setNetMsg(null);
    try {
      await invoke('set_network_config', { json: JSON.stringify(netCfg) });
      setNetMsg('✓ Pengaturan Jaringan & Proxy berhasil disimpan!');
    } catch (e: any) {
      setNetMsg(`✕ Gagal menyimpan: ${e?.message || e}`);
    } finally {
      setNetBusy(false);
    }
  };

  const testProxy = async () => {
    if (!detectTauriRuntime()) return;
    setNetBusy(true);
    setProxyStatus(null);
    setNetAvail(null);
    setVpnHint(null);
    try {
      const res = await invoke<any>('test_telegram_reachability');
      if (res) {
        setNetAvail(res.reachable);
        setVpnHint(res.suggestVpn);
        if (res.proxyStatus) {
          setProxyStatus(res.proxyStatus);
        }
      }
    } catch {
      setNetAvail(false);
    } finally {
      setNetBusy(false);
    }
  };

  // Web fallback placeholder if not running in Tauri
  if (!detectTauriRuntime()) {
    return (
      <div
        style={{
          background: 'linear-gradient(150deg, rgba(15, 22, 36, 0.8) 0%, rgba(8, 12, 22, 0.95) 100%)',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          borderRadius: '16px',
          padding: '24px',
          boxShadow: '0 8px 24px rgba(0, 0, 0, 0.35)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
          <div
            style={{
              width: '34px',
              height: '34px',
              borderRadius: '10px',
              background: 'rgba(56, 189, 248, 0.12)',
              border: '1px solid rgba(56, 189, 248, 0.25)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <Network size={18} style={{ color: '#38bdf8' }} />
          </div>
          <h3 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 800, color: '#f8fafc', letterSpacing: '-0.01em' }}>
            {t('settings.proxy_title', 'Proxy & VPN Optimizer')}
          </h3>
        </div>
        <p style={{ margin: '0 0 16px 0', fontSize: '0.85rem', color: '#94a3b8', lineHeight: 1.5 }}>
          {t(
            'settings.proxy_subtitle',
            'Konfigurasi routing SOCKS5/HTTP/MTProto, penyesuaian timeout & retry agresif untuk jaringan lambat/VPN.'
          )}
        </p>
        <div
          style={{
            padding: '14px',
            background: 'rgba(15, 23, 42, 0.5)',
            borderRadius: '12px',
            color: '#94a3b8',
            fontSize: '0.82rem',
            border: '1px solid rgba(255, 255, 255, 0.06)',
          }}
        >
          Pengaturan Proxy & Optimizer Jaringan hanya tersedia di lingkungan desktop (Tauri runtime).
        </div>
      </div>
    );
  }

  if (!netCfg) {
    return (
      <div
        style={{
          background: 'linear-gradient(150deg, rgba(15, 22, 36, 0.8) 0%, rgba(8, 12, 22, 0.95) 100%)',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          borderRadius: '16px',
          padding: '32px',
          textAlign: 'center',
          boxShadow: '0 8px 24px rgba(0, 0, 0, 0.35)',
        }}
      >
        <Loader2 size={24} className="spin" style={{ color: '#38bdf8', margin: '0 auto 10px' }} />
        <p style={{ color: '#94a3b8', fontSize: '0.85rem', margin: 0 }}>Memuat konfigurasi jaringan & proxy…</p>
      </div>
    );
  }

  return (
    <div
      style={{
        background: 'linear-gradient(150deg, rgba(15, 22, 36, 0.8) 0%, rgba(8, 12, 22, 0.95) 100%)',
        border: '1px solid rgba(255, 255, 255, 0.08)',
        borderRadius: '16px',
        padding: '24px',
        boxShadow: '0 8px 24px rgba(0, 0, 0, 0.35)',
      }}
    >
      {/* SECTION HEADER */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
        <div
          style={{
            width: '34px',
            height: '34px',
            borderRadius: '10px',
            background: 'rgba(56, 189, 248, 0.12)',
            border: '1px solid rgba(56, 189, 248, 0.25)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          <Network size={18} style={{ color: '#38bdf8' }} />
        </div>
        <h3 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 800, color: '#f8fafc', letterSpacing: '-0.01em' }}>
          {t('settings.proxy_title', 'Proxy & VPN Optimizer')}
        </h3>
      </div>
      <p style={{ margin: '0 0 20px 0', fontSize: '0.85rem', color: '#94a3b8', lineHeight: 1.5 }}>
        {t(
          'settings.proxy_subtitle',
          'Konfigurasi routing SOCKS5/HTTP/MTProto, penyesuaian timeout & retry agresif untuk jaringan lambat/VPN.'
        )}
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {/* ENABLE PROXY TOGGLE */}
        <label
          style={{
            gap: '10px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            fontSize: '0.92rem',
            fontWeight: 700,
            color: '#f8fafc',
            userSelect: 'none',
          }}
        >
          <input
            type="checkbox"
            checked={netCfg.proxy.enabled}
            onChange={(e) =>
              setNetCfg({
                ...netCfg,
                proxy: { ...netCfg.proxy, enabled: e.target.checked },
              })
            }
            style={{ width: '16px', height: '16px', accentColor: '#00aeef', cursor: 'pointer' }}
          />
          <span>{t('settings.enable_proxy', 'Aktifkan Proxy')}</span>
        </label>

        {/* PROXY FORM FIELDS */}
        {netCfg.proxy.enabled && (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
              gap: '14px',
              background: 'rgba(15, 23, 42, 0.4)',
              padding: '18px',
              borderRadius: '14px',
              border: '1px solid rgba(255, 255, 255, 0.08)',
            }}
          >
            <div>
              <label style={{ fontSize: '0.78rem', color: '#94a3b8', marginBottom: '6px', display: 'block', fontWeight: 600 }}>
                Tipe Proxy
              </label>
              <select
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  borderRadius: '10px',
                  background: 'rgba(15, 23, 42, 0.8)',
                  border: '1px solid rgba(255, 255, 255, 0.12)',
                  color: '#f8fafc',
                  fontSize: '0.85rem',
                  outline: 'none',
                }}
                value={netCfg.proxy.proxyType}
                onChange={(e) =>
                  setNetCfg({
                    ...netCfg,
                    proxy: { ...netCfg.proxy, proxyType: e.target.value },
                  })
                }
              >
                <option value="socks5">SOCKS5</option>
                <option value="http">HTTP</option>
                <option value="https">HTTPS</option>
                <option value="mtproto">MTProto (Telegram)</option>
              </select>
            </div>

            <div>
              <label style={{ fontSize: '0.78rem', color: '#94a3b8', marginBottom: '6px', display: 'block', fontWeight: 600 }}>
                Host / IP
              </label>
              <input
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  borderRadius: '10px',
                  background: 'rgba(15, 23, 42, 0.8)',
                  border: '1px solid rgba(255, 255, 255, 0.12)',
                  color: '#f8fafc',
                  fontSize: '0.85rem',
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
                value={netCfg.proxy.host}
                onChange={(e) =>
                  setNetCfg({
                    ...netCfg,
                    proxy: { ...netCfg.proxy, host: e.target.value },
                  })
                }
                placeholder="127.0.0.1"
              />
            </div>

            <div>
              <label style={{ fontSize: '0.78rem', color: '#94a3b8', marginBottom: '6px', display: 'block', fontWeight: 600 }}>
                Port
              </label>
              <input
                type="number"
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  borderRadius: '10px',
                  background: 'rgba(15, 23, 42, 0.8)',
                  border: '1px solid rgba(255, 255, 255, 0.12)',
                  color: '#f8fafc',
                  fontSize: '0.85rem',
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
                value={netCfg.proxy.port}
                onChange={(e) =>
                  setNetCfg({
                    ...netCfg,
                    proxy: {
                      ...netCfg.proxy,
                      port: Math.max(1, Math.min(65535, Number(e.target.value) || 1080)),
                    },
                  })
                }
              />
            </div>

            <div>
              <label style={{ fontSize: '0.78rem', color: '#94a3b8', marginBottom: '6px', display: 'block', fontWeight: 600 }}>
                Username (Opsional)
              </label>
              <input
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  borderRadius: '10px',
                  background: 'rgba(15, 23, 42, 0.8)',
                  border: '1px solid rgba(255, 255, 255, 0.12)',
                  color: '#f8fafc',
                  fontSize: '0.85rem',
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
                value={netCfg.proxy.username}
                onChange={(e) =>
                  setNetCfg({
                    ...netCfg,
                    proxy: { ...netCfg.proxy, username: e.target.value },
                  })
                }
              />
            </div>

            <div>
              <label style={{ fontSize: '0.78rem', color: '#94a3b8', marginBottom: '6px', display: 'block', fontWeight: 600 }}>
                Password (Opsional)
              </label>
              <input
                type="password"
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  borderRadius: '10px',
                  background: 'rgba(15, 23, 42, 0.8)',
                  border: '1px solid rgba(255, 255, 255, 0.12)',
                  color: '#f8fafc',
                  fontSize: '0.85rem',
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
                value={netCfg.proxy.password}
                onChange={(e) =>
                  setNetCfg({
                    ...netCfg,
                    proxy: { ...netCfg.proxy, password: e.target.value },
                  })
                }
              />
            </div>

            {netCfg.proxy.proxyType === 'mtproto' && (
              <div>
                <label style={{ fontSize: '0.78rem', color: '#94a3b8', marginBottom: '6px', display: 'block', fontWeight: 600 }}>
                  MTProto Secret (Hex)
                </label>
                <input
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    borderRadius: '10px',
                    background: 'rgba(15, 23, 42, 0.8)',
                    border: '1px solid rgba(255, 255, 255, 0.12)',
                    color: '#f8fafc',
                    fontSize: '0.85rem',
                    outline: 'none',
                    boxSizing: 'border-box',
                  }}
                  value={netCfg.proxy.secret || ''}
                  onChange={(e) =>
                    setNetCfg({
                      ...netCfg,
                      proxy: { ...netCfg.proxy, secret: e.target.value },
                    })
                  }
                  placeholder="dd… atau ee…"
                />
              </div>
            )}
          </div>
        )}

        <hr style={{ border: 0, borderTop: '1px solid rgba(255, 255, 255, 0.08)', margin: '4px 0' }} />

        {/* VPN OPTIMIZER TOGGLE */}
        <label
          style={{
            gap: '10px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            fontSize: '0.92rem',
            fontWeight: 700,
            color: '#f8fafc',
            userSelect: 'none',
          }}
        >
          <input
            type="checkbox"
            checked={netCfg.vpn.enabled}
            onChange={(e) =>
              setNetCfg({
                ...netCfg,
                vpn: { ...netCfg.vpn, enabled: e.target.checked },
              })
            }
            style={{ width: '16px', height: '16px', accentColor: '#00aeef', cursor: 'pointer' }}
          />
          <Zap size={16} style={{ color: '#38bdf8' }} />
          <span>{t('settings.vpn_optimizer', 'VPN Optimizer (Timeout & Retry Agresif)')}</span>
        </label>

        {/* ACTION BUTTONS */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', marginTop: '6px' }}>
          <button
            type="button"
            disabled={netBusy}
            onClick={() => void saveNetwork()}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '10px 18px',
              borderRadius: '10px',
              background: 'linear-gradient(135deg, #0284c7 0%, #0369a1 100%)',
              color: '#ffffff',
              border: 'none',
              fontWeight: 700,
              fontSize: '0.85rem',
              cursor: netBusy ? 'not-allowed' : 'pointer',
              boxShadow: '0 4px 12px rgba(56, 189, 248, 0.25)',
              transition: 'all 0.15s ease',
            }}
          >
            {netBusy ? <Loader2 size={16} className="spin" /> : <Save size={16} />}
            <span>{t('settings.save_network', 'Simpan Pengaturan Jaringan')}</span>
          </button>
          <button
            type="button"
            disabled={netBusy}
            onClick={() => void testProxy()}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '10px 18px',
              borderRadius: '10px',
              background: 'rgba(255, 255, 255, 0.05)',
              color: '#f8fafc',
              border: '1px solid rgba(255, 255, 255, 0.12)',
              fontWeight: 600,
              fontSize: '0.85rem',
              cursor: netBusy ? 'not-allowed' : 'pointer',
              transition: 'all 0.15s ease',
            }}
          >
            <Wifi size={16} />
            <span>{t('settings.test_proxy', 'Uji Koneksi Proxy / DC')}</span>
          </button>
        </div>

        {/* STATUS MESSAGES */}
        {netMsg && <p style={{ color: '#38bdf8', fontSize: '0.8rem', margin: '4px 0 0 0', fontWeight: 600 }}>{netMsg}</p>}
        {proxyStatus && (
          <p style={{ fontSize: '0.8rem', color: '#94a3b8', margin: '4px 0 0 0' }}>
            Proxy TCP:{' '}
            <strong style={{ color: proxyStatus.reachable ? '#4ade80' : '#f87171' }}>
              {proxyStatus.reachable ? 'OK' : 'Failed'}
            </strong>
            {proxyStatus.latencyMs >= 0 ? ` · ${proxyStatus.latencyMs} ms` : ''} · {proxyStatus.detail}
          </p>
        )}
        {netAvail != null && (
          <p style={{ fontSize: '0.8rem', color: '#94a3b8', margin: '4px 0 0 0' }}>
            {t('settings.proxy_reachability', 'Keterjangkauan Telegram DC / Proxy:')}{' '}
            <strong style={{ color: netAvail ? '#4ade80' : '#f87171' }}>
              {netAvail ? t('settings.proxy_available', 'Tersedia') : t('settings.proxy_unavailable', 'Tidak Dapat Dijangkau')}
            </strong>
          </p>
        )}
        {vpnHint != null && vpnHint && (
          <p style={{ fontSize: '0.8rem', color: '#f59e0b', margin: '4px 0 0 0' }}>
            Petunjuk: Telegram DC lambat/tidak terjangkau — pertimbangkan mengaktifkan VPN Optimizer atau Proxy.
          </p>
        )}
      </div>
    </div>
  );
});
