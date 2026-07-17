import fs from 'node:fs';
import path from 'node:path';
import { LOGS_DIR, stamp, ensureDirs } from './paths.mjs';

ensureDirs();
const logFile = path.join(LOGS_DIR, `${stamp()}_execution.log`);
const lines = [];

function write(level, msg, extra) {
  const row = {
    t: new Date().toISOString(),
    level,
    msg,
    ...(extra && typeof extra === 'object' ? { extra } : extra != null ? { extra } : {}),
  };
  const line = JSON.stringify(row);
  lines.push(line);
  fs.appendFileSync(logFile, line + '\n', 'utf8');
  const tag = level.padEnd(5);
  console.log(`[${tag}] ${msg}${extra != null ? ' ' + JSON.stringify(extra) : ''}`);
}

export const log = {
  file: logFile,
  info: (m, e) => write('INFO', m, e),
  pass: (m, e) => write('PASS', m, e),
  fail: (m, e) => write('FAIL', m, e),
  warn: (m, e) => write('WARN', m, e),
  error: (m, e) => write('ERROR', m, e),
  lines: () => lines.slice(),
};
