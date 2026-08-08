import http from 'node:http';
import process from 'node:process';
import WebSocket from 'ws';

const DEFAULT_SESSION = 'Mantan Gadis';
const TARGET_MESSAGE_ID = '81';
const CDP_PORTS = [9225, 9222, 9223, 9224];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function getJson(host, port, path = '/json/list') {
  return new Promise((resolve, reject) => {
    const req = http.get({ host, port, path, timeout: 1_500 }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch (error) {
          reject(new Error(`Invalid CDP JSON from ${host}:${port}: ${error.message}`));
        }
      });
    });
    req.once('error', reject);
    req.once('timeout', () => req.destroy(new Error('CDP request timed out')));
  });
}

async function findAutoGramTarget() {
  for (const port of CDP_PORTS) {
    for (const host of ['127.0.0.1', '::1']) {
      try {
        const targets = await getJson(host, port);
        const target = targets.find((item) =>
          item.type === 'page' && item.url?.startsWith('http://localhost:1420/'));
        if (target?.webSocketDebuggerUrl) return { host, port, target };
      } catch {
        // Try the next endpoint. Google Drive commonly owns :9222 on this workstation.
      }
    }
  }
  throw new Error('AutoGram WebView CDP target was not found. Run remote/ensure-remote.ps1 first.');
}

class CdpClient {
  constructor(url) {
    this.url = url;
    this.nextId = 1;
    this.pending = new Map();
  }

  async connect() {
    this.ws = new WebSocket(this.url);
    this.ws.on('message', (data) => {
      const message = JSON.parse(data.toString());
      if (!message.id) return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result);
    });
    await new Promise((resolve, reject) => {
      this.ws.once('open', resolve);
      this.ws.once('error', reject);
    });
    await this.send('Runtime.enable');
    await this.send('Page.enable');
  }

  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const response = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (response.exceptionDetails) {
      throw new Error(response.exceptionDetails.exception?.description || 'Runtime.evaluate failed');
    }
    return response.result?.value;
  }

  close() {
    this.ws?.close();
  }
}

async function waitFor(client, expression, timeoutMs = 20_000, label = 'condition') {
  const deadline = Date.now() + timeoutMs;
  let lastValue;
  while (Date.now() < deadline) {
    lastValue = await client.evaluate(expression);
    if (lastValue) return lastValue;
    await sleep(250);
  }
  throw new Error(`Timed out waiting for ${label}; last value: ${JSON.stringify(lastValue)}`);
}

async function ensureDriveSession(client, targetSession) {
  await waitFor(
    client,
    `(() => {
      const text = document.body?.innerText?.trim() || '';
      return text.length > 20 && !/^(?:Memuat|Loading) Drives?/i.test(text);
    })()`,
    30_000,
    'initial AutoGram UI',
  );
  const state = await client.evaluate(`(() => ({
    body: document.body.innerText.slice(0, 2_000),
    driveSession: localStorage.getItem('autogram_drive_session'),
    defaultSession: localStorage.getItem('autogram_default_session')
  }))()`);

  const visibleSessionMatches = state.body.toLowerCase().includes(`connected session\n${targetSession.toLowerCase()}`);
  if ((state.driveSession === targetSession || visibleSessionMatches) && !/Session Landing Launcher/i.test(state.body)) {
    return state;
  }

  if (/Session Landing Launcher/i.test(state.body)) {
    const opened = await client.evaluate(`(() => {
      const target = ${JSON.stringify(targetSession)}.toLowerCase();
      for (const button of document.querySelectorAll('button')) {
        if (!/drives/i.test(button.innerText)) continue;
        let owner = button;
        for (let depth = 0; owner && depth < 8; depth += 1, owner = owner.parentElement) {
          const driveButtons = [...owner.querySelectorAll('button')]
            .filter((item) => /drives/i.test(item.innerText));
          if ((owner.innerText || '').toLowerCase().includes(target) && driveButtons.length === 1) {
            button.click();
            return true;
          }
        }
      }
      return false;
    })()`);
    if (!opened) throw new Error(`Launcher card for session ${targetSession} was not found.`);
  } else {
    const switched = await client.evaluate(`(() => {
      const target = ${JSON.stringify(targetSession)}.toLowerCase();
      const candidates = [...document.querySelectorAll('button,[role="button"]')];
      const button = candidates.find((node) =>
        [node.title, node.getAttribute('aria-label'), node.innerText]
          .filter(Boolean)
          .some((text) => text.toLowerCase().includes(target)));
      if (!button) return false;
      button.click();
      return true;
    })()`);
    if (!switched) {
      await client.evaluate(`(() => {
        localStorage.setItem('autogram_app_mode', 'launcher');
        location.reload();
        return true;
      })()`);
      await waitFor(
        client,
        `(() => /Session Landing Launcher/i.test(document.body?.innerText || ''))()`,
        30_000,
        'Session Landing Launcher',
      );
      return ensureDriveSession(client, targetSession);
    }
  }

  return waitFor(
    client,
    `(() => {
      const text = document.body?.innerText || '';
      const target = ${JSON.stringify(targetSession)}.toLowerCase();
      const storageMatches = localStorage.getItem('autogram_drive_session') === ${JSON.stringify(targetSession)};
      const visibleMatches = text.toLowerCase().includes('connected session\\n' + target);
      const driveReady = text.length > 20 && !/^(?:Memuat|Loading) Drives?/i.test(text);
      return (storageMatches || visibleMatches) && driveReady && !/Session Landing Launcher/i.test(text);
    })()`,
    30_000,
    `Drive session ${targetSession}`,
  );
}

async function openSavedMessages(client) {
  const alreadyOpen = await client.evaluate(`(() =>
    !!document.querySelector('[data-peer-id="me"][data-msg-id]') ||
    /Saved Messages|Pesan Tersimpan/i.test(document.body.innerText.slice(0, 1_200)))()`);
  if (alreadyOpen && await client.evaluate(`(() => !!document.querySelector('[data-peer-id="me"][data-msg-id]'))()`)) {
    return;
  }

  const clicked = await client.evaluate(`(() => {
    const nodes = [...document.querySelectorAll('button,[role="button"],a')];
    const target = nodes.find((node) => /Saved Messages|Pesan Tersimpan/i.test(
      [node.innerText, node.title, node.getAttribute('aria-label')].filter(Boolean).join(' ')));
    if (!target) return false;
    target.click();
    return true;
  })()`);
  if (!clicked) throw new Error('Saved Messages navigation control was not found.');
  await waitFor(client, `(() => !!document.querySelector('[data-peer-id="me"][data-msg-id]'))()`, 30_000, 'Saved Messages cards');
}

async function closePreview(client) {
  await client.evaluate(`(() => {
    const dialogs = [...document.querySelectorAll('[role="dialog"],div')]
      .filter((node) => node.querySelector?.('video,img,iframe') && node.innerText?.length > 0);
    const dialog = dialogs.sort((a, b) => a.innerText.length - b.innerText.length)[0];
    const buttons = [...(dialog || document).querySelectorAll('button')];
    const close = buttons.find((button) =>
      /close|tutup/i.test([button.title, button.getAttribute('aria-label')].filter(Boolean).join(' '))) ||
      buttons.find((button) => button.querySelector('svg') && !button.innerText.trim());
    close?.click();
    return !!close;
  })()`);
  await sleep(500);
}

async function openCardPreview(client, messageId) {
  await closePreview(client);
  const result = await client.evaluate(`(() => {
    const card = document.querySelector('[data-peer-id="me"][data-msg-id="${messageId}"]');
    if (!card) return { ok: false, reason: 'card-not-found' };
    card.scrollIntoView({ block: 'center', inline: 'center' });
    const buttons = [...card.querySelectorAll('button')];
    const preview = buttons.find((button) => /preview|pratinjau/i.test(
      [button.title, button.getAttribute('aria-label'), button.innerText].filter(Boolean).join(' '))) ||
      buttons.find((button) => button.title);
    if (!preview) return { ok: false, reason: 'preview-button-not-found', buttons: buttons.map((button) => button.title) };
    preview.click();
    return { ok: true, cardText: card.innerText.slice(0, 180) };
  })()`);
  if (!result.ok) throw new Error(`Cannot open message ${messageId}: ${JSON.stringify(result)}`);
  return result;
}

function videoStateExpression() {
  return `(() => {
    const video = document.querySelector('video');
    if (!video) return null;
    const buffered = [];
    for (let index = 0; index < video.buffered.length; index += 1) {
      buffered.push([video.buffered.start(index), video.buffered.end(index)]);
    }
    return {
      src: video.currentSrc || video.src,
      currentTime: video.currentTime,
      duration: Number.isFinite(video.duration) ? video.duration : null,
      readyState: video.readyState,
      networkState: video.networkState,
      paused: video.paused,
      buffered,
      width: video.videoWidth,
      height: video.videoHeight,
      error: video.error ? { code: video.error.code, message: video.error.message } : null,
    };
  })()`;
}

async function verifyVideo(client, messageId, timeoutMs = 45_000) {
  const opened = await openCardPreview(client, messageId);
  const firstReady = await waitFor(
    client,
    `(() => { const video = document.querySelector('video'); return video && video.readyState >= 1 ? (${videoStateExpression()}) : null; })()`,
    timeoutMs,
    `video metadata for /${messageId}`,
  );
  await client.evaluate(`(() => document.querySelector('video')?.play().catch(() => {}))()`);
  const startTime = firstReady.currentTime;
  const playing = await waitFor(
    client,
    `(() => { const video = document.querySelector('video'); return video && video.readyState >= 2 && video.currentTime > ${startTime + 0.1} ? (${videoStateExpression()}) : null; })()`,
    timeoutMs,
    `playback progress for /${messageId}`,
  );
  if (playing.error) throw new Error(`Video /${messageId} failed: ${JSON.stringify(playing.error)}`);
  return { messageId, opened, firstReady, playing };
}

async function verifyImage(client, messageId) {
  const opened = await openCardPreview(client, messageId);
  const image = await waitFor(
    client,
    `(() => {
      const images = [...document.querySelectorAll('img')].filter((item) => item.naturalWidth > 100 && item.naturalHeight > 100);
      const item = images.sort((a, b) => (b.naturalWidth * b.naturalHeight) - (a.naturalWidth * a.naturalHeight))[0];
      return item ? {
        sourceKind: (item.currentSrc || item.src).startsWith('data:') ? 'data-url' : 'url',
        sourceLength: (item.currentSrc || item.src).length,
        width: item.naturalWidth,
        height: item.naturalHeight
      } : null;
    })()`,
    20_000,
    `image preview for /${messageId}`,
  );
  return { messageId, opened, image };
}

async function verifyDocumentFallback(client, messageId) {
  const opened = await openCardPreview(client, messageId);
  const fileName = opened.cardText.split('\n').find((line) =>
    line.trim() && !/^(?:FILE|MEDIA|Loading…?|Memuat…?)$/i.test(line.trim())) || opened.cardText;
  const dialog = await waitFor(
    client,
    `(() => {
      const fileName = ${JSON.stringify(fileName)};
      const item = [...document.querySelectorAll('[role="dialog"]')]
        .find((candidate) => candidate.innerText.includes(fileName));
      if (!item) return null;
      const text = item.innerText;
      if (/Memuat|Loading/i.test(text)) return null;
      return {
        text: text.slice(0, 800),
        hasVideo: !!item.querySelector('video'),
        hasAudio: !!item.querySelector('audio'),
        hasIframe: !!item.querySelector('iframe'),
        hasVisibleError: /gagal|error|tidak dapat|cannot/i.test(text)
      };
    })()`,
    20_000,
    `document fallback for /${messageId}`,
  );
  if (dialog.hasVideo || dialog.hasAudio) {
    throw new Error(`Non-media document /${messageId} unexpectedly mounted an AV player.`);
  }
  if (/\.pdf$/i.test(fileName)) {
    const pdf = await client.evaluate(`(() => {
      const fileName = ${JSON.stringify(fileName)};
      const item = [...document.querySelectorAll('[role="dialog"]')].find((candidate) => candidate.innerText.includes(fileName));
      const frame = item?.querySelector('iframe');
      if (frame?.src) return { src: frame.src, loaded: true };
      const retry = [...(item?.querySelectorAll('button') || [])].find((button) => /try again|coba lagi|coba ulang/i.test(button.innerText));
      retry?.click();
      return { retried: !!retry };
    })()`);
    const loadedPdf = pdf.loaded ? pdf : await waitFor(
      client,
      `(() => {
        const fileName = ${JSON.stringify(fileName)};
        const item = [...document.querySelectorAll('[role="dialog"]')].find((candidate) => candidate.innerText.includes(fileName));
        const frame = item?.querySelector('iframe');
        return frame?.src ? { src: frame.src, loaded: true } : null;
      })()`,
      30_000,
      `PDF iframe for /${messageId}`,
    );
    return { messageId, opened, dialog, pdf: loadedPdf };
  }
  return { messageId, opened, dialog };
}

async function listSavedCards(client) {
  return client.evaluate(`(() => [...document.querySelectorAll('[data-peer-id="me"][data-msg-id]')].map((card) => ({
    messageId: card.getAttribute('data-msg-id'),
    session: card.getAttribute('data-session'),
    peerId: card.getAttribute('data-peer-id'),
    topicId: card.getAttribute('data-topic-id'),
    text: card.innerText.slice(0, 180),
    previewTitles: [...card.querySelectorAll('button')].map((button) => button.title).filter(Boolean)
  })))()`);
}

async function verifyLauncherGeneralSettings(client) {
  await closePreview(client);
  await client.evaluate(`(() => {
    localStorage.setItem('autogram_app_mode', 'launcher');
    location.reload();
    return true;
  })()`);
  await waitFor(
    client,
    `(() => /Session Landing Launcher/i.test(document.body?.innerText || ''))()`,
    30_000,
    'Session Landing Launcher before General Settings',
  );
  const opened = await client.evaluate(`(() => {
    const buttons = [...document.querySelectorAll('button')];
    const settings = buttons.find((button) => /general settings|pengaturan umum/i.test(
      [button.title, button.getAttribute('aria-label'), button.innerText].filter(Boolean).join(' ')));
    if (!settings) return false;
    settings.click();
    return true;
  })()`);
  if (!opened) throw new Error('Launcher General Settings button was not found.');
  const settings = await waitFor(
    client,
    `(() => {
      const text = document.body?.innerText || '';
      const mode = localStorage.getItem('autogram_app_mode');
      return mode === 'settings' && /API ID/i.test(text) && /API Hash/i.test(text) ? {
        mode,
        hasGeneralHeading: /general settings|pengaturan umum/i.test(text),
        hasApiConfig: /API ID/i.test(text) && /API Hash/i.test(text),
        incorrectlyOpenedDrive: /connected session/i.test(text),
        excerpt: text.slice(0, 800)
      } : null;
    })()`,
    20_000,
    'General Settings API configuration',
  );
  if (!settings.hasGeneralHeading || settings.incorrectlyOpenedDrive) {
    throw new Error(`Launcher gear opened the wrong workspace: ${JSON.stringify(settings)}`);
  }
  const returned = await client.evaluate(`(() => {
    const button = [...document.querySelectorAll('button')].find((item) => /back to launcher|kembali ke launcher/i.test(
      [item.title, item.getAttribute('aria-label'), item.innerText].filter(Boolean).join(' ')));
    button?.click();
    return !!button;
  })()`);
  if (!returned) throw new Error('General Settings back-to-launcher control was not found.');
  await waitFor(client, `(() => /Session Landing Launcher/i.test(document.body?.innerText || ''))()`, 20_000, 'return to launcher');
  return settings;
}

async function main() {
  const sessionArg = process.argv.find((arg) => arg.startsWith('--session='));
  const targetSession = sessionArg ? sessionArg.slice('--session='.length) : DEFAULT_SESSION;
  const sessionSmoke = process.argv.includes('--session-smoke');
  const endpoint = await findAutoGramTarget();
  const client = new CdpClient(endpoint.target.webSocketDebuggerUrl);
  const report = {
    startedAt: new Date().toISOString(),
    cdp: { host: endpoint.host, port: endpoint.port },
    targetSession,
    targetMessageId: TARGET_MESSAGE_ID,
    checks: [],
  };

  try {
    await client.connect();
    await ensureDriveSession(client, targetSession);
    await openSavedMessages(client);
    report.cards = await listSavedCards(client);

    const hasTarget = report.cards.some((card) => card.messageId === TARGET_MESSAGE_ID);
    if (!hasTarget && !sessionSmoke) {
      throw new Error(`Required target /${TARGET_MESSAGE_ID} was not found in ${targetSession} Saved Messages.`);
    }

    if (hasTarget) {
      const target = await verifyVideo(client, TARGET_MESSAGE_ID, 60_000);
      if (!/\/stream\/g[0-9a-f]{12}_me-81\//.test(target.playing.src)) {
        throw new Error(`Target /81 did not use a session-scoped stream id: ${target.playing.src}`);
      }
      report.checks.push({ kind: 'target-video', ...target });
    } else {
      const firstVideo = report.cards.find((card) => /\bmp4\b/i.test(card.text));
      if (firstVideo) {
        report.checks.push({ kind: 'session-video-smoke', ...(await verifyVideo(client, firstVideo.messageId, 30_000)) });
      }
      const firstImage = report.cards.find((card) => /\b(jpe?g|png|webp)\b/i.test(card.text));
      if (firstImage) {
        report.checks.push({ kind: 'session-image-smoke', ...(await verifyImage(client, firstImage.messageId)) });
      }
      const firstPdf = report.cards.find((card) => /\bpdf\b/i.test(card.text));
      if (firstPdf) {
        report.checks.push({ kind: 'session-pdf-smoke', ...(await verifyDocumentFallback(client, firstPdf.messageId)) });
      }
      const firstText = report.cards.find((card) => /\b(txt|json|plain)\b/i.test(card.text));
      if (firstText) {
        report.checks.push({ kind: 'session-text-smoke', ...(await verifyDocumentFallback(client, firstText.messageId)) });
      }
      const firstBinary = report.cards.find((card) => /\b(apk|zip|exe)\b/i.test(card.text));
      if (firstBinary) {
        report.checks.push({ kind: 'session-binary-smoke', ...(await verifyDocumentFallback(client, firstBinary.messageId)) });
      }
    }

    for (const messageId of ['185', '186', '187']) {
      if (!report.cards.some((card) => card.messageId === messageId)) continue;
      report.checks.push({ kind: 'regression-video', ...(await verifyVideo(client, messageId, 30_000)) });
    }

    if (report.cards.some((card) => card.messageId === '59')) {
      report.checks.push({ kind: 'regression-image', ...(await verifyImage(client, '59')) });
    }

    if (report.cards.some((card) => card.messageId === '70')) {
      report.checks.push({ kind: 'special-document-fallback', ...(await verifyDocumentFallback(client, '70')) });
    }

    if (!sessionSmoke) {
      report.checks.push({ kind: 'launcher-general-settings', ...(await verifyLauncherGeneralSettings(client)) });
    }

    report.completedAt = new Date().toISOString();
    report.ok = true;
    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    report.completedAt = new Date().toISOString();
    report.ok = false;
    report.error = error instanceof Error ? error.message : String(error);
    report.body = await client.evaluate(`(() => document.body.innerText.slice(0, 4_000))()`).catch(() => null);
    console.error(JSON.stringify(report, null, 2));
    process.exitCode = 1;
  } finally {
    client.close();
  }
}

await main();
