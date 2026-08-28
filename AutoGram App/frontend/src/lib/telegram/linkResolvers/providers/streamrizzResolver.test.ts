import { describe, it, expect, vi, beforeEach } from 'vitest';
import { streamrizzResolver } from './streamrizzResolver';

describe('streamrizzResolver', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('correctly identifies streamrizz and vidoy domains', () => {
    expect(streamrizzResolver.canHandle('https://streamrizz.com/f/saq2vw4siq3')).toBe(true);
    expect(streamrizzResolver.canHandle('https://streamrizz.com/d/56ky869jux6w')).toBe(true);
    expect(streamrizzResolver.canHandle('https://vidoy.com/v/12345')).toBe(true);
    expect(streamrizzResolver.canHandle('https://vidoy.asia/f/abc')).toBe(true);
    expect(streamrizzResolver.canHandle('https://mp4-01.overfetch.video/xyz-123')).toBe(true);
    expect(streamrizzResolver.canHandle('https://youtube.com/watch?v=123')).toBe(false);
  });

  it('extracts single video details from mock HTML payload', async () => {
    const mockPayload = {
      id: '56ky869jux6w',
      bk: 'vidoycdn',
      ti: 'Sample Video.mp4',
      im: 'thumb123.jpg',
      rf: 'rf-token-456',
    };
    const b64 = Buffer.from(JSON.stringify(mockPayload)).toString('base64');
    const mockHtml = `
      <html>
        <body>
          <script>
            var embedToken = '${b64}.dummySignature';
          </script>
        </body>
      </html>
    `;

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url: any, opts: any) => {
      if (opts?.method === 'HEAD') {
        return new Response(null, {
          status: 200,
          headers: { 'content-length': '15728640' },
        });
      }
      return new Response(mockHtml, { status: 200 });
    });

    const res = await streamrizzResolver.resolve('https://streamrizz.com/d/56ky869jux6w');
    expect(res).not.toBeNull();
    expect(res?.title).toBe('Sample Video.mp4');
    expect(res?.formats.length).toBe(1);
    expect(res?.formats[0].directUrl).toBe('https://mp4-01.overfetch.video/rf-token-456');
    expect(res?.formats[0].filesizeBytes).toBe(15728640);
    expect(res?.formats[0].headers?.Referer).toBe('https://streamrizz.com/');
  });

  it('extracts multi-video folder with master batch pack and individual items', async () => {
    const folderHtml = `
      <html>
        <head><title>📂 Summer Playlist - StreamRizz</title></head>
        <body>
          <h1 class="drive-title">Summer Playlist</h1>
          <div class="file-grid">
            <article class="drive-file-card">
              <a href="/d/vid1" class="thumb-link"><img src="https://i.streamrizz.com/thumb1.jpg" /></a>
              <a href="/d/vid1" class="file-name" title="Video 1.mp4">Video 1.mp4</a>
            </article>
            <article class="drive-file-card">
              <a href="/d/vid2" class="thumb-link"><img src="https://i.streamrizz.com/thumb2.jpg" /></a>
              <a href="/d/vid2" class="file-name" title="Video 2.mp4">Video 2.mp4</a>
            </article>
          </div>
        </body>
      </html>
    `;

    const token1 = Buffer.from(JSON.stringify({ id: 'vid1', ti: 'Video 1.mp4', rf: 'rf-vid1' })).toString('base64');
    const token2 = Buffer.from(JSON.stringify({ id: 'vid2', ti: 'Video 2.mp4', rf: 'rf-vid2' })).toString('base64');

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: any, opts: any) => {
      const urlStr = String(url);
      if (opts?.method === 'HEAD') {
        const size = urlStr.includes('rf-vid1') ? '10000000' : '20000000';
        return new Response(null, {
          status: 200,
          headers: { 'content-length': size },
        });
      }
      if (urlStr.includes('/f/summer')) {
        return new Response(folderHtml, { status: 200 });
      }
      if (urlStr.includes('/d/vid1')) {
        return new Response(`var embedToken = '${token1}.sig';`, { status: 200 });
      }
      if (urlStr.includes('/d/vid2')) {
        return new Response(`var embedToken = '${token2}.sig';`, { status: 200 });
      }
      return new Response('', { status: 404 });
    });

    const res = await streamrizzResolver.resolve('https://streamrizz.com/f/summer');
    expect(res).not.toBeNull();
    expect(res?.title).toBe('Summer Playlist');
    expect(res?.totalItems).toBe(2);
    // Format 0 should be master album pack
    expect(res?.formats[0].id).toBe('streamrizz_all_files_pack');
    expect(res?.formats[0].isAlbumPack).toBe(true);
    expect(res?.formats[0].allAlbumUrls).toEqual([
      'https://mp4-01.overfetch.video/rf-vid1',
      'https://mp4-01.overfetch.video/rf-vid2',
    ]);
    expect(res?.formats[0].filesizeBytes).toBe(30000000);

    // Formats 1 and 2 are individual videos
    expect(res?.formats[1].customTitle).toBe('Video 1.mp4');
    expect(res?.formats[1].directUrl).toBe('https://mp4-01.overfetch.video/rf-vid1');
    expect(res?.formats[1].filesizeBytes).toBe(10000000);

    expect(res?.formats[2].customTitle).toBe('Video 2.mp4');
    expect(res?.formats[2].directUrl).toBe('https://mp4-01.overfetch.video/rf-vid2');
    expect(res?.formats[2].filesizeBytes).toBe(20000000);

    // Media items
    expect(res?.mediaItems?.length).toBe(2);
    expect(res?.mediaItems?.[0].title).toBe('Video 1.mp4');
    expect(res?.mediaItems?.[0].formats[0].filesizeBytes).toBe(10000000);
    expect(res?.mediaItems?.[1].title).toBe('Video 2.mp4');
    expect(res?.mediaItems?.[1].formats[0].filesizeBytes).toBe(20000000);
  });
});
