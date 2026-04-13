import { useCallback, useEffect, useRef, useState } from 'react';

import type { ColorValue } from './types.js';

/** Convert HSL (h: 0-360, s: 0-1, l: 0-1) to RGB tuple */
function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = h / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r1 = 0,
    g1 = 0,
    b1 = 0;

  if (hp < 1) {
    r1 = c;
    g1 = x;
  } else if (hp < 2) {
    r1 = x;
    g1 = c;
  } else if (hp < 3) {
    g1 = c;
    b1 = x;
  } else if (hp < 4) {
    g1 = x;
    b1 = c;
  } else if (hp < 5) {
    r1 = x;
    b1 = c;
  } else {
    r1 = c;
    b1 = x;
  }

  const m = l - c / 2;
  return [Math.round((r1 + m) * 255), Math.round((g1 + m) * 255), Math.round((b1 + m) * 255)];
}

/**
 * Compute the representative CSS color for a ColorValue in colorize mode.
 * Uses midpoint lightness (0.5) as the "base" preview, then applies B/C.
 */
function colorValueToHex(color: ColorValue): string {
  let lightness = 0.5;
  if (color.c !== 0) {
    const factor = (100 + color.c) / 100;
    lightness = 0.5 + (lightness - 0.5) * factor;
  }
  if (color.b !== 0) {
    lightness = lightness + color.b / 200;
  }
  lightness = Math.max(0, Math.min(1, lightness));

  const [r, g, b] = hslToRgb(color.h, color.s / 100, lightness);
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

/** Parse a hex color string to HSL */
function hexToHsl(hex: string): [number, number, number] {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
  else if (max === g) h = ((b - r) / d + 2) * 60;
  else h = ((r - g) / d + 4) * 60;
  return [h, s, l];
}

const SV_SIZE = 160;
const HUE_BAR_WIDTH = 16;
const HUE_BAR_GAP = 6;
const TOTAL_WIDTH = SV_SIZE + HUE_BAR_GAP + HUE_BAR_WIDTH;

interface VisualColorPickerProps {
  value: ColorValue;
  onChange: (color: ColorValue) => void;
}

export function VisualColorPicker({ value, onChange }: VisualColorPickerProps) {
  const svCanvasRef = useRef<HTMLCanvasElement>(null);
  const hueCanvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const draggingSvRef = useRef(false);
  const draggingHueRef = useRef(false);
  const [expanded, setExpanded] = useState(false);
  const [inputHex, setInputHex] = useState(() => colorValueToHex(value));

  // Sync hex input when value changes externally
  useEffect(() => {
    if (!draggingSvRef.current && !draggingHueRef.current) {
      setInputHex(colorValueToHex(value));
    }
  }, [value]);

  // Draw the SV square: x = saturation (0→100), y = brightness (light→dark)
  const drawSvCanvas = useCallback(
    (ctx: CanvasRenderingContext2D) => {
      const { h, c } = value;
      const imageData = ctx.createImageData(SV_SIZE, SV_SIZE);
      const data = imageData.data;

      for (let y = 0; y < SV_SIZE; y++) {
        const bVal = 100 - (y / (SV_SIZE - 1)) * 200;
        for (let x = 0; x < SV_SIZE; x++) {
          const sat = (x / (SV_SIZE - 1)) * 100;

          let lightness = 0.5;
          if (c !== 0) {
            const factor = (100 + c) / 100;
            lightness = 0.5 + (lightness - 0.5) * factor;
          }
          lightness = lightness + bVal / 200;
          lightness = Math.max(0, Math.min(1, lightness));

          const [r, g, bl] = hslToRgb(h, sat / 100, lightness);
          const i = (y * SV_SIZE + x) * 4;
          data[i] = r;
          data[i + 1] = g;
          data[i + 2] = bl;
          data[i + 3] = 255;
        }
      }
      ctx.putImageData(imageData, 0, 0);
    },
    [value],
  );

  // Draw the vertical hue rainbow bar
  const drawHueBar = useCallback((ctx: CanvasRenderingContext2D) => {
    const imageData = ctx.createImageData(HUE_BAR_WIDTH, SV_SIZE);
    const data = imageData.data;

    for (let y = 0; y < SV_SIZE; y++) {
      const hue = (y / (SV_SIZE - 1)) * 360;
      const [r, g, b] = hslToRgb(hue, 1, 0.5);
      for (let x = 0; x < HUE_BAR_WIDTH; x++) {
        const i = (y * HUE_BAR_WIDTH + x) * 4;
        data[i] = r;
        data[i + 1] = g;
        data[i + 2] = b;
        data[i + 3] = 255;
      }
    }
    ctx.putImageData(imageData, 0, 0);
  }, []);

  useEffect(() => {
    const canvas = svCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    drawSvCanvas(ctx);
  }, [drawSvCanvas, expanded]);

  useEffect(() => {
    const canvas = hueCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    drawHueBar(ctx);
  }, [drawHueBar, expanded]);

  // SV marker position
  const svMarkerX = (value.s / 100) * SV_SIZE;
  const svMarkerY = ((100 - value.b) / 200) * SV_SIZE;

  // Hue marker position (vertical)
  const hueMarkerY = (value.h / 360) * SV_SIZE;

  const pickFromSv = useCallback(
    (clientX: number, clientY: number) => {
      const canvas = svCanvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const x = Math.max(0, Math.min(SV_SIZE - 1, ((clientX - rect.left) / rect.width) * SV_SIZE));
      const y = Math.max(0, Math.min(SV_SIZE - 1, ((clientY - rect.top) / rect.height) * SV_SIZE));
      const s = Math.round((x / (SV_SIZE - 1)) * 100);
      const b = Math.round(100 - (y / (SV_SIZE - 1)) * 200);
      const newColor: ColorValue = { ...value, s, b, colorize: true };
      onChange(newColor);
      setInputHex(colorValueToHex(newColor));
    },
    [value, onChange],
  );

  const pickFromHue = useCallback(
    (clientY: number) => {
      const canvas = hueCanvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const y = Math.max(0, Math.min(SV_SIZE - 1, ((clientY - rect.top) / rect.height) * SV_SIZE));
      const h = Math.round((y / (SV_SIZE - 1)) * 360);
      const newColor: ColorValue = { ...value, h, colorize: true };
      onChange(newColor);
      setInputHex(colorValueToHex(newColor));
    },
    [value, onChange],
  );

  // SV pointer handlers
  const onSvPointerDown = useCallback(
    (e: React.PointerEvent) => {
      draggingSvRef.current = true;
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      pickFromSv(e.clientX, e.clientY);
    },
    [pickFromSv],
  );
  const onSvPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!draggingSvRef.current) return;
      pickFromSv(e.clientX, e.clientY);
    },
    [pickFromSv],
  );
  const onSvPointerUp = useCallback(() => {
    draggingSvRef.current = false;
  }, []);

  // Hue pointer handlers
  const onHuePointerDown = useCallback(
    (e: React.PointerEvent) => {
      draggingHueRef.current = true;
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      pickFromHue(e.clientY);
    },
    [pickFromHue],
  );
  const onHuePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!draggingHueRef.current) return;
      pickFromHue(e.clientY);
    },
    [pickFromHue],
  );
  const onHuePointerUp = useCallback(() => {
    draggingHueRef.current = false;
  }, []);

  const handleHexChange = useCallback(
    (hex: string) => {
      setInputHex(hex);
      if (/^#[0-9a-fA-F]{6}$/.test(hex)) {
        const [h, s, l] = hexToHsl(hex);
        const b = Math.round((l - 0.5) * 200);
        onChange({
          h: Math.round(h),
          s: Math.round(s * 100),
          b: Math.max(-100, Math.min(100, b)),
          c: 0,
          colorize: true,
        });
      }
    },
    [onChange],
  );

  // Close picker when clicking outside
  useEffect(() => {
    if (!expanded) return;
    const handlePointerDown = (e: PointerEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setExpanded(false);
      }
    };
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [expanded]);

  const previewHex = colorValueToHex(value);

  return (
    <div ref={containerRef}>
      {/* Collapsed: swatch + hex input — clickable to expand */}
      <div
        className="relative flex items-center gap-3 cursor-pointer"
        style={{ width: TOTAL_WIDTH }}
        onClick={() => setExpanded((v) => !v)}
      >
        <div
          style={{
            width: 18,
            height: 18,
            backgroundColor: previewHex,
            border: '2px solid var(--color-border)',
            flexShrink: 0,
          }}
        />
        <input
          type="text"
          value={inputHex}
          onChange={(e) => handleHexChange(e.target.value)}
          onClick={(e) => {
            e.stopPropagation();
            setExpanded(true);
          }}
          className="bg-bg text-text border-2 border-border px-3 py-1 font-mono flex-1 min-w-0"
          style={{ fontSize: 10 }}
          spellCheck={false}
          maxLength={7}
        />

        {/* Expanded: absolutely positioned popup to the right, bottom-aligned */}
        {expanded && (
          <div
            className="absolute bg-bg-dark border-2 border-border p-4"
            style={{
              left: '100%',
              bottom: 0,
              marginLeft: 6,
              zIndex: 20,
            }}
          >
            <div className="flex" style={{ gap: HUE_BAR_GAP }}>
              {/* SV square */}
              <div className="relative" style={{ width: SV_SIZE, height: SV_SIZE }}>
                <canvas
                  ref={svCanvasRef}
                  width={SV_SIZE}
                  height={SV_SIZE}
                  style={{
                    width: SV_SIZE,
                    height: SV_SIZE,
                    cursor: 'crosshair',
                    imageRendering: 'pixelated',
                  }}
                  onPointerDown={onSvPointerDown}
                  onPointerMove={onSvPointerMove}
                  onPointerUp={onSvPointerUp}
                />
                <div
                  style={{
                    position: 'absolute',
                    left: svMarkerX - 5,
                    top: svMarkerY - 5,
                    width: 10,
                    height: 10,
                    border: '2px solid white',
                    outline: '1px solid black',
                    pointerEvents: 'none',
                  }}
                />
              </div>

              {/* Vertical hue rainbow bar */}
              <div className="relative" style={{ width: HUE_BAR_WIDTH, height: SV_SIZE }}>
                <canvas
                  ref={hueCanvasRef}
                  width={HUE_BAR_WIDTH}
                  height={SV_SIZE}
                  style={{
                    width: HUE_BAR_WIDTH,
                    height: SV_SIZE,
                    cursor: 'crosshair',
                    imageRendering: 'pixelated',
                  }}
                  onPointerDown={onHuePointerDown}
                  onPointerMove={onHuePointerMove}
                  onPointerUp={onHuePointerUp}
                />
                <div
                  style={{
                    position: 'absolute',
                    left: -1,
                    top: hueMarkerY - 1,
                    width: HUE_BAR_WIDTH + 2,
                    height: 2,
                    backgroundColor: 'white',
                    outline: '1px solid black',
                    pointerEvents: 'none',
                  }}
                />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
