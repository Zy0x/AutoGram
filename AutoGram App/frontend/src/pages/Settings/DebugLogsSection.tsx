import { useState, useEffect, memo } from 'react';
import { Bug, Copy, Trash2, FileText, Terminal, AlertTriangle } from 'lucide-react';
import {
  isDebugMode,
  setDebugMode,
  subscribeDebugMode,
  getDebugLogBuffer,
  clearDebugLogBuffer,
  debugLogFileHint,
  debugLog,
  copyTextWithFallback,
} from '../../lib/debugMode';

export const DebugSection = memo(function DebugSection() {
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
            <h3>Debug Mode</h3>
            <p>Log penuh AutoGram &amp; Telegram Drive</p>
          </div>
        </div>
        <button
          type="button"
          className={`dbg-switch ${debugOn ? 'on' : ''} ${debugBusy ? 'busy' : ''}`}
          role="switch"
          aria-checked={debugOn}
          aria-label={debugOn ? 'Matikan Debug Mode' : 'Nyalakan Debug Mode'}
          disabled={debugBusy}
          onClick={() => void toggleDebug(!debugOn)}
        >
          <span className="dbg-switch-track">
            <span className="dbg-switch-knob" />
          </span>
          <span className="dbg-switch-label">{debugOn ? 'ON' : 'OFF'}</span>
        </button>
      </div>

      <p className="dbg-desc">
        Menangkap log worker + UI untuk men-debug unduhan yang mengulang, fallback, dan error
        transfer. Sedikit lebih lambat saat aktif.{' '}
        <strong>Jangan bagikan log</strong> — bisa berisi path &amp; nama file.
      </p>

      <div className="dbg-status-row">
        <span className={`dbg-pill ${debugOn ? 'live' : 'idle'}`}>
          <span className="dbg-pill-dot" />
          {debugOn ? 'Aktif' : 'Nonaktif'}
        </span>
        <span className="dbg-meta-sep" aria-hidden>
          ·
        </span>
        <span className="dbg-meta">Worker + UI + transfer</span>
      </div>

      {debugOn && (
        <div className="dbg-body">
          <div className="dbg-paths">
            <div className="dbg-path-chip" title="Flag file yang dibaca worker">
              <FileText size={13} />
              <div className="dbg-path-text">
                <span className="dbg-path-label">Flag</span>
                <code>temp/autogram_debug.txt</code>
              </div>
            </div>
            <div className="dbg-path-chip" title="File log di disk">
              <Terminal size={13} />
              <div className="dbg-path-text">
                <span className="dbg-path-label">Log file</span>
                <code>{debugLogFileHint()}</code>
              </div>
            </div>
          </div>

          <div className="dbg-console">
            <div className="dbg-console-bar">
              <span className="dbg-console-title">
                <span className="dbg-live-dot" />
                Live buffer
                <span className="dbg-console-count">{logSnap.length}</span>
              </span>
              <div className="dbg-console-actions">
                <button
                  type="button"
                  className="dbg-icon-btn"
                  title="Salin buffer (fallback jika clipboard diblokir WebView)"
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
                  <span>{copied ? 'Tersalin ✓' : 'Salin'}</span>
                </button>
                <button
                  type="button"
                  className="dbg-icon-btn danger"
                  title="Hapus buffer"
                  onClick={() => {
                    clearDebugLogBuffer();
                    setLogSnap([]);
                  }}
                >
                  <Trash2 size={14} />
                  <span>Clear</span>
                </button>
              </div>
            </div>
            <pre className="dbg-console-pre" aria-label="Debug log buffer">
              {logSnap.length
                ? logSnap.slice(-48).join('\n')
                : 'Buffer kosong — jalankan unduh, unggah, atau buka Media Studio untuk mengisi log.'}
            </pre>
          </div>

          <div className="dbg-tip" role="note">
            <AlertTriangle size={14} />
            <p>
              Job yang sudah jalan (drive-serve / unduhan) perlu diulang setelah toggle agar flag
              terbaca penuh.
            </p>
          </div>
        </div>
      )}
    </div>
  );
});
