"""
Pure recent-window / EWMA transfer rate + ETA helpers.

UI current speed must reflect sustained recent throughput, not a lifetime
average diluted by prepare/re-encode idle or early stalls after t0.
Peak is tracked separately from short positive intervals.
"""
from __future__ import annotations

from collections import deque
from dataclasses import dataclass
from typing import Deque, Dict, List, Optional, Sequence, Tuple


@dataclass(frozen=True)
class RateSnapshot:
    """Immutable view of rate state after a sample."""

    current_mb_s: float
    peak_mb_s: float
    lifetime_avg_mb_s: float
    eta_s: Optional[float]
    transferred: int
    total: int


def bytes_to_mb_s(byte_delta: int, dt_s: float) -> float:
    """Convert byte delta over dt to MiB/s. Non-positive dt → 0."""
    if dt_s <= 0 or byte_delta <= 0:
        return 0.0
    return (float(byte_delta) / (1024.0 * 1024.0)) / float(dt_s)


def compute_window_rate_mb_s(
    samples: Sequence[Tuple[float, int]],
    *,
    now_t: Optional[float] = None,
    window_s: float = 2.5,
) -> float:
    """
    Rate from (t, cumulative_bytes) samples **inside** the last `window_s`.

    Only samples with t >= t_end - window are used so a long early stall does
    not dilute current speed (the 0.26 vs puncak 6.5 bug). Requires monotonic
    non-decreasing bytes.
    """
    if not samples or len(samples) < 2:
        return 0.0
    t_end = float(now_t if now_t is not None else samples[-1][0])
    b_end = int(samples[-1][1])
    window_s = max(0.25, float(window_s))
    t_cut = t_end - window_s
    in_win = [(float(t), int(b)) for t, b in samples if float(t) >= t_cut]
    if len(in_win) < 2:
        # Not enough points in window — use the last two overall samples
        in_win = [(float(t), int(b)) for t, b in samples[-2:]]
    t0, b0 = in_win[0]
    t1, b1 = in_win[-1]
    # Prefer true end time when provided (clock may be ahead of last stamp)
    if now_t is not None and float(now_t) >= t1:
        t1 = float(now_t)
        b1 = b_end
    return bytes_to_mb_s(b1 - b0, t1 - t0)


def compute_eta_s(
    transferred: int,
    total: int,
    current_mb_s: float,
    *,
    min_speed_mb_s: float = 0.05,
) -> Optional[float]:
    """Seconds remaining at current_mb_s, or None if not meaningful."""
    total = int(total or 0)
    transferred = int(transferred or 0)
    if total <= 0 or transferred >= total:
        return None
    if not (current_mb_s >= min_speed_mb_s):
        return None
    remain = total - transferred
    bps = current_mb_s * 1024.0 * 1024.0
    if bps <= 0:
        return None
    return remain / bps


class WindowedRateTracker:
    """
    Stateful sampler for UI current speed / peak / ETA.

    - current_mb_s: max(window rate, EWMA of short intervals) for stability
    - peak_mb_s: max short-interval positive rate observed
    - lifetime_avg_mb_s: total/elapsed from first sample (debug only; not UI current)
    """

    def __init__(
        self,
        *,
        window_s: float = 2.5,
        ewma_alpha: float = 0.40,
        min_interval_s: float = 0.12,
        peak_cap_mb_s: float = 500.0,
    ):
        self.window_s = max(0.5, float(window_s))
        self.ewma_alpha = min(0.95, max(0.05, float(ewma_alpha)))
        self.min_interval_s = max(0.05, float(min_interval_s))
        self.peak_cap_mb_s = max(1.0, float(peak_cap_mb_s))
        self._samples: Deque[Tuple[float, int]] = deque(maxlen=512)
        self._ewma = 0.0
        self.peak_mb_s = 0.0
        self._t0: Optional[float] = None
        self._b0 = 0
        self._last_short_t: Optional[float] = None
        self._last_short_b = 0

    def reset(self, t: Optional[float] = None, bytes_done: int = 0) -> None:
        self._samples.clear()
        self._ewma = 0.0
        self.peak_mb_s = 0.0
        self._t0 = t
        self._b0 = int(bytes_done)
        self._last_short_t = t
        self._last_short_b = int(bytes_done)
        if t is not None:
            self._samples.append((float(t), int(bytes_done)))

    def update(
        self,
        t: float,
        transferred: int,
        *,
        total: int = 0,
    ) -> RateSnapshot:
        t = float(t)
        transferred = max(0, int(transferred))
        total = max(0, int(total))

        if self._t0 is None:
            self._t0 = t
            self._b0 = transferred
            self._last_short_t = t
            self._last_short_b = transferred
            self._samples.append((t, transferred))
            return RateSnapshot(0.0, 0.0, 0.0, None, transferred, total)

        # Monotonic bytes only (ignore out-of-order / lower reports)
        if self._samples and transferred < self._samples[-1][1]:
            transferred = self._samples[-1][1]

        self._samples.append((t, transferred))
        # Drop samples older than 2× window (keep a little history)
        cut = t - self.window_s * 2.5
        while len(self._samples) > 2 and self._samples[0][0] < cut:
            self._samples.popleft()

        window_rate = compute_window_rate_mb_s(
            list(self._samples), now_t=t, window_s=self.window_s
        )

        # Short-interval inst for peak + EWMA
        inst = 0.0
        if self._last_short_t is not None:
            dt = t - self._last_short_t
            if dt >= self.min_interval_s:
                db = transferred - self._last_short_b
                inst = bytes_to_mb_s(db, dt)
                if inst > 0:
                    if self._ewma <= 0:
                        self._ewma = inst
                    else:
                        a = self.ewma_alpha
                        self._ewma = a * inst + (1.0 - a) * self._ewma
                    if inst <= self.peak_cap_mb_s and inst > self.peak_mb_s:
                        self.peak_mb_s = inst
                self._last_short_t = t
                self._last_short_b = transferred
        else:
            self._last_short_t = t
            self._last_short_b = transferred

        # Prefer window rate when we have enough span; blend with EWMA when both alive
        if window_rate > 0 and self._ewma > 0:
            current = 0.65 * window_rate + 0.35 * self._ewma
        elif window_rate > 0:
            current = window_rate
        else:
            current = self._ewma

        # Note: t0 may be 0.0 — never use `t0 or t` (0.0 is falsy in Python).
        t0 = self._t0 if self._t0 is not None else t
        elapsed = max(t - t0, 1e-6)
        lifetime = bytes_to_mb_s(transferred - self._b0, elapsed)
        eta = compute_eta_s(transferred, total, current)
        return RateSnapshot(
            current_mb_s=float(current),
            peak_mb_s=float(self.peak_mb_s),
            lifetime_avg_mb_s=float(lifetime),
            eta_s=eta,
            transferred=transferred,
            total=total,
        )


def scripted_rate_series(
    samples: Sequence[Tuple[float, int]],
    *,
    total: int,
    window_s: float = 2.5,
) -> List[RateSnapshot]:
    """Drive WindowedRateTracker with fixed (t, bytes) samples — for unit tests."""
    tracker = WindowedRateTracker(window_s=window_s)
    out: List[RateSnapshot] = []
    for t, b in samples:
        out.append(tracker.update(t, b, total=total))
    return out
