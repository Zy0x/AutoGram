import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  RotateCcw,
  FolderOpen,
  Copy,
  Check,
  AlertCircle,
  FileText,
  FileCode,
} from 'lucide-react';
import type { TransferItem } from '../../../lib/telegram/driveTypes';
import { formatDriveBytes } from '../../../lib/telegram/driveTypes';
import { copyTextWithFallback } from '../../../lib/utils/debugMode';
import { revealInFolder } from '../../../lib/tauri/documentOpen';

type Props = {
  item: TransferItem;
  onRetryItem?: (item: TransferItem) => void;
  onOpenDiagnostics?: (item: TransferItem) => void;
};

export function parseDetailedError(
  errStr: string | undefined,
  t: (k: string, opt?: any) => string
): { title: string; explanation: string; raw: string; tag: string } {
  if (!errStr) {
    return {
      title: t('drive.tm_stat_failed'),
      explanation: t('drive.tm_failed_unknown_explanation'),
      raw: '',
      tag: 'ERROR',
    };
  }
  const s = String(errStr);

  if (/dropped \(cancelled\)|InvocationError::Dropped|ConnectionReset/i.test(s)) {
    return {
      title: t('drive.tm_error_dropped_title'),
      explanation: t('drive.tm_error_dropped_desc'),
      raw: s,
      tag: 'DROPPED',
    };
  }
  if (/flood_wait|floodwait|Rpc\(420\)/i.test(s)) {
    return {
      title: t('drive.tm_error_flood_title'),
      explanation: t('drive.tm_error_flood'),
      raw: s,
      tag: 'FLOODWAIT',
    };
  }
  if (/status code 404|404 not found/i.test(s)) {
    return {
      title: t('drive.tm_error_404_title'),
      explanation: t('drive.tm_error_404'),
      raw: s,
      tag: '404',
    };
  }
  if (/status code 403|403 forbidden/i.test(s)) {
    return {
      title: t('drive.tm_error_403_title'),
      explanation: t('drive.tm_error_403'),
      raw: s,
      tag: '403',
    };
  }
  if (/timeout|timed out|econnreset|econnrefused/i.test(s)) {
    return {
      title: t('drive.tm_error_timeout_title'),
      explanation: t('drive.tm_error_timeout'),
      raw: s,
      tag: 'TIMEOUT',
    };
  }
  if (/database is locked|sqlite_busy/i.test(s)) {
    return {
      title: t('drive.tm_error_db_locked_title'),
      explanation: t('drive.tm_error_db_locked'),
      raw: s,
      tag: 'DB LOCKED',
    };
  }

  return {
    title: t('drive.tm_stat_failed'),
    explanation: s.length > 120 ? `${s.slice(0, 117)}...` : s,
    raw: s,
    tag: 'ERROR',
  };
}

export function TransferFailedDetailCard({
  item,
  onRetryItem,
  onOpenDiagnostics,
}: Props) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const [revealError, setRevealError] = useState<string | null>(null);

  const errorInfo = parseDetailedError(item.error, t);
  const filePath = item.path || item.destination || '';
  const isLocalFile = Boolean(
    filePath &&
      (filePath.includes('\\') || filePath.includes('/') || /^[a-zA-Z]:/.test(filePath)) &&
      !filePath.startsWith('http://') &&
      !filePath.startsWith('https://')
  );

  const handleCopyError = async () => {
    const textToCopy = [
      `File: ${item.name}`,
      `Size: ${item.total ? formatDriveBytes(item.total) : 'N/A'}`,
      `Path: ${filePath || 'N/A'}`,
      `Error Title: ${errorInfo.title}`,
      `Details: ${errorInfo.explanation}`,
      errorInfo.raw ? `Raw Trace: ${errorInfo.raw}` : '',
    ]
      .filter(Boolean)
      .join('\n');

    const ok = await copyTextWithFallback(textToCopy);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleReveal = async () => {
    if (!filePath || !isLocalFile) return;
    try {
      setRevealError(null);
      await revealInFolder(filePath);
    } catch (e: any) {
      setRevealError(String(e?.message || e));
      setTimeout(() => setRevealError(null), 3000);
    }
  };

  return (
    <div
      className="tm-failed-card"
      role="region"
      aria-label={t('drive.tm_failed_detail_title')}
    >
      {/* Human-Readable Error Banner */}
      <div className="tm-failed-banner">
        <AlertCircle size={14} className="tm-failed-banner-ico" aria-hidden />
        <div className="tm-failed-banner-content">
          <div className="tm-failed-banner-header">
            <span className="tm-failed-tag">{errorInfo.tag}</span>
            <span className="tm-failed-banner-title">{errorInfo.title}</span>
          </div>
          <div className="tm-failed-banner-desc">{errorInfo.explanation}</div>
        </div>
      </div>

      {/* Metadata Info Row */}
      <div className="tm-failed-meta-grid">
        <div className="tm-failed-meta-item">
          <span className="tm-failed-meta-label">
            <FileCode size={11} className="tm-meta-ico" />
            {t('drive.tm_failed_file_path')}:
          </span>
          <span className="tm-failed-meta-val" title={filePath || item.name}>
            {filePath || item.name}
          </span>
        </div>
        <div className="tm-failed-meta-item">
          <span className="tm-failed-meta-label">{t('drive.tm_failed_file_size')}:</span>
          <span className="tm-failed-meta-val font-semibold">
            {item.total ? formatDriveBytes(item.total) : t('drive.file_size_unknown')}
          </span>
        </div>
      </div>

      {revealError && (
        <div className="tm-failed-reveal-err">
          {revealError}
        </div>
      )}

      {/* Action Buttons Row */}
      <div className="tm-failed-actions">
        {onRetryItem && (
          <button
            type="button"
            className="tm-failed-btn primary"
            onClick={() => onRetryItem(item)}
            title={t('drive.tm_retry_item_tooltip')}
          >
            <RotateCcw size={12} />
            <span>{t('drive.tm_retry_item')}</span>
          </button>
        )}

        {isLocalFile && (
          <button
            type="button"
            className="tm-failed-btn glass"
            onClick={handleReveal}
            title={t('drive.tm_open_in_explorer')}
          >
            <FolderOpen size={12} />
            <span>{t('drive.tm_open_in_explorer')}</span>
          </button>
        )}

        <button
          type="button"
          className="tm-failed-btn ghost"
          onClick={handleCopyError}
          title={copied ? t('drive.zip_btn_copied') : t('drive.tm_copy_error_msg')}
        >
          {copied ? (
            <Check size={12} className="text-emerald-400" />
          ) : (
            <Copy size={12} />
          )}
          <span>{copied ? t('drive.zip_btn_copied') : t('drive.tm_copy_error_msg')}</span>
        </button>

        {onOpenDiagnostics && (
          <button
            type="button"
            className="tm-failed-btn ghost"
            onClick={() => onOpenDiagnostics(item)}
            title={t('drive.tm_view_full_log')}
          >
            <FileText size={12} />
            <span>{t('drive.tm_view_full_log')}</span>
          </button>
        )}
      </div>
    </div>
  );
}
