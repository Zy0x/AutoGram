import React from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Download, AppWindow, ExternalLink } from 'lucide-react';

interface UnsupportedFormatBannerProps {
  fileName: string;
  ext: string;
  reason?: 'video' | 'audio' | 'image' | 'document' | 'archive';
  onDownload?: () => void;
  onOpenSystem?: () => void;
  recommendedApp?: string;
}

const RECOMMENDED_APPS: Record<string, string> = {
  avi: 'VLC Media Player',
  flv: 'VLC Media Player',
  wmv: 'VLC / Windows Media Player',
  mpg: 'VLC Media Player',
  mpeg: 'VLC Media Player',
  m2ts: 'VLC Media Player',
  mts: 'VLC Media Player',
  ts: 'VLC Media Player',
  vob: 'VLC Media Player',
  rmvb: 'VLC Media Player',
  rm: 'VLC Media Player',
  wma: 'VLC / Windows Media Player',
  aiff: 'VLC / QuickTime',
  aif: 'VLC / QuickTime',
  amr: 'VLC Media Player',
  ape: 'foobar2000 / VLC',
  mid: 'Windows Media Player',
  midi: 'Windows Media Player',
  heic: 'Windows Photos / iPhone',
  heif: 'Windows Photos / iPhone',
  tif: 'Windows Photos / IrfanView',
  tiff: 'Windows Photos / IrfanView',
  psd: 'Photoshop / GIMP',
  cr2: 'Lightroom / RawTherapee',
  arw: 'Lightroom / RawTherapee',
  nef: 'Lightroom / RawTherapee',
  dng: 'Lightroom / RawTherapee',
  doc: 'Microsoft Word / LibreOffice',
  ppt: 'Microsoft PowerPoint / LibreOffice',
  odt: 'LibreOffice Writer',
  odp: 'LibreOffice Impress',
  rtf: 'Microsoft Word / LibreOffice',
  tar: '7-Zip / WinRAR',
  gz: '7-Zip / WinRAR',
  tgz: '7-Zip / WinRAR',
  bz2: '7-Zip / WinRAR',
  xz: '7-Zip / WinRAR',
  zst: 'zstd / 7-Zip',
  '7z': '7-Zip / WinRAR',
};

const FORMAT_NOTES: Record<string, string> = {
  avi: 'Format AVI (Audio Video Interleave) tidak didukung browser modern. Gunakan VLC untuk memutar.',
  flv: 'Format Flash Video (FLV) tidak lagi didukung browser. Unduh dan putar dengan VLC.',
  wmv: 'Format Windows Media Video (WMV) memerlukan codec khusus. Gunakan VLC atau Windows Media Player.',
  heic: 'Format HEIC/HEIF (foto iPhone) memerlukan decoder. File sedang diproses...',
  heif: 'Format HEIC/HEIF (foto iPhone) memerlukan decoder. File sedang diproses...',
  tif: 'Format TIFF memerlukan decoder. File sedang diproses...',
  tiff: 'Format TIFF memerlukan decoder. File sedang diproses...',
  psd: 'Format Adobe Photoshop (PSD) memerlukan Photoshop atau GIMP untuk dibuka.',
  doc: 'Format Microsoft Word lama (.doc) tidak sama dengan .docx modern. Unduh dan buka di Word atau LibreOffice.',
  ppt: 'Format PowerPoint lama (.ppt) tidak sama dengan .pptx modern. Unduh dan buka di PowerPoint atau LibreOffice.',
  wma: 'Format Windows Media Audio (WMA) tidak didukung browser. Unduh dan putar di VLC.',
  amr: 'Format AMR (voice note) tidak didukung browser. Unduh dan putar di VLC.',
  '7z': 'Format 7-Zip belum didukung explorer bawaan. Unduh dan buka dengan 7-Zip.',
  tar: 'Format TAR belum didukung explorer bawaan. Unduh dan ekstrak dengan 7-Zip.',
};

export const UnsupportedFormatBanner: React.FC<UnsupportedFormatBannerProps> = ({
  fileName,
  ext,
  onDownload,
  onOpenSystem,
  recommendedApp: recommendedAppProp,
}) => {
  const { t } = useTranslation();
  const extLower = ext.toLowerCase().replace(/^\./, '');
  const recommendedApp = recommendedAppProp || RECOMMENDED_APPS[extLower];
  const note = FORMAT_NOTES[extLower];

  return (
    <div className="td-unsupported-banner">
      <div className="td-unsupported-icon-wrap">
        <AlertTriangle size={32} className="td-unsupported-icon" />
      </div>
      <div className="td-unsupported-body">
        <h3 className="td-unsupported-title">
          {t('drive.unsupported_format_title', { ext: extLower.toUpperCase() })}
        </h3>
        <p className="td-unsupported-subtitle">
          {note || t('drive.unsupported_format_desc', { ext: extLower.toUpperCase() })}
        </p>
        <div className="td-unsupported-file-chip">
          <span className="td-unsupported-file-ext">{extLower.toUpperCase()}</span>
          <span className="td-unsupported-file-name">{fileName}</span>
        </div>
        {recommendedApp && (
          <p className="td-unsupported-recommend">
            <ExternalLink size={12} style={{ display: 'inline', marginRight: 4 }} />
            {t('drive.unsupported_recommended_app')}: <strong>{recommendedApp}</strong>
          </p>
        )}
      </div>
      <div className="td-unsupported-actions">
        {onOpenSystem && (
          <button type="button" className="td-unsupported-btn td-unsupported-btn--primary" onClick={onOpenSystem}>
            <AppWindow size={14} />
            {t('drive.open_with_system_app')}
          </button>
        )}
        {onDownload && (
          <button type="button" className="td-unsupported-btn td-unsupported-btn--secondary" onClick={onDownload}>
            <Download size={14} />
            {t('drive.download_to_open')}
          </button>
        )}
      </div>
    </div>
  );
};

export default UnsupportedFormatBanner;
