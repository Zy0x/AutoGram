import { Play, Pause, Trash2, Edit3, Plus, Terminal, RefreshCw, Upload, Download, Eye } from 'lucide-react';
import { useState } from 'react';
import { RerunModal } from './RerunModal';

interface JobsListProps {
  jobs: any[];
  isLoading: boolean;
  activeCommands: {[key: number]: any};
  runResults: {[key: number]: 'success' | 'failed' | undefined};
  fetchJobs: () => void;
  importJobs: () => void;
  exportJobs: () => void;
  startJob: (job: any, isRetry?: boolean, isDryRun?: boolean, rerunMode?: string) => void;
  pauseJob: (jobId: number) => void;
  deleteJob: (jobId: number) => void;
  onNewJob: () => void;
  onViewRuntime: (job: any) => void;
  onEditJob: (job: any) => void;
}

export function JobsList({
  jobs,
  isLoading,
  activeCommands,
  runResults,
  fetchJobs,
  importJobs,
  exportJobs,
  startJob,
  pauseJob,
  deleteJob,
  onNewJob,
  onViewRuntime,
  onEditJob
}: JobsListProps) {
  const [selectedJobForRerun, setSelectedJobForRerun] = useState<any>(null);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', height: '100%' }}>
      
      <header style={{ 
          display: 'flex', 
          justifyContent: 'space-between', 
          alignItems: 'center',
          background: 'var(--bg-panel)',
          padding: '24px 32px',
          borderRadius: 'var(--radius-lg)',
          border: '1px solid var(--border)',
          backdropFilter: 'blur(12px)',
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.2)'
      }}>
          <div>
              <h1 style={{ fontSize: '2rem', fontWeight: 700, margin: '0 0 8px 0', background: 'linear-gradient(135deg, #f8fafc, #818cf8)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
                  Migration Jobs
              </h1>
              <p style={{ color: 'var(--text-muted)', margin: 0, fontSize: '0.95rem' }}>
                  Manage and monitor your automated Telegram transfers
              </p>
          </div>
          <div style={{ display: 'flex', gap: '12px' }}>
              <button className="btn btn-secondary" onClick={importJobs} title="Import Jobs">
                  <Download size={16} /> Import
              </button>
              <button className="btn btn-secondary" onClick={exportJobs} title="Export Jobs">
                  <Upload size={16} /> Export
              </button>
              <button className="btn btn-secondary" onClick={fetchJobs} disabled={isLoading} title="Refresh">
                  <RefreshCw size={16} className={isLoading ? 'spin' : ''} />
              </button>
              <button className="btn btn-primary" onClick={onNewJob} style={{ padding: '10px 24px' }}>
                  <Plus size={18} style={{ marginRight: '6px' }} /> New Job
              </button>
          </div>
      </header>

      {jobs.length === 0 && !isLoading ? (
          <div className="glass-panel" style={{ 
              flex: 1, 
              display: 'flex', 
              flexDirection: 'column', 
              alignItems: 'center', 
              justifyContent: 'center',
              padding: '64px',
              textAlign: 'center',
              borderRadius: 'var(--radius-lg)'
          }}>
              <div style={{ 
                  width: '80px', 
                  height: '80px', 
                  borderRadius: '50%', 
                  background: 'rgba(99, 102, 241, 0.1)', 
                  display: 'flex', 
                  alignItems: 'center', 
                  justifyContent: 'center',
                  marginBottom: '24px',
                  color: 'var(--primary)'
              }}>
                  <Terminal size={40} />
              </div>
              <h2 style={{ fontSize: '1.5rem', marginBottom: '12px', fontWeight: 600 }}>No Jobs Found</h2>
              <p style={{ color: 'var(--text-muted)', maxWidth: '400px', marginBottom: '24px', lineHeight: 1.6 }}>
                  You haven't created any migration jobs yet. Create your first job to start migrating content between chats.
              </p>
              <button className="btn btn-primary" onClick={onNewJob} style={{ padding: '12px 32px' }}>
                  <Plus size={18} style={{ marginRight: '8px' }} /> Create First Job
              </button>
          </div>
      ) : (
          <div style={{ 
              display: 'grid', 
              gridTemplateColumns: 'repeat(auto-fill, minmax(380px, 1fr))', 
              gridAutoRows: 'max-content',
              gap: '24px',
              paddingBottom: '24px',
              overflowY: 'auto',
              flex: 1
          }}>
              {jobs.map((job) => {
                  const isRunning = !!activeCommands[job.id];
                  const result = runResults[job.id];
                  
                  // Progress logic
                  const total = job.total_messages || 0;
                  const processed = job.processed_messages || 0;
                  
                  let percent = "0.0";
                  if (total > 0) {
                      percent = Math.min(100, (processed / total) * 100).toFixed(1);
                  } else if (processed > 0 && job.status === 'COMPLETED') {
                      percent = "100.0";
                  }

                  let statusClass = "paused";
                  let displayStatus = job.status || 'READY';
                  
                  if (isRunning) {
                      statusClass = "running";
                      displayStatus = "RUNNING";
                  } else if (result === 'success' || displayStatus === 'COMPLETED' || displayStatus === 'PARTIAL_SUCCESS') {
                      statusClass = "completed";
                      if (displayStatus === 'PARTIAL_SUCCESS') displayStatus = "PARTIAL";
                  } else if (result === 'failed' || displayStatus === 'FAILED') {
                      statusClass = "failed";
                  }

                  let parsedConfig: any = {};
                  try {
                      if (job.config_json) {
                          parsedConfig = typeof job.config_json === 'string' ? JSON.parse(job.config_json) : job.config_json;
                      }
                  } catch (e) {}
                  
                  const sourceLabel = parsedConfig.sourceName || job.source_entity_id;
                  const targetLabel = parsedConfig.destName || job.target_entity_id;

                  return (
                      <div 
                        key={job.id} 
                        className={`job-card ${statusClass}`}
                        style={{ 
                            background: 'var(--bg-panel)',
                            padding: '24px', 
                            display: 'flex', 
                            flexDirection: 'column', 
                            gap: '20px',
                            borderRadius: 'var(--radius-lg)',
                            border: '1px solid var(--border)',
                            transition: 'var(--transition-safe)',
                            position: 'relative',
                            overflow: 'hidden',
                            minHeight: 'max-content'
                        }}
                      >
                          {/* Status Indicator Bar */}
                          <div style={{
                              position: 'absolute', top: 0, left: 0, right: 0, height: '4px',
                              background: statusClass === 'running' ? 'var(--primary)' : 
                                          statusClass === 'completed' ? 'var(--success)' :
                                          statusClass === 'failed' ? 'var(--danger)' : 'var(--text-muted)'
                          }} />

                          {/* Header */}
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                              <div style={{ width: '100%' }}>
                                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                                      <h3 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 600, color: 'var(--text-main)' }}>
                                          {job.job_name || `Migration #${job.id}`}
                                      </h3>
                                      <span className={`modern-badge ${statusClass}`} style={{ fontSize: '0.75rem', fontWeight: 700, padding: '4px 10px', borderRadius: '20px', letterSpacing: '0.5px' }}>
                                          {displayStatus}
                                      </span>
                                  </div>
                                  <div style={{ 
                                      display: 'flex', 
                                      alignItems: 'center', 
                                      gap: '12px', 
                                      background: 'rgba(0,0,0,0.15)', 
                                      padding: '12px 16px', 
                                      borderRadius: 'var(--radius-md)', 
                                      marginTop: '12px',
                                      marginBottom: '12px'
                                  }}>
                                      <span style={{ flex: 1, color: 'var(--text-main)', wordBreak: 'break-word', fontSize: '0.9rem', lineHeight: '1.5' }}>
                                          {sourceLabel}
                                      </span> 
                                      <span style={{ color: 'var(--primary)', opacity: 0.8, display: 'flex', alignItems: 'center', flexShrink: 0, padding: '0 4px' }}>
                                          &rarr;
                                      </span> 
                                      <span style={{ flex: 1, color: 'var(--text-main)', wordBreak: 'break-word', fontSize: '0.9rem', lineHeight: '1.5', textAlign: 'left' }}>
                                          {targetLabel}
                                      </span>
                                  </div>
                              </div>
                          </div>

                          {/* Tags */}
                          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                              <span style={{ background: 'rgba(255, 255, 255, 0.05)', padding: '6px 12px', borderRadius: '8px', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                                  Profile: <strong style={{ color: 'var(--text-main)' }}>{job.profile_name}</strong>
                              </span>
                              <span style={{ background: 'rgba(255, 255, 255, 0.05)', padding: '6px 12px', borderRadius: '8px', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                                  Mode: <strong style={{ color: 'var(--text-main)' }}>{job.transfer_mode}</strong>
                              </span>
                          </div>

                          {/* Progress */}
                          <div style={{ marginTop: 'auto', background: 'rgba(0,0,0,0.2)', padding: '16px', borderRadius: 'var(--radius-md)' }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', marginBottom: '10px' }}>
                                  <span style={{ color: 'var(--text-muted)' }}>
                                      {processed} / {total || '?'} messages
                                  </span>
                                  <span style={{ 
                                      fontWeight: 700, 
                                      color: statusClass === "running" ? 'var(--primary)' : 
                                             statusClass === "completed" ? 'var(--success)' : 
                                             statusClass === "failed" ? 'var(--danger)' : 'var(--text-main)' 
                                  }}>
                                      {percent}%
                                  </span>
                              </div>
                              <div style={{ width: '100%', height: '8px', background: 'rgba(255,255,255,0.1)', borderRadius: '4px', overflow: 'hidden' }}>
                                  <div style={{ 
                                      width: `${percent}%`, 
                                      height: '100%', 
                                      background: statusClass === "running" ? 'var(--primary)' : 
                                                  statusClass === "completed" ? 'var(--success)' : 
                                                  statusClass === "failed" ? 'var(--danger)' : 'var(--text-muted)', 
                                      transition: 'width 0.5s cubic-bezier(0.4, 0, 0.2, 1)'
                                  }} />
                              </div>
                          </div>

                          {/* Actions */}
                          <div style={{ display: 'flex', gap: '8px', paddingTop: '16px', borderTop: '1px solid var(--border)' }}>
                              {isRunning ? (
                                  <>
                                      <button className="btn btn-secondary" style={{ flex: 1, padding: '10px', background: 'rgba(245, 158, 11, 0.1)', color: 'var(--warning)', borderColor: 'rgba(245, 158, 11, 0.3)', display: 'flex', justifyContent: 'center', alignItems: 'center', whiteSpace: 'nowrap' }} onClick={() => pauseJob(job.id)}>
                                          <Pause size={18} style={{ marginRight: '6px' }}/> Pause
                                      </button>
                                      <button className="btn btn-primary" style={{ flex: 1, padding: '10px', display: 'flex', justifyContent: 'center', alignItems: 'center', whiteSpace: 'nowrap' }} onClick={() => onViewRuntime(job)}>
                                          <Eye size={18} style={{ marginRight: '6px' }}/> Detail
                                      </button>
                                  </>
                              ) : (
                                  <>
                                        {(statusClass === 'completed' || statusClass === 'failed') ? (
                                            <button 
                                                className="btn btn-secondary" 
                                                style={{ 
                                                    flex: 1, padding: '10px',
                                                    color: 'var(--primary)',
                                                    borderColor: 'var(--primary)',
                                                    opacity: activeCommands[job.id] ? 0.5 : 1,
                                                    display: 'flex', justifyContent: 'center', alignItems: 'center', whiteSpace: 'nowrap'
                                                }} 
                                                onClick={() => setSelectedJobForRerun(job)} 
                                                title="Open Re-run options"
                                                disabled={!!activeCommands[job.id]}
                                            >
                                                <Play size={18} style={{ marginRight: '6px' }}/> Re-run
                                            </button>
                                        ) : (
                                            <button 
                                                className="btn btn-primary" 
                                                style={{ 
                                                    flex: 1, padding: '10px',
                                                    opacity: (statusClass === 'running' || activeCommands[job.id]) ? 0.5 : 1,
                                                    display: 'flex', justifyContent: 'center', alignItems: 'center', whiteSpace: 'nowrap'
                                                }} 
                                                onClick={() => startJob(job, false, false)} 
                                                title="Run Job"
                                                disabled={statusClass === 'running' || activeCommands[job.id]}
                                            >
                                                <Play size={18} style={{ marginRight: '6px' }}/> Run
                                            </button>
                                        )}
                                        <button className="btn btn-secondary" style={{ padding: '10px 14px', display: 'flex', justifyContent: 'center', alignItems: 'center' }} onClick={() => onViewRuntime(job)} title="View Job Details & Logs">
                                            <Eye size={18} />
                                        </button>
                                        <button className="btn btn-secondary" style={{ padding: '10px 14px', display: 'flex', justifyContent: 'center', alignItems: 'center' }} onClick={() => onEditJob(job)} title="Edit Configuration">
                                            <Edit3 size={18} />
                                        </button>
                                        <button className="btn btn-secondary" style={{ padding: '10px 14px', color: 'var(--danger)', borderColor: 'rgba(239, 68, 68, 0.2)', background: 'rgba(239, 68, 68, 0.05)', display: 'flex', justifyContent: 'center', alignItems: 'center' }} onClick={() => deleteJob(job.id)} title="Delete Job">
                                            <Trash2 size={18} />
                                        </button>
                                  </>
                              )}
                          </div>
                      </div>
                  );
              })}
          </div>
      )}

      {selectedJobForRerun && (
          <RerunModal 
              jobName={selectedJobForRerun.job_name || `Migration #${selectedJobForRerun.id}`}
              successCount={selectedJobForRerun.processed_messages || 0}
              onClose={() => setSelectedJobForRerun(null)}
              onConfirm={(mode) => {
                  const job = selectedJobForRerun;
                  setSelectedJobForRerun(null);
                  startJob(job, true, false, mode);
              }}
          />
      )}
    </div>
  );
}
