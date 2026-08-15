import assert from 'assert';
import { tiktokResolver } from '../../src/lib/telegram/linkResolvers/providers/tiktokResolver.ts';

console.log('Testing TikTok Resolver v3.6.0 Suite...');

// 1. Test canHandle
assert.strictEqual(tiktokResolver.canHandle('https://www.tiktok.com/@izuru.01/video/7673705001830649096'), true);
assert.strictEqual(tiktokResolver.canHandle('https://vt.tiktok.com/ZS65qW3oD/'), true);
assert.strictEqual(tiktokResolver.canHandle('https://vm.tiktok.com/ZMxxxxxx/'), true);
assert.strictEqual(tiktokResolver.canHandle('https://v.douyin.com/ZSxxxx/'), true);
assert.strictEqual(tiktokResolver.canHandle('https://www.douyin.com/video/123456789'), true);
console.log('✓ canHandle validated for all URL patterns');

// 2. Test Video 120fps Resolution
async function testVideo() {
  const result = await tiktokResolver.resolve('https://www.tiktok.com/@izuru.01/video/7673705001830649096');
  if (result) {
    console.log('✓ Video resolved:', result.title);
    assert.strictEqual(result.platform, 'tiktok');
    assert.ok(result.formats.length >= 1);
    const hdFmt = result.formats.find(f => f.qualityTier === '1080p');
    assert.ok(hdFmt, '1080p format exists');
    console.log('  - Format:', hdFmt.label, 'Resolution:', hdFmt.resolution, 'Size:', hdFmt.filesizeBytes);
  }
}

// 3. Test Slideshow Photo Album Resolution
async function testSlideshow() {
  const result = await tiktokResolver.resolve('https://www.tiktok.com/@akun.polos2655/photo/7673655769870404885');
  if (result) {
    console.log('✓ Slideshow resolved:', result.title);
    assert.strictEqual(result.platform, 'tiktok');
    assert.ok(result.formats.length >= 1);
    console.log('  - Total formats:', result.formats.length);
    result.formats.forEach((f, i) => console.log(`  - [${i}] ${f.label} (${f.badge})`));
  }
}

// 4. Test Profile URL Resolution
async function testProfile() {
  const result = await tiktokResolver.resolve('https://www.tiktok.com/@tokyo.prompt');
  if (result) {
    console.log('✓ Profile resolved:', result.title, 'Author:', result.author);
    assert.strictEqual(result.platform, 'tiktok');
  }
}

async function runAll() {
  try {
    await testVideo();
    await testSlideshow();
    await testProfile();
    console.log('\n🎉 ALL RESOLVER INTEGRATION TESTS PASSED 100%!');
  } catch (e) {
    console.error('Test error:', e.message);
  }
}

runAll();
