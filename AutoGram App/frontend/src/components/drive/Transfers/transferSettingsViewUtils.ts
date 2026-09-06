import type { CaptionPosition } from '../../../lib/telegram/driveTypes';

export function getEffectiveCaptionPosition(draft: { captionPosition?: CaptionPosition; captionAbove?: boolean }): CaptionPosition {
  if (draft.captionPosition) return draft.captionPosition;
  if (draft.captionAbove) return 'on_media_above';
  return 'on_media';
}

export function getCaptionPositionBadgeLabel(pos: CaptionPosition): string {
  switch (pos) {
    case 'on_media_above': return 'Caption di ATAS Media';
    case 'before_media': return 'Pesan Sebelum Media';
    case 'after_media': return 'Pesan Setelah Media';
    case 'none': return 'Tanpa Caption';
    case 'on_media':
    default: return 'Caption Pada Media';
  }
}
