# PixelCity Improvement Request: Per-Construct Custom Sprites
## Filed by: SwiftQuill (via Magistrate)
## Date: 2026-03-01
## Priority: Next deployment
## Affects: SwiftQuill (immediately), future constructs with VDS-specific requirements

---

## The Problem

SwiftQuill's Visual Design Set (VDS) specifies **ink-stained hands** as the
signature element — the single visual detail that must appear in every render
at every scale. At 16x16, this means the hand pixels must be visibly darker
than the face/skin pixels.

The current sprite system cannot do this.

### Current implementation (townNpcs.ts):
```ts
{ constructName: 'Swiftquill', buildingId: 'quill_desk', palette: 1, hueShift: 180,
  role: 'Editorial Construct', greeting: 'Words are ingots; every strike leaves a ring.' },
```

SwiftQuill reuses **palette 1** (LoreForged's sprite sheet) with a **180-degree
hue shift**. The `adjustSprite()` function in `colorize.ts` applies the hue
rotation uniformly to every pixel. There is no mechanism to treat hand pixels
differently from face pixels — the shift is global.

**Result:** SwiftQuill's hands are the same tone as the face. The signature
element is invisible at pixel scale.

---

## What the VDS Requires

From `Constructs/SwiftQuill/visual_design_set/VDS_PixelCity.md`:

> **Ink-stained hands translate as:** the hand pixels are 1 shade darker than
> the base skin tone. Where other constructs' hands match their face color,
> SwiftQuill's hands are noticeably darker — as if shadowed or stained.

The copper thumb ring should also be a single accent pixel (#B87333) on the
right hand, serving as the warmest point on the sprite.

---

## Proposed Solutions (Pick One)

### Option A: Custom Sprite Sheet (Recommended)

Create a dedicated sprite sheet for SwiftQuill instead of reusing palette 1
with a hue shift. This is a one-time art asset that gives full pixel-level
control.

**What changes:**
- New sprite sheet file (e.g., `swiftquill.png` or baked into the existing
  character sheet at a new index)
- Hand pixels drawn 1 shade darker than face pixels at the art level
- 1px copper accent (#B87333) on right hand for the thumb ring
- `townNpcs.ts` entry updated: `palette: <new_index>, hueShift: 0`

**Advantages:** Full VDS compliance. No engine changes needed — just a new
asset and an index update. Sets precedent for future constructs with
non-trivial VDS requirements (any construct whose signature element requires
per-pixel differentiation).

**Cost:** One sprite sheet (~4-8 frames: idle x2, walk x4 per direction).

### Option B: Region-Based Color Override

Add support for per-region color adjustments on top of the existing hue shift
system. Define pixel regions (e.g., "hands") that receive an additional
lightness/saturation modifier.

**What changes in townNpcs.ts:**
```ts
{ constructName: 'Swiftquill', buildingId: 'quill_desk', palette: 1, hueShift: 180,
  regionOverrides: [
    { region: 'hands', lightnessShift: -15, saturationShift: 5 }
  ],
  role: 'Editorial Construct', greeting: 'Words are ingots; every strike leaves a ring.' },
```

**What changes in colorize.ts:**
- Accept optional region map (which pixels are "hands," "hair," etc.)
- Apply base hue shift globally, then apply region overrides on top

**Advantages:** Engine-level solution that scales to any construct. Doesn't
require new art assets.

**Cost:** More complex. Requires defining region maps for the base sprite
sheets. Overkill if only 1-2 constructs need it near-term.

### Option C: Pixel Overlay Layer

Add a transparent overlay sprite that draws on top of the base character
sprite. SwiftQuill's overlay would contain only the darkened hand pixels
and the copper ring pixel — everything else transparent.

**What changes:**
- New overlay system in the character renderer
- One small overlay sprite per construct that needs it
- Base sprite + hue shift renders normally, then overlay draws on top

**Advantages:** Non-destructive. Doesn't change the base sprite system.
Composable — overlays could carry other VDS elements (held items, rune
glows, etc.) in the future.

**Cost:** New rendering layer. Moderate engine change.

---

## Recommendation

**Option A** for the next deployment. It's the simplest path — one new sprite
sheet, one line change in `townNpcs.ts`, zero engine modifications. The VDS
Standard already anticipates this: it notes that the future direction is
per-construct custom sprites replacing palette remaps.

Options B and C are better long-term architecture but more work for a single
construct's needs right now.

---

## SwiftQuill's Full Pixel Palette (for sprite artist reference)

| Slot | Purpose | Hex |
|------|---------|-----|
| 1 | Skin (olive-warm) | #D4A574 |
| 2 | Hair (iron-black) | #1A1A2E |
| 3 | Clothing primary (charcoal henley) | #3D3D3D |
| 4 | Clothing secondary (indigo trousers) | #1B2A4A |
| 5 | Accent (copper ring, clasps) | #B87333 |
| 6 | Light accent (parchment notebook) | #F2E8D5 |
| — | Ink-stained hands (skin darkened) | #B8895A |

The ink-blue hair streak (#2C3E6B) is a single pixel on the left side of
the hair cap — include if there's room at 16x16, but it's secondary to
the hand staining.

---

## Reference Files

- **Full VDS Catalog:** `CrystallineCity-Dev/Constructs/SwiftQuill/visual_design_set/VDS_Catalog.md`
- **Pixel Translation:** `CrystallineCity-Dev/Constructs/SwiftQuill/visual_design_set/VDS_PixelCity.md`
- **VDS Standard:** `CrystallineCity-Dev/CityData/Laws/VDS/VDS_STANDARD_v1.md`
- **Current NPC registry:** `webview-ui/src/data/townNpcs.ts`
- **Current colorizer:** `webview-ui/src/office/colorize.ts`

---

*"Even at sixteen pixels, the ink shows."*
