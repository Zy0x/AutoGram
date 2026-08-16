import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

function remoteMetaPlugin() {
  return {
    name: 'autogram-remote-meta-proxy',
    configureServer(server: any) {
      server.middlewares.use(async (req: any, res: any, next: any) => {
        if (req.url && req.url.startsWith('/__autogram_remote_meta')) {
          try {
            const parsedUrl = new URL(req.url, 'http://localhost:1420');
            const targetUrl = parsedUrl.searchParams.get('url');
            if (!targetUrl) {
              res.statusCode = 400;
              res.end(JSON.stringify({ error: 'missing url' }));
              return;
            }
            const fetchResp = await fetch(targetUrl, {
              headers: {
                'User-Agent':
                  'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1',
                Accept:
                  'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9',
              },
            });
            const html = await fetchResp.text();
            let avatarLarger: string | null = null;
            let avatarMedium: string | null = null;
            let nickname: string | null = null;
            let signature: string | null = null;

            const pos = html.indexOf('"avatarLarger":"');
            if (pos !== -1) {
              const start = pos + 16;
              const end = html.indexOf('"', start);
              if (end !== -1) {
                avatarLarger = html
                  .slice(start, end)
                  .replace(/\\u0026/g, '&')
                  .replace(/\\u002F/g, '/')
                  .replace(/\\/g, '');
              }
            }

            const posMed = html.indexOf('"avatarMedium":"');
            if (posMed !== -1) {
              const start = posMed + 16;
              const end = html.indexOf('"', start);
              if (end !== -1) {
                avatarMedium = html
                  .slice(start, end)
                  .replace(/\\u0026/g, '&')
                  .replace(/\\u002F/g, '/')
                  .replace(/\\/g, '');
              }
            }

            const nickPos = html.indexOf('"nickname":"');
            if (nickPos !== -1) {
              const start = nickPos + 12;
              const end = html.indexOf('"', start);
              if (end !== -1) {
                nickname = html
                  .slice(start, end)
                  .replace(/\\u0026/g, '&')
                  .replace(/\\u002F/g, '/')
                  .replace(/\\/g, '');
              }
            }

            const sigPos = html.indexOf('"signature":"');
            if (sigPos !== -1) {
              const start = sigPos + 13;
              const end = html.indexOf('"', start);
              if (end !== -1) {
                signature = html
                  .slice(start, end)
                  .replace(/\\u0026/g, '&')
                  .replace(/\\u002F/g, '/')
                  .replace(/\\/g, '');
              }
            }

            res.setHeader('Content-Type', 'application/json');
            res.end(
              JSON.stringify({
                code: 0,
                msg: 'success',
                data: {
                  user: {
                    nickname,
                    avatarLarger,
                    avatarMedium,
                    signature,
                  },
                },
              })
            );
          } catch (e) {
            res.statusCode = 500;
            res.end(JSON.stringify({ error: (e as Error).message }));
          }
          return;
        }
        next();
      });
    },
  };
}

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react(), remoteMetaPlugin()],

  // Vitest: unit tests for platform/capabilities (no browser required)
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
