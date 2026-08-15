import { describe, expect, it } from 'vitest';
import {
  buildMediaScanScopeKey,
  createInitialScanState,
  formatMediaScanHeaderInfo,
  formatMediaTotalSize,
  verifyTerminalCompletion,
} from './mediaScanStateMachine';

describe('mediaScanStateMachine', () => {
  it('buildMediaScanScopeKey builds composite scope key', () => {
    const key = buildMediaScanScopeKey({
      accountId: 'session1',
      peerId: '-1004468191168',
      topicId: 73,
      mediaFilter: 'photos',
      searchQuery: 'Test Query ',
    });
    expect(key).toBe('session1:-1004468191168:73:photos:test query');
  });

  it('verifyTerminalCompletion: Raw empty response (0 items) produces complete_verified', () => {
    const res = verifyTerminalCompletion({
      isSuccess: true,
      requestGeneration: 1,
      activeGeneration: 1,
      hasFloodWait: false,
      hasTimeoutOrNetworkError: false,
      failedPageCount: 0,
      pendingPageCount: 0,
      hasCursorGap: false,
      rawFetchedPageLength: 0,
      serverTotalCount: 120,
      serverCountExact: true,
      indexedUniqueCount: 120,
    });
    expect(res.isCompleteVerified).toBe(true);
    expect(res.terminalReason).toBe('empty_server_page');
  });

  it('verifyTerminalCompletion: Exact total count reached produces complete_verified', () => {
    const res = verifyTerminalCompletion({
      isSuccess: true,
      requestGeneration: 2,
      activeGeneration: 2,
      hasFloodWait: false,
      hasTimeoutOrNetworkError: false,
      failedPageCount: 0,
      pendingPageCount: 0,
      hasCursorGap: false,
      rawFetchedPageLength: 10,
      serverTotalCount: 100,
      serverCountExact: true,
      indexedUniqueCount: 100,
    });
    expect(res.isCompleteVerified).toBe(true);
    expect(res.terminalReason).toBe('exact_total_reached_without_gap');
  });

  it('verifyTerminalCompletion: FloodWait MUST NOT produce complete_verified', () => {
    const res = verifyTerminalCompletion({
      isSuccess: false,
      requestGeneration: 1,
      activeGeneration: 1,
      hasFloodWait: true,
      hasTimeoutOrNetworkError: false,
      failedPageCount: 0,
      pendingPageCount: 0,
      hasCursorGap: false,
      rawFetchedPageLength: 0,
      serverTotalCount: 100,
      serverCountExact: true,
      indexedUniqueCount: 50,
    });
    expect(res.isCompleteVerified).toBe(false);
    expect(res.terminalReason).toBe('request_failed');
  });

  it('verifyTerminalCompletion: Timeout MUST NOT produce complete_verified', () => {
    const res = verifyTerminalCompletion({
      isSuccess: false,
      requestGeneration: 1,
      activeGeneration: 1,
      hasFloodWait: false,
      hasTimeoutOrNetworkError: true,
      failedPageCount: 1,
      pendingPageCount: 0,
      hasCursorGap: false,
      rawFetchedPageLength: 0,
      serverTotalCount: 100,
      serverCountExact: true,
      indexedUniqueCount: 50,
    });
    expect(res.isCompleteVerified).toBe(false);
  });

  it('verifyTerminalCompletion: Short page (< pageSize) but rawFetchedPageLength > 0 without reaching exact count MUST NOT produce complete_verified', () => {
    const res = verifyTerminalCompletion({
      isSuccess: true,
      requestGeneration: 1,
      activeGeneration: 1,
      hasFloodWait: false,
      hasTimeoutOrNetworkError: false,
      failedPageCount: 0,
      pendingPageCount: 0,
      hasCursorGap: false,
      rawFetchedPageLength: 15, // short page (pageSize was 40)
      serverTotalCount: 100,
      serverCountExact: false, // inexact count!
      indexedUniqueCount: 45,
    });
    expect(res.isCompleteVerified).toBe(false);
  });

  it('formatMediaTotalSize follows Section B7 rules', () => {
    const mockFormat = (b: number) => `${(b / 1024 / 1024 / 1024).toFixed(2)} GB`;
    const scope = {
      accountId: 'acc1',
      peerId: 'peer1',
      topicId: 0,
      mediaFilter: 'all',
      searchQuery: '',
    };

    // Incomplete scan: "90,13 GB terindeks"
    const partialState = {
      ...createInitialScanState(scope),
      status: 'partial' as const,
      indexedBytes: BigInt(90130000000),
    };
    expect(formatMediaTotalSize(partialState, mockFormat)).toBe('83.94 GB terindeks');

    // Complete verified with unknown sizes: "Setidaknya 298,85 GB"
    const completeUnknownState = {
      ...createInitialScanState(scope),
      status: 'complete_verified' as const,
      indexedBytes: BigInt(298850000000),
      unknownSizeCount: 3,
    };
    expect(formatMediaTotalSize(completeUnknownState, mockFormat)).toBe('Setidaknya 278.33 GB');

    // Complete verified with all known sizes: "298,85 GB"
    const completeExactState = {
      ...createInitialScanState(scope),
      status: 'complete_verified' as const,
      indexedBytes: BigInt(298850000000),
      unknownSizeCount: 0,
    };
    expect(formatMediaTotalSize(completeExactState, mockFormat)).toBe('278.33 GB');
  });

  it('formatMediaScanHeaderInfo displays rate limit countdowns and status info', () => {
    const mockFormat = (b: number) => `${b} B`;
    const scope = {
      accountId: 'acc1',
      peerId: 'peer1',
      topicId: 0,
      mediaFilter: 'all',
      searchQuery: '',
    };

    const rateLimitedState = {
      ...createInitialScanState(scope),
      status: 'rate_limited' as const,
      indexedUniqueCount: 4280,
      serverTotalCount: 12780,
      serverCountInexact: true,
      retryAfterAt: Date.now() + 24000,
    };

    const info = formatMediaScanHeaderInfo(rateLimitedState, mockFormat);
    expect(info.countText).toContain('4.280 / sekitar 12.780 media');
    expect(info.statusText).toContain('Dijeda Telegram selama 24 detik');
    expect(info.isComplete).toBe(false);
  });
});
