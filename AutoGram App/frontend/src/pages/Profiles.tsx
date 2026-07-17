import { useState, useEffect } from 'react';
import { runDaemonOnce } from '../lib/workerBridge';
import { Bookmark, Trash2, Edit3, Save } from 'lucide-react';

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
          const jsonStr = line.substring('[JSON_OUTPUT]'.length);
          setProfiles(JSON.parse(jsonStr));
          break;
        }
      }
    } catch (err) {
      console.error(err);
      setError("Failed to load profiles");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadProfiles();
  }, []);

  const handleDelete = async (id: number) => {
    if (!confirm("Are you sure you want to delete this profile?")) return;
    
    try {
      await runDaemonOnce([
        '--action', 'delete-profile',
        '--profile-id', String(id),
      ]);
      await loadProfiles();
    } catch (err) {
      console.error(err);
      setError("Failed to delete profile");
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
      setError("Failed to save profile");
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
          Migration Profiles
        </h2>
        <p className="subtitle">Manage your saved templates and configurations.</p>
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
              <th>Name</th>
              <th>Configuration</th>
              <th>Created At</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={4} className="empty-state">Loading profiles...</td>
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
                        <button className="btn btn-secondary" style={{ padding: '6px 10px', color: 'var(--primary)' }} onClick={() => handleSave()} title="Save">
                          <Save size={16} />
                        </button>
                        <button className="btn btn-secondary" style={{ padding: '6px 10px' }} onClick={() => setIsEditing(null)} title="Cancel">
                          Cancel
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
                      <button className="btn btn-secondary" style={{ padding: '6px 10px', color: 'var(--primary)' }} onClick={() => startEdit(p)} title="Edit">
                        <Edit3 size={16} />
                      </button>
                      <button className="btn btn-secondary" style={{ padding: '6px 10px', color: 'var(--danger)' }} onClick={() => handleDelete(p.id)} title="Delete">
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
                  No profiles saved yet. You can save your current configuration in the Dashboard.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </main>
  );
}
