import {
  HardDrive,
  Layers,
  Type,
  Filter,
  Upload,
  Download,
  Film,
  FolderTree,
  CopyCheck,
  HardDriveUpload,
  Network,
  SlidersHorizontal,
  Sliders,
} from 'lucide-react';
import type { DupGroup } from '../../../lib/telegram';

export type DriveToolsTab =
  | 'dups'
  | 'space'
  | 'rename'
  | 'filter'
  | 'upload'
  | 'download'
  | 'encoding'
  | 'albums'
  | 'duplicates'
  | 'limits_recovery'
  | 'network'
  | 'ytdlp'
  | 'advanced';

export function smartDeleteIds(groups: DupGroup[], keepNewest: boolean): Set<number> {
  const out = new Set<number>();
  for (const g of groups) {
    if (g.files.length < 2) continue;
    const ordered = [...g.files].sort((a, b) =>
      keepNewest ? (b.id || 0) - (a.id || 0) : (a.id || 0) - (b.id || 0)
    );
    for (let i = 1; i < ordered.length; i++) out.add(ordered[i].id);
  }
  return out;
}

export function preferredKeepId(g: DupGroup, keepNewest: boolean): number | null {
  if (!g.files.length) return null;
  const ordered = [...g.files].sort((a, b) =>
    keepNewest ? (b.id || 0) - (a.id || 0) : (a.id || 0) - (b.id || 0)
  );
  return ordered[0]?.id ?? null;
}

export const TOOL_GROUPS: {
  titleKey: string;
  tabs: { id: DriveToolsTab; icon: any }[];
}[] = [
  {
    titleKey: 'drive.tools_group_drive',
    tabs: [
      { id: 'dups', icon: Layers },
      { id: 'rename', icon: Type },
      { id: 'space', icon: HardDrive },
      { id: 'filter', icon: Filter },
    ],
  },
  {
    titleKey: 'drive.tools_group_settings',
    tabs: [
      { id: 'upload', icon: Upload },
      { id: 'download', icon: Download },
      { id: 'encoding', icon: Film },
      { id: 'albums', icon: FolderTree },
      { id: 'duplicates', icon: CopyCheck },
      { id: 'limits_recovery', icon: HardDriveUpload },
      { id: 'network', icon: Network },
      { id: 'ytdlp', icon: Sliders },
      { id: 'advanced', icon: SlidersHorizontal },
    ],
  },
];
