import { describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('../../../tauri/platform', () => ({ detectTauriRuntime: () => true }));

import { invoke } from '@tauri-apps/api/core';
import { nativeDeepResolver } from './nativeDeepResolver';

describe('nativeDeepResolver', () => {
  it('keeps only backend-verified media and preserves safe transport provenance', async () => {
    vi.mocked(invoke).mockResolvedValueOnce({
      sourceUrl: 'https://wrapper.example/watch/abc',
      finalUrl: 'https://wrapper.example/watch/abc',
      platformName: 'Remote Link',
      title: 'Public folder',
      inspectedPages: 3,
      discoveryComplete: false,
      pendingCount: 12,
      discoveryCursor: { queue: [{ url: 'https://wrapper.example/f/next' }] },
      candidates: [
        {
          url: 'https://cdn.example/video-1080',
          sourceUrl: 'https://wrapper.example/watch/abc',
          parentUrl: 'https://wrapper.example/watch/abc',
          redirectChain: [
            'https://wrapper.example/download.mp4',
            'https://cdn.example/video-1080',
          ],
          title: 'Verified 1080p',
          kind: 'mp4',
          mimeType: 'video/mp4',
          contentLength: 123456,
          validation: 'magic+range',
          verified: true,
          isDownloadable: true,
          isStreamable: true,
          downloadOnly: false,
        },
        {
          url: 'https://ads.example/not-a-video.mp4',
          title: 'Misleading extension',
          kind: 'mp4',
          verified: false,
        },
      ],
    });

    const resolved = await nativeDeepResolver.resolve('https://wrapper.example/watch/abc');

    expect(resolved?.formats).toHaveLength(1);
    expect(resolved?.mediaItems).toBeUndefined();
    expect(resolved?.formats[0]).toMatchObject({
      directUrl: 'https://cdn.example/video-1080',
      isStreamable: true,
      headers: { Referer: 'https://wrapper.example/watch/abc' },
      verification: {
        status: 'verified',
        validation: 'magic+range',
        redirectChain: [
          'https://wrapper.example/download.mp4',
          'https://cdn.example/video-1080',
        ],
      },
    });
    expect(resolved?.discovery).toMatchObject({ complete: false, pendingCount: 12 });
  });
});
