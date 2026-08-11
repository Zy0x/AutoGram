export function chatFolderDropKey(folderId: number): string {
  return `chatfolder:${folderId}`;
}

export function parseChatFolderDropKey(key: string | null | undefined): number | null {
  if (!key || !key.startsWith('chatfolder:')) return null;
  const id = Number(key.slice('chatfolder:'.length));
  return Number.isFinite(id) ? id : null;
}

export function chatFolderDropKeyAtPoint(clientX: number, clientY: number): string | null {
  if (typeof document === 'undefined' || typeof document.elementsFromPoint !== 'function') return null;
  for (const element of document.elementsFromPoint(clientX, clientY)) {
    const key = element.closest?.('[data-drop-key^="chatfolder:"]')?.getAttribute('data-drop-key');
    if (parseChatFolderDropKey(key) != null) return key || null;
  }
  return null;
}
