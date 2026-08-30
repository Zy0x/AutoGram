import React, { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Eye,
  FolderOpen,
  Download,
  Copy,
  FolderInput,
  CheckSquare,
  RefreshCw,
  FileCode,
} from 'lucide-react';
import { isZipArchiveName, type ZipEntry } from './zipUtils';

export type ZipContextTarget =
  | { kind: 'file'; entry: ZipEntry }
  | { kind: 'dir'; path: string }
  | { kind: 'background' };

export type ZipContextMenuState = {
  x: number;
  y: number;
  target: ZipContextTarget;
} | null;

type ZipContextMenuProps = {
  menu: ZipContextMenuState;
  onClose: () => void;
  onPreview: (entry: ZipEntry) => void;
  onNavigateDir: (path: string) => void;
  onExtractEntry: (entry: ZipEntry) => void;
  onExtractDirectory: (path: string) => void;
  onExtractSelected: () => void;
  onSelectAll: () => void;
  onInvertSelection: () => void;
  selectedCount: number;
};

export const ZipContextMenu: React.FC<ZipContextMenuProps> = ({
  menu,
  onClose,
  onPreview,
  onNavigateDir,
  onExtractEntry,
  onExtractDirectory,
  onExtractSelected,
  onSelectAll,
  onInvertSelection,
  selectedCount,
}) => {
  const { t } = useTranslation();
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('mousedown', handleClickOutside);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [menu, onClose]);

  if (!menu) return null;

  // Keep menu within viewport bounds
  const x = Math.min(menu.x, window.innerWidth - 220);
  const y = Math.min(menu.y, window.innerHeight - 260);

  const target = menu.target;

  const handleCopyName = async (name: string) => {
    const filename = name.split('/').pop() || name;
    await navigator.clipboard.writeText(filename);
    onClose();
  };

  const handleCopyPath = async (path: string) => {
    await navigator.clipboard.writeText(path);
    onClose();
  };

  return (
    <div
      ref={menuRef}
      className="dzb-context-menu"
      style={{ left: `${Math.max(10, x)}px`, top: `${Math.max(10, y)}px` }}
      role="menu"
    >
      {target.kind === 'file' && (
        <>
          <button
            type="button"
            className="dzb-context-item"
            onClick={() => {
              onPreview(target.entry);
              onClose();
            }}
          >
            {isZipArchiveName(target.entry.name) ? <FolderOpen size={15} /> : <Eye size={15} />}
            <span>{isZipArchiveName(target.entry.name) ? t('drive.zip_open_nested') : t('drive.zip_ctx_preview')}</span>
          </button>

          <button
            type="button"
            className="dzb-context-item"
            onClick={() => {
              onExtractEntry(target.entry);
              onClose();
            }}
          >
            <Download size={15} />
            <span>{t('drive.zip_ctx_extract')}</span>
          </button>

          <div className="dzb-context-divider" />

          <button
            type="button"
            className="dzb-context-item"
            onClick={() => void handleCopyName(target.entry.name)}
          >
            <Copy size={15} />
            <span>{t('drive.zip_ctx_copy_name')}</span>
          </button>

          <button
            type="button"
            className="dzb-context-item"
            onClick={() => void handleCopyPath(target.entry.name)}
          >
            <FileCode size={15} />
            <span>{t('drive.zip_ctx_copy_path')}</span>
          </button>

          <div className="dzb-context-divider" />
        </>
      )}

      {target.kind === 'dir' && (
        <>
          <button
            type="button"
            className="dzb-context-item"
            onClick={() => {
              onNavigateDir(target.path);
              onClose();
            }}
          >
            <FolderOpen size={15} />
            <span>{t('drive.zip_ctx_open_folder')}</span>
          </button>

          <button
            type="button"
            className="dzb-context-item"
            onClick={() => {
              onExtractDirectory(target.path);
              onClose();
            }}
          >
            <Download size={15} />
            <span>{t('drive.zip_extract_directory')}</span>
          </button>

          <div className="dzb-context-divider" />
        </>
      )}

      {selectedCount > 0 && (
        <button
          type="button"
          className="dzb-context-item primary"
          onClick={() => {
            onExtractSelected();
            onClose();
          }}
        >
          <FolderInput size={15} />
          <span>{t('drive.zip_ctx_extract_selected')} ({selectedCount})</span>
        </button>
      )}

      <button
        type="button"
        className="dzb-context-item"
        onClick={() => {
          onSelectAll();
          onClose();
        }}
      >
        <CheckSquare size={15} />
        <span>{t('drive.zip_ctx_select_all')}</span>
      </button>

      <button
        type="button"
        className="dzb-context-item"
        onClick={() => {
          onInvertSelection();
          onClose();
        }}
      >
        <RefreshCw size={15} />
        <span>{t('drive.zip_ctx_invert_selection')}</span>
      </button>
    </div>
  );
};
