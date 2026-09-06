import { describe, expect, it } from 'vitest';
import permissions from '../../../src-tauri/permissions/autogram-commands.toml?raw';
import entrypoint from '../../../src-tauri/src/lib.rs?raw';
import capability from '../../../src-tauri/capabilities/default.json';
import remoteTransferApi from '../../lib/telegram/remoteTransferApi.ts?raw';

describe('Local download native IPC boundary', () => {
  for (const command of ['remote_download_start', 'remote_download_list', 'remote_download_control']) {
    it(`registers and authorizes ${command} for the main desktop window`, () => {
      const mainPermission = permissions.split('[[permission]]')
        .find(section => section.includes('identifier = "allow-custom-commands"'));
      expect(mainPermission).toContain(`"${command}"`);
      expect(entrypoint).toContain(`core::remote_download::${command},`);
      expect(capability.windows).toContain('main');
      expect(capability.permissions).toContain('allow-custom-commands');
    });
  }
  it('also authorizes the existing remote transfer adapter commands', () => {
    const adapterCommands = [...remoteTransferApi.matchAll(/['"](remote_transfer_\w+)['"]/g)]
      .map(match => match[1]);
    expect(adapterCommands.length).toBeGreaterThan(0);
    const mainPermission = permissions.split('[[permission]]')
      .find(section => section.includes('identifier = "allow-custom-commands"'));
    for (const command of adapterCommands) {
      expect(mainPermission).toContain(`"${command}"`);
      expect(entrypoint).toMatch(new RegExp(`\\s${command},`));
    }
  });
});
