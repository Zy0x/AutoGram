import { createHash } from 'node:crypto';
import { requiredActions, desktopCandidates } from './workflows.mjs';

const sha256 = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const hashPattern = /^[a-f\d]{64}$/i;
const filled = value => typeof value === 'string' && value.trim().length > 0;
const refsValid = (refs, inventory, scopes) => Array.isArray(refs) && refs.length > 0 && refs.every(ref => {
  const source = inventory.sourceFiles.find(row => row.file === ref.file);
  return source && scopes.some(scope => ref.file.startsWith(scope + '/')) &&
    Number.isSafeInteger(ref.line) && ref.line > 0 && ref.line <= source.physicalLines;
});
const sourceRows = inventory => inventory.sourceFiles.map(({ file, sha256 }) => ({ file, sha256 }))
  .sort((a, b) => a.file.localeCompare(b.file));
const desktopRows = inventory => sourceRows(inventory).filter(row =>
  row.file.startsWith(inventory.scopes.desktopUi + '/') ||
  row.file.startsWith(inventory.scopes.desktopBackend + '/'));
const inputRows = inventory => [...(inventory.acceptanceInputs ?? [])]
  .sort((a, b) => a.file.localeCompare(b.file));
const desktopInputs = inventory => inputRows(inventory).filter(row =>
  row.file.startsWith('AutoGram App/frontend/'));

export function sourceFingerprint(inventory) {
  return sha256({ sources: sourceRows(inventory), inputs: inputRows(inventory), actions: requiredActions });
}

export function captureBaseline(inventory, revision) {
  if (!filled(revision) || inventory.changedDuringRead.length) throw new Error('Unstable source baseline');
  return { schemaVersion: 1, desktopRevision: revision, desktopSources: desktopRows(inventory),
    desktopInputs: desktopInputs(inventory), requiredActions, candidates: desktopCandidates(inventory),
    limitations: 'Registered commands and React files require manual active/nested-action review. No automatic runtime verdict.' };
}

function physicalProofValid(proof, fingerprint, identity, verifyArtifact) {
  return proof?.result === 'passed' && proof.deviceType === 'physical' && filled(proof.deviceModel) &&
    !/emulator|sdk_gphone/i.test(proof.deviceModel) && filled(proof.abi) && filled(proof.testedRevision) &&
    proof.testedRevision === identity?.revision && proof.abi === identity?.testedAbi &&
    proof.apkSha256 === identity?.apkSha256 &&
    hashPattern.test(proof.apkSha256 ?? '') && proof.sourceFingerprint === fingerprint &&
    filled(proof.expectedResult) && filled(proof.actualResult) &&
    Array.isArray(proof.testCases) && proof.testCases.length > 0 && proof.testCases.every(filled) &&
    Array.isArray(proof.artifacts) && proof.artifacts.length > 0 && proof.artifacts.every(artifact =>
      filled(artifact.path) && hashPattern.test(artifact.sha256 ?? '') && verifyArtifact(artifact));
}

export function buildAcceptanceReport(inventory, baseline, evidence, verifyArtifact = () => false) {
  const blockers = [];
  const fingerprint = sourceFingerprint(inventory);
  const candidates = desktopCandidates(inventory);
  const actions = requiredActions;
  const statuses = new Set(['absent', 'partial', 'connected', 'verified']);
  if (inventory.changedDuringRead.length) blockers.push('concurrent_source_changes');
  if (inventory.missingAcceptanceInputs?.length) blockers.push('required_build_inputs_missing');
  if (baseline?.schemaVersion !== 1 || !filled(baseline?.desktopRevision)) blockers.push('baseline_missing_or_invalid');
  else {
    if (sha256(baseline.desktopSources) !== sha256(desktopRows(inventory))) blockers.push('desktop_source_drift');
    if (sha256(baseline.desktopInputs ?? []) !== sha256(desktopInputs(inventory))) blockers.push('desktop_build_input_drift');
    if (sha256(baseline.requiredActions) !== sha256(actions)) blockers.push('action_catalog_drift');
    if (sha256(baseline.candidates) !== sha256(candidates)) blockers.push('desktop_candidate_drift');
  }
  if (evidence?.schemaVersion !== 1) blockers.push('reviewed_evidence_missing');
  const identity = evidence?.packageIdentity;
  if (!filled(identity?.revision) || !hashPattern.test(identity?.apkSha256 ?? '') ||
    !['arm64-v8a', 'armeabi-v7a', 'x86_64', 'x86'].includes(identity?.testedAbi)) {
    blockers.push('tested_package_identity_missing');
  }
  const reviews = evidence?.candidateReviews ?? {};
  const records = evidence?.actions ?? {};
  const actionIds = new Set(actions.map(action => action.id));
  const candidateIds = new Set(candidates.map(candidate => candidate.id));
  for (const id of Object.keys(records)) if (!actionIds.has(id)) blockers.push(`unknown_action:${id}`);
  for (const id of Object.keys(reviews)) if (!candidateIds.has(id)) blockers.push(`unknown_candidate:${id}`);
  const unreviewedCandidates = candidates.filter(candidate => {
    const review = reviews[candidate.id];
    if (!filled(review?.reviewer) || !filled(review?.reason) || review.sourceFingerprint !== fingerprint) return true;
    if (review.classification === 'not_user_action') return false;
    return review.classification !== 'user_action' || !Array.isArray(review.actionIds) ||
      review.actionIds.length === 0 || !review.actionIds.every(id => actionIds.has(id));
  });
  const results = actions.map(action => {
    const record = records[action.id];
    const status = statuses.has(record?.status) ? record.status : 'unreviewed';
    const verified = status === 'verified' && filled(record?.reviewer) && filled(record?.accountScope) &&
      refsValid(record?.uiPath, inventory, [inventory.scopes.androidUi]) &&
      refsValid(record?.enginePath, inventory, [inventory.scopes.sharedCore, inventory.scopes.androidBridge, inventory.scopes.androidUi]) &&
      Array.isArray(record?.proofs) && record.proofs.length > 0 &&
      record.proofs.every(proof => physicalProofValid(proof, fingerprint, identity, verifyArtifact));
    return { ...action, status, accepted: verified, reason: verified ? null : 'implementation_or_output_evidence_incomplete' };
  });
  return { schemaVersion: 1, ready: blockers.length === 0 && unreviewedCandidates.length === 0 &&
    results.every(action => action.accepted), sourceFingerprint: fingerprint,
    baselineRevision: baseline?.desktopRevision ?? null, blockers, unreviewedCandidates, actions: results,
    limitations: 'No parity percentages. Evidence must be reviewed against real UI→engine→output; file counts and declarations do not prove behavior. Broad action groups require all listed subcases.' };
}
