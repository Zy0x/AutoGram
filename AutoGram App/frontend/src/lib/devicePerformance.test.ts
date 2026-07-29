import { describe, expect, it } from 'vitest';
import { normalizedDeviceMemoryGb } from './devicePerformance';

describe('device performance detection', () => {
  it('does not classify WebView desktop as 4 GB when deviceMemory is missing', () => {
    expect(normalizedDeviceMemoryGb(undefined, false)).toBe(8);
  });

  it('keeps a conservative fallback on mobile and honors reported memory', () => {
    expect(normalizedDeviceMemoryGb(undefined, true)).toBe(4);
    expect(normalizedDeviceMemoryGb(2, false)).toBe(2);
    expect(normalizedDeviceMemoryGb(16, false)).toBe(16);
  });
});
