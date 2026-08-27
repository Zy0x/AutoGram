import { describe, expect, it } from 'vitest';
import { parseRemoteShareInput } from './shareInput';

describe('remote share input parser', () => {
  it('extracts a URL embedded in Android share text', () => {
    expect(parseRemoteShareInput('Watch this clip https://example.test/v/42 now').cleanUrl)
      .toBe('https://example.test/v/42');
  });

  it('reads cloud passcodes from query parameters and localized labels', () => {
    expect(parseRemoteShareInput('https://example.test/share?pwd=A7b9').extractedPasscode)
      .toBe('A7b9');
    expect(parseRemoteShareInput('File: https://example.test/share kata sandi: Rahasia-24').extractedPasscode)
      .toBe('Rahasia-24');
  });
});
