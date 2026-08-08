import { useState, useEffect, memo } from 'react';
import { Bug, Copy, Trash2, FileText, Terminal, AlertTriangle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  isDebugMode,
  setDebugMode,
  subscribeDebugMode,
  getDebugLogBuffer,
  clearDebugLogBuffer,
  debugLogFileHint,
  debugLog,
  copyTextWithFallback,
} from '../../lib/utils/debugMode';

export const DebugSection = memo(function DebugSection() {
  const { t } = useTranslation();
  const [debugOn, setDebugOn] = useState(() => isDebugMode());
  const [debugBusy, setDebugBusy] = useState(false);
  const [logSnap, setLogSnap] = useState<string[]>([]);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    return subscribeDebugMode((on) => {
      setDebugOn(on);
      const fresh = getDebugLogBuffer();
      setLogSnap(fresh);
    });
  }, []);

  useEffect(() => {
    if (!debugOn) return;
    const id = window.setInterval(() => {
      const fresh = getDebugLogBuffer();
      setLogSnap((prev) => {
        if (
          prev.length === fresh.length &&
          (prev.length === 0 || prev[prev.length - 1] === fresh[fresh.length - 1])
        ) {
          return prev;
        }
        return fresh;
      });
    }, 1500);
    setLogSnap(getDebugLogBuffer());
    return () => window.clearInterval(id);
  }, [debugOn]);

  const toggleDebug = async (next: boolean) => {
    setDebugBusy(true);
    try {
      await setDebugMode(next);
      setDebugOn(next);
      debugLog('settings', next ? 'user enabled Debug Mode' : 'user disabled Debug Mode');
      setLogSnap(getDebugLogBuffer());
    } finally {
      setDebugBusy(false);
    }
  };

  return (
    <div className={`glass-panel card dbg-card ${debugOn ? 'is-on' : ''}`}>
      <div className="dbg-head">
        <div className="dbg-head-left">
          <span className={`dbg-icon-badge ${debugOn ? 'on' : ''}`} aria-hidden>
            <Bug size={18} strokeWidth={2.25} />
          </span>
          <div className="dbg-head-text">
            <h3>{t('settings.debug_title')}</h3>
            <p>{t('settings.debug_subtitle')}</p>
          </div>
        </div>
        <button
          type="button"
          className={`dbg-switch ${debugOn ? 'on' : ''} ${debugBusy ? 'busy' : ''}`}
          role="switch"
          aria-checked={debugOn}
          aria-label={debugOn ? t('settings.debug_disable') : t('settings.debug_enable')}
          disabled={debugBusy}
          onClick={() => void toggleDebug(!debugOn)}
        >
          <span className="dbg-switch-track">
            <span className="dbg-switch-knob" />
          </span>
          <span className="dbg-switch-label">{debugOn ? t('ui.generated.on_387d7a5') : t('ui.generated.off_ad50489')}</span>
        </button>
      </div>

      <p className="dbg-desc">
        {t('settings.debug_desc')}
      </p>

      <div className="dbg-status-row">
        <span className={`dbg-pill ${debugOn ? 'live' : 'idle'}`}>
          <span className="dbg-pill-dot" />
          {debugOn ? t('settings.debug_status_active') : t('settings.debug_status_inactive')}
        </span>
        <span className="dbg-meta-sep" aria-hidden>
          ·
        </span>
        <span className="dbg-meta">{t('settings.worker_ui_transfer_log')}</span>
      </div>

      {debugOn && (
        <div className="dbg-body">
          <div className="dbg-paths">
            <div className="dbg-path-chip" title={t('ui.generated.flag_file_yang_dibaca_worker_88bd055')}>
              <FileText size={13} />
              <div className="dbg-path-text">
                <span className="dbg-path-label">{t('ui.generated.flag_a774409')}</span>
                <code>{t('ui.generated.temp_autogram_debug_txt_9549f28')}</code>
              </div>
            </div>
            <div className="dbg-path-chip" title={t('ui.generated.file_log_di_disk_056afac')}>
              <Terminal size={13} />
              <div className="dbg-path-text">
                <span className="dbg-path-label">{t('ui.generated.log_file_60c1e62')}</span>
                <code>{debugLogFileHint()}</code>
              </div>
            </div>
          </div>

          <div className="dbg-console">
            <div className="dbg-console-bar">
              <span className="dbg-console-title">
                <span className="dbg-live-dot" />
                {t('ui.generated.live_buffer_912a5de')}
                <span className="dbg-console-count">{logSnap.length}</span>
              </span>
              <div className="dbg-console-actions">
                <button
                  type="button"
                  className="dbg-icon-btn"
                  title={t('settings.copy_buffer_tooltip')}
                  onClick={() => {
                    const text = getDebugLogBuffer().join('\n') || '(kosong)';
                    void copyTextWithFallback(text).then((ok) => {
                      setCopied(ok);
                      window.setTimeout(() => setCopied(false), 2000);
                      if (!ok) {
                        debugLog('settings', 'clipboard copy failed — use manual select');
                      }
                    });
                  }}
                >
                  <Copy size={14} />
                  <span>{copied ? t('settings.debug_copied') : t('settings.debug_copy_logs')}</span>
                </button>
                <button
                  type="button"
                  className="dbg-icon-btn danger"
                  title={t('settings.clear_buffer_tooltip')}
                  onClick={() => {
                    clearDebugLogBuffer();
                    setLogSnap([]);
                  }}
                >
                  <Trash2 size={14} />
                  <span>{t('settings.debug_clear_logs')}</span>
                </button>
              </div>
            </div>
            <pre className="dbg-console-pre" aria-label={t('ui.generated.debug_log_buffer_e62c5bd')}>
              {logSnap.length
                ? logSnap.slice(-48).join('\n')
                : t('settings.debug_empty_buffer')}
            </pre>
          </div>

          <div className="dbg-tip" role="note">
            <AlertTriangle size={14} />
            <p>
              {t('settings.debug_tip')}
            </p>
          </div>
        </div>
      )}
    </div>
  );
});
