import { Check, Loader2, PlaySquare, Trash2 } from 'lucide-react';

export function PlaybackSettingsSection({ activeTab, ctx }: { activeTab: string; ctx: Record<string, any> }) {
  const { t, draft, patch, embedded, clearingPlaybackHistory, clearedPlaybackSuccess, handleClearPlaybackHistory } = ctx;
  return activeTab === 'playback' ? (
          <div className="td-xfer-focused-panel" id="section-playback-settings">
            <div
              className="td-settings-card"
              style={{
                background: 'linear-gradient(150deg, var(--bg-card, rgba(15, 22, 36, 0.8)) 0%, var(--bg-primary, rgba(8, 12, 22, 0.95)) 100%)',
                border: '1px solid var(--border-subtle, rgba(255, 255, 255, 0.08))',
                borderRadius: '16px',
                padding: '24px',
                boxShadow: '0 8px 24px rgba(0, 0, 0, 0.35)',
              }}
            >
              {!embedded && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '18px' }}>
                  <div
                    style={{
                      width: '34px',
                      height: '34px',
                      borderRadius: '10px',
                      background: 'color-mix(in srgb, var(--accent-primary, #38bdf8) 12%, transparent)',
                      border: '1px solid color-mix(in srgb, var(--accent-primary, #38bdf8) 25%, transparent)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                    }}
                  >
                    <PlaySquare size={18} style={{ color: 'var(--accent-primary, #38bdf8)' }} />
                  </div>
                  <div>
                    <h4 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 800, color: 'var(--text-primary)' }}>
                      {t('drive.tab_playback_title')}
                    </h4>
                    <p style={{ margin: 0, fontSize: '0.83rem', color: 'var(--text-secondary)' }}>
                      {t('drive.tab_playback_desc')}
                    </p>
                  </div>
                </div>
              )}

              <div className="td-settings-subcard">
                <div className="td-switches-list">
                  <label className="td-switch-row">
                    <div>
                      <strong>{t('drive.remember_playback_position_title')}</strong>
                      <p>{t('drive.remember_playback_position_desc')}</p>
                    </div>
                    <input
                      type="checkbox"
                      checked={draft.rememberPlaybackPosition !== false}
                      onChange={(e) => patch({ rememberPlaybackPosition: e.target.checked })}
                    />
                  </label>

                  <label className="td-switch-row">
                    <div>
                      <strong>{t('drive.playback_data_saver_title')}</strong>
                      <p>{t('drive.playback_data_saver_desc')}</p>
                    </div>
                    <input
                      type="checkbox"
                      checked={draft.playbackDataSaver !== false}
                      onChange={(e) => patch({ playbackDataSaver: e.target.checked })}
                    />
                  </label>
                </div>

                <div
                  style={{
                    marginTop: '16px',
                    paddingTop: '16px',
                    borderTop: '1px solid rgba(255, 255, 255, 0.06)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '12px',
                    flexWrap: 'wrap',
                  }}
                >
                  <div>
                    <strong style={{ fontSize: '0.88rem', color: 'var(--text-primary)', display: 'block' }}>
                      {t('drive.playback_history_cache_title')}
                    </strong>
                    <p style={{ margin: '2px 0 0', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                      {t('drive.playback_history_cache_desc')}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handleClearPlaybackHistory}
                    disabled={clearingPlaybackHistory}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '6px',
                      padding: '6px 12px',
                      borderRadius: '8px',
                      background: clearedPlaybackSuccess ? 'rgba(34, 197, 94, 0.15)' : 'rgba(239, 68, 68, 0.12)',
                      border: clearedPlaybackSuccess ? '1px solid rgba(34, 197, 94, 0.35)' : '1px solid rgba(239, 68, 68, 0.3)',
                      color: clearedPlaybackSuccess ? '#86efac' : '#fca5a5',
                      fontSize: '0.78rem',
                      fontWeight: 600,
                      cursor: 'pointer',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    {clearingPlaybackHistory ? (
                      <Loader2 size={13} className="spin" />
                    ) : clearedPlaybackSuccess ? (
                      <Check size={13} />
                    ) : (
                      <Trash2 size={13} />
                    )}
                    <span>{clearedPlaybackSuccess ? t('drive.clear_playback_history_done') : t('drive.clear_playback_history')}</span>
                  </button>
                </div>
              </div>

              <p className="td-xfer-hint" style={{ marginTop: '14px', fontSize: '0.78rem', color: '#64748b' }}>
                {t('drive.playback_hint_shortcut')}
              </p>
            </div>
          </div>
  ) : null;
}
