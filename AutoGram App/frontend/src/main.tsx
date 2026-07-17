import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import "./i18n";

/** WebView2 / Edge PDF viewer injects scripts that throw TypeError on `.plugins`
 *  (Chrome extension API). Not our code — swallow to avoid red noise + hard-close. */
function isWebViewHostNoise(msg: unknown, filename?: string | null): boolean {
  const m = String(msg ?? "");
  const f = String(filename ?? "");
  if (/reading ['"]plugins['"]/i.test(m)) return true;
  // Host PDF/viewer frames often report empty or chrome-extension filenames
  if (!f && /plugins/i.test(m)) return true;
  if (/chrome-extension:|edge:\/\/|chromewebdata/i.test(f)) return true;
  return false;
}

// Soften uncaught errors so the Tauri webview is less likely to hard-close
window.addEventListener("error", (ev) => {
  if (isWebViewHostNoise(ev.message || ev.error, ev.filename)) {
    ev.preventDefault();
    return;
  }
  console.error("[window.error]", ev.error || ev.message);
});
window.addEventListener("unhandledrejection", (ev) => {
  if (isWebViewHostNoise(ev.reason)) {
    try {
      ev.preventDefault();
    } catch {
      /* ignore */
    }
    return;
  }
  console.error("[unhandledrejection]", ev.reason);
  // Prevent default hard-fail behavior where supported
  try {
    ev.preventDefault();
  } catch {
    /* ignore */
  }
});

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
