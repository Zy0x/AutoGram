# AutoGram Project Rules

Grok project instructions for the AutoGram monorepo. Skills live in `.agents/skills/`; use them actively.

## Root & layout

- **App root:** `AutoGram App/` is the main application. New features, bug fixes, and architecture work go there.
- **Live UI/desktop:** `AutoGram App/frontend/` (React + Tauri). Prefer this over any outer `src/` shell.
- **Do not reintroduce bloat:** no committing `target/`, `node_modules/`, `worker/venv/`, CDP probe scripts, remote screenshots, or historical `archive/` packs.
- **Skills pack:** `.agents/skills/` and `.agents/AGENTS.md` are agent tooling; keep in sync with this file when rules change.

## Architecture (Tauri + React + Rust) — Grammers-only MTProto

| Layer | Stack | Responsibility |
|-------|--------|----------------|
| Frontend (UI) | React, TypeScript, TailwindCSS | UI only — never call Telegram API directly |
| Core (desktop) | **Rust** via Tauri | Full backend: secrets, path policy, streaming, Drive/Studio MTProto via **Grammers** |
| Telegram MTProto | **Grammers (Rust)** only | Auth, Drive list/CRUD/thumbs/preview, studio upload — **no Telethon runtime** |

See `AutoGram App/docs/architecture/RUST_GRAMMERS_BACKEND.md`. Legacy hybrid notes: `HYBRID_RUST_PYTHON.md` (historical).

## Database

- **Phase 1 (desktop offline):** SQLite. Prefer schemas under `AutoGram App/database/` (migrations + `schema.sql`).
- **Phase 2 (online):** Supabase when integrating cloud — use `supabase-safe-change` / `supabase-schema-manager` skills.

## Telegram / Telethon

- Always apply **Smart Rate Controller** behavior: handle `FloodWaitError`, back off, and reduce upload speed.
- Treat `*.session` files and API hash/secrets as highly sensitive — never log or print them.
- Prefer encrypting session material at rest.
- Use skill **`telethon-best-practices`** for any Telegram feature work.

## Duplicate prevention

Clean-copy transfers must check duplication at four levels: Message ID, Telegram Unique ID, SHA256 hash, Filename+Size.

## Default workflows (skills)

### Vague or incomplete prompt
Activate **`prompt-to-spec-orchestrator`** first. Do not start coding from a fuzzy prompt. Produce intent, scope, acceptance criteria, assumptions, risks, and an execution plan.

### New feature
1. `codebase-cartographer`
2. `feature-planning-architect`
3. Implement
4. `implementation-quality-gate`
5. `regression-test-planner`

### Hard bug
1. `bug-fix-loop-investigator`
2. `root-cause-debugger`
3. `agent-task-memory-log` (persist attempts on long loops)
4. `implementation-quality-gate`

### Frontend / mobile UI
- `taste-skill` (anti-slop UI design), `redesign-skill`, `minimalist-skill`, `brutalist-skill`, `soft-skill`, `gpt-tasteskill`, `react-refactor-safe`, `ui-polish-mobile`, `scroll-touch-debugger`, `performance-audit` as relevant.

### Deploy / Netlify
- `netlify-deploy-debug` when build/deploy fails.

### Commits
- `conventional-commit` for commit message style when committing.

## Done criteria

Do not claim done until:

- Behavior is verified (manual or automated)
- Build / lint / tests run when available for touched areas
- Regression risk is considered
- Summary of changes is honest (what changed, what was not done)

## Internationalization & Locale Management (Mandatory)

- **100% Zero Hardcoded Strings Rule:** Every new feature, page, modal, component, toolbar, tooltip, placeholder, dialog, toast, notification, or UI element **MUST** extract all user-facing text into `i18n` locale files (`src/locales/id/*.json` & `src/locales/en/*.json`).
- **No Hardcoded Text:** Hardcoding user-facing strings directly in `.tsx` / `.ts` files (in either Indonesian or English) is strictly prohibited.
- **100% Key Parity:** Every key added to `id/*.json` MUST immediately have an identical matching key in `en/*.json`.
- **Hook Pattern:** Always consume translations via `const { t } = useTranslation();` from `react-i18next`.

## Remote E2E & Executable Desktop Control Standard (Mandatory)

When asked to perform "remote", remote testing, live inspection, or UI automation on AutoGram, agents **MUST** target the actual running native desktop executable (`frontend.exe`) via CDP (Chrome DevTools Protocol) over WebView2 on port **9230**, **NEVER** a standalone browser or mock web environment.

### 1. Seamless Live Attach Priority (Zero Interruption Rule)
- **Port 9230 Detection:** Always verify whether port 9230 is open (e.g. when app is running via `Buka_AutoGram_LiveDev.bat`).
- **Direct Attach:** When port 9230 is active, **DIRECTLY ATTACH** using Playwright CDP without restarting or launching separate browser instances:
  ```js
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9230');
  const context = browser.contexts()[0] || browser;
  const page = context.pages()[0] || (await context.newPage());
  ```
- **Strictly Prohibited:**
  - NEVER call `Stop-Process`, `child.kill()`, or terminate the user's running `frontend.exe`.
  - NEVER kill or close the active native window. When finishing automation, calling `await browser.close()` only disconnects the CDP WebSocket client connection; keep the user's live window open and running.
  - The user's live desktop window must remain open, focused, and uninterrupted at all times.

### 2. Interactive Live UI Control Capabilities
Agents are empowered and expected to programmatically operate the live desktop application in real-time in front of the user:
- **Navigation & Tabs:** Switch between Drive Explorer, Media Studio, Forwarder Workspace, Transfer Queue, Settings, and Accounts.
- **Interactions:** Click buttons, open dropdowns, filter media, toggle selection checkmarks, double-click to open folders/modals, fill inputs, and test hotkeys (`Esc`, `Ctrl+A`, `Ctrl+V`, `Delete`, `Space`).
- **Inspection & Diagnostics:** Read DOM elements, evaluate React state / Zustand stores, inspect IndexedDB / SQLite state, and capture console logs / network requests live.
- **Verification:** Confirm visual state, badge styling, modal open/close states, and layout responsiveness without requiring manual user intervention.

### 3. Strict Agent Script Execution Timeout (Anti-Hanging Protection)
- **Mandatory Hard Exit Timer:** Every test script, node probe, CDP script, or subprocess run by agents MUST include a hard exit timeout:
  ```js
  setTimeout(() => {
    console.log('[AGENT_PROBE_TIMEOUT] Exiting cleanly.');
    process.exit(0);
  }, 10000);
  ```
- **No Open Listeners:** Never leave unhandled event listeners, unresolved promises, or persistent intervals that prevent node scripts from exiting.
- **Task Management:** Proactively check background tasks with `manage_task` and clean up any finished probes to prevent orphan background processes.

### 4. Standard Remote Probe Template
```js
import { chromium } from 'playwright';

(async () => {
  const timer = setTimeout(() => {
    console.error('Probe timeout reached. Exiting.');
    process.exit(0);
  }, 10000);

  try {
    const browser = await chromium.connectOverCDP('http://127.0.0.1:9230');
    const page = browser.contexts()[0]?.pages()[0];
    if (!page) throw new Error('No active desktop page found on CDP port 9230');

    // Perform live action or inspection here:
    const title = await page.title();
    console.log('Connected to AutoGram Desktop:', title);

    // Disconnect CDP WebSocket cleanly without closing app
    await browser.close();
  } catch (err) {
    console.error('CDP Probe Error:', err.message);
  } finally {
    clearTimeout(timer);
    process.exit(0);
  }
})();
```

## Safety & language

- Prefer **murid** over **siswa** in product copy when Indonesian is used.
- No destructive git/fs operations without explicit user approval.
- Never commit secrets, session files, or API hashes.
