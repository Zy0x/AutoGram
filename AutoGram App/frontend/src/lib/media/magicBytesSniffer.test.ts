import { describe, it, expect } from 'vitest';
import { sniffMagicBytes } from './magicBytesSniffer';

describe('magicBytesSniffer', () => {
  it('correctly handles Office DOCX in ZIP container without false mismatch', () => {
    // PK\x03\x04 header
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

  it('detects dangerous PE Executable disguised as PNG', () => {
    // MZ header
    const bytes = new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]);
    const result = sniffMagicBytes(bytes, 'invoice_scan.png');

    expect(result.detectedExt).toBe('exe');
    expect(result.category).toBe('executable');
    expect(result.isSuspiciousExecutable).toBe(true);
    expect(result.severity).toBe('danger');
    expect(result.suggestedFilename).toBe('invoice_scan.exe');
  });

  it('detects mismatched MP4 disguised as JPG', () => {
    // ftypisom header (offset 4)
    const bytes = new Uint8Array([0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]);
    const result = sniffMagicBytes(bytes, 'sample_photo.jpg');

    expect(result.detectedExt).toBe('mp4');
    expect(result.category).toBe('video');
    expect(result.isExtensionMatch).toBe(false);
    expect(result.severity).toBe('warning');
    expect(result.suggestedFilename).toBe('sample_photo.mp4');
  });

  it('detects missing extension on raw Telegram cache video', () => {
    // ftypisom header
    const bytes = new Uint8Array([0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]);
    const result = sniffMagicBytes(bytes, '2071942102007885896');

    expect(result.detectedExt).toBe('mp4');
    expect(result.isExtensionMissing).toBe(true);
    expect(result.severity).toBe('info');
    expect(result.suggestedFilename).toBe('2071942102007885896.mp4');
  });
});
