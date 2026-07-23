/**
 * Ensure Vite (localhost:1420) is answering HTTP.
 * If down: spawn node vite hidden, wait until ready.
 * Used by remote connector heal + ensure stack so frontend.exe never shows
 * "Hmmm… can't reach this page" for longer than a few seconds.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SUITE_ROOT, LOGS_DIR, ensureDirs } from './paths.mjs';
import { log } from './logger.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function viteOrigin(config) {
  const raw = (config?.viteUrl || 'http://127.0.0.1:1420').replace(/\/$/, '');
  try {
    const u = new URL(raw);
    // Prefer 127.0.0.1 for Windows IPv4 bind consistency
    if (u.hostname === 'localhost') u.hostname = '127.0.0.1';
    return u.origin;
  } catch {
    return 'http://127.0.0.1:1420';
  }
}

export function vitePort(config) {
  try {
    return Number(new URL(viteOrigin(config)).port || 1420);
  } catch {
    return 1420;
  }
}

export async function probeVite(config, timeoutMs = 2500) {
  const primary = viteOrigin(config);
  const fallback = primary.includes('127.0.0.1') ? primary.replace('127.0.0.1', 'localhost') : 'http://127.0.0.1:1420';
  for (const origin of [primary, fallback]) {
    try {
      const res = await Promise.race([
        fetch(`${origin}/`, { cache: 'no-store' }),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error(`timeout ${timeoutMs}ms`)), timeoutMs)
        ),
      ]);
      const ok = typeof res.status === 'number' && res.status > 0 && res.status < 500;
      if (ok) return { ok: true, status: res.status, origin };
    } catch {
      /* try next origin */
    }
  }
  return { ok: false, error: 'fetch failed on 127.0.0.1 and localhost', origin: primary };
}

function frontendRoot() {
  return path.resolve(SUITE_ROOT, '../AutoGram App/frontend');
}

function viteJsPath() {
  return path.join(frontendRoot(), 'node_modules', 'vite', 'bin', 'vite.js');
}

/**
 * Spawn Vite with no console (detached). Logs under reports/logs/.
 * Returns child process or null if already up / cannot start.
 */
export function spawnViteHidden(config) {
  const root = frontendRoot();
  const viteJs = viteJsPath();
  if (!fs.existsSync(viteJs)) {
    throw new Error(`vite.js missing: ${viteJs} — run npm install in AutoGram App/frontend`);
  }
  ensureDirs();
  const port = vitePort(config);
  const outLog = path.join(LOGS_DIR, 'vite-hidden.out.log');
  const errLog = path.join(LOGS_DIR, 'vite-hidden.err.log');
  const out = fs.openSync(outLog, 'a');
  const err = fs.openSync(errLog, 'a');

  const child = spawn(
    process.execPath,
    [viteJs, '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
    {
      cwd: root,
      detached: true,
      stdio: ['ignore', out, err],
      windowsHide: true,
      env: {
        ...process.env,
        // Avoid Vite trying to open a browser
        BROWSER: 'none',
      },
    }
  );
  child.unref();
  log.info('vite_spawned', { pid: child.pid, port, outLog, errLog });
  return child;
}

/**
 * Ensure Vite answers HTTP. Spawns if needed. Throws if still down after wait.
 */
export async function ensureVite(config, opts = {}) {
  // Import pure schedule so cold-start polling matches ensure-remote intent
  const { computePollSchedule, shouldContinuePolling } = await import('./wait_helpers.mjs');
  const maxWaitMs = opts.maxWaitMs ?? 45_000;
  
  let probe = { ok: false };
  for (let i = 0; i < 3; i++) {
    probe = await probeVite(config, opts.probeTimeoutMs ?? 1200);
    if (probe.ok) break;
    if (i < 2) await new Promise((r) => setTimeout(r, 800));
  }

  if (probe.ok) {
    log.info('vite_already_up', { origin: probe.origin, status: probe.status });
    return { started: false, origin: probe.origin };
  }

  log.warn('vite_down_starting', { error: probe.error, origin: probe.origin });
  try {
    spawnViteHidden(config);
  } catch (e) {
    log.fail('vite_spawn', String(e?.message || e));
    throw e;
  }

  const schedule = computePollSchedule(maxWaitMs, {
    initialMs: opts.pollMs ?? 200,
    maxIntervalMs: 700,
    backoff: 1.3,
  });
  let elapsed = 0;
  for (const step of schedule) {
    await new Promise((r) => setTimeout(r, step));
    elapsed += step;
    probe = await probeVite(config, 1000);
    if (!shouldContinuePolling(probe.ok, elapsed, maxWaitMs)) {
      if (probe.ok) {
        log.info('vite_ready', { origin: probe.origin, status: probe.status, elapsedMs: elapsed });
        return { started: true, origin: probe.origin };
      }
      break;
    }
  }

  throw new Error(
    `Vite not ready after ${maxWaitMs}ms on ${viteOrigin(config)}. Check reports/logs/vite-hidden.err.log`
  );
}

/** CLI: node core/vite_ensure.mjs */
const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isMain) {
  const configPath = path.join(SUITE_ROOT, 'config', 'remote_config.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  ensureVite(config)
    .then((r) => {
      console.log(JSON.stringify({ ok: true, ...r }, null, 2));
      process.exit(0);
    })
    .catch((e) => {
      console.error(String(e?.message || e));
      process.exit(1);
    });
}
