import { Home, Folder, Hash, Users, Megaphone, Bot, MessageSquare, Film, Image as ImageIcon, User, Sparkles, Music, Archive, FileText, FileCode } from 'lucide-react';
import type { DriveDestChoice } from './DriveDestinationPicker';
import type { UrlKind } from '../../../features/remote-upload/domain';
import type { StreamQualityFormat } from '../../../lib/telegram/linkResolvers';

export function kindIcon(c: DriveDestChoice) {
  if (c.kind === 'saved') return <Home size={16} />;
  if (c.kind === 'drive') return <Folder size={16} />;
  if (c.isForum) return <Hash size={16} />;
  if (c.type === 'group' || c.type === 'supergroup') return <Users size={16} />;
  if (c.type === 'channel') return <Megaphone size={16} />;
  if (c.type === 'bot') return <Bot size={16} />;
  return <MessageSquare size={16} />;
}

export function fileKindIcon(kind: UrlKind) {
  switch (kind) {
    case 'video': return <Film size={18} />;
    case 'image': return <ImageIcon size={18} />;
    case 'profile': return <User size={18} />;
    case 'story': return <Sparkles size={18} />;
    case 'audio': return <Music size={18} />;
    case 'zip': return <Archive size={18} />;
    case 'doc': return <FileText size={18} />;
    default: return <FileCode size={18} />;
  }
}

export function renderBadge(c: DriveDestChoice, t: any) {
  if (c.kind === 'saved') return <span className="td-dest-badge saved">{t('drive.dest_badge_saved')}</span>;
  if (c.isForum) return <span className="td-dest-badge forum">{t('drive.dest_badge_forum')}</span>;
  if (c.kind === 'drive') return <span className="td-dest-badge td">{t('drive.dest_badge_drive')}</span>;
  if (c.type === 'group' || c.type === 'supergroup') return <span className="td-dest-badge group">{t('drive.dest_badge_group')}</span>;
  if (c.type === 'channel') return <span className="td-dest-badge channel">{t('drive.dest_badge_channel')}</span>;
  if (c.type === 'bot') return <span className="td-dest-badge bot">{t('drive.dest_badge_bot')}</span>;
  return <span className="td-dest-badge user">{t('drive.dest_badge_user')}</span>;
}

export function getBadgeModifierClass(badgeText?: string): string {
  if (!badgeText) return '';
  const b = badgeText.toUpperCase();
  if (b.includes('SUBTITLE') || b.includes('SRT') || b.includes('VTT')) return 'badge-subtitle';
  if (b.includes('HDR') || b.includes('VISION') || b.includes('DOLBY') || b.includes('8K')) return 'badge-hdr';
  if (b.includes('60FPS') || b.includes('120FPS') || b.includes('60 FPS') || b.includes('60P') || b.includes('FPS')) return 'badge-fps';
  if (b.includes('KBPS') || b.includes('AUDIO') || b.includes('HI-RES') || b.includes('OPUS') || b.includes('SAVER') || b.includes('AAC')) return 'badge-audio';
  if (b.includes('MUTED') || b.includes('SILENT') || b.includes('RESTRICTION')) return 'badge-muted';
  if (b.includes('SD') || b.includes('480P') || b.includes('360P')) return 'badge-saver';
  return '';
}

export function getMeasuredFormatBadge(format: StreamQualityFormat | null | undefined, ext?: string): string {
  const height = Number(format?.height || 0);
  if (height > 0) return `${Math.round(height)}p`;
  const audioBps = Number(format?.audioBitrate || format?.bitrate || 0);
  if ((format?.isAudio || format?.qualityTier === 'audio') && audioBps > 0) return `${Math.round(audioBps / 1000)} kbps`;
  return (ext || format?.ext || 'original').toUpperCase();
}
