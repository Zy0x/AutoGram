#!/usr/bin/env node
/** Read-only action/evidence gate. Internal baseline/evidence stays out of public docs and Git. */
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { resolve, relative, isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { collectSourceInventory } from './parity-inventory.mjs';
import { buildAcceptanceReport } from './acceptance/evidence.mjs';
import { collectAcceptanceInputs } from './acceptance/build-inputs.mjs';

const root = fileURLToPath(new URL('../../../', import.meta.url));
function readOptional(path) {
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : undefined;
}

export function readAcceptanceReport() {
  const inventory = collectSourceInventory();
  const build = collectAcceptanceInputs(root);
  inventory.acceptanceInputs = build.inputs;
  inventory.missingAcceptanceInputs = build.missingRequired;
  inventory.changedDuringRead.push(...build.changedDuringRead);
  return buildAcceptanceReport(inventory,
    readOptional(resolve(root, '.agents/docs/architecture/android-parity-baseline.json')),
    readOptional(resolve(root, '.agents/docs/architecture/android-parity-evidence.json')), verifyArtifact);
}

function verifyArtifact(artifact) {
  // Evidence references can read only ignored audit artifacts, never session/vault files.
  const probeRoot = resolve(root, '.agent-probes');
  const path = resolve(root, artifact.path);
  const within = relative(probeRoot, path);
  if (!within || within.startsWith('..') || isAbsolute(within)) return false;
  try {
    const resolved = relative(realpathSync(probeRoot), realpathSync(path));
    if (!resolved || resolved.startsWith('..') || isAbsolute(resolved)) return false;
    return createHash('sha256').update(readFileSync(path)).digest('hex') === artifact.sha256.toLowerCase();
  } catch { return false; }
}

function main() {
  const timer = setTimeout(() => process.exit(1), 10000);
  timer.unref();
  try {
    const args = process.argv.slice(2);
    if (args.some(arg => !['--json', '--require-ready'].includes(arg))) throw new Error('Use --json and/or --require-ready');
    const report = readAcceptanceReport();
    console.log(args.includes('--json') ? JSON.stringify(report, null, 2) : [
      `Full action/output parity accepted: ${report.ready ? 'YES' : 'NO'}`,
      `Actions without complete output proof: ${report.actions.filter(action => !action.accepted).length}`,
      `Desktop candidates requiring reachability review: ${report.unreviewedCandidates.length}`,
      `Blocking conditions: ${report.blockers.join(', ') || 'action/reachability evidence incomplete'}`,
      report.limitations,
    ].join('\n'));
    if (args.includes('--require-ready') && !report.ready) process.exitCode = 2;
  } catch (error) {
    console.error(`Acceptance gate failed: ${error.message}`);
    process.exitCode = 1;
  } finally { clearTimeout(timer); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
