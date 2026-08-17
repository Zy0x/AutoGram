/**
 * Autonomous Memory Circuit Breaker & Device Protection Shield
 * 
 * Protects low-end to high-end devices from memory exhaustion, GC thrashing,
 * and UI freezes during massive background operations (e.g. 50k-500k item indexing).
 */

export interface MemoryHealthStatus {
  heapUsedMb: number | null;
  heapLimitMb: number | null;
  status: 'optimal' | 'elevated' | 'critical';
  shouldThrottle: boolean;
  shouldTripCircuit: boolean;
}

// Memory thresholds (tuned for lightweight desktop operation)
const ELEVATED_HEAP_MB = 150;
const CRITICAL_HEAP_MB = 280;

/**
 * Inspect current JavaScript Heap memory and event loop health.
 */
export function checkMemoryHealth(): MemoryHealthStatus {
  const memory = (globalThis as any).performance?.memory || (typeof window !== 'undefined' && (window.performance as any)?.memory);
  if (!memory || !memory.usedJSHeapSize) {
    return {
      heapUsedMb: null,
      heapLimitMb: null,
      status: 'optimal',
      shouldThrottle: false,
      shouldTripCircuit: false,
    };
  }

  const heapUsedMb = Math.round(memory.usedJSHeapSize / (1024 * 1024));
  const heapLimitMb = Math.round((memory.jsHeapSizeLimit || 0) / (1024 * 1024));

  if (heapUsedMb >= CRITICAL_HEAP_MB) {
    return {
      heapUsedMb,
      heapLimitMb,
      status: 'critical',
      shouldThrottle: true,
      shouldTripCircuit: true,
    };
  }

  if (heapUsedMb >= ELEVATED_HEAP_MB) {
    return {
      heapUsedMb,
      heapLimitMb,
      status: 'elevated',
      shouldThrottle: true,
      shouldTripCircuit: false,
    };
  }

  return {
    heapUsedMb,
    heapLimitMb,
    status: 'optimal',
    shouldThrottle: false,
    shouldTripCircuit: false,
  };
}

/**
 * Execute emergency memory cleanup (clear transient caches, release memory).
 */
export function executeEmergencyMemoryReclamation(): void {
  try {
    const target = typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? (globalThis as any) : null);
    if (target && typeof target.dispatchEvent === 'function') {
      target.dispatchEvent(new CustomEvent('autogram-emergency-memory-reclaim'));
    }
  } catch {
    /* ignore */
  }
}
