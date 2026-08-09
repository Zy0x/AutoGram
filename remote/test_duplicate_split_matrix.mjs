import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { connect } from './core/remote_connector.mjs';

const config = JSON.parse(fs.readFileSync(new URL('./config/remote_config.json', import.meta.url), 'utf8'));

async function enterLavenderDrive(page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  while (await page.locator('.drive-preview-modal').count()) {
    const closePreview = page.locator('.drive-preview-modal .drive-preview-close').last();
    if (await closePreview.count()) await closePreview.click({ force: true });
    else await page.keyboard.press('Escape');
    await page.waitForTimeout(150);
  }
  if (await page.locator('.td-tools-panel').count()) await page.locator('.td-tools-close').first().click();
  if (await page.locator('.drive-context-menu').count()) await page.keyboard.press('Escape');
  if (await page.locator('.settings-page').count()) {
    await page.locator('.settings-back-button').click();
    await page.waitForTimeout(500);
  }
  if (await page.locator('.td-explorer').count()) {
    const back = page.locator('.td-rail-back').first();
    if (await back.count()) await back.click();
    await page.waitForTimeout(500);
  }
  await page.locator('button').filter({ hasText: /Open Drives|Cloud Drives|Buka Drive/i }).first().waitFor({ state: 'visible', timeout: 45_000 });

  const opened = await page.evaluate(() => {
    const target = 'lavender';
    for (const button of document.querySelectorAll('button')) {
      if (!/open drives|cloud drives|buka drive/i.test(button.textContent || '')) continue;
      let owner = button;
      for (let depth = 0; owner && depth < 8; depth += 1, owner = owner.parentElement) {
        const driveButtons = [...owner.querySelectorAll('button')]
          .filter((item) => /open drives|cloud drives|buka drive/i.test(item.textContent || ''));
        if ((owner.textContent || '').toLowerCase().includes(target) && driveButtons.length === 1) {
          button.click();
          return true;
        }
      }
    }
    return false;
  });
  if (!opened) throw new Error('Lavender Drive launcher card was not found.');
  await page.locator('.td-explorer').waitFor({ state: 'visible', timeout: 45_000 });
}

async function openGudangDuplicates(page) {
  const gudang = page.locator('.td-folder-row[data-peer-id="-1002359408677"]').filter({ hasText: /#Gudang/i }).first();
  await gudang.waitFor({ state: 'visible', timeout: 45_000 });
  await gudang.click();
  await page.waitForTimeout(1_500);

  const tools = page.locator('button[aria-label="Drive Tools & Settings"], button[aria-label="Alat & Pengaturan Drive"]').first();
  await tools.waitFor({ state: 'visible', timeout: 30_000 });
  await tools.click();
  await page.locator('.td-tools-panel').waitFor({ state: 'visible', timeout: 30_000 });

  const duplicateTab = page.locator('.td-tools-sidebar-tab').filter({ hasText: /Duplicates|Duplikat/i }).first();
  if (await duplicateTab.count()) await duplicateTab.click();
  const rows = page.locator('.td-tools-dup-row.is-clickable');
  await rows.first().waitFor({ state: 'visible', timeout: 45_000 });
  await rows.first().click();
  await page.locator('.drive-preview-modal.is-split-compare').waitFor({ state: 'visible', timeout: 45_000 });
}

async function rect(locator) {
  return locator.evaluate((element) => {
    const value = element.getBoundingClientRect();
    return { x: value.x, y: value.y, width: value.width, height: value.height };
  });
}

async function splitState(page) {
  return page.evaluate(() => {
    const title = (slot) => document.querySelector(`.drive-preview-split-col.is-slot-${slot} .drive-preview-card-title`)?.getAttribute('title') || '';
    return {
      a: title('a'),
      b: title('b'),
      activeA: document.querySelector('.drive-preview-split-col.is-active-card-a') !== null,
      activeB: document.querySelector('.drive-preview-split-col.is-active-card-b') !== null,
      splitRatio: getComputedStyle(document.querySelector('.drive-preview-split-panes')).getPropertyValue('--split-a').trim(),
    };
  });
}

async function verifySplit(page) {
  const modal = page.locator('.drive-preview-modal.is-split-compare');
  const panes = modal.locator('.drive-preview-split-panes');
  const sidebar = modal.locator('.drive-preview-dup-sidebar');
  const slotA = modal.locator('.drive-preview-split-col.is-slot-a');
  const slotB = modal.locator('.drive-preview-split-col.is-slot-b');
  const sideCards = modal.locator('.drive-dup-sidebar-card');

  const initial = await splitState(page);
  const desktop = { panes: await rect(panes), sidebar: await rect(sidebar) };

  await slotA.locator('.drive-preview-split-media-wrap').click({ position: { x: 10, y: 10 } });
  const afterActivate = await splitState(page);

  const aTitle = initial.a;
  await slotA.locator('.drive-dup-btn-delete').click();
  await page.waitForTimeout(250);
  const discarded = {
    buttonSelected: await slotA.locator('.drive-dup-btn-delete.is-selected').count() === 1,
    sideCardDiscarded: false,
  };
  discarded.sideCardDiscarded = await sideCards.evaluateAll((cards, title) => {
    const card = cards.find((element) => element.querySelector('.drive-dup-sidebar-name')?.getAttribute('title') === title);
    return card?.classList.contains('is-discarded') === true;
  }, aTitle);
  await slotA.locator('.drive-dup-btn-keep').click();
  await page.waitForTimeout(250);
  const kept = {
    buttonSelected: await slotA.locator('.drive-dup-btn-keep.is-selected').count() === 1,
    sideCardKept: await sideCards.evaluateAll((cards, title) => {
      const card = cards.find((element) => element.querySelector('.drive-dup-sidebar-name')?.getAttribute('title') === title);
      return card?.classList.contains('is-kept') === true;
    }, aTitle),
  };

  const divider = modal.locator('.drive-preview-split-divider');
  const ratioBefore = (await splitState(page)).splitRatio;
  await divider.focus();
  await page.keyboard.press('ArrowLeft');
  const ratioAfter = (await splitState(page)).splitRatio;

  let dragDrop = { attempted: false, changed: false, distinct: true };
  if (await sideCards.count() > 2) {
    const before = await splitState(page);
    await sideCards.nth(2).dragTo(slotB);
    await page.waitForTimeout(250);
    const after = await splitState(page);
    dragDrop = { attempted: true, changed: before.b !== after.b, distinct: after.a !== after.b };
  }

  await modal.locator('.drive-preview-dup-sidebar-list').evaluate((element) => {
    element.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1 }));
  });
  const afterBlank = await splitState(page);

  await page.setViewportSize({ width: 760, height: 900 });
  await page.waitForTimeout(350);
  const mobile = {
    panes: await rect(panes),
    sidebar: await rect(sidebar),
    slotA: await rect(slotA),
    slotB: await rect(slotB),
  };
  await page.setViewportSize({ width: 1440, height: 900 });

  return {
    initial,
    desktop,
    afterActivate,
    discarded,
    kept,
    divider: { ratioBefore, ratioAfter },
    dragDrop,
    afterBlank,
    mobile,
    assertions: {
      distinctInitialFiles: Boolean(initial.a && initial.b && initial.a !== initial.b),
      desktopSidebarAtRight: desktop.sidebar.x > desktop.panes.x + desktop.panes.width - 2,
      activationWorks: afterActivate.activeA,
      keepDeleteStateWorks: discarded.buttonSelected && discarded.sideCardDiscarded && kept.buttonSelected && kept.sideCardKept,
      dividerWorks: ratioBefore !== ratioAfter,
      dragDropKeepsSlotsDistinct: dragDrop.distinct,
      blankClearsSelection: !afterBlank.activeA && !afterBlank.activeB,
      mobileSidebarAtBottom: mobile.sidebar.y >= mobile.panes.y + mobile.panes.height - 2,
      mobileSidebarUsesAvailableWidth: mobile.sidebar.width >= mobile.panes.width * 0.95,
      mobilePanesVertical: mobile.slotB.y > mobile.slotA.y,
      noHorizontalOverflow: await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
    },
  };
}

async function verifyPinMenu(page) {
  const gudang = page.locator('.td-folder-row[data-peer-id="-1002359408677"]').filter({ hasText: /#Gudang/i }).first();
  await gudang.waitFor({ state: 'visible', timeout: 30_000 });
  const menu = page.locator('.drive-context-menu');
  for (let attempt = 0; attempt < 3 && !(await menu.count()); attempt += 1) {
    if (attempt === 0) {
      await gudang.click({ button: 'right' });
    } else {
      await gudang.evaluate((element) => {
        const bounds = element.getBoundingClientRect();
        element.dispatchEvent(new MouseEvent('contextmenu', {
          bubbles: true,
          cancelable: true,
          button: 2,
          buttons: 2,
          clientX: bounds.left + Math.min(48, bounds.width / 2),
          clientY: bounds.top + Math.min(24, bounds.height / 2),
        }));
      });
    }
    await page.waitForTimeout(450);
  }
  await menu.waitFor({ state: 'visible', timeout: 10_000 });
  const text = await menu.innerText();
  await page.keyboard.press('Escape');
  return { text, hasPinAction: /Pin(?: this)? location|Unpin(?: this)? location|Sematkan lokasi|Lepas sematan lokasi/i.test(text) };
}

async function main() {
  const connection = await connect(config);
  const { page } = connection;
  page.setDefaultTimeout(30_000);
  try {
    await enterLavenderDrive(page);
    if (process.env.INSPECT_PIN === '1') {
      await page.waitForTimeout(2_000);
      console.log((await page.locator('body').innerText()).slice(0, 1800));
      console.log(JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('[data-peer-id="-1002359408677"]')].map((element) => ({
        className: element.className,
        text: element.textContent?.trim().slice(0, 160),
        visible: Boolean(element.getClientRects().length),
        parentClass: element.parentElement?.className,
        html: element.outerHTML.slice(0, 800),
      }))), null, 2));
      return;
    }
    const pinMenu = await verifyPinMenu(page);
    await openGudangDuplicates(page);
    const split = await verifySplit(page);
    const passed = Object.values(split.assertions).every(Boolean) && pinMenu.hasPinAction;
    const report = { passed, split, pinMenu };
    const output = path.join(os.tmpdir(), 'autogram-duplicate-split-matrix.json');
    fs.writeFileSync(output, JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = passed ? 0 : 2;
  } finally {
    connection.dispose();
  }
}

main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
