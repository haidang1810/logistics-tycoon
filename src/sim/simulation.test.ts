import { describe, expect, it } from 'vitest';
import { TICKS_PER_DAY, TRUCK } from './config';
import { createWorld } from './mapgen';
import { findPath } from './pathfinding';
import { Simulation } from './simulation';

/** Builds an L-shaped road between two buildings' sides. Test helper only. */
function connect(sim: Simulation, aId: number, bId: number) {
  const a = sim.building(aId)!;
  const b = sim.building(bId)!;
  const tiles: number[] = [];
  const ax = a.x - 1;
  const ay = a.y;
  const bx = b.x - 1;
  const by = b.y;
  for (let x = Math.min(ax, bx); x <= Math.max(ax, bx); x++) tiles.push(sim.tileIndex(x, ay));
  for (let y = Math.min(ay, by); y <= Math.max(ay, by); y++) tiles.push(sim.tileIndex(bx, y));
  sim.world.money = 1e9;
  sim.buildRoad(tiles.filter((i) => sim.world.occupant[i] === -1));
}

describe('mapgen', () => {
  it('is deterministic for a seed', () => {
    const a = createWorld(42);
    const b = createWorld(42);
    expect(a.buildings).toEqual(b.buildings);
    expect(a.terrain).toEqual(b.terrain);
  });

  it('places the M0 supply chain', () => {
    const w = createWorld(7);
    const kinds = new Set(w.buildings.map((b) => b.kind));
    for (const k of ['farm', 'mill', 'market', 'orchard']) expect(kinds.has(k as never)).toBe(true);
  });
});

describe('pathfinding', () => {
  it('finds a straight road', () => {
    const width = 5;
    const road = new Uint8Array(25);
    for (let x = 0; x < 5; x++) road[2 * width + x] = 1;
    const path = findPath({ width, height: 5, road }, 10, new Set([14]), () => 0);
    expect(path).toEqual([10, 11, 12, 13, 14]);
  });

  it('returns null without a connection', () => {
    const road = new Uint8Array(25);
    road[0] = 1;
    road[24] = 1;
    expect(findPath({ width: 5, height: 5, road }, 0, new Set([24]), () => 0)).toBeNull();
  });
});

describe('simulation', () => {
  it('a truck on a connected route earns money over time', () => {
    const sim = new Simulation(7);
    const farm = sim.world.buildings.find((b) => b.kind === 'farm')!;
    const mill = sim.world.buildings.find((b) => b.kind === 'mill')!;
    connect(sim, farm.id, mill.id);
    sim.world.money = 100_000;
    const bought = sim.buyTruck(farm.id, mill.id);
    expect(bought).toMatchObject({ ok: true });
    const moneyAfterBuy = sim.world.money;

    for (let i = 0; i < TICKS_PER_DAY * 90; i++) sim.step();

    const truck = sim.world.trucks[0];
    expect(truck.trips).toBeGreaterThan(0);
    expect(truck.earned).toBeGreaterThan(TRUCK.runCostPerDay * 90);
    expect((mill.stock.paddy ?? 0) + (mill.stock.rice ?? 0)).toBeGreaterThan(0);
    expect(sim.world.money).toBeGreaterThan(moneyAfterBuy - TRUCK.runCostPerDay * 90);
  });

  it('starts trucks on the road piece that reaches the target', () => {
    const sim = new Simulation(7);
    const farm = sim.world.buildings.find((b) => b.kind === 'farm')!;
    const mill = sim.world.buildings.find((b) => b.kind === 'mill')!;
    connect(sim, farm.id, mill.id);
    // An isolated stub on the other side of the farm, which accessTiles() may list first.
    const stub = sim.tileIndex(farm.x + farm.w, farm.y);
    if (sim.world.occupant[stub] === -1) sim.buildRoad([stub]);
    sim.buyTruck(farm.id, mill.id);
    for (let i = 0; i < TICKS_PER_DAY * 30; i++) sim.step();
    expect(sim.world.trucks[0].state).not.toBe('stuck');
    expect(sim.world.trucks[0].trips).toBeGreaterThan(0);
  });

  it('refuses a route with mismatched cargo', () => {
    const sim = new Simulation(7);
    const farm = sim.world.buildings.find((b) => b.kind === 'farm')!;
    const market = sim.world.buildings.find((b) => b.kind === 'market')!;
    expect(sim.buyTruck(farm.id, market.id)).toMatchObject({ ok: false, reason: 'err.cargoMismatch' });
  });
});
