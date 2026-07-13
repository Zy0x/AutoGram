import { useState, useEffect } from 'react';
import { Command } from '@tauri-apps/plugin-shell';
import { Play, Pause, Trash2, Calendar, Clock, Plus, RefreshCw } from 'lucide-react';

export function Automation() {
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
      const command = Command.create('python', ['../../worker/daemon.py', '--action', 'list-automations']);
      const result = await command.execute();
      
      let jsonOutput = "";
      if (result.stdout.includes('[JSON_OUTPUT]')) {
        const parts = result.stdout.split('[JSON_OUTPUT]');
        jsonOutput = parts[parts.length - 1].trim();
      }
      
      if (jsonOutput) {
        setAutomations(JSON.parse(jsonOutput));
      }
    } catch (err) {
      console.error("Failed to fetch automations", err);
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
        '../../worker/daemon.py',
        '--action=add-automation',
        `--profile-name=${name || 'New Automation'}`,
        `--source=${sourceEntity}`,
        `--destination=${targetEntity}`
      ];

      if (isRealtime) {
        args.push('--realtime');
      } else if (cronExp) {
        args.push(`--cron=${cronExp}`);
      }

      const command = Command.create('python', args);
      await command.execute();
      
      setShowAddForm(false);
      setName('');
      setSourceEntity('');
      setTargetEntity('');
      fetchAutomations();
    } catch (err) {
      console.error("Failed to add automation", err);
      alert("Error adding automation.");
    }
  };

  const deleteAutomation = async (id: number) => {
    if (!confirm("Delete this automation job?")) return;
    try {
      const command = Command.create('python', ['../../worker/daemon.py', '--action', 'delete-automation', '--job-id', String(id)]);
      await command.execute();
      fetchAutomations();
    } catch (err) {
      console.error(err);
    }
  };

  const toggleStatus = async (id: number, currentStatus: string) => {
    const newStatus = currentStatus === 'active' ? 'paused' : 'active';
    try {
      const command = Command.create('python', ['../../worker/daemon.py', '--action', 'set-automation-status', '--job-id', String(id), '--status', newStatus]);
      await command.execute();
      fetchAutomations();
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <main className="main-content">
      <header style={{ marginBottom: '32px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
            <h2 className="title">Automation & Scheduler</h2>
            <p className="subtitle">Real-time Sync and Cron Jobs.</p>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
            <button className="btn btn-secondary" onClick={fetchAutomations} disabled={isLoading}>
                <RefreshCw size={18} className={isLoading ? "spin" : ""} /> Refresh
            </button>
            <button className="btn btn-primary" onClick={() => setShowAddForm(!showAddForm)}>
                <Plus size={18} /> New Automation
            </button>
        </div>
      </header>

      {showAddForm && (
        <section className="dashboard-section" style={{ marginBottom: '24px', animation: 'fadeIn 0.3s ease-out' }}>
          <h3 className="section-title">Add New Automation</h3>
          <form onSubmit={handleAddAutomation} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div className="input-group">
                <label>Name</label>
                <input type="text" className="input" value={name} onChange={e => setName(e.target.value)} placeholder="e.g., Daily Sync" />
            </div>
            <div style={{ display: 'flex', gap: '16px' }}>
                <div className="input-group" style={{ flex: 1 }}>
                    <label>Source (Chat ID / Username)</label>
                    <input type="text" className="input" value={sourceEntity} onChange={e => setSourceEntity(e.target.value)} required />
                </div>
                <div className="input-group" style={{ flex: 1 }}>
                    <label>Target (Chat ID / Username)</label>
                    <input type="text" className="input" value={targetEntity} onChange={e => setTargetEntity(e.target.value)} required />
                </div>
            </div>
            
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <input 
                    type="checkbox" 
                    id="realtime-check"
                    checked={isRealtime}
                    onChange={(e) => setIsRealtime(e.target.checked)}
                />
                <label htmlFor="realtime-check" style={{ fontWeight: 600 }}>Enable Real-Time Sync</label>
            </div>

            {!isRealtime && (
                <div className="input-group">
                    <label>Cron Expression <span style={{fontSize: '0.8rem', color: 'var(--text-muted)'}}>(Flexible for Supabase/Backend)</span></label>
                    <input type="text" className="input" value={cronExp} onChange={e => setCronExp(e.target.value)} placeholder="0 * * * *" />
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '4px' }}>e.g., "0 * * * *" for every hour.</span>
                </div>
            )}
            
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '8px' }}>
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
                {automations.map((job) => (
                    <tr key={job.id}>
                        <td style={{ fontWeight: 600 }}>{job.name}</td>
                        <td><span style={{color: 'var(--text-muted)', fontSize: '0.85rem'}}>{job.source_entity_id} &rarr; {job.target_entity_id}</span></td>
                        <td>
                            {job.is_realtime ? (
                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', color: 'var(--primary)', fontWeight: 600, fontSize: '0.8rem' }}><Clock size={14}/> Real-Time</span>
                            ) : (
                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', color: 'var(--success)', fontWeight: 600, fontSize: '0.8rem' }}><Calendar size={14}/> Cron: {job.cron_expression}</span>
                            )}
                        </td>
                        <td>
                            <span style={{ 
                                color: job.status === 'active' ? 'var(--success)' : 'var(--text-muted)', 
                                textTransform: 'uppercase', 
                                fontSize: '0.75rem', 
                                fontWeight: 700, 
                                background: job.status === 'active' ? 'rgba(16, 185, 129, 0.1)' : 'rgba(255, 255, 255, 0.05)',
                                padding: '4px 8px',
                                borderRadius: '4px'
                            }}>
                                {job.status}
                            </span>
                        </td>
                        <td style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                            {job.last_run_at || 'Never'}
                        </td>
                        <td>
                            <div style={{ display: 'flex', gap: '8px', justifyContent: 'center' }}>
                                <button 
                                    className="btn btn-secondary" 
                                    style={{ padding: '6px 10px', color: job.status === 'active' ? 'var(--danger)' : 'var(--primary)', borderColor: job.status === 'active' ? 'var(--danger)' : 'var(--primary)' }} 
                                    onClick={() => toggleStatus(job.id, job.status)} 
                                    title={job.status === 'active' ? "Pause" : "Resume"}
                                >
                                    {job.status === 'active' ? <Pause size={16} /> : <Play size={16} />}
                                </button>
                                <button className="btn btn-secondary" style={{ padding: '6px 10px', color: 'var(--text-muted)' }} onClick={() => deleteAutomation(job.id)} title="Delete">
                                    <Trash2 size={16} />
                                </button>
                            </div>
                        </td>
                    </tr>
                ))}
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
    </main>
  );
}
