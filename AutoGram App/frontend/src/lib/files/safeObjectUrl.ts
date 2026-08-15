/**
 * Safe Object URL helper to prevent memory leaks.
 */

export function createSafeObjectUrl(blob: Blob): string {
  return URL.createObjectURL(blob);
}

export function revokeSafeObjectUrl(url?: string | null): void {
  if (url && url.startsWith('blob:')) {
    URL.revokeObjectURL(url);
  }
}
