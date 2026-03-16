/**
 * Browser dev mode mock — fetches pre-decoded assets from the Vite dev server
 * and injects the same postMessage events the VS Code extension would send.
 *
 * Only imported in dev mode or browser-mock builds; tree-shaken from the VS Code webview production build.
 */

import type {
  AssetIndex,
  CatalogEntry,
  CharacterDirectionSprites,
} from '../../shared/assets/types.ts';

interface MockPayload {
  characters: CharacterDirectionSprites[];
  floorSprites: string[][][];
  wallSets: string[][][][];
  furnitureCatalog: CatalogEntry[];
  furnitureSprites: Record<string, string[][]>;
  layout: unknown;
}

// ── Module-level state ─────────────────────────────────────────────────────────

let mockPayload: MockPayload | null = null;

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Call before createRoot() in main.tsx.
 * Fetches all pre-decoded assets from the Vite dev server and stores them
 * for dispatchMockMessages().
 */
export async function initBrowserMock(): Promise<void> {
  console.log('[BrowserMock] Loading pre-decoded assets...');

  const [assetIndex, catalog, characters, floorSprites, wallSets, furnitureSprites] =
    await Promise.all([
      fetch('/assets/asset-index.json').then((r) => r.json()) as Promise<AssetIndex>,
      fetch('/assets/furniture-catalog.json').then((r) => r.json()) as Promise<CatalogEntry[]>,
      fetch('/assets/decoded/characters.json').then((r) => r.json()) as Promise<
        CharacterDirectionSprites[]
      >,
      fetch('/assets/decoded/floors.json').then((r) => r.json()) as Promise<string[][][]>,
      fetch('/assets/decoded/walls.json').then((r) => r.json()) as Promise<string[][][][]>,
      fetch('/assets/decoded/furniture.json').then((r) => r.json()) as Promise<
        Record<string, string[][]>
      >,
    ]);

  const layout = assetIndex.defaultLayout
    ? await fetch(`/assets/${assetIndex.defaultLayout}`).then((r) => r.json())
    : null;

  mockPayload = {
    characters,
    floorSprites,
    wallSets,
    furnitureCatalog: catalog,
    furnitureSprites,
    layout,
  };

  console.log(
    `[BrowserMock] Ready — ${characters.length} chars, ${floorSprites.length} floors, ${wallSets.length} wall sets, ${catalog.length} furniture items`,
  );
}

/**
 * Call inside a useEffect in App.tsx — after the window message listener
 * in useExtensionMessages has been registered.
 */
export function dispatchMockMessages(): void {
  if (!mockPayload) return;

  const { characters, floorSprites, wallSets, furnitureCatalog, furnitureSprites, layout } =
    mockPayload;

  function dispatch(data: unknown): void {
    window.dispatchEvent(new MessageEvent('message', { data }));
  }

  // Must match the load order defined in CLAUDE.md:
  // characterSpritesLoaded → floorTilesLoaded → wallTilesLoaded → furnitureAssetsLoaded → layoutLoaded
  dispatch({ type: 'characterSpritesLoaded', characters });
  dispatch({ type: 'floorTilesLoaded', sprites: floorSprites });
  dispatch({ type: 'wallTilesLoaded', sets: wallSets });
  dispatch({ type: 'furnitureAssetsLoaded', catalog: furnitureCatalog, sprites: furnitureSprites });
  dispatch({ type: 'layoutLoaded', layout });
  dispatch({ type: 'settingsLoaded', soundEnabled: false });

  console.log('[BrowserMock] Messages dispatched');
}
