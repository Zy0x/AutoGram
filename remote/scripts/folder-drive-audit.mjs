/**
 * Live CDP audit: Media Studio Drive folder hierarchy & management gaps.
 * Does NOT create/delete folders permanently unless SAFE_MUTATE=1.
 * Never browser.close().
 *
 * node scripts/folder-drive-audit.mjs
 */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('../../AutoGram App/frontend/node_modules/playwright');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(__dirname, '..', 'reports');
const shotDir = path.join(outDir, 'screenshots');
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  fs.mkdirSync(shotDir, { recursive: true });
  const report = {
    ts: new Date().toISOString(),
    stamp,
    ok: false,
    phases: {},
    findings: [],
    gaps: [],
    evidence: {},
  };

  const add = (sev, area, msg, extra = {}) => {
    report.findings.push({ sev, area, msg, ...extra });
  };

  const b = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const pages = b.contexts().flatMap((c) => c.pages());
  let p =
    pages.find((x) => {
      try {
        return /1420|localhost|tauri/.test(x.url());
      } catch {
        return false;
      }
    }) || pages[0];

  if (!p) {
    report.phases.connect = 'NO_PAGE';
    console.log(JSON.stringify(report, null, 2));
    process.exit(1);
  }

  report.phases.connect = {
    url: p.url(),
    pages: pages.map((x) => {
      try {
        return x.url();
      } catch {
        return '?';
      }
    }),
  };

  // Force Media Studio tab
  await p.evaluate(() => {
    try {
      localStorage.setItem('lastActiveTab', 'speedtest');
    } catch {}
  });

  // Reload to ensure clean state on Media Studio
  try {
    await p.goto('http://localhost:1420/?audit=' + Date.now(), {
      waitUntil: 'domcontentloaded',
      timeout: 45000,
    });
  } catch (e) {
    add('WARN', 'nav', 'goto soft-fail, continue on current page', { err: String(e).slice(0, 120) });
  }
  await sleep(4000);

  // Wait for shell
  let shellOk = false;
  for (let i = 0; i < 30; i++) {
    shellOk = await p.evaluate(() => !!document.querySelector('.td-shell, .td-explorer, .td-page'));
    if (shellOk) break;
    // Maybe still on dashboard — try click Media nav if present
    await p.evaluate(() => {
      const btns = [...document.querySelectorAll('button, a, [role="button"]')];
      for (const b of btns) {
        const t = (b.textContent || '') + (b.getAttribute('title') || '') + (b.getAttribute('aria-label') || '');
        if (/media\s*studio|speed\s*test|drive/i.test(t) && !/folder/i.test(t)) {
          b.click();
          return;
        }
      }
    });
    await sleep(500);
  }
  report.phases.shell = shellOk;
  if (!shellOk) {
    add('FAIL', 'shell', 'Media Studio shell not found after navigation');
    const body = await p.evaluate(() => (document.body?.innerText || '').slice(0, 800));
    report.evidence.bodyHead = body;
    await p.screenshot({ path: path.join(shotDir, `${stamp}_no_shell.png`), fullPage: true }).catch(() => {});
    fs.writeFileSync(path.join(outDir, `folder_drive_audit_${stamp}.json`), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
    process.exit(2);
  }

  await sleep(2500);

  // Expand drive sections
  await p.evaluate(() => {
    for (const t of document.querySelectorAll('.td-section-toggle')) {
      if (t.getAttribute('aria-expanded') === 'false') t.click();
    }
  });
  await sleep(600);

  const snap = await p.evaluate(() => {
    const text = document.body?.innerText || '';
    const q = (s) => document.querySelector(s);
    const qa = (s) => [...document.querySelectorAll(s)];

    const folderRows = qa('.td-folder-row, [data-drop-key^="drive:"]').map((el) => {
      const style = getComputedStyle(el);
      const pl = parseFloat(style.paddingLeft) || 0;
      return {
        text: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80),
        dropKey: el.getAttribute('data-drop-key') || null,
        paddingLeft: pl,
        className: (el.className || '').toString().slice(0, 120),
        hasTreeToggle: !!el.querySelector('.td-folder-tree-toggle'),
        treeExpanded: el.querySelector('.td-folder-tree-toggle')?.getAttribute('aria-expanded') || null,
        isNested: (el.className || '').includes('is-nested'),
        active: (el.className || '').includes('active'),
      };
    });

    const treeToggles = qa('.td-folder-tree-toggle').map((b) => ({
      aria: b.getAttribute('aria-expanded'),
      label: b.getAttribute('aria-label'),
    }));

    const toolbarBtns = qa('button.td-rail-btn, .td-sidebar button, .td-folder-nav button')
      .map((b) => (b.getAttribute('title') || b.getAttribute('aria-label') || b.textContent || '').replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .slice(0, 40);

    const createBtns = qa('button').filter((b) => {
      const t = (b.textContent || '') + (b.getAttribute('aria-label') || '') + (b.getAttribute('title') || '');
      return /\+\s*folder|\+\s*sub|buat\s*folder|buat\s*subfolder|folder\s*\[td\]/i.test(t);
    }).map((b) => ({
      text: (b.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40),
      aria: b.getAttribute('aria-label'),
      title: b.getAttribute('title'),
      disabled: b.disabled,
    }));

    // Context menu items if open (won't be yet)
    return {
      url: location.href,
      title: document.title,
      connected: /Drive terhubung/i.test(text),
      connText: q('.td-conn')?.textContent?.trim() || null,
      sessionSelect: q('select')?.value || null,
      sessionOptions: qa('select option').map((o) => o.textContent?.trim()).filter(Boolean).slice(0, 10),
      folderCountBadge: qa('.td-section-toggle').find((t) => /drive/i.test(t.textContent || ''))?.textContent?.replace(/\s+/g, ' ').trim() || null,
      folderRows,
      treeToggles,
      createBtns,
      toolbarBtns,
      hasExplorer: !!q('.td-explorer, .td-file-grid, .td-file-list'),
      fileCards: qa('.td-file-card, .td-file-list-item').length,
      breadcrumb: (text.match(/Start\s*\/[^\n]{0,80}/) || [])[0] || q('.td-breadcrumb, .td-path')?.textContent?.trim() || null,
      errorBanner: q('.td-error-banner, [role="alert"]')?.textContent?.trim()?.slice(0, 200) || null,
      statusFoot: q('.td-status-foot')?.textContent?.trim()?.slice(0, 150) || null,
      hasRenameFolderUi: /rename\s*folder|ganti\s*nama\s*folder|rename\s*folder/i.test(text),
      hasMoveFolderUi: /pindah\s*folder|move\s*folder|ubah\s*induk|reparent/i.test(text),
      bodyHints: {
        folderInFolder: /folder\s*in\s*folder|subfolder/i.test(text),
        tdTag: /\[TD\]/i.test(text),
        saved: /Saved Messages|Pesan tersimpan/i.test(text),
      },
      sectionToggles: qa('.td-section-toggle').map((t) => ({
        text: (t.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60),
        expanded: t.getAttribute('aria-expanded'),
      })),
    };
  });

  report.evidence.snap = snap;
  report.phases.connected = snap.connected;

  if (!snap.connected) {
    add('WARN', 'session', 'Drive belum terhubung — coba tunggu/bootstrap session');
    // Wait longer for auto-connect
    for (let i = 0; i < 20; i++) {
      await sleep(1000);
      const c = await p.evaluate(() => /Drive terhubung/i.test(document.body?.innerText || ''));
      if (c) {
        report.phases.connected = true;
        add('INFO', 'session', `Drive terhubung setelah +${i + 1}s`);
        break;
      }
    }
  } else {
    add('INFO', 'session', 'Drive terhubung');
  }

  // Re-snap folders after possible connect
  await sleep(1500);
  await p.evaluate(() => {
    for (const t of document.querySelectorAll('.td-section-toggle')) {
      if (t.getAttribute('aria-expanded') === 'false' && /drive/i.test(t.textContent || '')) t.click();
    }
  });
  await sleep(800);

  const foldersLive = await p.evaluate(() => {
    const qa = (s) => [...document.querySelectorAll(s)];
    const rows = qa('.td-folder-row, [data-drop-key^="drive:"]').map((el) => {
      const style = getComputedStyle(el);
      return {
        text: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 100),
        dropKey: el.getAttribute('data-drop-key') || null,
        paddingLeft: parseFloat(style.paddingLeft) || 0,
        isNested: (el.className || '').includes('is-nested'),
        hasTreeToggle: !!el.querySelector('.td-folder-tree-toggle'),
        treeExpanded: el.querySelector('.td-folder-tree-toggle')?.getAttribute('aria-expanded') || null,
        active: (el.className || '').includes('active'),
      };
    });
    const depths = new Set(rows.map((r) => r.paddingLeft));
    const nestedCount = rows.filter((r) => r.isNested || r.paddingLeft > 20).length;
    const withToggle = rows.filter((r) => r.hasTreeToggle).length;
    return {
      rows,
      total: rows.length,
      uniquePaddingLeft: [...depths].sort((a, b) => a - b),
      nestedCount,
      withToggle,
      looksHierarchical: nestedCount > 0 || withToggle > 0 || depths.size > 1,
    };
  });
  report.evidence.foldersLive = foldersLive;

  if (foldersLive.total === 0) {
    add('WARN', 'folders', 'Tidak ada Drive folder [TD] di sidebar');
  } else {
    add('INFO', 'folders', `${foldersLive.total} baris folder Drive di sidebar`);
  }

  if (foldersLive.looksHierarchical) {
    add('INFO', 'tree', 'UI menampilkan indikasi hierarki (indent / nested / tree toggle)');
  } else {
    add('WARN', 'tree', 'Semua folder tampak flat (tidak ada indent nested / tree toggle) — parent_id mungkin kosong atau belum ada subfolder');
    report.gaps.push({
      id: 'TREE_FLAT_LIVE',
      severity: 'medium',
      msg: 'Live session: folder list flat. Bisa berarti (a) belum ada subfolder, atau (b) parent_id tidak ter-resolve dari about channel.',
    });
  }

  // Context menu on first drive folder
  let contextMenu = null;
  if (foldersLive.total > 0) {
    const box = await p.evaluate(() => {
      const el =
        document.querySelector('[data-drop-key^="drive:"]') ||
        document.querySelector('.td-folder-row');
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.left + Math.min(40, r.width / 2), y: r.top + r.height / 2, text: (el.textContent || '').trim().slice(0, 60) };
    });
    if (box) {
      await p.mouse.click(box.x, box.y, { button: 'right' });
      await sleep(400);
      contextMenu = await p.evaluate(() => {
        const menu = document.querySelector('.drive-context-menu, [class*="context-menu"], [role="menu"]');
        if (!menu) {
          // try any portal panel
          const panels = [...document.querySelectorAll('div')].filter((d) => {
            const t = d.textContent || '';
            return (
              d.childElementCount > 2 &&
              d.childElementCount < 30 &&
              /hapus|subfolder|buka|salin|refresh|folder/i.test(t) &&
              d.getBoundingClientRect().width > 80 &&
              d.getBoundingClientRect().width < 400
            );
          });
          const m = panels[0];
          if (!m) return { open: false };
          return {
            open: true,
            via: 'heuristic',
            items: [...m.querySelectorAll('button, [role="menuitem"], .drive-menu-item')]
              .map((b) => (b.textContent || '').replace(/\s+/g, ' ').trim())
              .filter(Boolean),
            text: (m.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 400),
          };
        }
        return {
          open: true,
          via: 'selector',
          items: [...menu.querySelectorAll('button, [role="menuitem"], .drive-menu-item, li')]
            .map((b) => (b.textContent || '').replace(/\s+/g, ' ').trim())
            .filter(Boolean),
          text: (menu.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 400),
        };
      });
      report.evidence.contextMenu = { target: box.text, ...contextMenu };

      if (contextMenu?.open) {
        add('INFO', 'context-menu', `Menu folder terbuka (${contextMenu.items?.length || 0} item)`);
        const joined = (contextMenu.items || []).join(' | ').toLowerCase() + ' ' + (contextMenu.text || '').toLowerCase();
        const hasCreateSub = /subfolder|sub\s*folder|\+\s*sub|buat sub/i.test(joined);
        const hasDelete = /hapus|delete/i.test(joined);
        const hasRename = /rename|ganti nama|ubah nama/i.test(joined) && /folder/i.test(joined);
        const hasRenameAny = /rename|ganti nama|ubah nama/i.test(joined);
        const hasMoveFolder = /pindah folder|move folder|ubah induk|pindahkan ke/i.test(joined);
        const hasOpen = /buka|open/i.test(joined);

        if (hasCreateSub) add('PASS', 'menu', 'Ada aksi buat subfolder');
        else {
          add('GAP', 'menu', 'Tidak terlihat aksi buat subfolder di context menu folder');
          report.gaps.push({ id: 'MENU_NO_CREATE_SUB', severity: 'high', msg: 'Context menu folder tanpa create subfolder' });
        }
        if (hasDelete) add('PASS', 'menu', 'Ada aksi hapus folder');
        else {
          add('GAP', 'menu', 'Tidak terlihat hapus folder');
          report.gaps.push({ id: 'MENU_NO_DELETE', severity: 'medium', msg: 'Context menu tanpa hapus folder' });
        }
        if (hasRename || hasRenameAny) {
          // rename on location menu would be folder rename; file rename is different
          if (hasRename) add('PASS', 'menu', 'Ada rename folder');
          else add('INFO', 'menu', 'Ada teks rename tapi mungkin generic — cek manual');
        } else {
          add('GAP', 'menu', 'Tidak ada Rename folder di context menu lokasi');
          report.gaps.push({
            id: 'NO_RENAME_FOLDER',
            severity: 'high',
            msg: 'Tidak ada UI rename folder (hanya file rename di codebase)',
          });
        }
        if (hasMoveFolder) add('PASS', 'menu', 'Ada pindah/reparent folder');
        else {
          add('GAP', 'menu', 'Tidak ada Move/Reparent folder');
          report.gaps.push({
            id: 'NO_REPARENT_FOLDER',
            severity: 'high',
            msg: 'Tidak bisa mengubah parent folder yang sudah ada',
          });
        }
        if (hasOpen) add('PASS', 'menu', 'Ada buka lokasi');
      } else {
        add('WARN', 'context-menu', 'Context menu tidak terbuka setelah right-click folder');
      }

      await p.keyboard.press('Escape');
      await sleep(200);
    }
  }

  // Toolbar create buttons
  const createBtns = await p.evaluate(() => {
    return [...document.querySelectorAll('button')]
      .filter((b) => {
        const t = `${b.textContent || ''} ${b.getAttribute('aria-label') || ''} ${b.getAttribute('title') || ''}`;
        return /\+\s*folder|\+\s*sub|buat folder|buat subfolder|folder \[td\]/i.test(t);
      })
      .map((b) => ({
        text: (b.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40),
        aria: b.getAttribute('aria-label'),
        title: (b.getAttribute('title') || '').slice(0, 120),
        disabled: !!b.disabled,
      }));
  });
  report.evidence.createBtns = createBtns;
  if (createBtns.some((b) => /\+?\s*folder/i.test(b.text + b.aria))) {
    add('PASS', 'toolbar', 'Tombol buat folder root ada');
  } else {
    add('GAP', 'toolbar', 'Tombol + Folder tidak ditemukan');
    report.gaps.push({ id: 'NO_CREATE_ROOT_BTN', severity: 'high', msg: 'UI create root folder tidak terlihat' });
  }
  if (createBtns.some((b) => /sub/i.test(b.text + b.aria + b.title))) {
    add('INFO', 'toolbar', 'Tombol/label subfolder terlihat (mungkin hanya saat di dalam folder Drive)');
  }

  // Enter first folder and recheck + Sub
  if (foldersLive.total > 0) {
    await p.evaluate(() => {
      const el =
        document.querySelector('[data-drop-key^="drive:"]') ||
        document.querySelector('.td-folder-row');
      el?.click();
    });
    await sleep(2000);
    const inside = await p.evaluate(() => {
      const text = document.body?.innerText || '';
      const createBtns = [...document.querySelectorAll('button')]
        .filter((b) => {
          const t = `${b.textContent || ''} ${b.getAttribute('aria-label') || ''} ${b.getAttribute('title') || ''}`;
          return /\+|folder|sub/i.test(t);
        })
        .map((b) => ({
          text: (b.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 30),
          aria: b.getAttribute('aria-label'),
          title: (b.getAttribute('title') || '').slice(0, 100),
        }))
        .filter((b) => /folder|sub/i.test(`${b.text} ${b.aria} ${b.title}`))
        .slice(0, 15);
      return {
        breadcrumb: (text.match(/Start\s*\/[^\n]{0,100}/) || [])[0] || null,
        createBtns,
        plusSub: createBtns.some((b) => /\+\s*sub|subfolder/i.test(`${b.text} ${b.aria} ${b.title}`)),
        plusFolder: createBtns.some((b) => /\+\s*folder|buat folder/i.test(`${b.text} ${b.aria}`)),
        status: document.querySelector('.td-status-foot')?.textContent?.trim()?.slice(0, 120) || null,
        fileCount: document.querySelectorAll('.td-file-card, .td-file-list-item').length,
        activeFolder: [...document.querySelectorAll('.td-folder-row.active, [data-drop-key^="drive:"].active')]
          .map((e) => (e.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60))[0] || null,
      };
    });
    report.evidence.insideFolder = inside;
    if (inside.plusSub) add('PASS', 'inside-folder', 'Saat di dalam folder Drive, UI offer subfolder (+ Sub)');
    else add('WARN', 'inside-folder', 'Tidak jelas tombol + Sub saat di dalam folder Drive');
    if (inside.breadcrumb) add('INFO', 'nav', `Breadcrumb: ${inside.breadcrumb}`);
    else {
      add('GAP', 'nav', 'Breadcrumb path nested tidak jelas di UI');
      report.gaps.push({
        id: 'WEAK_BREADCRUMB',
        severity: 'medium',
        msg: 'Navigasi path multi-level folder belum jelas seperti file manager',
      });
    }
  }

  // Search forceFlat behavior
  const searchInput = await p.$('input[type="search"], input[placeholder*="cari" i], input[placeholder*="search" i], .td-search input, input.td-search-input');
  if (searchInput) {
    await searchInput.fill('a');
    await sleep(500);
    const whileSearch = await p.evaluate(() => {
      const rows = [...document.querySelectorAll('.td-folder-row, [data-drop-key^="drive:"]')].map((el) => ({
        pl: parseFloat(getComputedStyle(el).paddingLeft) || 0,
        nested: (el.className || '').includes('is-nested'),
        toggle: !!el.querySelector('.td-folder-tree-toggle'),
      }));
      return {
        count: rows.length,
        anyNested: rows.some((r) => r.nested || r.pl > 22 || r.toggle),
      };
    });
    report.evidence.searchFlat = whileSearch;
    if (whileSearch.count > 0 && !whileSearch.anyNested) {
      add('INFO', 'search', 'Saat search, folder dirender flat (sesuai forceFlat di kode)');
      report.gaps.push({
        id: 'SEARCH_FLATTENS_TREE',
        severity: 'low',
        msg: 'Universal search men-flatten tree — UX sadar trade-off',
      });
    }
    await searchInput.fill('');
    await sleep(300);
  } else {
    add('INFO', 'search', 'Search input tidak ditemukan dengan selector generik');
  }

  // Capability matrix from DOM + known code gaps
  report.capabilityMatrix = {
    list_drive_folders: foldersLive.total > 0 || report.phases.connected,
    tree_ui_present: foldersLive.withToggle > 0 || foldersLive.nestedCount > 0,
    create_root_folder_btn: createBtns.some((b) => /folder/i.test(b.text + (b.aria || ''))),
    create_subfolder_btn_or_menu: !!(
      report.evidence.insideFolder?.plusSub ||
      (contextMenu?.items || []).some((i) => /sub/i.test(i))
    ),
    delete_folder_menu: !!(contextMenu?.items || []).some((i) => /hapus|delete/i.test(i)),
    rename_folder: false, // code+menu gap
    reparent_move_folder: false,
    dnd_folder_reorganize: false,
    cascade_delete: false,
    dnd_files_to_folder: true, // previously verified suite
  };

  // Screenshots
  const shotMain = path.join(shotDir, `${stamp}_folder_audit_main.png`);
  await p.screenshot({ path: shotMain, fullPage: false }).catch(() => {});
  report.evidence.screenshotMain = shotMain;

  // Code-aligned gaps (always document for report)
  const codeGaps = [
    {
      id: 'NO_RENAME_FOLDER_API',
      severity: 'high',
      msg: 'Backend/UI: tidak ada rename folder (hanya rename file)',
      files: ['driveApi.ts', 'drive_fs.py', 'DriveContextMenu.tsx'],
    },
    {
      id: 'NO_REPARENT_API',
      severity: 'high',
      msg: 'Tidak ada API set parent_id / EditChatAbout untuk folder existing',
      files: ['drive_fs.py', 'drive_serve.py', 'driveApi.ts'],
    },
    {
      id: 'NO_FOLDER_DND',
      severity: 'medium',
      msg: 'DnD hanya media files, bukan reorganisasi folder tree',
      files: ['driveDrag.ts', 'DriveSidebar.tsx'],
    },
    {
      id: 'NO_CASCADE_DELETE',
      severity: 'high',
      msg: 'delete_folder hanya 1 channel; children parent_id orphan',
      files: ['drive_fs.py delete_folder_on_client'],
    },
    {
      id: 'NO_BULK_REORG',
      severity: 'medium',
      msg: 'Tidak ada wizard perombakan massal flat → nested tree',
      files: ['—'],
    },
    {
      id: 'CHANNEL_LIMIT',
      severity: 'high',
      msg: '1 subfolder = 1 Telegram channel → ChannelsTooMuch risk',
      files: ['drive_fs.py _friendly_create_channel_error'],
    },
  ];
  for (const g of codeGaps) {
    if (!report.gaps.find((x) => x.id === g.id)) report.gaps.push(g);
  }

  report.ok = report.findings.filter((f) => f.sev === 'FAIL').length === 0;
  report.summary = {
    findings: report.findings.length,
    gaps: report.gaps.length,
    folderRows: foldersLive.total,
    hierarchicalLive: foldersLive.looksHierarchical,
    connected: report.phases.connected === true || snap.connected,
  };

  const outJson = path.join(outDir, `folder_drive_audit_${stamp}.json`);
  const outMd = path.join(outDir, `FOLDER_DRIVE_AUDIT_${stamp}.md`);
  fs.writeFileSync(outJson, JSON.stringify(report, null, 2));

  const md = [
    `# Live CDP Audit — Folder Drive`,
    ``,
    `**Waktu:** ${report.ts}`,
    `**Shell:** ${shellOk} · **Connected:** ${report.summary.connected}`,
    `**Folder rows:** ${foldersLive.total} · **Hierarchical live:** ${foldersLive.looksHierarchical}`,
    ``,
    `## Findings`,
    ...report.findings.map((f) => `- **${f.sev}** [${f.area}] ${f.msg}`),
    ``,
    `## Gaps`,
    ...report.gaps.map((g) => `- \`${g.id}\` (${g.severity}): ${g.msg}`),
    ``,
    `## Capability matrix`,
    '```json',
    JSON.stringify(report.capabilityMatrix, null, 2),
    '```',
    ``,
    `## Screenshot`,
    shotMain,
    ``,
  ].join('\n');
  fs.writeFileSync(outMd, md);

  console.log(JSON.stringify({ ok: report.ok, summary: report.summary, outJson, outMd, shotMain, findings: report.findings, gaps: report.gaps }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
