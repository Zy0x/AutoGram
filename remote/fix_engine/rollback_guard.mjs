/**
 * Simple backup before app source patches.
 */
import fs from 'node:fs';
import path from 'node:path';
import { PATCHES_DIR, ensureDirs, stamp } from '../core/paths.mjs';

export function backupFile(absPath) {
  ensureDirs();
  const base = path.basename(absPath);
  const dest = path.join(PATCHES_DIR, 'backup', `${stamp()}_${base}`);
  fs.copyFileSync(absPath, dest);
  return dest;
}

export function writePatchNote(name, body) {
  ensureDirs();
  const f = path.join(PATCHES_DIR, `${stamp()}_${name}.md`);
  fs.writeFileSync(f, body, 'utf8');
  return f;
}
