/** Classify transport metadata, not arbitrary substrings in signed URL queries. */
export function isManifestTransport(format?: { ext?: string; protocol?: string; directUrl?: string } | null): boolean {
  if (!format) return false;
  if (/^(m3u8|mpd)$/i.test(format.ext || '')) return true;
  if (/(?:^|[+_])(m3u8|hls|dash|mpd)(?:$|[+_])/i.test(format.protocol || '')) return true;
  try {
    return /\.(?:m3u8|mpd)(?:\/|$)/i.test(new URL(format.directUrl || '').pathname);
  } catch { return false; }
}
