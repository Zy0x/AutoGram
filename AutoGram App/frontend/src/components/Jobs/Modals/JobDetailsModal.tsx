import i18n from 'i18next';
import { createPortal } from 'react-dom';
import { X, Settings, Database, Filter, Sliders, Shield } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface JobDetailsModalProps {
  job: any;
  fallbackTriggered?: boolean;
  onClose: () => void;
}

export function JobDetailsModal({ job, fallbackTriggered, onClose }: JobDetailsModalProps) {
  const { t } = useTranslation();
  let config: any = {};
  try {
    if (typeof job.config_json === 'string') {
      config = JSON.parse(job.config_json);
    } else if (typeof job.config_json === 'object') {
      config = job.config_json;
    }
  } catch (e) {
    console.error("Failed to parse config_json", e);
  }

  const DetailItem = ({ label, value }: { label: string, value: any }) => (
    <div className="detail-item-row">
      <span className="detail-item-label">{label}</span>
      <span className="detail-item-value">
        {value === null || value === undefined || value === '' ? '-' : (typeof value === 'string' || typeof value === 'number' ? String(value) : value)}
      </span>
    </div>
  );

  const node = (
    <div className="modal-overlay" style={{ zIndex: 1100 }} onClick={onClose} role="presentation">
      <div className="modal-panel glass-panel" style={{ display: 'flex', flexDirection: 'column', maxHeight: 'min(90dvh, 90vh)' }} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="modal-header">
          <h3 style={{ margin: 0, color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0, flexWrap: 'wrap' }}>
            <Settings size={20} color="var(--primary)" style={{ flexShrink: 0 }} />
            {t('ui.generated.job_configuration_details_332db71')}
          </h3>
          <button type="button" onClick={onClose} className="btn-tertiary" aria-label={t('drive.preview_close_btn')}>
            <X size={20} />
          </button>
        </div>
        
        <div className="modal-body" style={{ padding: 'clamp(1rem, 3vw, 1.5rem)' }}>
          <div style={{ marginBottom: '24px' }}>
            <h4 style={{ color: 'var(--primary)', display: 'flex', alignItems: 'center', gap: '6px', margin: '0 0 12px 0' }}>
              <Database size={16} /> {t('ui.generated.general_info_a1fd58a')}
            </h4>
            <div style={{ background: 'rgba(255,255,255,0.02)', padding: '0 16px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.05)' }}>
              <DetailItem label={t('ui.generated.job_id_7707976')} value={job.id} />
              <DetailItem label={t('jobs.col_job_name')} value={job.job_name} />
              <DetailItem label={t('ui.generated.profile_session_0adb384')} value={job.profile_name || config.session} />
              <DetailItem label={t('drive.mode_label')} value={
                fallbackTriggered 
                  ? <span style={{ color: 'var(--warning)', display: 'flex', alignItems: 'center', gap: '4px' }} title={i18n.t("jobs.chat_restrictions_fallback")}><Shield size={14} /> {i18n.t("jobs.fallback_clean_copy_label")}</span>
                  : (job.transfer_mode || config.mode)
              } />
              <DetailItem label={t('ui.generated.created_at_5db1542')} value={job.created_at} />
            </div>
          </div>

          <div style={{ marginBottom: '24px' }}>
            <h4 style={{ color: 'var(--success)', display: 'flex', alignItems: 'center', gap: '6px', margin: '0 0 12px 0' }}>
              <Sliders size={16} /> {t('drive.tools_tab_settings')}
            </h4>
            <div style={{ background: 'rgba(255,255,255,0.02)', padding: '0 16px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.05)' }}>
              <DetailItem label={t('ui.generated.fetch_direction_d73cc40')} value={config.fetchDirection || config.fetch_direction || 'Newest First'} />
              <DetailItem label={t('ui.generated.limit_24d948e')} value={config.limit === 0 ? 'Unlimited' : config.limit} />
              <DetailItem label={t('dashboard.dup_action')} value={config.dupAction || config.duplicate_action || 'Skip'} />
              <DetailItem label={t('ui.generated.delay_range_seconds_00f40fd')} value={`${config.delayMin || config.delay_min || 2} - ${config.delayMax || config.delay_max || 5}`} />
              <DetailItem label={t('ui.generated.album_handling_e2d8792')} value={config.albumHandling || config.album_handling || 'Follow Source'} />
              <DetailItem label={t('ui.generated.auto_fallback_c567b5f')} value={config.autoFallback !== false ? 'Enabled' : 'Disabled'} />
            </div>
          </div>

          <div style={{ marginBottom: '24px' }}>
            <h4 style={{ color: 'var(--warning)', display: 'flex', alignItems: 'center', gap: '6px', margin: '0 0 12px 0' }}>
              <Filter size={16} /> {t('ui.generated.filters_rules_58de166')}
            </h4>
            <div style={{ background: 'rgba(255,255,255,0.02)', padding: '0 16px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.05)' }}>
              <DetailItem label={t('ui.generated.media_type_622a2e5')} value={config.media || config.media_filter || 'All'} />
              <DetailItem label={t('ui.generated.min_size_mb_ccccdd4')} value={config.size_min || config.size_min_mb || 0} />
              <DetailItem label={t('ui.generated.max_size_mb_07368aa')} value={config.size_max || config.size_max_mb || 'Unlimited'} />
              <DetailItem label={t('dashboard.caption_rule')} value={config.captionRule || config.caption_rule || 'Keep Original'} />
              {config.customCaption && <DetailItem label={t('ui.generated.custom_caption_33ceba4')} value={config.customCaption} />}
              {(config.startDate || config.start_date) && <DetailItem label={t('dashboard.start_date')} value={config.startDate || config.start_date} />}
              {(config.endDate || config.end_date) && <DetailItem label={t('dashboard.end_date')} value={config.endDate || config.end_date} />}
            </div>
          </div>
          
        </div>
      </div>
    </div>
  );

  if (typeof document === 'undefined') return null;
  return createPortal(node, document.body);
}
