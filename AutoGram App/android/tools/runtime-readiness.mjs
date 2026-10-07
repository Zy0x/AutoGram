#!/usr/bin/env node
/** Acceptance gate, not a percentage computed from screen/command counts. */
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readBridgeExports } from './parity-inventory.mjs';

// Contract presence is static evidence only. Blockers describe acceptance still
// unverified, not implementation absence. Do not clear them when exports appear.
const workflowRequirements = [
  { id: 'phone_otp_2fa', requiredExports: ['initialize_auth', 'configure_api', 'auth_configured',
    'create_login_attempt', 'begin_phone_login', 'resend_login_code', 'submit_login_code', 'submit_login_password', 'cancel_login'],
    blockers: [
      'Unverified on a packaged Android device with real Telegram: API configuration, phone/OTP/resend/2FA and verified identity after durable vault commit.',
      'Unverified: cancellation and stale-attempt isolation, invalid/expired challenges, FloodWait cooldown, process recreation and vault failure recovery.',
    ] },
  { id: 'qr_login', requiredExports: ['initialize_auth', 'configure_api', 'create_login_attempt',
    'begin_qr_login', 'poll_qr_login', 'submit_login_password', 'cancel_login'],
    blockers: ['Unverified on a packaged Android device with real Telegram: QR scan authorization, token expiry/renewal, DC migration, optional 2FA and cancellation without a late account commit.'] },
  { id: 'account_switch', requiredExports: ['list_authorized_accounts', 'select_authorized_account',
    'last_selected_account', 'logout_account'],
    blockers: ['Unverified on a packaged Android device with real Telegram: account revalidation, isolated switching, cold-start restoration, revoked-session handling and logout/retry. Offline inventory and persisted identities alone are not authorization proof.'] },
  { id: 'cloud_listing_cards', requiredExports: ['list_cloud_dialogs', 'list_cloud_media', 'list_cloud_topics', 'list_cloud_topic_media'],
    blockers: ['Unverified: Telegram-backed scoped dialog/topic/media indexing, refresh and cards matched to real messages; local SQLite rows alone do not prove cloud listing or mutation.'] },
  { id: 'cloud_preview', requiredExports: ['open_cloud_media_stream', 'read_cloud_media_range', 'close_cloud_media_stream', 'read_cloud_archive_entry'],
    blockers: ['Unverified: real Telegram media playback/seeking and each file-preview family, including bounded sparse encrypted-archive extraction with measured network bytes. Device-file previews alone are insufficient.'] },
  { id: 'upload_download', requiredExports: ['enqueue_cloud_download', 'run_cloud_download',
    'control_cloud_download', 'list_cloud_downloads', 'pending_cloud_downloads', 'start_cloud_upload', 'cancel_cloud_upload'],
    blockers: ['Unverified: real Telegram upload/download outputs, cancellation/recovery, duplicate decisions and album invariants under retries; local task rows and pause flags alone are insufficient.'] },
  { id: 'remote_crawler', requiredExports: ['start_remote_crawl', 'resolve_remote_media'],
    blockers: ['Unverified: provider-specific resolution/crawl, selected formats/subtitles and completed output; direct local HTTPS downloads alone do not prove provider support or manifest processing.'] },
  { id: 'jobs_automation', requiredExports: ['start_forwarder_job', 'schedule_job'],
    blockers: ['Unverified: real forwarder/automation/sync execution with destination-message evidence, scoped checkpoints, scheduled background execution and process-restart recovery.'] },
];

export function buildReadinessReport(bridge = readBridgeExports()) {
  const exported = new Set(bridge.functions.map(item => item.name));
  const workflows = workflowRequirements.map(workflow => ({ ...workflow,
    requiredExports: [...workflow.requiredExports], blockers: [...workflow.blockers],
    acceptanceStatus: 'unverified',
    presentExports: bridge.functions.filter(item => workflow.requiredExports.includes(item.name)),
    missingExports: workflow.requiredExports.filter(name => !exported.has(name)),
  }));
  return {
    scope: 'Android desktop-equivalence acceptance',
    fullCloudTestingReady: workflows.every(item => item.missingExports.length === 0 && item.blockers.length === 0),
    implementedLocalScope: 'Local JNI/SQLite, offline inventory, device-file preview, verified-account cloud dialog/media/range adapters, durable account-pinned download executor and Android worker/SAF output path. Host reads and platform fixtures do not replace real-Telegram packaged-device acceptance. Upload and other domains remain incomplete.',
    evidenceBasis: 'static-source-declarations; no reviewed real-Telegram device acceptance evidence',
    acceptanceInventory: '.agents/docs/architecture/android-standalone-acceptance.md',
    workflows,
    limitations: 'Expected contract names require audit maintenance if APIs are renamed. Export declarations do not prove compilation, Kotlin reachability or behavior. Callback traits and generated bindings are excluded. The workflow groups are minimum blockers, not an exhaustive action inventory; consult the internal acceptance inventory. This gate never substitutes static declarations for live Telegram verification.',
  };
}

function main() {
  const timeout = setTimeout(() => process.exit(1), 10000);
  timeout.unref();
  try {
    const args = process.argv.slice(2);
    if (args.some(arg => !['--json', '--require-cloud-ready'].includes(arg))) {
      console.error('Usage: runtime-readiness.mjs [--json] [--require-cloud-ready]');
      process.exitCode = 1;
    } else {
      const report = buildReadinessReport();
      console.log(args.includes('--json') ? JSON.stringify(report, null, 2) : [
        `Full Android cloud acceptance ready: ${report.fullCloudTestingReady ? 'YES' : 'NO'}`,
        ...report.workflows.map(item => `${item.id}: ${item.missingExports.length} missing native contracts; ${item.blockers.join(' ')}`),
      ].join('\n'));
      if (args.includes('--require-cloud-ready') && !report.fullCloudTestingReady) process.exitCode = 2;
    }
  } catch (error) {
    console.error(`Readiness failed: ${error.message}`);
    process.exitCode = 1;
  } finally {
    clearTimeout(timeout);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
