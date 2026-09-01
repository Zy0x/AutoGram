/**
 * AutoGram Universal File Intelligence Platform
 * Magic Bytes & Binary Signature Sniffer Engine
 *
 * Scans initial bytes of any ArrayBuffer, Uint8Array, or Blob to determine true file type,
 * identify mismatched/fake extensions, detect disguised executables, and recommend fixes.
 */

export interface MagicSniffResult {
  /** True detected extension without dot (e.g. mp4, png, pdf, zip) */
  detectedExt: string;
  /** Primary category */
  category:
    | 'video'
    | 'image'
    | 'audio'
    | 'pdf'
    | 'document'
    | 'code'
    | 'text'
    | 'json'
    | 'table'
    | 'archive'
    | 'database'
    | 'font'
    | 'model'
    | 'diagram'
    | 'cad'
    | 'executable'
    | 'unknown';
  /** Detected standard MIME type */
  mimeType: string;
  /** Human-readable format name (e.g. MPEG-4 Video, Portable Network Graphics) */
  formatLabel: string;
  /** True if the filename extension accurately matches the binary signature */
  isExtensionMatch: boolean;
  /** True if filename has no extension (e.g. Telegram cache 2071942102007885896) */
  isExtensionMissing: boolean;
  /** True if the file contains executable code disguised under another extension */
  isSuspiciousExecutable: boolean;
  /** Severity level for UI banners: 'safe' | 'info' | 'warning' | 'danger' */
  severity: 'safe' | 'info' | 'warning' | 'danger';
  /** Suggested safe filename with proper extension */
  suggestedFilename: string;
  /** Confidence score between 0.0 and 1.0 */
  confidence: number;
}

export function sniffMagicBytes(
  bytes: Uint8Array | ArrayBuffer | number[],
  currentFilename = ''
): MagicSniffResult {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const len = u8.length;
  const rawExt = currentFilename.split('.').pop()?.toLowerCase() || '';
  const hasDot = currentFilename.includes('.');
  const ext = hasDot ? rawExt : '';
  const baseName = hasDot ? currentFilename.substring(0, currentFilename.lastIndexOf('.')) : currentFilename;

  // Helper to test byte sequence at a given offset
  const matches = (offset: number, pattern: number[]): boolean => {
    if (len < offset + pattern.length) return false;
    for (let i = 0; i < pattern.length; i++) {
      if (pattern[i] !== -1 && u8[offset + i] !== pattern[i]) return false;
    }
    return true;
  };

  // Helper to test ASCII string at a given offset
  const matchesAscii = (offset: number, str: string): boolean => {
    if (len < offset + str.length) return false;
    for (let i = 0; i < str.length; i++) {
      if (u8[offset + i] !== str.charCodeAt(i)) return false;
    }
    return true;
  };

  // Helper to test ASCII string search in the first N bytes
  const containsAscii = (str: string, maxScan = 512): boolean => {
    const scanLimit = Math.min(len, maxScan);
    if (scanLimit < str.length) return false;
    const strBytes = Array.from(str).map((c) => c.charCodeAt(0));
    for (let i = 0; i <= scanLimit - strBytes.length; i++) {
      let found = true;
      for (let j = 0; j < strBytes.length; j++) {
        if (u8[i + j] !== strBytes[j]) {
          found = false;
          break;
        }
      }
      if (found) return true;
    }
    return false;
  };

  let detectedExt = '';
  let category: MagicSniffResult['category'] = 'unknown';
  let mimeType = 'application/octet-stream';
  let formatLabel = 'Binary File';
  let isSuspiciousExecutable = false;
  let confidence = 0.9;

  // 1. DANGEROUS EXECUTABLES & NATIVE CODE
  if (matches(0, [0x4d, 0x5a])) {
    // MZ Header (Windows PE Executable / DLL)
    detectedExt = 'exe';
    category = 'executable';
    mimeType = 'application/x-msdownload';
    formatLabel = 'Windows Executable / Binary';
    isSuspiciousExecutable = true;
    confidence = 0.99;
  } else if (matches(0, [0x7f, 0x45, 0x4c, 0x46])) {
    // ELF Linux Executable / Binary
    detectedExt = 'elf';
    category = 'executable';
    mimeType = 'application/x-executable';
    formatLabel = 'Linux ELF Executable';
    isSuspiciousExecutable = true;
    confidence = 0.99;
  } else if (
    matches(0, [0xfe, 0xed, 0xfa, 0xce]) ||
    matches(0, [0xfe, 0xed, 0xfa, 0xcf]) ||
    matches(0, [0xce, 0xfa, 0xed, 0xfe]) ||
    matches(0, [0xcf, 0xfa, 0xed, 0xfe])
  ) {
    // Mach-O macOS Binary
    detectedExt = 'dylib';
    category = 'executable';
    mimeType = 'application/x-mach-binary';
    formatLabel = 'macOS Mach-O Binary';
    isSuspiciousExecutable = true;
  } else if (matches(0, [0xca, 0xfe, 0xba, 0xbe])) {
    // Java Class bytecode or Mach-O Fat Binary
    detectedExt = 'class';
    category = 'executable';
    mimeType = 'application/java-vm';
    formatLabel = 'Java Bytecode Class';
  } else if (matches(0, [0x00, 0x61, 0x73, 0x6d])) {
    // WebAssembly Binary (\0asm)
    detectedExt = 'wasm';
    category = 'code';
    mimeType = 'application/wasm';
    formatLabel = 'WebAssembly Bytecode';
  }

  // 2. VIDEO & ANIMATION MEDIA
  else if (matches(4, [0x66, 0x74, 0x79, 0x70])) {
    // ISO Base Media File Format (ftyp box at offset 4)
    if (matchesAscii(8, 'isom') || matchesAscii(8, 'mp41') || matchesAscii(8, 'mp42') || matchesAscii(8, 'MSNV') || matchesAscii(8, 'dash')) {
      detectedExt = 'mp4';
      category = 'video';
      mimeType = 'video/mp4';
      formatLabel = 'MPEG-4 Video (MP4)';
      confidence = 1.0;
    } else if (matchesAscii(8, 'qt  ') || matchesAscii(8, 'moov')) {
      detectedExt = 'mov';
      category = 'video';
      mimeType = 'video/quicktime';
      formatLabel = 'Apple QuickTime Movie (MOV)';
      confidence = 1.0;
    } else if (matchesAscii(8, 'heic') || matchesAscii(8, 'heix') || matchesAscii(8, 'mif1')) {
      detectedExt = 'heic';
      category = 'image';
      mimeType = 'image/heic';
      formatLabel = 'High Efficiency Image (HEIC)';
      confidence = 1.0;
    } else if (matchesAscii(8, 'avif') || matchesAscii(8, 'avis')) {
      detectedExt = 'avif';
      category = 'image';
      mimeType = 'image/avif';
      formatLabel = 'AV1 Image Format (AVIF)';
      confidence = 1.0;
    } else if (matchesAscii(8, 'M4A ') || matchesAscii(8, 'M4B ')) {
      detectedExt = 'm4a';
      category = 'audio';
      mimeType = 'audio/mp4';
      formatLabel = 'MPEG-4 Audio (M4A)';
      confidence = 1.0;
    } else {
      detectedExt = 'mp4';
      category = 'video';
      mimeType = 'video/mp4';
      formatLabel = 'ISO/IEC MP4 Container';
      confidence = 0.95;
    }
  } else if (matches(0, [0x1a, 0x45, 0xdf, 0xa3])) {
    // Matroska / WebM EBML Header
    if (containsAscii('webm', 64)) {
      detectedExt = 'webm';
      category = 'video';
      mimeType = 'video/webm';
      formatLabel = 'WebM Video';
      confidence = 1.0;
    } else {
      detectedExt = 'mkv';
      category = 'video';
      mimeType = 'video/x-matroska';
      formatLabel = 'Matroska Video (MKV)';
      confidence = 1.0;
    }
  } else if (matches(0, [0x52, 0x49, 0x46, 0x46]) && matchesAscii(8, 'AVI ')) {
    // RIFF AVI
    detectedExt = 'avi';
    category = 'video';
    mimeType = 'video/x-msvideo';
    formatLabel = 'Audio Video Interleave (AVI)';
    confidence = 1.0;
  } else if (matches(0, [0x46, 0x4c, 0x56, 0x01])) {
    // FLV Video
    detectedExt = 'flv';
    category = 'video';
    mimeType = 'video/x-flv';
    formatLabel = 'Flash Video (FLV)';
    confidence = 1.0;
  } else if (matches(0, [0x30, 0x26, 0xb2, 0x75, 0x8e, 0x66, 0xcf, 0x11])) {
    // WMV / ASF Container
    detectedExt = 'wmv';
    category = 'video';
    mimeType = 'video/x-ms-wmv';
    formatLabel = 'Windows Media Video (WMV)';
    confidence = 1.0;
  } else if (matches(0, [0x47]) && (len < 188 || u8[188] === 0x47)) {
    // MPEG Transport Stream (.ts / .m2ts)
    detectedExt = 'ts';
    category = 'video';
    mimeType = 'video/mp2t';
    formatLabel = 'MPEG Transport Stream (TS)';
    confidence = 0.9;
  }

  // 3. IMAGE MEDIA
  else if (matches(0, [0xff, 0xd8, 0xff])) {
    // JPEG
    detectedExt = 'jpg';
    category = 'image';
    mimeType = 'image/jpeg';
    formatLabel = 'JPEG Image';
    confidence = 1.0;
  } else if (matches(0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    // PNG
    detectedExt = 'png';
    category = 'image';
    mimeType = 'image/png';
    formatLabel = 'PNG Image';
    confidence = 1.0;
  } else if (matchesAscii(0, 'GIF87a') || matchesAscii(0, 'GIF89a')) {
    // GIF
    detectedExt = 'gif';
    category = 'image';
    mimeType = 'image/gif';
    formatLabel = 'GIF Animation';
    confidence = 1.0;
  } else if (matches(0, [0x52, 0x49, 0x46, 0x46]) && matchesAscii(8, 'WEBP')) {
    // WebP
    detectedExt = 'webp';
    category = 'image';
    mimeType = 'image/webp';
    formatLabel = 'WebP Image';
    confidence = 1.0;
  } else if (matches(0, [0x49, 0x49, 0x2a, 0x00]) || matches(0, [0x4d, 0x4d, 0x00, 0x2a])) {
    // TIFF / RAW (DNG, CR2, NEF, ARW)
    if (matches(8, [0x43, 0x42])) {
      detectedExt = 'cr2';
      formatLabel = 'Canon Camera RAW (CR2)';
    } else {
      detectedExt = 'tif';
      formatLabel = 'TIFF Image';
    }
    category = 'image';
    mimeType = 'image/tiff';
    confidence = 0.95;
  } else if (matches(0, [0x42, 0x4d])) {
    // BMP Bitmap
    detectedExt = 'bmp';
    category = 'image';
    mimeType = 'image/bmp';
    formatLabel = 'Windows Bitmap (BMP)';
    confidence = 0.95;
  } else if (matches(0, [0x00, 0x00, 0x01, 0x00])) {
    // ICO Windows Icon
    detectedExt = 'ico';
    category = 'image';
    mimeType = 'image/x-icon';
    formatLabel = 'Windows Icon (ICO)';
    confidence = 0.95;
  } else if (matches(0, [0x38, 0x42, 0x50, 0x53])) {
    // Photoshop PSD / PSB (8BPS)
    detectedExt = 'psd';
    category = 'image';
    mimeType = 'image/vnd.adobe.photoshop';
    formatLabel = 'Adobe Photoshop Document (PSD)';
    confidence = 1.0;
  }

  // 4. AUDIO MEDIA
  else if (matches(0, [0x49, 0x44, 0x33]) || matches(0, [0xff, 0xfb]) || matches(0, [0xff, 0xf3]) || matches(0, [0xff, 0xf2])) {
    // MP3
    detectedExt = 'mp3';
    category = 'audio';
    mimeType = 'audio/mpeg';
    formatLabel = 'MPEG Layer-3 Audio (MP3)';
    confidence = 0.95;
  } else if (matches(0, [0x66, 0x4c, 0x61, 0x43])) {
    // FLAC
    detectedExt = 'flac';
    category = 'audio';
    mimeType = 'audio/flac';
    formatLabel = 'Free Lossless Audio Codec (FLAC)';
    confidence = 1.0;
  } else if (matches(0, [0x52, 0x49, 0x46, 0x46]) && matchesAscii(8, 'WAVE')) {
    // WAV
    detectedExt = 'wav';
    category = 'audio';
    mimeType = 'audio/wav';
    formatLabel = 'Waveform Audio (WAV)';
    confidence = 1.0;
  } else if (matches(0, [0x4f, 0x67, 0x67, 0x53])) {
    // OGG Container
    if (containsAscii('OpusHead', 64)) {
      detectedExt = 'opus';
      category = 'audio';
      mimeType = 'audio/opus';
      formatLabel = 'Opus Audio';
    } else if (containsAscii('theora', 64)) {
      detectedExt = 'ogv';
      category = 'video';
      mimeType = 'video/ogg';
      formatLabel = 'Ogg Theora Video';
    } else {
      detectedExt = 'ogg';
      category = 'audio';
      mimeType = 'audio/ogg';
      formatLabel = 'Ogg Vorbis Audio';
    }
    confidence = 1.0;
  } else if (matches(0, [0x4d, 0x54, 0x68, 0x64])) {
    // MIDI
    detectedExt = 'mid';
    category = 'audio';
    mimeType = 'audio/midi';
    formatLabel = 'Musical Instrument Digital Interface (MIDI)';
    confidence = 1.0;
  }

  // 5. DOCUMENTS & ARCHIVES
  else if (matches(0, [0x25, 0x50, 0x44, 0x46, 0x2d])) {
    // PDF
    detectedExt = 'pdf';
    category = 'pdf';
    mimeType = 'application/pdf';
    formatLabel = 'Portable Document Format (PDF)';
    confidence = 1.0;
  } else if (matches(0, [0x50, 0x4b, 0x03, 0x04]) || matches(0, [0x50, 0x4b, 0x05, 0x06])) {
    // ZIP Container (Office OpenXML, APK, JAR, EPUB, OpenDocument, KMZ, CBZ, etc.)
    if (ext === 'docx' || ext === 'docm' || ext === 'dotx' || containsAscii('word/', 1024) || containsAscii('word/document.xml', 2048)) {
      detectedExt = 'docx';
      category = 'document';
      mimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
      formatLabel = 'Microsoft Word Document (DOCX)';
    } else if (ext === 'xlsx' || ext === 'xlsm' || ext === 'xltx' || containsAscii('xl/', 1024) || containsAscii('xl/workbook.xml', 2048)) {
      detectedExt = 'xlsx';
      category = 'table';
      mimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
      formatLabel = 'Microsoft Excel Spreadsheet (XLSX)';
    } else if (ext === 'pptx' || ext === 'pptm' || ext === 'potx' || containsAscii('ppt/', 1024) || containsAscii('ppt/presentation.xml', 2048)) {
      detectedExt = 'pptx';
      category = 'document';
      mimeType = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
      formatLabel = 'Microsoft PowerPoint Presentation (PPTX)';
    } else if (ext === 'apk' || ext === 'aab' || ext === 'xapk' || containsAscii('AndroidManifest.xml', 1024) || containsAscii('classes.dex', 1024)) {
      detectedExt = 'apk';
      category = 'archive';
      mimeType = 'application/vnd.android.package-archive';
      formatLabel = 'Android Application Package (APK)';
    } else if (ext === 'jar' || ext === 'war' || ext === 'ear' || containsAscii('META-INF/', 1024)) {
      detectedExt = 'jar';
      category = 'archive';
      mimeType = 'application/java-archive';
      formatLabel = 'Java Archive (JAR)';
    } else if (ext === 'epub' || containsAscii('mimetypeapplication/epub+zip', 256)) {
      detectedExt = 'epub';
      category = 'document';
      mimeType = 'application/epub+zip';
      formatLabel = 'Electronic Publication (EPUB)';
    } else if (ext === 'odt') {
      detectedExt = 'odt';
      category = 'document';
      mimeType = 'application/vnd.oasis.opendocument.text';
      formatLabel = 'OpenDocument Text (ODT)';
    } else if (ext === 'ods') {
      detectedExt = 'ods';
      category = 'table';
      mimeType = 'application/vnd.oasis.opendocument.spreadsheet';
      formatLabel = 'OpenDocument Spreadsheet (ODS)';
    } else if (ext === 'odp') {
      detectedExt = 'odp';
      category = 'document';
      mimeType = 'application/vnd.oasis.opendocument.presentation';
      formatLabel = 'OpenDocument Presentation (ODP)';
    } else if (ext === 'kmz') {
      detectedExt = 'kmz';
      category = 'diagram';
      mimeType = 'application/vnd.google-earth.kmz';
      formatLabel = 'Keyhole Markup Zip (KMZ)';
    } else if (ext === 'cbz') {
      detectedExt = 'cbz';
      category = 'archive';
      mimeType = 'application/vnd.comicbook+zip';
      formatLabel = 'Comic Book Zip (CBZ)';
    } else {
      detectedExt = 'zip';
      category = 'archive';
      mimeType = 'application/zip';
      formatLabel = 'ZIP Archive';
    }
    confidence = 1.0;
  } else if (matches(0, [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c])) {
    // 7-Zip
    detectedExt = '7z';
    category = 'archive';
    mimeType = 'application/x-7z-compressed';
    formatLabel = '7-Zip Compressed Archive';
    confidence = 1.0;
  } else if (matches(0, [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07])) {
    // RAR
    detectedExt = 'rar';
    category = 'archive';
    mimeType = 'application/x-rar-compressed';
    formatLabel = 'RAR Compressed Archive';
    confidence = 1.0;
  } else if (matches(0, [0x1f, 0x8b, 0x08])) {
    // GZIP
    detectedExt = 'gz';
    category = 'archive';
    mimeType = 'application/gzip';
    formatLabel = 'Gzip Compressed Archive';
    confidence = 1.0;
  } else if (matches(0, [0x42, 0x5a, 0x68])) {
    // BZIP2
    detectedExt = 'bz2';
    category = 'archive';
    mimeType = 'application/x-bzip2';
    formatLabel = 'BZip2 Compressed Archive';
    confidence = 1.0;
  } else if (matches(0, [0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00])) {
    // XZ
    detectedExt = 'xz';
    category = 'archive';
    mimeType = 'application/x-xz';
    formatLabel = 'XZ Compressed Archive';
    confidence = 1.0;
  } else if (matches(0, [0x28, 0xb5, 0x2f, 0xfd])) {
    // Zstandard Frame
    detectedExt = 'zst';
    category = 'archive';
    mimeType = 'application/zstd';
    formatLabel = 'Zstandard Compressed Archive';
    confidence = 1.0;
  } else if (matches(0, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) {
    // Legacy Microsoft Compound Document
    detectedExt = 'doc';
    category = 'document';
    mimeType = 'application/msword';
    formatLabel = 'Legacy Microsoft Office Document';
    confidence = 0.95;
  }

  // 6. DATABASES & AI MODELS
  else if (matchesAscii(0, 'SQLite format 3\0')) {
    detectedExt = 'sqlite';
    category = 'database';
    mimeType = 'application/x-sqlite3';
    formatLabel = 'SQLite 3 Database';
    confidence = 1.0;
  } else if (matchesAscii(0, 'PAR1')) {
    detectedExt = 'parquet';
    category = 'database';
    mimeType = 'application/x-parquet';
    formatLabel = 'Apache Parquet Columnar Data';
    confidence = 1.0;
  } else if (matches(0, [0x47, 0x47, 0x55, 0x46])) {
    detectedExt = 'gguf';
    category = 'model';
    mimeType = 'application/x-gguf';
    formatLabel = 'GGUF AI Language Model';
    confidence = 1.0;
  }

  // 7. STRUCTURED TEXT, CODE & CONFIGURATIONS
  else {
    let printableCount = 0;
    const testLen = Math.min(len, 256);
    for (let i = 0; i < testLen; i++) {
      const b = u8[i];
      if (b === 0x09 || b === 0x0a || b === 0x0d || (b >= 0x20 && b <= 0x7e) || b >= 0xc0) {
        printableCount++;
      }
    }

    const isMostlyText = testLen > 0 && printableCount / testLen >= 0.85;

    if (isMostlyText) {
      if (containsAscii('<svg', 256) || containsAscii('xmlns=http://www.w3.org/2000/svg', 256)) {
        detectedExt = 'svg';
        category = 'image';
        mimeType = 'image/svg+xml';
        formatLabel = 'Scalable Vector Graphics (SVG)';
        confidence = 0.98;
      } else if (containsAscii('<!DOCTYPE html', 128) || containsAscii('<html', 128)) {
        detectedExt = 'html';
        category = 'code';
        mimeType = 'text/html';
        formatLabel = 'HTML Web Document';
        confidence = 0.95;
      } else if (containsAscii('<?xml', 64)) {
        detectedExt = 'xml';
        category = 'code';
        mimeType = 'application/xml';
        formatLabel = 'XML Structured Document';
        confidence = 0.95;
      } else if (containsAscii('{') || containsAscii('[\n') || containsAscii('[{')) {
 detectedExt = 'json';
 category = 'json';
 mimeType = 'application/json';
 formatLabel = 'JSON Data File';
 confidence = 0.9;
 } else if (containsAscii('---') && (containsAscii('apiVersion:') || containsAscii('kind:') || containsAscii('name:'))) {
 detectedExt = 'yaml';
 category = 'code';
 mimeType = 'text/yaml';
 formatLabel = 'YAML Configuration';
 confidence = 0.9;
 } else if (containsAscii('CREATE TABLE') || containsAscii('INSERT INTO') || containsAscii('SELECT ') || containsAscii('-- SQLite')) {
 detectedExt = 'sql';
 category = 'code';
 mimeType = 'application/sql';
 formatLabel = 'SQL Database Script';
 confidence = 0.9;
 } else if (containsAscii('#!/bin/bash') || containsAscii('#!/bin/sh') || containsAscii('#!/usr/bin/env')) {
 detectedExt = 'sh';
 category = 'code';
 mimeType = 'application/x-sh';
 formatLabel = 'Shell Script';
 confidence = 0.95;
 } else if (ext === 'csv' || ext === 'tsv' || containsAscii(',') || containsAscii(',')) {
        detectedExt = ext === 'tsv' ? 'tsv' : 'csv';
        category = 'table';
        mimeType = 'text/csv';
        formatLabel = 'CSV / Delimited Table Data';
        confidence = 0.85;
      } else if (ext === 'log' || containsAscii('[INFO]') || containsAscii('[ERROR]') || containsAscii('[WARN]')) {
        detectedExt = 'log';
        category = 'text';
        mimeType = 'text/plain';
        formatLabel = 'Log Stream File';
        confidence = 0.85;
      } else {
        detectedExt = ext || 'txt';
        category = 'text';
        mimeType = 'text/plain';
        formatLabel = 'Plain Text / Source File';
        confidence = 0.7;
      }
    } else {
      detectedExt = ext || 'bin';
      category = 'unknown';
      mimeType = 'application/octet-stream';
      formatLabel = 'Unknown Binary Data';
      confidence = 0.5;
    }
  }

  // Evaluate extension matching
  const isExtensionMissing = !ext;

  const ZIP_EXTENSIONS = new Set([
    'zip',
    'zipx',
    'docx',
    'docm',
    'dotx',
    'xlsx',
    'xlsm',
    'xltx',
    'pptx',
    'pptm',
    'potx',
    'apk',
    'aab',
    'xapk',
    'jar',
    'war',
    'ear',
    'epub',
    'odt',
    'ods',
    'odp',
    'kmz',
    'cbz',
    'aar',
    'xpi',
  ]);

  const MP4_EXTENSIONS = new Set([
    'mp4',
    'm4v',
    'mov',
    'm4a',
    'm4b',
    'm4p',
    '3gp',
    '3g2',
    'qt',
  ]);

  const MKV_EXTENSIONS = new Set(['mkv', 'webm', 'mka']);
  const RIFF_EXTENSIONS = new Set(['webp', 'wav', 'avi']);
  const TEXT_CATEGORIES = new Set(['text', 'code', 'json', 'table']);

  let isExtensionMatch = false;

  if (isExtensionMissing) {
    isExtensionMatch = false;
  } else if (ext === detectedExt) {
    isExtensionMatch = true;
  } else if (detectedExt === 'jpg' && (ext === 'jpeg' || ext === 'jpe' || ext === 'jfif' || ext === 'jif')) {
    isExtensionMatch = true;
  } else if (detectedExt === 'tif' && ext === 'tiff') {
    isExtensionMatch = true;
  } else if (detectedExt === 'yaml' && ext === 'yml') {
    isExtensionMatch = true;
  } else if (detectedExt === 'htm' && ext === 'html') {
    isExtensionMatch = true;
  } else if (detectedExt === 'svg' && ext === 'svgz') {
    isExtensionMatch = true;
  } else if (ZIP_EXTENSIONS.has(detectedExt) && ZIP_EXTENSIONS.has(ext)) {
    isExtensionMatch = true;
  } else if (MP4_EXTENSIONS.has(detectedExt) && MP4_EXTENSIONS.has(ext)) {
    isExtensionMatch = true;
  } else if (MKV_EXTENSIONS.has(detectedExt) && MKV_EXTENSIONS.has(ext)) {
    isExtensionMatch = true;
  } else if (RIFF_EXTENSIONS.has(detectedExt) && RIFF_EXTENSIONS.has(ext)) {
    isExtensionMatch = true;
  } else if (TEXT_CATEGORIES.has(category)) {
    // For text, code, script, table, json files, avoid false alarms across text-based extensions
    isExtensionMatch = true;
  }

  let severity: MagicSniffResult['severity'] = 'safe';
  if (isSuspiciousExecutable && ext !== 'exe' && ext !== 'dll' && ext !== 'bin') {
    severity = 'danger';
  } else if (!isExtensionMatch && !isExtensionMissing && confidence >= 0.85) {
    severity = 'warning';
  } else if (isExtensionMissing && detectedExt) {
    severity = 'info';
  }

  const suggestedFilename = isExtensionMissing
    ? `${baseName}.${detectedExt}`
    : !isExtensionMatch && detectedExt
    ? `${baseName}.${detectedExt}`
    : currentFilename;

  return {
    detectedExt,
    category,
    mimeType,
    formatLabel,
    isExtensionMatch,
    isExtensionMissing,
    isSuspiciousExecutable,
    severity,
    suggestedFilename,
    confidence,
  };
}
