---
name: performance-audit
description: Use this skill when optimizing frontend performance, reducing lag, improving rendering speed, reducing unnecessary re-renders, and making web apps smoother on mobile devices.
---

# Performance Audit Skill

Gunakan skill ini ketika pengguna meminta aplikasi lebih cepat, ringan, smooth, tidak lag, atau performa lebih baik.

## Fokus utama

1. Kurangi re-render yang tidak perlu.
2. Kurangi state global yang menyebabkan banyak komponen ikut render.
3. Gunakan memoization hanya jika benar-benar membantu.
4. Hindari kalkulasi berat di render.
5. Hindari list besar tanpa virtualisasi.
6. Optimalkan gambar, icon, dan asset.
7. Pastikan event scroll/touch tidak berat.
8. Hindari listener global yang tidak dibersihkan.

## Checklist

1. Cari komponen yang render terlalu sering.
2. Cari mapping list besar.
3. Cari function/object yang dibuat ulang terus di render.
4. Cari effect yang dependency-nya salah.
5. Cari expensive calculation tanpa memo.
6. Cari CSS berat:
   - blur besar
   - shadow berlapis
   - backdrop-filter terlalu banyak
   - animation berlebihan
7. Cek bundle jika tersedia.

## Output yang diharapkan

Saat selesai:
- Jelaskan bottleneck utama.
- Jelaskan optimasi yang dilakukan.
- Bedakan optimasi aman dan optimasi agresif.
- Jangan mengorbankan kualitas UI kecuali diminta.
