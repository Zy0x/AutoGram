import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const SUITE_ROOT = path.resolve(__dirname, '..');
export const CONFIG_DIR = path.join(SUITE_ROOT, 'config');
export const REPORTS_DIR = path.join(SUITE_ROOT, 'reports');
export const LOGS_DIR = path.join(REPORTS_DIR, 'logs');
export const SHOTS_DIR = path.join(REPORTS_DIR, 'screenshots');
export const BUGS_DIR = path.join(REPORTS_DIR, 'bug_reports');
export const PATCHES_DIR = path.join(REPORTS_DIR, 'patches');

export function ensureDirs() {
  for (const d of [LOGS_DIR, SHOTS_DIR, BUGS_DIR, PATCHES_DIR, path.join(PATCHES_DIR, 'backup')]) {
    fs.mkdirSync(d, { recursive: true });
  }
}

export function loadJson(name) {
  const p = path.join(CONFIG_DIR, name);
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

export function stamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
}
