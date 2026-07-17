import { Play, Pause, Terminal, ArrowLeft, RefreshCw, AlertCircle, CheckCircle, Info, Download, Trash2, Edit3, Zap, Clock } from 'lucide-react';
import { useState, useEffect, useMemo } from 'react';
import { runDaemonOnce } from '../../lib/workerBridge';

import { isDesktop } from '../../lib/platform';
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
                const res = await runDaemonOnce([
                  '--action', 'get-logs',
                  '--job-id', String(job.id),
                ]);
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

      if (isDesktop()) {
          try {
              const { save } = await import('@tauri-apps/plugin-dialog');
              const { writeTextFile } = await import('@tauri-apps/plugin-fs');
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

  const formatEta = (raw: any): string => {
      if (raw === null || raw === undefined || raw === '') return '--:--:--';
      if (typeof raw === 'string' && raw.includes(':')) return raw;
      const sec = Number(raw);
      if (!Number.isFinite(sec) || sec < 0) return '--:--:--';
      const h = Math.floor(sec / 3600);
      const m = Math.floor((sec % 3600) / 60);
      const s = Math.floor(sec % 60);
      return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };
  
  if (displayLogs && displayLogs.length > 0) {
      for (let i = displayLogs.length - 1; i >= 0; i--) {
          const l = displayLogs[i];
          if (l.type === 'event') {
              const ev = l.data || l.event;
              if (ev) {
                  const p = ev.payload || ev;
                  if (ev.type === 'ProgressUpdated' || p.type === 'ProgressUpdated' || ev.type === 'ExecutionFinished' || p.type === 'ExecutionFinished') {
                      if (p.success !== undefined) successCount = p.success;
                      if (p.skipped !== undefined) skippedCount = p.skipped;
                      if (p.failed !== undefined) failedCount = p.failed;
                      if (p.speed !== undefined) speed = typeof p.speed === 'number' ? p.speed.toFixed(1) : p.speed;
                      if (p.eta !== undefined && p.eta !== null) eta = formatEta(p.eta);
                      if (successCount > 0 || skippedCount > 0 || failedCount > 0 || p.processed !== undefined) break;
                  }
              }
          }
      }
  }
  
  let fallbackTriggered = false;
  let fallbackReason = '';

  if (displayLogs && displayLogs.length > 0) {
      for (let i = 0; i < displayLogs.length; i++) {
          const l = displayLogs[i];
          if (l.type === 'event' && (l.data || l.event)) {
              const raw = l.data || l.event;
              const ev = raw.payload || raw;
              const t = raw.type || ev.type;
              if (t === 'FallbackTriggered' || ev.type === 'FallbackTriggered') {
                  fallbackTriggered = true;
                  fallbackReason = ev.reason || raw.reason || '';
              }
              // Legacy string match (older logs)
              if (typeof ev.message === 'string' && ev.message.toLowerCase().includes('beralih ke clean copy')) {
                  fallbackTriggered = true;
                  if (!fallbackReason) fallbackReason = ev.message;
              }
          }
      }
  }

  // Prefer DB status over stale runResult (e.g. PAUSED must not become green COMPLETED)
  const statusUpper = String(job.status || 'READY').toUpperCase();
  let statusClass = "paused";
  let displayStatus = job.status || 'READY';

  if (isRunning) {
      statusClass = "running";
      displayStatus = "RUNNING";
  } else if (statusUpper === 'PAUSED' || statusUpper === 'PAUSING') {
      statusClass = "paused";
      displayStatus = "PAUSED";
  } else if (statusUpper === 'FAILED' || runResult === 'failed') {
      statusClass = "failed";
      displayStatus = "FAILED";
  } else if (statusUpper === 'COMPLETED') {
      statusClass = "completed";
      displayStatus = "COMPLETED";
  } else if (statusUpper === 'PARTIAL_SUCCESS' || statusUpper === 'PARTIAL') {
      statusClass = "completed";
      displayStatus = "PARTIAL";
  } else if (runResult === 'success') {
      statusClass = "completed";
      displayStatus = "COMPLETED";
  } else if (statusUpper === 'READY' || statusUpper === 'STARTING') {
      statusClass = "paused";
      displayStatus = statusUpper;
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
    <div className="runtime-view">
      <header className="glass-panel runtime-header">
        <div className="runtime-header-main">
          <button type="button" className="btn btn-secondary" onClick={onBack} style={{ marginBottom: '12px', background: 'rgba(255,255,255,0.05)', border: 'none' }}>
            <ArrowLeft size={16} /> Back to Jobs
          </button>
          <h2 className="runtime-title">
            {job.job_name || `Migration #${job.id}`}
            <span className={`modern-badge ${statusClass}`}>
              <div className={`pulse-indicator ${pulseClass}`} />
              {displayStatus}
            </span>
          </h2>
          <div className="runtime-meta">
            <span className="runtime-meta-chip">
              <span>{sourceLabel}</span>
              <span style={{ color: 'var(--primary)', opacity: 0.8 }}>&rarr;</span>
              <span>{targetLabel}</span>
            </span>
            <span className="runtime-meta-stats">
              <span>
                Mode:{' '}
                <strong style={{ color: fallbackTriggered ? 'var(--warning)' : 'var(--text-main)' }}>
                  {fallbackTriggered
                    ? `${job.transfer_mode || 'Fast Forward'} → Clean Copy`
                    : (job.transfer_mode || '—')}
                </strong>
                {fallbackTriggered && (
                  <span
                    title={fallbackReason || 'Fell back due to forward restriction'}
                    style={{ marginLeft: 6, fontSize: '0.75rem', color: 'var(--warning)' }}
                  >
                    (fallback)
                  </span>
                )}
              </span>
              <span style={{ opacity: 0.3 }}>|</span>
              <span>Progress: <strong style={{ color: 'var(--text-main)' }}>{job.processed_messages?.toLocaleString()}/{job.total_messages?.toLocaleString()}</strong></span>
              <span style={{ opacity: 0.3 }}>|</span>
              <span>OK: <strong style={{ color: 'var(--success)' }}>{successCount}</strong></span>
              <span style={{ opacity: 0.3 }}>|</span>
              <span>Skip: <strong>{skippedCount}</strong></span>
              <span style={{ opacity: 0.3 }}>|</span>
              <span>Failed: <strong style={{ color: failedCount > 0 ? 'var(--danger)' : 'var(--success)' }}>{failedCount}</strong></span>
              {isRunning && (
                <>
                  <span style={{ opacity: 0.3 }}>|</span>
                  <span>Speed: <strong>{speed}</strong>/s</span>
                  <span style={{ opacity: 0.3 }}>|</span>
                  <span>ETA: <strong>{eta}</strong></span>
                </>
              )}
            </span>
          </div>
        </div>

        <div className="runtime-actions">
          <div className="runtime-action-group action-group">
            <div className="primary-actions">
              {statusClass === 'running' && (
                <button type="button" className="btn btn-secondary btn-warning-soft" onClick={() => pauseJob(job.id)} title="Jeda eksekusi">
                  <Pause size={18} /> Pause
                </button>
              )}
              {/* PAUSED → Resume = execute-job (lanjut checkpoint / skip verified) */}
              {(statusClass === 'paused' && statusUpper !== 'READY' && statusUpper !== 'STARTING') && (
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => startJob(job, false, false)}
                  title="Lanjutkan dari checkpoint / pesan yang belum selesai"
                >
                  <Play size={18} /> Resume
                </button>
              )}
              {(statusClass === 'paused' && (statusUpper === 'READY' || statusUpper === 'STARTING' || !job.status)) && (
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => startJob(job, false, false)}
                  title="Jalankan migrasi"
                >
                  <Play size={18} /> Run
                </button>
              )}
              {/* FAILED → retry-execution RESUME (hanya yang gagal) */}
              {statusClass === 'failed' && (
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => startJob(job, true, false, 'RESUME')}
                  title={`Retry failed messages (retry-execution)${failedCount > 0 ? ` — ${failedCount} failed` : ''}`}
                >
                  <RefreshCw size={18} /> Retry Failed {failedCount > 0 && `(${failedCount})`}
                </button>
              )}
            </div>
            <div className="secondary-actions">
              {/* COMPLETED / PARTIAL / FAILED → full Re-run modal */}
              {(statusClass === 'completed' || statusClass === 'failed') && (
                <button
                  type="button"
                  className={`btn ${failedCount > 0 && statusClass === 'completed' ? 'btn-secondary btn-primary-outline' : statusClass === 'failed' ? 'btn-secondary btn-primary-outline' : 'btn-primary'}`}
                  onClick={() => setShowRerunModal(true)}
                  title="Re-run: RESUME / OVERWRITE / SMART_SYNC"
                >
                  <Play size={18} /> Re-run
                </button>
              )}
            </div>
            {statusClass === 'completed' && (
              <div className="danger-actions">
                <button type="button" className="btn btn-secondary btn-danger-soft" onClick={() => setShowFreshStartModal(true)}>
                  <Trash2 size={18} /> Fresh Start
                </button>
              </div>
            )}
          </div>
          <div className="runtime-secondary-actions">
            <button type="button" className="btn-tertiary" onClick={() => setShowDetailsModal(true)} title="View Config Details">
              <Info size={14} /> Config Details
            </button>
            <button type="button" className="btn-tertiary" onClick={() => onEditJob(job)} title="Edit Configuration">
              <Edit3 size={14} /> Edit Config
            </button>
            <button type="button" className="btn-tertiary" onClick={handleExportLogs} title="Export Audit Logs">
              <Download size={14} /> Export Logs
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
                  // Always retry-execution with explicit rerun mode from modal
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

      <div className="glass-panel runtime-progress-panel">
        <div className="runtime-progress-head">
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', minWidth: 0 }}>
            <span style={{ color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: '10px', fontWeight: 600 }}>
              <div style={{ padding: '8px', background: 'rgba(99, 102, 246, 0.15)', borderRadius: '10px', color: 'var(--primary)', flexShrink: 0 }}>
                <Play size={18} />
              </div>
              Overall Progress
            </span>
            <div className="runtime-progress-counts">
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
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '4px', minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.75rem', flexWrap: 'wrap' }}>
              <span style={{ fontSize: 'var(--fs-xl)', color: 'var(--primary)', fontWeight: 700 }}>{percent}%</span>
              <span style={{ color: 'var(--text-muted)', fontWeight: 500 }}>
                ({processed} / {total || '?'})
              </span>
            </div>
            {statusClass === 'running' && (
              <div className="runtime-progress-counts" style={{ color: 'var(--text-muted)' }}>
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
        <div className="job-progress-track" style={{ height: 12 }}>
          <div
            className={`job-progress-bar status-bg-${statusClass}`}
            style={{ width: `${percent}%` }}
          />
        </div>
      </div>

      <div className="glass-panel runtime-logs">
        <h3 className="runtime-logs-title">
          <div style={{ padding: '8px', background: 'rgba(139, 92, 246, 0.15)', borderRadius: '10px', color: 'var(--accent)', display: 'flex', flexShrink: 0 }}>
            <Terminal size={18} />
          </div>
          <span style={{ fontSize: 'var(--fs-lg)', fontWeight: 600 }}>Execution Logs</span>
        </h3>

        <div className="runtime-logs-body">
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
                        <div key={idx} className="log-line" style={{ color }}>
                            <span className="log-time">{log.time}</span>
                            <span style={{ paddingTop: '3px', flexShrink: 0 }}>{icon}</span>
                            <span className="log-text">
                                <details className="log-details" style={{ cursor: 'pointer' }}>
                                    <summary style={{ outline: 'none' }}>{text}</summary>
                                    <pre style={{ margin: '8px 0 0 0', padding: '12px', background: 'rgba(0,0,0,0.3)', borderRadius: '4px', fontSize: '0.85rem', overflowX: 'auto', color: 'var(--text-muted)', whiteSpace: 'pre-wrap' }}>
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
                        <div key={idx} className="log-line" style={{ color: 'var(--danger)' }}>
                            <span className="log-time">{log.time}</span>
                            <span style={{ paddingTop: '3px', flexShrink: 0 }}><AlertCircle size={14} /></span>
                            <span className="log-text">
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
                        <div key={idx} className="log-line" style={{ color: 'var(--text-muted)' }}>
                            <span className="log-time">{log.time}</span>
                            <span style={{ paddingTop: '3px', opacity: 0.5, flexShrink: 0 }}><Info size={14} /></span>
                            <span className="log-text">{log.text}</span>
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
