import { describe, it, expect } from 'vitest';
import { sniffMagicBytes } from './magicBytesSniffer';

describe('magicBytesSniffer', () => {
  // 1. OpenXML & ZIP Containers
  it('correctly handles Office DOCX in ZIP container without false mismatch', () => {
    const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x06, 0x00]);
    const result = sniffMagicBytes(bytes, "Artikel 'Ali Ridho.docx");

    expect(result.detectedExt).toBe('docx');
    expect(result.category).toBe('document');
    expect(result.isExtensionMatch).toBe(true);
    expect(result.severity).toBe('safe');
    expect(result.suggestedFilename).toBe("Artikel 'Ali Ridho.docx");
  });

  it('correctly handles Excel XLSX in ZIP container without false mismatch', () => {
    const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x06, 0x00]);
    const result = sniffMagicBytes(bytes, 'Laporan_Keuangan_2026.xlsx');

    expect(result.detectedExt).toBe('xlsx');
    expect(result.category).toBe('table');
    expect(result.isExtensionMatch).toBe(true);
    expect(result.severity).toBe('safe');
  });

  it('correctly handles Android APK in ZIP container without false mismatch', () => {
    const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x06, 0x00]);
    const result = sniffMagicBytes(bytes, 'AutoGram_v3.8.apk');

    expect(result.detectedExt).toBe('apk');
    expect(result.isExtensionMatch).toBe(true);
    expect(result.severity).toBe('safe');
  });

  it('correctly identifies standard ZIP archive', () => {
    const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00]);
    const result = sniffMagicBytes(bytes, 'backup_project.zip');

    expect(result.detectedExt).toBe('zip');
    expect(result.category).toBe('archive');
    expect(result.isExtensionMatch).toBe(true);
    expect(result.severity).toBe('safe');
  });

  // 2. CFBF / OLE2 Legacy Office & Message Containers
  it('correctly handles Legacy Excel XLS in CFBF container without false mismatch', () => {
    // D0 CF 11 E0 A1 B1 1A E1
    const bytes = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
    const result = sniffMagicBytes(bytes, 'Data_Penjualan_2003.xls');

    expect(result.detectedExt).toBe('xls');
    expect(result.category).toBe('table');
    expect(result.isExtensionMatch).toBe(true);
    expect(result.severity).toBe('safe');
  });

  it('correctly handles Outlook MSG in CFBF container without false mismatch', () => {
    const bytes = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
    const result = sniffMagicBytes(bytes, 'Important_Notice.msg');

    expect(result.detectedExt).toBe('msg');
    expect(result.category).toBe('document');
    expect(result.isExtensionMatch).toBe(true);
    expect(result.severity).toBe('safe');
  });

  // 3. TIFF & Camera RAW Formats
  it('correctly handles Sony ARW and Nikon NEF in TIFF container without false mismatch', () => {
    // II*. (0x49 0x49 0x2A 0x00)
    const bytes = new Uint8Array([0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00]);
    const resultSony = sniffMagicBytes(bytes, 'DSC09241.arw');
    expect(resultSony.detectedExt).toBe('arw');
    expect(resultSony.isExtensionMatch).toBe(true);
    expect(resultSony.severity).toBe('safe');

    const resultNikon = sniffMagicBytes(bytes, 'DSC_0042.nef');
    expect(resultNikon.detectedExt).toBe('nef');
    expect(resultNikon.isExtensionMatch).toBe(true);
    expect(resultNikon.severity).toBe('safe');
  });

  // 4. SQLite Databases
  it('correctly handles SQLite Database with .db and .sqlite extension without false mismatch', () => {
    const header = Array.from('SQLite format 3\0').map((c) => c.charCodeAt(0));
    const bytes = new Uint8Array(header);
    const result = sniffMagicBytes(bytes, 'app_database.db');

    expect(result.detectedExt).toBe('db');
    expect(result.category).toBe('database');
    expect(result.isExtensionMatch).toBe(true);
    expect(result.severity).toBe('safe');
  });

  // 5. Typography Fonts
  it('correctly handles WOFF2 and TTF fonts without false mismatch', () => {
    const woff2Header = Array.from('wOF2').map((c) => c.charCodeAt(0));
    const resultWoff2 = sniffMagicBytes(new Uint8Array(woff2Header), 'Inter-Bold.woff2');
    expect(resultWoff2.detectedExt).toBe('woff2');
    expect(resultWoff2.isExtensionMatch).toBe(true);
    expect(resultWoff2.severity).toBe('safe');
  });

  // 6. Security Threat Guard (Disguised Executable)
  it('detects dangerous PE Executable disguised as PNG', () => {
    const bytes = new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]);
    const result = sniffMagicBytes(bytes, 'invoice_scan.png');

    expect(result.detectedExt).toBe('exe');
    expect(result.category).toBe('executable');
    expect(result.isSuspiciousExecutable).toBe(true);
    expect(result.severity).toBe('danger');
    expect(result.suggestedFilename).toBe('invoice_scan.exe');
  });

  // 7. Mismatched Video disguised as Photo
  it('detects mismatched MP4 disguised as JPG', () => {
    const bytes = new Uint8Array([0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]);
    const result = sniffMagicBytes(bytes, 'sample_photo.jpg');

    expect(result.detectedExt).toBe('mp4');
    expect(result.category).toBe('video');
    expect(result.isExtensionMatch).toBe(false);
    expect(result.severity).toBe('warning');
    expect(result.suggestedFilename).toBe('sample_photo.mp4');
  });

  // 8. Missing Extension
  it('detects missing extension on raw Telegram cache video', () => {
    const bytes = new Uint8Array([0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]);
    const result = sniffMagicBytes(bytes, '2071942102007885896');

    expect(result.detectedExt).toBe('mp4');
    expect(result.isExtensionMissing).toBe(true);
    expect(result.severity).toBe('info');
    expect(result.suggestedFilename).toBe('2071942102007885896.mp4');
  });
});
