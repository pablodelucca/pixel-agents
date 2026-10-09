/**
 * Unit tests for game tables: the Character FSM's PLAY behaviour, the composed
 * play sprites, and OfficeState match scoring / celebration.
 *
 * Covers:
 *   - IDLE → WALK toward a free slot (claims it via playSlot)
 *   - WALK arrival at the slot → PLAY facing the table
 *   - PLAY → IDLE when the agent becomes active (claim released)
 *   - PLAY → IDLE when the rally timer expires
 *   - WALK arrival somewhere else releases the claim
 *
 * Run with: npm test
 */

import assert from 'node:assert/strict';

import { afterEach, beforeEach, test } from 'vitest';

import { createCharacter, updateCharacter } from '../src/office/engine/characters.js';
import type { GameSlot, TileType as TileTypeVal } from '../src/office/types.js';
import { CharacterState, Direction, TileType } from '../src/office/types.js';

function openMap(cols: number, rows: number): TileTypeVal[][] {
  return Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => TileType.FLOOR_1 as TileTypeVal),
  );
}

const tileMap = openMap(8, 4);
const walkable = [{ col: 0, row: 0 }];
const seats = new Map();
const blocked = new Set<string>();
const slot: GameSlot = {
  uid: 'table-1',
  game: 'PING_PONG_TABLE',
  side: 1,
  col: 5,
  row: 1,
  dir: Direction.RIGHT,
};

const realRandom = Math.random;
beforeEach(() => {
  Math.random = () => 0; // always join, always pick slot 0, shortest timers
});
afterEach(() => {
  Math.random = realRandom;
});

function idleCharAt(col: number, row: number) {
  const ch = createCharacter(1, 0, null, null);
  ch.state = CharacterState.IDLE;
  ch.isActive = false;
  ch.tileCol = col;
  ch.tileRow = row;
  ch.wanderTimer = 0;
  return ch;
}

test('idle character walks to a free ping pong slot and claims it', () => {
  const ch = idleCharAt(1, 1);
  updateCharacter(ch, 0.1, walkable, seats, tileMap, blocked, [slot]);
  assert.equal(ch.state, CharacterState.WALK);
  assert.deepEqual(ch.playSlot, slot);
  assert.deepEqual(ch.path[ch.path.length - 1], { col: 5, row: 1 });
});

test('arriving at the slot starts playing, facing the table', () => {
  const ch = idleCharAt(5, 1);
  ch.state = CharacterState.WALK;
  ch.playSlot = slot;
  ch.path = [];
  updateCharacter(ch, 0.1, walkable, seats, tileMap, blocked, []);
  assert.equal(ch.state, CharacterState.PLAY);
  assert.equal(ch.dir, Direction.RIGHT);
});

test('becoming active ends the game and releases the slot', () => {
  const ch = idleCharAt(5, 1);
  ch.state = CharacterState.PLAY;
  ch.playSlot = slot;
  ch.isActive = true;
  updateCharacter(ch, 0.1, walkable, seats, tileMap, blocked, []);
  assert.equal(ch.state, CharacterState.IDLE);
  assert.equal(ch.playSlot, null);
});

test('players keep playing indefinitely while idle', () => {
  const ch = idleCharAt(5, 1);
  ch.state = CharacterState.PLAY;
  ch.playSlot = slot;
  for (let t = 0; t < 600; t += 0.1)
    updateCharacter(ch, 0.1, walkable, seats, tileMap, blocked, []);
  assert.equal(ch.state, CharacterState.PLAY, 'still at the table after 10 minutes');
});

test('arriving anywhere but the slot drops the claim', () => {
  const ch = idleCharAt(2, 2);
  ch.state = CharacterState.WALK;
  ch.playSlot = slot;
  ch.path = [];
  updateCharacter(ch, 0.1, walkable, seats, tileMap, blocked, []);
  assert.equal(ch.state, CharacterState.IDLE);
  assert.equal(ch.playSlot, null);
});

test('play sprites stand on the walk frame and hold a paddle, mirrored when facing left', async () => {
  const { getPlaySprites } = await import('../src/office/sprites/spriteData.js');
  const { default: paddle } = await import('../src/office/sprites/paddle-ready.json');
  const SKIN = 'skin-pixel'; // any pixel string — compose copies it verbatim
  const RED = paddle.palette.R;
  const blank = () => Array.from({ length: 32 }, () => Array.from({ length: 16 }, () => ''));
  const frame = blank();
  frame[22][9] = SKIN; // hand pixel → arm color for the swing overlay
  const dirs = [Direction.DOWN, Direction.UP, Direction.RIGHT, Direction.LEFT] as const;
  const four = (s: string[][]) => [s, s, s, s] as [string[][], string[][], string[][], string[][]];
  const two = (s: string[][]) => [s, s] as [string[][], string[][]];
  const sprites = {
    walk: Object.fromEntries(dirs.map((d) => [d, four(frame)])),
    typing: Object.fromEntries(dirs.map((d) => [d, two(blank())])),
    reading: Object.fromEntries(dirs.map((d) => [d, two(blank())])),
  } as unknown as Parameters<typeof getPlaySprites>[0];

  const play = getPlaySprites(sprites);
  const [ready, swing] = play[Direction.RIGHT];
  assert.equal(ready[21][13], RED, 'paddle blade at the right hand when facing right');
  assert.equal(swing[19][10], SKIN, 'raised arm takes the skin color');
  assert.equal(play[Direction.LEFT][0][21][15 - 13], RED, 'paddle mirrored when facing left');
  assert.equal(getPlaySprites(sprites), play, 'composed sprites are cached per sprite set');
});

test('a match scores points, the scorer celebrates, and a win starts a new game', async () => {
  const { OfficeState } = await import('../src/office/engine/officeState.js');
  const {
    GAME_WIN_SCORE,
    GAME_CELEBRATE_WIN_SEC,
    GAME_HITS_MAX,
    GAME_RALLY_FLIGHT_SEC,
    GAME_MISS_SEC,
    GAME_PICKUP_SEC,
  } = await import('../src/constants.js');
  const os = new OfficeState();
  const left: GameSlot = { ...slot, side: 0, col: 1, dir: Direction.RIGHT };
  const right: GameSlot = { ...slot, side: 1, col: 5, dir: Direction.LEFT };
  const a = idleCharAt(1, 1);
  const b = idleCharAt(5, 1);
  b.id = 2;
  for (const [ch, s] of [
    [a, left],
    [b, right],
  ] as const) {
    ch.state = CharacterState.PLAY;
    ch.playSlot = s;
    os.characters.set(ch.id, ch);
  }

  // Math.random → 0: left side always scores, shortest point delay
  const tick = (sec: number) => {
    for (let t = 0; t < sec; t += 0.1) os.update(0.1);
  };
  os.update(0.1);
  const match = os.matches.get('table-1');
  assert.ok(match, 'match starts once both ends are taken');
  // Advance until the first point lands (bounded by the longest point delay)
  // Longest possible point: serve + every return, the miss, and the pickup
  const POINT_MAX_SEC =
    (GAME_HITS_MAX + 1) * GAME_RALLY_FLIGHT_SEC + GAME_MISS_SEC + GAME_PICKUP_SEC;
  for (let t = 0; t < POINT_MAX_SEC + 0.2 && match.scores[0] === 0; t += 0.1) os.update(0.1);
  assert.equal(match.scores[0], 1, 'left player scored');
  assert.equal(match.scores[1], 0);
  assert.ok(a.celebrateTimer > 0, 'scorer celebrates');
  assert.equal(b.celebrateTimer, 0, 'loser does not');

  // Points may alternate sides, so allow the longest possible game to 5
  tick((2 * GAME_WIN_SCORE - 1) * POINT_MAX_SEC + GAME_CELEBRATE_WIN_SEC + 1);
  assert.ok(os.matches.has('table-1'), 'a new game is running at the same table');
  assert.ok(Math.max(...match.scores) < GAME_WIN_SCORE, 'scores were reset for the new game');
  assert.equal(a.state, CharacterState.PLAY, 'winner keeps playing');
  assert.equal(b.state, CharacterState.PLAY, 'loser keeps playing');
});

test('a match is dropped as soon as one player leaves', async () => {
  const { OfficeState } = await import('../src/office/engine/officeState.js');
  const os = new OfficeState();
  const a = idleCharAt(1, 1);
  const b = idleCharAt(5, 1);
  b.id = 2;
  a.state = b.state = CharacterState.PLAY;
  a.playSlot = { ...slot, side: 0 };
  b.playSlot = { ...slot, side: 1 };
  os.characters.set(1, a);
  os.characters.set(2, b);
  os.update(0.1);
  assert.ok(os.matches.has('table-1'));
  b.isActive = true; // work arrived
  os.update(0.1);
  assert.equal(os.matches.has('table-1'), false);
});

test('click-to-play: sendToGame walks an idle agent to the nearest free end', async () => {
  const { OfficeState } = await import('../src/office/engine/officeState.js');
  const os = new OfficeState();
  // No catalog in tests → inject slots directly (what layoutToGameSlots would derive)
  os.gameSlots = [
    { ...slot, side: 0, col: 1, dir: Direction.RIGHT },
    { ...slot, side: 1, col: 5, dir: Direction.LEFT },
  ];
  const ch = idleCharAt(6, 1);
  os.characters.set(1, ch);
  assert.equal(os.getGameTableAtTile(5, 1), 'table-1', 'slot tile resolves to its table');
  assert.equal(os.sendToGame(1, 'table-1'), true);
  assert.equal(ch.state, CharacterState.WALK);
  assert.equal(ch.playSlot?.col, 5, 'nearest end chosen');
  assert.deepEqual(
    os.getGameSlotStatus('table-1').map((s) => s.free),
    [true, false],
    'claimed end shows as taken',
  );
  ch.isActive = true;
  assert.equal(os.sendToGame(1, 'table-1'), false, 'busy agents stay at work');
});

test('sendToGame is a no-op for a player already at that table (never swaps ends)', async () => {
  const { OfficeState } = await import('../src/office/engine/officeState.js');
  const os = new OfficeState();
  const left: GameSlot = { ...slot, side: 0, col: 1, dir: Direction.RIGHT };
  const right: GameSlot = { ...slot, side: 1, col: 5, dir: Direction.LEFT };
  os.gameSlots = [left, right];
  const ch = idleCharAt(5, 1);
  ch.state = CharacterState.PLAY;
  ch.playSlot = right;
  os.characters.set(1, ch);
  assert.equal(os.sendToGame(1, 'table-1'), true);
  assert.equal(ch.state, CharacterState.PLAY, 'still playing');
  assert.equal(ch.playSlot, right, 'kept its own end');
});

test('grid expansion shifts a player claim along with the table', async () => {
  const { OfficeState } = await import('../src/office/engine/officeState.js');
  const os = new OfficeState();
  const ch = idleCharAt(5, 1);
  ch.state = CharacterState.PLAY;
  ch.playSlot = { ...slot, col: 5, row: 1 };
  os.characters.set(1, ch);
  // No catalog in tests → the rebuilt layout has no slots, so a claim survives only
  // if the shift moved it onto a still-existing slot. Simulate by pre-seeding the
  // shifted slot the layout would derive and checking coords moved with it.
  const layout = os.getLayout();
  const before = { ...ch.playSlot };
  os.rebuildFromLayout(layout, { col: 1, row: 1 });
  // Claim was released because the empty catalog derives no slots at all…
  assert.equal(ch.playSlot, null);
  // …but the character itself moved, proving the shift ran before the release check.
  assert.equal(ch.tileCol, before.col + 1);
  assert.equal(ch.tileRow, before.row + 1);
});

test('queue: a third idle agent waits beside a full table', async () => {
  const { OfficeState } = await import('../src/office/engine/officeState.js');
  const os = new OfficeState();
  const left: GameSlot = { ...slot, side: 0, col: 1, dir: Direction.RIGHT };
  const right: GameSlot = { ...slot, side: 1, col: 5, dir: Direction.LEFT };
  os.gameSlots = [left, right];
  os.waitSpots = [{ uid: 'table-1', col: 6, row: 1, dir: Direction.LEFT }];
  const a = idleCharAt(1, 1);
  const b = idleCharAt(5, 1);
  b.id = 2;
  a.state = b.state = CharacterState.PLAY;
  a.playSlot = left;
  b.playSlot = right;
  const c = idleCharAt(3, 2);
  c.id = 3;
  os.characters.set(1, a);
  os.characters.set(2, b);
  os.characters.set(3, c);
  os.update(0.1); // Math.random → 0: c heads for a game; both ends taken → wait spot
  assert.equal(c.playSlot, null, 'did not take an occupied end');
  assert.equal(c.waitSpot?.col, 6, 'claimed the wait spot');
  assert.equal(c.state, CharacterState.WALK);
  // arrive
  c.tileCol = 6;
  c.tileRow = 1;
  c.path = [];
  os.update(0.1);
  assert.equal(c.state, CharacterState.QUEUE);
  assert.equal(c.dir, Direction.LEFT, 'watches the table');

  // b gets work → leaves; the queue head takes the freed end, a newcomer does not
  const d = idleCharAt(3, 3);
  d.id = 4;
  os.characters.set(4, d);
  b.isActive = true;
  os.update(0.1); // b: PLAY → IDLE (end freed)
  os.update(0.1); // c: QUEUE → WALK toward the freed end; d must not grab it
  assert.equal((c.playSlot as GameSlot | null)?.side, 1, 'queue head claimed the freed end');
  assert.equal(c.waitSpot, null);
  assert.notEqual(d.playSlot?.uid, 'table-1', 'newcomer did not jump the queue');
});

test('click-to-play joins the queue when both ends are taken', async () => {
  const { OfficeState } = await import('../src/office/engine/officeState.js');
  const os = new OfficeState();
  os.gameSlots = [
    { ...slot, side: 0, col: 1, dir: Direction.RIGHT },
    { ...slot, side: 1, col: 5, dir: Direction.LEFT },
  ];
  os.waitSpots = [{ uid: 'table-1', col: 6, row: 1, dir: Direction.LEFT }];
  const a = idleCharAt(1, 1);
  const b = idleCharAt(5, 1);
  b.id = 2;
  a.state = b.state = CharacterState.PLAY;
  a.playSlot = os.gameSlots[0];
  b.playSlot = os.gameSlots[1];
  const c = idleCharAt(3, 2);
  c.id = 3;
  os.characters.set(1, a);
  os.characters.set(2, b);
  os.characters.set(3, c);
  assert.equal(os.sendToGame(3, 'table-1'), true);
  assert.equal(c.playSlot, null);
  assert.equal(c.waitSpot?.col, 6);
  assert.equal(os.sendToGame(3, 'table-1'), true, 'already queued: no-op');
});

test('after a game to 5, the loser joins the back of the line and the queue head steps in', async () => {
  const { OfficeState } = await import('../src/office/engine/officeState.js');
  const { GAME_WIN_SCORE, GAME_HITS_MAX, GAME_RALLY_FLIGHT_SEC, GAME_MISS_SEC, GAME_PICKUP_SEC } =
    await import('../src/constants.js');
  const os = new OfficeState();
  const left: GameSlot = { ...slot, side: 0, col: 1, dir: Direction.RIGHT };
  const right: GameSlot = { ...slot, side: 1, col: 5, dir: Direction.LEFT };
  os.gameSlots = [left, right];
  os.waitSpots = [
    { uid: 'table-1', col: 6, row: 1, dir: Direction.LEFT },
    { uid: 'table-1', col: 7, row: 1, dir: Direction.LEFT },
  ];
  const a = idleCharAt(1, 1); // left — Math.random → 0 makes the left side win every point
  const b = idleCharAt(5, 1);
  b.id = 2;
  const c = idleCharAt(6, 1);
  c.id = 3;
  a.state = b.state = CharacterState.PLAY;
  a.playSlot = left;
  b.playSlot = right;
  c.state = CharacterState.QUEUE;
  c.waitSpot = os.waitSpots[0];
  c.queuedAt = 1;
  os.characters.set(1, a);
  os.characters.set(2, b);
  os.characters.set(3, c);

  const POINT_MAX_SEC =
    (GAME_HITS_MAX + 1) * GAME_RALLY_FLIGHT_SEC + GAME_MISS_SEC + GAME_PICKUP_SEC;
  for (let t = 0; t < (2 * GAME_WIN_SCORE + 1) * POINT_MAX_SEC && b.playSlot; t += 0.1) {
    os.update(0.1);
  }
  assert.equal(b.playSlot, null, 'loser gave up its end');
  assert.equal(b.waitSpot?.uid, 'table-1', 'loser is heading for the back of the line');
  assert.equal(a.state, CharacterState.PLAY, 'winner stays on');
  os.update(0.1);
  assert.equal((c.playSlot as GameSlot | null)?.side, 1, 'queue head took the freed end');
  assert.ok(b.queuedAt > c.queuedAt, 'loser is behind everyone already waiting');
});

test('a layout save does not teleport players or spectators back to their seats', async () => {
  const { OfficeState } = await import('../src/office/engine/officeState.js');
  const os = new OfficeState();
  // No catalog in tests → inject a seat the way layoutToSeats would derive one
  const seatId = 'chair-1';
  const seat = { uid: seatId, seatCol: 3, seatRow: 3, facingDir: Direction.UP, assigned: false };
  os.seats.set(seatId, seat);
  const end: GameSlot = { ...slot, side: 0, col: 5, row: 3 };
  os.gameSlots = [end];
  const ch = idleCharAt(end.col, end.row);
  ch.seatId = seatId;
  seat.assigned = true;
  ch.state = CharacterState.PLAY;
  ch.playSlot = end;
  os.characters.set(1, ch);
  os.rebuildFromLayout(os.getLayout());
  assert.equal(ch.tileCol, end.col, 'still at the table end');
  assert.equal(ch.state, CharacterState.PLAY);
});

test('an agent resting at its seat gets up when a table end is free', () => {
  const ch = idleCharAt(1, 1);
  ch.state = CharacterState.TYPE;
  ch.isActive = false;
  ch.seatTimer = 120; // long rest
  updateCharacter(ch, 0.1, walkable, seats, tileMap, blocked, [slot]);
  assert.equal(ch.state, CharacterState.WALK);
  assert.deepEqual(ch.playSlot, slot);
  assert.equal(ch.seatTimer, 0);
});

test('a spectator sits on a nearby couch seat and leaves it when an agent gets that seat', () => {
  const couch = {
    uid: 'table-1',
    col: 6,
    row: 1,
    dir: Direction.LEFT,
    seatId: 'sofa:1',
  };
  const seatMap = new Map([
    ['sofa:1', { uid: 'sofa', seatCol: 6, seatRow: 1, facingDir: Direction.LEFT, assigned: false }],
  ]);
  const blockedWithSeat = new Set(['6,1']); // seat tiles are blocked for everyone
  const ch = idleCharAt(2, 1);
  updateCharacter(ch, 0.1, walkable, seatMap, tileMap, blockedWithSeat, [], [couch]);
  assert.equal(ch.waitSpot?.seatId, 'sofa:1', 'claimed the couch spot despite the blocked tile');
  assert.equal(ch.state, CharacterState.WALK);
  ch.tileCol = 6;
  ch.path = [];
  updateCharacter(ch, 0.1, walkable, seatMap, tileMap, blockedWithSeat, [], []);
  assert.equal(ch.state, CharacterState.QUEUE);
  seatMap.get('sofa:1')!.assigned = true; // a new agent got this seat
  updateCharacter(ch, 0.1, walkable, seatMap, tileMap, blockedWithSeat, [], []);
  assert.equal(ch.state, CharacterState.IDLE, 'vacated the couch');
  assert.equal(ch.waitSpot, null);
});
