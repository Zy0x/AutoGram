/**
 * File extension and MIME type utilities.
 */

export function getFileCategory(mimeType?: string | null, fileName?: string | null): 'photo' | 'video' | 'audio' | 'pdf' | 'archive' | 'link' | 'document' {
  const mime = (mimeType || '').toLowerCase();
  const name = (fileName || '').toLowerCase();

  if (mime.startsWith('image/') || name.endsWith('.jpg') || name.endsWith('.jpeg') || name.endsWith('.png') || name.endsWith('.webp') || name.endsWith('.gif')) {
    return 'photo';
  }
  if (mime.startsWith('video/') || name.endsWith('.mp4') || name.endsWith('.mov') || name.endsWith('.mkv') || name.endsWith('.webm') || name.endsWith('.avi')) {
    return 'video';
  }
  if (mime.startsWith('audio/') || name.endsWith('.mp3') || name.endsWith('.wav') || name.endsWith('.flac') || name.endsWith('.m4a') || name.endsWith('.aac')) {
    return 'audio';
  }
  if (mime === 'application/pdf' || name.endsWith('.pdf')) {
    return 'pdf';
  }
  if (name.endsWith('.zip') || name.endsWith('.rar') || name.endsWith('.7z') || name.endsWith('.tar') || name.endsWith('.gz')) {
    return 'archive';
  }
  if (mime === 'text/html' || name.endsWith('.url')) {
    return 'link';
  }
  return 'document';
}
