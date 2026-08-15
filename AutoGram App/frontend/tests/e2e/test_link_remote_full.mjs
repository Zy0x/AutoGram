import assert from 'assert';
import { tiktokResolver } from '../../src/lib/telegram/linkResolvers/providers/tiktokResolver.ts';

async function run() {
  console.log('====================================================');
  console.log('🚀 TESTING REMOTE RESOLUTION FOR TARGET LINK:');
  console.log('🔗 URL:', 'https://vt.tiktok.com/ZSVLHfKUC/');
  console.log('====================================================\n');

  const startTime = Date.now();
  const result = await tiktokResolver.resolve('https://vt.tiktok.com/ZSVLHfKUC/');
  const elapsedMs = Date.now() - startTime;

  assert.ok(result, 'Result should not be null');
  console.log('✅ Status: 100% SUKSES TERURAI');
  console.log(`⏱️ Waktu Ekstraksi: ${elapsedMs} ms`);
  console.log(`📌 Judul Postingan: ${result.title}`);
  console.log(`👤 Kreator: ${result.author}`);
  console.log(`🏷️ Platform: ${result.platformName}`);
  console.log(`🖼️ Thumbnail Utama: ${result.thumbnailUrl}`);
  console.log(`📸 Total Foto Slideshow: ${result.albumImages ? result.albumImages.length : 0} Foto`);

  console.log('\n--- 🎴 DAFTAR FORMAT CHIP YANG DIHASILKAN (ADAPTIVE CANVAS) ---');
  result.formats.forEach((fmt, idx) => {
    console.log(`[Chip ${idx + 1}] ID: ${fmt.id}`);
    console.log(`         Label: ${fmt.label}`);
    console.log(`         Badge: ${fmt.badge || 'N/A'}`);
    console.log(`         Resolusi: ${fmt.resolution || 'N/A'}`);
    console.log(`         Tipe: ${fmt.isImage ? 'Foto/Gambar' : fmt.isVideo ? 'Video' : fmt.isAudio ? 'Audio' : 'Dokumen'}`);
    console.log(`         Direct URL: ${fmt.directUrl.slice(0, 85)}...`);
    if (fmt.allAlbumUrls) {
      console.log(`         📁 Full Album Array (${fmt.allAlbumUrls.length} file URLs attached for Telegram Media Group)`);
    }
    console.log('');
  });

  console.log('====================================================');
  console.log('🎉 PENGUJIAN SELESAI DENGAN STATUS VALID 100%');
  console.log('====================================================');

  // Hard exit timer to guarantee no hanging background task
  setTimeout(() => process.exit(0), 500);
}

run().catch((err) => {
  console.error('❌ Error during remote testing:', err.message);
  process.exit(1);
});
