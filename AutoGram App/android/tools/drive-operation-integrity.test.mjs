import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = name => readFileSync(new URL(`../app/src/main/java/com/autogram/app/ui/drive/${name}.kt`, import.meta.url), 'utf8');

test('unconnected Drive operations cannot claim completion', () => {
  for (const name of ['DriveScreen', 'DriveRemoteUploadModal', 'DriveDuplicateCleanerSheet']) {
    assert.doesNotMatch(source(name), /R\.string\.drive_(remote_upload|forward|tag|move|delete|dedup_clean)_success/);
  }
});

test('forum UI cannot promote local draft IDs to Telegram topic identities', () => {
  assert.doesNotMatch(source('DriveTopicChips'), /DriveTopicsStore|defaultTopics|nextId/);
  assert.doesNotMatch(source('DriveChatDestinationModal'), /DriveTopicsStore|defaultTopics/);
  assert.match(source('DriveChatDestinationModal'), /topicsStore\.load\(/);
});
