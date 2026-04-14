---
name: ui-design-system
description: Design system untuk Clawmpany. Gunakan saat membuat/edit komponen UI, modal, card, atau layout.
---

# UI Design System — Clawmpany

## 🔤 Typography

| Level | Size | Untuk |
|-------|------|-------|
| Display | 64px | Emoji/illustrasi |
| Hero | 48px | Judul utama modal |
| Title | 32px | Card name, section title |
| Emphasis | 28px | Harga, subtitle, **button text (selalu 28px)** |
| Body | 20px | Text default — **MINIMAL 20px, tidak ada yang lebih kecil** |

## 📐 Spacing

- **Related info = deket** (title↔harga: 2px)
- **Unrelated info = jauh** (harga↔fitur: 40px+)
- Modal padding: top 24px, bottom 48px
- Text rapet: `marginBottom: 0` + `lineHeight: 1`
- `lineHeight: 1` rapet, `1.1` normal, `1.5` paragraf

## 🎨 Hierarchy & Layout

1. Emoji → 2. Title → 3. Harga (rapet di bawah title) → 4. Fitur (jauh dari harga) → 5. Button
- Harga SELALU tepat di bawah title
- Satu info per baris, jangan gabung
- Format angka bersih: `Rp 300 rb`, `Rp 1,2 jt` (bukan titik ribuan)

## 🎯 Colors

| Role | Value |
|------|-------|
| Accent/CTA | `#4ECDC4` |
| Text primary | `#fff` |
| Text secondary | `rgba(255,255,255,0.7)` |
| Text dim | `rgba(255,255,255,0.5)` |
| Text muted | `rgba(255,255,255,0.4)` |
| USDC | `#2dd4bf` |
| Rupiah | `#f97316` |
| Success | `#22c55e` |
| Danger | `#ef4444` |
| BG/Border/Shadow | `var(--pixel-bg)` / `var(--pixel-border)` / `var(--pixel-shadow)` |

## 🪟 Modal Rules

- WAJIB `maxHeight: '90vh'` + `overflowY: 'auto'`
- Backdrop: `rgba(0,0,0,0.7)` utama, `0.8` nested dialog
- Tidak perlu header bar kalau title sudah ada di content
- `minWidth: 520`, `maxWidth: '90vw'`

## 🔘 Button Rules

- Text **selalu 28px**
- `borderRadius: 0` (pixel art style)
- Primary: bg `#4ECDC4`, border `#4ECDC4`, text `#fff`
- Secondary: bg `transparent`, border `var(--pixel-border)`, text `var(--pixel-text-dim)`

## ⚠️ Dilarang

- Font size di bawah 20px
- Harga jauh dari title
- Modal tanpa `maxHeight` + `overflowY`
- Hapus `color` property saat edit style
- Gabung info berbeda level di satu baris
