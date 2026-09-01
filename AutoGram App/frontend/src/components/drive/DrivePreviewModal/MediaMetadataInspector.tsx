import React, { useState } from 'react';
import {
  Camera,
  Film,
  FileText,
  MapPin,
  Layers,
  Copy,
  Check,
  ExternalLink,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { MediaTechnicalMetadata } from '../../../lib/media/metadataExtractor';
import { formatDriveBytes } from '../../../lib/telegram/driveTypes';

interface Props {
  metadata: MediaTechnicalMetadata;
  fileName: string;
}

export const MediaMetadataInspector: React.FC<Props> = ({ metadata, fileName }) => {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  const handleCopyJson = () => {
    void navigator.clipboard.writeText(JSON.stringify({ fileName, ...metadata }, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const hasGps = metadata.gpsLatitude != null && metadata.gpsLongitude != null;
  const hasExif = Boolean(metadata.cameraMake || metadata.cameraModel || metadata.lensModel || metadata.isoSpeed);
  const hasVideoStream = Boolean(metadata.videoCodec || metadata.videoWidth || metadata.fps || metadata.videoBitrateKbps);
  const hasAudioStream = Boolean(metadata.audioCodec || metadata.audioChannels || metadata.audioSampleRateHz);

  return (
    <div className="td-metadata-inspector-wrap">
      <div className="td-metadata-inspector-head">
        <div className="td-metadata-inspector-title">
          <Layers size={18} className="text-sky-400" />
          <span>{t('drive.metadata_inspector_title', 'Inspektor Teknis & EXIF')}</span>
        </div>
        <button
          type="button"
          className="td-btn-secondary td-btn-sm"
          onClick={handleCopyJson}
          title={t('drive.copy_metadata_json', 'Salin metadata JSON')}
        >
          {copied ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} />}
          <span>{copied ? t('drive.copied', 'Tersalin') : t('drive.copy_json', 'Salin JSON')}</span>
        </button>
      </div>

      <div className="td-metadata-bento-grid">
        {/* Card 1: Core File Architecture */}
        <div className="td-metadata-card">
          <div className="td-metadata-card-head">
            <FileText size={15} className="text-sky-400" />
            <span>{t('drive.metadata_sec_file', 'Arsitektur Berkas')}</span>
          </div>
          <div className="td-metadata-rows">
            <div className="td-meta-row">
              <span className="td-meta-k">{t('drive.metadata_lbl_name', 'Nama Berkas')}</span>
              <span className="td-meta-v" title={fileName}>{fileName}</span>
            </div>
            <div className="td-meta-row">
              <span className="td-meta-k">{t('drive.metadata_lbl_format', 'Format Terdeteksi')}</span>
              <span className="td-meta-v font-mono">{metadata.detectedFormat || metadata.category}</span>
            </div>
            <div className="td-meta-row">
              <span className="td-meta-k">{t('drive.metadata_lbl_mime', 'Tipe MIME')}</span>
              <span className="td-meta-v font-mono">{metadata.mimeType}</span>
            </div>
            <div className="td-meta-row">
              <span className="td-meta-k">{t('drive.metadata_lbl_size', 'Ukuran Berkas')}</span>
              <span className="td-meta-v">{formatDriveBytes(metadata.fileSize)} ({metadata.fileSize.toLocaleString()} bytes)</span>
            </div>
            {metadata.sha256Preview && (
              <div className="td-meta-row">
                <span className="td-meta-k">{t('drive.metadata_lbl_sha256', 'SHA-256 (Pratinjau)')}</span>
                <span className="td-meta-v font-mono">{metadata.sha256Preview}</span>
              </div>
            )}
          </div>
        </div>

        {/* Card 2: Video & Audio Stream (if applicable) */}
        {(hasVideoStream || hasAudioStream || metadata.durationFormatted) && (
          <div className="td-metadata-card">
            <div className="td-metadata-card-head">
              <Film size={15} className="text-violet-400" />
              <span>{t('drive.metadata_sec_stream', 'Spesifikasi Media & Stream')}</span>
            </div>
            <div className="td-metadata-rows">
              {metadata.durationFormatted && (
                <div className="td-meta-row">
                  <span className="td-meta-k">{t('drive.metadata_lbl_duration', 'Durasi Total')}</span>
                  <span className="td-meta-v font-mono font-semibold">{metadata.durationFormatted}</span>
                </div>
              )}
              {metadata.videoWidth && metadata.videoHeight && (
                <div className="td-meta-row">
                  <span className="td-meta-k">{t('drive.metadata_lbl_res', 'Resolusi / Dimensi')}</span>
                  <span className="td-meta-v font-mono">{metadata.videoWidth} × {metadata.videoHeight} px</span>
                </div>
              )}
              {metadata.aspectRatio && (
                <div className="td-meta-row">
                  <span className="td-meta-k">{t('drive.metadata_lbl_ratio', 'Rasio Aspek')}</span>
                  <span className="td-meta-v">{metadata.aspectRatio}</span>
                </div>
              )}
              {metadata.fps && (
                <div className="td-meta-row">
                  <span className="td-meta-k">{t('drive.metadata_lbl_fps', 'Frame Rate (FPS)')}</span>
                  <span className="td-meta-v font-mono">{metadata.fps} fps</span>
                </div>
              )}
              {metadata.videoCodec && (
                <div className="td-meta-row">
                  <span className="td-meta-k">{t('drive.metadata_lbl_vcodec', 'Codec Video')}</span>
                  <span className="td-meta-v font-mono">{metadata.videoCodec}</span>
                </div>
              )}
              {metadata.audioCodec && (
                <div className="td-meta-row">
                  <span className="td-meta-k">{t('drive.metadata_lbl_acodec', 'Codec Audio')}</span>
                  <span className="td-meta-v font-mono">{metadata.audioCodec}</span>
                </div>
              )}
              {metadata.audioSampleRateHz && (
                <div className="td-meta-row">
                  <span className="td-meta-k">{t('drive.metadata_lbl_srate', 'Sample Rate')}</span>
                  <span className="td-meta-v font-mono">{(metadata.audioSampleRateHz / 1000).toFixed(1)} kHz</span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Card 3: Camera & Lens EXIF (if applicable) */}
        {hasExif && (
          <div className="td-metadata-card">
            <div className="td-metadata-card-head">
              <Camera size={15} className="text-emerald-400" />
              <span>{t('drive.metadata_sec_exif', 'Data Kamera & Lensa (EXIF)')}</span>
            </div>
            <div className="td-metadata-rows">
              {(metadata.cameraMake || metadata.cameraModel) && (
                <div className="td-meta-row">
                  <span className="td-meta-k">{t('drive.metadata_lbl_camera', 'Kamera')}</span>
                  <span className="td-meta-v">{[metadata.cameraMake, metadata.cameraModel].filter(Boolean).join(' ')}</span>
                </div>
              )}
              {metadata.lensModel && (
                <div className="td-meta-row">
                  <span className="td-meta-k">{t('drive.metadata_lbl_lens', 'Lensa')}</span>
                  <span className="td-meta-v">{metadata.lensModel}</span>
                </div>
              )}
              {metadata.focalLengthMm && (
                <div className="td-meta-row">
                  <span className="td-meta-k">{t('drive.metadata_lbl_focal', 'Focal Length')}</span>
                  <span className="td-meta-v font-mono">{metadata.focalLengthMm} mm</span>
                </div>
              )}
              {metadata.fNumber && (
                <div className="td-meta-row">
                  <span className="td-meta-k">{t('drive.metadata_lbl_fstop', 'Aperture')}</span>
                  <span className="td-meta-v font-mono">{metadata.fNumber}</span>
                </div>
              )}
              {metadata.exposureTime && (
                <div className="td-meta-row">
                  <span className="td-meta-k">{t('drive.metadata_lbl_exposure', 'Shutter Speed')}</span>
                  <span className="td-meta-v font-mono">{metadata.exposureTime} s</span>
                </div>
              )}
              {metadata.isoSpeed && (
                <div className="td-meta-row">
                  <span className="td-meta-k">{t('drive.metadata_lbl_iso', 'ISO Speed')}</span>
                  <span className="td-meta-v font-mono">ISO {metadata.isoSpeed}</span>
                </div>
              )}
              {metadata.dateTimeOriginal && (
                <div className="td-meta-row">
                  <span className="td-meta-k">{t('drive.metadata_lbl_datetime', 'Waktu Pengambilan')}</span>
                  <span className="td-meta-v">{metadata.dateTimeOriginal}</span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Card 4: GPS Coordinates (if applicable) */}
        {hasGps && (
          <div className="td-metadata-card">
            <div className="td-metadata-card-head">
              <MapPin size={15} className="text-rose-400" />
              <span>{t('drive.metadata_sec_gps', 'Geolokasi GPS')}</span>
            </div>
            <div className="td-metadata-rows">
              <div className="td-meta-row">
                <span className="td-meta-k">{t('drive.metadata_lbl_lat', 'Latitude')}</span>
                <span className="td-meta-v font-mono">{metadata.gpsLatitude?.toFixed(6)}°</span>
              </div>
              <div className="td-meta-row">
                <span className="td-meta-k">{t('drive.metadata_lbl_lon', 'Longitude')}</span>
                <span className="td-meta-v font-mono">{metadata.gpsLongitude?.toFixed(6)}°</span>
              </div>
              {metadata.gpsAltitude != null && (
                <div className="td-meta-row">
                  <span className="td-meta-k">{t('drive.metadata_lbl_alt', 'Ketinggian')}</span>
                  <span className="td-meta-v font-mono">{metadata.gpsAltitude.toFixed(1)} m dpl</span>
                </div>
              )}
              <div className="td-meta-row" style={{ marginTop: '6px' }}>
                <a
                  href={`https://www.openstreetmap.org/?mlat=${metadata.gpsLatitude}&mlon=${metadata.gpsLongitude}#map=16/${metadata.gpsLatitude}/${metadata.gpsLongitude}`}
                  target="_blank"
                  rel="noreferrer"
                  className="td-btn-secondary td-btn-xs"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}
                >
                  <ExternalLink size={12} />
                  <span>{t('drive.metadata_view_osm', 'Buka di OpenStreetMap')}</span>
                </a>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
