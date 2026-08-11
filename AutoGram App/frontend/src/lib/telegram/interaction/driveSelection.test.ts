import { describe, expect, it } from 'vitest';
import { shouldStartExplorerMarquee } from './driveSelection';

describe('shouldStartExplorerMarquee', () => {
  it('starts on empty canvas with the primary pointer', () => {
    expect(shouldStartExplorerMarquee({ button: 0, overCard: false, overControl: false })).toBe(true);
  });

  it('lets a plain card gesture remain card drag', () => {
    expect(shouldStartExplorerMarquee({ button: 0, overCard: true, overControl: false })).toBe(false);
  });

  it('allows Ctrl or Cmd marquee to begin over a card', () => {
    expect(shouldStartExplorerMarquee({ button: 0, overCard: true, overControl: false, ctrlKey: true })).toBe(true);
    expect(shouldStartExplorerMarquee({ button: 0, overCard: true, overControl: false, metaKey: true })).toBe(true);
  });

  it('never steals nested controls or non-primary pointers', () => {
    expect(shouldStartExplorerMarquee({ button: 0, overCard: true, overControl: true, ctrlKey: true })).toBe(false);
    expect(shouldStartExplorerMarquee({ button: 2, overCard: false, overControl: false })).toBe(false);
  });
});
