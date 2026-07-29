import { describe, it, expect } from 'vitest';
import {
  canPreviewInApp,
  canShowDriveThumb,
  isOfficeDriveFile,
  isPdfDriveFile,
  isTextDriveFile,
  type DriveFile,
} from './driveTypes';

function f(partial: Partial<DriveFile> & { name: string }): DriveFile {
  return {
    id: 1,
    folder_id: null,
    size: 100,
    icon_type: 'document',
    ...partial,
  };
}

describe('document type helpers', () => {
  it('detects PDF', () => {
    expect(isPdfDriveFile(f({ name: 'a.pdf' }))).toBe(true);
    expect(isPdfDriveFile(f({ name: 'a', mime_type: 'application/pdf' }))).toBe(true);
    expect(isPdfDriveFile(f({ name: 'a.jpg' }))).toBe(false);
  });

  it('detects text/json/code', () => {
    expect(isTextDriveFile(f({ name: 'data.json' }))).toBe(true);
    expect(isTextDriveFile(f({ name: 'notes.txt' }))).toBe(true);
    expect(isTextDriveFile(f({ name: 'app.tsx' }))).toBe(true);
    expect(isTextDriveFile(f({ name: 'main.rs' }))).toBe(true);
    expect(isTextDriveFile(f({ name: 'a.pdf' }))).toBe(false);
  });

  it('detects office', () => {
    expect(isOfficeDriveFile(f({ name: 'doc.docx' }))).toBe(true);
    expect(isOfficeDriveFile(f({ name: 'sheet.xlsx' }))).toBe(true);
    // Office also previewable as extracted text in-app
    expect(isTextDriveFile(f({ name: 'doc.docx' }))).toBe(true);
  });

  it('preview + thumb eligibility', () => {
    expect(canPreviewInApp(f({ name: 'a.pdf' }))).toBe(true);
    expect(canPreviewInApp(f({ name: 'a.json' }))).toBe(true);
    expect(canPreviewInApp(f({ name: 'a.docx' }))).toBe(true);
    expect(canPreviewInApp(f({ name: 'lib.go' }))).toBe(true);
    expect(canShowDriveThumb(f({ name: 'a.pdf' }))).toBe(true);
    // JSON/text use FileTypeIcon on grid — no content-dump thumb
    expect(canShowDriveThumb(f({ name: 'a.json' }))).toBe(false);
    expect(canShowDriveThumb(f({ name: 'a.txt' }))).toBe(false);
    expect(canShowDriveThumb(f({ name: 'a.docx' }))).toBe(false);
  });
});
