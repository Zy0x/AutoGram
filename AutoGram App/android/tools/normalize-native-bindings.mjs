#!/usr/bin/env node
/** Mechanical formatting of UniFFI output; never hand-maintain generated JNI code. */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, basename } from 'node:path';

for (const input of process.argv.slice(2)) {
  const path = resolve(input);
  if (basename(path) !== 'autogram_android_bridge.kt') throw new Error('Expected generated bridge file');
  const text = readFileSync(path, 'utf8');
  const normalized = text.replace(/\r\n/g, '\n').replace(/[\t ]+$/gm, '').replace(/\n*$/, '\n');
  if (normalized !== text) writeFileSync(path, normalized, 'utf8');
}
