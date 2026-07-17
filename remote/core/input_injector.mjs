/**
 * High-level input helpers for Playwright page (CDP).
 */
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function click(page, selector, opts = {}) {
  const loc = page.locator(selector).first();
  await loc.click({ force: !!opts.force, timeout: opts.timeout || 10000 });
}

export async function typeText(page, selector, text) {
  const loc = page.locator(selector).first();
  await loc.fill(text);
}

export async function press(page, key) {
  await page.keyboard.press(key);
}

export async function dragFromTo(page, fromBox, toBox, steps = 16) {
  if (!fromBox || !toBox) throw new Error('dragFromTo requires boxes');
  const sx = fromBox.x + fromBox.width / 2;
  const sy = fromBox.y + Math.min(40, fromBox.height / 2);
  const tx = toBox.x + toBox.width / 2;
  const ty = toBox.y + toBox.height / 2;
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  await page.mouse.move(sx + 30, sy + 20, { steps: 8 });
  await sleep(120);
  await page.mouse.move(tx, ty, { steps });
  await sleep(200);
  // re-snap optional
  await page.mouse.up();
}

export async function pointerDragKeys(page, fromSel, destKey, map) {
  // Prefer a visible card/list item with non-zero box
  const candidates = page.locator(fromSel);
  const n = await candidates.count();
  let box = null;
  let card = candidates.first();
  for (let i = 0; i < Math.min(n, 8); i++) {
    const c = candidates.nth(i);
    const b = await c.boundingBox().catch(() => null);
    if (b && b.width > 20 && b.height > 20) {
      box = b;
      card = c;
      break;
    }
  }
  if (!box) throw new Error('source box missing');

  // Ensure sections open
  await page.evaluate(() => {
    document.querySelectorAll('.td-section-toggle').forEach((btn) => {
      if (btn.getAttribute('aria-expanded') === 'false') btn.click();
    });
  });
  await sleep(300);

  const dest = await page.evaluate((key) => {
    const pick = (sel) => {
      const nodes = [...document.querySelectorAll(sel)];
      for (const el of nodes) {
        if (el.closest('.td-recents')) continue;
        if (el.classList.contains('dnd-self') || el.getAttribute('data-drop-invalid') === '1')
          continue;
        const r = el.getBoundingClientRect();
        if (r.height < 10 || r.width < 20) continue;
        return {
          key: el.getAttribute('data-drop-key'),
          x: r.x + r.width / 2,
          y: r.y + r.height / 2,
        };
      }
      return null;
    };
    if (key) return pick(`[data-drop-key="${key}"]`);
    return (
      pick('[data-drop-key^="drive:"]:not(.active)') ||
      pick('[data-drop-key^="chat:"]:not(.active)') ||
      pick('[data-drop-key="saved:me"]')
    );
  }, destKey || null);

  if (!dest) throw new Error('no drop destination');

  const sx = box.x + box.width / 2;
  const sy = box.y + 36;
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  await page.mouse.move(sx + 40, sy + 30, { steps: 12 });
  await sleep(180);
  await page.mouse.move(dest.x, dest.y, { steps: 18 });
  await sleep(180);
  // live re-snap
  const live = await page.evaluate((key) => {
    const el = document.querySelector(`[data-drop-key="${key}"]`);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }, dest.key);
  if (live) await page.mouse.move(live.x, live.y, { steps: 4 });
  await sleep(200);
  const hover = await page.evaluate(
    () => document.querySelector('.is-drop-over')?.getAttribute('data-drop-key') || null
  );
  await page.mouse.up();
  await sleep(1000);
  return { destKey: dest.key, hover };
}
