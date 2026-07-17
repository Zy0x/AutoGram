# AutoGram frontend (Tauri + React + TypeScript)

## Runtime: desktop vs web

- **Desktop (Tauri):** Media Studio, re-encode, local Python/Telethon worker enabled.
- **Web deploy:** set `VITE_RUNTIME=web` so heavy features stay off. See `../docs/development/Web_Deploy.md`.

```bash
npm test
# Web static build (PowerShell):
$env:VITE_RUNTIME="web"; npm run build
```

## Recommended IDE Setup

- [VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)
