import { chromium } from 'playwright';

(async () => {
  const timer = setTimeout(() => {
    console.log('[TIMEOUT] Exiting cleanly.');
    process.exit(0);
  }, 15000);

  try {
    const browser = await chromium.connectOverCDP('http://127.0.0.1:9230');
    const context = browser.contexts()[0] || browser;
    const page = context.pages()[0] || (await context.newPage());

    const result = await page.evaluate(() => {
      const root = document.documentElement;
      const cs = getComputedStyle(root);

      // CSS tokens aktual
      const tokens = {
        colorScheme: root.getAttribute('data-color-scheme'),
        palette: root.getAttribute('data-palette'),
        textPrimary: cs.getPropertyValue('--text-primary').trim(),
        textSecondary: cs.getPropertyValue('--text-secondary').trim(),
        textMuted: cs.getPropertyValue('--text-muted').trim(),
        accentPrimary: cs.getPropertyValue('--accent-primary').trim(),
        accentSecondary: cs.getPropertyValue('--accent-secondary').trim(),
        primary: cs.getPropertyValue('--primary').trim(),
        bgCard: cs.getPropertyValue('--bg-card').trim(),
        bgPrimary: cs.getPropertyValue('--bg-primary').trim(),
      };

      // Computed color aktual elemen Settings
      const fieldHints = Array.from(document.querySelectorAll('.field-hint, .settings-page .field-hint'));
      const hintData = fieldHints.slice(0, 5).map(el => ({
        tag: el.tagName,
        text: el.textContent?.slice(0, 60),
        computedColor: getComputedStyle(el).color,
        computedBg: getComputedStyle(el).backgroundColor,
      }));

      // select element
      const selects = Array.from(document.querySelectorAll('select.input-field, .settings-page select'));
      const selectData = selects.slice(0, 3).map(el => ({
        id: el.id,
        computedBgImage: getComputedStyle(el).backgroundImage?.slice(0, 80),
        computedBgRepeat: getComputedStyle(el).backgroundRepeat,
        colorScheme: getComputedStyle(el).colorScheme,
        appearance: getComputedStyle(el).appearance || getComputedStyle(el).webkitAppearance,
      }));

      // Teks subtitle pada settings (subtitle, .settings-card-heading p, dll.)
      const subtitles = Array.from(document.querySelectorAll('.settings-page p, .settings-page .subtitle'));
      const subtitleData = subtitles.slice(0, 5).map(el => ({
        tag: el.tagName,
        class: el.className?.slice(0, 40),
        text: el.textContent?.slice(0, 50),
        computedColor: getComputedStyle(el).color,
      }));

      return { tokens, hintData, selectData, subtitleData };
    });

    console.log('=== TOKENS ===');
    console.log(JSON.stringify(result.tokens, null, 2));
    console.log('\n=== FIELD HINTS ===');
    console.log(JSON.stringify(result.hintData, null, 2));
    console.log('\n=== SELECTS ===');
    console.log(JSON.stringify(result.selectData, null, 2));
    console.log('\n=== SUBTITLES ===');
    console.log(JSON.stringify(result.subtitleData, null, 2));

    await browser.close();
  } catch (e) {
    console.error('CDP Error:', e.message);
  } finally {
    clearTimeout(timer);
    process.exit(0);
  }
})();
