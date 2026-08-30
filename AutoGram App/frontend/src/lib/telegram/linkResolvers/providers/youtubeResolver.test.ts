import { describe, expect, it } from 'vitest';
import { extractYouTubeVideoId, youtubeResolver } from './youtubeResolver';

describe('youtubeResolver', () => {
  it('identifies valid YouTube URLs', () => {
    expect(youtubeResolver.canHandle('https://www.youtube.com/watch?v=DLfZ9YbpBN0')).toBe(true);
    expect(youtubeResolver.canHandle('https://youtu.be/tYARyQLq8RU')).toBe(true);
    expect(youtubeResolver.canHandle('https://youtube.com/shorts/abcdef12345')).toBe(true);
    expect(youtubeResolver.canHandle('https://vimeo.com/123456')).toBe(false);
  });

  it('correctly extracts video IDs from various URL formats', () => {
    expect(extractYouTubeVideoId('https://www.youtube.com/watch?v=DLfZ9YbpBN0')).toBe('DLfZ9YbpBN0');
    expect(extractYouTubeVideoId('https://youtu.be/tYARyQLq8RU?si=test1234')).toBe('tYARyQLq8RU');
    expect(extractYouTubeVideoId('https://www.youtube.com/shorts/DLfZ9YbpBN0')).toBe('DLfZ9YbpBN0');
    expect(extractYouTubeVideoId('https://www.youtube.com/embed/DLfZ9YbpBN0')).toBe('DLfZ9YbpBN0');
  });

  it('resolves formats dynamically based on video capability', async () => {
    const result = await youtubeResolver.resolve('https://www.youtube.com/watch?v=tYARyQLq8RU');
    expect(result).toBeDefined();
    expect(result?.platform).toBe('youtube');
    expect(result?.formats.length).toBeGreaterThanOrEqual(3);
    const formatIds = result?.formats.map((f) => f.id) || [];
    expect(formatIds.some((id) => id.startsWith('yt_1080p'))).toBe(true);
    expect(formatIds.some((id) => id.startsWith('yt_720p'))).toBe(true);
    expect(formatIds).toContain('yt_audio_m4a');
    expect(result?.formats.some((f) => f.ext === 'mp4')).toBe(true);
    expect(result?.formats.some((f) => f.ext === 'webm')).toBe(true);
    expect(result?.formats.some((f) => f.isAudio)).toBe(true);
  });
});
