import { useTranslation } from 'react-i18next';
import { useState, useEffect } from 'react';
import { runDaemonOnce } from '../../lib/tauri/workerBridge';
import { Play, Pause, Trash2, Calendar, Clock, Plus, RefreshCw } from 'lucide-react';
import { ConfirmModal } from '../../components/common/ConfirmModal';

export function Automation() {
  const { t } = useTranslation();
  const [automations, setAutomations] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  
  // Form state
  const [name, setName] = useState('');
  const [sourceEntity, setSourceEntity] = useState('');
  const [targetEntity, setTargetEntity] = useState('');
  const [cronExp, setCronExp] = useState('0 * * * *');
  const [isRealtime, setIsRealtime] = useState(false);

  const fetchAutomations = async () => {
    setIsLoading(true);
    try {
      const result = await runDaemonOnce(['--action', 'list-automations']);

      let jsonOutput = '';
      if (result.stdout.includes('[JSON_OUTPUT]')) {
        const parts = result.stdout.split('[JSON_OUTPUT]');
        jsonOutput = parts[parts.length - 1].trim();
      }

      if (jsonOutput) {
        const parsed = JSON.parse(jsonOutput);
        const list = Array.isArray(parsed)
          ? parsed
          : Array.isArray(parsed?.automations)
          ? parsed.automations
          : Array.isArray(parsed?.jobs)
          ? parsed.jobs
          : [];
        setAutomations(list);
      } else {
        setAutomations([]);
      }
      if (result.code !== 0 && result.stderr && !/requires desktop|requires tauri/i.test(result.stderr)) {
        console.error('Failed to fetch automations', result.stderr);
      }
    } catch (err) {
      console.error('Failed to fetch automations', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchAutomations();
  }, []);

  const handleAddAutomation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sourceEntity || !targetEntity) {
      alert("Source and Target are required.");
      return;
    }

    try {
      const args = [
        '--action', 'add-automation',
        '--profile-name', name || 'New Automation',
        '--source', sourceEntity,
        '--destination', targetEntity,
      ];

      if (isRealtime) {
        args.push('--realtime');
      } else if (cronExp) {
        args.push('--cron', cronExp);
      }

      const result = await runDaemonOnce(args);
      if (result.code !== 0) {
        const { workerErrorMessage } = await import('../../lib/tauri/workerBridge');
        alert(workerErrorMessage(result, 'Error adding automation.'));
        return;
      }

      setShowAddForm(false);
      setName('');
      setSourceEntity('');
      setTargetEntity('');
      fetchAutomations();
    } catch (err) {
      console.error('Failed to add automation', err);
      alert('Error adding automation.');
    }
  };

  const [deleteTargetId, setDeleteTargetId] = useState<number | null>(null);

  const deleteAutomation = (id: number) => {
    setDeleteTargetId(id);
  };

  const executeDeleteAutomation = async () => {
    const id = deleteTargetId;
    if (id === null) return;
    setDeleteTargetId(null);

    try {
      const result = await runDaemonOnce([
        '--action', 'delete-automation',
        '--job-id', String(id),
      ]);
      if (result.code !== 0) {
        const { workerErrorMessage } = await import('../../lib/tauri/workerBridge');
        alert(workerErrorMessage(result, 'Delete failed'));
        return;
      }
      fetchAutomations();
    } catch (err) {
      console.error(err);
    }
  };

  const toggleStatus = async (id: number, currentStatus: string) => {
    const newStatus = currentStatus === 'active' ? 'paused' : 'active';
    try {
      const result = await runDaemonOnce([
        '--action', 'set-automation-status',
        '--job-id', String(id),
        '--status', newStatus,
      ]);
      if (result.code !== 0) {
        const { workerErrorMessage } = await import('../../lib/tauri/workerBridge');
        alert(workerErrorMessage(result, 'Status update failed'));
        return;
      }
      fetchAutomations();
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <main className="main-content page-stack">
      <header className="page-header page-header-row">
        <div style={{ minWidth: 0 }}>
            <h2 className="title">Automation & Scheduler</h2>
            <p className="subtitle" style={{ marginBottom: 0 }}>{t('automation.subtitle')}</p>
        </div>
        <div className="page-header-actions">
            <button type="button" className="btn btn-secondary" onClick={fetchAutomations} disabled={isLoading}>
                <RefreshCw size={18} className={isLoading ? "spin" : ""} /> Refresh
            </button>
            <button type="button" className="btn btn-primary" onClick={() => setShowAddForm(!showAddForm)}>
                <Plus size={18} /> New Automation
            </button>
        </div>
      </header>

      {showAddForm && (
        <section className="dashboard-section fade-in">
          <h3 className="section-title">{t('automation.add_btn')}</h3>
          <form onSubmit={handleAddAutomation} className="page-stack" style={{ gap: '1rem' }}>
            <div className="input-group">
                <label className="input-label">{t('automation.name_label')}</label>
                <input type="text" className="input-field" value={name} onChange={e => setName(e.target.value)} placeholder={t("automation.name_ph")} />
            </div>
            <div className="form-row">
                <div className="input-group" style={{ marginBottom: 0 }}>
                    <label className="input-label">{t('automation.source_label')}</label>
                    <input type="text" className="input-field" value={sourceEntity} onChange={e => setSourceEntity(e.target.value)} required />
                </div>
                <div className="input-group" style={{ marginBottom: 0 }}>
                    <label className="input-label">{t('automation.target_label')}</label>
                    <input type="text" className="input-field" value={targetEntity} onChange={e => setTargetEntity(e.target.value)} required />
                </div>
            </div>
            
            <div className="title-with-icon" style={{ gap: '0.75rem' }}>
                <input 
                    type="checkbox" 
                    id="realtime-check"
                    checked={isRealtime}
                    onChange={(e) => setIsRealtime(e.target.checked)}
                />
                <label htmlFor="realtime-check" style={{ fontWeight: 600 }}>{t('automation.enable_realtime')}</label>
            </div>

            {!isRealtime && (
                <div className="input-group" style={{ marginBottom: 0 }}>
                    <label className="input-label">Cron Expression <span className="field-hint" style={{ display: 'inline', margin: 0 }}>(Flexible for Supabase/Backend)</span></label>
                    <input type="text" className="input-field" value={cronExp} onChange={e => setCronExp(e.target.value)} placeholder="0 * * * *" />
                    <span className="field-hint" style={{ marginTop: '4px' }}>e.g., &quot;0 * * * *&quot; for every hour.</span>
                </div>
            )}
            
            <div className="page-header-actions" style={{ justifyContent: 'flex-end' }}>
                <button type="button" className="btn btn-secondary" onClick={() => setShowAddForm(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary">Save Automation</button>
            </div>
          </form>
        </section>
      )}

      <div className="table-container">
        <table className="glass-table">
            <thead>
                <tr>
                    <th>Name</th>
                    <th>Source &rarr; Target</th>
                    <th>Type</th>
                    <th>Status</th>
                    <th>Last Run</th>
                    <th>Actions</th>
                </tr>
            </thead>
            <tbody>
                {automations.map((job) => {
                  let sourceStr = job.source_entity_id || job.source || '';
                  let targetStr = job.target_entity_id || job.destination || job.target || '';
                  const configStr = job.config_json || job.configJson || '';
                  if ((!sourceStr || !targetStr) && configStr) {
                    try {
                      const cfg = typeof configStr === 'string' ? JSON.parse(configStr) : configStr;
                      sourceStr = sourceStr || cfg.source || cfg.source_entity_id || '';
                      targetStr = targetStr || cfg.destination || cfg.target || cfg.target_entity_id || '';
                    } catch {
                      /* ignore */
                    }
                  }
                  const isRealtime = !!(job.is_realtime || job.action_type === 'realtime' || job.actionType === 'realtime');
                  const cronExpVal = job.cron_expression || job.schedule_cron || job.scheduleCron || '';
                  const statusVal = job.status || 'active';
                  const lastRunVal = job.last_run_at || job.last_run || job.lastRun || 'Never';

                  return (
                    <tr key={job.id}>
                        <td style={{ fontWeight: 600 }}>{job.name}</td>
                        <td><span style={{color: 'var(--text-muted)', fontSize: '0.85rem'}}>{sourceStr || '-'} &rarr; {targetStr || '-'}</span></td>
                        <td>
                            {isRealtime ? (
                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', color: 'var(--primary)', fontWeight: 600, fontSize: '0.8rem' }}><Clock size={14}/> Real-Time</span>
                            ) : (
                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', color: 'var(--success)', fontWeight: 600, fontSize: '0.8rem' }}><Calendar size={14}/> Cron: {cronExpVal || '-'}</span>
                            )}
                        </td>
                        <td>
                            <span style={{ 
                                color: statusVal === 'active' ? 'var(--success)' : 'var(--text-muted)', 
                                textTransform: 'uppercase', 
                                fontSize: '0.75rem', 
                                fontWeight: 700, 
                                background: statusVal === 'active' ? 'rgba(16, 185, 129, 0.1)' : 'rgba(255, 255, 255, 0.05)',
                                padding: '4px 8px',
                                borderRadius: '4px'
                            }}>
                                {statusVal}
                            </span>
                        </td>
                        <td style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                            {lastRunVal}
                        </td>
                        <td>
                            <div style={{ display: 'flex', gap: '8px', justifyContent: 'center' }}>
                                <button 
                                    className="btn btn-secondary" 
                                    style={{ padding: '6px 10px', color: statusVal === 'active' ? 'var(--danger)' : 'var(--primary)', borderColor: statusVal === 'active' ? 'var(--danger)' : 'var(--primary)' }} 
                                    onClick={() => toggleStatus(job.id, statusVal)} 
                                    title={statusVal === 'active' ? "Pause" : "Resume"}
                                >
                                    {statusVal === 'active' ? <Pause size={16} /> : <Play size={16} />}
                                </button>
                                <button className="btn btn-secondary" style={{ padding: '6px 10px', color: 'var(--text-muted)' }} onClick={() => deleteAutomation(job.id)} title="Delete">
                                    <Trash2 size={16} />
                                </button>
                            </div>
                        </td>
                    </tr>
                  );
                })}
                {automations.length === 0 && !isLoading && (
                    <tr>
                        <td colSpan={6} style={{ textAlign: 'center', padding: '32px', color: 'var(--text-muted)' }}>
                            No automations found. Create one to get started.
                        </td>
                    </tr>
                )}
            </tbody>
        </table>
      </div>

      <ConfirmModal
        isOpen={deleteTargetId !== null}
        title={t('automation.delete_confirm_title', 'Konfirmasi Hapus Otomatisasi')}
        description={t('automation.delete_confirm_desc', 'Apakah Anda yakin ingin menghapus pekerjaan otomatisasi ini?')}
        variant="danger"
        confirmText={t('common.delete', 'Hapus')}
        cancelText={t('common.cancel', 'Batal')}
        onConfirm={executeDeleteAutomation}
        onCancel={() => setDeleteTargetId(null)}
      />
    </main>
  );
}
