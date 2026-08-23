/**
 * pathSearchParser.test.ts
 * Unit tests for the Telegram Path ID parser.
 */
import { describe, expect, it } from 'vitest';
import { parseTelegramPathId, normalizePeerId } from './pathSearchParser';

describe('normalizePeerId', () => {
  it('keeps negative ids as-is', () => {
    expect(normalizePeerId('-1003214112048')).toBe(-1003214112048);
  });

  it('converts large positive channel id to -100xxx form', () => {
    // 1003214112048 -> -(1_000_000_000_000 + 1003214112048)
    const expected = -(1_000_000_000_000 + 1003214112048);
    expect(normalizePeerId('1003214112048')).toBe(expected);
  });

  it('returns null for empty', () => {
    expect(normalizePeerId('')).toBeNull();
  });

  it('returns small positive number as-is (user/bot id)', () => {
    expect(normalizePeerId('123456789')).toBe(123456789);
  });
});

describe('parseTelegramPathId', () => {
  it('keeps bot ids positive instead of coercing them to channel ids', () => {
    const r = parseTelegramPathId('U862678085/B1825028508');
    expect(r.isPathId).toBe(true);
    expect(r.accountSegment).toBe('862678085');
    expect(r.chatId).toBe(1825028508);
  });

  it('normalizes explicit channel prefixes to canonical -100 ids', () => {
    expect(parseTelegramPathId('CH2557538013/63280').chatId).toBe(-1002557538013);
  });

  it('returns isPathId false for plain text', () => {
    expect(parseTelegramPathId('hello world').isPathId).toBe(false);
    expect(parseTelegramPathId('').isPathId).toBe(false);
  });

  it('parses full U/D/T/M path', () => {
    const r = parseTelegramPathId('U8542241823/D-1003214112048/T8/20213');
    expect(r.isPathId).toBe(true);
    expect(r.accountSegment).toBe('8542241823');
    expect(r.chatId).toBe(-1003214112048);
    expect(r.topicId).toBe(8);
    expect(r.messageId).toBe(20213);
    expect(r.confidence).toBe('full');
  });

  it('parses lowercase u/d/t prefixes', () => {
    const r = parseTelegramPathId('u8542241823/d-1003214112048/t8/20213');
    expect(r.accountSegment).toBe('8542241823');
    expect(r.chatId).toBe(-1003214112048);
    expect(r.topicId).toBe(8);
    expect(r.messageId).toBe(20213);
  });

  it('parses D+T only (no account, no media)', () => {
    const r = parseTelegramPathId('D-1003214112048/T8');
    expect(r.isPathId).toBe(true);
    expect(r.accountSegment).toBeNull();
    expect(r.chatId).toBe(-1003214112048);
    expect(r.topicId).toBe(8);
    expect(r.messageId).toBeNull();
  });

  it('parses D+messageId only', () => {
    const r = parseTelegramPathId('D-1003214112048/20213');
    expect(r.chatId).toBe(-1003214112048);
    expect(r.topicId).toBeNull();
    expect(r.messageId).toBe(20213);
  });

  it('parses U+D only', () => {
    const r = parseTelegramPathId('U8542241823/D-1003214112048');
    expect(r.accountSegment).toBe('8542241823');
    expect(r.chatId).toBe(-1003214112048);
    expect(r.topicId).toBeNull();
    expect(r.messageId).toBeNull();
  });

  it('parses bare negative peer id', () => {
    const r = parseTelegramPathId('-1003214112048');
    expect(r.isPathId).toBe(true);
    expect(r.chatId).toBe(-1003214112048);
    expect(r.messageId).toBeNull();
  });

  it('parses @username', () => {
    const r = parseTelegramPathId('@mychannelname');
    expect(r.isPathId).toBe(true);
    expect(r.chatSegmentRaw).toBe('mychannelname');
    expect(r.chatId).toBeNull();
  });

  it('parses t.me channel URL with 3 segments (topic + msg)', () => {
    const r = parseTelegramPathId('https://t.me/c/1003214112048/8/20213');
    expect(r.isPathId).toBe(true);
    expect(r.chatSegmentRaw).toBe('1003214112048');
    expect(r.topicId).toBe(8);
    expect(r.messageId).toBe(20213);
  });

  it('parses t.me channel URL with 2 segments (msg only)', () => {
    const r = parseTelegramPathId('t.me/c/1003214112048/20213');
    expect(r.chatSegmentRaw).toBe('1003214112048');
    expect(r.topicId).toBeNull();
    expect(r.messageId).toBe(20213);
  });

  it('parses t.me public URL with username', () => {
    const r = parseTelegramPathId('https://t.me/mygroup/20213');
    expect(r.isPathId).toBe(true);
    expect(r.tmeUsername).toBe('mygroup');
    expect(r.messageId).toBe(20213);
    expect(r.chatId).toBeNull();
  });

  it('parses D+T+M with G prefix (group)', () => {
    const r = parseTelegramPathId('G-1003214112048/T1/1000');
    expect(r.chatId).toBe(-1003214112048);
    expect(r.topicId).toBe(1);
    expect(r.messageId).toBe(1000);
  });

  it('does not treat short 4-digit number as peer id', () => {
    const r = parseTelegramPathId('1234');
    expect(r.isPathId).toBe(false);
  });
});
