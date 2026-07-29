/** Limit concurrent thumbnail fetches to reduce Telegram FloodWait. */
const MAX = 3;
let active = 0;
const waiters: Array<() => void> = [];

function pump() {
  while (active < MAX && waiters.length) {
    const next = waiters.shift();
    if (next) next();
  }
}

export async function withThumbSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (active >= MAX) {
    await new Promise<void>((resolve) => waiters.push(resolve));
  }
  active++;
  try {
    return await fn();
  } finally {
    active--;
    pump();
  }
}
