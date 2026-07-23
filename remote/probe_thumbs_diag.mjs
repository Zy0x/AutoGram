import { chromium } from 'playwright';

const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
const page = browser
  .contexts()
  .flatMap((c) => c.pages())
  .find((p) => p.url().includes('1420') || p.url().includes('localhost'));

if (!page) {
  console.log('NO_PAGE');
  process.exit(1);
}

const diag = await page.evaluate(async () => {
  const cards = document.querySelectorAll('.td-file-card');
  const cardData = Array.from(cards).slice(0, 10).map((card) => {
    const img = card.querySelector('img');
    const loading = card.querySelector('.td-thumb-loading');
    const title = card.getAttribute('title') || '';
    return {
      title,
      imgSrcStart: img ? img.src.slice(0, 60) : null,
      imgSrcLen: img ? img.src.length : 0,
      isPlaceholderClass: img ? img.classList.contains('td-thumb-is-placeholder') : false,
      hasLoadingSpinner: !!loading,
      loadingText: loading ? loading.innerText : null
    };
  });

  return {
    totalCards: cards.length,
    sampleCards: cardData,
  };
});

console.log(JSON.stringify(diag, null, 2));
process.exit(0);
