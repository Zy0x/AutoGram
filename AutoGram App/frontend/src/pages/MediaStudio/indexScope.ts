export function isIndexEventForActiveScope(
  eventFolderId: string | number | null | undefined,
  activePeerId: string | number | null | undefined,
  activeTopicId: number | null | undefined
): boolean {
  if (activeTopicId != null) return false;
  return String(eventFolderId || 0) === String(activePeerId || 0);
}

/**
 * A completed checkpoint is only trustworthy while its unique durable row
 * count agrees with Telegram's current candidate count. Rows are deliberately
 * kept when this returns true; only the cursor/checkpoint is reset so a new
 * backfill can upsert/dedupe the existing progress instead of throwing it away.
 */
export function completedIndexNeedsRevalidation(
  backfillComplete: boolean,
  durableUniqueCount: number,
  liveCandidateTotal: number | null | undefined
): boolean {
  if (!backfillComplete || liveCandidateTotal == null) return false;
  const live = Number(liveCandidateTotal);
  if (!Number.isFinite(live) || live < 0) return false;
  return Math.max(0, Math.trunc(durableUniqueCount)) !== Math.trunc(live);
}

/**
 * An open location with a known Telegram total must keep filling its durable
 * index in the background. This deliberately does not require a checkpoint:
 * older builds could persist the first page of rows without ever creating a
 * mediaIndexState record, which left the UI permanently stuck at e.g.
 * 1,726 / 57,055 until the user pressed "Index all" again.
 */
export function partialIndexNeedsAutoResume(
  backfillComplete: boolean,
  durableUniqueCount: number,
  liveCandidateTotal: number | null | undefined
): boolean {
  if (backfillComplete || liveCandidateTotal == null) return false;
  const live = Number(liveCandidateTotal);
  if (!Number.isFinite(live) || live <= 0) return false;
  const durable = Math.max(0, Math.trunc(durableUniqueCount));
  return durable < Math.trunc(live);
}
