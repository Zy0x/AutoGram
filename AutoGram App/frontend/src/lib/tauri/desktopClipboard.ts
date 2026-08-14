/**
 * Native Desktop OS Clipboard Utility.
 * Directly interfaces with Windows OS clipboard via Rust native commands without triggering
 * Chromium / WebView2 browser permission popups ("wants to see text and images...").
 */

export async function nativeReadClipboardText(): Promise<string> {
  // 1. Try native Rust command first (instant, 0 permission prompts)
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const res = await invoke<string>('desktop_read_clipboard');
    if (typeof res === 'string' && res.trim()) {
      return res.trim();
    }
  } catch {
    /* not running in Tauri or command unavailable */
  }

  // 2. Fallback to standard web API
  try {
    const webText = await navigator.clipboard?.readText();
    if (webText && typeof webText === 'string') {
      return webText.trim();
    }
  } catch {
    /* permission dismissed or blocked */
  }
  return '';
}

export async function nativeWriteClipboardText(text: string): Promise<boolean> {
  // 1. Try native Rust command first (instant, 0 focus issues)
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('desktop_write_clipboard', { text });
    return true;
  } catch {
    /* fallback */
  }

  // 2. Fallback to standard web API
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fallback to execCommand */
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      return true;
    } catch {
      /* ignore */
    }
  }
  return false;
}
