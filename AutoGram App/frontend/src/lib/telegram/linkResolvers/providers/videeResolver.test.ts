import { describe, it, expect, vi, beforeEach } from 'vitest';
import { videeResolver, isVideeHost } from './videeResolver';

describe('videeResolver', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('correctly identifies videe and videy domains', () => {
    expect(isVideeHost('https://videe.cc/ul55z6uwc92t.mp4?v=test')).toBe(true);
    expect(isVideeHost('https://videe.cc/e/unixcnptfdlj')).toBe(true);
    expect(isVideeHost('https://videe.cc/v/unixcnptfdlj')).toBe(true);
    expect(isVideeHost('https://videy.co/v?id=ul55z6uwc92t')).toBe(true);
    expect(isVideeHost('https://cdn.videy.co/ul55z6uwc92t.mp4')).toBe(true);
    expect(isVideeHost('https://youtube.com/watch?v=123')).toBe(false);
  });

  it('resolves videy.co direct CDN video', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url: any, opts: any) => {
      if (opts?.method === 'GET' && opts?.headers?.Range) {
        return new Response(new Uint8Array(2), {
          status: 206,
          headers: {
            'content-range': 'bytes 0-1/52428800',
            'content-type': 'video/mp4',
          },
        });
      }
      return new Response('', { status: 200 });
    });

    const res = await videeResolver.resolve('https://videy.co/v?id=ul55z6uwc92t');
    expect(res).not.toBeNull();
    expect(res?.platformName).toBe('Videy Video');
    expect(res?.formats[0].directUrl).toBe('https://cdn.videy.co/ul55z6uwc92t.mp4');
    expect(res?.formats[0].filesizeBytes).toBe(52428800);
  });

  it('resolves multi-video folder on videe.cc with batch pack and mediaItems', async () => {
    const folderHtml = `
      <!doctype html>
      <html>
        <head><title>Watch on Videy & Free Video Hosting</title></head>
        <body>
          <script>const folderId = 'ul55z6uwc92t';</script>
          <div class="col-6">
            <a href="/e/unixcnptfdlj" class="video-wrapper">
              <img src="/placeholder.png" data-src="/thumbnails/thumb1.jpeg">
            </a>
            <a href="/e/unixcnptfdlj" class="title_video">
              <strong>Video Alpha 720p</strong>
            </a>
          </div>
          <div class="col-6">
            <a href="/e/3njgbc5dyskv" class="video-wrapper">
              <img src="/placeholder.png" data-src="/thumbnails/thumb2.jpeg">
            </a>
            <a href="/e/3njgbc5dyskv" class="title_video">
              <strong>Video Beta 1080p</strong>
            </a>
          </div>
        </body>
      </html>
    `;

    const singleVideoHtml = `
      <!doctype html>
      <html>
        <head><title>Video Alpha 720p</title></head>
        <body>
          <script>
            loadPlyr('https://videos.r2.cloudflarestorage.com/videos/stream1.mp4?sig=xyz');
          </script>
        </body>
      </html>
    `;

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: any, _opts: any) => {
      const urlStr = String(url);
      if (urlStr.includes('/v/')) {
        return new Response(singleVideoHtml, { status: 200 });
      }
      if (urlStr.includes('r2.cloudflarestorage.com')) {
        return new Response(new Uint8Array(2), {
          status: 206,
          headers: {
            'content-range': 'bytes 0-1/133411611',
            'content-type': 'video/mp4',
          },
        });
      }
      return new Response(folderHtml, { status: 200 });
    });

    const res = await videeResolver.resolve('https://videe.cc/ul55z6uwc92t.mp4?v=kamis+malam+jumat');
    expect(res).not.toBeNull();
    expect(res?.platformName).toBe('Videe Collection');
    expect(res?.title).toBe('kamis malam jumat');
    expect(res?.totalItems).toBe(2);
    expect(res?.formats.length).toBeGreaterThan(1);
    expect(res?.formats[0].isAlbumPack).toBe(true);
    expect(res?.mediaItems?.length).toBe(2);
  });
});
