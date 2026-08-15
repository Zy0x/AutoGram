export type MediaIdentity = { id: number };
export type SizedMediaIdentity = MediaIdentity & { size?: number | null };

/** Number of distinct Telegram messages already present in the UI. */
export function loadedUniqueMediaCount(files: readonly MediaIdentity[]): number {
  return new Set(files.map((file) => Number(file.id)).filter(Number.isFinite)).size;
}

/**
 * Telegram counters and background walks can arrive out of order. A reported
 * total is never allowed to be lower than the unique data already rendered.
 */
export function clampMediaTotal(
  reported: unknown,
  files: readonly MediaIdentity[],
): number | null {
  const loaded = loadedUniqueMediaCount(files);
  if (reported == null) return loaded > 0 ? loaded : null;
  const numeric = Number(reported);
  if (!Number.isFinite(numeric) || numeric < 0) return loaded > 0 ? loaded : null;
  return Math.max(Math.floor(numeric), loaded);
}

export function loadedMediaBytes(files: readonly SizedMediaIdentity[]): number {
  const unique = new Map<number, number>();
  for (const file of files) {
    const id = Number(file.id);
    if (!Number.isFinite(id) || unique.has(id)) continue;
    const size = Number(file.size || 0);
    unique.set(id, Number.isFinite(size) && size > 0 ? size : 0);
  }
  return [...unique.values()].reduce((sum, size) => sum + size, 0);
}

export function clampMediaBytes(
  reported: unknown,
  files: readonly SizedMediaIdentity[],
): number | null {
  const loaded = loadedMediaBytes(files);
  if (reported == null) return loaded > 0 ? loaded : null;
  const numeric = Number(reported);
  if (!Number.isFinite(numeric) || numeric < 0) return loaded > 0 ? loaded : null;
  return Math.max(Math.floor(numeric), loaded);
}
