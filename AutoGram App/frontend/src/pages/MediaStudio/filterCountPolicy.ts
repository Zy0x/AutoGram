export function reconcileFilteredTotal(
  filter: string,
  reportedTotal: number | null | undefined,
  loadedUnique: number,
): number {
  const reported = Number(reportedTotal);
  const safeReported = Number.isFinite(reported) && reported >= 0 ? reported : 0;
  // Telegram has no dedicated server-side sticker counter. The sticker lane
  // therefore reports a zero/unknown total even when its bounded scan returns
  // authoritative Sticker-attribute rows. Preserve that exact loaded lower
  // bound instead of letting a provisional zero hide real cards.
  if (filter === 'stickers') return Math.max(safeReported, loadedUnique);
  return reportedTotal == null ? loadedUnique : safeReported;
}
