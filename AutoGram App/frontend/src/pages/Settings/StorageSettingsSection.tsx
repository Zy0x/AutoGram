import { AlertTriangle, CheckCircle, Folder, Loader2, RotateCw, Sliders, SlidersHorizontal, Trash2 } from 'lucide-react';
import { CACHE_LIMIT_STEPS } from './settingsUtils';

type StorageSettingsSectionProps = Record<string, any>;

export function StorageSettingsSection(props: StorageSettingsSectionProps) {
  const {
    t,
    cacheBreakdown,
    customCacheInfo,
    isCustomModalOpen,
    customInputValue,
    customUnit,
    setIsCustomModalOpen,
    setCustomInputValue,
    setCustomUnit,
    handleSaveCustomLimit,
    handleBrowseCacheFolder,
    setIsResetModalOpen,
    freeDiskBytes,
    isDiskLow,
    isCacheExceedingDiskSpace,
    isLimitExceedsDisk,
    isCacheExceedingLimit,
    excessBytes,
    selectedLimitBytes,
    isCalculating,
    calculateCacheSize,
    isTrimming,
    isClearing,
    isClearingDb,
    clearStatus,
    clearSummary,
    formatBytes,
    isPurgingOrphans,
    handlePurgeOrphanedSessions,
    availableSessions,
    getActiveSessionTargets,
    getSessionMetadata,
    handleClearCache,
    handleClearDatabase,
    dbClearStatus,
    autoPruneEnabled,
    handleToggleAutoPrune,
    setIsSpecificModalOpen,
    currentStepIndex,
    handleSliderIndexChange,
    cacheSize,
    cacheLimitMB,
    formattedSize,
  } = props;

  return (
            <div className="glass-panel card settings-section-cache">
              <div className="card-header">
                <Trash2 size={20} color="var(--primary)" />
                <h3>{t('settings.cache_management')}</h3>
              </div>

              <p className="field-hint" style={{ marginBottom: '1.25rem', lineHeight: 1.5 }}>
                {t('settings.cache_management_desc')}
              </p>

              <div className="page-stack" style={{ gap: '1.25rem' }}>
                {/* LOKASI DIREKTORI CACHE KUSTOM */}
                <div
                  className="settings-custom-cache-panel"
                  style={{
                    background: 'rgba(56, 189, 248, 0.04)',
                    padding: '14px 16px',
                    borderRadius: '10px',
                    border: '1px solid rgba(56, 189, 248, 0.2)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '10px',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <Folder size={18} style={{ color: '#38bdf8' }} />
                      <strong style={{ fontSize: '0.9rem', color: '#f8fafc' }}>
                        {t('settings.custom_cache_location_title')}
                      </strong>
                    </div>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={handleBrowseCacheFolder}
                        style={{
                          padding: '6px 12px',
                          fontSize: '0.78rem',
                          fontWeight: 600,
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '6px',
                          borderColor: 'rgba(56, 189, 248, 0.35)',
                          background: 'rgba(56, 189, 248, 0.12)',
                          color: '#38bdf8',
                        }}
                      >
                        <Folder size={14} />
                        <span>{t('settings.custom_cache_browse_btn')}</span>
                      </button>

                      {customCacheInfo?.customPath && (
                        <button
                          type="button"
                          className="btn btn-secondary"
                          onClick={() => setIsResetModalOpen(true)}
                          style={{
                            padding: '6px 12px',
                            fontSize: '0.78rem',
                            fontWeight: 600,
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '6px',
                            color: '#f87171',
                            borderColor: 'rgba(239, 68, 68, 0.3)',
                            background: 'rgba(239, 68, 68, 0.1)',
                          }}
                        >
                          <RotateCw size={13} />
                          <span>{t('settings.custom_cache_reset_btn')}</span>
                        </button>
                      )}
                    </div>
                  </div>

                  <p style={{ margin: 0, fontSize: '0.76rem', color: '#94a3b8', lineHeight: 1.4 }}>
                    {t('settings.custom_cache_location_desc')}
                  </p>

                  {customCacheInfo?.isFallback && (
                    <div
                      style={{
                        padding: '8px 12px',
                        borderRadius: '8px',
                        background: 'rgba(239, 68, 68, 0.12)',
                        border: '1px solid rgba(239, 68, 68, 0.3)',
                        color: '#fca5a5',
                        fontSize: '0.76rem',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                      }}
                    >
                      <AlertTriangle size={15} style={{ flexShrink: 0 }} />
                      <span>{t('settings.custom_cache_fallback_warning')}</span>
                    </div>
                  )}

                  <div
                    style={{
                      background: 'rgba(0, 0, 0, 0.3)',
                      padding: '8px 12px',
                      borderRadius: '6px',
                      border: '1px solid rgba(255, 255, 255, 0.05)',
                      fontFamily: 'monospace',
                      fontSize: '0.78rem',
                      color: customCacheInfo?.customPath ? '#38bdf8' : '#94a3b8',
                      wordBreak: 'break-all',
                    }}
                  >
                    <span style={{ color: '#64748b', marginRight: '6px', fontFamily: 'sans-serif' }}>
                      {t('settings.custom_cache_current_path')}
                    </span>
                    {customCacheInfo?.activePath || t('settings.default_cache_path')}
                  </div>
                </div>

                <div
                  className="settings-cache-summary"
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '12px',
                    background: 'rgba(255, 255, 255, 0.03)',
                    padding: '14px 16px',
                    borderRadius: '10px',
                    border: '1px solid rgba(255, 255, 255, 0.06)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div>
                      <strong style={{ display: 'block', fontSize: '0.9rem', color: '#f8fafc' }}>
                        {t('settings.cache_size_label')}
                      </strong>
                      <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>
                        {isCalculating ? t('settings.calculating_cache') : t('settings.cache_size_desc')}
                      </span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={() => void calculateCacheSize()}
                        disabled={isCalculating}
                        style={{ padding: '6px 10px', fontSize: '0.78rem' }}
                        title={t('settings.refresh_cache_btn')}
                      >
                        <RotateCw size={13} className={isCalculating ? 'spin' : ''} />
                      </button>

                      <div
                        className="settings-cache-badge"
                        style={{
                          fontSize: '1rem',
                          fontWeight: 700,
                          color: '#38bdf8',
                          padding: '4px 12px',
                          borderRadius: '8px',
                          background: 'rgba(56, 189, 248, 0.1)',
                          border: '1px solid rgba(56, 189, 248, 0.25)',
                        }}
                      >
                        {formattedSize}
                      </div>
                    </div>
                  </div>

                  {/* Cache Breakdown Pills */}
                  {cacheBreakdown && (
                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
                        gap: '8px',
                        paddingTop: '6px',
                      }}
                    >
                      <div
                        style={{
                          background: 'rgba(56, 189, 248, 0.06)',
                          border: '1px solid rgba(56, 189, 248, 0.2)',
                          borderRadius: '8px',
                          padding: '8px 12px',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '3px',
                        }}
                      >
                        <span style={{ fontSize: '0.72rem', color: '#94a3b8', display: 'flex', alignItems: 'center', gap: '4px' }}>
                          📦 {t('settings.cache_breakdown_download')}
                        </span>
                        <strong style={{ fontSize: '0.9rem', color: '#38bdf8', fontWeight: 600 }}>
                          {formatBytes(cacheBreakdown.cacheBytes)}
                        </strong>
                      </div>

                      <div
                        style={{
                          background: 'rgba(168, 85, 247, 0.06)',
                          border: '1px solid rgba(168, 85, 247, 0.2)',
                          borderRadius: '8px',
                          padding: '8px 12px',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '3px',
                        }}
                      >
                        <span style={{ fontSize: '0.72rem', color: '#94a3b8', display: 'flex', alignItems: 'center', gap: '4px' }}>
                          🖼️ {t('settings.cache_breakdown_thumbs')}
                        </span>
                        <strong style={{ fontSize: '0.9rem', color: '#c084fc', fontWeight: 600 }}>
                          {formatBytes(cacheBreakdown.thumbsBytes)}
                        </strong>
                      </div>

                      <div
                        style={{
                          background: 'rgba(234, 179, 8, 0.06)',
                          border: '1px solid rgba(234, 179, 8, 0.2)',
                          borderRadius: '8px',
                          padding: '8px 12px',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '3px',
                        }}
                      >
                        <span style={{ fontSize: '0.72rem', color: '#94a3b8', display: 'flex', alignItems: 'center', gap: '4px' }}>
                          ⚡ {t('settings.cache_breakdown_temp')}
                        </span>
                        <strong style={{ fontSize: '0.9rem', color: '#facc15', fontWeight: 600 }}>
                          {formatBytes(cacheBreakdown.tempBytes)}
                        </strong>
                      </div>

                      {cacheBreakdown.localBytes > 0 && (
                        <div
                          style={{
                            background: 'rgba(16, 185, 129, 0.06)',
                            border: '1px solid rgba(16, 185, 129, 0.2)',
                            borderRadius: '8px',
                            padding: '8px 12px',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '3px',
                          }}
                        >
                          <span style={{ fontSize: '0.72rem', color: '#94a3b8', display: 'flex', alignItems: 'center', gap: '4px' }}>
                            💾 {t('settings.cache_breakdown_local')}
                          </span>
                          <strong style={{ fontSize: '0.9rem', color: '#34d399', fontWeight: 600 }}>
                            {formatBytes(cacheBreakdown.localBytes)}
                          </strong>
                        </div>
                      )}

                      {cacheBreakdown.staleBytes > 0 && (
                        <div
                          style={{
                            background: 'rgba(239, 68, 68, 0.08)',
                            border: '1px solid rgba(239, 68, 68, 0.25)',
                            borderRadius: '8px',
                            padding: '8px 12px',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '3px',
                          }}
                        >
                          <span style={{ fontSize: '0.72rem', color: '#fca5a5', display: 'flex', alignItems: 'center', gap: '4px' }}>
                            ⚠️ {t('settings.cache_breakdown_stale')}
                          </span>
                          <strong style={{ fontSize: '0.9rem', color: '#fca5a5', fontWeight: 600 }}>
                            {formatBytes(cacheBreakdown.staleBytes)}
                          </strong>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Slider Pembatas Ukuran Cache */}
                <div
                  className="settings-cache-limit"
                  style={{
                    background: 'rgba(255, 255, 255, 0.02)',
                    padding: '14px 16px',
                    borderRadius: '8px',
                    border: '1px solid rgba(255, 255, 255, 0.05)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '10px',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <Sliders size={16} color="var(--primary)" />
                      <label
                        className="input-label"
                        htmlFor="settings-cache-limit"
                        style={{ margin: 0, fontSize: '0.88rem', fontWeight: 600 }}
                      >
                        {t('settings.cache_limit_label')}
                      </label>
                    </div>
                    <strong style={{ fontSize: '0.95rem', color: cacheLimitMB === 0 ? 'var(--text-muted)' : 'var(--primary)' }}>
                      {cacheLimitMB === 0
                        ? t('ui.generated.unlimited_tanpa_batas_b567c89')
                        : formatBytes(cacheLimitMB * 1024 * 1024)}
                    </strong>
                  </div>

                  <div style={{ position: 'relative', marginTop: '4px', marginBottom: '8px' }}>
                    <input
                      id="settings-cache-limit"
                      type="range"
                      min={0}
                      max={CACHE_LIMIT_STEPS.length - 1}
                      step={1}
                      value={currentStepIndex}
                      onChange={(e) => handleSliderIndexChange(Number(e.target.value))}
                      style={{
                        width: '100%',
                        accentColor: 'var(--primary)',
                        cursor: 'pointer',
                        height: '6px',
                        borderRadius: '4px',
                        margin: 0,
                        display: 'block',
                      }}
                    />

                    <div
                      className="settings-cache-labels"
                      style={{
                        position: 'relative',
                        width: '100%',
                        height: '22px',
                        marginTop: '10px',
                      }}
                    >
                      {CACHE_LIMIT_STEPS.map((stepVal, idx) => {
                        const isSelected = idx === currentStepIndex;
                        const pct = (idx / (CACHE_LIMIT_STEPS.length - 1)) * 100;
                        const transform =
                          idx === 0
                            ? 'none'
                            : idx === CACHE_LIMIT_STEPS.length - 1
                            ? 'translateX(-100%)'
                            : 'translateX(-50%)';

                        let displayLabel = '';
                        if (stepVal === -1) {
                          displayLabel = t('ui.generated.custom_kustom_f123a45');
                        } else if (stepVal === 0) {
                          displayLabel = t('ui.generated.unlimited_tanpa_batas_b567c89');
                        } else {
                          displayLabel = stepVal >= 1024 ? `${stepVal / 1024} GB` : `${stepVal} MB`;
                        }

                        return (
                          <span
                            key={idx}
                            className="settings-cache-tick"
                            data-selected={isSelected ? 'true' : 'false'}
                            style={{
                              position: 'absolute',
                              left: `${pct}%`,
                              transform,
                              fontSize: '0.68rem',
                              fontWeight: isSelected ? 700 : 500,
                              color: isSelected ? '#38bdf8' : '#64748b',
                              transition: 'all 0.15s ease',
                              cursor: 'pointer',
                              whiteSpace: 'nowrap',
                            }}
                            onClick={() => handleSliderIndexChange(idx)}
                          >
                            {displayLabel}
                          </span>
                        );
                      })}
                    </div>
                  </div>

                {/* CUSTOM CACHE LIMIT PANEL */}
                {isCustomModalOpen && (
                  <div
                    style={{
                      background: 'rgba(56, 189, 248, 0.06)',
                      border: '1px solid rgba(56, 189, 248, 0.25)',
                      borderRadius: '10px',
                      padding: '12px 14px',
                      marginTop: '8px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '10px',
                      animation: 'apiBackdropFadeIn 0.2s ease',
                    }}
                  >
                  <div style={{ flex: 1 }}>
                    <label style={{ display: 'block', fontSize: '0.75rem', color: '#94a3b8', marginBottom: '4px' }}>
                      {t('ui.generated.masukkan_batas_cache_kustom_e890f12')}
                    </label>
                    <div style={{ display: 'flex', gap: '6px' }}>
                      <input
                        type="number"
                        min="1"
                        value={customInputValue}
                        onChange={(e) => setCustomInputValue(e.target.value)}
                        placeholder={t('ui.generated.contoh_75_a123f45')}
                        style={{
                          flex: 1,
                          background: 'rgba(15, 23, 42, 0.8)',
                          border: '1px solid rgba(255, 255, 255, 0.15)',
                          borderRadius: '6px',
                          padding: '6px 10px',
                          color: '#f8fafc',
                          fontSize: '0.82rem',
                          outline: 'none',
                        }}
                      />
                      <select
                        value={customUnit}
                        onChange={(e) => setCustomUnit(e.target.value as 'MB' | 'GB')}
                        style={{
                          background: 'rgba(15, 23, 42, 0.8)',
                          border: '1px solid rgba(255, 255, 255, 0.15)',
                          borderRadius: '6px',
                          padding: '6px 10px',
                          color: '#f8fafc',
                          fontSize: '0.82rem',
                          outline: 'none',
                        }}
                      >
                        <option value="GB">{t('settings.unit_gb')}</option>
                        <option value="MB">{t('settings.unit_mb')}</option>
                      </select>
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: '6px', alignSelf: 'flex-end' }}>
                    <button
                      type="button"
                      onClick={handleSaveCustomLimit}
                      style={{
                        background: 'rgba(56, 189, 248, 0.2)',
                        border: '1px solid rgba(56, 189, 248, 0.4)',
                        color: '#38bdf8',
                        borderRadius: '6px',
                        padding: '6px 12px',
                        fontSize: '0.78rem',
                        fontWeight: 600,
                        cursor: 'pointer',
                      }}
                    >
                      {t('ui.generated.simpan_limit_kustom_a123c45')}
                    </button>
                    <button
                      type="button"
                      onClick={() => setIsCustomModalOpen(false)}
                      style={{
                        background: 'rgba(255, 255, 255, 0.05)',
                        border: '1px solid rgba(255, 255, 255, 0.1)',
                        color: '#94a3b8',
                        borderRadius: '6px',
                        padding: '6px 10px',
                        fontSize: '0.78rem',
                        cursor: 'pointer',
                      }}
                    >
                      {t('ui.generated.batal_kustom_b567c89')}
                    </button>
                  </div>
                </div>
              )}

              {/* DISK FREE SPACE INDICATOR */}
              {freeDiskBytes !== null && freeDiskBytes > 0 && (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    fontSize: '0.76rem',
                    color: '#94a3b8',
                    marginTop: '4px',
                  }}
                >
                  <span>{t('ui.generated.ruang_disk_tersedia_a123b45')}</span>
                  <strong style={{ color: '#38bdf8' }}>{formatBytes(freeDiskBytes)}</strong>
                </div>
              )}

              {/* ACCURATE CACHE & DISK WARNING BADGES */}
              {isCacheExceedingLimit && (
                <div
                  style={{
                    background: 'rgba(234, 179, 8, 0.12)',
                    border: '1px solid rgba(234, 179, 8, 0.35)',
                    borderRadius: '8px',
                    padding: '8px 12px',
                    color: '#fde047',
                    fontSize: '0.78rem',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    marginTop: '6px',
                  }}
                >
                  <AlertTriangle size={16} style={{ color: '#eab308', flexShrink: 0 }} />
                  <span>
                    {t('settings.cache_warning_exceed_limit', {
                      cacheSize: formatBytes(cacheSize!),
                      limit: formatBytes(selectedLimitBytes),
                      excess: formatBytes(excessBytes),
                    })}
                  </span>
                </div>
              )}

              {isCacheExceedingDiskSpace && (
                <div
                  style={{
                    background: 'rgba(239, 68, 68, 0.15)',
                    border: '1px solid rgba(239, 68, 68, 0.4)',
                    borderRadius: '8px',
                    padding: '8px 12px',
                    color: '#fca5a5',
                    fontSize: '0.78rem',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    marginTop: '6px',
                  }}
                >
                  <AlertTriangle size={16} style={{ color: '#ef4444', flexShrink: 0 }} />
                  <span>
                    {t('settings.cache_warning_exceed_disk', {
                      cacheSize: formatBytes(cacheSize!),
                      freeDisk: formatBytes(freeDiskBytes!),
                    })}
                  </span>
                </div>
              )}

              {isDiskLow && (
                <div
                  style={{
                    background: 'rgba(249, 115, 22, 0.12)',
                    border: '1px solid rgba(249, 115, 22, 0.35)',
                    borderRadius: '8px',
                    padding: '8px 12px',
                    color: '#fdba74',
                    fontSize: '0.78rem',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    marginTop: '6px',
                  }}
                >
                  <AlertTriangle size={16} style={{ color: '#f97316', flexShrink: 0 }} />
                  <span>
                    {t('settings.cache_warning_low_disk', {
                      freeDisk: formatBytes(freeDiskBytes!),
                    })}
                  </span>
                </div>
              )}

              {isLimitExceedsDisk && !isCacheExceedingDiskSpace && (
                <div
                  style={{
                    background: 'rgba(99, 102, 241, 0.12)',
                    border: '1px solid rgba(99, 102, 241, 0.35)',
                    borderRadius: '8px',
                    padding: '8px 12px',
                    color: '#a5b4fc',
                    fontSize: '0.78rem',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    marginTop: '6px',
                  }}
                >
                  <AlertTriangle size={16} style={{ color: '#6366f1', flexShrink: 0 }} />
                  <span>
                    {t('settings.cache_warning_limit_exceeds_disk', {
                      limit: formatBytes(cacheLimitMB * 1024 * 1024),
                      freeDisk: formatBytes(freeDiskBytes!),
                    })}
                  </span>
                </div>
              )}

              {cacheSize !== null && cacheLimitMB > 0 && (
                <div style={{ marginTop: '6px' }}>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      fontSize: '0.75rem',
                      marginBottom: '4px',
                    }}
                  >
                    <span style={{ color: 'var(--text-muted)' }}>{t('settings.cache_usage_label')}</span>
                    <span
                      style={{
                        color: cacheSize > cacheLimitMB * 1024 * 1024 ? '#ef4444' : 'var(--text-bright)',
                        fontWeight: 600,
                      }}
                    >
                      {formattedSize} / {formatBytes(cacheLimitMB * 1024 * 1024)} (
                      {Math.round((cacheSize / (cacheLimitMB * 1024 * 1024)) * 100)}%)
                    </span>
                  </div>
                  <div
                    style={{
                      height: '6px',
                      width: '100%',
                      background: 'rgba(255, 255, 255, 0.08)',
                      borderRadius: '4px',
                      overflow: 'hidden',
                    }}
                  >
                    <div
                      style={{
                        height: '100%',
                        width: `${Math.min(100, Math.round((cacheSize / (cacheLimitMB * 1024 * 1024)) * 100))}%`,
                        background:
                          cacheSize > cacheLimitMB * 1024 * 1024
                            ? 'linear-gradient(90deg, #f97316, #ef4444)'
                            : cacheSize / (cacheLimitMB * 1024 * 1024) > 0.75
                            ? 'linear-gradient(90deg, #eab308, #f97316)'
                            : 'linear-gradient(90deg, #3b82f6, #06b6d4)',
                        borderRadius: '4px',
                        transition: 'width 0.3s ease',
                      }}
                    />
                  </div>
                </div>
              )}

              <div
                className="settings-auto-prune"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginTop: '6px',
                  paddingTop: '10px',
                  borderTop: '1px solid rgba(255, 255, 255, 0.05)',
                }}
              >
                <div>
                  <strong style={{ fontSize: '0.85rem', color: 'var(--text-bright)', display: 'block' }}>
                    {t('settings.auto_prune_title')}
                  </strong>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                    {t('settings.auto_prune_desc')}
                  </span>
                </div>
                <label className="settings-switch" style={{ cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={autoPruneEnabled}
                    onChange={(e) => handleToggleAutoPrune(e.target.checked)}
                  />
                  <span className="settings-slider round" />
                </label>
              </div>
            </div>

            {/* Tombol aksi pembersihan utama (Dua Tombol Berdampingan di 1 Baris, Responsif Down-Stack) */}
            <div
              className="settings-cache-actions"
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))',
                gap: '10px',
                marginTop: '6px',
              }}
            >
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setIsSpecificModalOpen(true)}
                style={{
                  padding: '11px 14px',
                  fontSize: '0.84rem',
                  fontWeight: 600,
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '6px',
                  borderColor: 'rgba(56, 189, 248, 0.35)',
                  background: 'rgba(56, 189, 248, 0.12)',
                  color: '#38bdf8',
                  textAlign: 'center',
                  whiteSpace: 'nowrap',
                  minHeight: '2.7rem',
                }}
              >
                <SlidersHorizontal size={16} style={{ flexShrink: 0 }} />
                <span>{t('settings.manage_cache')}</span>
              </button>

              {(() => {
                const activeTargetsList = getActiveSessionTargets();
                const orphanedCount = availableSessions.filter((sess: any) => {
                  if (activeTargetsList.includes(sess.name)) return false;
                  const meta = getSessionMetadata(sess.name);
                  const hasValidUser = Boolean(meta?.telegramUserId || (meta?.userFullName && !sess.name.startsWith('Lavender')));
                  return !hasValidUser || sess.status === 'expired' || sess.status === 'error';
                }).length;

                if (orphanedCount === 0) return null;

                return (
                  <button
                    type="button"
                    className="btn btn-secondary btn-orphaned-pulse"
                    onClick={handlePurgeOrphanedSessions}
                    disabled={isPurgingOrphans}
                    style={{
                      padding: '11px 14px',
                      fontSize: '0.84rem',
                      fontWeight: 600,
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '6px',
                      borderColor: 'rgba(245, 158, 11, 0.55)',
                      background: 'rgba(245, 158, 11, 0.14)',
                      color: '#f59e0b',
                      textAlign: 'center',
                      whiteSpace: 'nowrap',
                      minHeight: '2.7rem',
                      transition: 'all 0.2s ease',
                    }}
                    title={t('settings.purge_orphaned_sessions_desc')}
                  >
                    {isPurgingOrphans ? (
                      <Loader2 size={16} className="spin" style={{ flexShrink: 0 }} />
                    ) : (
                      <Trash2 size={16} style={{ flexShrink: 0 }} />
                    )}
                    <span>
                      {t('settings.purge_orphaned_sessions_btn')} ({orphanedCount})
                    </span>
                  </button>
                );
              })()}

              <button
                type="button"
                className="btn btn-danger"
                onClick={handleClearCache}
                disabled={isClearing || isTrimming}
                style={{
                  padding: '11px 14px',
                  fontSize: '0.85rem',
                  fontWeight: 700,
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '6px',
                  textAlign: 'center',
                  whiteSpace: 'nowrap',
                  minHeight: '2.7rem',
                }}
              >
                {isClearing
                  ? t('settings.clearing')
                  : isTrimming
                  ? t('settings.trimming')
                  : t('settings.clear_cache_btn')}
              </button>
            </div>

            {clearStatus === 'success' && (
              <div className="settings-cache-result is-success" role="status" aria-live="polite">
                <span className="settings-cache-result-icon"><CheckCircle size={18} /></span>
                <span className="settings-cache-result-copy">
                  <strong>{t('settings.cache_clear_success_title')}</strong>
                  <span>{t('settings.cache_clear_success_detail', {
                    count: clearSummary?.removed || 0,
                    size: formatBytes(clearSummary?.freed || 0),
                  })}</span>
                </span>
              </div>
            )}
            {clearStatus === 'error' && (
              <div className="settings-cache-result is-error" role="alert">
                <span className="settings-cache-result-icon"><AlertTriangle size={18} /></span>
                <span className="settings-cache-result-copy">
                  <strong>{t('settings.cache_clear_error_title')}</strong>
                  <span>{t('settings.cache_clear_error')}</span>
                </span>
              </div>
            )}

            {/* Transfer Database & Deduplication Clean */}
            <div
              style={{
                marginTop: '12px',
                padding: '14px 16px',
                background: 'rgba(239, 68, 68, 0.03)',
                borderRadius: '10px',
                border: '1px solid rgba(239, 68, 68, 0.15)',
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
              }}
            >
              <div>
                <strong style={{ fontSize: '0.88rem', color: '#f8fafc', display: 'block' }}>
                  {t('ui.generated.transfer_database_deduplication_a123f45')}
                </strong>
                <span style={{ fontSize: '0.75rem', color: '#94a3b8', lineHeight: 1.45 }}>
                  {t('ui.generated.wipes_all_uploaded_file_history_resume_state_audi_b678c90')}
                </span>
              </div>
              <button
                type="button"
                onClick={handleClearDatabase}
                disabled={isClearingDb}
                style={{
                  alignSelf: 'flex-start',
                  background: 'rgba(239, 68, 68, 0.15)',
                  color: '#fca5a5',
                  border: '1px solid rgba(239, 68, 68, 0.3)',
                  borderRadius: '8px',
                  padding: '6px 14px',
                  fontSize: '0.78rem',
                  fontWeight: 600,
                  cursor: isClearingDb ? 'not-allowed' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                <Trash2 size={13} />
                <span>
                  {isClearingDb
                    ? t('settings.clearing')
                    : t('ui.generated.clear_transfer_database_c901d23')}
                </span>
              </button>
              {dbClearStatus === 'success' && (
                <div style={{ fontSize: '0.75rem', color: '#4ade80' }}>
                  {t('ui.generated.database_transfer_berhasil_dibersihkan_e123f45')}
                </div>
              )}
              {dbClearStatus === 'error' && (
                <div style={{ fontSize: '0.75rem', color: '#f87171' }}>
                  {t('ui.generated.gagal_membersihkan_database_transfer_f678a90')}
                </div>
              )}
            </div>
          </div>
        </div>
  );
}
