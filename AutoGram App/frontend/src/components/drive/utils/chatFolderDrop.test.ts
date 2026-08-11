import { describe, expect, it } from 'vitest';
import { parseDropKey } from '../../../lib/telegram/interaction/driveDrag';
import { chatFolderDropKey, parseChatFolderDropKey } from './chatFolderDrop';

describe('Telegram chat-folder drag keys', () => {
  it('round-trips an organizational folder key', () => {
    const key = chatFolderDropKey(17);
    expect(key).toBe('chatfolder:17');
    expect(parseChatFolderDropKey(key)).toBe(17);
  });

  it('never treats an organizational folder as a media move destination', () => {
    expect(parseDropKey('chatfolder:17')).toBeNull();
    expect(parseChatFolderDropKey('chat:-1001')).toBeNull();
  });
});
