import { describe, expect, it } from 'vitest';
import type { TransferItem, TransferSession } from '../telegram/driveTypes';
import { EMPTY_TRANSFER_SESSION } from '../telegram/driveTypes';
import {
  appendDebugLog,
  applyTransferEvent,
  recomputeOverall,
  transferItemOverallPercent,
} from './transferProgress';

function item(patch: Partial<TransferItem>): TransferItem {
  return {
    id: 'item',
    index: 0,
    name: 'sample.mp4',
    direction: 'upload',
    status: 'queued',
    percent: 0,
    transferred: 0,
    total: 100,
    speed_mb_s: 0,
    ...patch,
  };
}

function session(items: TransferItem[]): TransferSession {
  return { ...EMPTY_TRANSFER_SESSION, active: true, direction: 'upload', items };
}

describe('transfer progress aggregation', () => {
  it('keeps phase progress cumulative across re-encode, upload, and commit', () => {
    expect(transferItemOverallPercent(item({ status: 'preparing', phase: 'reencode', percent: 50 }))).toBe(17.5);
    expect(transferItemOverallPercent(item({ status: 'active', phase: 'upload', percent: 50 }))).toBe(62.5);
    expect(transferItemOverallPercent(item({ status: 'committing', phase: 'committing', percent: 100 }))).toBe(98);
    expect(transferItemOverallPercent(item({ status: 'done', percent: 100 }))).toBe(100);
  });

  it('shows aggregate progress instead of the active item percentage', () => {
    const items = Array.from({ length: 10 }, (_, index) =>
      item({
        id: `item-${index}`,
        index,
        ...(index === 0
          ? { status: 'active' as const, phase: 'upload', percent: 50, transferred: 50 }
          : {}),
      })
    );
    expect(recomputeOverall(session(items)).overallPercent).toBe(6.25);
  });

  it('weights large items without treating re-encode counters as uploaded bytes', () => {
    const result = recomputeOverall(session([
      item({ id: 'large', total: 900, status: 'preparing', phase: 'reencode', percent: 100, transferred: 9999 }),
      item({ id: 'small', index: 1, total: 100, status: 'done', percent: 100, transferred: 100 }),
    ]));
    expect(result.overallPercent).toBe(37);
    expect(result.transferred).toBe(100);
  });

  it('correctly calculates 0% overall progress when all items fail', () => {
    const result = recomputeOverall(session([
      item({ id: 'f1', total: 500, status: 'failed', percent: 0, transferred: 0 }),
      item({ id: 'f2', index: 1, total: 500, status: 'failed', percent: 0, transferred: 0 }),
    ]));
    expect(result.overallPercent).toBe(0);
    expect(result.transferred).toBe(0);
  });

  it('correctly calculates partial progress when some items succeed and others fail', () => {
    const result = recomputeOverall(session([
      item({ id: 'ok1', total: 500, status: 'done', percent: 100, transferred: 500 }),
      item({ id: 'fail1', index: 1, total: 500, status: 'failed', percent: 0, transferred: 0 }),
    ]));
    expect(result.overallPercent).toBe(50);
    expect(result.transferred).toBe(500);
  });
});

describe('debug log deduplication and stream stability', () => {
  it('deduplicates consecutive identical logs', () => {
    let s = session([]);
    s = { ...s, debugLogs: appendDebugLog(s, 'Mulai transfer upload (16 item)') };
    s = { ...s, debugLogs: appendDebugLog(s, 'Mulai transfer upload (16 item)') };
    s = { ...s, debugLogs: appendDebugLog(s, 'Mulai transfer upload (16 item)') };
    expect(s.debugLogs).toHaveLength(1);
    expect(s.debugLogs![0]).toContain('Mulai transfer upload (16 item)');
  });

  it('deduplicates multiple start transfer events even if called multiple times', () => {
    let s = session([]);
    s = applyTransferEvent(s, { type: 'StudioStarted', items: 16, mode: 'upload' } as any);
    s = applyTransferEvent(s, { type: 'StudioStarted', items: 16, mode: 'upload' } as any);
    s = applyTransferEvent(s, { type: 'StudioStarted', items: 16, mode: 'upload' } as any);
    const startLogs = (s.debugLogs || []).filter((l) => l.includes('Mulai transfer upload (16 item)'));
    expect(startLogs).toHaveLength(1);
  });

  it('deduplicates identical item terminal events', () => {
    let s = session([item({ index: 5, name: 'File 6' })]);
    s = applyTransferEvent(s, {
      type: 'StudioItemDone',
      index: 5,
      status: 'done',
      message_id: 45009,
      path: 'File 6',
    } as any);
    s = applyTransferEvent(s, {
      type: 'StudioItemDone',
      index: 5,
      status: 'done',
      message_id: 45009,
      path: 'File 6',
    } as any);
    s = applyTransferEvent(s, {
      type: 'StudioItemDone',
      index: 5,
      status: 'done',
      message_id: 45009,
      path: 'File 6',
    } as any);

    const itemLogs = (s.debugLogs || []).filter((l) => l.includes('Item 6'));
    expect(itemLogs).toHaveLength(1);
    expect(itemLogs[0]).toContain('Selesai [ID: 45009]');
  });

  it('upgrades placeholder (File N) to actual filename in-place without duplicate log lines', () => {
    let s = session([item({ index: 5, name: 'File 6' })]);
    s = applyTransferEvent(s, {
      type: 'StudioItemDone',
      index: 5,
      status: 'done',
      message_id: 45009,
      path: 'File 6',
    } as any);
    expect(s.debugLogs).toHaveLength(1);
    expect(s.debugLogs![0]).toContain('Item 6 (File 6): Selesai [ID: 45009]');

    // Later event arrives with real filename
    s = applyTransferEvent(s, {
      type: 'StudioItemDone',
      index: 5,
      status: 'done',
      message_id: 45009,
      path: '_kayu.tt-21-05-2023-0001.mp4',
    } as any);

    expect(s.debugLogs).toHaveLength(1);
    expect(s.debugLogs![0]).toContain('Item 6 (_kayu.tt-21-05-2023-0001.mp4): Selesai [ID: 45009]');
  });

  it('filters out raw developer telemetry strings', () => {
    let s = session([]);
    s = { ...s, debugLogs: appendDebugLog(s, 'item_count=6 anchor_message_id=45009') };
    s = { ...s, debugLogs: appendDebugLog(s, 'action=skip_reupload index=5') };
    expect(s.debugLogs || []).toHaveLength(0);
  });

  it('does not spam intermediate probe/prepare steps, but logs re-encoding and summary', () => {
    let s = session([item({ index: 0, name: 'video.mp4' })]);
    // Normal probe should not generate a debug log
    s = applyTransferEvent(s, {
      type: 'StudioItemPrepare',
      index: 0,
      phase: 'probe',
      path: 'video.mp4',
    } as any);
    expect(s.debugLogs || []).toHaveLength(0);

    // Active reencode should generate a helpful log
    s = applyTransferEvent(s, {
      type: 'StudioItemPrepare',
      index: 0,
      phase: 'reencode',
      path: 'video.mp4',
    } as any);
    expect(s.debugLogs || []).toHaveLength(1);
    expect(s.debugLogs![0]).toContain('Mengoptimalkan format video');

    // Item done
    s = applyTransferEvent(s, {
      type: 'StudioItemDone',
      index: 0,
      status: 'done',
      message_id: 101,
      path: 'video.mp4',
    } as any);
    expect(s.debugLogs || []).toHaveLength(2);

    // StudioFinished appends a clean summary
    s = applyTransferEvent(s, {
      type: 'StudioFinished',
    } as any);
    const finishedLogs = (s.debugLogs || []).filter((l) => l.includes('Transfer selesai:'));
    expect(finishedLogs).toHaveLength(1);
    expect(finishedLogs[0]).toContain('1 dari 1 berkas berhasil');
  });
});

describe('batch estimation, commit byte stability and ETA handling', () => {
  it('does NOT jump to 98% when only 1 out of 100 files is completed with unprobed items', () => {
    // 100 items: Item 0 is 50 MB and done. Items 1..99 are queued with unprobed total: 0.
    const items: TransferItem[] = [
      item({ id: 'done-0', index: 0, total: 50_000_000, transferred: 50_000_000, status: 'done', percent: 100 }),
      ...Array.from({ length: 99 }, (_, i) =>
        item({ id: `queued-${i + 1}`, index: i + 1, total: 0, transferred: 0, status: 'queued', percent: 0 })
      ),
    ];
    const res = recomputeOverall(session(items));
    // 1 out of 100 done should be exactly 1%, NOT 98%+
    expect(res.overallPercent).toBe(1);
    expect(res.transferred).toBe(50_000_000);
    // Estimated batch total should be 100 * 50 MB = 5,000,000,000 bytes
    expect(res.estimatedTotalBytes).toBe(5_000_000_000);
    expect(res.knownCount).toBe(1);
  });

  it('keeps transferred bytes intact without collapsing to 0 during committing phase', () => {
    const itm = item({
      id: 'active-item',
      total: 30_000_000,
      transferred: 30_000_000,
      status: 'committing',
      phase: 'commit',
      percent: 100,
    });
    const res = recomputeOverall(session([itm]));
    expect(res.transferred).toBe(30_000_000);
    expect(res.overallPercent).toBe(98);
  });

  it('keeps transferred bytes intact for waiting_commit and uploaded items', () => {
    const items = [
      item({ id: 'item-1', total: 20_000_000, transferred: 20_000_000, status: 'uploaded', phase: 'upload', percent: 100 }),
      item({ id: 'item-2', total: 20_000_000, transferred: 20_000_000, status: 'waiting_commit', phase: 'commit', percent: 100 }),
    ];
    const res = recomputeOverall(session(items));
    expect(res.transferred).toBe(40_000_000);
    expect(res.overallPercent).toBe(95);
  });

  it('distinguishes batch ETA from active item ETA in multi-item transfers', () => {
    const items: TransferItem[] = [
      item({ id: 'item-0', index: 0, total: 10_000_000, transferred: 5_000_000, status: 'active', percent: 50 }),
      item({ id: 'item-1', index: 1, total: 10_000_000, transferred: 0, status: 'queued', percent: 0 }),
    ];
    let s = session(items);
    s.speed_mb_s = 2; // 2 MB/s
    // apply progress event with item eta_s = 2.5s (5MB remaining for item 0 at 2MB/s)
    s = applyTransferEvent(s, {
      type: 'StudioProgress',
      item_index: 0,
      transferred: 5_000_000,
      item_current: 5_000_000,
      item_total: 10_000_000,
      total: 20_000_000,
      speed_mb_s: 2,
      eta_s: 3,
    } as any);

    // Active item 0 gets its specific eta (3s)
    expect(s.items[0].etaSeconds).toBe(3);
    // Session batch ETA reflects total remaining (15MB at 2MB/s ~ 7.15s), NOT overwriting with 3s
    expect(s.etaSeconds).toBeGreaterThanOrEqual(7);
  });
});

