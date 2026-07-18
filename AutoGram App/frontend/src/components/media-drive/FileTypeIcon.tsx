import {
  File,
  Film,
  Image as ImageIcon,
  Music,
  FileText,
  FileJson,
  FileCode,
  Archive,
  Link,
} from 'lucide-react';
import { driveFileExt, isTextDriveFile, type DriveFile } from '../../lib/driveTypes';

type Props = {
  file: DriveFile;
  size?: 'sm' | 'lg';
};

export function FileTypeIcon({ file, size = 'sm' }: Props) {
  const px = size === 'lg' ? 40 : 16;
  const t = file.icon_type;
  const ext = (driveFileExt(file) || (file.file_ext || '').toLowerCase()).replace(/^\./, '');
  const cls = size === 'lg' ? 'td-type-ico lg' : 'td-type-ico';
  const mime = (file.mime_type || '').toLowerCase();

  if (t === 'link' || ext === 'link') {
    return <Link size={px} className={`${cls} link`} />;
  }
  if (t === 'image' || ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'heic', 'avif'].includes(ext)) {
    return <ImageIcon size={px} className={`${cls} image`} />;
  }
  if (t === 'video' || ['mp4', 'mov', 'mkv', 'webm', 'avi', 'm4v'].includes(ext)) {
    return <Film size={px} className={`${cls} video`} />;
  }
  if (t === 'audio' || t === 'voice' || ['mp3', 'm4a', 'ogg', 'flac', 'wav'].includes(ext)) {
    return <Music size={px} className={`${cls} audio`} />;
  }
  if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) {
    return <Archive size={px} className={`${cls} archive`} />;
  }
  // JSON / code / plain text — dedicated icons (never a garbled content thumb)
  if (ext === 'json' || mime.includes('json')) {
    return <FileJson size={px} className={`${cls} json`} />;
  }
  if (
    ['js', 'ts', 'jsx', 'tsx', 'py', 'rs', 'go', 'java', 'c', 'cpp', 'h', 'css', 'html', 'xml', 'sql'].includes(
      ext
    )
  ) {
    return <FileCode size={px} className={`${cls} code`} />;
  }
  if (
    t === 'document' ||
    isTextDriveFile(file) ||
    ['pdf', 'doc', 'docx', 'txt', 'md', 'rtf', 'xls', 'xlsx', 'ppt', 'pptx'].includes(ext)
  ) {
    return <FileText size={px} className={`${cls} doc`} />;
  }
  return <File size={px} className={cls} />;
}
