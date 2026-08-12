import type { DriveTransferSettings } from '../../../lib/telegram/driveTypes';
import { TransferSettingsWorkspace, type SubMenuCategory } from './TransferSettingsWorkspace';

interface DriveTransferSettingsProps {
  open?: boolean;
  settings: DriveTransferSettings;
  onChange: (next: DriveTransferSettings) => void;
  onClose: () => void;
  transferActive?: boolean;
  initialCategory?: SubMenuCategory | 'menu';
}

/**
 * Standalone Portal/Modal wrapper around canonical TransferSettingsWorkspace.
 */
export function DriveTransferSettings({
  open = true,
  settings,
  onChange,
  onClose,
  transferActive,
  initialCategory = 'menu',
}: DriveTransferSettingsProps) {
  if (open === false) return null;
  return (
    <div className="td-xfer-settings-overlay" role="presentation" onClick={onClose}>
      <div
        className="td-xfer-settings-dialog"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <TransferSettingsWorkspace
          settings={settings}
          onChange={onChange}
          onClose={onClose}
          transferActive={transferActive}
          embedded={false}
          activeCategory={initialCategory === 'menu' ? undefined : initialCategory}
        />
      </div>
    </div>
  );
}
