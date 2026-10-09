import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildAcceptanceReport, captureBaseline, sourceFingerprint } from './acceptance/evidence.mjs';
import { desktopCandidates, requiredActions } from './acceptance/workflows.mjs';

const dir = dirname(fileURLToPath(import.meta.url));
const hash = 'a'.repeat(64);
function inventory() {
  return { changedDuringRead: [], scopes: {
    desktopUi: 'desktop/ui', desktopBackend: 'desktop/engine',
    androidUi: 'android/ui', androidBridge: 'android/bridge', sharedCore: 'core',
  }, sourceFiles: ['desktop/ui/Modal.tsx', 'desktop/engine/commands.rs',
    'android/ui/Screen.kt', 'android/bridge/domain.rs', 'core/domain.rs'].map(file =>
    ({ file, sha256: hash, physicalLines: 100 })),
  desktop: { tauriCommands: [{ name: 'read', file: 'desktop/engine/commands.rs', line: 20 }],
    driveSidebarTabs: [{ id: 'saved', file: 'desktop/ui/Modal.tsx', line: 1 }],
    forwarderTabs: [{ id: 'history', file: 'desktop/ui/Modal.tsx', line: 1 }] } };
}
function reviewedEvidence(current) {
  const fingerprint = sourceFingerprint(current);
  return { schemaVersion: 1,
    packageIdentity: { revision: 'test-fixture-revision', apkSha256: hash, testedAbi: 'arm64-v8a' },
    candidateReviews: Object.fromEntries(desktopCandidates(current).map(candidate => [candidate.id, {
      reviewer: 'isolated-test-reviewer', reason: 'Mapped all nested actions in this isolated fixture.',
      sourceFingerprint: fingerprint, classification: 'user_action', actionIds: [requiredActions[0].id],
    }])), actions: Object.fromEntries(requiredActions.map(action => [action.id, {
      status: 'verified', reviewer: 'isolated-test-reviewer', accountScope: 'test-fixture',
      uiPath: [{ file: 'android/ui/Screen.kt', line: 1 }],
      enginePath: [{ file: 'core/domain.rs', line: 2 }], proofs: [{
        result: 'passed', deviceType: 'physical', deviceModel: 'isolated-device-fixture', abi: 'arm64-v8a',
        testedRevision: 'test-fixture-revision', apkSha256: hash, sourceFingerprint: fingerprint,
        expectedResult: 'fixture output', actualResult: 'fixture output', testCases: ['fixture-case'],
        artifacts: [{ path: '.agent-probes/isolated-fixture.txt', sha256: hash }],
      }],
    }])) };
}
function reportWithChange(change, verifyArtifact = () => true) {
  const current = inventory();
  const baseline = captureBaseline(current, 'fixture-baseline');
  const evidence = reviewedEvidence(current);
  change({ current, baseline, evidence });
  return buildAcceptanceReport(current, baseline, evidence, verifyArtifact);
}

test('catalog has unique explicit actions across every planned domain', () => {
  assert.equal(new Set(requiredActions.map(action => action.id)).size, requiredActions.length);
  assert.deepEqual([...new Set(requiredActions.map(action => action.domain))],
    ['auth', 'drive', 'transfer', 'preview', 'remote', 'studio', 'forwarder', 'supporting', 'accessibility']);
});
test('absence of a reviewed baseline or output proof cannot unlock acceptance', () => {
  const report = buildAcceptanceReport(inventory());
  assert.equal(report.ready, false);
  assert.ok(report.blockers.includes('baseline_missing_or_invalid'));
  assert.ok(report.blockers.includes('reviewed_evidence_missing'));
  assert.ok(report.actions.every(action => !action.accepted));
});
test('all reviewed fixture actions, reachable mappings and checked artifacts can satisfy the pure gate', () => {
  assert.equal(reportWithChange(() => {}).ready, true);
});
test('unverified declaration or status is not runtime proof', () => {
  for (const status of ['absent', 'partial', 'connected', 'unknown']) {
    assert.equal(reportWithChange(({ evidence }) => {
      evidence.actions[requiredActions[0].id].status = status;
    }).ready, false);
  }
});
test('missing, altered or unchecked artifacts fail closed', () => {
  const current = inventory();
  assert.equal(buildAcceptanceReport(current, captureBaseline(current, 'fixture'), reviewedEvidence(current)).ready, false);
  assert.equal(reportWithChange(() => {}, () => false).ready, false);
});
test('output evidence cannot mix APK identities, revisions or tested ABIs', () => {
  for (const mutate of [
    record => { record.proofs[0].testedRevision = 'older-fixture'; },
    record => { record.proofs[0].apkSha256 = 'b'.repeat(64); },
    record => { record.proofs[0].abi = 'x86_64'; },
  ]) assert.equal(reportWithChange(({ evidence }) => mutate(evidence.actions[requiredActions[0].id])).ready, false);
  assert.ok(reportWithChange(({ evidence }) => { delete evidence.packageIdentity; })
    .blockers.includes('tested_package_identity_missing'));
});
test('desktop source and new nested-surface candidates invalidate a baseline', () => {
  const sourceDrift = reportWithChange(({ current }) => { current.sourceFiles[0].sha256 = 'b'.repeat(64); });
  assert.equal(sourceDrift.ready, false);
  assert.ok(sourceDrift.blockers.includes('desktop_source_drift'));
  const candidateDrift = reportWithChange(({ current }) => {
    current.sourceFiles.push({ file: 'desktop/ui/NewMenu.tsx', sha256: hash, physicalLines: 30 });
  });
  assert.ok(candidateDrift.blockers.includes('desktop_candidate_drift'));
});
test('catalog drift cannot silently drop actions', () => {
  assert.ok(reportWithChange(({ baseline }) => { baseline.requiredActions = []; })
    .blockers.includes('action_catalog_drift'));
});
test('Android/core edits invalidate old physical proof even when desktop is unchanged', () => {
  const report = reportWithChange(({ current }) => { current.sourceFiles[2].sha256 = 'b'.repeat(64); });
  assert.equal(report.ready, false);
  assert.ok(report.actions.every(action => !action.accepted));
});
test('manifest, dependency, locale and build-input edits invalidate prior physical proof', () => {
  const current = inventory();
  current.acceptanceInputs = [{ file: 'AutoGram App/android/app/src/main/AndroidManifest.xml', sha256: hash }];
  const baseline = captureBaseline(current, 'fixture');
  const evidence = reviewedEvidence(current);
  assert.equal(buildAcceptanceReport(current, baseline, evidence, () => true).ready, true);
  current.acceptanceInputs[0].sha256 = 'b'.repeat(64);
  assert.equal(buildAcceptanceReport(current, baseline, evidence, () => true).ready, false);
});
test('missing required build inputs and desktop dependency drift block acceptance', () => {
  assert.ok(reportWithChange(({ current }) => { current.missingAcceptanceInputs = ['manifest.xml']; })
    .blockers.includes('required_build_inputs_missing'));
  assert.ok(reportWithChange(({ current }) => {
    current.acceptanceInputs = [{ file: 'AutoGram App/frontend/package.json', sha256: hash }];
  }).blockers.includes('desktop_build_input_drift'));
});
test('concurrent changes cannot be captured or accepted', () => {
  const current = inventory(); current.changedDuringRead.push('changed.rs');
  assert.throws(() => captureBaseline(current, 'fixture'), /Unstable/);
  assert.ok(buildAcceptanceReport(current).blockers.includes('concurrent_source_changes'));
});
test('emulators, missing outcomes and fabricated source references are rejected', () => {
  for (const mutate of [
    record => { record.proofs[0].deviceType = 'emulator'; },
    record => { record.proofs[0].deviceModel = 'sdk_gphone'; },
    record => { record.proofs[0].actualResult = ''; },
    record => { record.proofs[0].testCases = []; },
    record => { record.uiPath[0].file = 'nonexistent.kt'; },
    record => { record.enginePath[0].line = 1000; },
  ]) assert.equal(reportWithChange(({ evidence }) => mutate(evidence.actions[requiredActions[0].id])).ready, false);
});
test('an unreviewed candidate or unexplained exclusion remains a blocker', () => {
  for (const mutate of [
    record => { record.classification = 'excluded'; },
    record => { record.reason = ''; },
    record => { record.actionIds = []; },
    record => { record.actionIds = ['not-in-the-catalog']; },
  ]) assert.equal(reportWithChange(({ evidence }) => mutate(Object.values(evidence.candidateReviews)[0])).ready, false);
});
test('unknown actions and candidates are not accepted as proof', () => {
  const report = reportWithChange(({ evidence }) => {
    evidence.actions['unknown.action'] = {}; evidence.candidateReviews['unknown:candidate'] = {};
  });
  assert.equal(report.ready, false);
  assert.ok(report.blockers.includes('unknown_action:unknown.action'));
  assert.ok(report.blockers.includes('unknown_candidate:unknown:candidate'));
});
test('production CLI is read-only and refuses incomplete Release acceptance', () => {
  const result = spawnSync(process.execPath, [resolve(dir, 'parity-acceptance.mjs'), '--require-ready', '--json'],
    { encoding: 'utf8', timeout: 15000 });
  assert.equal(result.status, 2, result.stderr);
  assert.equal(JSON.parse(result.stdout).ready, false);
});
