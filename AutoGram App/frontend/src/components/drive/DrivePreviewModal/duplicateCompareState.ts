export interface DuplicateSlotCandidate {
  id: number;
}

export type DuplicateSplitSlot = 'A' | 'B';

export function shouldLoadSplitPreview(
  kind: string,
  slot: DuplicateSplitSlot,
  activeSlot: DuplicateSplitSlot | null,
  playbackSlot: DuplicateSplitSlot | null
): boolean {
  return kind === 'video' ? playbackSlot === slot : activeSlot === slot;
}

export function chooseInitialDuplicateSlots(
  files: DuplicateSlotCandidate[],
  requestedId: number,
  markedDelete: ReadonlySet<number>
): { aIndex: number; bIndex: number; bEmpty: boolean } {
  if (!files.length) return { aIndex: 0, bIndex: 0, bEmpty: true };

  const smartKeep = files.findIndex((candidate) => !markedDelete.has(candidate.id));
  const aIndex = smartKeep >= 0 ? smartKeep : 0;
  const requestedIndex = files.findIndex((candidate) => candidate.id === requestedId);
  const bIndex =
    requestedIndex >= 0 && requestedIndex !== aIndex
      ? requestedIndex
      : files.findIndex((_, index) => index !== aIndex);

  return {
    aIndex,
    bIndex: bIndex >= 0 ? bIndex : aIndex,
    bEmpty: bIndex < 0,
  };
}

export function nextDistinctDuplicateIndex(
  length: number,
  currentIndex: number,
  otherIndex: number,
  direction: -1 | 1,
  otherSlotEmpty = false
): number | null {
  for (
    let index = currentIndex + direction;
    index >= 0 && index < length;
    index += direction
  ) {
    if (otherSlotEmpty || index !== otherIndex) return index;
  }
  return null;
}
