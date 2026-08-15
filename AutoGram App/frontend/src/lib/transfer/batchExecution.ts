export async function runWithConcurrency(
  itemCount: number,
  requestedConcurrency: number,
  worker: (index: number) => Promise<void>
): Promise<void> {
  const concurrency = Math.max(1, Math.min(itemCount || 1, Math.trunc(requestedConcurrency) || 1));
  let nextIndex = 0;
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (nextIndex < itemCount) {
        const index = nextIndex;
        nextIndex += 1;
        await worker(index);
      }
    })
  );
}

export function parseBatchPositions(value: string, itemCount: number): number[] {
  const indices = new Set<number>();
  for (const token of value.split(',').map((part) => part.trim()).filter(Boolean)) {
    const match = /^(\d+)(?:\s*-\s*(\d+))?$/.exec(token);
    if (!match) continue;
    const start = Number(match[1]);
    const end = Number(match[2] || match[1]);
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)) continue;
    for (
      let position = Math.max(1, Math.min(start, end));
      position <= Math.min(itemCount, Math.max(start, end));
      position += 1
    ) {
      indices.add(position - 1);
    }
  }
  return [...indices].sort((a, b) => a - b);
}
