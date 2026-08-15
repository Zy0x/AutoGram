// Master Locale Aggregator for AutoGram (ID & EN)
import navID from './id/nav.json';
import dashboardID from './id/dashboard.json';
import driveToolsID from './id/drive_tools.json';
import settingsID from './id/settings.json';
import accountsID from './id/accounts.json';
import jobsID from './id/jobs.json';
import automationID from './id/automation.json';
import statisticsID from './id/statistics.json';
import syncID from './id/sync.json';
import commonID from './id/common.json';
import errorID from './id/error.json';
import profilesID from './id/profiles.json';
import uiID from './id/ui.json';

import navEN from './en/nav.json';
import dashboardEN from './en/dashboard.json';
import driveToolsEN from './en/drive_tools.json';
import settingsEN from './en/settings.json';
import accountsEN from './en/accounts.json';
import jobsEN from './en/jobs.json';
import automationEN from './en/automation.json';
import statisticsEN from './en/statistics.json';
import syncEN from './en/sync.json';
import commonEN from './en/common.json';
import errorEN from './en/error.json';
import profilesEN from './en/profiles.json';
import uiEN from './en/ui.json';

export const resources = {
  id: {
    translation: {
      nav: navID,
      dashboard: dashboardID,
      drive_tools: driveToolsID,
      speedtest: driveToolsID,
      settings: settingsID,
      accounts: accountsID,
      jobs: jobsID,
      automation: automationID,
      statistics: statisticsID,
      sync: syncID,
      common: commonID,
      error: errorID,
      profiles: profilesID,
      ui: uiID,
    },
  },
  en: {
    translation: {
      nav: navEN,
      dashboard: dashboardEN,
      drive_tools: driveToolsEN,
      speedtest: driveToolsEN,
      settings: settingsEN,
      accounts: accountsEN,
      jobs: jobsEN,
      automation: automationEN,
      statistics: statisticsEN,
      sync: syncEN,
      common: commonEN,
      error: errorEN,
      profiles: profilesEN,
      ui: uiEN,
    },
  },
};
