import {
  TransferSettingsWorkspace,
  type SubMenuCategory,
  type WorkspaceTabState,
  type TransferSettingsWorkspaceProps,
} from './TransferSettingsWorkspace';

/**
 * Backwards-compatible entry point for older imports.
 *
 * The implementation intentionally lives in TransferSettingsWorkspace so the
 * drive settings feature has one source of truth instead of two divergent
 * modal/workspace implementations.
 */
export { TransferSettingsWorkspace };
export type { SubMenuCategory, WorkspaceTabState, TransferSettingsWorkspaceProps };

export type DriveToolsModalProps = TransferSettingsWorkspaceProps;

export function DriveToolsModal(props: DriveToolsModalProps) {
  return <TransferSettingsWorkspace {...props} />;
}
