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

  it('returns optimal status when memory is low (< elevated threshold)', () => {
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
    expect(res.status).toBe('optimal');
    expect(res.heapUsedMb).toBe(200);
    expect(res.shouldThrottle).toBe(false);
    expect(res.shouldTripCircuit).toBe(false);
  });

  it('returns elevated status and throttles when memory reaches elevated threshold', () => {
    Object.defineProperty(globalThis, 'performance', {
      value: {
        memory: {
          usedJSHeapSize: 1400 * 1024 * 1024,
          jsHeapSizeLimit: 2048 * 1024 * 1024,
        },
      },
      writable: true,
      configurable: true,
    });

    const res = checkMemoryHealth();
    expect(res.status).toBe('elevated');
    expect(res.heapUsedMb).toBe(1400);
    expect(res.shouldThrottle).toBe(true);
    expect(res.shouldTripCircuit).toBe(false);
  });

  it('returns critical status and trips circuit breaker when memory exceeds critical threshold', () => {
    Object.defineProperty(globalThis, 'performance', {
      value: {
        memory: {
          usedJSHeapSize: 1900 * 1024 * 1024,
          jsHeapSizeLimit: 2048 * 1024 * 1024,
        },
      },
      writable: true,
      configurable: true,
    });

    const res = checkMemoryHealth();
    expect(res.status).toBe('critical');
    expect(res.heapUsedMb).toBe(1900);
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
