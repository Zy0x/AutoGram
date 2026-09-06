import { describe, it, expect } from 'vitest';
import { buildMediaPathId } from '../utils/mediaPathId';
import type { DriveFile, DriveChat } from '../../../lib/telegram/driveTypes';

describe('PreviewCopyIdentityActions data contracts & path ID resolution', () => {
  const sampleFile: DriveFile = {
    id: 63280,
    folder_id: -1002557538013,
    peer_id: '-1002557538013',
    name: 'sample_video.mp4',
    size: 10485760,
    icon_type: 'video',
    topic_id: 120,
    peer_kind: 'channel',
  };

  const sampleChat: DriveChat = {
    id: -1002557538013,
    name: 'Broadcast Channel',
    type: 'channel',
    is_forum: false,
  };

  it('correctly constructs canonical Path ID for channel media with topic', () => {
    const pathId = buildMediaPathId({
      accountUserId: '8420671507',
      locationKind: 'chat',
      peerId: sampleFile.peer_id ?? null,
      topicId: sampleFile.topic_id,
      mediaId: sampleFile.id,
      chat: sampleChat,
      file: sampleFile,
    });

    expect(pathId).toBe('U8420671507/CH-1002557538013/T120/63280');
  });

  it('correctly constructs canonical Path ID for Saved Messages item', () => {
    const savedFile: DriveFile = {
      id: 43257,
      folder_id: null,
      peer_id: 'me',
      name: 'notes.txt',
      size: 1024,
      icon_type: 'document',
      is_saved_messages: true,
    };

    const pathId = buildMediaPathId({
      accountUserId: '8420671507',
      locationKind: 'saved',
      peerId: 'me',
      mediaId: savedFile.id,
      file: savedFile,
    });

    expect(pathId).toBe('U8420671507/SM/43257');
  });

  it('correctly constructs canonical Path ID for Virtual Drive folder media', () => {
    const driveFile: DriveFile = {
      id: 99120,
      folder_id: 554433,
      peer_id: '-1003214112048',
      name: 'archive.zip',
      size: 52428800,
      icon_type: 'file',
    };

    const pathId = buildMediaPathId({
      accountUserId: '8420671507',
      locationKind: 'drive',
      peerId: driveFile.peer_id ?? null,
      mediaId: driveFile.id,
      file: driveFile,
    });

    expect(pathId).toBe('U8420671507/D-1003214112048/99120');
  });

  it('formats numerical Message ID cleanly as a string', () => {
    expect(String(sampleFile.id)).toBe('63280');
  });
});
