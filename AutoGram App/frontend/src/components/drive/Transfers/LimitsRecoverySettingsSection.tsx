import { AlertTriangle, Film, HardDriveUpload, Sliders, Zap } from 'lucide-react';

export function LimitsRecoverySettingsSection({ activeTab, ctx }: { activeTab: string; ctx: Record<string, any> }) {
  const { t, draft, patch, transferActive, availableSessions, getSessionMetadata } = ctx;
  return activeTab === 'limits_recovery' ? (
          <div className="td-xfer-focused-panel" id="section-limits-recovery">
            <div
              className="td-settings-card"
              style={{
                background: 'linear-gradient(150deg, rgba(15, 22, 36, 0.8) 0%, rgba(8, 12, 22, 0.95) 100%)',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                borderRadius: '16px',
                padding: '24px',
                boxShadow: '0 8px 24px rgba(0, 0, 0, 0.35)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '18px' }}>
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
                  <HardDriveUpload size={18} style={{ color: '#38bdf8' }} />
                </div>
                <div>
                  <h4 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 800, color: '#f8fafc' }}>
                    1. {t('drive.oversize_title')}
                  </h4>
                  <p style={{ margin: 0, fontSize: '0.83rem', color: '#94a3b8' }}>
                    {t('drive.oversize_desc')}
                  </p>
                </div>
              </div>

              {/* 1. MASTER STRATEGY SELECTION (5-SECOND READABILITY) */}
              <div className="td-encoder-4x-grid" style={{ marginTop: '16px' }}>
                {/* AUTO ADAPTIVE SMART ENGINE (PRIMARY MASTER TILE) */}
                <label className={`td-encoder-tile ${(!draft.oversizeAction || draft.oversizeAction === 'auto_adaptive') ? 'is-selected' : ''}`}>
                  <input
                    type="radio"
                    name="oversizeAction"
                    value="auto_adaptive"
                    checked={!draft.oversizeAction || draft.oversizeAction === 'auto_adaptive'}
                    disabled={!!transferActive}
                    onChange={() => patch({ oversizeAction: 'auto_adaptive' })}
                  />
                  <div>
                    <div className="td-tile-head">
                      <Zap size={16} className="td-tile-icon is-auto" />
                      <strong>{t('drive.oversize_auto_title')}</strong>
                    </div>
                    <p>{t('drive.oversize_auto_desc')}</p>
                  </div>
                </label>

                {/* MANUAL OVERRIDE SELECTION */}
                <label className={`td-encoder-tile ${draft.oversizeAction !== 'auto_adaptive' ? 'is-selected' : ''}`}>
                  <input
                    type="radio"
                    name="oversizeAction"
                    value="split"
                    checked={draft.oversizeAction !== 'auto_adaptive'}
                    disabled={!!transferActive}
                    onChange={() => patch({ oversizeAction: 'split' })}
                  />
                  <div>
                    <div className="td-tile-head">
                      <Sliders size={16} className="td-tile-icon is-disable" />
                      <strong>{t('drive.oversize_manual_title')}</strong>
                    </div>
                    <p>{t('drive.oversize_manual_desc')}</p>
                  </div>
                </label>
              </div>

              {/* 2. COLLAPSIBLE MANUAL STRATEGY OPTIONS (IF MANUAL SELECTED) */}
              {draft.oversizeAction !== 'auto_adaptive' && (
                <div style={{ marginTop: '20px', borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: '16px' }}>
                  <h5 style={{ color: '#f8fafc', fontSize: '13px', fontWeight: 600, marginBottom: '12px' }}>
                    {t('drive.oversize_manual_heading')}
                  </h5>

                  <div className="td-encoder-4x-grid">
                    {/* FIT TO LIMIT */}
                    <label className={`td-encoder-tile ${draft.oversizeAction === 'fit_to_limit' ? 'is-selected' : ''}`}>
                      <input
                        type="radio"
                        name="manualOversizeAction"
                        value="fit_to_limit"
                        checked={draft.oversizeAction === 'fit_to_limit'}
                        disabled={!!transferActive}
                        onChange={() => patch({ oversizeAction: 'fit_to_limit' })}
                      />
                      <div>
                        <div className="td-tile-head">
                          <Zap size={16} className="td-tile-icon is-auto" />
                          <strong>{t('drive.oversize_fit_title')}</strong>
                        </div>
                        <p>{t('drive.oversize_fit_desc')}</p>
                      </div>
                    </label>

                    {/* SPLIT */}
                    <label className={`td-encoder-tile ${draft.oversizeAction === 'split' ? 'is-selected' : ''}`}>
                      <input
                        type="radio"
                        name="manualOversizeAction"
                        value="split"
                        checked={draft.oversizeAction === 'split'}
                        disabled={!!transferActive}
                        onChange={() => patch({ oversizeAction: 'split' })}
                      />
                      <div>
                        <div className="td-tile-head">
                          <Sliders size={16} className="td-tile-icon is-auto" />
                          <strong>{t('drive.oversize_split_title')}</strong>
                        </div>
                        <p>{t('drive.oversize_split_desc_new')}</p>
                      </div>
                    </label>

                    {/* ALTERNATE ACCOUNT */}
                    <label className={`td-encoder-tile ${draft.oversizeAction === 'alternate_account' ? 'is-selected' : ''}`}>
                      <input
                        type="radio"
                        name="manualOversizeAction"
                        value="alternate_account"
                        checked={draft.oversizeAction === 'alternate_account'}
                        disabled={!!transferActive}
                        onChange={() => patch({ oversizeAction: 'alternate_account' })}
                      />
                      <div>
                        <div className="td-tile-head">
                          <Film size={16} className="td-tile-icon is-gpu" />
                          <strong>{t('drive.oversize_pool_title')}</strong>
                        </div>
                        <p>{t('drive.oversize_pool_desc')}</p>
                      </div>
                    </label>

                    {/* SKIP */}
                    <label className={`td-encoder-tile ${draft.oversizeAction === 'skip' ? 'is-selected' : ''}`}>
                      <input
                        type="radio"
                        name="manualOversizeAction"
                        value="skip"
                        checked={draft.oversizeAction === 'skip'}
                        disabled={!!transferActive}
                        onChange={() => patch({ oversizeAction: 'skip' })}
                      />
                      <div>
                        <div className="td-tile-head">
                          <Sliders size={16} className="td-tile-icon is-disable" />
                          <strong>{t('drive.oversize_skip_title')}</strong>
                        </div>
                        <p>{t('drive.oversize_skip_desc_new')}</p>
                      </div>
                    </label>
                  </div>
                </div>
              )}

              {/* 2. ALTERNATE ACCOUNT ROUTING SUBSECTION */}
              {draft.oversizeAction === 'alternate_account' && (
                <div className="td-conditional-box" style={{ marginTop: '20px' }}>
                  <div className="td-field-group" style={{ marginBottom: '16px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                      <label className="td-field-label" style={{ margin: 0 }}>
                        {t('drive.oversize_pool_label')}
                      </label>
                      <span style={{ fontSize: '11px', color: '#38bdf8', fontWeight: 600 }}>
                        {t('ui.generated.hanya_akun_berlangganan_telegram_premium_limit_4_be2f015')}
                      </span>
                    </div>

                    {/* INTERACTIVE PREMIUM SESSIONS CHIPS & SELECTOR */}
                    <div style={{ background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '8px', padding: '12px' }}>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '10px' }}>
                        {availableSessions.length > 0 ? (
                          availableSessions.map((sess: any) => {
                            const isSelected = (draft.alternateAccountPool || '').split(',').map((s: string) => s.trim()).includes(sess.name);
                            const meta = getSessionMetadata(sess.name);
                            
                            // Construct clean, non-redundant label: "Name (@username)" or "Name" or "@username" or sess.name
                            let cleanLabel = sess.name;
                            if (meta?.userFullName && meta?.username) {
                              const u = meta.username.startsWith('@') ? meta.username : `@${meta.username}`;
                              cleanLabel = `${meta.userFullName.trim()} (${u})`;
                            } else if (meta?.userFullName) {
                              cleanLabel = meta.userFullName.trim();
                            } else if (meta?.username) {
                              cleanLabel = meta.username.startsWith('@') ? meta.username : `@${meta.username}`;
                            } else if (sess.label) {
                              cleanLabel = sess.label;
                            }

                            // Strict session status & Premium accuracy checks
                            const isProblematic = sess.status === 'error' || sess.status === 'expired' || sess.status === 'revoked' || sess.status === 'unauthorized';
                            // ONLY explicit true counts as verified Premium
                            const isPremium = meta?.isPremium === true || (meta as any)?.is_premium === true;

                            if (isProblematic) {
                              return (
                                <div
                                  key={sess.name}
                                  style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '6px',
                                    background: 'rgba(239, 68, 68, 0.1)',
                                    border: '1px solid rgba(239, 68, 68, 0.3)',
                                    color: '#fca5a5',
                                    padding: '6px 12px',
                                    borderRadius: '20px',
                                    fontSize: '12px',
                                    cursor: 'not-allowed',
                                    opacity: 0.7,
                                  }}
                                  title={t('ui.generated.sesi_ini_bermasalah_atau_expired_tidak_dapat_dig_bf5427d')}
                                >
                                  <span>🔴</span>
                                  <strong style={{ color: '#fca5a5' }}>{cleanLabel}</strong>
                                  <span style={{ color: '#ef4444', fontSize: '10px', fontWeight: 600 }}>{t('ui.generated.bermasalah_20b37d7')}</span>
                                </div>
                              );
                            }

                            // NON-PREMIUM (DEFAULT FOR FREE ACCOUNTS) -> Render Standard 2GB
                            if (!isPremium) {
                              return (
                                <div
                                  key={sess.name}
                                  style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '6px',
                                    background: 'rgba(255,255,255,0.02)',
                                    border: '1px solid rgba(255,255,255,0.06)',
                                    color: '#94a3b8',
                                    padding: '6px 12px',
                                    borderRadius: '20px',
                                    fontSize: '12px',
                                    cursor: 'not-allowed',
                                    opacity: 0.65,
                                  }}
                                  title={t('ui.generated.akun_standar_gratis_hanya_mendukung_batas_2_gb_h_f0cf918')}
                                >
                                  <span>⚪</span>
                                  <span>{cleanLabel}</span>
                                  <span style={{ fontSize: '9px', background: 'rgba(255,255,255,0.05)', color: '#64748b', padding: '1px 5px', borderRadius: '4px', marginLeft: '4px' }}>
                                    {t('ui.generated.standar_2gb_non_premium_806fe3e')}
                                  </span>
                                </div>
                              );
                            }

                            return (
                              <button
                                key={sess.name}
                                type="button"
                                disabled={!!transferActive}
                                onClick={() => {
                                  const current = (draft.alternateAccountPool || '').split(',').map((s: string) => s.trim()).filter(Boolean);
                                  const next = isSelected ? current.filter((c: string) => c !== sess.name) : [...current, sess.name];
                                  patch({ alternateAccountPool: next.join(', ') });
                                }}
                                style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '6px',
                                  background: isSelected ? 'rgba(56, 189, 248, 0.2)' : 'rgba(255,255,255,0.04)',
                                  border: isSelected ? '1px solid #38bdf8' : '1px solid rgba(255,255,255,0.1)',
                                  color: isSelected ? '#38bdf8' : '#e2e8f0',
                                  padding: '6px 12px',
                                  borderRadius: '20px',
                                  fontSize: '12px',
                                  cursor: 'pointer',
                                  fontWeight: 500,
                                  transition: 'all 0.15s ease',
                                }}
                              >
                                <span>💎</span>
                                <strong style={{ color: isSelected ? '#38bdf8' : '#f8fafc' }}>
                                  {cleanLabel}
                                </strong>
                                <span style={{ fontSize: '10px', background: 'rgba(56,189,248,0.15)', color: '#38bdf8', padding: '1px 6px', borderRadius: '4px', marginLeft: '4px' }}>
                                  {t('ui.generated.premium_4gb_9f5be98')}
                                </span>
                              </button>
                            );
                          })
                        ) : (
                          <div style={{ fontSize: '12px', color: '#94a3b8', padding: '4px 0' }}>
                            {t('ui.generated.belum_ada_sesi_terdeteksi_secara_otomatis_silaka_1adac26')}
                          </div>
                        )}
                      </div>

                      {/* RAW INPUT FALLBACK */}
                      <input
                        type="text"
                        value={draft.alternateAccountPool || ''}
                        disabled={!!transferActive}
                        placeholder={t('ui.generated.atau_ketik_nama_sesi_tambahan_dipisah_koma_conto_bd5a6e4')}
                        onChange={(e) => patch({ alternateAccountPool: e.target.value })}
                        style={{ fontSize: '12px', padding: '8px 10px', width: '100%' }}
                      />

                      {/* NO PREMIUM SESSIONS DETECTED WARNING BANNER */}
                      {(() => {
                        const hasPremiumSession = availableSessions.some((sess: any) => {
                          const meta = getSessionMetadata(sess.name);
                          const isPremium = meta?.isPremium === true || (meta as any)?.is_premium === true;
                          const isProblematic = sess.status === 'error' || sess.status === 'expired' || sess.status === 'revoked' || sess.status === 'unauthorized';
                          return isPremium && !isProblematic;
                        });
                        if (hasPremiumSession) return null;
                        return (
                          <div
                            style={{
                              marginTop: '12px',
                              padding: '12px 14px',
                              background: 'rgba(245, 158, 11, 0.08)',
                              border: '1px solid rgba(245, 158, 11, 0.25)',
                              borderRadius: '8px',
                              fontSize: '12px',
                              color: '#fbbf24',
                              lineHeight: 1.5,
                            }}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 600, marginBottom: '4px' }}>
                              <AlertTriangle size={15} color="#f59e0b" />
                              <span>{t('ui.generated.sistem_informasi_tidak_ada_akun_premium_aktif_sa_d22e47d')}</span>
                            </div>
                            <p style={{ margin: 0, color: '#cbd5e1', fontSize: '11px' }}>
                              {t('ui.generated.seluruh_sesi_terhubung_adalah_20bd1da')} <strong>{t('ui.generated.akun_standar_limit_2_gb_be2ff4a')}</strong>. Jika terdapat berkas berukuran &gt; 2 GB, pengunggahan utuh 4 GB tidak dapat dilakukan lewat pool ini. Sistem akan otomatis beralih ke skenario cadangan <strong>{t('ui.generated.pecah_berkas_split_parts_2_gb_ed7053d')}</strong> {t('ui.generated.atau_a713ae9')} <strong>{t('ui.generated.fit_to_limit_video_bitrate_compress_da6fbd4')}</strong> {t('ui.generated.agar_transfer_tetap_berhasil_tanpa_error_limit_t_ede2eb0')}
                            </p>
                          </div>
                        );
                      })()}
                    </div>
                  </div>

                  <div className="td-form-row-grid">
                    <div className="td-field-group">
                      <label className="td-field-label">{t('drive.oversize_strategy_label')}</label>
                      <select
                        value={draft.albumAlternateStrategy || 'cancel_group'}
                        disabled={!!transferActive}
                        onChange={(e) => patch({ albumAlternateStrategy: e.target.value as any })}
                      >
                        <option value="cancel_group">{t('ui.generated.batal_kirim_album_oversize_rekomendasi_aman_8d16b45')}</option>
                        <option value="separate_item">{t('ui.generated.pisahkan_berkas_oversize_keluar_dari_album_41e0701')}</option>
                        <option value="move_whole_group">{t('ui.generated.pindahkan_seluruh_album_ke_akun_premium_b8f3bb2')}</option>
                      </select>
                    </div>
                  </div>

                  <label className="td-switch-row" style={{ marginTop: '16px' }}>
                    <div>
                      <strong>{t('drive.oversize_approved_toggle')}</strong>
                      <p>{t('drive.oversize_approved_desc')}</p>
                    </div>
                    <input
                      type="checkbox"
                      checked={Boolean(draft.alternateIdentityApproved)}
                      disabled={!!transferActive}
                      onChange={(e) => patch({ alternateIdentityApproved: e.target.checked })}
                    />
                  </label>
                </div>
              )}
            </div>
          </div>
  ) : null;
}
