import { useEffect, useRef, useState } from 'react';

import { Button } from '../../components/ui/Button.js';
import { ColorPicker } from '../../components/ui/ColorPicker.js';
import { Dropdown, DropdownItem } from '../../components/ui/Dropdown.js';
import { ItemSelect } from '../../components/ui/ItemSelect.js';
import type { ColorValue } from '../../components/ui/types.js';
import { VisualColorPicker } from '../../components/ui/VisualColorPicker.js';
import {
  CANVAS_FALLBACK_TILE_COLOR,
  CARPET_DEFAULT_ACCENT_COLOR,
  CARPET_DEFAULT_COLOR,
  ZONE_DEFAULT_COLORS,
} from '../../constants.js';
import type { WorkspaceFolder } from '../../hooks/useExtensionMessages.js';
import { getCarpetJunctionSprite, getCarpetSetCount, hasCarpetSprites } from '../carpetTiles.js';
import { getColorizedSprite } from '../colorize.js';
import { getColorizedFloorSprite, getFloorPatternCount, hasFloorSprites } from '../floorTiles.js';
import type { FurnitureCategory, LoadedAssetData } from '../layout/furnitureCatalog.js';
import {
  buildDynamicCatalog,
  getActiveCategories,
  getCatalogByCategory,
} from '../layout/furnitureCatalog.js';
import { getCachedSprite } from '../sprites/spriteCache.js';
import type { TileType as TileTypeVal, ZoneDefinition } from '../types.js';
import { EditTool } from '../types.js';
import { getWallSetCount, getWallSetPreviewSprite } from '../wallTiles.js';

interface EditorToolbarProps {
  activeTool: EditTool;
  selectedTileType: TileTypeVal;
  selectedFurnitureType: string;
  selectedFurnitureUid: string | null;
  selectedFurnitureColor: ColorValue | null;
  floorColor: ColorValue;
  wallColor: ColorValue;
  selectedWallSet: number;
  carpetVariant: number;
  carpetColor: ColorValue | undefined;
  carpetAccentColor: ColorValue | undefined;
  onToolChange: (tool: EditTool) => void;
  onTileTypeChange: (type: TileTypeVal) => void;
  onFloorColorChange: (color: ColorValue) => void;
  onWallColorChange: (color: ColorValue) => void;
  onWallSetChange: (setIndex: number) => void;
  onSelectedFurnitureColorChange: (color: ColorValue | null) => void;
  pickedFurnitureColor: ColorValue | null;
  onPickedFurnitureColorChange: (color: ColorValue | null) => void;
  onFurnitureTypeChange: (type: string) => void;
  onCarpetColorChange: (color: ColorValue | undefined) => void;
  onCarpetAccentColorChange: (color: ColorValue | undefined) => void;
  onCarpetVariantChange: (variant: number) => void;
  loadedAssets?: LoadedAssetData;
  // Zone props
  zones: ZoneDefinition[];
  selectedZoneLabel: string | null;
  onSelectZone: (label: string) => void;
  onAddZone: (label: string, color: string) => void;
  onRemoveZone: (label: string) => void;
  onRenameZone: (oldLabel: string, newLabel: string) => void;
  onZoneColorChange: (label: string, color: string) => void;
  workspaceFolders: WorkspaceFolder[];
  zoneMappings: Record<string, string[]>;
  onZoneMappingChange: (folderName: string, zoneLabel: string, action: 'add' | 'remove') => void;
}

const THUMB_ZOOM = 2;

const DEFAULT_FURNITURE_COLOR: ColorValue = { h: 0, s: 0, b: 0, c: 0 };

export function EditorToolbar({
  activeTool,
  selectedTileType,
  selectedFurnitureType,
  selectedFurnitureUid,
  selectedFurnitureColor,
  floorColor,
  wallColor,
  selectedWallSet,
  carpetVariant,
  carpetColor,
  carpetAccentColor,
  onToolChange,
  onTileTypeChange,
  onFloorColorChange,
  onWallColorChange,
  onWallSetChange,
  onSelectedFurnitureColorChange,
  pickedFurnitureColor,
  onPickedFurnitureColorChange,
  onFurnitureTypeChange,
  onCarpetColorChange,
  onCarpetAccentColorChange,
  onCarpetVariantChange,
  loadedAssets,
  zones,
  selectedZoneLabel,
  onSelectZone,
  onAddZone,
  onRemoveZone,
  onRenameZone,
  onZoneColorChange,
  workspaceFolders,
  zoneMappings,
  onZoneMappingChange,
}: EditorToolbarProps) {
  const [activeCategory, setActiveCategory] = useState<FurnitureCategory | 'carpet'>('desks');
  const [showColor, setShowColor] = useState(false);
  const [showWallColor, setShowWallColor] = useState(false);
  const [showFurnitureColor, setShowFurnitureColor] = useState(false);
  const [showCarpetColor, setShowCarpetColor] = useState(false);
  const [newZoneName, setNewZoneName] = useState('');
  const [editingZoneLabel, setEditingZoneLabel] = useState<string | null>(null);
  const [editingZoneValue, setEditingZoneValue] = useState('');
  const renameInputRef = useRef<HTMLInputElement>(null);
  const [folderPickerZone, setFolderPickerZone] = useState<string | null>(null);

  // Build dynamic catalog from loaded assets
  useEffect(() => {
    if (loadedAssets) {
      try {
        console.log(
          `[EditorToolbar] Building dynamic catalog with ${loadedAssets.catalog.length} assets...`,
        );
        const success = buildDynamicCatalog(loadedAssets);
        console.log(`[EditorToolbar] Catalog build result: ${success}`);

        // Reset to first available category if current doesn't exist
        const activeCategories = getActiveCategories();
        if (activeCategories.length > 0) {
          const firstCat = activeCategories[0]?.id;
          if (firstCat) {
            console.log(`[EditorToolbar] Setting active category to: ${firstCat}`);
            setActiveCategory(firstCat);
          }
        }
      } catch (err) {
        console.error(`[EditorToolbar] Error building dynamic catalog:`, err);
      }
    }
  }, [loadedAssets]);

  // For selected furniture: use existing color or default
  const effectiveColor = selectedFurnitureColor ?? DEFAULT_FURNITURE_COLOR;

  const categoryItems = activeCategory === 'carpet' ? [] : getCatalogByCategory(activeCategory);

  const patternCount = getFloorPatternCount();
  // Wall is TileType 0, floor patterns are 1..patternCount
  const floorPatterns = Array.from({ length: patternCount }, (_, i) => i + 1);

  const thumbSize = 42; // 2x for items

  const isFloorActive = activeTool === EditTool.TILE_PAINT || activeTool === EditTool.EYEDROPPER;
  const isWallActive = activeTool === EditTool.WALL_PAINT;
  const isEraseActive = activeTool === EditTool.ERASE;
  const isZoneActive = activeTool === EditTool.ZONE_PAINT;
  const isCarpetTool = activeTool === EditTool.CARPET_PAINT || activeTool === EditTool.CARPET_PICK;
  const isFurnitureActive =
    activeTool === EditTool.FURNITURE_PLACE ||
    activeTool === EditTool.FURNITURE_PICK ||
    isCarpetTool;

  const effectiveCarpetColor: ColorValue = carpetColor ?? CARPET_DEFAULT_COLOR;
  const effectiveCarpetAccentColor: ColorValue = carpetAccentColor ?? CARPET_DEFAULT_ACCENT_COLOR;

  return (
    <div className="absolute bottom-76 left-10 z-10 pixel-panel p-4 flex flex-col-reverse gap-4 max-w-[calc(100vw-20px)]">
      {/* Tool row — at the bottom */}
      <div className="flex gap-4 flex-wrap">
        <Button
          variant={isFurnitureActive ? 'active' : 'default'}
          size="md"
          onClick={() => onToolChange(EditTool.FURNITURE_PLACE)}
          title="Place furniture"
        >
          Furniture
        </Button>
        <Button
          variant={isFloorActive ? 'active' : 'default'}
          size="md"
          onClick={() => onToolChange(EditTool.TILE_PAINT)}
          title="Paint floor tiles"
        >
          Floor
        </Button>
        <Button
          variant={isWallActive ? 'active' : 'default'}
          size="md"
          onClick={() => onToolChange(EditTool.WALL_PAINT)}
          title="Paint walls (click to toggle)"
        >
          Wall
        </Button>
        <Button
          variant={isZoneActive ? 'active' : 'default'}
          size="md"
          onClick={() => onToolChange(EditTool.ZONE_PAINT)}
          title="Paint zones for workspace folders"
        >
          Zones
        </Button>
        <Button
          variant={isEraseActive ? 'active' : 'default'}
          size="md"
          onClick={() => onToolChange(EditTool.ERASE)}
          title="Erase tiles to void"
        >
          Erase
        </Button>
      </div>

      {/* Sub-panel: Floor tiles — stacked bottom-to-top via column-reverse */}
      {isFloorActive && (
        <div className="flex flex-col-reverse gap-4">
          {/* Color toggle + Pick — just above tool row */}
          <div className="flex gap-4 items-center">
            <Button
              variant={showColor ? 'active' : 'default'}
              size="sm"
              onClick={() => setShowColor((v) => !v)}
              title="Adjust floor color"
            >
              Color
            </Button>
            <Button
              variant={activeTool === EditTool.EYEDROPPER ? 'active' : 'ghost'}
              size="sm"
              onClick={() => onToolChange(EditTool.EYEDROPPER)}
              title="Pick floor pattern + color from existing tile"
            >
              Pick
            </Button>
          </div>

          {/* Color controls (collapsible) — above Wall/Color/Pick */}
          {showColor && <ColorPicker value={floorColor} onChange={onFloorColorChange} colorize />}

          {/* Floor pattern horizontal carousel — at the top */}
          <div className="carousel">
            {floorPatterns.map((patIdx) => (
              <ItemSelect
                key={patIdx}
                width={32}
                height={32}
                selected={selectedTileType === patIdx}
                onClick={() => onTileTypeChange(patIdx as TileTypeVal)}
                title={`Floor ${patIdx}`}
                deps={[patIdx, floorColor]}
                draw={(ctx, w, h) => {
                  if (!hasFloorSprites()) {
                    ctx.fillStyle = CANVAS_FALLBACK_TILE_COLOR;
                    ctx.fillRect(0, 0, w, h);
                    return;
                  }
                  const sprite = getColorizedFloorSprite(patIdx, floorColor);
                  ctx.drawImage(getCachedSprite(sprite, THUMB_ZOOM), 0, 0);
                }}
              />
            ))}
          </div>
        </div>
      )}

      {/* Sub-panel: Wall — stacked bottom-to-top via column-reverse */}
      {isWallActive && (
        <div className="flex flex-col-reverse gap-4">
          {/* Color toggle — just above tool row */}
          <div className="flex gap-4 items-center">
            <Button
              variant={showWallColor ? 'active' : 'default'}
              size="sm"
              onClick={() => setShowWallColor((v) => !v)}
              title="Adjust wall color"
            >
              Color
            </Button>
          </div>

          {/* Color controls (collapsible) */}
          {showWallColor && <ColorPicker value={wallColor} onChange={onWallColorChange} colorize />}

          {/* Wall set picker — horizontal carousel at the top */}
          {getWallSetCount() > 0 && (
            <div className="carousel">
              {Array.from({ length: getWallSetCount() }, (_, i) => (
                <ItemSelect
                  key={i}
                  width={32}
                  height={64}
                  selected={selectedWallSet === i}
                  onClick={() => onWallSetChange(i)}
                  title={`Wall ${i + 1}`}
                  deps={[i, wallColor]}
                  draw={(ctx, w, h) => {
                    const sprite = getWallSetPreviewSprite(i);
                    if (!sprite) {
                      ctx.fillStyle = CANVAS_FALLBACK_TILE_COLOR;
                      ctx.fillRect(0, 0, w, h);
                      return;
                    }
                    const cacheKey = `wall-preview-${i}-${wallColor.h}-${wallColor.s}-${wallColor.b}-${wallColor.c}`;
                    const colorized = getColorizedSprite(cacheKey, sprite, {
                      ...wallColor,
                      colorize: true,
                    });
                    ctx.drawImage(getCachedSprite(colorized, THUMB_ZOOM), 0, 0);
                  }}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Sub-panel: Furniture (includes Carpet tab) — stacked bottom-to-top via column-reverse */}
      {isFurnitureActive && (
        <div className="flex flex-col-reverse gap-4">
          {/* Category tabs + Pick — just above tool row */}
          <div className="flex gap-4 flex-wrap items-center">
            {getActiveCategories().map((cat) => (
              <Button
                key={cat.id}
                variant={activeCategory === cat.id ? 'active' : 'ghost'}
                size="sm"
                onClick={() => {
                  setActiveCategory(cat.id);
                  if (isCarpetTool) onToolChange(EditTool.FURNITURE_PLACE);
                }}
              >
                {cat.label}
              </Button>
            ))}
            <Button
              variant={activeCategory === 'carpet' ? 'active' : 'ghost'}
              size="sm"
              onClick={() => {
                setActiveCategory('carpet');
                if (!isCarpetTool) onToolChange(EditTool.CARPET_PAINT);
              }}
            >
              Carpet
            </Button>
            <Button
              variant={
                activeTool ===
                (activeCategory === 'carpet' ? EditTool.CARPET_PICK : EditTool.FURNITURE_PICK)
                  ? 'active'
                  : 'default'
              }
              size="sm"
              onClick={() => {
                const pickTool =
                  activeCategory === 'carpet' ? EditTool.CARPET_PICK : EditTool.FURNITURE_PICK;
                if (activeTool === pickTool) {
                  // Deactivate pick → return to the appropriate paint tool
                  onToolChange(
                    activeCategory === 'carpet' ? EditTool.CARPET_PAINT : EditTool.FURNITURE_PLACE,
                  );
                } else {
                  onToolChange(pickTool);
                }
              }}
              title={
                activeCategory === 'carpet'
                  ? 'Pick carpet variant + color from existing carpet'
                  : 'Pick furniture type from placed item'
              }
            >
              Pick
            </Button>
            {(() => {
              const colorActive =
                activeCategory === 'carpet' ? showCarpetColor : showFurnitureColor;
              return (
                <Button
                  variant={colorActive ? 'active' : 'default'}
                  size="sm"
                  onClick={() => {
                    if (activeCategory === 'carpet') {
                      setShowCarpetColor((v) => !v);
                    } else {
                      setShowFurnitureColor((v) => !v);
                    }
                  }}
                  title={
                    activeCategory === 'carpet'
                      ? 'Adjust carpet color'
                      : selectedFurnitureUid
                        ? 'Adjust selected furniture color'
                        : 'Adjust color for new furniture'
                  }
                >
                  Color
                </Button>
              );
            })()}
          </div>

          {/* Carpet content — variant carousel + color controls */}
          {activeCategory === 'carpet' && (
            <>
              {/* Variant picker — horizontal carousel */}
              {loadedAssets &&
                loadedAssets.carpetVariantCount > 0 &&
                hasCarpetSprites() &&
                getCarpetSetCount() > 0 && (
                  <div className="carousel">
                    {Array.from({ length: getCarpetSetCount() }, (_, i) => (
                      <ItemSelect
                        key={i}
                        width={48}
                        height={32}
                        selected={carpetVariant === i}
                        onClick={() => onCarpetVariantChange(i)}
                        title={`Carpet ${String.fromCharCode(65 + i)}`}
                        deps={[i, effectiveCarpetColor, effectiveCarpetAccentColor]}
                        draw={(ctx, w, h) => {
                          if (!hasCarpetSprites()) {
                            ctx.fillStyle = CANVAS_FALLBACK_TILE_COLOR;
                            ctx.fillRect(0, 0, w, h);
                            return;
                          }
                          const previewCols = 2;
                          const previewRows = 1;
                          const previewZoom = 1;
                          const tileSize = 16 * previewZoom;
                          const carpetWidth = previewCols * tileSize;
                          const carpetHeight = previewRows * tileSize;
                          const originX = Math.floor((w - carpetWidth) / 2);
                          const originY = Math.floor((h - carpetHeight) / 2);
                          const fakeCarpets = [
                            {
                              variant: i,
                              color: effectiveCarpetColor,
                              accentColor: effectiveCarpetAccentColor,
                            },
                            {
                              variant: i,
                              color: effectiveCarpetColor,
                              accentColor: effectiveCarpetAccentColor,
                            },
                            {
                              variant: i,
                              color: effectiveCarpetColor,
                              accentColor: effectiveCarpetAccentColor,
                            },
                            {
                              variant: i,
                              color: effectiveCarpetColor,
                              accentColor: effectiveCarpetAccentColor,
                            },
                          ] as Array<import('../types.js').CarpetTile | null>;

                          for (let jy = 0; jy <= previewRows; jy++) {
                            for (let jx = 0; jx <= previewCols; jx++) {
                              const sprite = getCarpetJunctionSprite(
                                jx,
                                jy,
                                i,
                                fakeCarpets,
                                previewCols,
                                previewRows,
                                effectiveCarpetColor,
                                effectiveCarpetAccentColor,
                              );
                              if (!sprite) continue;

                              const drawX = originX + jx * tileSize - tileSize / 2;
                              const drawY = originY + jy * tileSize - tileSize / 2;
                              ctx.drawImage(getCachedSprite(sprite, previewZoom), drawX, drawY);
                            }
                          }
                        }}
                      />
                    ))}
                  </div>
                )}

              {/* Carpet color controls (collapsible) — above variant carousel */}
              {showCarpetColor && (
                <div className="flex gap-8 mb-6 -mt-4 ml-2">
                  <div className="flex flex-col gap-2">
                    <div className="text-xs uppercase tracking-[0.08em] text-text-muted">Main</div>
                    <VisualColorPicker
                      value={effectiveCarpetColor}
                      onChange={(color) => onCarpetColorChange({ ...color, colorize: true })}
                    />
                  </div>
                  <div className="flex flex-col gap-2">
                    <div className="text-xs uppercase tracking-[0.08em] text-text-muted">
                      Accent
                    </div>
                    <VisualColorPicker
                      value={effectiveCarpetAccentColor}
                      onChange={(color) => onCarpetAccentColorChange({ ...color, colorize: true })}
                    />
                  </div>
                </div>
              )}
            </>
          )}

          {/* Furniture items — single-row horizontal carousel at 2x */}
          {activeCategory !== 'carpet' && (
            <div className="carousel">
              {categoryItems.map((entry) => (
                <ItemSelect
                  key={entry.type}
                  width={thumbSize}
                  height={thumbSize}
                  selected={selectedFurnitureType === entry.type}
                  onClick={() => onFurnitureTypeChange(entry.type)}
                  title={entry.label}
                  deps={[entry.type, entry.sprite, pickedFurnitureColor]}
                  draw={(ctx, w, h) => {
                    const sprite = pickedFurnitureColor
                      ? getColorizedSprite(
                          `thumb-${entry.type}-${pickedFurnitureColor.h}-${pickedFurnitureColor.s}-${pickedFurnitureColor.b}-${pickedFurnitureColor.c}-${pickedFurnitureColor.colorize ?? ''}`,
                          entry.sprite,
                          pickedFurnitureColor,
                        )
                      : entry.sprite;
                    const cached = getCachedSprite(sprite, 2);
                    const scale = Math.min(w / cached.width, h / cached.height) * 0.85;
                    const dw = cached.width * scale;
                    const dh = cached.height * scale;
                    ctx.drawImage(cached, (w - dw) / 2, (h - dh) / 2, dw, dh);
                  }}
                />
              ))}
            </div>
          )}

          {/* Furniture color controls (collapsible) — above items */}
          {activeCategory !== 'carpet' && showFurnitureColor && (
            <ColorPicker
              value={
                selectedFurnitureUid
                  ? effectiveColor
                  : (pickedFurnitureColor ?? DEFAULT_FURNITURE_COLOR)
              }
              onChange={
                selectedFurnitureUid ? onSelectedFurnitureColorChange : onPickedFurnitureColorChange
              }
              showColorizeToggle
              onReset={() => {
                if (selectedFurnitureUid) {
                  onSelectedFurnitureColorChange(null);
                } else {
                  onPickedFurnitureColorChange(null);
                }
              }}
            />
          )}
        </div>
      )}

      {/* Sub-panel: Zones — stacked bottom-to-top via column-reverse */}
      {isZoneActive && (
        <div className="flex flex-col gap-4 mb-4">
          {/* Zone cards — visually below the add input */}
          {zones.length > 0 && (
            <div className="flex gap-4 flex-wrap">
              {zones.map((zone) => {
                // Folders mapped to this zone
                const mappedFolders = workspaceFolders.filter((f) =>
                  zoneMappings[f.name]?.includes(zone.label),
                );
                // Folders available to add (not yet in this zone)
                const availableFolders = workspaceFolders.filter(
                  (f) => !zoneMappings[f.name]?.includes(zone.label),
                );
                const isSelected = selectedZoneLabel === zone.label;

                return (
                  <div
                    key={zone.label}
                    className={`flex flex-col gap-2 min-w-130 min-h-170 py-4 px-8 cursor-pointer border-2 ${isSelected ? 'border-accent bg-accent-bg' : 'border-border bg-bg'}`}
                    onClick={() => onSelectZone(zone.label)}
                  >
                    {/* Header: color swatch + title + close */}
                    <div className="flex items-center gap-4">
                      <input
                        type="color"
                        value={zone.color}
                        onChange={(e) => onZoneColorChange(zone.label, e.target.value)}
                        onClick={(e) => e.stopPropagation()}
                        title="Change zone color"
                        className="w-16 h-16 p-0 border-2 border-border cursor-pointer"
                        style={{ background: zone.color }}
                      />
                      {editingZoneLabel === zone.label ? (
                        <input
                          ref={renameInputRef}
                          className="bg-transparent text-sm text-text border-b-2 border-accent outline-none flex-1 w-60"
                          value={editingZoneValue}
                          onChange={(e) => setEditingZoneValue(e.target.value)}
                          onBlur={() => {
                            const trimmed = editingZoneValue.trim();
                            if (trimmed && trimmed !== zone.label) {
                              onRenameZone(zone.label, trimmed);
                            }
                            setEditingZoneLabel(null);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                            if (e.key === 'Escape') setEditingZoneLabel(null);
                          }}
                          autoFocus
                          onClick={(e) => e.stopPropagation()}
                        />
                      ) : (
                        <span
                          className="text-sm text-text flex-1"
                          onDoubleClick={(e) => {
                            e.stopPropagation();
                            setEditingZoneLabel(zone.label);
                            setEditingZoneValue(zone.label);
                          }}
                          title="Double-click to rename"
                        >
                          {zone.label}
                        </span>
                      )}
                      <button
                        className="text-xs text-text-muted hover:text-red-400 bg-transparent border-none cursor-pointer px-2"
                        onClick={(e) => {
                          e.stopPropagation();
                          onRemoveZone(zone.label);
                        }}
                        title="Remove zone"
                      >
                        X
                      </button>
                    </div>

                    {/* Mapped folders */}
                    <div className="flex-1 overflow-y-auto flex flex-col gap-1 pixel-scrollbar max-h-80">
                      {mappedFolders.map((folder) => (
                        <div
                          key={folder.name}
                          className="flex items-center gap-2 px-2"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <span
                            className="text-xs text-text-muted flex-1 truncate"
                            title={folder.path}
                          >
                            {folder.name}
                          </span>
                          <button
                            className="text-2xs text-text-muted hover:text-red-400 bg-transparent border-none cursor-pointer px-2"
                            onClick={() => onZoneMappingChange(folder.name, zone.label, 'remove')}
                            title="Remove folder from zone"
                          >
                            x
                          </button>
                        </div>
                      ))}
                    </div>

                    {/* Add folder dropdown */}
                    <div className="relative mt-auto" onClick={(e) => e.stopPropagation()}>
                      <Button
                        size="sm"
                        variant={availableFolders.length === 0 ? 'disabled' : undefined}
                        className="w-full text-sm mb-3"
                        disabled={availableFolders.length === 0}
                        onClick={() =>
                          setFolderPickerZone((v) => (v === zone.label ? null : zone.label))
                        }
                      >
                        + Directory
                      </Button>
                      <Dropdown isOpen={folderPickerZone === zone.label}>
                        {availableFolders.map((f) => (
                          <DropdownItem
                            key={f.name}
                            className="text-xs"
                            onClick={() => {
                              onZoneMappingChange(f.name, zone.label, 'add');
                              setFolderPickerZone(null);
                            }}
                          >
                            {f.name}
                          </DropdownItem>
                        ))}
                      </Dropdown>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Description — visually between input and zone cards */}
          <div className="text-xs text-text-muted px-4 leading-none pb-2">
            Paint zones on the map, then assign workspace directories. Agents will sit in their
            directory's zone.
          </div>
          {/* Add new zone — visually at the top */}
          <div className="flex items-center gap-2 px-4 py-2">
            <input
              className="bg-bg-dark w-full text-text px-8 border-2 border-border outline-none"
              placeholder="Add new zone..."
              value={newZoneName}
              onChange={(e) => setNewZoneName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && newZoneName.trim()) {
                  const nextColor = ZONE_DEFAULT_COLORS[zones.length % ZONE_DEFAULT_COLORS.length];
                  onAddZone(newZoneName.trim(), nextColor);
                  setNewZoneName('');
                }
              }}
            />
            <Button
              variant="accent"
              size="sm"
              className="px-12"
              onClick={() => {
                if (newZoneName.trim()) {
                  const nextColor = ZONE_DEFAULT_COLORS[zones.length % ZONE_DEFAULT_COLORS.length];
                  onAddZone(newZoneName.trim(), nextColor);
                  setNewZoneName('');
                }
              }}
            >
              +
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
