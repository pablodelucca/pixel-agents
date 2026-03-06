---
name: generate-sprite
description: Generate pixel art furniture sprites for the Pixel Agents office using nano-banana (Gemini image generation). Use when the user asks to create, generate, or add new furniture assets.
---

# Generate Pixel Art Sprite

Generate 16x16 or 32x32 pixel art furniture sprites using nano-banana CLI and integrate them into the Pixel Agents codebase.

## Prerequisites

- `nano-banana` CLI installed (`~/tools/nano-banana-2/`)
- Gemini API key configured in `~/.nano-banana/.env`
- `pngjs` available (already in project dependencies)

## Workflow

### 1. Generate the image

Use nano-banana with transparent background mode for clean sprites:

```bash
nano-banana "<PROMPT>" -t -o <NAME> -d webview-ui/public/assets/furniture/<CATEGORY> -s 512
```

**Prompt template for best results:**
```
16x16 pixel art <ITEM>, top-down isometric view, office furniture style,
simple flat colors, clean edges, retro game aesthetic,
single item centered, no shadows, transparent background
```

For 32x32 items (2-tile furniture), use `32x32` in the prompt.

**Categories:** desks, chairs, storage, electronics, decor, wall, misc

### 2. Downscale to pixel-perfect size

The generated image will be ~512px. Downscale to exact sprite size using ImageMagick:

```bash
magick webview-ui/public/assets/furniture/<CATEGORY>/<NAME>.png \
  -resize <WIDTH>x<HEIGHT>! \
  -filter point \
  webview-ui/public/assets/furniture/<CATEGORY>/<NAME>.png
```

Sizes: 16x16 (1x1 tile), 32x16 (2x1), 16x32 (1x2), 32x32 (2x2)

### 3. Convert PNG to SpriteData

Add the sprite to `webview-ui/src/office/sprites/tilesetSprites.ts`:

```typescript
/** <Label> (<WIDTH>x<HEIGHT>px) */
export const TS_<NAME_UPPER>: SpriteData = [
  // Read PNG pixels and convert to hex color array
  // Use pngjs: each pixel becomes '#RRGGBB' or '' for transparent
]
```

Use this Node.js snippet to convert:
```bash
node -e "
const { PNG } = require('pngjs');
const fs = require('fs');
const png = PNG.sync.read(fs.readFileSync('PATH.png'));
const rows = [];
for (let y = 0; y < png.height; y++) {
  const row = [];
  for (let x = 0; x < png.width; x++) {
    const i = (y * png.width + x) * 4;
    if (png.data[i+3] < 128) row.push(\"''\");
    else row.push(\"'#\" + [png.data[i],png.data[i+1],png.data[i+2]].map(v=>v.toString(16).padStart(2,'0')).join('') + \"'\");
  }
  rows.push('  [' + row.join(',') + ']');
}
console.log('[');
console.log(rows.join(',\n'));
console.log(']');
"
```

### 4. Register in catalog

1. Add FurnitureType in `webview-ui/src/office/types.ts`:
   ```typescript
   <NAME_UPPER>: 'ts_<name_lower>',
   ```

2. Add import + catalog entry in `webview-ui/src/office/layout/furnitureCatalog.ts`:
   ```typescript
   import { TS_<NAME_UPPER> } from '../sprites/tilesetSprites.js'

   { type: FurnitureType.<NAME_UPPER>, label: '<Label>', footprintW: <W>, footprintH: <H>, sprite: TS_<NAME_UPPER>, isDesk: <bool>, category: '<cat>' },
   ```

3. Export from `webview-ui/src/office/sprites/index.ts` (already uses `export * from './tilesetSprites.js'`)

### 5. Build and verify

```bash
npm run build
```

## Notes

- Sprites use hex color strings (`'#8B6914'`) or empty string (`''`) for transparent
- TILE_SIZE is 16px — footprint is in tiles (e.g., 2x2 = 32x32 pixels)
- `isDesk: true` means agents can sit at adjacent chairs facing it
- Categories: desks, chairs, storage, electronics, decor, wall, misc
- Wall items need `canPlaceOnWalls: true` in catalog entry
- Surface items (go on desks) need `canPlaceOnSurfaces: true`
