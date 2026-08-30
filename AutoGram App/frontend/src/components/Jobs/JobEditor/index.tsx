import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Search, FolderGit2, Play, RefreshCcw, X, Hash, Users, Radio, User, Bot, Plus, Save, Trash2, Settings } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Select } from '../../common/Select';
import { InfoTooltip } from '../../common/InfoTooltip';
import { CaptionModal } from '../Modals/CaptionModal';
import { PeerAvatar } from '../../drive/Navigation/sidebarUtils';

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
  const [chatFolders, setChatFolders] = useState<any[]>([
    { id: 0, title: t('dashboard.all_chats'), kind: 'all' },
  ]);
  const [selectedFolderId, setSelectedFolderId] = useState<number>(0);
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [isForumGroup, setIsForumGroup] = useState(false);
  const [activeCreds, setActiveCreds] = useState<any>(null);

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
    // Empty option = "Load Profile..." — hide delete icon, no config apply
    if (!profileName) {
      setSelectedJobProfile('');
      return;
    }
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
      if (c.reencodeHardware !== undefined) setReencodeHardware(c.reencodeHardware);
      if (c.reencodePreset !== undefined) setReencodePreset(c.reencodePreset);
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
                if (c.reencodeHardware !== undefined) setReencodeHardware(c.reencodeHardware);
                if (c.reencodePreset !== undefined) setReencodePreset(c.reencodePreset);
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
  const [reencodeHardware, setReencodeHardware] = useState("auto");
  const [reencodePreset, setReencodePreset] = useState("balanced");
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
      try {
        const { loadSelectableSessions, getSessionDisplayName } = await import('../../../lib/telegram');
        const activeSess = await loadSelectableSessions({ autoSeedActive: true });
        setSessions(activeSess.map((s) => ({ name: s.name, label: getSessionDisplayName(s.name), status: s.status })));
        if (activeSess.length > 0) {
          setSelectedSession((prev) =>
            prev && activeSess.some((s) => s.name === prev) ? prev : activeSess[0].name
          );
        } else {
          setSelectedSession('');
        }
      } catch (e) {
        const msg = String((e as Error)?.message || e);
        // Expected in browser preview — avoid red console noise
        if (/requires desktop|requires tauri/i.test(msg)) {
          setSessions([]);
          setSelectedSession('');
          return;
        }
        console.error('Failed to load sessions', e);
      }
    };

    fetchSessions();
  }, []);

  const fetchDialogs = async (target: 'source'|'dest', folderId?: number) => {
    const session = selectedSession;
    if (!session) {
      alert(t('dashboard.no_active_session') || t('ui.generated.no_active_sessions_available_b9ed3c8'));
      return;
    }

    if (folderId === undefined) {
      setSelectedFolderId(0);
    } else {
      setSelectedFolderId(folderId);
    }
    
    setModalTarget(target);
    setIsModalOpen(true);
    setDialogs([]);
    setTopics([]);
    setSelectedDialogId(null);
    setDialogFilter('All');
    setSearchQuery("");
    setIsForumGroup(false);
    setIsLoadingDialogs(true);
    
    try {
      const { bootstrapSecureCredentials } = await import('../../../lib/tauri/secureCredentials');
      const { apiId, apiHash } = await bootstrapSecureCredentials();
      if (!apiId || !apiHash) {
        alert(
          t('accounts.error_api_required') ||
            t('ui.generated.api_id_hash_belum_terisi_buka_settings_dan_simpa_9ccf412')
        );
        setIsModalOpen(false);
        setIsLoadingDialogs(false);
        return;
      }

      const creds = {
        session,
        apiId: String(apiId),
        apiHash: String(apiHash),
      };
      setActiveCreds(creds);

      // Fetch Telegram chat folders if not loaded yet
      if (chatFolders.length <= 1) {
        try {
          const { driveListChatFolders } = await import('../../../lib/telegram/driveApi');
          const foldersRes = await driveListChatFolders(creds);
          if (foldersRes && foldersRes.folders) {
            setChatFolders(foldersRes.folders);
          }
        } catch (e) {
          console.error("Failed to load chat folders", e);
        }
      }

      // Grammers dialogs (no Python list-dialogs)
      const { tgListDialogs } = await import('../../../lib/telegram');
      const gr = await tgListDialogs({
        session,
        apiId: Number(apiId) || 0,
        apiHash: String(apiHash),
        limit: 200,
      });
      if (gr?.ok && Array.isArray(gr.data)) {
        const data = gr.data.map((d) => ({
          id: d.id,
          title: d.title,
          name: d.title,
          is_user: d.isUser,
          is_channel: d.isChannel,
          is_group: d.isGroup,
          is_forum: !!d.isForum,
        }));
        setDialogs(data);
      } else {
        throw new Error(gr?.userMessage || gr?.error?.message || 'Gagal memuat dialog Grammers');
      }
    } catch (err) {
      console.error("Failed to fetch dialogs", err);
      alert(`Failed to fetch dialogs: ${err}`);
      setIsModalOpen(false);
    } finally {
      setIsLoadingDialogs(false);
    }
  };

  const topicsReqSeqRef = useRef(0);

  const fetchTopics = async (chatId: string) => {
    const seq = ++topicsReqSeqRef.current;
    console.info(`[AutoGram:JobEditor] Fetching topics for chat: chatId=${chatId}, seq=${seq}`);
    setIsLoadingDialogs(true);
    setTopics([]);
    setSelectedDialogId(chatId);
    
    try {
      const { bootstrapSecureCredentials } = await import('../../../lib/tauri/secureCredentials');
      const { apiId, apiHash } = await bootstrapSecureCredentials();
      const session = selectedSession || 'Lavender';
      if (!apiId || !apiHash) {
        alert(
          t('accounts.error_api_required') ||
            t('ui.generated.api_id_hash_belum_terisi_buka_settings_dan_simpa_9ccf412')
        );
        setIsLoadingDialogs(false);
        return;
      }
      const { tgListTopics } = await import('../../../lib/telegram');
      const gr = await tgListTopics({
        session,
        apiId: Number(apiId) || 0,
        apiHash: String(apiHash),
        chatId: Number(chatId),
      });
      if (seq !== topicsReqSeqRef.current) {
        console.info(`[AutoGram:JobEditor] Ignored stale topics RPC response: chatId=${chatId}, currentSeq=${topicsReqSeqRef.current}, expectedSeq=${seq}`);
        return;
      }
      if (gr?.ok && gr.data) {
        const list = gr.data.topics || [];
        console.info(`[AutoGram:JobEditor] Topics successfully loaded for chat: chatId=${chatId}, totalTopics=${list.length}, isForum=${!!gr.data.isForum}`);
        setIsForumGroup(!!gr.data.isForum);
        setTopics(
          list.map((t: any) => ({
            id: t.id,
            title: t.title,
            closed: t.closed,
          }))
        );
      } else {
        setTopics([]);
        throw new Error(gr?.userMessage || gr?.error?.message || 'Gagal memuat topik Grammers');
      }
    } catch (err) {
      if (seq !== topicsReqSeqRef.current) return;
      console.error('[AutoGram:JobEditor] Error fetching topics:', err);
      alert(`Failed to fetch topics: ${err}`);
      setIsModalOpen(false);
    } finally {
      if (seq === topicsReqSeqRef.current) {
        setIsLoadingDialogs(false);
      }
    }
  };

  const selectDialog = (id: string, name: string, isForum: boolean, isRestricted: boolean = false) => {
    if(isForum) {
      setIsForumGroup(true);
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
    if (modalTarget === 'source') {
      setSourceValue(topicId ? `${chatId}_${topicId}` : chatId);
      const parentDialog = dialogs.find(d => d.id === chatId);
      const pName = parentDialog ? parentDialog.name : "Unknown Group";
      setSourceName(topicId ? `${pName} › ${topicName}` : pName);
      setErrors(prev => ({...prev, sourceValue: ''}));
    } else {
      setDestValue(topicId ? `${chatId}_${topicId}` : chatId);
      const parentDialog = dialogs.find(d => d.id === chatId);
      const pName = parentDialog ? parentDialog.name : "Unknown Group";
      setDestName(topicId ? `${pName} › ${topicName}` : pName);
      setErrors(prev => ({...prev, destValue: ''}));
    }
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
        alert(t('ui.generated.please_enter_a_job_name_546057a'));
        return;
    }
    if (!sourceValue || !destValue) {
        alert(t('ui.generated.source_and_destination_are_required_please_check_667f1b4'));
        return;
    }
    if (!selectedSession) {
        alert(t('ui.generated.session_is_required_please_select_an_account_in__7710420'));
        return;
    }

    // Never use Infinity — JSON serializes it as null. Use 0 = unlimited max.
    const sizeMaxVal = enableSizeFilter ? (Number(sizeMax) || 0) : 0;
    const sizeMinVal = enableSizeFilter ? (Number(sizeMin) || 0) : 0;

    let effectiveCaptionRule = captionRule;
    if (enableCaptionRule && customCaption && (captionRule === 'Custom Caption' || String(captionRule).toLowerCase().includes('custom'))) {
      effectiveCaptionRule = `custom:${customCaption}`;
    }

    const config = {
      source: sourceValue,
      destination: destValue,
      sourceName,
      destName,
      session: selectedSession,
      mode: mode,
      transfer_mode: mode,
      clean_copy_submode: mode === 'Clean Copy' ? cleanCopySubMode : null,
      quality_mode: mode === 'Clean Copy' ? qualityMode : 'SMART',
      reencodeHardware: mode === 'Clean Copy' ? reencodeHardware : 'auto',
      reencodePreset: mode === 'Clean Copy' ? reencodePreset : 'balanced',
      media: 'all',
      media_filter: 'all',
      dupAction,
      duplicate_action: dupAction,
      limit: enableLimit ? (Number(limit) || 0) : 0,
      enableLimit,
      size_min: sizeMinVal,
      size_max: sizeMaxVal,
      size_min_mb: sizeMinVal,
      size_max_mb: sizeMaxVal,
      autoFallback: autoFallback,
      auto_fallback: autoFallback,
      fetchDirection,
      fetch_direction: fetchDirection,
      captionRule: effectiveCaptionRule,
      caption_rule: effectiveCaptionRule,
      albumHandling,
      album_handling: albumHandling,
      delayMin: enableThrottle ? (Number(delayMin) || 2) : 2,
      delayMax: enableThrottle ? (Number(delayMax) || 5) : 5,
      delay_min: enableThrottle ? (Number(delayMin) || 2) : 2,
      delay_max: enableThrottle ? (Number(delayMax) || 5) : 5,
      enableThrottle,
      throttle_active: enableThrottle,
      startDate: enableDateFilter ? (startDate || null) : null,
      endDate: enableDateFilter ? (endDate || null) : null,
      start_date: enableDateFilter ? (startDate || null) : null,
      end_date: enableDateFilter ? (endDate || null) : null,
      jobName,
      dryRun: isDryRun,
      dry_run: isDryRun,
      hideTrace,
      hide_trace: hideTrace,
      enableCaptionRule,
      enable_caption_rule: enableCaptionRule,
      customCaption,
      custom_caption: customCaption || ''
    };
    
    onStart(config);
  };

  return (
    <div className="job-editor-container">
      <header className="job-editor-header">
        <div className="job-editor-header-top">
          <div style={{ minWidth: 0, flex: '1 1 12rem' }}>
            <h2 className="title title-with-icon" style={{ margin: '0 0 4px 0' }}>
              {initialJob ? (
                  <><Settings size={24}/> {t('ui.generated.edit_job_725f1c9')}</>
              ) : (
                  <><Plus size={24}/> {t('nav.tab_new_job')}</>
              )}
            </h2>
            <p className="subtitle" style={{ margin: 0 }}>
              {initialJob ? t('ui.generated.update_configuration_for_this_migration_job_088bfed') : t('ui.generated.configure_and_run_a_new_migration_job_1f894d7')}
            </p>
          </div>
          <div className="job-editor-tools">
            <div
              className={[
                'job-editor-profile-tools',
                currentStep === 4 ? 'has-save' : '',
                selectedJobProfile ? 'has-selection' : '',
              ].filter(Boolean).join(' ')}
            >
              <div className={`profile-load-row ${selectedJobProfile ? 'is-loaded' : ''}`}>
                <div className="profile-select-wrap">
                  <Select
                    options={[
                      { value: '', label: 'Load Profile...' },
                      ...jobProfiles.map((p) => ({ value: p.name, label: p.name })),
                    ]}
                    value={selectedJobProfile}
                    onChange={(val: any) => handleLoadJobProfile(val)}
                  />
                </div>
                {/* Trash only after a real profile is loaded — never for placeholder */}
                {!!selectedJobProfile && (
                  <button
                    type="button"
                    onClick={handleDeleteJobProfile}
                    className="profile-delete-btn"
                    title={t("jobs.jobs_delete_profile", { name: selectedJobProfile })}
                    aria-label={`Hapus profil ${selectedJobProfile}`}
                  >
                    <Trash2 size={15} strokeWidth={2} />
                  </button>
                )}
              </div>

              {currentStep === 4 && (
                <>
                  <div className="job-editor-divider" aria-hidden />
                  <div className="job-editor-save-profile">
                    <input 
                      type="text" 
                      className="input-field profile-name-input"
                      placeholder={t("jobs.ph_profile_name")}
                      value={newJobProfileName}
                      onChange={(e) => setNewJobProfileName(e.target.value)}
                    />
                    <button 
                      type="button"
                      onClick={handleSaveJobProfile}
                      className="btn btn-secondary"
                      disabled={!newJobProfileName.trim() || (!jobName.trim() && !sourceValue.trim() && !destValue.trim())}
                      title={(!jobName.trim() && !sourceValue.trim() && !destValue.trim()) ? t("jobs.fill_config_fields") : t("jobs.save_config_profile")}
                    >
                      <Save size={16} /> {t('drive.btn_save')}
                    </button>
                  </div>
                </>
              )}
            </div>
            <button type="button" className="btn btn-secondary" onClick={onCancel}><X size={18} /> {t('accounts.cancel')}</button>
          </div>
        </div>
        
        <div className="stepper">
          {[1, 2, 3, 4].map(step => (
            <div key={step} className="stepper-item">
              <div className={`stepper-bar ${step <= currentStep ? 'active' : 'inactive'}`}></div>
              <span className={`stepper-text ${step === currentStep ? 'active' : 'inactive'}`}>
                {step === 1 ? t('ui.generated.identity_7e5a975') : step === 2 ? t('ui.generated.filters_96e5782') : step === 3 ? t('ui.generated.rules_bb11a8e') : t('ui.generated.review_e29a79f')}
              </span>
            </div>
          ))}
        </div>
      </header>

      <div className="job-editor-scroll-area">
        {/* STEP 1: IDENTITY */}
        <div style={{ display: currentStep >= 1 ? 'block' : 'none', flex: currentStep === 1 ? 1 : 'none', animation: 'fadeIn 0.3s ease-in-out' }}>
          <div className="card glass-panel" style={{ marginBottom: '24px' }}>
            <h3 className="section-title" style={{ marginBottom: '24px' }}>{t('ui.generated.job_identity_8e1be1d')}</h3>
            
            <label className="input-label" style={{ marginBottom: '8px', display: 'block' }}>{t('jobs.col_job_name')} <span style={{color: 'var(--danger)'}}>*</span></label>
            <input type="text" className="input-field" placeholder={t("jobs.ph_job_name_example")} value={jobName} onChange={e => {setJobName(e.target.value); setErrors({...errors, jobName: ''});}} style={{ width: '100%', border: errors.jobName ? '1px solid var(--danger)' : undefined }} />
            {errors.jobName && <span style={{color: 'var(--danger)', fontSize: '0.85rem', marginTop: '4px', display: 'block'}}>{errors.jobName}</span>}
            <div style={{marginBottom: '24px'}}></div>
            
            <div className="grid-2-cols" style={{ gap: '24px', marginBottom: '24px' }}>
              <div className="input-group">
                <label className="input-label">{t('ui.generated.select_session_033e135')} <span style={{color: 'var(--danger)'}}>*</span></label>
                <Select 
                  options={[
                    {value: '', label: '-- Select Active Session --'},
                    ...sessions.map(s => ({value: s.name, label: `${(s as any).label || s.name} (${s.status})`}))
                  ]}
                  value={selectedSession}
                  onChange={(val: any) => {
                    setSelectedSession(val);
                    setChatFolders([{ id: 0, title: 'Semua Chat', kind: 'all' }]);
                    setErrors({...errors, selectedSession: ''});
                  }}
                />
                {errors.selectedSession && <span className="error-text">{errors.selectedSession}</span>}
                {sessions.length === 0 && <span className="warning-text" style={{marginTop: '4px', display: 'block', fontSize: '0.8rem'}}>{t('ui.generated.no_active_sessions_found_add_one_in_auth_page_092e936')}</span>}
              </div>
            </div>

            <div className="grid-2-cols" style={{ gap: '24px' }}>
              <div className="input-group">
                <label className="input-label" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span>{t('ui.generated.source_from_72bb312')} <span style={{color: 'var(--danger)'}}>*</span></span>
                  <button type="button" className="btn-search" onClick={(e) => { e.preventDefault(); setModalTarget('source'); fetchDialogs('source'); }}>
                    <Search size={14} style={{marginRight: '6px'}}/> {t('ui.generated.browse_2f3b5c5')}
                  </button>
                </label>
                <div style={{ position: 'relative', display: 'flex', width: '100%' }}>
                  <FolderGit2 className="input-icon" size={18} />
                  <input type="text" className="input-field with-icon" style={{ flex: 1, border: errors.sourceValue ? '1px solid var(--danger)' : undefined }} value={sourceValue} onChange={(e) => {setSourceValue(e.target.value); setSourceName(""); setErrors({...errors, sourceValue: ''});}} placeholder={t("jobs.ph_chat_id_or_username")} />
                </div>
                {sourceName && !errors.sourceValue && (
                  <div style={{ marginTop: '8px', display: 'inline-flex', alignItems: 'center', background: 'rgba(255, 174, 0, 0.1)', padding: '4px 12px', borderRadius: '12px', color: 'var(--primary)', fontSize: '0.85rem', fontWeight: 600 }}>
                    <Hash size={14} style={{ marginRight: '6px' }} />
                    {sourceName}
                  </div>
                )}
                {errors.sourceValue && <span style={{color: 'var(--danger)', fontSize: '0.85rem', marginTop: '4px', display: 'block'}}>{errors.sourceValue}</span>}
              </div>
              <div className="input-group">
                <label className="input-label" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span>{t('ui.generated.destination_to_2778fe5')} <span style={{color: 'var(--danger)'}}>*</span></span>
                  <button type="button" className="btn-search" onClick={(e) => { e.preventDefault(); setModalTarget('dest'); fetchDialogs('dest'); }}>
                    <Search size={14} style={{marginRight: '6px'}}/> {t('ui.generated.browse_2f3b5c5')}
                  </button>
                </label>
                <div style={{ position: 'relative', display: 'flex', width: '100%' }}>
                  <FolderGit2 className="input-icon" size={18} />
                  <input type="text" className="input-field with-icon" style={{ flex: 1, border: errors.destValue ? '1px solid var(--danger)' : undefined }} value={destValue} onChange={(e) => {setDestValue(e.target.value); setDestName(""); setErrors({...errors, destValue: ''});}} placeholder={t('jobs.ph_chat_id_or_username')} />
                </div>
                {destName && !errors.destValue && (
                  <div style={{ marginTop: '8px', display: 'inline-flex', alignItems: 'center', background: 'rgba(255, 174, 0, 0.1)', padding: '4px 12px', borderRadius: '12px', color: 'var(--primary)', fontSize: '0.85rem', fontWeight: 600 }}>
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
          <div className="card glass-panel" style={{ marginBottom: '1.5rem' }}>
            <h3 className="section-title" style={{ marginBottom: '24px' }}>{t('ui.generated.data_filters_mode_c05c474')}</h3>
            
            <div style={{ marginBottom: '32px' }}>
              <label className="input-label" style={{ display: 'flex', alignItems: 'center', marginBottom: '16px' }}>
                {t('dashboard.transfer_mode')}
                <InfoTooltip content="Pilih mode eksekusi engine. Berpengaruh pada kecepatan dan jejak migrasi." />
              </label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div onClick={() => setMode('Fast Forward')} style={{ padding: '16px', borderRadius: '12px', border: mode === 'Fast Forward' ? '2px solid var(--primary)' : '1px solid var(--border)', background: mode === 'Fast Forward' ? 'rgba(255, 174, 0, 0.05)' : 'transparent', cursor: 'pointer', transition: 'all 0.2s ease' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
                    <input type="radio" checked={mode === 'Fast Forward'} readOnly style={{ width: '18px', height: '18px', accentColor: 'var(--primary)' }} />
                    <span style={{ fontWeight: 600, fontSize: '1.05rem', color: mode === 'Fast Forward' ? 'var(--primary)' : 'inherit' }}>{t('ui.generated.fast_forward_maximum_speed_bbca04c')}</span>
                  </div>
                  <div style={{ paddingLeft: '30px', fontSize: '0.85rem', color: 'var(--text-muted)', lineHeight: '1.6' }}>
                    <ul style={{ margin: 0, paddingLeft: '20px', listStyleType: 'square' }}>
                      <li>{t('ui.generated.native_telegram_forward_tercepat_batch_album_737201c')}</li>
                      <li>{t('ui.generated.caption_album_utuh_reply_hanya_jika_pesan_terkai_c36afb8')}</li>
                      <li>{t('jobs.job_editor_features')}</li>
                      <li><strong>{t('ui.generated.kelemahan_2acb1a1')}</strong> {t('ui.generated.jejak_forwarded_from_selalu_ada_api_bc6ef9b')}</li>
                      <li><strong>{t('ui.generated.cocok_untuk_da3ef08')}</strong> {t('ui.generated.backup_pribadi_arsip_cepat_channel_restricted_au_f320830')}</li>
                    </ul>
                  </div>
                </div>
                
                <div onClick={() => setMode('Clean Copy')} style={{ padding: '16px', borderRadius: '12px', border: mode === 'Clean Copy' ? '2px solid var(--primary)' : '1px solid var(--border)', background: mode === 'Clean Copy' ? 'rgba(255, 174, 0, 0.05)' : 'transparent', cursor: 'pointer', transition: 'all 0.2s ease' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
                    <input type="radio" checked={mode === 'Clean Copy'} readOnly style={{ width: '18px', height: '18px', accentColor: 'var(--primary)' }} />
                    <span style={{ fontWeight: 600, fontSize: '1.05rem', color: mode === 'Clean Copy' ? 'var(--primary)' : 'inherit' }}>{t('ui.generated.clean_copy_4241b91')}</span>
                  </div>
                  <div style={{ paddingLeft: '30px', fontSize: '0.85rem', color: 'var(--text-muted)', lineHeight: '1.6' }}>
                    <ul style={{ margin: 0, paddingLeft: '20px', listStyleType: 'square' }}>
                      <li>{t('ui.generated.tanpa_jejak_forwarded_from_stealth_964ada6')}</li>
                      <li>{t('jobs.job_editor_custom')}</li>
                      <li>{t('ui.generated.lebih_lambat_dari_fast_forward_4d874d0')}</li>
                    </ul>
                  </div>

                  {mode === 'Clean Copy' && (
                    <div style={{ marginTop: '16px', paddingLeft: '30px', display: 'flex', flexDirection: 'column', gap: '12px', animation: 'fadeIn 0.3s ease-in-out' }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: '12px', cursor: 'pointer', padding: '12px', borderRadius: '8px', border: cleanCopySubMode === 'Speed' ? '1px solid var(--primary)' : '1px solid var(--border)', background: cleanCopySubMode === 'Speed' ? 'rgba(255, 174, 0, 0.05)' : 'transparent' }} onClick={(e) => { e.stopPropagation(); setCleanCopySubMode('Speed'); }}>
                        <input type="radio" checked={cleanCopySubMode === 'Speed'} readOnly style={{ accentColor: 'var(--primary)' }} />
                        <div>
                          <strong style={{ color: cleanCopySubMode === 'Speed' ? 'var(--primary)' : 'inherit' }}>{t('ui.generated.speed_batch_reuse_id_b865c8d')}</strong>
                          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{t('ui.generated.lebih_cepat_upload_batch_album_file_id_reuse_2550e24')}</div>
                        </div>
                      </label>
                      <label style={{ display: 'flex', alignItems: 'center', gap: '12px', cursor: 'pointer', padding: '12px', borderRadius: '8px', border: cleanCopySubMode === 'Safe' ? '1px solid var(--primary)' : '1px solid var(--border)', background: cleanCopySubMode === 'Safe' ? 'rgba(255, 174, 0, 0.05)' : 'transparent' }} onClick={(e) => { e.stopPropagation(); setCleanCopySubMode('Safe'); }}>
                        <input type="radio" checked={cleanCopySubMode === 'Safe'} readOnly style={{ accentColor: 'var(--primary)' }} />
                        <div>
                          <strong style={{ color: cleanCopySubMode === 'Safe' ? 'var(--primary)' : 'inherit' }}>{t('ui.generated.safe_sequential_output_d07923e')}</strong>
                          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{t('ui.generated.integritas_stabilitas_tinggi_custom_caption_penu_fb76583')}</div>
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
                    {t('ui.generated.quality_mode_enterprise_ccaea79')}
                    <InfoTooltip content="SMART: Auto-selects based on file type. ORIGINAL: Byte-for-byte exact. HIGH_QUALITY: Best native output." />
                  </label>
                  <Select 
                    options={[
                      {value: 'SMART', label: 'SMART (Auto-select)'},
                      {value: 'ORIGINAL', label: 'ORIGINAL (Document Mode)'},
                      {value: 'HIGH_QUALITY', label: 'HIGH QUALITY (Native Media)'}
                    ]}
                    value={qualityMode}
                    onChange={(v: any) => setQualityMode(v)}
                  />
                </div>
              )}

              {mode === 'Clean Copy' && (
                <>
                  <div className="input-group">
                    <label className="input-label" style={{ display: 'flex', alignItems: 'center' }}>
                      {t('drive.hardware_reencode')}
                      <InfoTooltip content="Pilih akselerasi GPU (NVENC/AMF/QSV) untuk kecepatan re-encode maksimal." />
                    </label>
                    <Select 
                      options={[
                        {value: 'auto', label: 'Auto (Prioritas GPU)'},
                        {value: 'nvidia', label: 'NVIDIA (NVENC)'},
                        {value: 'amd', label: 'AMD (AMF)'},
                        {value: 'intel', label: 'Intel (QSV)'},
                        {value: 'cpu', label: 'CPU (Slow)'}
                      ]}
                      value={reencodeHardware}
                      onChange={(v: any) => setReencodeHardware(v)}
                    />
                  </div>
                  <div className="input-group">
                    <label className="input-label" style={{ display: 'flex', alignItems: 'center' }}>
                      {t('drive.reencode_mode')}
                      <InfoTooltip content="Pilih profil untuk kecepatan proses re-encode (Handbrake-style)." />
                    </label>
                    <Select 
                      options={[
                        {value: 'speed', label: 'Kecepatan'},
                        {value: 'balanced', label: 'Seimbang (Default)'},
                        {value: 'quality', label: 'Kualitas'}
                      ]}
                      value={reencodePreset}
                      onChange={(v: any) => setReencodePreset(v)}
                    />
                  </div>
                </>
              )}

              <div className="input-group">
                <label className="input-label" style={{ display: 'flex', alignItems: 'center' }}>
                  {t('ui.generated.fetch_direction_d73cc40')}
                  <InfoTooltip content="Pilih apakah pesan akan disalin dari yang Terbaru atau dari yang Terlama." />
                </label>
                <Select 
                  options={[{value: 'Newest First', label: 'Newest First'}, {value: 'Oldest First', label: 'Oldest First'}]}
                  value={fetchDirection}
                  onChange={(v: any) => setFetchDirection(v)}
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
                  <span>{t('ui.generated.media_limit_d54fc2c')}</span>
                  <InfoTooltip content="Membatasi jumlah maksimal media yang akan ditransfer dalam satu sesi eksekusi. Gunakan angka 0 untuk transfer tanpa batas (Unlimited)." />
                </div>
                <input type="number" value={limit} onChange={(e) => setLimit(e.target.value === '' ? '' : Number(e.target.value))} className="input-field" placeholder={t("jobs.ph_zero_unlimited")} style={{ width: '100%', opacity: enableLimit ? 1 : 0.5 }} disabled={!enableLimit} />
              </div>
              <div className="input-group">
                <div className="toggle-label-group" style={{ marginBottom: '8px' }}>
                  <label className="toggle-switch">
                    <input type="checkbox" checked={enableSizeFilter} onChange={e => setEnableSizeFilter(e.target.checked)} />
                    <span className="toggle-slider"></span>
                  </label>
                  <span>{t('jobs.size_filter')}</span>
                  <InfoTooltip content="Only transfer media files within this size range." />
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <input type="number" value={sizeMin} onChange={(e) => setSizeMin(e.target.value === '' ? '' : Number(e.target.value))} className="input-field" placeholder={t("jobs.ph_min")} style={{ flex: 1, opacity: enableSizeFilter ? 1 : 0.5 }} disabled={!enableSizeFilter} />
                  <input type="number" value={sizeMax} onChange={(e) => setSizeMax(e.target.value === '' ? '' : Number(e.target.value))} className="input-field" placeholder={t("jobs.ph_max")} style={{ flex: 1, opacity: enableSizeFilter ? 1 : 0.5 }} disabled={!enableSizeFilter} />
                </div>
              </div>

              <div className="input-group">
                <div className="toggle-label-group" style={{ marginBottom: '8px' }}>
                  <label className="toggle-switch">
                    <input type="checkbox" checked={enableMediaFilter} onChange={e => setEnableMediaFilter(e.target.checked)} />
                    <span className="toggle-slider"></span>
                  </label>
                  <span>{t('jobs.media_filter')}</span>
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
                  onChange={(v: any) => setMedia(v)}
                  disabled={!enableMediaFilter}
                />
              </div>
              
              <div className="input-group">
                <label className="input-label" style={{ display: 'flex', alignItems: 'center', marginBottom: '14px' }}>
                  {t('ui.generated.album_grouped_media_eec1496')}
                  <InfoTooltip content="Choose how to handle grouped media/albums." />
                </label>
                <Select 
                  options={[
                    {value: 'Follow Source', label: 'Follow Source (Group if grouped)'},
                    {value: 'Force Split', label: 'Force Split (Send one by one)'},
                    {value: 'Force Group', label: 'Force Group (Force group into album)'}
                  ]}
                  value={albumHandling}
                  onChange={(v: any) => setAlbumHandling(v)}
                  disabled={mode === 'Fast Forward'}
                />
                {mode === 'Fast Forward' && <span style={{fontSize: '0.8rem', color: 'var(--text-muted)'}}>{t('ui.generated.fast_forward_always_preserves_albums_natively_0f9a81a')}</span>}
              </div>

              <div className="input-group col-span-full">
                <div className="toggle-label-group" style={{ marginBottom: '8px' }}>
                  <label className="toggle-switch">
                    <input type="checkbox" checked={enableDateFilter} onChange={e => setEnableDateFilter(e.target.checked)} />
                    <span className="toggle-slider"></span>
                  </label>
                  <span>{t('jobs.date_filter')}</span>
                  <InfoTooltip content="Only transfer messages posted within this date range." />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                  <div>
                    <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '4px', display: 'block' }}>{t('dashboard.start_date')}</label>
                    <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="input-field" style={{ width: '100%', opacity: enableDateFilter ? 1 : 0.5 }} disabled={!enableDateFilter} />
                  </div>
                  <div>
                    <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '4px', display: 'block' }}>{t('dashboard.end_date')}</label>
                    <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="input-field" style={{ width: '100%', opacity: enableDateFilter ? 1 : 0.5 }} disabled={!enableDateFilter} />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* STEP 3: RULES */}
        <div ref={step3Ref} style={{ display: currentStep >= 3 ? 'block' : 'none', flex: currentStep === 3 ? 1 : 'none', animation: 'fadeIn 0.3s ease-in-out' }}>
          <div className="card glass-panel" style={{ marginBottom: '1.5rem' }}>
            <h3 className="section-title" style={{ marginBottom: '24px' }}>{t('ui.generated.rules_behaviors_d55d1de')}</h3>
            
            <div className="grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
              <div className="input-group">
                <div className="toggle-label-group">
                  <label className="toggle-switch">
                    <input type="checkbox" checked={enableCaptionRule} onChange={e => setEnableCaptionRule(e.target.checked)} disabled={mode === 'Fast Forward'} />
                    <span className="toggle-slider"></span>
                  </label>
                  <span style={{ opacity: mode === 'Fast Forward' ? 0.5 : 1 }}>{t('dashboard.caption_rule')}</span>
                  <InfoTooltip content={t('dashboard.tooltip_caption_rule') || 'Modify or remove text captions from media messages.'} />
                </div>
                {mode === 'Fast Forward' && <span style={{fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '8px', display: 'block'}}>{t('ui.generated.not_supported_in_fast_forward_mode_dfecae6')}</span>}
                <Select 
                  options={[{value: 'remove', label: 'Remove'}, {value: 'strip_links', label: 'Strip Links'}, {value: 'custom', label: 'Custom'}]}
                  value={captionRule}
                  onChange={(v: any) => setCaptionRule(v)}
                  disabled={!enableCaptionRule}
                />
                {captionRule === 'custom' && enableCaptionRule && (
                  <button 
                    onClick={() => setIsCaptionModalOpen(true)}
                    className="btn-secondary" 
                    style={{ width: '100%', marginTop: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px' }}
                  >
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '85%', color: customCaption ? 'var(--text-main)' : 'var(--text-muted)' }}>
                      {customCaption ? customCaption : t('ui.generated.set_custom_template_fbc0514')}
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
                  <span>{t('dashboard.dup_action')}</span>
                  <InfoTooltip content={t('dashboard.tooltip_disable_dup') || 'Decide what to do if a message already exists in the destination.'} />
                </div>
                <Select 
                  options={[
                    {value: 'Skip', label: 'Skip'}, 
                    {value: 'Overwrite', label: 'Overwrite'},
                    {value: 'Verify', label: 'Verify Dest'}
                  ]}
                  value={dupAction}
                  onChange={(v: any) => setDupAction(v)}
                  disabled={!enableDupAction}
                />
              </div>

              <div className="input-group">
                <div className="toggle-label-group">
                  <label className="toggle-switch">
                    <input type="checkbox" className="warning-toggle" checked={enableThrottle} onChange={e => setEnableThrottle(e.target.checked)} />
                    <span className="toggle-slider"></span>
                  </label>
                  <span className="warning-text">{t('ui.generated.enable_throttle_9e9cf78')}</span>
                  <InfoTooltip content={t('dashboard.tooltip_throttle') || 'Add a delay between messages to prevent being banned by Telegram for spam.'} />
                </div>
                {enableThrottle && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', paddingLeft: '8px', borderLeft: '2px solid var(--warning)', marginTop: '8px' }}>
                    <input type="number" value={delayMin} onChange={(e) => setDelayMin(e.target.value === '' ? '' : Number(e.target.value))} className="input-field" style={{ width: '70px', padding: '6px' }} />
                    <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>-</span>
                    <input type="number" value={delayMax} onChange={(e) => setDelayMax(e.target.value === '' ? '' : Number(e.target.value))} className="input-field" style={{ width: '70px', padding: '6px' }} />
                    <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>{t('ui.generated.s_a0f1490')}</span>
                  </div>
                )}
              </div>
              
              <div className="input-group">
                <div className="toggle-label-group">
                  <label className="toggle-switch">
                    <input type="checkbox" className="danger-toggle" checked={autoFallback} onChange={(e) => setAutoFallback(e.target.checked)} />
                    <span className="toggle-slider"></span>
                  </label>
                  <span className="danger-text">{t('ui.generated.auto_fallback_f183b06')}</span>
                  <InfoTooltip content={t('dashboard.tooltip_fallback') || 'Jika Fast Forward diblokir (noforwards / restricted), otomatis beralih ke Clean Copy (Enterprise).'} />
                </div>
                <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '8px' }}>
                  {mode === 'Fast Forward'
                    ? t('ui.generated.jika_forward_diblokir_telegram_job_beralih_ke_cl_c1e4fb7')
                    : t('ui.generated.hanya_relevan_untuk_fast_forward_clean_copy_tida_d6003aa')}
                </p>
              </div>

              <div className="input-group col-span-full">
                <div className="toggle-label-group">
                  <label className="toggle-switch">
                    <input type="checkbox" checked={hideTrace} onChange={e => setHideTrace(e.target.checked)} disabled={mode === 'Fast Forward'} />
                    <span className="toggle-slider"></span>
                  </label>
                  <span style={{ opacity: mode === 'Fast Forward' ? 0.5 : 1 }}>{t('ui.generated.hide_forwarded_from_trace_8e32d0a')}</span>
                  <InfoTooltip content="Removes the 'Forwarded from' tag when messages are forwarded." />
                </div>
                {mode === 'Fast Forward' && <span style={{fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '8px', display: 'block'}}>{t('ui.generated.fast_forward_api_inherently_leaves_a_forward_tra_d4b362a')}</span>}
              </div>

            </div>
          </div>
        </div>

        {/* STEP 4: REVIEW */}
        <div ref={step4Ref} style={{ display: currentStep >= 4 ? 'block' : 'none', flex: currentStep === 4 ? 1 : 'none', animation: 'fadeIn 0.3s ease-in-out' }}>
          <div className="card glass-panel" style={{ marginBottom: '1.5rem' }}>
            <h3 className="section-title" style={{ marginBottom: '24px' }}>{t('ui.generated.review_execute_5ef91ba')}</h3>
            <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)', marginBottom: '24px' }}>{t('ui.generated.please_review_your_configuration_before_starting_000b4d4')}</p>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              
              {/* Identity Section */}
              <div style={{ background: 'rgba(255,255,255,0.03)', borderRadius: '12px', border: '1px solid var(--border)', padding: '20px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px', color: 'var(--primary)' }}>
                  <User size={18} /> <h4 style={{ margin: 0, fontSize: '1rem', color: 'var(--text-main)' }}>{t('ui.generated.job_identity_8e1be1d')}</h4>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
                  <div>
                    <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem', display: 'block', marginBottom: '4px' }}>{t('jobs.col_job_name')}</span>
                    <div style={{ fontWeight: 600, fontSize: '1.05rem', color: 'var(--text-main)' }}>{jobName || <span style={{ color: 'var(--danger)', fontStyle: 'italic' }}>{t('ui.generated.missing_92185dc')}</span>}</div>
                  </div>
                  <div>
                    <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem', display: 'block', marginBottom: '4px' }}>{t('ui.generated.session_account_5bfeb4b')}</span>
                    <div style={{ fontWeight: 600, fontSize: '1.05rem', color: 'var(--text-main)' }}>{selectedSession || <span style={{ color: 'var(--danger)', fontStyle: 'italic' }}>{t('ui.generated.missing_92185dc')}</span>}</div>
                  </div>
                </div>
              </div>

              {/* Routing Section */}
              <div style={{ display: 'flex', gap: '16px', alignItems: 'stretch' }}>
                <div style={{ flex: 1, background: 'rgba(255,255,255,0.03)', borderRadius: '12px', border: '1px solid var(--border)', padding: '20px', display: 'flex', flexDirection: 'column' }}>
                  <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem', display: 'block', marginBottom: '8px' }}>{t('ui.generated.source_from_72bb312')}</span>
                  <div style={{ fontWeight: 600, fontSize: '1.1rem', color: 'var(--text-main)', marginBottom: '4px' }}>{sourceName || (sourceValue ? t('ui.generated.custom_source_a841c98') : <span style={{ color: 'var(--danger)', fontStyle: 'italic' }}>{t('ui.generated.missing_source_5abce09')}</span>)}</div>
                  <div style={{ fontFamily: 'monospace', color: 'var(--primary)', fontSize: '0.9rem', background: 'rgba(0,0,0,0.2)', padding: '4px 8px', borderRadius: '4px', alignSelf: 'flex-start' }}>{sourceValue || t('ui.generated.no_id_3882321')}</div>
                </div>
                
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--primary)', opacity: 0.8 }}>
                  <Play size={24} style={{ fill: 'var(--primary)' }} />
                </div>
                
                <div style={{ flex: 1, background: 'rgba(255,255,255,0.03)', borderRadius: '12px', border: '1px solid var(--border)', padding: '20px', display: 'flex', flexDirection: 'column' }}>
                  <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem', display: 'block', marginBottom: '8px' }}>{t('ui.generated.destination_to_2778fe5')}</span>
                  <div style={{ fontWeight: 600, fontSize: '1.1rem', color: 'var(--text-main)', marginBottom: '4px' }}>{destName || (destValue ? t('ui.generated.custom_destination_42b661e') : <span style={{ color: 'var(--danger)', fontStyle: 'italic' }}>{t('ui.generated.missing_destination_b9fbf32')}</span>)}</div>
                  <div style={{ fontFamily: 'monospace', color: 'var(--primary)', fontSize: '0.9rem', background: 'rgba(0,0,0,0.2)', padding: '4px 8px', borderRadius: '4px', alignSelf: 'flex-start' }}>{destValue || t('ui.generated.no_id_3882321')}</div>
                </div>
              </div>

              {/* Filters & Rules Section */}
              <div style={{ background: 'rgba(255,255,255,0.03)', borderRadius: '12px', border: '1px solid var(--border)', padding: '20px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px', color: 'var(--primary)' }}>
                  <Settings size={18} /> <h4 style={{ margin: 0, fontSize: '1rem', color: 'var(--text-main)' }}>{t('ui.generated.configuration_details_317e190')}</h4>
                </div>
                
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '20px', padding: '12px', background: 'rgba(0,0,0,0.2)', borderRadius: '8px' }}>
                  
                  <div>
                    <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem', display: 'block', marginBottom: '4px', textTransform: 'uppercase' }}>{t('drive.mode_label')}</span>
                    <div style={{ fontWeight: 500, color: 'var(--text-main)' }}>{mode}</div>
                  </div>
                  <div>
                    <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem', display: 'block', marginBottom: '4px', textTransform: 'uppercase' }}>{t('dashboard.msg_limit')}</span>
                    <div style={{ fontWeight: 500, color: 'var(--text-main)' }}>{enableLimit ? limit : t('ui.generated.unlimited_b8bef37')}</div>
                  </div>
                  <div>
                    <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem', display: 'block', marginBottom: '4px', textTransform: 'uppercase' }}>{t('ui.generated.fetch_direction_d73cc40')}</span>
                    <div style={{ fontWeight: 500, color: 'var(--text-main)' }}>{fetchDirection}</div>
                  </div>

                  <div>
                    <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem', display: 'block', marginBottom: '4px', textTransform: 'uppercase' }}>{t('dashboard.caption_rule')}</span>
                    <div style={{ fontWeight: 500, color: 'var(--text-main)' }}>{captionRule}</div>
                  </div>
                  <div>
                    <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem', display: 'block', marginBottom: '4px', textTransform: 'uppercase' }}>{t('dashboard.dup_action')}</span>
                    <div style={{ fontWeight: 500, color: 'var(--text-main)' }}>{dupAction}</div>
                  </div>
                  <div>
                    <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem', display: 'block', marginBottom: '4px', textTransform: 'uppercase' }}>{t('ui.generated.anti_flood_throttle_b642d38')}</span>
                    <div style={{ fontWeight: 500, color: 'var(--text-main)' }}>{enableThrottle ? `${delayMin}s - ${delayMax}s Delay` : t('settings.debug_status_inactive')}</div>
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
          {t('drive.back_to_settings')}
        </button>
        
        {currentStep < 4 ? (
          <button className="btn btn-primary" onClick={handleNext} style={{ padding: '0 32px' }}>
            {t('ui.generated.next_step_574f02b')}
          </button>
        ) : (
          <div style={{ display: 'flex', gap: '12px' }}>
            <button className="btn btn-secondary" onClick={() => startMigration(true)} style={{ padding: '0 24px', color: 'var(--primary)', borderColor: 'var(--primary)', background: 'rgba(88, 101, 242, 0.05)' }}>
              {t('ui.generated.dry_run_9dbf2fc')}
            </button>
            <button className="btn btn-primary" onClick={() => startMigration(false)} style={{ padding: '0 32px', background: 'var(--primary)' }}>
              {initialJob ? (
                  <><Save size={18} style={{ marginRight: '8px' }} /> {t('ui.generated.save_changes_fa2984b')}</>
              ) : (
                  <><Play size={18} style={{ marginRight: '8px' }} /> {t('ui.generated.start_job_fbd7e08')}</>
              )}
            </button>
          </div>
        )}
      </div>
      
      {/* Auto Discovery Modal — portaled so layout cannot collapse under page chrome */}
      {isModalOpen &&
        typeof document !== 'undefined' &&
        createPortal(
          <div className="modal-overlay" onClick={() => setIsModalOpen(false)}>
            <div className="modal-content" onClick={(e) => e.stopPropagation()}>
              <div className="modal-header">
                <h3 style={{ margin: 0, fontSize: '1.1rem' }}>
                  {modalTarget === 'source' ? t('dashboard.select_source') : t('dashboard.select_dest')}
                </h3>
                <button
                  className="btn"
                  style={{ background: 'transparent', padding: 4 }}
                  onClick={() => setIsModalOpen(false)}
                >
                  <X size={20} />
                </button>
              </div>
              <div className="modal-body">
                {isLoadingDialogs ? (
                  <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted)' }}>
                    <RefreshCcw className="spin" size={24} style={{ margin: '0 auto 12px' }} />
                    <p>{t('dashboard.loading_api')}</p>
                  </div>
                ) : selectedDialogId && isForumGroup ? (
                  <div>
                    <div
                      style={{
                        padding: '12px 20px',
                        background: 'rgba(255, 174, 0, 0.1)',
                        color: 'var(--primary)',
                        fontWeight: 600,
                      }}
                    >
                      {t('dashboard.select_subtopic')}
                    </div>
                    <div
                      className="dialog-item"
                      onClick={() =>
                        selectTopic(selectedDialogId, '', t('dashboard.all_group') || 'All Group')
                      }
                    >
                      <Hash size={18} color="var(--text-muted)" />
                      <div>{t('dashboard.all_group')}</div>
                    </div>
                    <div
                      className="dialog-item"
                      onClick={() =>
                        selectTopic(selectedDialogId, '1', t('dashboard.general_topic') || 'General')
                      }
                    >
                      <Hash size={18} color="var(--primary)" />
                      <div>{t('dashboard.general_topic') || t('ui.generated.general_9239ee2')}</div>
                    </div>
                    {topics.map((tp) => (
                      <div
                        key={tp.id}
                        className="dialog-item"
                        onClick={() => selectTopic(selectedDialogId, tp.id, tp.title)}
                      >
                        <Hash size={18} color="var(--primary)" />
                        <div>{tp.title}</div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <>
                    {chatFolders && chatFolders.length > 1 && (
                      <div
                        style={{
                          display: 'flex',
                          gap: '8px',
                          padding: '12px 20px',
                          overflowX: 'auto',
                          borderBottom: '1px solid rgba(255,255,255,0.05)',
                          background: 'rgba(255,255,255,0.02)',
                        }}
                      >
                        {chatFolders.map((folder) => {
                          const active = folder.id === selectedFolderId;
                          return (
                            <div
                              key={folder.id}
                              onClick={() => {
                                setSelectedFolderId(folder.id);
                                fetchDialogs(modalTarget, folder.id);
                              }}
                              style={{
                                padding: '4px 12px',
                                borderRadius: '16px',
                                fontSize: '0.8rem',
                                fontWeight: 600,
                                cursor: 'pointer',
                                background: active ? 'var(--primary)' : 'rgba(255,255,255,0.05)',
                                color: active ? '#fff' : 'var(--text-muted)',
                                transition: 'var(--transition-safe)',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '4px',
                                whiteSpace: 'nowrap',
                              }}
                            >
                              {folder.emoticon && <span>{folder.emoticon}</span>}
                              <span>{folder.title === t('ui.generated.semua_chat_a316d41') ? (t('dashboard.all_chats') || t('ui.generated.semua_chat_a316d41')) : folder.title}</span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                    <div
                      style={{
                        display: 'flex',
                        gap: '8px',
                        padding: '12px 20px',
                        overflowX: 'auto',
                        borderBottom: '1px solid rgba(255,255,255,0.05)',
                      }}
                    >
                      {['All', 'User', 'Group', 'Channel', 'Bot'].map((f) => (
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
                            transition: 'var(--transition-safe)',
                          }}
                        >
                          {f === 'Group' ? t('drive.filter_forums') : f}
                        </div>
                      ))}
                    </div>
                    <div style={{ padding: '8px 20px', position: 'relative', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                      <Search size={16} style={{ position: 'absolute', left: '32px', top: '18px', color: 'var(--text-muted)' }} />
                      <input
                        type="text"
                        placeholder={t('dashboard.search_chat_placeholder')}
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        style={{
                          width: '100%',
                          padding: '8px 36px 8px 36px',
                          borderRadius: '8px',
                          background: 'rgba(255, 255, 255, 0.05)',
                          border: '1px solid rgba(255, 255, 255, 0.1)',
                          color: 'var(--text-main)',
                          fontSize: '0.9rem',
                          outline: 'none',
                          transition: 'var(--transition-safe)',
                        }}
                        onFocus={(e) => e.target.style.borderColor = 'var(--primary)'}
                        onBlur={(e) => e.target.style.borderColor = 'rgba(255, 255, 255, 0.1)'}
                      />
                      {searchQuery && (
                        <button
                          type="button"
                          onClick={() => setSearchQuery('')}
                          style={{
                            position: 'absolute',
                            right: '32px',
                            top: '12px',
                            background: 'transparent',
                            border: 'none',
                            color: 'var(--text-muted)',
                            cursor: 'pointer',
                            padding: '4px',
                          }}
                        >
                          <X size={14} />
                        </button>
                      )}
                    </div>
                    {dialogs
                      .filter(
                        (d) =>
                          (dialogFilter === 'All' ||
                            d.type === dialogFilter ||
                            (dialogFilter === 'Group' && d.is_forum)) &&
                          ((d.name || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
                            String(d.id).includes(searchQuery))
                      )
                      .map((d) => {
                        let badgeText = d.type || 'Unknown';
                        let icon = (
                          <User size={18} color="var(--primary)" style={{ marginRight: '12px', flexShrink: 0 }} />
                        );
                        let bg = 'rgba(255,255,255,0.1)';
                        let color = 'var(--text-muted)';

                        if (d.is_forum) {
                          badgeText = 'Group';
                          icon = (
                            <Hash size={18} color="#d946ef" style={{ marginRight: '12px', flexShrink: 0 }} />
                          );
                          bg = 'rgba(217, 70, 239, 0.2)';
                          color = '#d946ef';
                        } else if (d.type === 'Channel') {
                          icon = (
                            <Radio size={18} color="#f59e0b" style={{ marginRight: '12px', flexShrink: 0 }} />
                          );
                          bg = 'rgba(245, 158, 11, 0.2)';
                          color = '#f59e0b';
                        } else if (d.type === 'Group') {
                          icon = (
                            <Users size={18} color="#3b82f6" style={{ marginRight: '12px', flexShrink: 0 }} />
                          );
                          bg = 'rgba(59, 130, 246, 0.2)';
                          color = '#3b82f6';
                        } else if (d.type === 'Bot') {
                          icon = (
                            <Bot size={18} color="#10b981" style={{ marginRight: '12px', flexShrink: 0 }} />
                          );
                          bg = 'rgba(16, 185, 129, 0.2)';
                          color = '#10b981';
                        } else if (d.type === 'User') {
                          icon = (
                            <User size={18} color="#94a3b8" style={{ marginRight: '12px', flexShrink: 0 }} />
                          );
                          bg = 'rgba(148, 163, 184, 0.2)';
                          color = '#94a3b8';
                        }

                        return (
                          <div
                            key={d.id}
                            className="dialog-item"
                            onClick={() => selectDialog(d.id, d.name, d.is_forum)}
                            style={{ display: 'flex', alignItems: 'center' }}
                          >
                            <span style={{ width: 24, height: 24, marginRight: '12px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                              <PeerAvatar peerId={Number(d.id)} creds={activeCreds} title={d.name} fallback={icon} />
                            </span>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div
                                style={{
                                  fontWeight: 600,
                                  whiteSpace: 'nowrap',
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                }}
                              >
                                {d.name}
                              </div>
                              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                                {t('ui.generated.id_d789a1e')} {d.id}
                              </div>
                            </div>
                            <span
                              style={{
                                fontSize: '0.7rem',
                                background: bg,
                                color,
                                padding: '2px 8px',
                                borderRadius: '12px',
                                fontWeight: 600,
                                textTransform: 'uppercase',
                                letterSpacing: '0.5px',
                                marginLeft: '8px',
                                flexShrink: 0,
                              }}
                            >
                              {badgeText}
                            </span>
                          </div>
                        );
                      })}
                  </>
                )}
              </div>
            </div>
          </div>,
          document.body
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
