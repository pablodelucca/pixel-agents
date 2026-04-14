import { Jimp } from 'jimp';

const INPUT = 'public/logo.png';
const OUTPUT = 'public/logo.png';
const RADIUS = 256; // corner radius in px

const image = await Jimp.read(INPUT);
const w = image.bitmap.width;
const h = image.bitmap.height;

function rgbaToInt(r, g, b, a) {
  return (((r & 0xFF) * 0x1000000) + ((g & 0xFF) * 0x10000) + ((b & 0xFF) * 0x100) + (a & 0xFF)) >>> 0;
}

function intToRgba(c) {
  return {
    r: (c >>> 24) & 0xFF,
    g: (c >>> 16) & 0xFF,
    b: (c >>> 8) & 0xFF,
    a: c & 0xFF,
  };
}

// Apply rounded corners
for (let x = 0; x < w; x++) {
  for (let y = 0; y < h; y++) {
    const nearCorner = (() => {
      if (x < RADIUS && y < RADIUS) return { cx: RADIUS, cy: RADIUS };
      if (x >= w - RADIUS && y < RADIUS) return { cx: w - RADIUS, cy: RADIUS };
      if (x < RADIUS && y >= h - RADIUS) return { cx: RADIUS, cy: h - RADIUS };
      if (x >= w - RADIUS && y >= h - RADIUS) return { cx: w - RADIUS, cy: h - RADIUS };
      return null;
    })();

    if (nearCorner) {
      const dx = x - nearCorner.cx;
      const dy = y - nearCorner.cy;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist > RADIUS) {
        image.setPixelColor(0x00000000, x, y);
      } else if (dist > RADIUS - 1.5) {
        const src = image.getPixelColor(x, y);
        const { r, g, b, a } = intToRgba(src);
        const alpha = Math.max(0, Math.min(255, Math.round((RADIUS - dist + 0.5) * a)));
        image.setPixelColor(rgbaToInt(r, g, b, alpha), x, y);
      }
    }
  }
}

await image.write(OUTPUT);
console.log(`✅ Corner radius (${RADIUS}px) applied → ${OUTPUT}`);
