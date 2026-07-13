import { useState, useEffect } from 'react';
import { Command } from '@tauri-apps/plugin-shell';
import './App.css';
import { Sidebar } from './components/Sidebar';
import { Dashboard } from './pages/Dashboard';
import { Settings } from './pages/Settings';
import { Accounts } from './pages/Accounts';
import { Jobs } from './pages/Jobs';
import { Sync } from './pages/Sync';
import { Statistics } from './pages/Statistics';
import { Profiles } from './pages/Profiles';
import { Automation } from './pages/Automation';

function App() {
  const [activeTab, setActiveTab] = useState(() => {
    return localStorage.getItem('lastActiveTab') || 'dashboard';
  });

  useEffect(() => {
    localStorage.setItem('lastActiveTab', activeTab);
  }, [activeTab]);

  // Reconcile zombie jobs on startup
  useEffect(() => {
    const reconcileJobs = async () => {
      try {
        const cmd = Command.create('python', ['../../worker/daemon.py', '--action', 'reconcile']);
        await cmd.execute();
      } catch (err) {
        console.error('Failed to reconcile jobs:', err);
      }
    };
    reconcileJobs();
  }, []);

  return (
    <div className="app-layout">
      {/* Sidebar Component */}
      <Sidebar activeTab={activeTab} setActiveTab={setActiveTab} />
      
      {/* Dynamic Content Area */}
      {activeTab === 'dashboard' && <Dashboard />}
      
      {activeTab === 'jobs' && <Jobs />}
      
      {activeTab === 'sync' && <Sync />}
      
      {activeTab === 'stats' && <Statistics />}
      
      {activeTab === 'accounts' && <Accounts />}
      
      {activeTab === 'profiles' && <Profiles />}

      {activeTab === 'automation' && <Automation />}
      
      {activeTab === 'settings' && <Settings />}
    </div>
  );
}

export default App;
