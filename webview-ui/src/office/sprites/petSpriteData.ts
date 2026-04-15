type SpriteData = string[][];

export interface PetSpriteFrames {
  walkDown: [SpriteData, SpriteData, SpriteData];
  idleDown: [SpriteData, SpriteData, SpriteData];
  walkUp: [SpriteData, SpriteData, SpriteData];
  idleUp: [SpriteData, SpriteData, SpriteData];
  walkRight: [SpriteData, SpriteData, SpriteData];
  walkLeft: [SpriteData, SpriteData, SpriteData];
  idleRight: [SpriteData, SpriteData, SpriteData];
  idleLeft: [SpriteData, SpriteData, SpriteData];
}

function flipHorizontal(sprite: SpriteData): SpriteData {
  return sprite.map((row) => [...row].reverse());
}

export interface PetManifest {
  id: string;
  name: string;
}

let loadedPets: PetSpriteFrames[] | null = null;
let loadedPetManifests: PetManifest[] = [];

export function setPetTemplates(
  data: Array<{
    walkDown: string[][][];
    idleDown: string[][][];
    walkUp: string[][][];
    idleUp: string[][][];
    walkRight: string[][][];
  }>,
  manifests?: PetManifest[],
): void {
  loadedPets = data
    .filter(
      (raw) =>
        raw.walkDown?.length >= 3 &&
        raw.walkUp?.length >= 3 &&
        raw.walkRight?.length >= 3 &&
        raw.idleDown?.length >= 3 &&
        raw.idleUp?.length >= 3,
    )
    .map((raw) => ({
      walkDown: raw.walkDown as [SpriteData, SpriteData, SpriteData],
      idleDown: raw.idleDown as [SpriteData, SpriteData, SpriteData],
      walkUp: raw.walkUp as [SpriteData, SpriteData, SpriteData],
      idleUp: raw.idleUp as [SpriteData, SpriteData, SpriteData],
      walkRight: raw.walkRight as [SpriteData, SpriteData, SpriteData],
      walkLeft: [
        flipHorizontal(raw.walkRight[0]),
        flipHorizontal(raw.walkRight[1]),
        flipHorizontal(raw.walkRight[2]),
      ] as [SpriteData, SpriteData, SpriteData],
      idleRight: raw.idleDown as [SpriteData, SpriteData, SpriteData],
      idleLeft: raw.idleUp as [SpriteData, SpriteData, SpriteData],
    }));
  loadedPetManifests = manifests ?? [];
}

export function getPetSprites(petIndex: number): PetSpriteFrames | null {
  return loadedPets?.[petIndex] ?? null;
}

export function getPetCount(): number {
  return loadedPets?.length ?? 0;
}

export function getPetName(petIndex: number): string {
  return loadedPetManifests[petIndex]?.name ?? `Pet ${petIndex}`;
}
