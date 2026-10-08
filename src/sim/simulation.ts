import {
  BRIDGE_COST,
  BULLDOZE_REFUND,
  CARGO_PRICE,
  CONTRACT,
  DAYS_PER_MONTH,
  DISTANCE_DIVISOR,
  MAX_MESSAGES,
  PRODUCTION,
  ROAD_COST,
  TICKS_PER_DAY,
  TREE_CLEAR_COST,
  TRUCK,
} from './config';
import { createWorld } from './mapgen';
import { findPath } from './pathfinding';
import { Rng } from './rng';
import {
  Terrain,
  type Building,
  type BuildingKind,
  type CargoId,
  type CommandResult,
  type Contract,
  type MessageTone,
  type Truck,
  type WorldState,
} from './types';

const PRODUCES: Partial<Record<BuildingKind, CargoId>> = {
  farm: 'paddy',
  orchard: 'fruit',
  mill: 'rice',
};

const ACCEPTS: Partial<Record<BuildingKind, CargoId[]>> = {
  mill: ['paddy'],
  market: ['rice', 'fruit'],
};

const TRUCK_COLORS = [0xe8574a, 0x3d8bd9, 0xf2b134, 0x5cb85c, 0x9b59b6, 0xff8c42];

export function producedCargo(b: Building): CargoId | undefined {
  return PRODUCES[b.kind];
}

export function acceptedCargo(b: Building): CargoId[] {
  return ACCEPTS[b.kind] ?? [];
}

/**
 * The whole game simulation. Pure logic, no rendering or DOM.
 * Deterministic: same seed + same commands at the same ticks = same result.
 */
export class Simulation {
  readonly world: WorldState;
  private rng: Rng;
  private buildingById = new Map<number, Building>();

  constructor(seedOrWorld: number | WorldState) {
    this.world = typeof seedOrWorld === 'number' ? createWorld(seedOrWorld) : seedOrWorld;
    this.rng = new Rng(this.world.rngState);
    for (const b of this.world.buildings) this.buildingById.set(b.id, b);
    if (this.world.tick === 0 && this.world.contracts.length === 0) this.generateOffers();
  }

  // ---------- queries ----------

  get day() {
    return Math.floor(this.world.tick / TICKS_PER_DAY);
  }

  building(id: number) {
    return this.buildingById.get(id);
  }

  tileIndex(x: number, y: number) {
    return y * this.world.width + x;
  }

  inBounds(x: number, y: number) {
    return x >= 0 && y >= 0 && x < this.world.width && y < this.world.height;
  }

  buildingAt(x: number, y: number): Building | undefined {
    if (!this.inBounds(x, y)) return undefined;
    const id = this.world.occupant[this.tileIndex(x, y)];
    return id === -1 ? undefined : this.buildingById.get(id);
  }

  /** Cost to place road on a tile, or null if it can't hold road (or already has one). */
  roadTileCost(i: number): number | null {
    const w = this.world;
    if (w.road[i] || w.occupant[i] !== -1) return null;
    let cost = w.terrain[i] === Terrain.Water ? BRIDGE_COST : ROAD_COST;
    if (w.tree[i]) cost += TREE_CLEAR_COST;
    return cost;
  }

  /** Road tiles touching a building's footprint. */
  accessTiles(b: Building): Set<number> {
    const set = new Set<number>();
    const w = this.world;
    for (let y = b.y - 1; y <= b.y + b.h; y++) {
      for (let x = b.x - 1; x <= b.x + b.w; x++) {
        const inside = x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h;
        const corner = (x === b.x - 1 || x === b.x + b.w) && (y === b.y - 1 || y === b.y + b.h);
        if (inside || corner || !this.inBounds(x, y)) continue;
        const i = this.tileIndex(x, y);
        if (w.road[i]) set.add(i);
      }
    }
    return set;
  }

  canRoute(from: Building, to: Building): CargoId | null {
    const c = producedCargo(from);
    if (!c || !acceptedCargo(to).includes(c)) return null;
    return c;
  }

  // ---------- commands ----------

  buildRoad(tiles: number[]): CommandResult {
    const unique = [...new Set(tiles)];
    let cost = 0;
    const toBuild: number[] = [];
    for (const i of unique) {
      const c = this.roadTileCost(i);
      if (c === null) continue;
      cost += c;
      toBuild.push(i);
    }
    if (toBuild.length === 0) return { ok: false, reason: 'err.nothingToBuild' };
    if (cost > this.world.money) return { ok: false, reason: 'err.noMoney', cost };
    for (const i of toBuild) {
      this.world.road[i] = 1;
      this.world.tree[i] = 0;
    }
    this.world.money -= cost;
    this.world.roadVersion++;
    return { ok: true, cost };
  }

  bulldoze(tiles: number[]): CommandResult {
    const w = this.world;
    const busy = new Set<number>();
    for (const t of w.trucks) {
      busy.add(t.path[t.pathPos]);
      if (t.pathPos + 1 < t.path.length) busy.add(t.path[t.pathPos + 1]);
    }
    let refund = 0;
    let removed = 0;
    let blocked = false;
    for (const i of new Set(tiles)) {
      if (!w.road[i]) continue;
      if (busy.has(i)) {
        blocked = true;
        continue;
      }
      w.road[i] = 0;
      refund += (w.terrain[i] === Terrain.Water ? BRIDGE_COST : ROAD_COST) * BULLDOZE_REFUND;
      removed++;
    }
    if (removed === 0) return { ok: false, reason: blocked ? 'err.truckOnRoad' : 'err.nothingToRemove' };
    w.money += refund;
    w.roadVersion++;
    return { ok: true, cost: -refund };
  }

  buyTruck(fromId: number, toId: number): CommandResult {
    const from = this.building(fromId);
    const to = this.building(toId);
    if (!from || !to) return { ok: false, reason: 'err.badRoute' };
    const cargo = this.canRoute(from, to);
    if (!cargo) return { ok: false, reason: 'err.cargoMismatch' };
    if (this.world.money < TRUCK.price) return { ok: false, reason: 'err.noMoney', cost: TRUCK.price };

    const startTiles = [...this.accessTiles(from)];
    if (startTiles.length === 0) return { ok: false, reason: 'err.noRoadAtSource' };
    const goals = this.accessTiles(to);
    if (goals.size === 0) return { ok: false, reason: 'err.noRoadAtTarget' };
    // A building can touch several separate road pieces; start on one that actually leads to the target.
    const start = startTiles.find((s) => this.pathTo(s, to) !== null);
    if (start === undefined) return { ok: false, reason: 'err.notConnected' };

    const sx = (start % this.world.width) + 0.5;
    const sy = Math.floor(start / this.world.width) + 0.5;
    const truck: Truck = {
      id: this.world.nextId++,
      fromId,
      toId,
      cargo,
      state: 'loading',
      load: 0,
      path: [start],
      pathPos: 0,
      progress: 0,
      pathRoadVersion: this.world.roadVersion,
      waitTicks: 0,
      x: sx,
      y: sy,
      heading: 0,
      trips: 0,
      earned: 0,
      color: TRUCK_COLORS[this.world.trucks.length % TRUCK_COLORS.length],
    };
    this.world.trucks.push(truck);
    this.world.money -= TRUCK.price;
    this.message('msg.truckBought', { from: from.nameKey, to: to.nameKey }, 'info');
    return { ok: true, cost: TRUCK.price };
  }

  sellTruck(id: number): CommandResult {
    const idx = this.world.trucks.findIndex((t) => t.id === id);
    if (idx === -1) return { ok: false };
    this.world.trucks.splice(idx, 1);
    const refund = Math.round(TRUCK.price * 0.5);
    this.world.money += refund;
    return { ok: true, cost: -refund };
  }

  acceptContract(id: number): CommandResult {
    const c = this.world.contracts.find((x) => x.id === id);
    if (!c || c.status !== 'offer') return { ok: false };
    const active = this.world.contracts.filter((x) => x.status === 'active').length;
    if (active >= CONTRACT.maxActive) return { ok: false, reason: 'err.tooManyContracts' };
    c.status = 'active';
    c.deadlineDay = this.day + c.durationDays;
    return { ok: true };
  }

  // ---------- tick ----------

  step() {
    const w = this.world;
    const dayBefore = this.day;
    w.tick++;
    for (const t of w.trucks) this.updateTruck(t);
    const day = this.day;
    if (day !== dayBefore) this.onNewDay(day);
    w.rngState = this.rng.state;
  }

  private onNewDay(day: number) {
    const w = this.world;
    for (const b of w.buildings) {
      const s = b.stock;
      if (b.kind === 'farm') s.paddy = Math.min(PRODUCTION.stockCap, (s.paddy ?? 0) + PRODUCTION.farmPaddyPerDay);
      if (b.kind === 'orchard') s.fruit = Math.min(PRODUCTION.stockCap, (s.fruit ?? 0) + PRODUCTION.orchardFruitPerDay);
      if (b.kind === 'mill') {
        const n = Math.min(s.paddy ?? 0, PRODUCTION.millPaddyToRicePerDay, PRODUCTION.stockCap - (s.rice ?? 0));
        if (n > 0) {
          s.paddy = (s.paddy ?? 0) - n;
          s.rice = (s.rice ?? 0) + n;
        }
      }
    }

    w.money -= w.trucks.length * TRUCK.runCostPerDay;

    for (const c of w.contracts) {
      if (c.status === 'offer' && day >= c.offerExpiresDay) c.status = 'expired';
      if (c.status === 'active' && day > c.deadlineDay) {
        c.status = 'failed';
        w.money -= c.penalty;
        this.message('msg.contractFailed', { target: this.building(c.targetId)!.nameKey, penalty: c.penalty }, 'bad');
      }
    }
    w.contracts = w.contracts.filter((c) => c.status === 'offer' || c.status === 'active');

    if (day % DAYS_PER_MONTH === 0) {
      this.generateOffers();
      this.message('msg.newMonth', { month: Math.floor(day / DAYS_PER_MONTH) + 1 }, 'info');
    } else if (day % CONTRACT.refillEveryDays === 0) {
      this.generateOffers();
    }
  }

  private generateOffers() {
    const w = this.world;
    const options: { cargo: CargoId; target: Building }[] = [];
    for (const b of w.buildings) for (const cargo of acceptedCargo(b)) options.push({ cargo, target: b });
    let offers = w.contracts.filter((c) => c.status === 'offer').length;
    while (offers < CONTRACT.maxOffers && options.length > 0) {
      const { cargo, target } = this.rng.pick(options);
      const amount = this.rng.int(4, 10) * 10;
      const durationDays = this.rng.int(CONTRACT.minDays, CONTRACT.maxDays);
      const reward = Math.round((amount * CARGO_PRICE[cargo] * CONTRACT.rewardMultiplier) / 100) * 100;
      const contract: Contract = {
        id: w.nextId++,
        cargo,
        targetId: target.id,
        amount,
        delivered: 0,
        durationDays,
        offerExpiresDay: this.day + CONTRACT.offerLifetimeDays,
        deadlineDay: 0,
        reward,
        penalty: Math.round(reward * CONTRACT.penaltyRatio),
        status: 'offer',
      };
      w.contracts.push(contract);
      offers++;
    }
  }

  private pathTo(start: number, target: Building): number[] | null {
    const w = this.world;
    const goals = this.accessTiles(target);
    const cx = target.x + target.w / 2;
    const cy = target.y + target.h / 2;
    return findPath(w, start, goals, (i) => {
      const x = i % w.width;
      const y = (i - x) / w.width;
      return Math.max(0, Math.abs(x + 0.5 - cx) + Math.abs(y + 0.5 - cy) - (target.w + target.h) / 2);
    });
  }

  private setTruckPath(t: Truck, target: Building) {
    const here = t.path[t.pathPos];
    let path = this.pathTo(here, target);
    t.pathRoadVersion = this.world.roadVersion;
    if (!path && (t.state === 'toDropoff' || t.state === 'toPickup')) {
      // Parked at a building: it may leave through any side that has road.
      const atBuilding = this.building(t.state === 'toDropoff' ? t.fromId : t.toId)!;
      const access = this.accessTiles(atBuilding);
      if (access.has(here)) {
        for (const alt of access) {
          path = this.pathTo(alt, target);
          if (path) break;
        }
      }
    }
    if (!path) {
      t.state = 'stuck';
      t.path = [here];
      t.pathPos = 0;
      t.progress = 0;
      return;
    }
    t.path = path;
    t.pathPos = 0;
    t.progress = 0;
  }

  private updateTruck(t: Truck) {
    const w = this.world;
    const from = this.building(t.fromId)!;
    const to = this.building(t.toId)!;

    if (t.state === 'stuck') {
      // Retry occasionally; the player may have fixed the road.
      if (w.tick % 20 === 0) {
        t.state = t.load > 0 ? 'toDropoff' : 'toPickup';
        this.setTruckPath(t, t.state === 'toDropoff' ? to : from);
      }
      return;
    }

    if (t.state === 'loading') {
      t.waitTicks++;
      if (t.waitTicks % TRUCK.loadTicks === 0) {
        const have = from.stock[t.cargo] ?? 0;
        const take = Math.min(TRUCK.capacity - t.load, have);
        from.stock[t.cargo] = have - take;
        t.load += take;
        if (t.load >= TRUCK.capacity || (t.load > 0 && t.waitTicks >= TRUCK.maxWaitTicks)) {
          t.state = 'toDropoff';
          t.waitTicks = 0;
          this.setTruckPath(t, to);
        }
      }
      return;
    }

    if (t.state === 'unloading') {
      t.waitTicks++;
      if (t.waitTicks >= TRUCK.loadTicks) {
        this.deliver(t, from, to);
        t.state = 'toPickup';
        t.waitTicks = 0;
        this.setTruckPath(t, from);
      }
      return;
    }

    // Moving
    if (t.pathPos >= t.path.length - 1) {
      this.arrive(t);
      return;
    }
    t.progress += TRUCK.tilesPerTick;
    while (t.progress >= 1 && t.pathPos < t.path.length - 1) {
      t.progress -= 1;
      t.pathPos++;
      const next = t.path[t.pathPos + 1];
      const roadsChanged = t.pathRoadVersion !== w.roadVersion;
      if (roadsChanged || (next !== undefined && !w.road[next])) {
        this.setTruckPath(t, t.state === 'toDropoff' ? to : from);
        if ((t.state as string) === 'stuck') return;
      }
    }
    if (t.pathPos >= t.path.length - 1) t.progress = 0;

    const a = t.path[t.pathPos];
    const b = t.path[Math.min(t.pathPos + 1, t.path.length - 1)];
    const ax = (a % w.width) + 0.5;
    const ay = Math.floor(a / w.width) + 0.5;
    const bx = (b % w.width) + 0.5;
    const by = Math.floor(b / w.width) + 0.5;
    t.x = ax + (bx - ax) * t.progress;
    t.y = ay + (by - ay) * t.progress;
    if (a !== b) t.heading = Math.atan2(by - ay, bx - ax);

    if (t.pathPos >= t.path.length - 1) this.arrive(t);
  }

  private arrive(t: Truck) {
    t.waitTicks = 0;
    if (t.state === 'toPickup') t.state = 'loading';
    else if (t.state === 'toDropoff') t.state = 'unloading';
  }

  private deliver(t: Truck, from: Building, to: Building) {
    const w = this.world;
    const qty = t.load;
    if (qty <= 0) return;
    const dist = Math.abs(from.x - to.x) + Math.abs(from.y - to.y);
    const revenue = Math.round(qty * CARGO_PRICE[t.cargo] * (1 + dist / DISTANCE_DIVISOR));
    w.money += revenue;
    t.earned += revenue;
    t.trips++;
    t.load = 0;
    if (to.kind === 'mill') {
      to.stock[t.cargo] = Math.min(PRODUCTION.stockCap, (to.stock[t.cargo] ?? 0) + qty);
    }
    for (const c of w.contracts) {
      if (c.status !== 'active' || c.targetId !== to.id || c.cargo !== t.cargo) continue;
      c.delivered = Math.min(c.amount, c.delivered + qty);
      if (c.delivered >= c.amount) {
        c.status = 'done';
        w.money += c.reward;
        this.message('msg.contractDone', { target: to.nameKey, reward: c.reward }, 'good');
      }
    }
  }

  private message(key: string, params: Record<string, string | number>, tone: MessageTone) {
    const w = this.world;
    w.messages.push({ id: w.nextId++, day: this.day, key, params, tone });
    if (w.messages.length > MAX_MESSAGES) w.messages.shift();
  }
}
