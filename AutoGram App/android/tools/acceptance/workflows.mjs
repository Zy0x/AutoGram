/** User-action inventory, not a count-based parity score. Expand when the baseline changes. */
const groups = {
  auth: ['api_config', 'phone_login', 'otp_submit', 'otp_resend', 'password_2fa', 'qr_login',
    'qr_refresh_expiry_dc', 'cancel_login', 'account_switch', 'session_restore', 'revocation',
    'logout_retry', 'session_import_export'],
  drive: ['saved_messages', 'dialogs_pagination', 'forum_topics_pagination', 'topic_media',
    'search_filters_sort', 'thumbnails_avatars', 'virtual_drives', 'folders', 'recent_pins',
    'media_index', 'create_rename_delete_topic', 'create_move_rename_delete_folder',
    'move_tag_delete_files', 'copy_links', 'snapshots_integrity', 'media_statistics', 'rapid_navigation'],
  transfer: ['upload_file', 'upload_album', 'download_file', 'saf_verified_output', 'batch',
    'pause_resume_cancel_retry', 'checkpoint_recovery', 'duplicate_four_levels', 'duplicate_decisions',
    'caption_presentation_quality', 'account_size_limits', 'stable_send_retry', 'background_lifecycle',
    'profiles', 'history_diagnostics', 'floodwait_circuit_breaker'],
  preview: ['photo_gallery_transform', 'video_seek_hold_gallery', 'audio_controls', 'tracks_subtitles',
    'external_subtitles', 'pip_fullscreen', 'startup_resume_data_saver', 'buffer_diagnostics',
    'pdf_search_select_print', 'docx', 'spreadsheet', 'presentation', 'epub', 'notebook', 'font',
    'markdown_code_log', 'json_csv_hex', 'stickers', 'metadata_format_security', 'heuristic_explainer',
    'split_comparison', 'zip_plain', 'zip_crypto_aes', 'zip64_nested', 'zip_extract_create', 'zip_network_budget'],
  remote: ['provider_resolve', 'selected_format', 'headers_expiry', 'subtitles_translation',
    'hls_dash_assembly', 'local_disk_only', 'cloud_upload', 'crawler_depth_rules_filters',
    'crawler_select_duplicates', 'crawler_queue_controls', 'crawler_recovery', 'job_export_import',
    'assisted_inspection', 'extractor_update_status'],
  studio: ['hardware_probe', 'transcode', 'software_fallback', 'remux', 'split_merge', 'repair',
    'thumbnail', 'preflight', 'verified_output', 'queue_controls_recovery'],
  forwarder: ['modes_rules_destinations', 'caption_album_duplicates', 'create_edit_delete_job',
    'dry_run', 'execution_controls', 'decision_inbox', 'history', 'schedule', 'export_import'],
  supporting: ['sync_mirror', 'automation', 'persistent_profiles', 'statistics_export', 'settings',
    'proxy_network', 'cache_measured_cleanup', 'backup_restore', 'component_updates'],
  accessibility: ['talkback', 'switch_access', 'focus_modal_return', 'touch_targets', 'large_font',
    'orientation_keyboard_back', 'contrast_noncolor_status', 'autohide_lock_alternatives'],
};

export const requiredActions = Object.entries(groups).flatMap(([domain, actions]) =>
  actions.map(action => ({ id: `${domain}.${action}`, domain, requiresPhysicalEvidence: true })));

// These are source candidates for manual reachability review, NOT accepted user actions.
export function desktopCandidates(inventory) {
  const unique = new Map();
  const add = (id, kind, reference) => unique.set(id, { id, kind, reference });
  for (const command of inventory.desktop.tauriCommands) {
    add(`ipc:${command.name}`, 'registered-native-command', { file: command.file, line: command.line });
  }
  for (const source of inventory.sourceFiles) {
    if (source.file.startsWith(inventory.scopes.desktopUi + '/') && source.file.endsWith('.tsx')) {
      add(`ui:${source.file}`, 'react-surface', { file: source.file, line: 1 });
    }
  }
  for (const entry of inventory.desktop.driveSidebarTabs) {
    add(`drive-tab:${entry.id}`, 'drive-navigation', { file: entry.file, line: entry.line });
  }
  for (const entry of inventory.desktop.forwarderTabs) {
    add(`forwarder-tab:${entry.id}`, 'forwarder-navigation', { file: entry.file, line: entry.line });
  }
  return [...unique.values()].sort((a, b) => a.id.localeCompare(b.id));
}
