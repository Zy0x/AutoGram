import { describe, expect, it } from 'vitest';
import { assertSafeRemoteUrl, isRemoteUrlSafetyError } from './urlSafety';

describe('remote URL renderer safety', () => {
  it.each([
    'http://localhost/file.mp4',
    'http://127.0.0.1/file.mp4',
    'http://10.2.3.4/file.mp4',
    'http://172.20.1.1/file.mp4',
    'http://192.168.1.9/file.mp4',
    'file:///C:/secret.txt',
  ])('blocks local or private target %s', (url) => {
    expect(() => assertSafeRemoteUrl(url)).toThrow();
  });

  it('accepts a public HTTPS target', () => {
    expect(assertSafeRemoteUrl('https://cdn.example.com/media.mp4').hostname)
      .toBe('cdn.example.com');
  });

  it('identifies safety failures so UI fallbacks cannot bypass the guard', () => {
    try {
      assertSafeRemoteUrl('http://127.0.0.1/private');
    } catch (error) {
      expect(isRemoteUrlSafetyError(error)).toBe(true);
    }
  });
});
