import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { runDaemonOnce } from '../../lib/tauri/workerBridge';
import { Bookmark, Trash2, Edit3, Save } from 'lucide-react';
import { ConfirmModal } from '../../components/common/ConfirmModal';

interface Profile {
  id: number;
  name: string;
  config_json: string;
  created_at: string;
}

export function Profiles() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [isEditing, setIsEditing] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [editConfig, setEditConfig] = useState("");
  const [error, setError] = useState("");

  const loadProfiles = async () => {
    try {
      setLoading(true);
      const result = await runDaemonOnce(['--action', 'list-profiles']);
      
      const lines = result.stdout.split('\n');
      for (const line of lines) {
        if (line.startsWith('[JSON_OUTPUT]')) {
          const jsonStr = line.substring('[JSON_OUTPUT]'.length).trim();
          if (jsonStr) {
            try {
              setProfiles(JSON.parse(jsonStr));
            } catch (pErr) {
              console.warn("Failed to parse profiles JSON:", pErr);
              setProfiles([]);
            }
          }
          break;
        }
      }
    } catch (err) {
      console.error(err);
      setError(t('ui.generated.failed_to_load_profiles_25c10cf'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadProfiles();
  }, []);

  const { t } = useTranslation();
  const [deleteTargetProfileId, setDeleteTargetProfileId] = useState<number | null>(null);

  const handleDelete = (id: number) => {
    setDeleteTargetProfileId(id);
  };

  const executeDeleteProfile = async () => {
    const id = deleteTargetProfileId;
    if (id === null) return;
    setDeleteTargetProfileId(null);

    try {
      await runDaemonOnce([
        '--action', 'delete-profile',
        '--profile-id', String(id),
      ]);
      await loadProfiles();
    } catch (err) {
      console.error(err);
      setError(t('ui.generated.failed_to_delete_profile_ba1affc'));
    }
  };

  const handleSave = async () => {
    try {
      await runDaemonOnce([
        '--action', 'save-profile',
        '--profile-name', editName,
        '--profile-config', editConfig,
      ]);
      setIsEditing(null);
      await loadProfiles();
    } catch (err) {
      console.error(err);
      setError(t('ui.generated.failed_to_save_profile_0c714d9'));
    }
  };

  const startEdit = (profile: Profile) => {
    setIsEditing(profile.id);
    setEditName(profile.name);
    setEditConfig(profile.config_json);
  };

  return (
    <main className="main-content page-stack fade-in">
      <header className="page-header">
        <h2 className="title title-with-icon">
          <Bookmark color="var(--primary)" size={28} aria-hidden />
          {t('ui.generated.migration_profiles_998a7df')}
        </h2>
        <p className="subtitle">{t('ui.generated.manage_your_saved_templates_and_configurations_11c597b')}</p>
      </header>

      {error && (
        <div className="alert-error">
          {error}
        </div>
      )}

      <div className="table-container">
        <table className="glass-table">
          <thead>
            <tr>
              <th>{t('speedtest.col_name')}</th>
              <th>{t('speedtest.tools_group_settings')}</th>
              <th>{t('ui.generated.created_at_5db1542')}</th>
              <th>{t('automation.col_actions')}</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={4} className="empty-state">{t('ui.generated.loading_profiles_7b1f2b3')}</td>
              </tr>
            ) : profiles.map((p) => {
              if (isEditing === p.id) {
                return (
                  <tr key={p.id}>
                    <td>
                      <input 
                        type="text" 
                        value={editName} 
                        onChange={e => setEditName(e.target.value)} 
                        className="input-field" 
                        style={{ padding: '8px' }}
                      />
                    </td>
                    <td>
                      <textarea 
                        value={editConfig}
                        onChange={e => setEditConfig(e.target.value)}
                        className="input-field"
                        style={{ width: '100%', minHeight: '80px', padding: '8px', fontSize: '0.8rem', fontFamily: 'monospace' }}
                      />
                    </td>
                    <td>{p.created_at}</td>
                    <td>
                      <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                        <button className="btn btn-secondary" style={{ padding: '6px 10px', color: 'var(--primary)' }} onClick={() => handleSave()} title={t('speedtest.btn_save')}>
                          <Save size={16} />
                        </button>
                        <button className="btn btn-secondary" style={{ padding: '6px 10px' }} onClick={() => setIsEditing(null)} title={t('accounts.cancel')}>
                          {t('accounts.cancel')}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              }

              return (
                <tr key={p.id}>
                  <td>
                    <div style={{ fontWeight: 600, color: 'var(--text-main)' }}>{p.name}</div>
                  </td>
                  <td style={{ maxWidth: '300px' }}>
                    <div style={{ 
                      fontSize: '0.75rem', 
                      color: 'var(--text-muted)', 
                      whiteSpace: 'nowrap', 
                      overflow: 'hidden', 
                      textOverflow: 'ellipsis',
                      fontFamily: 'monospace',
                      background: 'rgba(0,0,0,0.2)',
                      padding: '4px 8px',
                      borderRadius: '4px'
                    }}>
                      {p.config_json}
                    </div>
                  </td>
                  <td>{p.created_at}</td>
                  <td>
                    <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                      <button className="btn btn-secondary" style={{ padding: '6px 10px', color: 'var(--primary)' }} onClick={() => startEdit(p)} title={t('ui.generated.edit_5301648')}>
                        <Edit3 size={16} />
                      </button>
                      <button className="btn btn-secondary" style={{ padding: '6px 10px', color: 'var(--danger)' }} onClick={() => handleDelete(p.id)} title={t('speedtest.preview_delete_btn')}>
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
            
            {!loading && profiles.length === 0 && (
              <tr>
                <td colSpan={4} className="empty-state">
                  {t('ui.generated.no_profiles_saved_yet_you_can_save_your_current__b18ce57')}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <ConfirmModal
        isOpen={deleteTargetProfileId !== null}
        title={t('profiles.delete_confirm_title')}
        description={t('profiles.delete_confirm_desc')}
        variant="danger"
        confirmText={t('common.delete')}
        cancelText={t('common.cancel')}
        onConfirm={executeDeleteProfile}
        onCancel={() => setDeleteTargetProfileId(null)}
      />
    </main>
  );
}
