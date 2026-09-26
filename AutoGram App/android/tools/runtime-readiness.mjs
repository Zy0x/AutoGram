#!/usr/bin/env node
/** Acceptance gate, not a percentage computed from screen/command counts. */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const bridgeRoot = resolve(root, 'AutoGram App/crates/autogram-android-bridge/src');
const timeout = setTimeout(() => process.exit(1), 10000);
timeout.unref();
const exported = readdirSync(bridgeRoot).filter(name => name.endsWith('.rs')).flatMap(name =>
  [...readFileSync(resolve(bridgeRoot, name), 'utf8').matchAll(/#\[uniffi::export\]\s*pub\s+(?:async\s+)?fn\s+(\w+)/g)]
    .map(match => match[1]));

// Expected native contracts and outstanding acceptance evidence. Keep blockers until
// real implementation AND device end-to-end evidence have been reviewed together.
const workflows = [
  { id: 'phone_otp_2fa', requiredExports: ['begin_phone_login', 'submit_login_code', 'submit_login_password'],
    blockers: ['No Android secure credential/session adapter or login challenge lifecycle.', 'No real-device Telegram login/2FA acceptance evidence.'] },
  { id: 'qr_login', requiredExports: ['begin_qr_login', 'poll_qr_login', 'cancel_login'],
    blockers: ['No QR token generation/expiry/DC migration flow on Android.'] },
  { id: 'account_switch', requiredExports: ['list_authorized_accounts', 'select_authorized_account'],
    blockers: ['Offline filename inventory is not authorization or active-account selection.'] },
  { id: 'cloud_listing_cards', requiredExports: ['list_cloud_dialogs', 'list_cloud_media'],
    blockers: ['Drive reads local SQLite metadata; no Android cloud index producer.'] },
  { id: 'cloud_preview', requiredExports: ['open_cloud_media_stream', 'read_cloud_archive_entry'],
    blockers: ['Device file preview and cached thumbnails do not implement Telegram streams or sparse archives.'] },
  { id: 'upload_download', requiredExports: ['start_cloud_transfer', 'cancel_cloud_transfer'],
    blockers: ['Local task records have no Telegram transfer executor or background service.'] },
  { id: 'remote_crawler', requiredExports: ['start_remote_crawl', 'resolve_remote_media'],
    blockers: ['Direct HTTPS DownloadManager jobs do not replace site resolvers/crawlers.'] },
  { id: 'jobs_automation', requiredExports: ['start_forwarder_job', 'schedule_job'],
    blockers: ['No native Android job executor, persistence/recovery and scheduler acceptance tests.'] },
].map(workflow => ({ ...workflow, missingExports: workflow.requiredExports.filter(name => !exported.includes(name)) }));

const report = {
  scope: 'Android desktop-equivalence acceptance',
  fullCloudTestingReady: workflows.every(item => item.missingExports.length === 0 && item.blockers.length === 0),
  implementedLocalScope: 'Local JNI/SQLite, local records, offline inventory and device-file preview. Verification evidence is separate from this static report.',
  workflows,
  limitations: 'Explicit expected contract names require audit maintenance if APIs are renamed. This gate never substitutes static declarations for live Telegram verification.',
};
const args = process.argv.slice(2);
if (args.some(arg => !['--json', '--require-cloud-ready'].includes(arg))) {
  console.error('Usage: runtime-readiness.mjs [--json] [--require-cloud-ready]');
  process.exitCode = 1;
} else {
  console.log(args.includes('--json') ? JSON.stringify(report, null, 2) : [
    `Full Android cloud acceptance ready: ${report.fullCloudTestingReady ? 'YES' : 'NO'}`,
    ...workflows.map(item => `${item.id}: ${item.missingExports.length} missing native contracts; ${item.blockers.join(' ')}`),
  ].join('\n'));
  if (args.includes('--require-cloud-ready') && !report.fullCloudTestingReady) process.exitCode = 2;
}
clearTimeout(timeout);
