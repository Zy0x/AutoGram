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
  await page.mouse.up();
}

export async function pointerDragKeys(page, fromSel, destKey, map) {
  // Find first visible source card with non-zero bounding box
  const candidates = page.locator(fromSel);
  let box = null;
  for (let i = 0; i < Math.min(await candidates.count(), 8); i++) {
    const b = await candidates.nth(i).boundingBox().catch(() => null);
    if (b && b.width > 20 && b.height > 20) {
      box = b;
      break;
    }
  }
  if (!box) throw new Error('source box missing');

  // Ensure sidebar sections are expanded so drop rows are visible
  await page.evaluate(() => {
    document.querySelectorAll('.td-section-toggle').forEach((btn) => {
      if (btn.getAttribute('aria-expanded') === 'false') btn.click();
    });
  });
  await sleep(300);

  // Find drop destination row
  const dest = await page.evaluate((key) => {
    const pick = (sel) => {
      const nodes = [...document.querySelectorAll(sel)];
      for (const el of nodes) {
        if (el.closest('.td-recents')) continue;
        if (el.classList.contains('dnd-self') || el.getAttribute('data-drop-invalid') === '1') continue;
        const r = el.getBoundingClientRect();
        if (r.height < 10 || r.width < 20) continue;
        return {
          key: el.getAttribute('data-drop-key'),
          x: Math.round(r.left + r.width / 2),
          y: Math.round(r.top + r.height / 2),
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

  // Perform pointer drag from source to destination
  const sx = box.x + box.width / 2;
  const sy = box.y + 36;
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  await page.mouse.move(sx + 40, sy + 30, { steps: 12 });
  await sleep(180);
  await page.mouse.move(dest.x, dest.y, { steps: 18 });

  // live re-snap to final position
  const live = await page.evaluate((key) => {
    const el = document.querySelector(`[data-drop-key="${key}"]`);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  }, dest.key);
  if (live) await page.mouse.move(live.x, live.y, { steps: 4 });
  await sleep(80);

  // Fire synthetic dragenter + repeated dragover to trigger React's onDragEnter/onDragOver
  // which applies is-drop-over class. Pointer events alone don't trigger HTML5 drag events.
  // We also need to satisfy DROP_DRIVE_DWELL_MS=120ms and DROP_SCROLL_GUARD_MS=200ms guards.
  await page.evaluate((key) => {
    const el = document.querySelector(`[data-drop-key="${key}"]`);
    if (!el) return;
    function makeEvt(type) {
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      let dt;
      try {
        dt = new DataTransfer();
        dt.setData('text/plain', 'autogram-drive:{"messageIds":[1],"fromFolderId":null}');
        dt.effectAllowed = 'all';
      } catch (_) { /* DataTransfer constructor not supported — use undefined */ }
      return new DragEvent(type, {
        bubbles: true, cancelable: true,
        dataTransfer: dt,
        clientX: cx, clientY: cy,
      });
    }
    el.dispatchEvent(makeEvt('dragenter'));
    el.dispatchEvent(makeEvt('dragover'));
    // Keep firing dragover every 30ms so hover dwell guard (120ms) is satisfied
    window.__dndDwellInterval = setInterval(() => {
      el.dispatchEvent(makeEvt('dragover'));
    }, 30);
  }, dest.key);

  // Wait 400ms — past DROP_DRIVE_DWELL_MS (120ms) and DROP_SCROLL_GUARD_MS (200ms)
  await sleep(400);

  // Stop dwell interval
  await page.evaluate(() => {
    if (window.__dndDwellInterval) {
      clearInterval(window.__dndDwellInterval);
      window.__dndDwellInterval = null;
    }
  });

  // Read is-drop-over state before releasing
  const hover = await page.evaluate(
    () => document.querySelector('.is-drop-over')?.getAttribute('data-drop-key') || null
  );

  await page.mouse.up();
  await sleep(1000);
  return { destKey: dest.key, hover };
}
