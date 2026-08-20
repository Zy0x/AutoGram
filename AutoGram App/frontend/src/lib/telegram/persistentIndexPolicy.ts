/**
 * Decide whether an empty Telegram head response is authoritative enough to
 * replace a durable local index. Restricted/unavailable peers can still have
 * a valid persisted index; a verified exact zero represents a real deletion.
 */
export function shouldPreservePersistentRows(input: {
  persistentRowCount: number;
  remoteRowCount: number;
  remoteTotalCount?: number | null;
  remoteStatsAccurate?: boolean;
}): boolean {
  if (input.persistentRowCount <= 0 || input.remoteRowCount > 0) return false;
  const exactRemoteEmpty =
    input.remoteStatsAccurate === true && Number(input.remoteTotalCount) === 0;
  return !exactRemoteEmpty;
}
