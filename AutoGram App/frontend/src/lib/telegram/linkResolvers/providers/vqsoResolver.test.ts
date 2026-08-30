import { describe, it, expect, vi, beforeEach } from 'vitest';
import { vqsoResolver } from './vqsoResolver';

describe('vqsoResolver', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('correctly identifies vqso.de and slicedrive.com domains', () => {
    expect(vqsoResolver.canHandle('https://vqso.de/e/ubOiAamc')).toBe(true);
    expect(vqsoResolver.canHandle('https://slicedrive.com/e/12345')).toBe(true);
    expect(vqsoResolver.canHandle('https://slc.is/e/abc')).toBe(true);
    expect(vqsoResolver.canHandle('https://youtube.com/watch?v=123')).toBe(false);
  });

  it('extracts direct CDN MP4 from playerConfig base64 payload', async () => {
    const mockConfig = {
      slug: 'ubOiAamc',
      deviceProfile: 'desktop',
      videoSrcClean: 'https://cdn2.slicedrive.com/7lCgXy5z1.mp4',
      videoSrcPreview: 'https://cdn2.slicedrive.com/7lCgXy5z1.mp4#t=0.15',
    };
    const b64 = Buffer.from(JSON.stringify(mockConfig)).toString('base64');
    const mockHtml = `
      <!DOCTYPE html>
      <html>
        <head><title>Watch · vqso.de</title></head>
        <body>
          <script type="text/plain" id="playerConfig">${b64}</script>
        </body>
      </html>
    `;

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url: any, opts: any) => {
      if (opts?.method === 'HEAD') {
        return new Response(null, {
          status: 200,
          headers: { 'content-length': '25165824' },
        });
      }
      return new Response(mockHtml, { status: 200 });
    });

    const res = await vqsoResolver.resolve('https://vqso.de/e/ubOiAamc');
    expect(res).not.toBeNull();
    expect(res?.formats.length).toBe(1);
    expect(res?.formats[0].directUrl).toBe('https://cdn2.slicedrive.com/7lCgXy5z1.mp4');
    expect(res?.formats[0].filesizeBytes).toBe(25165824);
    expect(res?.formats[0].badge).toBe('1080p FULL HD');
    expect(res?.isDirectFile).toBe(true);
  });
});
