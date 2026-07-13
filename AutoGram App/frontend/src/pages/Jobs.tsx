import { useState, useEffect } from 'react';
import { Command } from '@tauri-apps/plugin-shell';
import { JobsList } from '../components/Jobs/JobsList';
import { JobEditor } from '../components/Jobs/JobEditor';
import { JobRuntime } from '../components/Jobs/JobRuntime';

export type WorkspaceMode = 'list' | 'editor' | 'runtime';

export function Jobs() {
  const [mode, setMode] = useState<WorkspaceMode>('list');
  const [jobs, setJobs] = useState<any[]>([]);
  const [activeJobId, setActiveJobId] = useState<number | null>(null);
  const activeJob = jobs.find(j => j.id === activeJobId);
  const [editingJob, setEditingJob] = useState<any>(null);

  const [isLoading, setIsLoading] = useState(false);
  
  // Track running processes and their logs
  const [activeCommands, setActiveCommands] = useState<{[key: number]: any}>({});
  const [jobLogs, setJobLogs] = useState<{[key: number]: any[]}>({});
  const [runResults, setRunResults] = useState<{[key: number]: 'success' | 'failed' | undefined}>({});

  const fetchJobs = async () => {
    setIsLoading(true);
    try {
      const command = Command.create('python', ['../../worker/daemon.py', '--action', 'list-jobs']);
      const result = await command.execute();
      
      let jsonOutput = "";
      if (result.stdout.includes('[JSON_OUTPUT]')) {
        const parts = result.stdout.split('[JSON_OUTPUT]');
        jsonOutput = parts[parts.length - 1].trim();
      }
      
      if (jsonOutput) {
        setJobs(JSON.parse(jsonOutput));
      }
    } catch (err) {
      console.error("Failed to fetch jobs", err);
      // alert("Failed to fetch jobs: " + err); // optional
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchJobs();
  }, []);

  const startJob = async (job: any, isRetry = false, isDryRun = false, rerunMode?: string) => {
    if (activeCommands[job.id]) {
        alert("This job is already running.");
        return;
    }
    
    setRunResults(prev => ({...prev, [job.id]: undefined}));
    
    try {
        const apiId = localStorage.getItem('API_ID') || "";
        const apiHash = localStorage.getItem('API_HASH') || "";
        
        const action = isRetry ? 'retry-execution' : 'execute-job';
        const targetId = isRetry ? (job.last_execution_id || job.id) : job.id;
        const args = [
            '../../worker/daemon.py', 
            `--action=${action}`,
            `--job-id=${targetId}`
        ];
        
        if (apiId) args.push(`--api-id=${apiId}`);
        if (apiHash) args.push(`--api-hash=${apiHash}`);
        if (isDryRun) args.push('--dry-run');
        if (rerunMode) args.push(`--rerun-mode=${rerunMode}`);
        
        const command = Command.create('python', args);

        // Reset logs
        setJobLogs(prev => ({ ...prev, [job.id]: [] }));

        command.stderr.on('data', line => {
            if (!line.trim()) return;
            setJobLogs(prev => {
                const existing = prev[job.id] || [];
                return { ...prev, [job.id]: [...existing.slice(-99), { type: 'error', text: line, time: new Date().toLocaleTimeString() }] };
            });
        });
        
        command.stdout.on('data', line => {
            if (!line.trim()) return;
            
            if (line.includes('[EVENT]')) {
                try {
                    const jsonStr = line.split('[EVENT]')[1].trim();
                    const ev = JSON.parse(jsonStr);
                    
                    // Unified Centralized Execution Store Updater
                    setJobs(prevJobs => prevJobs.map(j => {
                        if (j.id !== job.id) return j;
                        
                        let updated = { ...j };
                        const p = ev.payload || ev;
                        
                        switch (ev.type) {
                            case 'ExecutionCreated':
                                updated.status = 'READY';
                                break;
                            case 'ExecutionStarting':
                                updated.status = 'STARTING';
                                break;
                            case 'ExecutionStarted':
                                updated.status = 'RUNNING';
                                break;
                            case 'ProgressUpdated':
                                updated.processed_messages = p.processed || updated.processed_messages;
                                updated.total_messages = p.total || updated.total_messages;
                                break;
                            case 'ExecutionFinished':
                                updated.status = p.final_state || p.status;
                                updated.processed_messages = p.processed;
                                updated.total_messages = p.total;
                                setRunResults(prev => ({...prev, [job.id]: 'success'}));
                                break;
                            case 'FatalError':
                                updated.status = 'FAILED';
                                setRunResults(prev => ({...prev, [job.id]: 'failed'}));
                                break;
                        }
                        return updated;
                    }));
                    
                    setJobLogs(prev => {
                        const existing = prev[job.id] || [];
                        return { ...prev, [job.id]: [...existing.slice(-99), { type: 'event', data: ev, time: new Date().toLocaleTimeString() }] };
                    });
                } catch(e) {
                    setJobLogs(prev => {
                        const existing = prev[job.id] || [];
                        return { ...prev, [job.id]: [...existing.slice(-99), { type: 'info', text: line, time: new Date().toLocaleTimeString() }] };
                    });
                    
                    if (line.toLowerCase().includes('error') || line.toLowerCase().includes('traceback')) {
                        setJobs(prevJobs => prevJobs.map(j => {
                            if (j.id !== job.id) return j;
                            return { ...j, status: 'FAILED' };
                        }));
                        setRunResults(prev => ({...prev, [job.id]: 'failed'}));
                    }
                }
            } else {
                setJobLogs(prev => {
                    const existing = prev[job.id] || [];
                    return { ...prev, [job.id]: [...existing.slice(-99), { type: 'info', text: line, time: new Date().toLocaleTimeString() }] };
                });
            }
        });

        command.on('close', data => {
            setActiveCommands(prev => {
                const next = {...prev};
                delete next[job.id];
                return next;
            });
            
            setRunResults(prev => {
                // If it wasn't already marked success by ExecutionFinished
                if (prev[job.id] === 'success') return prev;
                return { ...prev, [job.id]: data.code === 0 ? 'success' : 'failed' };
            });
            
            // fetchJobs() removed to rely purely on Events
        });
        
        const childProc = await command.spawn();
        setActiveCommands(prev => ({...prev, [job.id]: childProc}));
        
        // Auto switch to runtime mode
        setActiveJobId(job.id);
        setMode('runtime');
        
    } catch (err) {
        console.error("Failed to start job", err);
        alert(`Failed to start job: ${err}`);
        setActiveCommands(prev => {
            const next = {...prev};
            delete next[job.id];
            return next;
        });
    }
  };

  const handleCreateJob = async (config: any) => {
    try {
        const args = [
            '../../worker/daemon.py', 
            editingJob ? '--action=edit-job' : '--action=create-job'
        ];
        if (editingJob) { args.push(`--job-id=${editingJob.id}`); }
        
        // Use generic placeholders for missing things that UI used to force
        // The actual config is what matters
        args.push(`--source=${config.source || '0'}`);
        args.push(`--destination=${config.destination || '0'}`);
        args.push(`--session=${config.session || 'Lavender'}`);
        args.push(`--mode=${config.mode || 'Clean Copy'}`);
        
        const b64Config = btoa(unescape(encodeURIComponent(JSON.stringify(config))));
        args.push(`--config=${b64Config}`);
        
        const command = Command.create('python', args);
        const result = await command.execute();
        
        if (editingJob) {
            setEditingJob(null);
            await fetchJobs();
            if (config.dryRun) {
                const j = jobs.find(x => x.id === editingJob.id);
                if (j) { setActiveJobId(j.id); startJob(j, false, true); }
                return;
            }
            setMode('list');
            return;
        }

        let newJobId = null;
        if (result.stdout.includes('[JOB_ID]')) {
            const parts = result.stdout.split('[JOB_ID]');
            newJobId = parseInt(parts[1].trim());
        }
        
        await fetchJobs();
        
        if (newJobId) {
            const c2 = Command.create('python', ['../../worker/daemon.py', '--action', 'list-jobs']);
            const res2 = await c2.execute();
            if (res2.stdout.includes('[JSON_OUTPUT]')) {
                const parts = res2.stdout.split('[JSON_OUTPUT]');
                const fetchedJobs = JSON.parse(parts[parts.length - 1].trim());
                setJobs(fetchedJobs);
                const newlyCreatedJob = fetchedJobs.find((j: any) => j.id === newJobId);
                if (newlyCreatedJob) {
                    startJob(newlyCreatedJob, false, config.dryRun === true);
                    return;
                }
            }
        }
        
        setMode('list');
    } catch (err) {
        console.error("Failed to create job", err);
        alert(`Failed to create job: ${err}`);
    }
  };

  const deleteJob = async (jobId: number) => {
      if (!confirm("Are you sure you want to delete this job and its execution history?")) return;
      try {
          if (activeCommands[jobId]) {
              await activeCommands[jobId].kill();
          }
          const command = Command.create('python', ['../../worker/daemon.py', '--action', 'delete-job', '--job-id', String(jobId)]);
          await command.execute();
          if (activeJob && activeJob.id === jobId) {
              setMode('list');
              setActiveJobId(null);
          }
          fetchJobs();
      } catch (err) {
          console.error("Failed to delete job", err);
          alert("Failed to delete job");
      }
  };

  const freshStartJob = async (jobId: number) => {
      try {
          const command = Command.create('python', ['../../worker/daemon.py', '--action', 'fresh-start', '--job-id', String(jobId)]);
          await command.execute();
          fetchJobs();
          alert("History mapping berhasil dihapus. Job direset ke posisi 0.");
      } catch (err) {
          console.error("Failed to fresh start job", err);
          alert("Gagal melakukan fresh start.");
      }
  };

  const pauseJob = async (jobId: number) => {
      try {
          if (activeCommands[jobId]) {
              await activeCommands[jobId].kill();
          }
          const command = Command.create('python', ['../../worker/daemon.py', '--action', 'set-status', '--job-id', String(jobId), '--status', 'paused']);
          await command.execute();
          setActiveCommands(prev => {
              const next = {...prev};
              delete next[jobId];
              return next;
          });
          setTimeout(fetchJobs, 500);
      } catch (err) {
          console.error("Failed to pause job", err);
      }
  };

  const exportJobs = async () => {
      try {
        const command = Command.create('python', ['../../worker/daemon.py', '--action', 'export-jobs']);
        await command.execute();
        alert("Jobs exported successfully to worker directory!");
      } catch (err) {
        console.error("Failed to export jobs", err);
      }
  };

  const importJobs = async () => {
      if (!confirm("Import jobs from jobs_export.json?")) return;
      try {
        const command = Command.create('python', ['../../worker/daemon.py', '--action', 'import-jobs']);
        await command.execute();
        fetchJobs();
        alert("Jobs imported successfully!");
      } catch (err) {
        console.error("Failed to import jobs", err);
      }
  };

  return (
    <main className="main-content" style={{ padding: mode === 'editor' || mode === 'runtime' ? '0' : '24px', display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
        {mode === 'list' && (
            <JobsList 
                jobs={jobs}
                isLoading={isLoading}
                activeCommands={activeCommands}
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
            <div style={{ height: '100%', overflowY: 'auto' }}>
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
            <div style={{ height: '100%' }}>
                <JobRuntime 
                    job={activeJob} 
                    activeCommand={activeCommands[activeJob.id]}
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
