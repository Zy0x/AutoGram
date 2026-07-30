import i18n from 'i18next';
import { createPortal } from 'react-dom';
import { X, Settings, Database, Filter, Sliders, Shield } from 'lucide-react';

interface JobDetailsModalProps {
  job: any;
  fallbackTriggered?: boolean;
  onClose: () => void;
}

export function JobDetailsModal({ job, fallbackTriggered, onClose }: JobDetailsModalProps) {
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
            Job Configuration Details
          </h3>
          <button type="button" onClick={onClose} className="btn-tertiary" aria-label="Close">
            <X size={20} />
          </button>
        </div>
        
        <div className="modal-body" style={{ padding: 'clamp(1rem, 3vw, 1.5rem)' }}>
          <div style={{ marginBottom: '24px' }}>
            <h4 style={{ color: 'var(--primary)', display: 'flex', alignItems: 'center', gap: '6px', margin: '0 0 12px 0' }}>
              <Database size={16} /> General Info
            </h4>
            <div style={{ background: 'rgba(255,255,255,0.02)', padding: '0 16px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.05)' }}>
              <DetailItem label="Job ID" value={job.id} />
              <DetailItem label="Job Name" value={job.job_name} />
              <DetailItem label="Profile / Session" value={job.profile_name || config.session} />
              <DetailItem label="Mode" value={
                fallbackTriggered 
                  ? <span style={{ color: 'var(--warning)', display: 'flex', alignItems: 'center', gap: '4px' }} title={i18n.t("jobs.chat_restrictions_fallback")}><Shield size={14} /> Fast Forward (Fell back to Clean Copy)</span>
                  : (job.transfer_mode || config.mode)
              } />
              <DetailItem label="Created At" value={job.created_at} />
            </div>
          </div>

          <div style={{ marginBottom: '24px' }}>
            <h4 style={{ color: 'var(--success)', display: 'flex', alignItems: 'center', gap: '6px', margin: '0 0 12px 0' }}>
              <Sliders size={16} /> Transfer Settings
            </h4>
            <div style={{ background: 'rgba(255,255,255,0.02)', padding: '0 16px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.05)' }}>
              <DetailItem label="Fetch Direction" value={config.fetchDirection || config.fetch_direction || 'Newest First'} />
              <DetailItem label="Limit" value={config.limit === 0 ? 'Unlimited' : config.limit} />
              <DetailItem label="Duplicate Action" value={config.dupAction || config.duplicate_action || 'Skip'} />
              <DetailItem label="Delay Range (Seconds)" value={`${config.delayMin || config.delay_min || 2} - ${config.delayMax || config.delay_max || 5}`} />
              <DetailItem label="Album Handling" value={config.albumHandling || config.album_handling || 'Follow Source'} />
              <DetailItem label="Auto Fallback" value={config.autoFallback !== false ? 'Enabled' : 'Disabled'} />
            </div>
          </div>

          <div style={{ marginBottom: '24px' }}>
            <h4 style={{ color: 'var(--warning)', display: 'flex', alignItems: 'center', gap: '6px', margin: '0 0 12px 0' }}>
              <Filter size={16} /> Filters & Rules
            </h4>
            <div style={{ background: 'rgba(255,255,255,0.02)', padding: '0 16px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.05)' }}>
              <DetailItem label="Media Type" value={config.media || config.media_filter || 'All'} />
              <DetailItem label="Min Size (MB)" value={config.size_min || config.size_min_mb || 0} />
              <DetailItem label="Max Size (MB)" value={config.size_max || config.size_max_mb || 'Unlimited'} />
              <DetailItem label="Caption Rule" value={config.captionRule || config.caption_rule || 'Keep Original'} />
              {config.customCaption && <DetailItem label="Custom Caption" value={config.customCaption} />}
              {(config.startDate || config.start_date) && <DetailItem label="Start Date" value={config.startDate || config.start_date} />}
              {(config.endDate || config.end_date) && <DetailItem label="End Date" value={config.endDate || config.end_date} />}
            </div>
          </div>
          
        </div>
      </div>
    </div>
  );

  if (typeof document === 'undefined') return null;
  return createPortal(node, document.body);
}
