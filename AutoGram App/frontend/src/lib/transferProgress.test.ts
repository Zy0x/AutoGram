import { describe, it, expect } from 'vitest';
import {
  applyTransferEvent,
  seedTransferSession,
  markTransferFinished,
  setSessionPaused,
  clearFinishedItems,
} from './transferProgress';

describe('seedTransferSession', () => {
  it('seeds names and direction for upload', () => {
    const s = seedTransferSession({
      direction: 'upload',
      names: ['a.pdf', 'b.mp4'],
      label: '→ Saved Messages',
    });
    expect(s.active).toBe(true);
    expect(s.direction).toBe('upload');
    expect(s.items).toHaveLength(2);
    expect(s.items[0].name).toBe('a.pdf');
    expect(s.items[0].status).toBe('queued');
    expect(s.label).toContain('Saved');
  });
});

describe('applyTransferEvent', () => {
  it('does not clobber filename with message_id', () => {
    let s = seedTransferSession({
      direction: 'download',
      names: ['report.pdf'],
    });
    s = applyTransferEvent(s, {
      type: 'DriveProgress',
      payload: {
        phase: 'download',
        message_id: 99999,
        percent: 40,
        speed_mb_s: 1.5,
        peak_mb_s: 2,
        item_index: 0,
        items_total: 1,
        transferred: 400,
        total: 1000,
      },
    });
    expect(s.items[0].name).toBe('report.pdf');
    expect(s.direction).toBe('download');
    expect(s.overallPercent).toBeGreaterThanOrEqual(40);
    expect(s.speed_mb_s).toBe(1.5);
    expect(s.label).not.toMatch(/msg 99999/);
  });

  it('reads phase=download from DriveProgress even if session started as upload default', () => {
    let s = seedTransferSession({ direction: 'upload', names: ['x'] });
    // User actually downloading — event carries phase
    s = applyTransferEvent(s, {
      type: 'DriveProgress',
      phase: 'download',
      percent: 10,
      item_index: 0,
      items_total: 1,
      transferred: 10,
      total: 100,
      speed_mb_s: 0.5,
    });
    expect(s.direction).toBe('download');
  });

  it('updates item name from StudioItemStarted path', () => {
    let s = seedTransferSession({ direction: 'upload', names: ['placeholder'] });
    s = applyTransferEvent(s, {
      type: 'StudioItemStarted',
      index: 0,
      path: 'C:\\Users\\me\\video.mp4',
      size: 5_000_000,
    });
    expect(s.items[0].name).toBe('video.mp4');
    expect(s.items[0].status).toBe('active');
    expect(s.items[0].total).toBe(5_000_000);
  });

  it('marks item done without wiping other queued names', () => {
    let s = seedTransferSession({
      direction: 'upload',
      names: ['a.jpg', 'b.jpg'],
    });
    s = applyTransferEvent(s, {
      type: 'StudioItemDone',
      index: 0,
      status: 'done',
      size: 100,
      message_id: 123,
    });
    expect(s.items[0].status).toBe('done');
    expect(s.items[1].name).toBe('b.jpg');
    expect(s.items[1].status).toBe('queued');
  });

  it('computes ETA when total and speed known', () => {
    let s = seedTransferSession({
      direction: 'upload',
      names: ['big.bin'],
      totals: [10 * 1024 * 1024],
    });
    s = applyTransferEvent(s, {
      type: 'StudioProgress',
      phase: 'upload',
      transferred: 5 * 1024 * 1024,
      total: 10 * 1024 * 1024,
      percent: 50,
      speed_mb_s: 1.0,
      item_index: 0,
      items_total: 1,
      item_current: 5 * 1024 * 1024,
      item_total: 10 * 1024 * 1024,
    });
    expect(s.etaSeconds).not.toBeNull();
    expect(s.etaSeconds!).toBeGreaterThan(0);
    expect(s.etaSeconds!).toBeLessThan(30);
  });

  it('FloodWait sets banner without changing names', () => {
    let s = seedTransferSession({ direction: 'download', names: ['f.mp4'] });
    s = applyTransferEvent(s, { type: 'FloodWait', seconds: 12 });
    expect(s.banner).toMatch(/FloodWait/);
    expect(s.banner).toMatch(/12/);
    expect(s.items[0].name).toBe('f.mp4');
  });

  it('keeps re-encode telemetry separate from upload bytes', () => {
    let s = seedTransferSession({
      direction: 'upload',
      names: ['video.webm'],
      totals: [900_000_000],
    });
    s = applyTransferEvent(s, {
      type: 'StudioReencodeStarted',
      index: 0,
      backend: 'nvidia',
      encoder: 'h264_nvenc',
      decoder: 'CUDA/NVDEC',
    });
    s = applyTransferEvent(s, {
      type: 'StudioReencodeProgress',
      index: 0,
      percent: 42.5,
      fps: 184,
      speed_x: 6.2,
      estimated_output_bytes: 410_000_000,
      eta_s: 31,
    });
    expect(s.items[0].phase).toBe('reencode');
    expect(s.items[0].encoderBackend).toBe('nvidia');
    expect(s.items[0].decoderName).toBe('CUDA/NVDEC');
    expect(s.items[0].percent).toBe(42.5);
    expect(s.items[0].encodeSpeed).toBe(6.2);
    expect(s.items[0].estimatedOutputBytes).toBe(410_000_000);
    expect(s.transferred).toBe(0);
    expect(s.speed_mb_s).toBe(0);
  });

  it('StudioFinished never synthesizes upload success', () => {
    let s = seedTransferSession({ direction: 'upload', names: ['a', 'b'] });
    s = applyTransferEvent(s, { type: 'StudioItemStarted', index: 0, path: 'a' });
    s = applyTransferEvent(s, { type: 'StudioFinished', done: 2, failed: 0 });
    expect(s.active).toBe(false);
    expect(s.overallPercent).toBe(100);
    expect(s.items.every((item) => item.status === 'failed')).toBe(true);
    expect(s.items[0].error).toContain('message_id');
  });

  it('done+messageId then failed StudioItemDone stays done (false gagal)', () => {
    let s = seedTransferSession({ direction: 'upload', names: ['big.mp4'] });
    s = applyTransferEvent(s, {
      type: 'StudioItemDone',
      index: 0,
      status: 'done',
      message_id: 424242,
      size: 1_500_000_000,
    });
    expect(s.items[0].status).toBe('done');
    expect(s.items[0].messageId).toBe(424242);
    s = applyTransferEvent(s, {
      type: 'StudioItemDone',
      index: 0,
      status: 'failed',
      error: 'post-commit noise',
    });
    expect(s.items[0].status).toBe('done');
    expect(s.items[0].messageId).toBe(424242);
    expect(s.items[0].error).toBeUndefined();
  });

  it('upload done without messageId is not accepted as committed', () => {
    let s = seedTransferSession({ direction: 'upload', names: ['ok.mp4'] });
    s = applyTransferEvent(s, {
      type: 'StudioItemDone',
      index: 0,
      status: 'done',
    });
    expect(s.items[0].status).toBe('failed');
    s = applyTransferEvent(s, {
      type: 'StudioItemDone',
      index: 0,
      status: 'failed',
      error: 'should not downgrade',
    });
    expect(s.items[0].status).toBe('failed');
  });

  it('tracks media registration, ordered commit, and ambiguous terminal separately', () => {
    let s = seedTransferSession({ direction: 'upload', names: ['a.mp4'] });
    s = applyTransferEvent(s, { type: 'StudioItemPhase', index: 0, phase: 'media_registered' });
    expect(s.items[0].status).toBe('uploaded');
    s = applyTransferEvent(s, { type: 'StudioItemPhase', index: 0, phase: 'committing' });
    expect(s.items[0].status).toBe('committing');
    s = applyTransferEvent(s, {
      type: 'StudioItemDone',
      index: 0,
      status: 'needs_verification',
      error: 'timeout after sendMedia',
    });
    expect(s.items[0].status).toBe('needs_verification');
    expect(s.needsVerificationCount).toBe(1);
    expect(s.overallPercent).toBe(100);
  });

  it('failed event carrying message_id becomes done', () => {
    let s = seedTransferSession({ direction: 'upload', names: ['landed.mp4'] });
    s = applyTransferEvent(s, {
      type: 'StudioItemDone',
      index: 0,
      status: 'failed',
      error: 'confused worker',
      message_id: 999001,
    });
    expect(s.items[0].status).toBe('done');
    expect(s.items[0].messageId).toBe(999001);
  });

  it('StudioFailed after all items done does not paint session failed', () => {
    let s = seedTransferSession({ direction: 'upload', names: ['a.mp4'] });
    s = applyTransferEvent(s, {
      type: 'StudioItemDone',
      index: 0,
      status: 'done',
      message_id: 7,
    });
    s = applyTransferEvent(s, {
      type: 'StudioFailed',
      error: 'disconnect after success',
    });
    expect(s.items[0].status).toBe('done');
    expect(s.active).toBe(false);
    // banner cleared / not total-fail for all-done
    expect(s.banner).toBeUndefined();
  });
});

describe('pause / clear / finish helpers', () => {
  it('setSessionPaused marks queued as paused', () => {
    let s = seedTransferSession({ direction: 'upload', names: ['a', 'b'] });
    s = applyTransferEvent(s, {
      type: 'StudioItemStarted',
      index: 0,
      path: 'a',
    });
    s = setSessionPaused(s, true);
    expect(s.paused).toBe(true);
    expect(s.items[0].status).toBe('active');
    expect(s.items[1].status).toBe('paused');
  });

  it('clearFinishedItems removes done/failed', () => {
    let s = seedTransferSession({ direction: 'upload', names: ['a', 'b'] });
    s = applyTransferEvent(s, {
      type: 'StudioItemDone',
      index: 0,
      status: 'done',
    });
    s = markTransferFinished(s, 'done');
    s = clearFinishedItems(s);
    expect(s.items.length).toBe(0);
    expect(s.active).toBe(false);
  });
});
