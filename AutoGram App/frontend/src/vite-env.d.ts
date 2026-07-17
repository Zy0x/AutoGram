/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Force runtime: "web" | "desktop". When unset, detect via isTauri(). */
  readonly VITE_RUNTIME?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
