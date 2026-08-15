/**
 * Helper utilities for path handling and sanitization.
 */

export function sanitizePath(pathStr: string): string {
  return pathStr.replace(/\\/g, '/').replace(/\/+/g, '/');
}

export function getFileBasename(pathStr: string): string {
  const clean = sanitizePath(pathStr);
  const idx = clean.lastIndexOf('/');
  return idx >= 0 ? clean.slice(idx + 1) : clean;
}
