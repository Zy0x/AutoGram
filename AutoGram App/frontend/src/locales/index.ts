// Master Locale Aggregator for AutoGram (ID & EN)
import navID from './id/nav.json';
import dashboardID from './id/dashboard.json';
import drivesID from './id/speedtest.json';
import settingsID from './id/settings.json';
import accountsID from './id/accounts.json';
import jobsID from './id/jobs.json';
import automationID from './id/automation.json';
import statisticsID from './id/statistics.json';
import syncID from './id/sync.json';

import navEN from './en/nav.json';
import dashboardEN from './en/dashboard.json';
import drivesEN from './en/speedtest.json';
import settingsEN from './en/settings.json';
import accountsEN from './en/accounts.json';
import jobsEN from './en/jobs.json';
import automationEN from './en/automation.json';
import statisticsEN from './en/statistics.json';
import syncEN from './en/sync.json';

export const resources = {
  id: {
    translation: {
      nav: navID,
      dashboard: dashboardID,
      speedtest: drivesID,
      settings: settingsID,
      accounts: accountsID,
      jobs: jobsID,
      automation: automationID,
      statistics: statisticsID,
      sync: syncID,
    },
  },
  en: {
    translation: {
      nav: navEN,
      dashboard: dashboardEN,
      speedtest: drivesEN,
      settings: settingsEN,
      accounts: accountsEN,
      jobs: jobsEN,
      automation: automationEN,
      statistics: statisticsEN,
      sync: syncEN,
    },
  },
};
