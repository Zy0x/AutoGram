import { describe, expect, it } from 'vitest';
import type { DriveFile } from '../../../lib/telegram/driveTypes';
import { countExactMediaBreakdown, countPerspectiveMedia } from './mediaStatistics';

const file = (id: number, partial: Partial<DriveFile>): DriveFile => ({
  id,
  folder_id: 10,
  name: `file_${id}`,
  size: 100,
  icon_type: 'file',
  ...partial,
});

describe('exact media statistics', () => {
  const files = [
    file(1, { name: 'photo.jpg', icon_type: 'image', mime_type: 'image/jpeg', telegram_category: 'media', telegram_subtype: 'photo', drive_category: 'image' }),
    file(2, { name: 'clip.mp4', icon_type: 'video', mime_type: 'video/mp4', telegram_category: 'media', telegram_subtype: 'video', drive_category: 'video' }),
    file(3, { name: 'clip-as-file.mp4', icon_type: 'video', mime_type: 'video/mp4', as_document: true, telegram_category: 'file', telegram_subtype: 'doc_video', drive_category: 'video' }),
    file(4, { name: 'music.mp3', icon_type: 'audio', mime_type: 'audio/mpeg', telegram_category: 'audio', drive_category: 'audio' }),
    file(5, { name: 'pack.zip', mime_type: 'application/zip', telegram_category: 'file', drive_category: 'archive' }),
    file(6, { name: 'sticker.webp', icon_type: 'image', mime_type: 'image/webp', as_document: true, telegram_category: 'sticker', telegram_subtype: 'sticker', drive_category: 'image' }),
  ];

  it('assigns every unique file to one Telegram statistics bucket', () => {
    const counts = countExactMediaBreakdown(files);
    expect(counts).toMatchObject({ photoCount: 1, videoCount: 1, fileCount: 2, audioCount: 1, stickerCount: 1 });
    expect(Object.values(counts).reduce((sum, value) => sum + value, 0)).toBe(files.length);
  });

  it('changes semantics between Telegram and Drive perspectives', () => {
    const telegram = countPerspectiveMedia(files, 'telegram');
    const drive = countPerspectiveMedia(files, 'drive');
    expect(telegram.media).toBe(2);
    expect(telegram.files).toBe(2);
    expect(telegram.stickers).toBe(1);
    expect(telegram.all).toBe(5);
    expect(drive.all).toBe(6);
    expect(drive.videos).toBe(2);
    expect(drive.archives).toBe(1);
  });
});
