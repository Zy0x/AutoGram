import { Activity, Bookmark, CheckCircle2, ChevronDown, Download, Plus, RotateCcw, Save, ShieldAlert, SlidersHorizontal, Sparkles, Trash2, Upload, X } from 'lucide-react';

export function AdvancedSettingsSection({ activeTab, ctx }: { activeTab: string; ctx: Record<string, any> }) {
  const {
    t, draft, patch, triggerCaptionToast, setShowResetConfirm, activeTab: currentTab,
    applyPreset, profiles, profileName, selectedProfileId, isDropdownOpen,
    showPresetDrawer, setShowPresetDrawer, activePresetId, SYSTEM_TRANSFER_PRESETS,
    setSelectedProfileId, setProfileName,
    setIsDropdownOpen, dropdownDirection, triggerRef, toggleDropdown,
    loadProfile, saveProfile, deleteProfile, transferActive,
  } = ctx;
  void currentTab;
  return (
    <>
      {activeTab === 'advanced' && (
          <div className="td-xfer-focused-panel" id="section-advanced-main" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            {/* 1. SINKRONISASI & PERILAKU SESI */}
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
                  <SlidersHorizontal size={18} style={{ color: '#38bdf8' }} />
                </div>
                <div>
                  <h4 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 800, color: '#f8fafc' }}>
                    {t('ui.generated.1_sinkronisasi_perilaku_sesi_18b0462')}
                  </h4>
                  <p style={{ margin: 0, fontSize: '0.83rem', color: '#94a3b8' }}>
                    {t('ui.generated.konfigurasi_pembaruan_tampilan_otomatis_dan_retr_1b4ee7d')}
                  </p>
                </div>
              </div>

              <div className="td-switches-list">
                <label className="td-switch-row">
                  <div>
                    <strong>{t('ui.generated.sinkronisasi_tampilan_setelah_upload_c71a159')}</strong>
                    <p>{t('ui.generated.otomatis_memperbarui_daftar_file_obrolan_telegra_cd476e0')}</p>
                  </div>
                  <input
                    type="checkbox"
                    checked={draft.refreshAfterUpload ?? true}
                    disabled={!!transferActive}
                    onChange={(e) => patch({ refreshAfterUpload: e.target.checked })}
                  />
                </label>

                <label className="td-switch-row">
                  <div>
                    <strong>{t('ui.generated.auto_retry_jaringan_saat_connection_timeout_fc83e89')}</strong>
                    <p>{t('ui.generated.otomatis_mencoba_kembali_hingga_3x_jika_koneksi__349891c')}</p>
                  </div>
                  <input
                    type="checkbox"
                    checked={draft.autoRetryOnNetworkError ?? true}
                    disabled={!!transferActive}
                    onChange={(e) => patch({ autoRetryOnNetworkError: e.target.checked })}
                  />
                </label>

                <label className="td-switch-row">
                  <div>
                    <strong>{t('ui.generated.smart_rate_control_penanganan_floodwait_6bd3236')}</strong>
                    <p>{t('ui.generated.deteksi_otomatis_floodwaiterror_dari_api_telegra_baa76cc')}</p>
                  </div>
                  <input
                    type="checkbox"
                    checked={draft.smartRateControlEnabled ?? true}
                    disabled={!!transferActive}
                    onChange={(e) => patch({ smartRateControlEnabled: e.target.checked })}
                  />
                </label>
              </div>
            </div>

            {/* 2. FILTER & TAMPILAN KONTEN DRIVE */}
            <div
              id="section-hide-restricted-media"
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
                    background: 'rgba(239, 68, 68, 0.12)',
                    border: '1px solid rgba(239, 68, 68, 0.25)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}
                >
                  <ShieldAlert size={18} style={{ color: '#f87171' }} />
                </div>
                <div>
                  <h4 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 800, color: '#f8fafc' }}>
                    {t('drive.hide_restricted_media_section_title')}
                  </h4>
                  <p style={{ margin: 0, fontSize: '0.83rem', color: '#94a3b8' }}>
                    {t('drive.hide_restricted_media_section_subtitle')}
                  </p>
                </div>
              </div>

              <div className="td-switches-list">
                <label className="td-switch-row">
                  <div>
                    <strong>{t('drive.hide_restricted_media_title')}</strong>
                    <p>{t('drive.hide_restricted_media_desc')}</p>
                  </div>
                  <input
                    type="checkbox"
                    checked={draft.hideRestrictedMedia ?? true}
                    disabled={!!transferActive}
                    onChange={(e) => patch({ hideRestrictedMedia: e.target.checked })}
                  />
                </label>
                <label className="td-switch-row">
                  <div>
                    <strong>{t('drive.remote_hide_manifests_title')}</strong>
                    <p>{t('drive.remote_hide_manifests_desc')}</p>
                  </div>
                  <input
                    type="checkbox"
                    checked={draft.remoteHideManifests !== false}
                    disabled={!!transferActive}
                    onChange={(e) => patch({ remoteHideManifests: e.target.checked })}
                  />
                </label>
              </div>
            </div>

            {/* 3. EKSPOR & IMPOR KONFIGURASI (BACKUP / RESTORE) */}
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
                    {t('ui.generated.3_ekspor_impor_konfigurasi_backup_restore_e4087b9')}
                  </h4>
                  <p style={{ margin: 0, fontSize: '0.83rem', color: '#94a3b8' }}>
                    {t('ui.generated.cadangkan_seluruh_profil_pengaturan_transfer_ke__be6f6c5')}
                  </p>
                </div>
              </div>

              <div style={{ display: 'flex', gap: '12px', marginTop: '12px' }}>
                <button
                  type="button"
                  className="td-chip-btn"
                  onClick={() => {
                    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(draft, null, 2));
                    const downloadAnchor = document.createElement('a');
                    downloadAnchor.setAttribute("href", dataStr);
                    downloadAnchor.setAttribute("download", `autogram-transfer-settings-${new Date().toISOString().slice(0, 10)}.json`);
                    document.body.appendChild(downloadAnchor);
                    downloadAnchor.click();
                    downloadAnchor.remove();
                    triggerCaptionToast('📥 Konfigurasi berhasil diekspor!');
                  }}
                  style={{ background: 'rgba(56, 189, 248, 0.15)', color: '#38bdf8', border: '1px solid rgba(56, 189, 248, 0.3)', padding: '8px 16px', fontSize: '12px' }}
                >
                  <Download size={15} />
                  <span>{t('ui.generated.ekspor_konfigurasi_json_51d3bc2')}</span>
                </button>

                <label
                  className="td-chip-btn"
                  style={{ background: 'rgba(168, 85, 247, 0.15)', color: '#c084fc', border: '1px solid rgba(168, 85, 247, 0.3)', padding: '8px 16px', fontSize: '12px', cursor: 'pointer' }}
                >
                  <Upload size={15} />
                  <span>{t('ui.generated.impor_konfigurasi_json_7a2ac70')}</span>
                  <input
                    type="file"
                    accept=".json"
                    style={{ display: 'none' }}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) {
                        const reader = new FileReader();
                        reader.onload = (event) => {
                          try {
                            const imported = JSON.parse(event.target?.result as string);
                            if (imported && typeof imported === 'object') {
                              patch(imported);
                              triggerCaptionToast('📤 Konfigurasi berhasil diimpor!');
                            }
                          } catch {
                            triggerCaptionToast('❌ Gagal membaca file JSON');
                          }
                        };
                        reader.readAsText(file);
                      }
                    }}
                  />
                </label>
              </div>
            </div>

            {/* 4. DIAGNOSTIK & LOGGING SISTEM */}
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
                  <Activity size={18} style={{ color: '#38bdf8' }} />
                </div>
                <div>
                  <h4 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 800, color: '#f8fafc' }}>
                    {t('ui.generated.4_diagnostik_log_sistem_13e7eee')}
                  </h4>
                  <p style={{ margin: 0, fontSize: '0.83rem', color: '#94a3b8' }}>
                    {t('ui.generated.opsi_pelacakan_detail_transaksi_teknis_untuk_pem_07becf1')}
                  </p>
                </div>
              </div>

              <div className="td-switches-list">
                <label className="td-switch-row">
                  <div>
                    <strong>{t('ui.generated.mode_debug_logging_verbose_logs_b4e437d')}</strong>
                    <p>{t('ui.generated.tampilkan_log_teknis_detail_dari_aktivitas_mtpro_30943cd')}</p>
                  </div>
                  <input
                    type="checkbox"
                    checked={draft.debugLoggingEnabled ?? false}
                    disabled={!!transferActive}
                    onChange={(e) => patch({ debugLoggingEnabled: e.target.checked })}
                  />
                </label>
              </div>
            </div>

            {/* 5. RESET TOTAL SELURUH PENGATURAN SYSTEM */}
            <div className="td-settings-card" style={{ borderColor: 'rgba(239, 68, 68, 0.35)', background: 'rgba(239, 68, 68, 0.05)' }}>
              <div className="td-card-head">
                <RotateCcw size={18} style={{ color: '#f87171' }} />
                <div>
                  <h4 style={{ color: '#f87171' }}>{t('ui.generated.reset_total_seluruh_pengaturan_system_4daa4d2')}</h4>
                  <p>{t('ui.generated.kembalikan_seluruh_parameter_konfigurasi_transfe_0b5e4d6')}</p>
                </div>
              </div>

              <div style={{ marginTop: '14px' }}>
                <button
                  type="button"
                  className="td-chip-btn td-chip-danger"
                  onClick={() => setShowResetConfirm(true)}
                  disabled={!!transferActive}
                  style={{ padding: '10px 20px', fontSize: '13px', display: 'inline-flex', alignItems: 'center', gap: '8px' }}
                >
                  <RotateCcw size={15} />
                  <span>{t('ui.generated.reset_total_semua_pengaturan_system_268e487')}</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* PROFILES DRAWER / MODAL OVERLAY */}
        {showPresetDrawer && (
          <div className="td-xfer-confirm-overlay" role="presentation" onClick={() => setShowPresetDrawer(false)}>
            <div className="td-xfer-drawer-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
              <div className="td-drawer-head">
                <div className="td-drawer-head-left">
                  <Sparkles size={18} className="td-preset-sparkle" />
                  <h4>{t('drive.transfer_profiles_title')}</h4>
                </div>
                <button
                  type="button"
                  className="td-chip-btn"
                  onClick={() => setShowPresetDrawer(false)}
                >
                  <X size={16} />
                </button>
              </div>

              <div className="td-drawer-body">
                {/* 3 PRESET CARDS */}
                <h5 className="td-drawer-section-title">{t('ui.generated.pilih_preset_siap_pakai_1e9d594')}</h5>
                <div className="td-hero-presets-grid">
                  {SYSTEM_TRANSFER_PRESETS.map((preset: any) => {
                    const isSelected = activePresetId === preset.id;
                    return (
                      <div
                        key={preset.id}
                        className={`td-hero-preset-card ${isSelected ? 'is-selected' : ''}`}
                        onClick={() => {
                          applyPreset(preset.settings);
                          setShowPresetDrawer(false);
                        }}
                      >
                        <div className="td-hero-card-top">
                          <h4>{preset.name}</h4>
                          {isSelected && <CheckCircle2 size={16} className="td-selected-check" />}
                        </div>
                        <p className="td-hero-card-desc">{preset.description}</p>
                      </div>
                    );
                  })}
                </div>

                {/* USER PROFILES PERSISTENCE MANAGER */}
                <h5 className="td-drawer-section-title" style={{ marginTop: '22px' }}>{t('ui.generated.manajemen_profil_tersimpan_31a53ba')}</h5>
                <div className="td-profile-mgr-card">
                  <div className="td-profile-row">
                    {/* CUSTOM GLASSMORPHIC PROFILE SELECTOR */}
                    <div className="td-custom-select-container">
                      <button
                        ref={triggerRef}
                        type="button"
                        className={`td-custom-select-trigger ${isDropdownOpen ? 'is-active' : ''}`}
                        onClick={toggleDropdown}
                        disabled={!!transferActive}
                      >
                        <div className="td-trigger-left">
                          <Bookmark size={15} className="td-trigger-icon" />
                          <span className="td-trigger-text">
                            {selectedProfileId
                              ? profiles.find((p: any) => p.id === selectedProfileId)?.name || t('ui.generated.profil_kustom_bade686')
                              : t('drive.transfer_profiles_new')}
                          </span>
                        </div>
                        <ChevronDown size={14} className={`td-trigger-chevron ${isDropdownOpen ? 'is-open' : ''}`} />
                      </button>

                      {/* FLOATING GLASSMORPHIC MENU */}
                      {isDropdownOpen && (
                        <>
                          <div className="td-select-backdrop" onClick={() => setIsDropdownOpen(false)} />
                          <div className={`td-custom-select-menu ${dropdownDirection === 'up' ? 'open-upward' : 'open-downward'}`}>
                            <div
                              className={`td-select-option ${!selectedProfileId ? 'is-selected' : ''}`}
                              onClick={() => {
                                setSelectedProfileId('');
                                setProfileName('');
                                setIsDropdownOpen(false);
                              }}
                            >
                              <Plus size={14} className="td-opt-icon" />
                              <span>{t('drive.transfer_profiles_new')}</span>
                            </div>

                            <div className="td-select-divider" />

                            <div className="td-select-scroll-area">
                              {profiles.length > 0 ? (
                                profiles.map((p: any) => {
                                  const isSelected = selectedProfileId === p.id;
                                  return (
                                    <div
                                      key={p.id}
                                      className={`td-select-option ${isSelected ? 'is-selected' : ''}`}
                                      onClick={() => {
                                        loadProfile(p.id);
                                        setIsDropdownOpen(false);
                                      }}
                                    >
                                      <Bookmark size={14} className="td-opt-icon" />
                                      <span className="td-opt-name">{p.name}</span>
                                      {isSelected && <CheckCircle2 size={13} className="td-opt-check" />}
                                    </div>
                                  );
                                })
                              ) : (
                                <div className="td-select-empty">{t('ui.generated.belum_ada_profil_tersimpan_1f0da59')}</div>
                              )}
                            </div>
                          </div>
                        </>
                      )}
                    </div>

                    {/* PROFILE NAME INPUT */}
                    <div className="td-profile-input-wrapper">
                      <input
                        value={profileName}
                        maxLength={80}
                        disabled={!!transferActive}
                        onChange={(e) => setProfileName(e.target.value)}
                        placeholder={t('drive.transfer_profiles_name')}
                        className="td-modern-profile-input"
                      />
                    </div>
                  </div>

                  <div className="td-profile-actions">
                    <button
                      type="button"
                      className="td-chip-btn td-chip-primary"
                      onClick={() => {
                        saveProfile();
                        setIsDropdownOpen(false);
                      }}
                      disabled={!!transferActive || !profileName.trim()}
                    >
                      <Save size={14} /> {selectedProfileId ? t('ui.generated.update_profil_9912b6e') : t('ui.generated.simpan_profil_baru_aa5b30a')}
                    </button>
                    {selectedProfileId && (
                      <button
                        type="button"
                        className="td-chip-btn td-chip-danger"
                        onClick={() => {
                          deleteProfile();
                          setIsDropdownOpen(false);
                        }}
                        disabled={!!transferActive}
                      >
                        <Trash2 size={14} /> {t('drive.transfer_profiles_delete')}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
      )}
    </>
  );
}
