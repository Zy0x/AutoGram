export function reconcileFilteredTotal(
  filter: string,
  reportedTotal: number | null | undefined,
  loadedUnique: number,
): number {
  const reported = Number(reportedTotal);
  const safeReported = Number.isFinite(reported) && reported >= 0 ? reported : 0;
  // Telegram sticker and pinned/favorites lanes may report provisional/slice counts.
  // Preserve that exact loaded lower bound instead of letting a provisional zero hide real cards.
  if (filter === 'stickers' || filter === 'favorites') return Math.max(safeReported, loadedUnique);
  return reportedTotal == null ? loadedUnique : safeReported;
}
