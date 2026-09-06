import { Download, Gauge, ShieldCheck, Zap } from 'lucide-react';

export function DownloadSettingsSection({ activeTab, ctx }: { activeTab: string; ctx: Record<string, any> }) {
  const { t, draft, patch, transferActive } = ctx;
  return activeTab === 'download' ? (
          <div className="td-xfer-focused-panel" id="section-download-performance">
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
                  <Download size={18} style={{ color: '#38bdf8' }} />
                </div>
                <div>
                  <h4 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 800, color: '#f8fafc' }}>
                    1. {t('drive.tab_download_title')}
                  </h4>
                  <p style={{ margin: 0, fontSize: '0.83rem', color: '#94a3b8' }}>
                    {t('drive.tab_download_desc')}
                  </p>
                </div>
              </div>

              {/* SUB-SECTION: PARALEL UNDUHAN */}
              <div className="td-settings-subcard">
                <label className="td-field-label">{t('ui.generated.jumlah_unduhan_paralel_download_slots_53a87b8')}</label>
                <div className="td-slider-row-box">
                  <input
                    type="range"
                    min={1}
                    max={10}
                    value={draft.downloadConcurrency}
                    disabled={!!transferActive}
                    onChange={(e) => patch({ downloadConcurrency: Number(e.target.value) })}
                  />
                  <div className="td-slider-value-bar">
                    <span className="td-slider-val">{draft.downloadConcurrency} {t('drive.tab_telegram_files')}</span>
                    <span className={`td-concurrency-badge tier-${draft.downloadConcurrency <= 2 ? 'stable' : draft.downloadConcurrency <= 6 ? 'balanced' : 'high-speed'}`}>
                      {draft.downloadConcurrency <= 2 && (
                        <>
                          <ShieldCheck size={11} strokeWidth={2.2} />
                          <span>{t('drive_tools.concurrency_badge_stable')}</span>
                        </>
                      )}
                      {draft.downloadConcurrency >= 3 && draft.downloadConcurrency <= 6 && (
                        <>
                          <Gauge size={11} strokeWidth={2.2} />
                          <span>{t('drive_tools.concurrency_badge_balanced')}</span>
                        </>
                      )}
                      {draft.downloadConcurrency >= 7 && (
                        <>
                          <Zap size={11} strokeWidth={2.2} />
                          <span>{t('drive_tools.concurrency_badge_high_speed')}</span>
                        </>
                      )}
                    </span>
                  </div>
                </div>
              </div>

              {/* SUB-SECTION: KONFLIK FILE & KEANDALAN */}
              <div className="td-settings-subcard" style={{ marginTop: '16px' }}>
                <label className="td-field-label">{t('ui.generated.kebijakan_konflik_nama_berkas_di_komputer_cccc51f')}</label>
                <select
                  value={draft.downloadConflictPolicy || 'ask'}
                  disabled={!!transferActive}
                  onChange={(e) => patch({ downloadConflictPolicy: e.target.value as any })}
                  style={{ width: '100%', height: '40px', padding: '0 12px', borderRadius: '10px', background: '#0f172a', border: '1px solid rgba(255, 255, 255, 0.12)', color: '#f8fafc' }}
                >
                  <option value="ask">{t('ui.generated.tanyakan_sebelum_mengunduh_3820b14')}</option>
                  <option value="rename">{t('ui.generated.ganti_nama_otomatis_tambah_angka_a0d1700')}</option>
                  <option value="overwrite">{t('ui.generated.timpa_berkas_yang_ada_9047d33')}</option>
                  <option value="skip">{t('ui.generated.lewati_berkas_99bd0e6')}</option>
                </select>

                <div className="td-switches-list" style={{ marginTop: '16px' }}>
                  <label className="td-switch-row">
                    <div>
                      <strong>{t('ui.generated.lanjutkan_unduhan_parsial_resume_bf66f33')}</strong>
                      <p>{t('ui.generated.lanjutkan_unduhan_yang_terputus_tanpa_mulai_dari_bc66c48')}</p>
                    </div>
                    <input
                      type="checkbox"
                      checked={draft.downloadResumePartial ?? true}
                      disabled={!!transferActive}
                      onChange={(e) => patch({ downloadResumePartial: e.target.checked })}
                    />
                  </label>

                  <label className="td-switch-row">
                    <div>
                      <strong>{t('ui.generated.notifikasi_setelah_unduhan_selesai_1e18950')}</strong>
                      <p>{t('ui.generated.tampilkan_pemberitahuan_banner_saat_batch_unduha_2eb7249')}</p>
                    </div>
                    <input
                      type="checkbox"
                      checked={draft.notifyDownloadDone}
                      disabled={!!transferActive}
                      onChange={(e) => patch({ notifyDownloadDone: e.target.checked })}
                    />
                  </label>

                </div>
              </div>
            </div>
          </div>
  ) : null;
}
