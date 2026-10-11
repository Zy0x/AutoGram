import { Film, HardDriveUpload, Sliders, Users, Zap } from 'lucide-react';

export function LimitsRecoverySettingsSection({ activeTab, ctx }: { activeTab: string; ctx: Record<string, any> }) {
  const { t, draft, patch, transferActive, availableSessions, getSessionMetadata } = ctx;

  const selectedSessions = (draft.alternateAccountPool || '')
    .split(',')
    .map((s: string) => s.trim())
    .filter(Boolean);

  return activeTab === 'limits_recovery' ? (
    <div className="td-xfer-focused-panel" id="section-limits-recovery">
      {/* 1. DEDICATED CARD: PENANGANAN BERKAS BESAR (OVERSIZE FILES) */}
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
            <HardDriveUpload size={18} style={{ color: 'var(--accent-primary, #38bdf8)' }} />
          </div>
          <div>
            <h4 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 800, color: 'var(--text-primary)' }}>
              1. {t('drive.oversize_title')}
            </h4>
            <p style={{ margin: 0, fontSize: '0.83rem', color: 'var(--text-secondary)' }}>
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
            <h5 style={{ color: 'var(--text-primary)', fontSize: '13px', fontWeight: 600, marginBottom: '12px' }}>
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
      </div>

      {/* 2. DEDICATED CARD: POOL ROTASI MULTI-AKUN & KETAHANAN LIMIT */}
      <div
        className="td-settings-card"
        style={{
          marginTop: '20px',
          background: 'linear-gradient(150deg, var(--bg-card, rgba(15, 22, 36, 0.8)) 0%, var(--bg-primary, rgba(8, 12, 22, 0.95)) 100%)',
          border: '1px solid var(--border-subtle, rgba(255, 255, 255, 0.08))',
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
              background: 'color-mix(in srgb, var(--accent-primary, #38bdf8) 12%, transparent)',
              border: '1px solid color-mix(in srgb, var(--accent-primary, #38bdf8) 25%, transparent)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <Users size={18} style={{ color: 'var(--accent-primary, #38bdf8)' }} />
          </div>
          <div>
            <h4 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 800, color: 'var(--text-primary)' }}>
              2. {t('drive.multi_account_pool_title')}
            </h4>
            <p style={{ margin: 0, fontSize: '0.83rem', color: 'var(--text-secondary)' }}>
              {t('drive.multi_account_pool_desc')}
            </p>
          </div>
        </div>

        {/* TOGGLE SWITCH: ENABLE MULTI-ACCOUNT ROTATION */}
        <label className="td-switch-row" style={{ marginBottom: '16px' }}>
          <div>
            <strong>{t('drive.multi_account_toggle_title')}</strong>
            <p>{t('drive.multi_account_toggle_desc')}</p>
          </div>
          <input
            type="checkbox"
            checked={selectedSessions.length > 0}
            disabled={!!transferActive}
            onChange={(e) => {
              if (e.target.checked) {
                const candidate = availableSessions.find(
                  (s: any) => s.status !== 'error' && s.status !== 'expired' && s.status !== 'revoked' && s.status !== 'unauthorized'
                );
                if (candidate) {
                  patch({ alternateAccountPool: candidate.name, alternateIdentityApproved: true });
                }
              } else {
                patch({ alternateAccountPool: '' });
              }
            }}
          />
        </label>

        {/* ACCOUNT POOL CHIP SELECTOR CONTAINER */}
        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-default)', borderRadius: '12px', padding: '16px', marginBottom: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px', flexWrap: 'wrap', gap: '6px' }}>
            <label className="td-field-label" style={{ margin: 0 }}>
              {t('drive.multi_account_selector_label')}
            </label>
            <span style={{ fontSize: '11px', color: selectedSessions.length > 0 ? 'var(--accent-primary, #38bdf8)' : 'var(--text-muted, #64748b)', fontWeight: 600 }}>
              {selectedSessions.length > 0
                ? t('drive.multi_account_status_multi', { count: selectedSessions.length + 1 })
                : t('drive.multi_account_status_single')}
            </span>
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '10px' }}>
            {availableSessions.length > 0 ? (
              availableSessions.map((sess: any) => {
                const isSelected = selectedSessions.includes(sess.name);
                const meta = getSessionMetadata(sess.name);

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

                const isProblematic = sess.status === 'error' || sess.status === 'expired' || sess.status === 'revoked' || sess.status === 'unauthorized';
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
                        color: 'var(--danger, #dc2626)',
                        padding: '6px 12px',
                        borderRadius: '20px',
                        fontSize: '12px',
                        cursor: 'not-allowed',
                        opacity: 0.7,
                      }}
                      title={t('ui.generated.sesi_ini_bermasalah_atau_expired_tidak_dapat_dig_bf5427d')}
                    >
                      <span>🔴</span>
                      <strong style={{ color: 'var(--danger, #dc2626)' }}>{cleanLabel}</strong>
                      <span style={{ color: 'var(--danger, #dc2626)', fontSize: '10px', fontWeight: 600 }}>{t('ui.generated.bermasalah_20b37d7')}</span>
                    </div>
                  );
                }

                return (
                  <button
                    key={sess.name}
                    type="button"
                    disabled={!!transferActive}
                    onClick={() => {
                      const next = isSelected
                        ? selectedSessions.filter((c: string) => c !== sess.name)
                        : [...selectedSessions, sess.name];
                      patch({
                        alternateAccountPool: next.join(', '),
                        ...(next.length > 0 ? { alternateIdentityApproved: true } : {}),
                      });
                    }}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '6px',
                      background: isSelected ? 'color-mix(in srgb, var(--accent-primary, #38bdf8) 20%, transparent)' : 'var(--bg-secondary, rgba(255,255,255,0.04))',
                      border: isSelected ? '1px solid var(--accent-primary, #38bdf8)' : '1px solid var(--border-default, rgba(255,255,255,0.1))',
                      color: isSelected ? 'var(--accent-primary, #38bdf8)' : 'var(--text-secondary, #475569)',
                      padding: '6px 12px',
                      borderRadius: '20px',
                      fontSize: '12px',
                      cursor: 'pointer',
                      fontWeight: 500,
                      transition: 'all 0.15s ease',
                    }}
                  >
                    <span>{isPremium ? '💎' : '⚪'}</span>
                    <strong style={{ color: isSelected ? 'var(--accent-primary, #38bdf8)' : 'var(--text-primary, #0f172a)' }}>
                      {cleanLabel}
                    </strong>
                    <span style={{
                      fontSize: '10px',
                      background: isPremium
                        ? 'color-mix(in srgb, var(--accent-primary, #38bdf8) 15%, transparent)'
                        : 'var(--bg-card, rgba(255,255,255,0.05))',
                      color: isPremium ? 'var(--accent-primary, #38bdf8)' : 'var(--text-muted, #64748b)',
                      padding: '1px 6px',
                      borderRadius: '4px',
                      marginLeft: '4px',
                    }}>
                      {isPremium ? t('ui.generated.premium_4gb_9f5be98') : t('ui.generated.standar_2gb_non_premium_806fe3e')}
                    </span>
                  </button>
                );
              })
            ) : (
              <div style={{ fontSize: '12px', color: 'var(--text-muted, #94a3b8)', padding: '4px 0' }}>
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
        </div>

        {/* STRATEGY IF ALBUM CONTAINS OVERSIZE ITEM */}
        <div className="td-form-row-grid" style={{ marginBottom: '16px' }}>
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

        {/* APPROVED ALTERNATE IDENTITY SWITCH */}
        <label className="td-switch-row">
          <div>
            <strong>{t('drive.multi_account_approved_title')}</strong>
            <p>{t('drive.multi_account_approved_desc')}</p>
          </div>
          <input
            type="checkbox"
            checked={Boolean(draft.alternateIdentityApproved)}
            disabled={!!transferActive}
            onChange={(e) => patch({ alternateIdentityApproved: e.target.checked })}
          />
        </label>
      </div>
    </div>
  ) : null;
}
