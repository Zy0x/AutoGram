import { Play, Pause, Terminal, ArrowLeft, RefreshCw, AlertCircle, CheckCircle, Info, Download, Trash2, Edit3, Zap, Clock } from 'lucide-react';
import { useState, useEffect, useMemo } from 'react';
import { Command } from '@tauri-apps/plugin-shell';
import { isTauri } from '@tauri-apps/api/core';
import { save } from '@tauri-apps/plugin-dialog';
import { writeTextFile } from '@tauri-apps/plugin-fs';
import { RerunModal } from './RerunModal';
import { FreshStartModal } from './FreshStartModal';
import { JobDetailsModal } from './JobDetailsModal';

interface JobRuntimeProps {
  job: any;
  activeCommand: any;
  logs: any[];
  onBack: () => void;
  pauseJob: (jobId: number) => void;
  startJob: (job: any, isRetry?: boolean, isDryRun?: boolean, rerunMode?: string) => void;
  freshStartJob: (jobId: number) => void;
  onEditJob: (job: any) => void;
  runResult?: 'success' | 'failed';
}

export function JobRuntime({
  job,
  activeCommand,
  logs,
  onBack,
  pauseJob,
  startJob,
  freshStartJob,
  onEditJob,
  runResult
}: JobRuntimeProps) {
  const [historicalLogs, setHistoricalLogs] = useState<string | null>(null);
  const [isFetchingLogs, setIsFetchingLogs] = useState(false);
  const [showRerunModal, setShowRerunModal] = useState(false);
  const [showFreshStartModal, setShowFreshStartModal] = useState(false);
  const [showDetailsModal, setShowDetailsModal] = useState(false);
  
  useEffect(() => {
    if (logs.length === 0 && !activeCommand && job?.id) {
        setIsFetchingLogs(true);
        const fetchLogs = async () => {
            try {
                const cmd = Command.create('python', ['../../worker/daemon.py', '--action', 'get-logs', '--job-id', String(job.id)]);
                const res = await cmd.execute();
                let jsonOutput = "";
                if (res.stdout.includes('[JSON_OUTPUT]')) {
                    const parts = res.stdout.split('[JSON_OUTPUT]');
                    jsonOutput = parts[parts.length - 1].trim();
                }
                if (jsonOutput) {
                    const parsed = JSON.parse(jsonOutput);
                    if (parsed.status === 'success' && parsed.logs) {
                        setHistoricalLogs(parsed.logs);
                    }
                }
            } catch (err) {
                console.error("Failed to fetch historical logs", err);
            } finally {
                setIsFetchingLogs(false);
            }
        };
        fetchLogs();
    }
  }, [logs.length, activeCommand, job?.id]);

  const parsedHistoricalLogs = useMemo(() => {
      if (!historicalLogs) return null;
      const lines = historicalLogs.split('\n');
      const parsed = [];
      for (const line of lines) {
          if (!line.trim()) continue;
          let type = 'info';
          let time = '';
          let text = line;
          let data = null;

          if (line.includes('[EVENT]')) {
              type = 'event';
              try {
                  const parts = line.split('[EVENT]');
                  const jsonStr = parts[parts.length - 1].trim();
                  data = JSON.parse(jsonStr);
                  if (data.timestamp) {
                      time = new Date(data.timestamp).toLocaleTimeString([], {hour12: false});
                  }
              } catch (e: any) {
                  console.error("Failed to parse historical log event:", e, line);
                  type = 'error';
                  text = `[PARSE ERROR] ${e.message} | ${line}`;
              }
          } else if (line.includes('[ERROR]')) {
              type = 'error';
              const parts = line.split('[ERROR]');
              text = parts[parts.length - 1].trim();
              const timeMatch = line.match(/\[(.*?)\]/);
              if (timeMatch) time = timeMatch[1];
          } else if (line.includes('[INFO]')) {
              type = 'info';
              const parts = line.split('[INFO]');
              text = parts[parts.length - 1].trim();
              const timeMatch = line.match(/\[(.*?)\]/);
              if (timeMatch) time = timeMatch[1];
          }

          parsed.push({ type, time, text, data });
      }
      return parsed;
  }, [historicalLogs]);

  const displayLogs = (logs && logs.length > 0) ? logs : (parsedHistoricalLogs || []);

  const handleExportLogs = async () => {
      let contentToExport = "";
      
      if (historicalLogs) {
          contentToExport = historicalLogs;
      } else if (logs.length > 0) {
          contentToExport = logs.map(l => {
              if (l.type === 'error') return `[${l.time}] [ERROR] ${l.text}`;
              if (l.type === 'info') return `[${l.time}] [INFO] ${l.text}`;
              if (l.type === 'event') {
                  const ev = l.data || l.event;
                  return `[${l.time}] [EVENT] ${JSON.stringify(ev)}`;
              }
              return `[${l.time}] ${JSON.stringify(l)}`;
          }).join('\n');
      }
      
      if (!contentToExport) return;
      
      const defaultFileName = `job_${job.id}_logs.txt`;

      if (isTauri()) {
          try {
              const filePath = await save({
                  defaultPath: defaultFileName,
                  filters: [{
                      name: 'Text Document',
                      extensions: ['txt']
                  }]
              });
              if (filePath) {
                  await writeTextFile(filePath, contentToExport);
              }
          } catch (e) {
              console.error("Failed to save log file:", e);
          }
      } else {
          // Web fallback
          const blob = new Blob([contentToExport], { type: 'text/plain' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = defaultFileName;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
      }
  };

  const isRunning = !!activeCommand;
  
  const total = job.total_messages || 0;
  const processed = job.processed_messages || 0;
  
  let percent = "0.0";
  if (total > 0) {
      percent = Math.min(100, (processed / total) * 100).toFixed(1);
  } else if (processed > 0 && job.status === 'COMPLETED') {
      percent = "100.0";
  }

  let successCount = 0;
  let skippedCount = 0;
  let failedCount = 0;
  let speed = "0.0";
  let eta = "--:--:--";
  
  if (displayLogs && displayLogs.length > 0) {
      for (let i = displayLogs.length - 1; i >= 0; i--) {
          const l = displayLogs[i];
          if (l.type === 'event') {
              const ev = l.data || l.event;
              if (ev) {
                  const p = ev.payload || ev;
                  if (ev.type === 'ProgressUpdated' || ev.type === 'ExecutionFinished') {
                      if (p.success !== undefined) successCount = p.success;
                      if (p.skipped !== undefined) skippedCount = p.skipped;
                      if (p.failed !== undefined) failedCount = p.failed;
                      if (p.speed !== undefined) speed = typeof p.speed === 'number' ? p.speed.toFixed(1) : p.speed;
                      if (p.eta !== undefined) eta = p.eta;
                      if (successCount > 0 || skippedCount > 0 || failedCount > 0) break;
                  }
              }
          }
      }
  }
  
  let statusClass = "paused";
  let displayStatus = job.status || 'READY';
  let fallbackTriggered = false;

  if (displayLogs && displayLogs.length > 0) {
      for (let i = 0; i < displayLogs.length; i++) {
          const l = displayLogs[i];
          if (l.type === 'event' && l.data) {
              const ev = l.data.payload || l.data;
              if (ev.message === 'Beralih ke Clean Copy Speed karena restriksi') {
                  fallbackTriggered = true;
              }
          }
      }
  }
  
  if (isRunning) {
      statusClass = "running";
      displayStatus = "RUNNING";
  } else if (runResult === 'success' || displayStatus === 'COMPLETED' || displayStatus === 'PARTIAL_SUCCESS') {
      statusClass = "completed";
      if (displayStatus === 'PARTIAL_SUCCESS') displayStatus = "PARTIAL";
  } else if (runResult === 'failed' || displayStatus === 'FAILED') {
      statusClass = "failed";
  }

  let pulseClass = "warning";
  if (isRunning) pulseClass = "primary";
  else if (statusClass === "completed") pulseClass = "success";
  else if (statusClass === "failed") pulseClass = "danger";

  let parsedConfig: any = {};
  try {
      if (job.config_json) {
          parsedConfig = typeof job.config_json === 'string' ? JSON.parse(job.config_json) : job.config_json;
      }
  } catch (e) {
      console.error("Failed to parse config json", e);
  }
  const sourceLabel = parsedConfig.sourceName || job.source_entity_id;
  const targetLabel = parsedConfig.destName || job.target_entity_id;

  return (
    <div style={{ padding: '32px', display: 'flex', flexDirection: 'column', height: '100%', gap: '24px' }}>
      {/* Header section */}
      <header className="glass-panel" style={{ 
          padding: '24px 32px', 
          display: 'flex', 
          justifyContent: 'space-between', 
          alignItems: 'flex-start',
          borderRadius: 'var(--radius-lg)'
      }}>
        <div>
          <button className="btn btn-secondary" onClick={onBack} style={{ marginBottom: '16px', background: 'rgba(255,255,255,0.05)', border: 'none' }}>
            <ArrowLeft size={16} style={{ marginRight: '6px' }} /> Back to Jobs
          </button>
          <h2 style={{ margin: 0, fontSize: '2rem', fontWeight: 700, color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: '16px' }}>
            {job.job_name || `Migration #${job.id}`}
            <span className={`modern-badge ${statusClass}`} style={{ fontSize: '0.85rem', padding: '6px 12px' }}>
                <div className={`pulse-indicator ${pulseClass}`}></div>
                {displayStatus}
            </span>
          </h2>
          <div style={{ display: 'flex', gap: '16px', marginTop: '16px', alignItems: 'center' }}>
            <span style={{ fontSize: '1rem', color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: '8px', background: 'rgba(0,0,0,0.3)', padding: '8px 16px', borderRadius: 'var(--radius-md)' }}>
              <span>{sourceLabel}</span> 
              <span style={{ color: 'var(--primary)', opacity: 0.8 }}>&rarr;</span> 
              <span>{targetLabel}</span>
            </span>
            <span style={{ fontSize: '0.9rem', color: 'var(--text-muted)', background: 'rgba(255,255,255,0.05)', padding: '8px 16px', borderRadius: 'var(--radius-md)', display: 'flex', alignItems: 'center', gap: '12px' }}>
              <span style={{ whiteSpace: 'nowrap' }}>Mode: <strong style={{ color: 'var(--text-main)' }}>{job.transfer_mode}</strong></span>
              <span style={{ opacity: 0.3 }}>|</span>
              <span style={{ whiteSpace: 'nowrap' }}>Progress: <strong style={{ color: 'var(--text-main)' }}>{job.processed_messages?.toLocaleString()}/{job.total_messages?.toLocaleString()}</strong></span>
              <span style={{ opacity: 0.3 }}>|</span>
              <span style={{ whiteSpace: 'nowrap' }}>Failed: <strong style={{ color: failedCount > 0 ? 'var(--danger)' : 'var(--success)' }}>{failedCount}</strong></span>
            </span>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '8px' }}>
          <div style={{ display: 'flex', gap: '12px', padding: '16px', background: 'rgba(255,255,255,0.02)', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.06)', alignItems: 'center' }}>
            <div style={{ display: 'flex', gap: '8px' }}>
              {statusClass === 'running' && (
                <button className="btn btn-secondary" style={{ padding: '10px 20px', fontSize: '1rem', whiteSpace: 'nowrap', color: 'var(--warning)', borderColor: 'rgba(245, 158, 11, 0.3)', background: 'rgba(245, 158, 11, 0.1)' }} onClick={() => pauseJob(job.id)}>
                  <Pause size={18} style={{ marginRight: '8px' }} /> Pause
                </button>
              )}

              {statusClass === 'paused' && (
                <button className="btn btn-primary" style={{ padding: '10px 20px', fontSize: '1rem', whiteSpace: 'nowrap' }} onClick={() => startJob(job)}>
                  <Play size={18} style={{ marginRight: '8px' }} /> Resume
                </button>
              )}

              {(statusClass === 'failed' || (statusClass === 'completed' && failedCount > 0)) && (
                <button className="btn btn-primary" style={{ padding: '10px 20px', fontSize: '1rem', whiteSpace: 'nowrap', background: 'var(--primary)', color: 'white', borderColor: 'var(--primary)' }} onClick={() => startJob(job, true)} title={`Fix ${failedCount} messages that failed in the last run`}>
                  <RefreshCw size={18} style={{ marginRight: '8px' }} /> Retry Failed {failedCount > 0 && `(${failedCount})`}
                </button>
              )}
            </div>

            <div style={{ display: 'flex', gap: '8px', marginLeft: 'auto' }}>
              {statusClass === 'completed' && (
                <button className={`btn ${failedCount > 0 ? 'btn-secondary' : 'btn-primary'}`} style={{ padding: '10px 20px', fontSize: '1rem', whiteSpace: 'nowrap', borderColor: failedCount > 0 ? 'var(--primary)' : undefined, color: failedCount > 0 ? 'var(--primary)' : undefined }} onClick={() => setShowRerunModal(true)}>
                  <Play size={18} style={{ marginRight: '8px' }} /> Re-run
                </button>
              )}
            </div>

            {statusClass === 'completed' && (
              <div style={{ display: 'flex', gap: '8px', marginLeft: '24px', borderLeft: '1px solid rgba(255,0,0,0.1)', paddingLeft: '24px' }}>
                <button className="btn btn-secondary" style={{ padding: '10px 20px', fontSize: '1rem', whiteSpace: 'nowrap', color: 'var(--danger)', borderColor: 'rgba(239, 68, 68, 0.5)' }} onClick={() => setShowFreshStartModal(true)}>
                  <Trash2 size={18} style={{ marginRight: '8px' }} /> Fresh Start
                </button>
              </div>
            )}
          </div>

          <div style={{ display: 'flex', gap: '8px' }}>
            <button onClick={() => setShowDetailsModal(true)} title="View Config Details" style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', padding: '8px 12px', fontSize: '14px', cursor: 'pointer', display: 'flex', alignItems: 'center' }} onMouseEnter={(e) => e.currentTarget.style.color = 'var(--text-main)'} onMouseLeave={(e) => e.currentTarget.style.color = 'var(--text-muted)'}>
              <Info size={14} style={{ marginRight: '6px' }} /> Config Details
            </button>
            <button onClick={() => onEditJob(job)} title="Edit Configuration" style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', padding: '8px 12px', fontSize: '14px', cursor: 'pointer', display: 'flex', alignItems: 'center' }} onMouseEnter={(e) => e.currentTarget.style.color = 'var(--text-main)'} onMouseLeave={(e) => e.currentTarget.style.color = 'var(--text-muted)'}>
              <Edit3 size={14} style={{ marginRight: '6px' }} /> Edit Config
            </button>
            <button onClick={handleExportLogs} title="Export Audit Logs" style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', padding: '8px 12px', fontSize: '14px', cursor: 'pointer', display: 'flex', alignItems: 'center' }} onMouseEnter={(e) => e.currentTarget.style.color = 'var(--text-main)'} onMouseLeave={(e) => e.currentTarget.style.color = 'var(--text-muted)'}>
              <Download size={14} style={{ marginRight: '6px' }} /> Export Logs
            </button>
          </div>
        </div>
      </header>

      {showRerunModal && (
          <RerunModal 
              jobName={job.job_name || `Migration #${job.id}`}
              successCount={successCount}
              onClose={() => setShowRerunModal(false)}
              onConfirm={(mode) => {
                  setShowRerunModal(false);
                  startJob(job, true, false, mode);
              }}
          />
      )}

      {showFreshStartModal && (
          <FreshStartModal 
              jobName={job.job_name || `Migration #${job.id}`}
              onClose={() => setShowFreshStartModal(false)}
              onConfirm={() => {
                  setShowFreshStartModal(false);
                  freshStartJob(job.id);
                  onBack();
              }}
          />
      )}

      {showDetailsModal && (
          <JobDetailsModal
              job={job}
              fallbackTriggered={fallbackTriggered}
              onClose={() => setShowDetailsModal(false)}
          />
      )}

      {/* Progress Stats */}
      <div className="glass-panel" style={{ padding: '24px 32px', borderRadius: 'var(--radius-lg)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '16px', fontSize: '1.1rem', fontWeight: 600 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <span style={{ color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div style={{ padding: '8px', background: 'rgba(99, 102, 246, 0.15)', borderRadius: '10px', color: 'var(--primary)' }}>
                  <Play size={18} />
                </div>
                Overall Progress
              </span>
              <div style={{ display: 'flex', gap: '16px', fontSize: '0.85rem', fontWeight: 500, marginTop: '4px' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--success)' }}>
                      <CheckCircle size={14} /> {successCount} Success
                  </span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--warning)' }}>
                      <Info size={14} /> {skippedCount} Skipped
                  </span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--danger)' }}>
                      <AlertCircle size={14} /> {failedCount} Failed
                  </span>
              </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '4px' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '12px' }}>
              <span style={{ fontSize: '1.5rem', color: 'var(--primary)', fontWeight: 700 }}>{percent}%</span>
              <span style={{ color: 'var(--text-muted)', fontSize: '1rem', fontWeight: 500 }}>
                ({processed} / {total || '?'})
              </span>
            </div>
            {statusClass === 'running' && (
              <div style={{ display: 'flex', gap: '16px', fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <Zap size={14} color="var(--warning)" /> {speed} msg/s
                </span>
                <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <Clock size={14} color="var(--primary)" /> ETA: {eta}
                </span>
              </div>
            )}
          </div>
        </div>
        <div style={{ width: '100%', height: '12px', background: 'rgba(0,0,0,0.3)', borderRadius: '6px', overflow: 'hidden' }}>
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

      {/* Live Logs */}
      <div className="glass-panel" style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', padding: 0, borderRadius: 'var(--radius-lg)' }}>
        <h3 style={{ display: 'flex', alignItems: 'center', gap: '12px', margin: 0, padding: '20px 32px', borderBottom: '1px solid var(--border)', background: 'rgba(0,0,0,0.2)' }}>
          <div style={{ padding: '8px', background: 'rgba(139, 92, 246, 0.15)', borderRadius: '10px', color: 'var(--accent)', display: 'flex' }}>
            <Terminal size={18} />
          </div>
          <span style={{ fontSize: '1.2rem', fontWeight: 600 }}>Execution Logs</span>
        </h3>
        
        <div style={{ flex: 1, overflowY: 'auto', padding: '24px 32px', fontSize: '0.95rem', lineHeight: '1.6', background: 'rgba(0, 0, 0, 0.4)', fontFamily: 'JetBrains Mono, monospace' }}>
          {displayLogs && displayLogs.length > 0 ? (
            displayLogs.map((log, idx) => {
                if (log.type === 'event') {
                    const ev = log.data || log.event;
                    if (!ev) return null;
                    let icon = <Info size={14} />;
                    let color = 'var(--text-main)';
                    let text = JSON.stringify(ev);
                    
                    const p = ev.payload || ev;
                    
                    if (ev.type === 'TaskCompleted') {
                        icon = <CheckCircle size={14} />;
                        color = 'var(--success)';
                        text = `[Success] Task ${p.task_id} completed -> ${p.target_message_id}`;
                    } else if (ev.type === 'TaskFailed') {
                        icon = <AlertCircle size={14} />;
                        color = 'var(--danger)';
                        text = `[Error] Task ${p.task_id} failed: ${p.error}`;
                    } else if (ev.type === 'TaskSkipped') {
                        color = 'var(--warning)';
                        text = `[Skip] Task ${p.task_id} skipped: ${p.reason}`;
                    } else if (ev.type === 'ProgressUpdated') {
                        color = 'var(--primary)';
                        text = `[Progress] ${p.processed}/${p.total} (Current ID: ${p.current_id})`;
                    } else if (ev.type === 'ExecutionCreated') {
                        color = 'var(--accent)';
                        text = `[System] Execution Created (Job: ${p.jobId})`;
                    } else if (ev.type === 'ExecutionStarting') {
                        color = 'var(--accent)';
                        text = `[System] Execution Starting (Exec ID: ${p.execution_id})`;
                    } else if (ev.type === 'EngineInitialized' || ev.type === 'ExecutionStarted') {
                        color = 'var(--accent)';
                        text = `[System] ${ev.type} (Limit: ${p.limit || 'N/A'})`;
                    } else if (ev.type === 'StateTransition') {
                        color = 'var(--accent)';
                        text = `[State] ${p.from_state} -> ${p.to_state}`;
                    } else if (ev.type === 'ExecutionFinished') {
                        icon = p.final_state === 'COMPLETED' ? <CheckCircle size={14} /> : <AlertCircle size={14} />;
                        color = p.final_state === 'COMPLETED' ? 'var(--success)' : 'var(--warning)';
                        text = `[Finished] State: ${p.final_state}`;
                    } else if (ev.type === 'FatalError') {
                        icon = <AlertCircle size={14} />;
                        color = 'var(--danger)';
                        text = `[FATAL] ${p.error}`;
                    } else {
                        text = `[Event] ${ev.type}`;
                    }

                    return (
                        <div key={idx} style={{ marginBottom: '8px', color, display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
                            <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem', paddingTop: '2px', minWidth: '80px' }}>{log.time}</span>
                            <span style={{ paddingTop: '3px' }}>{icon}</span>
                            <span style={{ wordBreak: 'break-word', flex: 1 }}>
                                <details className="log-details" style={{ cursor: 'pointer' }}>
                                    <summary style={{ outline: 'none' }}>{text}</summary>
                                    <pre style={{ margin: '8px 0 0 0', padding: '12px', background: 'rgba(0,0,0,0.3)', borderRadius: '4px', fontSize: '0.85rem', overflowX: 'auto', color: 'var(--text-muted)' }}>
                                        {JSON.stringify(ev, null, 2)}
                                    </pre>
                                </details>
                            </span>
                        </div>
                    );
                } else if (log.type === 'error') {
                    let summaryText = log.text;
                    let detailText = log.text;
                    if (log.text.includes('|')) {
                        const parts = log.text.split('|');
                        summaryText = parts[0].trim();
                        detailText = parts.slice(1).join('|').trim();
                    } else if (log.text.length > 80) {
                        summaryText = log.text.substring(0, 80) + '...';
                    }

                    return (
                        <div key={idx} style={{ marginBottom: '8px', color: 'var(--danger)', display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
                            <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem', paddingTop: '2px', minWidth: '80px' }}>{log.time}</span>
                            <span style={{ paddingTop: '3px' }}><AlertCircle size={14} /></span>
                            <span style={{ wordBreak: 'break-word', flex: 1 }}>
                                <details className="log-details" style={{ cursor: 'pointer' }}>
                                    <summary style={{ outline: 'none' }}>[STDERR] {summaryText}</summary>
                                    <pre style={{ margin: '8px 0 0 0', padding: '12px', background: 'rgba(0,0,0,0.3)', borderRadius: '4px', fontSize: '0.85rem', overflowX: 'auto', color: 'var(--danger)', whiteSpace: 'pre-wrap' }}>
                                        {detailText}
                                    </pre>
                                </details>
                            </span>
                        </div>
                    );
                } else {
                    return (
                        <div key={idx} style={{ marginBottom: '8px', color: 'var(--text-muted)', display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
                            <span style={{ fontSize: '0.8rem', paddingTop: '2px', minWidth: '80px' }}>{log.time}</span>
                            <span style={{ paddingTop: '3px', opacity: 0.5 }}><Info size={14} /></span>
                            <span style={{ wordBreak: 'break-word', flex: 1 }}>{log.text}</span>
                        </div>
                    );
                }
            })
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-muted)', opacity: 0.5, gap: '16px' }}>
              <Terminal size={48} style={{ opacity: 0.2 }} />
              <p style={{ margin: 0 }}>{isFetchingLogs ? "Fetching historical logs..." : "No logs available for this session"}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
