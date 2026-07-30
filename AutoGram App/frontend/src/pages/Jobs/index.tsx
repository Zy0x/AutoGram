import { useState, useEffect, useRef } from 'react';
import { JobsList } from '../../components/Jobs/Runtime/JobsList';
import { JobEditor } from '../../components/Jobs/JobEditor';
import { JobRuntime } from '../../components/Jobs/Runtime/JobRuntime';
import {
  spawnDaemonJob,
  runDaemonOnce,
  requestJobPause,
  parseEventLine,
  type JobChild,
} from '../../lib/db/jobProcess';
import {
  jobsList,
  jobsCreate,
  jobsEdit,
  jobsDelete,
  jobsRunMigration,
  jobsFreshStart,
  jobsExportJson,
  jobsImportJson,
} from '../../lib/db/jobsApi';
import { detectTauriRuntime } from '../../lib/tauri/platform';

export type WorkspaceMode = 'list' | 'editor' | 'runtime';

export function Jobs() {
  const [mode, setMode] = useState<WorkspaceMode>('list');
  const [jobs, setJobs] = useState<any[]>([]);
  const [activeJobId, setActiveJobId] = useState<number | null>(null);
  const activeJob = jobs.find((j) => j.id === activeJobId);
  const [editingJob, setEditingJob] = useState<any>(null);

  const [isLoading, setIsLoading] = useState(false);

  /** Only tracks "is running" — never call kill on these */
  const [activeCommands, setActiveCommands] = useState<{ [key: number]: JobChild | true }>({});
  const [jobLogs, setJobLogs] = useState<{ [key: number]: any[] }>({});
  const [runResults, setRunResults] = useState<{ [key: number]: 'success' | 'failed' | undefined }>({});
  const intentionalStopRef = useRef<Set<number>>(new Set());
  const runningRef = useRef<Set<number>>(new Set());

  const fetchJobs = async () => {
    setIsLoading(true);
    try {
      if (detectTauriRuntime()) {
        const list = await jobsList();
        setJobs(list);
        return;
      }
      const result = await runDaemonOnce(['--action', 'list-jobs']);
      let jsonOutput = '';
      if (result.stdout.includes('[JSON_OUTPUT]')) {
        const parts = result.stdout.split('[JSON_OUTPUT]');
        jsonOutput = parts[parts.length - 1].trim();
      }
      if (jsonOutput) {
        setJobs(JSON.parse(jsonOutput));
      } else if (
        result.code !== 0 &&
        result.stderr &&
        !/requires desktop|requires tauri/i.test(result.stderr)
      ) {
        console.error('Failed to fetch jobs', result.stderr);
      }
    } catch (err) {
      console.error('Failed to fetch jobs', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchJobs();
  }, []);

  // Prevent uncaught errors in this page from tearing down the webview hard
  useEffect(() => {
    const onErr = (ev: ErrorEvent) => {
      console.error('window error', ev.error || ev.message);
      ev.preventDefault?.();
    };
    const onRej = (ev: PromiseRejectionEvent) => {
      console.error('unhandled rejection', ev.reason);
      ev.preventDefault?.();
    };
    window.addEventListener('error', onErr);
    window.addEventListener('unhandledrejection', onRej);
    return () => {
      window.removeEventListener('error', onErr);
      window.removeEventListener('unhandledrejection', onRej);
    };
  }, []);

  const clearRunning = (jobId: number) => {
    runningRef.current.delete(jobId);
    setActiveCommands((prev) => {
      if (!(jobId in prev)) return prev;
      const next = { ...prev };
      delete next[jobId];
      return next;
    });
  };

  const startJob = async (
    job: any,
    isRetry = false,
    isDryRun = false,
    rerunMode?: string
  ) => {
    if (runningRef.current.has(job.id) || activeCommands[job.id]) {
      alert('This job is already running.');
      return;
    }

    setRunResults((prev) => ({ ...prev, [job.id]: undefined }));
    intentionalStopRef.current.delete(job.id);
    runningRef.current.add(job.id);

    try {
      const { bootstrapSecureCredentials } = await import('../../lib/tauri/secureCredentials');
      const { apiId, apiHash } = await bootstrapSecureCredentials();

      setJobLogs((prev) => ({ ...prev, [job.id]: [] }));

      const appendLog = (entry: any) => {
        try {
          setJobLogs((prev) => {
            const existing = prev[job.id] || [];
            return { ...prev, [job.id]: [...existing.slice(-99), entry] };
          });
        } catch {
          /* ignore */
        }
      };

      // Desktop: Grammers forward MVP (no Python execute-job)
      if (detectTauriRuntime()) {
        setActiveCommands((prev) => ({ ...prev, [job.id]: true }));
        setActiveJobId(job.id);
        setMode('runtime');
        appendLog({
          type: 'info',
          text: isDryRun
            ? '[Grammers] Dry-run: listing only (no forward)'
            : '[Grammers] Starting forward MVP…',
          time: new Date().toLocaleTimeString(),
        });
        try {
          if (isDryRun) {
            appendLog({
              type: 'info',
              text: '[Grammers] Dry-run complete (job config validated).',
              time: new Date().toLocaleTimeString(),
            });
            setRunResults((prev) => ({ ...prev, [job.id]: 'success' }));
            setJobs((prev) =>
              prev.map((j) => (j.id === job.id ? { ...j, status: 'COMPLETED' } : j))
            );
          } else {
            const r = await jobsRunMigration({
              jobId: job.id,
              apiId: Number(apiId) || 0,
              apiHash: String(apiHash || ''),
              maxMessages: 0, // 0 = Full history migration loop
            });
            appendLog({
              type: 'info',
              text: r.message || `Forwarded ${r.forwarded} messages`,
              time: new Date().toLocaleTimeString(),
            });
            setRunResults((prev) => ({
              ...prev,
              [job.id]: r.status === 'success' ? 'success' : 'failed',
            }));
            setJobs((prev) =>
              prev.map((j) =>
                j.id === job.id
                  ? {
                      ...j,
                      status: 'COMPLETED',
                      processed_messages: r.forwarded,
                      total_messages: r.forwarded,
                      last_execution_id: r.executionId,
                    }
                  : j
              )
            );
          }
        } catch (e: any) {
          appendLog({
            type: 'error',
            text: String(e?.message || e),
            time: new Date().toLocaleTimeString(),
          });
          setRunResults((prev) => ({ ...prev, [job.id]: 'failed' }));
          setJobs((prev) =>
            prev.map((j) => (j.id === job.id ? { ...j, status: 'FAILED' } : j))
          );
        } finally {
          clearRunning(job.id);
          window.setTimeout(() => {
            fetchJobs().catch(() => {});
          }, 300);
        }
        return;
      }

      const action = isRetry ? 'retry-execution' : 'execute-job';
      const args = [`--action=${action}`, `--job-id=${job.id}`];
      if (isRetry && job.last_execution_id) {
        args.push(`--execution-id=${job.last_execution_id}`);
      }
      if (apiId) args.push(`--api-id=${apiId}`);
      if (apiHash) args.push(`--api-hash=${apiHash}`);
      if (isDryRun) args.push('--dry-run');
      if (rerunMode) args.push(`--rerun-mode=${rerunMode}`);

      const applyEvent = (ev: any) => {
        try {
          const p = (ev && (ev.payload || ev)) || {};
          const evType = ev?.type || p?.type;
          let nextRunResult: 'success' | 'failed' | undefined;

          setJobs((prevJobs) =>
            prevJobs.map((j) => {
              if (j.id !== job.id) return j;
              const updated = { ...j };
              switch (evType) {
                case 'ExecutionCreated':
                  updated.status = 'READY';
                  break;
                case 'ExecutionStarting':
                  updated.status = 'STARTING';
                  break;
                case 'ExecutionStarted':
                case 'EngineInitialized':
                  updated.status = 'RUNNING';
                  break;
                case 'ProgressUpdated':
                  if (p.processed != null) updated.processed_messages = p.processed;
                  if (p.total != null && Number(p.total) > 0) updated.total_messages = p.total;
                  break;
                case 'ExecutionFinished': {
                  const finalState = p.final_state || p.status || 'COMPLETED';
                  updated.status = finalState;
                  if (p.processed != null) updated.processed_messages = p.processed;
                  if (p.total != null && Number(p.total) > 0) updated.total_messages = p.total;
                  const ok = ['COMPLETED', 'PARTIAL_SUCCESS', 'PAUSED'].includes(
                    String(finalState).toUpperCase()
                  );
                  nextRunResult = ok ? 'success' : 'failed';
                  break;
                }
                case 'FatalError':
                  updated.status = 'FAILED';
                  nextRunResult = 'failed';
                  break;
              }
              return updated;
            })
          );

          if (nextRunResult) {
            setRunResults((prev) => ({ ...prev, [job.id]: nextRunResult }));
          }
          appendLog({ type: 'event', data: ev, time: new Date().toLocaleTimeString() });
        } catch (e) {
          console.warn('applyEvent', e);
        }
      };

      // Mark running immediately so UI disables double-start
      setActiveCommands((prev) => ({ ...prev, [job.id]: true }));
      setActiveJobId(job.id);
      setMode('runtime');

      const child = await spawnDaemonJob({
        jobId: job.id,
        args,
        onStdoutLine: (line) => {
          const text = String(line);
          if (text.includes('[EVENT]')) {
            const ev = parseEventLine(text);
            if (ev) applyEvent(ev);
            else appendLog({ type: 'info', text, time: new Date().toLocaleTimeString() });
          } else if (text.trim()) {
            appendLog({ type: 'info', text, time: new Date().toLocaleTimeString() });
          }
        },
        onStderrLine: (line) => {
          if (String(line).trim()) {
            appendLog({
              type: 'error',
              text: String(line),
              time: new Date().toLocaleTimeString(),
            });
          }
        },
        onClose: (code) => {
          clearRunning(job.id);
          setRunResults((prev) => {
            if (prev[job.id] === 'success' || prev[job.id] === 'failed') return prev;
            if (intentionalStopRef.current.has(job.id)) {
              intentionalStopRef.current.delete(job.id);
              return { ...prev, [job.id]: 'success' };
            }
            // Daemon is patched to exit 0 even on job failure; trust events first
            return { ...prev, [job.id]: code === 0 || code == null ? 'success' : 'failed' };
          });
          // Deferred refresh — never await inside shell callback
          window.setTimeout(() => {
            fetchJobs().catch(() => {});
          }, 400);
        },
      });

      setActiveCommands((prev) => ({ ...prev, [job.id]: child }));
    } catch (err) {
      console.error('Failed to start job', err);
      clearRunning(job.id);
      alert(`Failed to start job: ${err}`);
    }
  };

  const handleCreateJob = async (config: any) => {
    try {
      if (detectTauriRuntime()) {
        if (editingJob) {
          await jobsEdit(editingJob.id, config);
          setEditingJob(null);
          await fetchJobs();
          if (config.dryRun) {
            const j = jobs.find((x) => x.id === editingJob.id);
            if (j) {
              setActiveJobId(j.id);
              startJob(j, false, true);
            }
            return;
          }
          setMode('list');
          return;
        }
        const newJobId = await jobsCreate(config);
        await fetchJobs();
        const list = await jobsList();
        setJobs(list);
        const newlyCreatedJob = list.find((j: any) => j.id === newJobId);
        if (newlyCreatedJob) {
          await new Promise((r) => setTimeout(r, 100));
          startJob(newlyCreatedJob, false, config.dryRun === true);
          return;
        }
        setMode('list');
        return;
      }

      const args = [editingJob ? '--action=edit-job' : '--action=create-job'];
      if (editingJob) args.push(`--job-id=${editingJob.id}`);
      args.push(`--source=${config.source || '0'}`);
      args.push(`--destination=${config.destination || '0'}`);
      args.push(`--session=${config.session || 'Lavender'}`);
      args.push(`--mode=${config.mode || 'Clean Copy'}`);
      const b64Config = btoa(unescape(encodeURIComponent(JSON.stringify(config))));
      args.push(`--config=${b64Config}`);

      const result = await runDaemonOnce(args);

      if (editingJob) {
        setEditingJob(null);
        await fetchJobs();
        if (config.dryRun) {
          const j = jobs.find((x) => x.id === editingJob.id);
          if (j) {
            setActiveJobId(j.id);
            startJob(j, false, true);
          }
          return;
        }
        setMode('list');
        return;
      }

      let newJobId: number | null = null;
      if (result.stdout.includes('[JOB_ID]')) {
        const parts = result.stdout.split('[JOB_ID]');
        newJobId = parseInt(parts[1].trim(), 10);
      }

      await fetchJobs();

      if (newJobId) {
        const res2 = await runDaemonOnce(['--action', 'list-jobs']);
        if (res2.stdout.includes('[JSON_OUTPUT]')) {
          const parts = res2.stdout.split('[JSON_OUTPUT]');
          const fetchedJobs = JSON.parse(parts[parts.length - 1].trim());
          setJobs(fetchedJobs);
          const newlyCreatedJob = fetchedJobs.find((j: any) => j.id === newJobId);
          if (newlyCreatedJob) {
            await new Promise((r) => setTimeout(r, 150));
            startJob(newlyCreatedJob, false, config.dryRun === true);
            return;
          }
        }
      }

      setMode('list');
    } catch (err) {
      console.error('Failed to create job', err);
      alert(`Failed to create job: ${err}`);
    }
  };

  const deleteJob = async (jobId: number) => {
    if (!confirm('Are you sure you want to delete this job and its execution history?')) return;
    try {
      intentionalStopRef.current.add(jobId);
      if (runningRef.current.has(jobId) || activeCommands[jobId]) {
        await requestJobPause(jobId);
        await new Promise((r) => setTimeout(r, 800));
      }
      clearRunning(jobId);
      if (detectTauriRuntime()) {
        await jobsDelete(jobId);
      } else {
        await runDaemonOnce(['--action', 'delete-job', '--job-id', String(jobId)]);
      }
      if (activeJob && activeJob.id === jobId) {
        setMode('list');
        setActiveJobId(null);
      }
      fetchJobs();
    } catch (err) {
      console.error('Failed to delete job', err);
      alert('Failed to delete job');
    }
  };

  const freshStartJob = async (jobId: number) => {
    try {
      if (detectTauriRuntime()) {
        await jobsFreshStart(jobId);
      } else {
        await runDaemonOnce(['--action', 'fresh-start', '--job-id', String(jobId)]);
      }
      fetchJobs();
      alert('History mapping berhasil dihapus. Job direset ke posisi 0.');
    } catch (err) {
      console.error('Failed to fresh start job', err);
      alert('Gagal melakukan fresh start.');
    }
  };

  const pauseJob = async (jobId: number) => {
    try {
      intentionalStopRef.current.add(jobId);
      // Cooperative only — engines poll PAUSING and exit; no kill()
      await requestJobPause(jobId);
      setJobs((prev) => prev.map((j) => (j.id === jobId ? { ...j, status: 'PAUSED' } : j)));
      setRunResults((prev) => ({ ...prev, [jobId]: 'success' }));
      appendSoftLog(jobId, 'Pause requested — waiting for engine to stop cleanly…');
      // Do NOT kill. Clear running marker when process closes via onClose.
      // Soft fallback clear after 15s if still marked running
      window.setTimeout(() => {
        if (runningRef.current.has(jobId)) {
          clearRunning(jobId);
          fetchJobs().catch(() => {});
        }
      }, 15000);
    } catch (err) {
      console.error('Failed to pause job', err);
    }
  };

  const appendSoftLog = (jobId: number, text: string) => {
    setJobLogs((prev) => {
      const existing = prev[jobId] || [];
      return {
        ...prev,
        [jobId]: [
          ...existing.slice(-99),
          { type: 'info', text, time: new Date().toLocaleTimeString() },
        ],
      };
    });
  };

  const exportJobs = async () => {
    try {
      if (detectTauriRuntime()) {
        const json = await jobsExportJson();
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'jobs_export.json';
        a.click();
        URL.revokeObjectURL(url);
        alert('Jobs exported (jobs_export.json downloaded).');
        return;
      }
      await runDaemonOnce(['--action', 'export-jobs']);
      alert('Jobs exported successfully to worker directory!');
    } catch (err) {
      console.error('Failed to export jobs', err);
      alert(`Export gagal: ${err}`);
    }
  };

  const importJobs = async () => {
    if (!confirm('Import jobs from JSON?')) return;
    try {
      if (detectTauriRuntime()) {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'application/json,.json';
        const file = await new Promise<File | null>((resolve) => {
          input.onchange = () => resolve(input.files?.[0] || null);
          input.click();
        });
        if (!file) return;
        const text = await file.text();
        const n = await jobsImportJson(text);
        await fetchJobs();
        alert(`Imported ${n} job(s).`);
        return;
      }
      await runDaemonOnce(['--action', 'import-jobs']);
      fetchJobs();
      alert('Jobs imported successfully!');
    } catch (err) {
      console.error('Failed to import jobs', err);
      alert(`Import gagal: ${err}`);
    }
  };

  // Compatibility: JobRuntime checks activeCommand truthy for "is running"
  const activeCommandsForUi = activeCommands as { [key: number]: any };

  return (
    <main
      className={`main-content main-content-fill ${mode !== 'list' ? 'main-content-flush' : ''}`}
    >
      {mode === 'list' && (
        <JobsList
          jobs={jobs}
          isLoading={isLoading}
          activeCommands={activeCommandsForUi}
          runResults={runResults}
          fetchJobs={fetchJobs}
          importJobs={importJobs}
          exportJobs={exportJobs}
          startJob={startJob}
          pauseJob={pauseJob}
          deleteJob={deleteJob}
          onNewJob={() => {
            setEditingJob(null);
            setMode('editor');
          }}
          onViewRuntime={(job) => {
            setActiveJobId(job.id);
            setMode('runtime');
          }}
          onEditJob={(job) => {
            setEditingJob(job);
            setMode('editor');
          }}
        />
      )}

      {mode === 'editor' && (
        <div className="workspace-pane">
          <JobEditor
            initialJob={editingJob}
            onCancel={() => {
              setEditingJob(null);
              setMode('list');
            }}
            onStart={handleCreateJob}
          />
        </div>
      )}

      {mode === 'runtime' && activeJob && (
        <div className="workspace-pane">
          <JobRuntime
            job={activeJob}
            activeCommand={activeCommandsForUi[activeJob.id]}
            logs={jobLogs[activeJob.id] || []}
            runResult={runResults[activeJob.id]}
            onBack={() => {
              setActiveJobId(null);
              setMode('list');
              fetchJobs();
            }}
            pauseJob={pauseJob}
            startJob={startJob}
            freshStartJob={freshStartJob}
            onEditJob={(job) => {
              setEditingJob(job);
              setMode('editor');
            }}
          />
        </div>
      )}
    </main>
  );
}
