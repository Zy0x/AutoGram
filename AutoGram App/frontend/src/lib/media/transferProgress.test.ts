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
    expect(itemLogs[0]).toContain('SELESAI [msg_id: 45009]');
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
    expect(s.debugLogs![0]).toContain('Item 6 (File 6): SELESAI [msg_id: 45009]');

    // Later event arrives with real filename
    s = applyTransferEvent(s, {
      type: 'StudioItemDone',
      index: 5,
      status: 'done',
      message_id: 45009,
      path: '_kayu.tt-21-05-2023-0001.mp4',
    } as any);

    expect(s.debugLogs).toHaveLength(1);
    expect(s.debugLogs![0]).toContain('Item 6 (_kayu.tt-21-05-2023-0001.mp4): SELESAI [msg_id: 45009]');
  });
});

