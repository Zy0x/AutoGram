import { useState, useRef, useEffect } from 'react';
import { Search, FolderGit2, Play, RefreshCcw, X, Hash, Users, Radio, User, Bot, Plus, Save, Trash2, Settings } from 'lucide-react';
import { Command } from '@tauri-apps/plugin-shell';
import { useTranslation } from 'react-i18next';
import { Select } from '../../components/Select';
import { InfoTooltip } from '../../components/InfoTooltip';
import { CaptionModal } from './CaptionModal';

export function JobEditor({ onCancel, onStart, initialJob}: { onCancel: () => void, onStart: (config: any) => void, initialJob?: any }) {
  const { t } = useTranslation();
          
  // Auto-Discovery States
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalTarget, setModalTarget] = useState<'source'|'dest'>('source');
  const [dialogs, setDialogs] = useState<any[]>([]);
  const [topics, setTopics] = useState<any[]>([]);
  const [sessions, setSessions] = useState<{name: string, status: string}[]>([]);
  const [selectedSession, setSelectedSession] = useState<string>("");
  const [isLoadingDialogs, setIsLoadingDialogs] = useState(false);
  const [selectedDialogId, setSelectedDialogId] = useState<string | null>(null);
  const [dialogFilter, setDialogFilter] = useState<string>('All');

  const [isCaptionModalOpen, setIsCaptionModalOpen] = useState(false);
  
  // Profile Management for Jobs
  interface JobProfile {
    name: string;
    config: any;
  }
  const [jobProfiles, setJobProfiles] = useState<JobProfile[]>([]);
  const [selectedJobProfile, setSelectedJobProfile] = useState('');
  const [newJobProfileName, setNewJobProfileName] = useState('');

  useEffect(() => {
    const saved = localStorage.getItem('autogram_job_profiles');
    if (saved) {
      try {
        setJobProfiles(JSON.parse(saved));
      } catch (e) {}
    }
  }, []);

  const handleSaveJobProfile = () => {
    if (!newJobProfileName.trim()) return;
    const configToSave = {
      jobName, selectedSession, sourceValue, sourceName, destValue, destName,
      mode, fetchDirection, captionRule, dupAction, enableLimit, limit,
      enableSizeFilter, sizeMin, sizeMax, enableThrottle, delayMin, delayMax,
      autoFallback, hideTrace, enableCaptionRule, customCaption
    };
    const newProfiles = [...jobProfiles.filter(p => p.name !== newJobProfileName.trim()), { name: newJobProfileName.trim(), config: configToSave }];
    setJobProfiles(newProfiles);
    localStorage.setItem('autogram_job_profiles', JSON.stringify(newProfiles));
    setNewJobProfileName('');
    setSelectedJobProfile(newJobProfileName.trim());
  };

  const handleLoadJobProfile = (profileName: string) => {
    setSelectedJobProfile(profileName);
    const p = jobProfiles.find(x => x.name === profileName);
    if (p && p.config) {
      const c = p.config;
      if (c.jobName !== undefined) setJobName(c.jobName);
      if (c.selectedSession !== undefined) setSelectedSession(c.selectedSession);
      if (c.sourceValue !== undefined) setSourceValue(c.sourceValue);
      if (c.sourceName !== undefined) setSourceName(c.sourceName);
      if (c.destValue !== undefined) setDestValue(c.destValue);
      if (c.destName !== undefined) setDestName(c.destName);
      if (c.mode !== undefined) setMode(c.mode);
      if (c.qualityMode !== undefined) setQualityMode(c.qualityMode);
      if (c.fetchDirection !== undefined) setFetchDirection(c.fetchDirection);
      if (c.captionRule !== undefined) setCaptionRule(c.captionRule);
      if (c.dupAction !== undefined) setDupAction(c.dupAction);
      if (c.enableLimit !== undefined) setEnableLimit(c.enableLimit);
      if (c.limit !== undefined) setLimit(c.limit);
      if (c.enableSizeFilter !== undefined) setEnableSizeFilter(c.enableSizeFilter);
      if (c.sizeMin !== undefined) setSizeMin(c.sizeMin);
      if (c.sizeMax !== undefined) setSizeMax(c.sizeMax);
      if (c.enableThrottle !== undefined) setEnableThrottle(c.enableThrottle);
      if (c.delayMin !== undefined) setDelayMin(c.delayMin);
      if (c.delayMax !== undefined) setDelayMax(c.delayMax);
      if (c.autoFallback !== undefined) setAutoFallback(c.autoFallback);
      if (c.hideTrace !== undefined) setHideTrace(c.hideTrace);
      if (c.enableCaptionRule !== undefined) setEnableCaptionRule(c.enableCaptionRule);
      if (c.customCaption !== undefined) setCustomCaption(c.customCaption);
    }
  };

  const handleDeleteJobProfile = () => {
    if (!selectedJobProfile) return;
    const newProfiles = jobProfiles.filter(p => p.name !== selectedJobProfile);
    setJobProfiles(newProfiles);
    localStorage.setItem('autogram_job_profiles', JSON.stringify(newProfiles));
    setSelectedJobProfile('');
  };

  
  // Profile Template States
      
  // Form values state
  const [currentStep, setCurrentStep] = useState(1);


  useEffect(() => {
    if (initialJob) {
        if (initialJob.job_name) setJobName(initialJob.job_name);
        
        if (initialJob.config_json) {
            try {
                const c = typeof initialJob.config_json === 'string' ? JSON.parse(initialJob.config_json) : initialJob.config_json;
                if (c.jobName !== undefined) setJobName(c.jobName);
                if (c.session !== undefined) setSelectedSession(c.session);
                else if (c.selectedSession !== undefined) setSelectedSession(c.selectedSession);
                
                if (c.source !== undefined) setSourceValue(c.source);
                else if (c.sourceValue !== undefined) setSourceValue(c.sourceValue);
                
                if (c.sourceName !== undefined) setSourceName(c.sourceName);
                
                if (c.destination !== undefined) setDestValue(c.destination);
                else if (c.destValue !== undefined) setDestValue(c.destValue);
                
                if (c.destName !== undefined) setDestName(c.destName);
                if (c.mode !== undefined) setMode(c.mode);
                if (c.qualityMode !== undefined) setQualityMode(c.qualityMode);
                if (c.fetchDirection !== undefined) setFetchDirection(c.fetchDirection);
                if (c.captionRule !== undefined) setCaptionRule(c.captionRule);
                if (c.dupAction !== undefined) setDupAction(c.dupAction);
                
                if (c.limit !== undefined) {
                    setLimit(c.limit);
                    setEnableLimit(c.limit > 0);
                }
                
                if (c.size_min !== undefined) setSizeMin(c.size_min);
                if (c.size_max !== undefined && c.size_max !== null) setSizeMax(c.size_max === Infinity ? 0 : c.size_max);
                if (c.size_min > 0 || (c.size_max !== undefined && c.size_max !== Infinity && c.size_max !== null)) {
                    setEnableSizeFilter(true);
                }
                
                if (c.delayMin !== undefined) setDelayMin(c.delayMin);
                if (c.delayMax !== undefined) setDelayMax(c.delayMax);
                if (c.delayMin !== undefined || c.delayMax !== undefined) {
                    setEnableThrottle(true);
                }
                
                if (c.autoFallback !== undefined) setAutoFallback(c.autoFallback);
                if (c.customCaption !== undefined) setCustomCaption(c.customCaption);
            } catch (e) {}
        }
    }
  }, [initialJob]);
  const [sourceValue, setSourceValue] = useState("");
  const [sourceName, setSourceName] = useState("");
  const [destValue, setDestValue] = useState("");
  const [destName, setDestName] = useState("");
  const [jobName, setJobName] = useState("");
  const [errors, setErrors] = useState<{[key: string]: string}>({});

  const [limit, setLimit] = useState<number | string>(5);
  const [sizeMin, setSizeMin] = useState<number | string>(0);
  const [sizeMax, setSizeMax] = useState<number | string>(0);
  const [autoFallback, setAutoFallback] = useState<boolean>(true);
  const [customCaption, setCustomCaption] = useState<string>("");
  const [startDate, setStartDate] = useState<string>("");
  const [endDate, setEndDate] = useState<string>("");
  const [delayMin, setDelayMin] = useState<number | string>(2);
  const [delayMax, setDelayMax] = useState<number | string>(5);
  
  const step2Ref = useRef<HTMLDivElement>(null);
  const step3Ref = useRef<HTMLDivElement>(null);
  const step4Ref = useRef<HTMLDivElement>(null);
  
  const [captionRule, setCaptionRule] = useState('Keep Original');
  const [mode, setMode] = useState("Fast Forward");
  const [cleanCopySubMode, setCleanCopySubMode] = useState<'Speed' | 'Safe'>('Speed');
  const [qualityMode, setQualityMode] = useState("SMART");
  const [fetchDirection, setFetchDirection] = useState("Oldest First");
  const [dupAction, setDupAction] = useState("Skip");
  const [albumHandling, setAlbumHandling] = useState('Follow Source');
  const [enableMediaFilter, setEnableMediaFilter] = useState(false);
  const [media, setMedia] = useState('all');
    
  // Rule Toggles State
  const [enableDupAction, setEnableDupAction] = useState(true);
  const [enableLimit, setEnableLimit] = useState(true);
  const [enableCaptionRule, setEnableCaptionRule] = useState(false);
  const [enableSizeFilter, setEnableSizeFilter] = useState(false);
  const [hideTrace, setHideTrace] = useState(true);
  const [enableDateFilter, setEnableDateFilter] = useState(false);
  const [enableThrottle, setEnableThrottle] = useState(false);
  
  // Mode -> Rules restrictions
  useEffect(() => {
    if (mode === 'Fast Forward') {
      setHideTrace(false);
      setEnableCaptionRule(false);
      setAlbumHandling('Follow Source');
    }
  }, [mode]);

  // Two-Way Reactivity: Mode -> Rules
  useEffect(() => {
    if (mode === 'Fast Forward') {
      if (hideTrace) setHideTrace(false);
      if (enableCaptionRule) setEnableCaptionRule(false);
    }
  }, [mode]);
  
  useEffect(() => {
    const fetchSessions = async () => {
      const apiId = localStorage.getItem('API_ID') || "";
      const apiHash = localStorage.getItem('API_HASH') || "";
      if (!apiId || !apiHash) return;
      try {
        const command = Command.create('python', ['../../worker/auth_manager.py', '--action', 'list-sessions', '--api-id', apiId, '--api-hash', apiHash]);
        const output = await command.execute();
        const data = JSON.parse(output.stdout);
        if (data.sessions) {
          let activeSessionNames: string[] = [];
          try { activeSessionNames = JSON.parse(localStorage.getItem('ACTIVE_SESSIONS') || '[]'); } catch(e) {}
          
          const activeSess = data.sessions.filter((s: any) => 
            s.status === 'active' && activeSessionNames.includes(s.name)
          );
          setSessions(activeSess);
          if (activeSess.length > 0) {
            setSelectedSession(activeSess[0].name);
          } else {
            setSelectedSession("");
          }
        }
      } catch(e) {
        console.error("Failed to load sessions", e);
      }
    };
    
    fetchSessions();
  }, []);

  const fetchDialogs = async (target: 'source'|'dest') => {
    const session = selectedSession;
    if (!session) {
      alert(t('dashboard.no_active_session') || 'No active sessions available');
      return;
    }
    
    setModalTarget(target);
    setIsModalOpen(true);
    setDialogs([]);
    setTopics([]);
    setSelectedDialogId(null);
    setDialogFilter('All');
    setIsLoadingDialogs(true);
    
    try {
      const apiId = localStorage.getItem('API_ID') || "";
      const apiHash = localStorage.getItem('API_HASH') || "";
      const command = Command.create('python', ['../../worker/daemon.py', '--action=list-dialogs', `--session=${session}`, `--api-id=${apiId}`, `--api-hash=${apiHash}`]);
      const result = await command.execute(); // Wait to finish
      
      let jsonOutput = "";
      if (result.stdout.includes('[JSON_OUTPUT]')) {
        const parts = result.stdout.split('[JSON_OUTPUT]');
        jsonOutput = parts[parts.length - 1].trim();
      }
      
      if (jsonOutput) {
        const data = JSON.parse(jsonOutput);
        if(data.error) {
          alert(`Error: ${data.error}`);
          setIsModalOpen(false);
        } else {
          setDialogs(data);
        }
      } else if (result.stderr || result.stdout) {
        console.error("Daemon error:", result.stderr || result.stdout);
        alert(`Engine error: ${result.stderr || result.stdout}`);
        setIsModalOpen(false);
      }
    } catch (err) {
      console.error("Failed to fetch dialogs", err);
      alert(`Failed to fetch dialogs: ${err}`);
      setIsModalOpen(false);
    } finally {
      setIsLoadingDialogs(false);
    }
  };

  const fetchTopics = async (chatId: string) => {
    setIsLoadingDialogs(true);
    setTopics([]);
    setSelectedDialogId(chatId);
    
    try {
      const apiId = localStorage.getItem('API_ID') || "";
      const apiHash = localStorage.getItem('API_HASH') || "";
      const session = selectedSession || "Lavender";
      const command = Command.create('python', ['../../worker/daemon.py', '--action=list-topics', `--session=${session}`, `--chat-id=${chatId}`, `--api-id=${apiId}`, `--api-hash=${apiHash}`]);
      const result = await command.execute();
      
      let jsonOutput = "";
      if (result.stdout.includes('[JSON_OUTPUT]')) {
        const parts = result.stdout.split('[JSON_OUTPUT]');
        jsonOutput = parts[parts.length - 1].trim();
      }
      
      if (jsonOutput) {
        const data = JSON.parse(jsonOutput);
        if(data.error) {
          alert(`Error: ${data.error}`);
          setIsModalOpen(false);
        } else {
          setTopics(data);
        }
      }
    } catch (err) {
      console.error(err);
      alert(`Failed to fetch topics: ${err}`);
      setIsModalOpen(false);
    } finally {
      setIsLoadingDialogs(false);
    }
  };

  const selectDialog = (id: string, name: string, isForum: boolean, isRestricted: boolean = false) => {
    if(isForum && modalTarget === 'source') {
      fetchTopics(id);
      return;
    }
    
    if(modalTarget === 'source') {
      setSourceValue(id);
      setSourceName(name);
      setErrors(prev => ({...prev, sourceValue: ''}));
      if (isRestricted) {
        setAutoFallback(true);
      }
    } else {
      setDestValue(id);
      setDestName(name);
      setErrors(prev => ({...prev, destValue: ''}));
    }
    setIsModalOpen(false);
  };

  const selectTopic = (chatId: string, topicId: string, topicName: string) => {
    setSourceValue(topicId ? `${chatId}_${topicId}` : chatId);
    const parentDialog = dialogs.find(d => d.id === chatId);
    const pName = parentDialog ? parentDialog.name : "Unknown Group";
    setSourceName(topicId ? `${pName} › ${topicName}` : pName);
    setErrors(prev => ({...prev, sourceValue: ''}));
    setIsModalOpen(false);
  };

    
  const handleNext = () => {
    let newErrors: {[key: string]: string} = {};
    if (currentStep === 1) {
      const src = sourceValue.trim();
      const dst = destValue.trim();
      const tgRegex = /^(\-?\d+(_\d+)?|@?[a-zA-Z0-9_]{3,}|(https?:\/\/)?t\.me\/(\+)?[a-zA-Z0-9_-]+(\/\d+)?)$/;
      
      if (!jobName.trim()) newErrors.jobName = "Job Name is required";
      
      if (!src) {
        newErrors.sourceValue = "Source is required";
      } else if (!tgRegex.test(src)) {
        newErrors.sourceValue = "Invalid format. Use ID (-100...), @username, or t.me/ link";
      }
      
      if (!dst) {
        newErrors.destValue = "Destination is required";
      } else if (!tgRegex.test(dst)) {
        newErrors.destValue = "Invalid format. Use ID (-100...), @username, or t.me/ link";
      }
      
      if (src && dst && src === dst) {
        newErrors.destValue = "Destination cannot be the same as Source";
      }
      
      if (!selectedSession) newErrors.selectedSession = "Please select a session";
      
      if (Object.keys(newErrors).length > 0) {
        setErrors(newErrors);
        return;
      }
      setErrors({});
      setCurrentStep(2);
      setTimeout(() => step2Ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
    } else if (currentStep === 2) {
      if (enableLimit) {
        if (Number(limit) < 0) newErrors.limit = "Limit cannot be negative";
      }
      if (enableSizeFilter) {
        if (Number(sizeMin) < 0 || Number(sizeMax) < 0) newErrors.size = "Size cannot be negative";
        if (Number(sizeMax) > 0 && Number(sizeMin) > Number(sizeMax)) newErrors.size = "Minimum size cannot be greater than maximum size";
      }
      if (enableDateFilter) {
        if (startDate && endDate && new Date(startDate) > new Date(endDate)) {
          newErrors.date = "Start date cannot be after end date";
        }
      }
      if (Object.keys(newErrors).length > 0) {
        setErrors(newErrors);
        return;
      }
      setErrors({});
      setCurrentStep(3);
      setTimeout(() => step3Ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
    } else if (currentStep === 3) {
      if (enableThrottle) {
        if (Number(delayMin) < 0 || Number(delayMax) < 0) newErrors.throttle = "Throttle delay cannot be negative";
        if (Number(delayMin) > Number(delayMax)) newErrors.throttle = "Minimum throttle delay cannot be greater than maximum delay";
      }
      if (enableCaptionRule && captionRule === 'custom') {
        if (!customCaption || !customCaption.trim()) newErrors.caption = "Please enter a custom caption template";
      }
      if (Object.keys(newErrors).length > 0) {
        setErrors(newErrors);
        return;
      }
      setErrors({});
      setCurrentStep(4);
      setTimeout(() => step4Ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
    }
  };

  const handleBack = () => {
    if (currentStep > 1) setCurrentStep(currentStep - 1);
  };

  const startMigration = async (isDryRun = false) => {
    if (!jobName.trim()) {
        alert("Please enter a Job Name");
        return;
    }
    if (!sourceValue || !destValue) {
        alert("Source and Destination are required! Please check Step 1.");
        return;
    }
    if (!selectedSession) {
        alert("Session is required! Please select an account in Step 1.");
        return;
    }

    const config = {
      source: sourceValue,
      destination: destValue,
      sourceName,
      destName,
      session: selectedSession,
      mode: mode,
      clean_copy_submode: mode === 'Clean Copy' ? cleanCopySubMode : null,
      quality_mode: mode === 'Clean Copy' ? qualityMode : 'SMART',
      media: 'all',
      dupAction,
      limit: enableLimit ? (Number(limit) || 0) : 0,
      size_min: enableSizeFilter ? (Number(sizeMin) || 0) : 0,
      size_max: enableSizeFilter ? (Number(sizeMax) || Infinity) : Infinity,
      autoFallback: autoFallback,
      fetchDirection,
      captionRule,
      albumHandling,
      delayMin: enableThrottle ? (Number(delayMin) || 2) : 2,
      delayMax: enableThrottle ? (Number(delayMax) || 5) : 5,
      startDate: enableDateFilter ? startDate : null,
      endDate: enableDateFilter ? endDate : null,
      jobName,
      dryRun: isDryRun,
      hideTrace,
      enableCaptionRule,
      customCaption
    };
    
    onStart(config);
  };

  return (
    <div className="job-editor-container" style={{ padding: '24px 24px 0 24px', overflow: 'hidden', height: '100%', display: 'flex', flexDirection: 'column' }}>
      <header style={{ marginBottom: '24px', flexShrink: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '24px' }}>
          <div>
            <h2 className="title" style={{ display: 'flex', alignItems: 'center', gap: '8px', margin: '0 0 4px 0' }}>
              {initialJob ? (
                  <><Settings size={24}/> Edit Job</>
              ) : (
                  <><Plus size={24}/> Create New Job</>
              )}
            </h2>
            <p className="subtitle" style={{ margin: 0 }}>
              {initialJob ? "Update configuration for this migration job." : "Configure and run a new migration job."}
            </p>
          </div>
          <div style={{ display: 'flex', flexDirection: 'row', gap: '16px', alignItems: 'center' }}>
            <div style={{ display: 'flex', gap: '12px', alignItems: 'center', background: currentStep === 4 ? 'rgba(255,255,255,0.02)' : 'transparent', padding: currentStep === 4 ? '6px 12px' : '0', borderRadius: '12px', border: currentStep === 4 ? '1px solid rgba(255,255,255,0.05)' : 'none', transition: 'all 0.3s ease' }}>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <div style={{ width: '180px' }}>
                  <Select 
                    options={[{value: '', label: 'Load Profile...'}, ...jobProfiles.map(p => ({value: p.name, label: p.name}))]}
                    value={selectedJobProfile}
                    onChange={(val) => handleLoadJobProfile(val)}
                  />
                </div>
                {selectedJobProfile && (
                  <button 
                    onClick={handleDeleteJobProfile} 
                    className="btn-secondary" 
                    style={{ padding: '8px', color: 'var(--danger)', border: '1px solid rgba(239, 68, 68, 0.3)', background: 'rgba(239, 68, 68, 0.05)', display: 'flex', alignItems: 'center', justifyContent: 'center' }} 
                    title="Delete Profile"
                  >
                    <Trash2 size={16} />
                  </button>
                )}
              </div>
              
              {currentStep === 4 && (
                <>
                  <div style={{ width: '1px', height: '24px', background: 'var(--border)' }} />
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <input 
                      type="text" 
                      className="input-field" 
                      style={{ width: '140px', padding: '8px 12px' }}
                      placeholder="Profile Name"
                      value={newJobProfileName}
                      onChange={(e) => setNewJobProfileName(e.target.value)}
                    />
                    <button 
                      onClick={handleSaveJobProfile}
                      className="btn-secondary" 
                      style={{ padding: '8px 16px', display: 'flex', alignItems: 'center', gap: '6px' }}
                      disabled={!newJobProfileName.trim() || (!jobName.trim() && !sourceValue.trim() && !destValue.trim())}
                      title={(!jobName.trim() && !sourceValue.trim() && !destValue.trim()) ? "Please fill at least Job Name, Source, or Destination" : "Save current configuration as a profile"}
                    >
                      <Save size={16} /> Save
                    </button>
                  </div>
                </>
              )}
            </div>
            <button className="btn btn-secondary" onClick={onCancel}><X size={18} style={{marginRight: '6px'}}/> Cancel</button>
          </div>
        </div>
        
        {/* Stepper Indicator */}
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
          {[1, 2, 3, 4].map(step => (
            <div key={step} className="stepper-item">
              <div className={`stepper-bar ${step <= currentStep ? 'active' : 'inactive'}`}></div>
              <span className={`stepper-text ${step === currentStep ? 'active' : 'inactive'}`}>
                {step === 1 ? 'Identity' : step === 2 ? 'Filters' : step === 3 ? 'Rules' : 'Review'}
              </span>
            </div>
          ))}
        </div>
      </header>

      <div className="job-editor-scroll-area" style={{ flex: 1, display: 'flex', flexDirection: 'column', overflowY: 'auto', paddingRight: '8px', paddingBottom: '24px' }}>
        {/* STEP 1: IDENTITY */}
        <div style={{ display: currentStep >= 1 ? 'block' : 'none', flex: currentStep === 1 ? 1 : 'none', animation: 'fadeIn 0.3s ease-in-out' }}>
          <div className="card glass-panel" style={{ marginBottom: '24px', padding: '32px' }}>
            <h3 className="section-title" style={{ marginBottom: '24px' }}>Job Identity</h3>
            
            <label className="input-label" style={{ marginBottom: '8px', display: 'block' }}>Job Name <span style={{color: 'var(--danger)'}}>*</span></label>
            <input type="text" className="input-field" placeholder="e.g., Backup Semester 1" value={jobName} onChange={e => {setJobName(e.target.value); setErrors({...errors, jobName: ''});}} style={{ width: '100%', border: errors.jobName ? '1px solid var(--danger)' : undefined }} />
            {errors.jobName && <span style={{color: 'var(--danger)', fontSize: '0.85rem', marginTop: '4px', display: 'block'}}>{errors.jobName}</span>}
            <div style={{marginBottom: '24px'}}></div>
            
            <div className="grid-2-cols" style={{ gap: '24px', marginBottom: '24px' }}>
              <div className="input-group">
                <label className="input-label">Select Session <span style={{color: 'var(--danger)'}}>*</span></label>
                <Select 
                  options={[
                    {value: '', label: '-- Select Active Session --'},
                    ...sessions.map(s => ({value: s.name, label: `${s.name} (${s.status})`}))
                  ]}
                  value={selectedSession}
                  onChange={(val) => {setSelectedSession(val); setErrors({...errors, selectedSession: ''});}}
                />
                {errors.selectedSession && <span className="error-text">{errors.selectedSession}</span>}
                {sessions.length === 0 && <span className="warning-text" style={{marginTop: '4px', display: 'block', fontSize: '0.8rem'}}>No active sessions found. Add one in Auth page.</span>}
              </div>
            </div>

            <div className="grid-2-cols" style={{ gap: '24px' }}>
              <div className="input-group">
                <label className="input-label" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span>Source (From) <span style={{color: 'var(--danger)'}}>*</span></span>
                  <button type="button" className="btn-search" onClick={(e) => { e.preventDefault(); setModalTarget('source'); fetchDialogs('source'); }}>
                    <Search size={14} style={{marginRight: '6px'}}/> Browse
                  </button>
                </label>
                <div style={{ position: 'relative', display: 'flex', width: '100%' }}>
                  <FolderGit2 className="input-icon" size={18} />
                  <input type="text" className="input-field with-icon" style={{ flex: 1, border: errors.sourceValue ? '1px solid var(--danger)' : undefined }} value={sourceValue} onChange={(e) => {setSourceValue(e.target.value); setSourceName(""); setErrors({...errors, sourceValue: ''});}} placeholder="Channel/Group ID or Username" />
                </div>
                {sourceName && !errors.sourceValue && (
                  <div style={{ marginTop: '8px', display: 'inline-flex', alignItems: 'center', background: 'rgba(99, 102, 241, 0.1)', padding: '4px 12px', borderRadius: '12px', color: 'var(--primary)', fontSize: '0.85rem', fontWeight: 600 }}>
                    <Hash size={14} style={{ marginRight: '6px' }} />
                    {sourceName}
                  </div>
                )}
                {errors.sourceValue && <span style={{color: 'var(--danger)', fontSize: '0.85rem', marginTop: '4px', display: 'block'}}>{errors.sourceValue}</span>}
              </div>
              <div className="input-group">
                <label className="input-label" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span>Destination (To) <span style={{color: 'var(--danger)'}}>*</span></span>
                  <button type="button" className="btn-search" onClick={(e) => { e.preventDefault(); setModalTarget('dest'); fetchDialogs('dest'); }}>
                    <Search size={14} style={{marginRight: '6px'}}/> Browse
                  </button>
                </label>
                <div style={{ position: 'relative', display: 'flex', width: '100%' }}>
                  <FolderGit2 className="input-icon" size={18} />
                  <input type="text" className="input-field with-icon" style={{ flex: 1, border: errors.destValue ? '1px solid var(--danger)' : undefined }} value={destValue} onChange={(e) => {setDestValue(e.target.value); setDestName(""); setErrors({...errors, destValue: ''});}} placeholder="Channel/Group ID or Username" />
                </div>
                {destName && !errors.destValue && (
                  <div style={{ marginTop: '8px', display: 'inline-flex', alignItems: 'center', background: 'rgba(99, 102, 241, 0.1)', padding: '4px 12px', borderRadius: '12px', color: 'var(--primary)', fontSize: '0.85rem', fontWeight: 600 }}>
                    <Hash size={14} style={{ marginRight: '6px' }} />
                    {destName}
                  </div>
                )}
                {errors.destValue && <span style={{color: 'var(--danger)', fontSize: '0.85rem', marginTop: '4px', display: 'block'}}>{errors.destValue}</span>}
              </div>
            </div>
          </div>
        </div>

        {/* STEP 2: FILTERS */}
        <div ref={step2Ref} style={{ display: currentStep >= 2 ? 'block' : 'none', flex: currentStep === 2 ? 1 : 'none', animation: 'fadeIn 0.3s ease-in-out' }}>
          <div className="card glass-panel" style={{ marginBottom: '24px', padding: '32px' }}>
            <h3 className="section-title" style={{ marginBottom: '24px' }}>Data Filters & Mode</h3>
            
            <div style={{ marginBottom: '32px' }}>
              <label className="input-label" style={{ display: 'flex', alignItems: 'center', marginBottom: '16px' }}>
                Transfer Mode
                <InfoTooltip content="Pilih mode eksekusi engine. Berpengaruh pada kecepatan dan jejak migrasi." />
              </label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div onClick={() => setMode('Fast Forward')} style={{ padding: '16px', borderRadius: '12px', border: mode === 'Fast Forward' ? '2px solid var(--primary)' : '1px solid var(--border)', background: mode === 'Fast Forward' ? 'rgba(99, 102, 241, 0.05)' : 'transparent', cursor: 'pointer', transition: 'all 0.2s ease' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
                    <input type="radio" checked={mode === 'Fast Forward'} readOnly style={{ width: '18px', height: '18px', accentColor: 'var(--primary)' }} />
                    <span style={{ fontWeight: 600, fontSize: '1.05rem', color: mode === 'Fast Forward' ? 'var(--primary)' : 'inherit' }}>⚡ Fast Forward — Maximum Speed</span>
                  </div>
                  <div style={{ paddingLeft: '30px', fontSize: '0.85rem', color: 'var(--text-muted)', lineHeight: '1.6' }}>
                    <ul style={{ margin: 0, paddingLeft: '20px', listStyleType: 'square' }}>
                      <li>Uses Telegram native forward (tercepat)</li>
                      <li>Mempertahankan album, reply, dan caption secara akurat</li>
                      <li><strong>Kelemahan:</strong> Terdapat jejak "Forwarded from [Source]"</li>
                      <li><strong>Cocok untuk:</strong> Backup pribadi, arsip cepat</li>
                    </ul>
                  </div>
                </div>
                
                <div onClick={() => setMode('Clean Copy')} style={{ padding: '16px', borderRadius: '12px', border: mode === 'Clean Copy' ? '2px solid var(--primary)' : '1px solid var(--border)', background: mode === 'Clean Copy' ? 'rgba(99, 102, 241, 0.05)' : 'transparent', cursor: 'pointer', transition: 'all 0.2s ease' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
                    <input type="radio" checked={mode === 'Clean Copy'} readOnly style={{ width: '18px', height: '18px', accentColor: 'var(--primary)' }} />
                    <span style={{ fontWeight: 600, fontSize: '1.05rem', color: mode === 'Clean Copy' ? 'var(--primary)' : 'inherit' }}>🚀 / 🛡️ Clean Copy</span>
                  </div>
                  <div style={{ paddingLeft: '30px', fontSize: '0.85rem', color: 'var(--text-muted)', lineHeight: '1.6' }}>
                    <ul style={{ margin: 0, paddingLeft: '20px', listStyleType: 'square' }}>
                      <li>Tanpa jejak "Forwarded from..." (Stealth)</li>
                      <li>Mendukung kustomisasi caption dan filter ketat</li>
                      <li>Lebih lambat dari Fast Forward</li>
                    </ul>
                  </div>

                  {mode === 'Clean Copy' && (
                    <div style={{ marginTop: '16px', paddingLeft: '30px', display: 'flex', flexDirection: 'column', gap: '12px', animation: 'fadeIn 0.3s ease-in-out' }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: '12px', cursor: 'pointer', padding: '12px', borderRadius: '8px', border: cleanCopySubMode === 'Speed' ? '1px solid var(--primary)' : '1px solid var(--border)', background: cleanCopySubMode === 'Speed' ? 'rgba(99, 102, 241, 0.05)' : 'transparent' }} onClick={(e) => { e.stopPropagation(); setCleanCopySubMode('Speed'); }}>
                        <input type="radio" checked={cleanCopySubMode === 'Speed'} readOnly style={{ accentColor: 'var(--primary)' }} />
                        <div>
                          <strong style={{ color: cleanCopySubMode === 'Speed' ? 'var(--primary)' : 'inherit' }}>🚀 Speed (Batch & Reuse ID)</strong>
                          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Lebih cepat. Upload batch album & File ID Reuse.</div>
                        </div>
                      </label>
                      <label style={{ display: 'flex', alignItems: 'center', gap: '12px', cursor: 'pointer', padding: '12px', borderRadius: '8px', border: cleanCopySubMode === 'Safe' ? '1px solid var(--primary)' : '1px solid var(--border)', background: cleanCopySubMode === 'Safe' ? 'rgba(99, 102, 241, 0.05)' : 'transparent' }} onClick={(e) => { e.stopPropagation(); setCleanCopySubMode('Safe'); }}>
                        <input type="radio" checked={cleanCopySubMode === 'Safe'} readOnly style={{ accentColor: 'var(--primary)' }} />
                        <div>
                          <strong style={{ color: cleanCopySubMode === 'Safe' ? 'var(--primary)' : 'inherit' }}>🛡️ Safe (Sequential Output)</strong>
                          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Integritas & stabilitas tinggi. Custom Caption penuh.</div>
                        </div>
                      </label>
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="grid-2-cols" style={{ gap: '24px', marginBottom: '24px' }}>

              {mode === 'Clean Copy' && (
                <div className="input-group">
                  <label className="input-label" style={{ display: 'flex', alignItems: 'center' }}>
                    Quality Mode (Enterprise)
                    <InfoTooltip content="SMART: Auto-selects based on file type. ORIGINAL: Byte-for-byte exact. HIGH_QUALITY: Best native output." />
                  </label>
                  <Select 
                    options={[
                      {value: 'SMART', label: 'SMART (Auto-select)'},
                      {value: 'ORIGINAL', label: 'ORIGINAL (Document Mode)'},
                      {value: 'HIGH_QUALITY', label: 'HIGH QUALITY (Native Media)'}
                    ]}
                    value={qualityMode}
                    onChange={(v) => setQualityMode(v)}
                  />
                </div>
              )}

              <div className="input-group">
                <label className="input-label" style={{ display: 'flex', alignItems: 'center' }}>
                  Fetch Direction
                  <InfoTooltip content="Pilih apakah pesan akan disalin dari yang Terbaru atau dari yang Terlama." />
                </label>
                <Select 
                  options={[{value: 'Newest First', label: 'Newest First'}, {value: 'Oldest First', label: 'Oldest First'}]}
                  value={fetchDirection}
                  onChange={(v) => setFetchDirection(v)}
                />
              </div>
            </div>

            <div className="grid-2-cols" style={{ gap: '24px' }}>
              <div className="input-group">
                <div className="toggle-label-group" style={{ marginBottom: '8px' }}>
                  <label className="toggle-switch">
                    <input type="checkbox" checked={enableLimit} onChange={e => setEnableLimit(e.target.checked)} />
                    <span className="toggle-slider"></span>
                  </label>
                  <span>Media Limit</span>
                  <InfoTooltip content="Membatasi jumlah maksimal media yang akan ditransfer dalam satu sesi eksekusi. Gunakan angka 0 untuk transfer tanpa batas (Unlimited)." />
                </div>
                <input type="number" value={limit} onChange={(e) => setLimit(e.target.value === '' ? '' : Number(e.target.value))} className="input-field" placeholder="0 = Unlimited" style={{ width: '100%', opacity: enableLimit ? 1 : 0.5 }} disabled={!enableLimit} />
              </div>
              <div className="input-group">
                <div className="toggle-label-group" style={{ marginBottom: '8px' }}>
                  <label className="toggle-switch">
                    <input type="checkbox" checked={enableSizeFilter} onChange={e => setEnableSizeFilter(e.target.checked)} />
                    <span className="toggle-slider"></span>
                  </label>
                  <span>Size Filter (MB)</span>
                  <InfoTooltip content="Only transfer media files within this size range." />
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <input type="number" value={sizeMin} onChange={(e) => setSizeMin(e.target.value === '' ? '' : Number(e.target.value))} className="input-field" placeholder="Min" style={{ flex: 1, opacity: enableSizeFilter ? 1 : 0.5 }} disabled={!enableSizeFilter} />
                  <input type="number" value={sizeMax} onChange={(e) => setSizeMax(e.target.value === '' ? '' : Number(e.target.value))} className="input-field" placeholder="Max" style={{ flex: 1, opacity: enableSizeFilter ? 1 : 0.5 }} disabled={!enableSizeFilter} />
                </div>
              </div>

              <div className="input-group">
                <div className="toggle-label-group" style={{ marginBottom: '8px' }}>
                  <label className="toggle-switch">
                    <input type="checkbox" checked={enableMediaFilter} onChange={e => setEnableMediaFilter(e.target.checked)} />
                    <span className="toggle-slider"></span>
                  </label>
                  <span>Media Filter</span>
                  <InfoTooltip content="Filter specific types of media." />
                </div>
                <Select 
                  options={[
                    {value: 'all', label: 'All Media'},
                    {value: 'photo', label: 'Photo Only'},
                    {value: 'video', label: 'Video Only'},
                    {value: 'document', label: 'Document'},
                    {value: 'audio', label: 'Audio'},
                    {value: 'voice', label: 'Voice'},
                    {value: 'gif', label: 'GIF'}
                  ]}
                  value={media}
                  onChange={(v) => setMedia(v)}
                  disabled={!enableMediaFilter}
                />
              </div>
              
              <div className="input-group">
                <label className="input-label" style={{ display: 'flex', alignItems: 'center', marginBottom: '14px' }}>
                  Album / Grouped Media
                  <InfoTooltip content="Choose how to handle grouped media/albums." />
                </label>
                <Select 
                  options={[
                    {value: 'Follow Source', label: 'Follow Source (Group if grouped)'},
                    {value: 'Force Split', label: 'Force Split (Send one by one)'},
                    {value: 'Force Group', label: 'Force Group (Force group into album)'}
                  ]}
                  value={albumHandling}
                  onChange={(v) => setAlbumHandling(v)}
                  disabled={mode === 'Fast Forward'}
                />
                {mode === 'Fast Forward' && <span style={{fontSize: '0.8rem', color: 'var(--text-muted)'}}>* Fast Forward always preserves albums natively.</span>}
              </div>

              <div className="input-group col-span-full">
                <div className="toggle-label-group" style={{ marginBottom: '8px' }}>
                  <label className="toggle-switch">
                    <input type="checkbox" checked={enableDateFilter} onChange={e => setEnableDateFilter(e.target.checked)} />
                    <span className="toggle-slider"></span>
                  </label>
                  <span>Date Filter</span>
                  <InfoTooltip content="Only transfer messages posted within this date range." />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                  <div>
                    <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '4px', display: 'block' }}>Start Date</label>
                    <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="input-field" style={{ width: '100%', opacity: enableDateFilter ? 1 : 0.5 }} disabled={!enableDateFilter} />
                  </div>
                  <div>
                    <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '4px', display: 'block' }}>End Date</label>
                    <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="input-field" style={{ width: '100%', opacity: enableDateFilter ? 1 : 0.5 }} disabled={!enableDateFilter} />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* STEP 3: RULES */}
        <div ref={step3Ref} style={{ display: currentStep >= 3 ? 'block' : 'none', flex: currentStep === 3 ? 1 : 'none', animation: 'fadeIn 0.3s ease-in-out' }}>
          <div className="card glass-panel" style={{ marginBottom: '24px', padding: '32px' }}>
            <h3 className="section-title" style={{ marginBottom: '24px' }}>Rules & Behaviors</h3>
            
            <div className="grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
              <div className="input-group">
                <div className="toggle-label-group">
                  <label className="toggle-switch">
                    <input type="checkbox" checked={enableCaptionRule} onChange={e => setEnableCaptionRule(e.target.checked)} disabled={mode === 'Fast Forward'} />
                    <span className="toggle-slider"></span>
                  </label>
                  <span style={{ opacity: mode === 'Fast Forward' ? 0.5 : 1 }}>Caption Rule</span>
                  <InfoTooltip content={t('dashboard.tooltip_caption_rule') || 'Modify or remove text captions from media messages.'} />
                </div>
                {mode === 'Fast Forward' && <span style={{fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '8px', display: 'block'}}>* Not supported in Fast Forward mode.</span>}
                <Select 
                  options={[{value: 'remove', label: 'Remove'}, {value: 'strip_links', label: 'Strip Links'}, {value: 'custom', label: 'Custom'}]}
                  value={captionRule}
                  onChange={(v) => setCaptionRule(v)}
                  disabled={!enableCaptionRule}
                />
                {captionRule === 'custom' && enableCaptionRule && (
                  <button 
                    onClick={() => setIsCaptionModalOpen(true)}
                    className="btn-secondary" 
                    style={{ width: '100%', marginTop: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px' }}
                  >
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '85%', color: customCaption ? 'var(--text-main)' : 'var(--text-muted)' }}>
                      {customCaption ? customCaption : 'Set Custom Template...'}
                    </span>
                    <span style={{ fontSize: '1.1rem', color: 'var(--text-muted)' }}>✎</span>
                  </button>
                )}
              </div>
              
              <div className="input-group">
                <div className="toggle-label-group">
                  <label className="toggle-switch">
                    <input type="checkbox" checked={enableDupAction} onChange={e => setEnableDupAction(e.target.checked)} />
                    <span className="toggle-slider"></span>
                  </label>
                  <span>Duplicate Action</span>
                  <InfoTooltip content={t('dashboard.tooltip_disable_dup') || 'Decide what to do if a message already exists in the destination.'} />
                </div>
                <Select 
                  options={[
                    {value: 'Skip', label: 'Skip'}, 
                    {value: 'Overwrite', label: 'Overwrite'},
                    {value: 'Verify', label: 'Verify Dest'}
                  ]}
                  value={dupAction}
                  onChange={(v) => setDupAction(v)}
                  disabled={!enableDupAction}
                />
              </div>

              <div className="input-group">
                <div className="toggle-label-group">
                  <label className="toggle-switch">
                    <input type="checkbox" className="warning-toggle" checked={enableThrottle} onChange={e => setEnableThrottle(e.target.checked)} />
                    <span className="toggle-slider"></span>
                  </label>
                  <span className="warning-text">Enable Throttle</span>
                  <InfoTooltip content={t('dashboard.tooltip_throttle') || 'Add a delay between messages to prevent being banned by Telegram for spam.'} />
                </div>
                {enableThrottle && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', paddingLeft: '8px', borderLeft: '2px solid var(--warning)', marginTop: '8px' }}>
                    <input type="number" value={delayMin} onChange={(e) => setDelayMin(e.target.value === '' ? '' : Number(e.target.value))} className="input-field" style={{ width: '70px', padding: '6px' }} />
                    <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>-</span>
                    <input type="number" value={delayMax} onChange={(e) => setDelayMax(e.target.value === '' ? '' : Number(e.target.value))} className="input-field" style={{ width: '70px', padding: '6px' }} />
                    <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>s</span>
                  </div>
                )}
              </div>
              
              <div className="input-group">
                <div className="toggle-label-group">
                  <label className="toggle-switch">
                    <input type="checkbox" className="danger-toggle" checked={autoFallback} onChange={(e) => setAutoFallback(e.target.checked)} />
                    <span className="toggle-slider"></span>
                  </label>
                  <span className="danger-text">Auto-Fallback</span>
                  <InfoTooltip content={t('dashboard.tooltip_fallback') || 'Try fallback mechanisms if direct transfer fails.'} />
                </div>
                <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '8px' }}>Try fallback mechanisms if direct transfer fails.</p>
              </div>

              <div className="input-group col-span-full">
                <div className="toggle-label-group">
                  <label className="toggle-switch">
                    <input type="checkbox" checked={hideTrace} onChange={e => setHideTrace(e.target.checked)} disabled={mode === 'Fast Forward'} />
                    <span className="toggle-slider"></span>
                  </label>
                  <span style={{ opacity: mode === 'Fast Forward' ? 0.5 : 1 }}>Hide "Forwarded from" trace</span>
                  <InfoTooltip content="Removes the 'Forwarded from' tag when messages are forwarded." />
                </div>
                {mode === 'Fast Forward' && <span style={{fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '8px', display: 'block'}}>* Fast Forward API inherently leaves a forward trace. Use Clean Copy to hide it.</span>}
              </div>

            </div>
          </div>
        </div>

        {/* STEP 4: REVIEW */}
        <div ref={step4Ref} style={{ display: currentStep >= 4 ? 'block' : 'none', flex: currentStep === 4 ? 1 : 'none', animation: 'fadeIn 0.3s ease-in-out' }}>
          <div className="card glass-panel" style={{ marginBottom: '24px', padding: '32px' }}>
            <h3 className="section-title" style={{ marginBottom: '24px' }}>Review & Execute</h3>
            <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)', marginBottom: '24px' }}>Please review your configuration before starting the background process.</p>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              
              {/* Identity Section */}
              <div style={{ background: 'rgba(255,255,255,0.03)', borderRadius: '12px', border: '1px solid var(--border)', padding: '20px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px', color: 'var(--primary)' }}>
                  <User size={18} /> <h4 style={{ margin: 0, fontSize: '1rem', color: 'var(--text-main)' }}>Job Identity</h4>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
                  <div>
                    <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem', display: 'block', marginBottom: '4px' }}>Job Name</span>
                    <div style={{ fontWeight: 600, fontSize: '1.05rem', color: 'var(--text-main)' }}>{jobName || <span style={{ color: 'var(--danger)', fontStyle: 'italic' }}>Missing</span>}</div>
                  </div>
                  <div>
                    <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem', display: 'block', marginBottom: '4px' }}>Session / Account</span>
                    <div style={{ fontWeight: 600, fontSize: '1.05rem', color: 'var(--text-main)' }}>{selectedSession || <span style={{ color: 'var(--danger)', fontStyle: 'italic' }}>Missing</span>}</div>
                  </div>
                </div>
              </div>

              {/* Routing Section */}
              <div style={{ display: 'flex', gap: '16px', alignItems: 'stretch' }}>
                <div style={{ flex: 1, background: 'rgba(255,255,255,0.03)', borderRadius: '12px', border: '1px solid var(--border)', padding: '20px', display: 'flex', flexDirection: 'column' }}>
                  <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem', display: 'block', marginBottom: '8px' }}>Source (From)</span>
                  <div style={{ fontWeight: 600, fontSize: '1.1rem', color: 'var(--text-main)', marginBottom: '4px' }}>{sourceName || (sourceValue ? 'Custom Source' : <span style={{ color: 'var(--danger)', fontStyle: 'italic' }}>Missing Source</span>)}</div>
                  <div style={{ fontFamily: 'monospace', color: 'var(--primary)', fontSize: '0.9rem', background: 'rgba(0,0,0,0.2)', padding: '4px 8px', borderRadius: '4px', alignSelf: 'flex-start' }}>{sourceValue || 'No ID'}</div>
                </div>
                
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--primary)', opacity: 0.8 }}>
                  <Play size={24} style={{ fill: 'var(--primary)' }} />
                </div>
                
                <div style={{ flex: 1, background: 'rgba(255,255,255,0.03)', borderRadius: '12px', border: '1px solid var(--border)', padding: '20px', display: 'flex', flexDirection: 'column' }}>
                  <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem', display: 'block', marginBottom: '8px' }}>Destination (To)</span>
                  <div style={{ fontWeight: 600, fontSize: '1.1rem', color: 'var(--text-main)', marginBottom: '4px' }}>{destName || (destValue ? 'Custom Destination' : <span style={{ color: 'var(--danger)', fontStyle: 'italic' }}>Missing Destination</span>)}</div>
                  <div style={{ fontFamily: 'monospace', color: 'var(--primary)', fontSize: '0.9rem', background: 'rgba(0,0,0,0.2)', padding: '4px 8px', borderRadius: '4px', alignSelf: 'flex-start' }}>{destValue || 'No ID'}</div>
                </div>
              </div>

              {/* Filters & Rules Section */}
              <div style={{ background: 'rgba(255,255,255,0.03)', borderRadius: '12px', border: '1px solid var(--border)', padding: '20px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px', color: 'var(--primary)' }}>
                  <Settings size={18} /> <h4 style={{ margin: 0, fontSize: '1rem', color: 'var(--text-main)' }}>Configuration Details</h4>
                </div>
                
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '20px', padding: '12px', background: 'rgba(0,0,0,0.2)', borderRadius: '8px' }}>
                  
                  <div>
                    <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem', display: 'block', marginBottom: '4px', textTransform: 'uppercase' }}>Mode</span>
                    <div style={{ fontWeight: 500, color: 'var(--text-main)' }}>{mode}</div>
                  </div>
                  <div>
                    <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem', display: 'block', marginBottom: '4px', textTransform: 'uppercase' }}>Message Limit</span>
                    <div style={{ fontWeight: 500, color: 'var(--text-main)' }}>{enableLimit ? limit : 'Unlimited'}</div>
                  </div>
                  <div>
                    <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem', display: 'block', marginBottom: '4px', textTransform: 'uppercase' }}>Fetch Direction</span>
                    <div style={{ fontWeight: 500, color: 'var(--text-main)' }}>{fetchDirection}</div>
                  </div>

                  <div>
                    <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem', display: 'block', marginBottom: '4px', textTransform: 'uppercase' }}>Caption Rule</span>
                    <div style={{ fontWeight: 500, color: 'var(--text-main)' }}>{captionRule}</div>
                  </div>
                  <div>
                    <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem', display: 'block', marginBottom: '4px', textTransform: 'uppercase' }}>Duplicate Action</span>
                    <div style={{ fontWeight: 500, color: 'var(--text-main)' }}>{dupAction}</div>
                  </div>
                  <div>
                    <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem', display: 'block', marginBottom: '4px', textTransform: 'uppercase' }}>Anti-Flood (Throttle)</span>
                    <div style={{ fontWeight: 500, color: 'var(--text-main)' }}>{enableThrottle ? `${delayMin}s - ${delayMax}s Delay` : 'Disabled'}</div>
                  </div>

                </div>
              </div>

            </div>
          </div>
        </div>

        </div>

      {/* NAVIGATION BOTTOM */}
      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '16px 0 24px 0', borderTop: '1px solid var(--border)', flexShrink: 0, marginTop: 'auto', background: 'var(--bg-main)', zIndex: 10 }}>
        <button className="btn btn-secondary" onClick={handleBack} disabled={currentStep === 1} style={{ opacity: currentStep === 1 ? 0.5 : 1 }}>
          Back
        </button>
        
        {currentStep < 4 ? (
          <button className="btn btn-primary" onClick={handleNext} style={{ padding: '0 32px' }}>
            Next Step
          </button>
        ) : (
          <div style={{ display: 'flex', gap: '12px' }}>
            <button className="btn btn-secondary" onClick={() => startMigration(true)} style={{ padding: '0 24px', color: 'var(--primary)', borderColor: 'var(--primary)', background: 'rgba(88, 101, 242, 0.05)' }}>
              Dry Run
            </button>
            <button className="btn btn-primary" onClick={() => startMigration(false)} style={{ padding: '0 32px', background: 'var(--primary)' }}>
              {initialJob ? (
                  <><Save size={18} style={{ marginRight: '8px' }} /> Save Changes</>
              ) : (
                  <><Play size={18} style={{ marginRight: '8px' }} /> Start Job</>
              )}
            </button>
          </div>
        )}
      </div>
      
      {/* Auto Discovery Modal */}
      {isModalOpen && (
        <div className="modal-overlay" onClick={() => setIsModalOpen(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3 style={{ margin: 0, fontSize: '1.1rem' }}>
                {modalTarget === 'source' ? t('dashboard.select_source') : t('dashboard.select_dest')}
              </h3>
              <button className="btn" style={{ background: 'transparent', padding: 4 }} onClick={() => setIsModalOpen(false)}>
                <X size={20} />
              </button>
            </div>
            <div className="modal-body">
              {isLoadingDialogs ? (
                <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted)' }}>
                  <RefreshCcw className="spin" size={24} style={{ margin: '0 auto 12px' }} />
                  <p>{t('dashboard.loading_api')}</p>
                </div>
              ) : selectedDialogId && topics.length > 0 ? (
                <div>
                  <div style={{ padding: '12px 20px', background: 'rgba(99, 102, 241, 0.1)', color: 'var(--primary)', fontWeight: 600 }}>
                    {t('dashboard.select_subtopic')}
                  </div>
                  <div className="dialog-item" onClick={() => selectTopic(selectedDialogId, "", t('dashboard.all_group') || 'All Group')}>
                    <Hash size={18} color="var(--text-muted)" />
                    <div>{t('dashboard.all_group')}</div>
                  </div>
                  {topics.map(t => (
                    <div key={t.id} className="dialog-item" onClick={() => selectTopic(selectedDialogId, t.id, t.title)}>
                      <Hash size={18} color="var(--primary)" />
                      <div>{t.title}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <>
                  <div style={{ display: 'flex', gap: '8px', padding: '12px 20px', overflowX: 'auto', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                    {['All', 'User', 'Group', 'Channel', 'Bot'].map(f => (
                      <div 
                        key={f}
                        onClick={() => setDialogFilter(f)}
                        style={{
                          padding: '4px 12px',
                          borderRadius: '16px',
                          fontSize: '0.8rem',
                          fontWeight: 600,
                          cursor: 'pointer',
                          background: dialogFilter === f ? 'var(--primary)' : 'rgba(255,255,255,0.05)',
                          color: dialogFilter === f ? '#fff' : 'var(--text-muted)',
                          transition: 'var(--transition-safe)'
                        }}
                      >
                        {f === 'Group' ? 'Group/Forum' : f}
                      </div>
                    ))}
                  </div>
                  {dialogs.filter(d => dialogFilter === 'All' || d.type === dialogFilter || (dialogFilter === 'Group' && d.is_forum)).map(d => {
                  let badgeText = d.type || 'Unknown';
                  let icon = <User size={18} color="#6366f1" style={{ marginRight: '12px', flexShrink: 0 }} />;
                  let bg = 'rgba(255,255,255,0.1)';
                  let color = 'var(--text-muted)';
                  
                  if (d.is_forum) {
                    badgeText = 'Group';
                    icon = <Hash size={18} color="#d946ef" style={{ marginRight: '12px', flexShrink: 0 }} />;
                    bg = 'rgba(217, 70, 239, 0.2)';
                    color = '#d946ef';
                  } else if (d.type === 'Channel') {
                    icon = <Radio size={18} color="#f59e0b" style={{ marginRight: '12px', flexShrink: 0 }} />;
                    bg = 'rgba(245, 158, 11, 0.2)';
                    color = '#f59e0b';
                  } else if (d.type === 'Group') {
                    icon = <Users size={18} color="#3b82f6" style={{ marginRight: '12px', flexShrink: 0 }} />;
                    bg = 'rgba(59, 130, 246, 0.2)';
                    color = '#3b82f6';
                  } else if (d.type === 'Bot') {
                    icon = <Bot size={18} color="#10b981" style={{ marginRight: '12px', flexShrink: 0 }} />;
                    bg = 'rgba(16, 185, 129, 0.2)';
                    color = '#10b981';
                  } else if (d.type === 'User') {
                    icon = <User size={18} color="#94a3b8" style={{ marginRight: '12px', flexShrink: 0 }} />;
                    bg = 'rgba(148, 163, 184, 0.2)';
                    color = '#94a3b8';
                  }

                  return (
                    <div key={d.id} className="dialog-item" onClick={() => selectDialog(d.id, d.name, d.is_forum)} style={{ display: 'flex', alignItems: 'center' }}>
                      {icon}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{d.name}</div>
                        <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>ID: {d.id}</div>
                      </div>
                      <span style={{ fontSize: '0.7rem', background: bg, color, padding: '2px 8px', borderRadius: '12px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', marginLeft: '8px', flexShrink: 0 }}>
                        {badgeText}
                      </span>
                    </div>
                  );
                })}
                </>
              )}
            </div>
          </div>
        </div>
      )}
      
      <CaptionModal 
        isOpen={isCaptionModalOpen} 
        onClose={() => setIsCaptionModalOpen(false)} 
        initialTemplate={customCaption} 
        onSave={setCustomCaption} 
      />
    </div>
  );
}
