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

## Safety & language

- Prefer **murid** over **siswa** in product copy when Indonesian is used.
- No destructive git/fs operations without explicit user approval.
- Never commit secrets, session files, or API hashes.
