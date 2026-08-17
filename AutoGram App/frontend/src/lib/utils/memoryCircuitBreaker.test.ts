import { describe, it, expect, vi, afterEach } from 'vitest';
import { checkMemoryHealth, executeEmergencyMemoryReclamation } from './memoryCircuitBreaker';

describe('memoryCircuitBreaker', () => {
  const originalPerformance = globalThis.performance;

  afterEach(() => {
    Object.defineProperty(globalThis, 'performance', {
      value: originalPerformance,
      writable: true,
      configurable: true,
    });
  });

  it('returns optimal status when memory is low (< 150MB)', () => {
    Object.defineProperty(globalThis, 'performance', {
      value: {
        memory: {
          usedJSHeapSize: 80 * 1024 * 1024,
          jsHeapSizeLimit: 2048 * 1024 * 1024,
        },
      },
      writable: true,
      configurable: true,
    });

    const res = checkMemoryHealth();
    expect(res.status).toBe('optimal');
    expect(res.heapUsedMb).toBe(80);
    expect(res.shouldThrottle).toBe(false);
    expect(res.shouldTripCircuit).toBe(false);
  });

  it('returns elevated status and throttles when memory reaches 150MB - 280MB', () => {
    Object.defineProperty(globalThis, 'performance', {
      value: {
        memory: {
          usedJSHeapSize: 200 * 1024 * 1024,
          jsHeapSizeLimit: 2048 * 1024 * 1024,
        },
      },
      writable: true,
      configurable: true,
    });

    const res = checkMemoryHealth();
    expect(res.status).toBe('elevated');
    expect(res.heapUsedMb).toBe(200);
    expect(res.shouldThrottle).toBe(true);
    expect(res.shouldTripCircuit).toBe(false);
  });

  it('returns critical status and trips circuit breaker when memory exceeds 280MB', () => {
    Object.defineProperty(globalThis, 'performance', {
      value: {
        memory: {
          usedJSHeapSize: 320 * 1024 * 1024,
          jsHeapSizeLimit: 2048 * 1024 * 1024,
        },
      },
      writable: true,
      configurable: true,
    });

    const res = checkMemoryHealth();
    expect(res.status).toBe('critical');
    expect(res.heapUsedMb).toBe(320);
    expect(res.shouldThrottle).toBe(true);
    expect(res.shouldTripCircuit).toBe(true);
  });

  it('dispatches emergency reclamation event safely', () => {
    const fakeWindow = { dispatchEvent: vi.fn() };
    (globalThis as any).window = fakeWindow;
    executeEmergencyMemoryReclamation();
    expect(fakeWindow.dispatchEvent).toHaveBeenCalled();
    delete (globalThis as any).window;
  });
});
