import { useState, useEffect, memo } from 'react';
import { Network, Zap, Save, Wifi, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { detectTauriRuntime } from '../../lib/tauri/platform';
import {
  networkApplyAll,
  networkDetectVpn,
  networkGetConfig,
  networkIsAvailable,
  networkTestProxy,
  type NetworkConfigSnapshot,
  type ProxyStatus,
} from '../../lib/tauri/rustBackend';

export const NetworkSection = memo(function NetworkSection() {
  const { t } = useTranslation();
  const [netCfg, setNetCfg] = useState<NetworkConfigSnapshot | null>(null);
  const [netBusy, setNetBusy] = useState(false);
  const [netMsg, setNetMsg] = useState<string | null>(null);
  const [proxyStatus, setProxyStatus] = useState<ProxyStatus | null>(null);
  const [netAvail, setNetAvail] = useState<boolean | null>(null);
  const [vpnHint, setVpnHint] = useState<boolean | null>(null);

  useEffect(() => {
    if (!detectTauriRuntime()) return;
    let cancelled = false;
    (async () => {
      const cfg = await networkGetConfig();
      if (!cancelled && cfg) setNetCfg(cfg);
      const avail = await networkIsAvailable();
      if (!cancelled) setNetAvail(avail);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const saveNetwork = async () => {
    if (!netCfg) return;
    setNetBusy(true);
    setNetMsg(null);
    try {
      const ok = await networkApplyAll(netCfg);
      setNetMsg(
        ok
          ? 'Network settings saved. Restart Drive session / reconnect so Telethon picks up proxy.'
          : 'Failed to save network settings.'
      );
    } finally {
      setNetBusy(false);
    }
  };

  const testProxy = async () => {
    setNetBusy(true);
    try {
      if (netCfg) await networkApplyAll(netCfg);
      const st = await networkTestProxy();
      setProxyStatus(st);
      const hint = await networkDetectVpn();
      setVpnHint(hint);
      const avail = await networkIsAvailable();
      setNetAvail(avail);
    } finally {
      setNetBusy(false);
    }
  };

  // Web fallback placeholder if not running in Tauri
  if (!detectTauriRuntime()) {
    return (
      <div className="td-settings-card glass-panel card">
        <div className="card-header">
          <Network size={20} color="var(--primary, #38bdf8)" />
          <h3>{t('settings.proxy_title', 'Proxy & VPN Optimizer')}</h3>
        </div>
        <p className="field-hint" style={{ marginBottom: '1rem', lineHeight: 1.5 }}>
          {t(
            'settings.proxy_subtitle',
            'Extracted from Telegram-Drive features: SOCKS5/HTTP/MTProto routing + timeout/retry adjustments for slow networks/VPNs. Stored in Rust; Python worker (Telethon) consumes via env.'
          )}
        </p>
        <div style={{ padding: '12px', background: 'rgba(15, 23, 42, 0.5)', borderRadius: '8px', color: '#94a3b8', fontSize: '13px' }}>
          Pengaturan Proxy & Optimizer Jaringan hanya tersedia di lingkungan desktop (Tauri runtime).
        </div>
      </div>
    );
  }

  if (!netCfg) {
    return (
      <div className="td-settings-card glass-panel card" style={{ padding: '24px', textAlign: 'center' }}>
        <Loader2 size={24} className="spin" style={{ color: '#38bdf8', margin: '0 auto 8px' }} />
        <p style={{ color: '#94a3b8', fontSize: '13px' }}>Memuat konfigurasi jaringan & proxy…</p>
      </div>
    );
  }

  return (
    <div className="td-settings-card glass-panel card">
      <div className="card-header">
        <Network size={20} color="var(--primary, #38bdf8)" />
        <h3>{t('settings.proxy_title', 'Proxy & VPN Optimizer')}</h3>
      </div>
      <p className="field-hint" style={{ marginBottom: '1rem', lineHeight: 1.5 }}>
        {t(
          'settings.proxy_subtitle',
          'Extracted from Telegram-Drive features: SOCKS5/HTTP/MTProto routing + timeout/retry adjustments for slow networks/VPNs. Stored in Rust; Python worker (Telethon) consumes via env.'
        )}
      </p>

      <div className="page-stack" style={{ gap: '1rem' }}>
        <label className="title-with-icon" style={{ gap: 8, cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
          <input
            type="checkbox"
            checked={netCfg.proxy.enabled}
            onChange={(e) =>
              setNetCfg({
                ...netCfg,
                proxy: { ...netCfg.proxy, enabled: e.target.checked },
              })
            }
          />
          {t('settings.enable_proxy', 'Enable Proxy')}
        </label>

        {netCfg.proxy.enabled && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px', background: 'rgba(0,0,0,0.15)', padding: '14px', borderRadius: '10px', border: '1px solid rgba(255,255,255,0.06)' }}>
            <div className="input-group" style={{ marginBottom: 0 }}>
              <label className="input-label" style={{ fontSize: '12px', color: '#94a3b8', marginBottom: '4px', display: 'block' }}>Type</label>
              <select
                className="input-field"
                style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', background: '#0f172a', border: '1px solid rgba(255,255,255,0.1)', color: '#f8fafc' }}
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
            <div className="input-group" style={{ marginBottom: 0 }}>
              <label className="input-label" style={{ fontSize: '12px', color: '#94a3b8', marginBottom: '4px', display: 'block' }}>Host</label>
              <input
                className="input-field"
                style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', background: '#0f172a', border: '1px solid rgba(255,255,255,0.1)', color: '#f8fafc' }}
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
            <div className="input-group" style={{ marginBottom: 0 }}>
              <label className="input-label" style={{ fontSize: '12px', color: '#94a3b8', marginBottom: '4px', display: 'block' }}>Port</label>
              <input
                className="input-field"
                type="number"
                style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', background: '#0f172a', border: '1px solid rgba(255,255,255,0.1)', color: '#f8fafc' }}
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
            <div className="input-group" style={{ marginBottom: 0 }}>
              <label className="input-label" style={{ fontSize: '12px', color: '#94a3b8', marginBottom: '4px', display: 'block' }}>Username</label>
              <input
                className="input-field"
                style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', background: '#0f172a', border: '1px solid rgba(255,255,255,0.1)', color: '#f8fafc' }}
                value={netCfg.proxy.username}
                onChange={(e) =>
                  setNetCfg({
                    ...netCfg,
                    proxy: { ...netCfg.proxy, username: e.target.value },
                  })
                }
              />
            </div>
            <div className="input-group" style={{ marginBottom: 0 }}>
              <label className="input-label" style={{ fontSize: '12px', color: '#94a3b8', marginBottom: '4px', display: 'block' }}>Password</label>
              <input
                className="input-field"
                type="password"
                style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', background: '#0f172a', border: '1px solid rgba(255,255,255,0.1)', color: '#f8fafc' }}
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
              <div className="input-group" style={{ marginBottom: 0 }}>
                <label className="input-label" style={{ fontSize: '12px', color: '#94a3b8', marginBottom: '4px', display: 'block' }}>MTProto secret (hex)</label>
                <input
                  className="input-field"
                  style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', background: '#0f172a', border: '1px solid rgba(255,255,255,0.1)', color: '#f8fafc' }}
                  value={netCfg.proxy.secret || ''}
                  onChange={(e) =>
                    setNetCfg({
                      ...netCfg,
                      proxy: { ...netCfg.proxy, secret: e.target.value },
                    })
                  }
                  placeholder="dd… or ee…"
                />
              </div>
            )}
          </div>
        )}

        <hr style={{ border: 0, borderTop: '1px solid rgba(255,255,255,0.08)', margin: '0.25rem 0' }} />

        <label className="title-with-icon" style={{ gap: 8, cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
          <input
            type="checkbox"
            checked={netCfg.vpn.enabled}
            onChange={(e) =>
              setNetCfg({
                ...netCfg,
                vpn: { ...netCfg.vpn, enabled: e.target.checked },
              })
            }
          />
          <Zap size={16} style={{ color: '#38bdf8' }} /> {t('settings.vpn_optimizer', 'VPN Optimizer (aggressive timeout & retry)')}
        </label>

        <div className="page-header-actions" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: '8px' }}>
          <button
            type="button"
            className="btn btn-primary"
            disabled={netBusy}
            onClick={() => void saveNetwork()}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '8px 16px',
              borderRadius: '8px',
              background: 'linear-gradient(135deg, #0284c7 0%, #0369a1 100%)',
              color: '#ffffff',
              border: 'none',
              fontWeight: 600,
              cursor: netBusy ? 'not-allowed' : 'pointer',
            }}
          >
            {netBusy ? <Loader2 size={16} className="spin" /> : <Save size={16} />}
            {t('settings.save_network', 'Save Network')}
          </button>
          <button
            type="button"
            className="btn"
            disabled={netBusy}
            onClick={() => void testProxy()}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '8px 16px',
              borderRadius: '8px',
              background: 'rgba(255, 255, 255, 0.06)',
              color: '#f8fafc',
              border: '1px solid rgba(255, 255, 255, 0.12)',
              cursor: netBusy ? 'not-allowed' : 'pointer',
            }}
          >
            <Wifi size={16} /> {t('settings.test_proxy', 'Test proxy / DC')}
          </button>
        </div>

        {netMsg && <p className="field-hint" style={{ color: '#38bdf8', fontSize: '12px' }}>{netMsg}</p>}
        {proxyStatus && (
          <p className="field-hint" style={{ fontSize: '12px', color: '#94a3b8' }}>
            Proxy TCP:{' '}
            <strong style={{ color: proxyStatus.reachable ? '#4ade80' : '#f87171' }}>
              {proxyStatus.reachable ? 'OK' : 'Failed'}
            </strong>
            {proxyStatus.latencyMs >= 0 ? ` · ${proxyStatus.latencyMs} ms` : ''} · {proxyStatus.detail}
          </p>
        )}
        {netAvail != null && (
          <p className="field-hint" style={{ fontSize: '12px', color: '#94a3b8' }}>
            {t('settings.proxy_reachability', 'Telegram DC / proxy reachability:')}{' '}
            <strong style={{ color: netAvail ? '#4ade80' : '#f87171' }}>
              {netAvail ? t('settings.proxy_available', 'available') : t('settings.proxy_unavailable', 'unavailable')}
            </strong>
          </p>
        )}
        {vpnHint != null && vpnHint && (
          <p className="field-hint" style={{ fontSize: '12px', color: '#f59e0b' }}>
            Hint: Telegram DC slow/unreachable — consider enabling VPN Optimizer or Proxy.
          </p>
        )}
      </div>
    </div>
  );
});
