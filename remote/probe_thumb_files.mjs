import fs from 'node:fs';
import path from 'node:path';

const appData = process.env.APPDATA || 'C:/Users/aliri/AppData/Roaming';
// Check common Tauri app data locations for AutoGram
const possibleDirs = [
  path.join(appData, 'com.autogram.app', 'sessions', 'thumbs'),
  path.join(appData, 'AutoGram', 'sessions', 'thumbs'),
  path.join(process.env.USERPROFILE || '', '.autogram', 'sessions', 'thumbs'),
  'F:/AutoGram/sessions/thumbs',
  'F:/AutoGram/AutoGram App/frontend/src-tauri/sessions/thumbs',
];

for (const dir of possibleDirs) {
  if (fs.existsSync(dir)) {
    console.log('Found thumb dir:', dir);
    const files = fs.readdirSync(dir);
    console.log('Total files:', files.length);
    const samples = files.slice(0, 15).map(f => {
      const stat = fs.statSync(path.join(dir, f));
      return { name: f, size: stat.size };
    });
    console.log('Sample files:', JSON.stringify(samples, null, 2));
  }
}
