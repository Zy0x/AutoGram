/**
 * Pre-flight health for AutoGram remote (CDP + Vite).
 * Vite is hard-required for debug frontend.exe (devUrl localhost:1420).
 * Can auto-start Vite when autoHeal is true.
 */
import { log } from './logger.mjs';
import { ensureVite, probeVite } from './vite_ensure.mjs';

async function fetchOk(url, timeoutMs = 8000) {
  try {
    const res = await Promise.race([
      fetch(url, { cache: 'no-store' }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`timeout ${timeoutMs}ms`)), timeoutMs)
      ),
    ]);
    // Any non-5xx means the server answered
    const ok = typeof res.status === 'number' && res.status > 0 && res.status < 500;
    return { ok, status: res.status };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}

export async function checkHealth(config, opts = {}) {
  const results = [];
  const autoHeal = opts.autoHeal !== false;

  // Vite first — without it debug WebView shows "can't reach this page"
  let vite = await probeVite(config, config.connectTimeoutMs || 8000);
  if (!vite.ok && autoHeal) {
    try {
      await ensureVite(config);
      vite = await probeVite(config, 3000);
    } catch (e) {
      vite = { ok: false, error: String(e?.message || e) };
    }
  }
  results.push({
    id: 'health_vite',
    pass: !!vite.ok,
    detail: vite.ok
      ? `Vite reachable ${vite.origin || config.viteUrl}`
      : vite.error || vite.status || 'Vite down',
  });

  const cdp = await fetchOk(
    `${config.cdpUrl.replace(/\/$/, '')}/json/version`,
    config.connectTimeoutMs || 8000
  );
  results.push({
    id: 'health_cdp',
    pass: cdp.ok,
    detail: cdp.ok ? 'CDP reachable' : cdp.error || cdp.status,
  });

  // Soft resource probe (Node process)
  const mem = process.memoryUsage();
  results.push({
    id: 'health_runner_mem',
    pass: mem.heapUsed < 800 * 1024 * 1024,
    detail: { heapMB: Math.round(mem.heapUsed / 1024 / 1024) },
  });

  const score =
    (results.filter((r) => r.pass).length / Math.max(1, results.length)) * 100;
  log.info('health_score', { score: Math.round(score), results });
  return { score, results };
}

export async function waitForHealthy(config, attempts = 8) {
  let last;
  for (let i = 0; i < attempts; i++) {
    last = await checkHealth(config, { autoHeal: true });
    const viteOk = last.results.find((r) => r.id === 'health_vite')?.pass;
    const cdpOk = last.results.find((r) => r.id === 'health_cdp')?.pass;
    // Both required for a healthy remote session with debug frontend.exe
    if (viteOk && cdpOk) return last;
    // Vite alone is enough for first phase of ensure; CDP may come after frontend start
    if (viteOk && i >= attempts - 2) return last;
    const delay = Math.min(
      config.retry?.maxDelayMs || 5000,
      (config.retry?.baseDelayMs || 400) * Math.pow(2, i)
    );
    log.warn('health_retry', {
      attempt: i + 1,
      delay,
      viteOk: !!viteOk,
      cdpOk: !!cdpOk,
    });
    await new Promise((r) => setTimeout(r, delay));
  }
  return last;
}
