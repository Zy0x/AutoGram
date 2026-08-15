import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function run() {
  console.log('Connecting to AutoGram native desktop via CDP on port 9230...');
  try {
    const browser = await chromium.connectOverCDP('http://127.0.0.1:9230');
    const context = browser.contexts()[0];
    const page = context.pages()[0] || await context.newPage();

    console.log('Page title:', await page.title());

    // 1. Find and click Remote Upload button
    const remoteBtn = page.locator('button:has-text("URL Remote"), button:has-text("Remote"), button:has-text("Unggah Jarak Jauh")').first();
    if (await remoteBtn.isVisible({ timeout: 2000 })) {
      console.log('Clicking Remote Upload button...');
      await remoteBtn.click();
    }

    await page.waitForTimeout(1000);

    // 2. Locate URL input
    const urlInput = page.locator('#td-remote-url-input, input[placeholder*="http"]').first();
    if (await urlInput.isVisible({ timeout: 3000 })) {
      // 3. Test Photo Slideshow URL
      const photoUrl = 'https://www.tiktok.com/@akun.polos2655/photo/7673655769870404885';
      console.log('Pasting photo slideshow URL:', photoUrl);
      await urlInput.fill(photoUrl);

      console.log('Waiting for media inspection...');
      await page.waitForTimeout(3000);

      const qualityChips = page.locator('.td-remote-quality-chip');
      const chipCount = await qualityChips.count();
      console.log('Quality chips detected for photo mode:', chipCount);
      for (let i = 0; i < chipCount; i++) {
        console.log(`- Chip [${i}]:`, (await qualityChips.nth(i).innerText()).replace(/\n/g, ' '));
      }

      const screenshot1 = path.join(__dirname, 'remote_slideshow_v360.png');
      await page.screenshot({ path: screenshot1 });
      console.log('Saved screenshot:', screenshot1);

      // 4. Test Video 120fps URL
      const videoUrl = 'https://www.tiktok.com/@izuru.01/video/7673705001830649096';
      console.log('Pasting video URL:', videoUrl);
      await urlInput.fill(videoUrl);

      console.log('Waiting for video inspection...');
      await page.waitForTimeout(3000);

      const chipCount2 = await qualityChips.count();
      console.log('Quality chips detected for video mode:', chipCount2);
      for (let i = 0; i < chipCount2; i++) {
        console.log(`- Chip [${i}]:`, (await qualityChips.nth(i).innerText()).replace(/\n/g, ' '));
      }

      const screenshot2 = path.join(__dirname, 'remote_video_120fps_v360.png');
      await page.screenshot({ path: screenshot2 });
      console.log('Saved screenshot:', screenshot2);
    }

    await browser.close();
    console.log('Verification completed successfully.');
  } catch (e) {
    console.log('CDP note (if desktop not running or connected):', e.message);
  }
}

run();
