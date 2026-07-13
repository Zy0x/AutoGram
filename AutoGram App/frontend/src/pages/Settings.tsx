import { useState, useEffect } from 'react';
import { Save, Key, ShieldCheck, Globe } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export function Settings() {
  const { t, i18n } = useTranslation();
  const [apiId, setApiId] = useState("");
  const [apiHash, setApiHash] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "success" | "error">("idle");
  const [isLoading, setIsLoading] = useState(true);

  // Load existing credentials when component mounts
  useEffect(() => {
    const savedApiId = localStorage.getItem('API_ID');
    const savedApiHash = localStorage.getItem('API_HASH');
    
    if (savedApiId) setApiId(savedApiId);
    if (savedApiHash) setApiHash(savedApiHash);
    
    setIsLoading(false);
  }, []);

  const handleSave = () => {
    setIsSaving(true);
    setSaveStatus("idle");
    
    try {
      localStorage.setItem('API_ID', apiId);
      localStorage.setItem('API_HASH', apiHash);
      
      setSaveStatus("success");
      setTimeout(() => setSaveStatus("idle"), 3000);
    } catch (err) {
      console.error(err);
      setSaveStatus("error");
    } finally {
      setIsSaving(false);
    }
  };

  const changeLanguage = (lng: string) => {
    i18n.changeLanguage(lng);
  };

  return (
    <main className="main-content">
      <header style={{ marginBottom: '32px' }}>
        <h2 className="title">{t('settings.title')}</h2>
        <p className="subtitle">{t('settings.subtitle')}</p>
      </header>

      <div className="grid-layout">
        <div className="glass-panel card">
          <div className="card-header">
            <Globe size={20} color="var(--primary)" />
            <h3>{t('settings.general')}</h3>
          </div>
          
          <div className="input-group" style={{ marginBottom: 0 }}>
            <label className="input-label" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              {t('settings.language')}
            </label>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '12px' }}>
              {t('settings.language_desc')}
            </p>
            <select 
              className="input-field" 
              value={i18n.language} 
              onChange={(e) => changeLanguage(e.target.value)}
            >
              <option value="en">English (US)</option>
              <option value="id">Bahasa Indonesia</option>
            </select>
          </div>
        </div>

        <div className="glass-panel card">
          <div className="card-header">
            <ShieldCheck size={20} color="var(--accent)" />
            <h3>{t('settings.api_config')}</h3>
          </div>
          
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '24px', lineHeight: '1.5' }}>
            To use AutoGram, you must obtain your own API ID and API Hash from Telegram's developer portal (my.telegram.org). 
            This information is stored locally and securely on your browser/device's LocalStorage.
          </p>
          
          {isLoading ? (
            <div style={{ color: 'var(--text-muted)' }}>Loading existing credentials...</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              <div className="input-group" style={{ marginBottom: 0 }}>
                <label className="input-label" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Key size={14} /> {t('settings.api_id')}
                </label>
                <input 
                  type="text" 
                  value={apiId} 
                  onChange={e => setApiId(e.target.value)} 
                  className="input-field" 
                  placeholder={t('settings.api_id_placeholder')}
                />
              </div>
              
              <div className="input-group" style={{ marginBottom: 0 }}>
                <label className="input-label" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Key size={14} /> {t('settings.api_hash')}
                </label>
                <input 
                  type="password" 
                  value={apiHash} 
                  onChange={e => setApiHash(e.target.value)} 
                  className="input-field" 
                  placeholder={t('settings.api_hash_placeholder')} 
                />
              </div>
              
              <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginTop: '12px' }}>
                <button 
                  className="btn btn-primary" 
                  onClick={handleSave}
                  disabled={isSaving || !apiId || !apiHash}
                  style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 24px' }}
                >
                  <Save size={18} />
                  {isSaving ? '...' : t('settings.save_btn')}
                </button>
                
                {saveStatus === 'success' && (
                  <span style={{ color: '#10b981', fontSize: '0.9rem', display: 'flex', alignItems: 'center', gap: '4px' }}>
                    ✓ {t('settings.save_success')}
                  </span>
                )}
                {saveStatus === 'error' && (
                  <span style={{ color: '#ef4444', fontSize: '0.9rem' }}>
                    Failed to save settings.
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
