---
name: netlify-deploy-debug
description: Use this skill when fixing Netlify build errors, deploy failures, environment variables, redirects, Vite/React deployment issues, and production-only bugs.
---

# Netlify Deploy Debug Skill

Gunakan skill ini ketika pengguna meminta deploy ke Netlify, memperbaiki build error, environment variable, routing, redirect, atau bug production.

## Langkah debugging

1. Baca error log build dengan teliti.
2. Identifikasi apakah error berasal dari:
   - dependency
   - TypeScript
   - lint
   - environment variable
   - build command
   - publish directory
   - routing SPA
   - Node version
3. Jangan langsung mengubah banyak file.
4. Perbaiki penyebab utama dulu.
5. Jalankan build lokal jika memungkinkan.

## Untuk Vite/React SPA

Pastikan:
- Build command biasanya `npm run build`.
- Publish directory biasanya `dist`.
- Routing SPA butuh redirect:
  `/* /index.html 200`

## Output yang diharapkan

Saat selesai:
- Jelaskan penyebab deploy gagal.
- Jelaskan perubahan yang dilakukan.
- Jelaskan setting Netlify yang harus dicek.
