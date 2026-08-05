---
name: scroll-touch-debugger
description: Use this skill when fixing mobile touch scrolling, nested scroll containers, sticky headers, frozen columns, dropdowns opening during scroll, and scroll lock issues.
---

# Scroll Touch Debugger Skill

Gunakan skill ini ketika pengguna melaporkan:
- Scroll mobile terasa macet.
- Tombol/dropdown tidak sengaja aktif saat pengguna scroll.
- Area sticky/freeze table menghambat scroll body.
- Toolbar horizontal tidak bisa meneruskan scroll vertikal.
- Fullscreen mode memiliki masalah scroll.
- Touchscreen terasa berat, patah-patah, atau tidak natural.

## Prinsip utama

1. Jangan membuat terlalu banyak nested scroll container.
2. Hindari `overflow: hidden` pada parent utama kecuali benar-benar perlu.
3. Pastikan area sticky/frozen tetap mengizinkan wheel/touch scroll diteruskan.
4. Bedakan gesture scroll dengan tap/click.
5. Dropdown atau tombol tidak boleh terbuka hanya karena jari pengguna sedang scroll.
6. Gunakan `touch-action`, `overscroll-behavior`, dan pointer handling secara hati-hati.
7. Jangan mematikan event default secara global tanpa alasan.

## Checklist debugging

1. Cari elemen dengan:
   - `overflow: hidden`
   - `overflow: auto`
   - `position: fixed`
   - `position: sticky`
   - `touch-action`
   - `preventDefault`
   - `stopPropagation`
2. Cek apakah body scroll terkunci.
3. Cek apakah toolbar/table punya scroll sendiri.
4. Cek apakah frozen column menangkap gesture.
5. Cek apakah dropdown dibuka pada `touchstart` bukan `click`.
6. Tambahkan guard:
   - Jika jari bergerak lebih dari threshold, anggap sebagai scroll.
   - Jika gesture adalah scroll, jangan trigger click/dropdown.
7. Uji di viewport mobile.

## Pola solusi

- Untuk tombol/dropdown:
  - Trigger aksi pada `click`, bukan `touchstart`.
  - Abaikan click setelah gesture scroll.
- Untuk table freeze:
  - Pastikan wheel/touch vertikal diteruskan ke container utama.
- Untuk toolbar horizontal:
  - Horizontal swipe tetap jalan.
  - Vertical swipe harus scroll halaman.
- Untuk fullscreen:
  - Pastikan scroll root jelas dan tidak berlapis.

## Output yang diharapkan

Saat selesai:
- Jelaskan penyebab scroll macet.
- Jelaskan file yang diubah.
- Jelaskan solusi yang diterapkan.
- Pastikan tidak merusak desktop dan mobile.
