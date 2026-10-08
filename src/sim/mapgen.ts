import { MAP_SIZE, START_MONEY } from './config';
import { Rng } from './rng';
import { Terrain, type Building, type BuildingKind, type WorldState } from './types';

const TOWN_KEYS = ['tanAn', 'phuMy', 'hoaBinh', 'anPhu'];
const FARM_KEYS = ['farm.coBa', 'farm.ongTu', 'farm.chuNam', 'farm.diSau', 'farm.baBay'];
const ORCHARD_KEYS = ['orchard.chuTam', 'orchard.coChin'];
const MILL_KEYS = ['mill.thanhPhat', 'mill.hongPhuc'];

export function createWorld(seed: number, size = MAP_SIZE): WorldState {
  const rng = new Rng(seed);
  const n = size * size;
  const world: WorldState = {
    seed,
    width: size,
    height: size,
    terrain: new Uint8Array(n),
    road: new Uint8Array(n),
    tree: new Uint8Array(n),
    occupant: new Int32Array(n).fill(-1),
    buildings: [],
    trucks: [],
    contracts: [],
    messages: [],
    money: START_MONEY,
    tick: 0,
    rngState: 0,
    nextId: 1,
    roadVersion: 0,
  };

  carveRiver(world, rng);
  scatterTrees(world, rng);

  const towns: { x: number; y: number }[] = [];
  for (const key of TOWN_KEYS.slice(0, 3)) {
    const spot = findSpot(world, rng, 4, (x, y) =>
      towns.every((t) => Math.abs(t.x - x) + Math.abs(t.y - y) >= 16),
    );
    if (!spot) continue;
    towns.push(spot);
    buildTown(world, rng, spot.x, spot.y, key);
  }

  const farFromTowns = (min: number) => (x: number, y: number) =>
    towns.every((t) => Math.abs(t.x - x) + Math.abs(t.y - y) >= min);

  placeSome(world, rng, 'farm', FARM_KEYS.slice(0, 4), farFromTowns(7));
  placeSome(world, rng, 'orchard', ORCHARD_KEYS, farFromTowns(7));
  placeSome(world, rng, 'mill', MILL_KEYS, farFromTowns(5));

  world.rngState = rng.state;
  return world;
}

function carveRiver(world: WorldState, rng: Rng) {
  const { width, height } = world;
  let x = rng.int(Math.floor(width * 0.4), Math.floor(width * 0.6));
  let drift = 0;
  for (let y = 0; y < height; y++) {
    if (rng.chance(0.35)) drift = rng.int(-1, 1);
    x = Math.max(4, Math.min(width - 6, x + drift));
    for (let dx = 0; dx < 2; dx++) world.terrain[y * width + x + dx] = Terrain.Water;
    // Fill diagonal gaps so the river is continuous for 4-neighbour movement.
    if (drift !== 0 && y + 1 < height) world.terrain[(y + 1) * width + x] = Terrain.Water;
  }
}

function scatterTrees(world: WorldState, rng: Rng) {
  const { width, height } = world;
  for (let c = 0; c < 30; c++) {
    const cx = rng.int(0, width - 1);
    const cy = rng.int(0, height - 1);
    const r = rng.int(2, 4);
    for (let y = cy - r; y <= cy + r; y++) {
      for (let x = cx - r; x <= cx + r; x++) {
        if (x < 0 || y < 0 || x >= width || y >= height) continue;
        const i = y * width + x;
        if (world.terrain[i] !== Terrain.Grass) continue;
        const d = Math.hypot(x - cx, y - cy) / r;
        if (rng.chance(0.75 * (1 - d))) world.tree[i] = 1;
      }
    }
  }
}

function isFree(world: WorldState, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= world.width || y >= world.height) return false;
  const i = y * world.width + x;
  return world.terrain[i] === Terrain.Grass && world.occupant[i] === -1 && !world.road[i];
}

function areaFree(world: WorldState, x: number, y: number, w: number, h: number, margin: number) {
  for (let yy = y - margin; yy < y + h + margin; yy++) {
    for (let xx = x - margin; xx < x + w + margin; xx++) {
      if (!isFree(world, xx, yy)) return false;
    }
  }
  return true;
}

function findSpot(
  world: WorldState,
  rng: Rng,
  margin: number,
  extra: (x: number, y: number) => boolean,
  w = 2,
  h = 2,
): { x: number; y: number } | null {
  for (let attempt = 0; attempt < 400; attempt++) {
    const x = rng.int(margin, world.width - w - margin);
    const y = rng.int(margin, world.height - h - margin);
    if (areaFree(world, x, y, w, h, margin) && extra(x, y)) return { x, y };
  }
  return null;
}

function addBuilding(
  world: WorldState,
  rng: Rng,
  kind: BuildingKind,
  x: number,
  y: number,
  w: number,
  h: number,
  nameKey: string,
): Building {
  const b: Building = {
    id: world.nextId++,
    kind,
    x,
    y,
    w,
    h,
    nameKey,
    stock: {},
    variant: rng.int(0, 5),
  };
  for (let yy = y; yy < y + h; yy++) {
    for (let xx = x; xx < x + w; xx++) {
      const i = yy * world.width + xx;
      world.occupant[i] = b.id;
      world.tree[i] = 0;
    }
  }
  world.buildings.push(b);
  return b;
}

function buildTown(world: WorldState, rng: Rng, cx: number, cy: number, key: string) {
  const { width } = world;
  addBuilding(world, rng, 'market', cx, cy, 2, 2, `market.${key}`);

  const setRoad = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= world.width || y >= world.height) return;
    const i = y * width + x;
    if (world.terrain[i] !== Terrain.Grass || world.occupant[i] !== -1) return;
    world.road[i] = 1;
    world.tree[i] = 0;
  };
  // A small cross of streets next to the market.
  for (let x = cx - 4; x <= cx + 5; x++) setRoad(x, cy + 2);
  for (let y = cy - 3; y <= cy + 5; y++) setRoad(cx - 1, y);

  for (let y = cy - 4; y <= cy + 6; y++) {
    for (let x = cx - 5; x <= cx + 6; x++) {
      if (!isFree(world, x, y)) continue;
      const d = Math.abs(x - cx) + Math.abs(y - cy);
      if (rng.chance(0.55 - d * 0.05)) addBuilding(world, rng, 'house', x, y, 1, 1, 'house');
    }
  }
}

function placeSome(
  world: WorldState,
  rng: Rng,
  kind: BuildingKind,
  keys: string[],
  extra: (x: number, y: number) => boolean,
) {
  for (const key of keys) {
    const spot = findSpot(world, rng, 1, extra);
    if (spot) addBuilding(world, rng, kind, spot.x, spot.y, 2, 2, key);
  }
}
