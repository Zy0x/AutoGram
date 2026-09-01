/**
 * AutoGram Universal File Intelligence Platform
 * Deep Media & Technical Metadata Extractor
 *
 * Extracts rich forensic, EXIF, GPS, video/audio stream specs, and binary container metadata.
 */

export interface MediaTechnicalMetadata {
  // General
  fileSize: number;
  mimeType: string;
  category: string;
  detectedFormat: string;
  sha256Preview?: string;
  lastModified?: string;

  // Video / Audio Specs
  durationSeconds?: number;
  durationFormatted?: string;
  videoWidth?: number;
  videoHeight?: number;
  aspectRatio?: string;
  fps?: number;
  videoCodec?: string;
  videoBitrateKbps?: number;
  audioCodec?: string;
  audioChannels?: number;
  audioSampleRateHz?: number;

  // Photo & EXIF Specs
  cameraMake?: string;
  cameraModel?: string;
  lensModel?: string;
  exposureTime?: string;
  fNumber?: string;
  isoSpeed?: number;
  focalLengthMm?: number;
  dateTimeOriginal?: string;
  gpsLatitude?: number;
  gpsLongitude?: number;
  gpsAltitude?: number;
  colorSpace?: string;

  // Document / Table / Code Specs
  totalLines?: number;
  totalWords?: number;
  totalChars?: number;
  tableRows?: number;
  tableCols?: number;
  encoding?: string;
}

export function formatDurationSeconds(sec?: number): string {
  if (sec == null || !Number.isFinite(sec) || sec <= 0) return '';
  const total = Math.floor(sec);
  const m = Math.floor(total / 60);
  const s = total % 60;
  const h = Math.floor(m / 60);
  const remM = m % 60;
  if (h > 0) {
    return `${h}:${String(remM).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function calculateAspectRatio(w?: number, h?: number): string {
  if (!w || !h || w <= 0 || h <= 0) return '';
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
  const d = gcd(w, h);
  const aspectW = w / d;
  const aspectH = h / d;
  if ((aspectW === 16 && aspectH === 9) || (aspectW === 4 && aspectH === 3) || (aspectW === 21 && aspectH === 9) || (aspectW === 1 && aspectH === 1)) {
    return `${aspectW}:${aspectH}`;
  }
  const ratio = (w / h).toFixed(2);
  return `${ratio}:1 (${w}x${h})`;
}
