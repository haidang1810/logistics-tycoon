import { DAYS_PER_MONTH, TICKS_PER_SECOND } from '../sim/config';
import { acceptedCargo, producedCargo, Simulation } from '../sim/simulation';
import type { Building, CargoId, CommandResult, Contract, GameMessage, TruckState } from '../sim/types';
import { Renderer } from '../render/Renderer';
import type { Models } from '../render/assets';
import { t } from '../i18n';

export type Tool = 'select' | 'road' | 'bulldoze' | 'route';
export const SPEEDS = [0, 1, 2, 4] as const;

export interface TruckSummary {
  id: number;
  fromKey: string;
  toKey: string;
  cargo: CargoId;
  state: TruckState;
  load: number;
  trips: number;
  earned: number;
  color: number;
}

export type Selection =
  | {
      type: 'building';
      id: number;
      kind: Building['kind'];
      nameKey: string;
      stock: Partial<Record<CargoId, number>>;
      produces?: CargoId;
      accepts: CargoId[];
      connected: boolean;
    }
  | { type: 'truck'; truck: TruckSummary };

export interface Snapshot {
  money: number;
  day: number;
  speed: number;
  tool: Tool;
  routeFrom: { id: number; nameKey: string; cargo: CargoId } | null;
  dragCost: number | null;
  contracts: Contract[];
  trucks: TruckSummary[];
  messages: GameMessage[];
  selection: Selection | null;
  toast: { text: string; id: number } | null;
}

/**
 * Glue between the simulation, the renderer and React UI.
 * Owns the game loop and translates mouse/keyboard input into sim commands.
 */
export class Game {
  readonly sim: Simulation;
  readonly renderer: Renderer;
  private speed = 1;
  private tool: Tool = 'select';
  private routeFromId: number | null = null;
  private selection: { type: 'building' | 'truck'; id: number } | null = null;
  private drag: { x0: number; y0: number; tiles: number[] } | null = null;
  private dragCost: number | null = null;
  private toast: Snapshot['toast'] = null;
  private accumulator = 0;
  private lastTime = performance.now();
  private lastNotify = 0;
  private raf = 0;
  private listeners = new Set<() => void>();
  private snapshot: Snapshot;
  private labels = new Map<number, HTMLDivElement>();

  constructor(
    canvasHost: HTMLElement,
    private labelHost: HTMLElement,
    seed: number,
    models: Models,
  ) {
    this.sim = new Simulation(seed);
    this.sim.world.messages.push({ id: 0, day: 0, key: 'msg.welcome', params: {}, tone: 'info' });
    this.renderer = new Renderer(canvasHost, this.sim.world, models);
    this.renderer.resize();
    this.createLabels();
    this.snapshot = this.buildSnapshot();

    const el = this.renderer.renderer.domElement;
    el.addEventListener('pointerdown', this.onPointerDown);
    el.addEventListener('pointermove', this.onPointerMove);
    el.addEventListener('pointerleave', this.onPointerLeave);
    window.addEventListener('pointerup', this.onPointerUp);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('resize', this.onResize);
    el.addEventListener('contextmenu', (e) => e.preventDefault());

    this.raf = requestAnimationFrame(this.frame);
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    window.removeEventListener('pointerup', this.onPointerUp);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('resize', this.onResize);
    this.labels.forEach((l) => l.remove());
    this.renderer.dispose();
  }

  // ---------- store for React ----------

  subscribe = (cb: () => void) => {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  };

  getSnapshot = () => this.snapshot;

  private notify() {
    this.snapshot = this.buildSnapshot();
    this.listeners.forEach((l) => l());
  }

  private buildSnapshot(): Snapshot {
    const w = this.sim.world;
    const trucks: TruckSummary[] = w.trucks.map((tr) => {
      const from = this.sim.building(tr.fromId)!;
      const to = this.sim.building(tr.toId)!;
      return {
        id: tr.id,
        fromKey: from.nameKey,
        toKey: to.nameKey,
        cargo: tr.cargo,
        state: tr.state,
        load: tr.load,
        trips: tr.trips,
        earned: tr.earned,
        color: tr.color,
      };
    });
    let selection: Selection | null = null;
    if (this.selection?.type === 'building') {
      const b = this.sim.building(this.selection.id);
      if (b) {
        selection = {
          type: 'building',
          id: b.id,
          kind: b.kind,
          nameKey: b.nameKey,
          stock: { ...b.stock },
          produces: producedCargo(b),
          accepts: acceptedCargo(b),
          connected: this.sim.accessTiles(b).size > 0,
        };
      }
    } else if (this.selection?.type === 'truck') {
      const tr = trucks.find((x) => x.id === this.selection!.id);
      if (tr) selection = { type: 'truck', truck: tr };
    }
    const from = this.routeFromId !== null ? this.sim.building(this.routeFromId) : undefined;
    return {
      money: w.money,
      day: this.sim.day,
      speed: this.speed,
      tool: this.tool,
      routeFrom: from ? { id: from.id, nameKey: from.nameKey, cargo: producedCargo(from)! } : null,
      dragCost: this.dragCost,
      contracts: w.contracts.map((c) => ({ ...c })),
      trucks,
      messages: [...w.messages],
      selection,
      toast: this.toast,
    };
  }

  // ---------- UI actions ----------

  setSpeed(speed: number) {
    this.speed = speed;
    this.notify();
  }

  setTool(tool: Tool) {
    this.tool = tool;
    this.routeFromId = null;
    this.drag = null;
    this.dragCost = null;
    this.renderer.setGhost([], true);
    this.notify();
  }

  acceptContract(id: number) {
    this.report(this.sim.acceptContract(id));
  }

  sellTruck(id: number) {
    this.report(this.sim.sellTruck(id));
    if (this.selection?.type === 'truck' && this.selection.id === id) this.selection = null;
    this.notify();
  }

  selectTruck(id: number) {
    this.selection = { type: 'truck', id };
    this.notify();
  }

  clearSelection() {
    this.selection = null;
    this.notify();
  }

  private report(res: CommandResult) {
    if (!res.ok && res.reason) {
      this.toast = { text: t(res.reason, res.cost !== undefined ? { cost: res.cost } : undefined), id: Date.now() };
    }
    this.notify();
  }

  /** Dev helper: renders a frame and saves the canvas to .shots/<name>.jpg via the Vite dev server. */
  async debugShot(name = 'shot') {
    for (let i = 0; i < 20; i++) this.renderer.render();
    const data = this.renderer.renderer.domElement.toDataURL('image/jpeg', 0.85);
    const res = await fetch('/__shot', { method: 'POST', body: JSON.stringify({ name, data }) });
    return res.text();
  }

  // ---------- loop ----------

  private frame = (now: number) => {
    const dt = Math.min(0.25, (now - this.lastTime) / 1000);
    this.lastTime = now;
    this.accumulator += dt * this.speed * TICKS_PER_SECOND;
    let steps = 0;
    while (this.accumulator >= 1 && steps < 200) {
      this.sim.step();
      this.accumulator -= 1;
      steps++;
    }
    this.renderer.render();
    this.updateLabels();
    this.updateSelectionRing();
    if (now - this.lastNotify > 200) {
      this.lastNotify = now;
      this.notify();
    }
    this.raf = requestAnimationFrame(this.frame);
  };

  // ---------- labels ----------

  private createLabels() {
    for (const b of this.sim.world.buildings) {
      if (b.kind === 'house') continue;
      const el = document.createElement('div');
      el.className = `map-label map-label--${b.kind}`;
      this.labelHost.appendChild(el);
      this.labels.set(b.id, el);
    }
  }

  private updateLabels() {
    for (const [id, el] of this.labels) {
      const b = this.sim.building(id)!;
      const p = this.renderer.project(b.x + b.w / 2, b.y + b.h / 2, 1.9);
      if (!p.visible) {
        el.style.display = 'none';
        continue;
      }
      el.style.display = '';
      el.style.transform = `translate(${p.x}px, ${p.y}px) translate(-50%, -100%)`;
      const stock = Object.entries(b.stock)
        .filter(([, v]) => v && v > 0)
        .map(([c, v]) => `${t(`cargo.${c}`)} ${Math.floor(v!)}`)
        .join(' · ');
      const html = `<b>${t(b.nameKey)}</b>${stock ? `<span>${stock}</span>` : ''}`;
      if (el.dataset.html !== html) {
        el.innerHTML = html;
        el.dataset.html = html;
      }
      el.classList.toggle('is-route-from', this.routeFromId === id);
    }
  }

  private updateSelectionRing() {
    if (!this.selection) {
      this.renderer.setSelection(null);
      return;
    }
    if (this.selection.type === 'building') {
      const b = this.sim.building(this.selection.id);
      this.renderer.setSelection(b ? { x: b.x + b.w / 2, y: b.y + b.h / 2, r: Math.max(b.w, b.h) * 0.8 } : null);
    } else {
      const tr = this.sim.world.trucks.find((x) => x.id === this.selection!.id);
      this.renderer.setSelection(tr ? { x: tr.x, y: tr.y, r: 0.5 } : null);
    }
  }

  // ---------- input ----------

  private lineTiles(x0: number, y0: number, x1: number, y1: number): number[] {
    const tiles: number[] = [];
    const horizontalFirst = Math.abs(x1 - x0) >= Math.abs(y1 - y0);
    const sx = Math.sign(x1 - x0);
    const sy = Math.sign(y1 - y0);
    let x = x0;
    let y = y0;
    tiles.push(this.sim.tileIndex(x, y));
    if (horizontalFirst) {
      while (x !== x1) tiles.push(this.sim.tileIndex((x += sx), y));
      while (y !== y1) tiles.push(this.sim.tileIndex(x, (y += sy)));
    } else {
      while (y !== y1) tiles.push(this.sim.tileIndex(x, (y += sy)));
      while (x !== x1) tiles.push(this.sim.tileIndex((x += sx), y));
    }
    return tiles;
  }

  private updateDrag(x: number, y: number) {
    if (!this.drag) return;
    const tiles = this.lineTiles(this.drag.x0, this.drag.y0, x, y);
    const w = this.sim.world;
    if (this.tool === 'road') {
      const buildable = tiles.filter((i) => this.sim.roadTileCost(i) !== null);
      const cost = buildable.reduce((s, i) => s + this.sim.roadTileCost(i)!, 0);
      this.drag.tiles = buildable;
      this.dragCost = cost;
      this.renderer.setGhost(buildable, cost <= w.money);
    } else {
      const roads = tiles.filter((i) => w.road[i]);
      this.drag.tiles = roads;
      this.dragCost = null;
      this.renderer.setGhost(roads, false);
    }
  }

  private onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    const tile = this.renderer.pickTile(e.clientX, e.clientY);
    switch (this.tool) {
      case 'road':
      case 'bulldoze':
        if (!tile) return;
        this.drag = { x0: tile.x, y0: tile.y, tiles: [] };
        this.updateDrag(tile.x, tile.y);
        this.notify();
        return;
      case 'select': {
        const truckId = this.renderer.pickTruck(e.clientX, e.clientY);
        if (truckId !== null) this.selection = { type: 'truck', id: truckId };
        else {
          const b = tile ? this.sim.buildingAt(tile.x, tile.y) : undefined;
          this.selection = b && b.kind !== 'house' ? { type: 'building', id: b.id } : null;
        }
        this.notify();
        return;
      }
      case 'route': {
        const b = tile ? this.sim.buildingAt(tile.x, tile.y) : undefined;
        if (!b || b.kind === 'house') return;
        if (this.routeFromId === null) {
          if (!producedCargo(b)) {
            this.report({ ok: false, reason: 'err.notSource' });
            return;
          }
          this.routeFromId = b.id;
          this.notify();
          return;
        }
        if (b.id === this.routeFromId) {
          this.routeFromId = null;
          this.notify();
          return;
        }
        const res = this.sim.buyTruck(this.routeFromId, b.id);
        if (res.ok) {
          const truck = this.sim.world.trucks[this.sim.world.trucks.length - 1];
          this.routeFromId = null;
          this.tool = 'select';
          this.selection = { type: 'truck', id: truck.id };
        }
        this.report(res);
        return;
      }
    }
  };

  private onPointerMove = (e: PointerEvent) => {
    const tile = this.renderer.pickTile(e.clientX, e.clientY);
    this.renderer.setHover(this.tool === 'select' ? null : tile);
    if (this.drag && tile) {
      this.updateDrag(tile.x, tile.y);
    }
  };

  private onPointerLeave = () => this.renderer.setHover(null);

  private onPointerUp = (e: PointerEvent) => {
    if (e.button !== 0 || !this.drag) return;
    const tiles = this.drag.tiles;
    this.drag = null;
    this.dragCost = null;
    this.renderer.setGhost([], true);
    if (tiles.length === 0) {
      this.notify();
      return;
    }
    this.report(this.tool === 'road' ? this.sim.buildRoad(tiles) : this.sim.bulldoze(tiles));
  };

  private onKeyDown = (e: KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement) return;
    if (e.key === 'Escape') {
      if (this.drag) {
        this.drag = null;
        this.dragCost = null;
        this.renderer.setGhost([], true);
        this.notify();
      } else this.setTool('select');
    }
    if (e.key === '1') this.setTool('select');
    if (e.key === '2') this.setTool('road');
    if (e.key === '3') this.setTool('bulldoze');
    if (e.key === '4') this.setTool('route');
    if (e.key === ' ') {
      e.preventDefault();
      this.setSpeed(this.speed === 0 ? 1 : 0);
    }
  };

  private onResize = () => this.renderer.resize();
}

export function dayToDate(day: number) {
  const month = Math.floor(day / DAYS_PER_MONTH);
  return { day: (day % DAYS_PER_MONTH) + 1, month: (month % 12) + 1, year: Math.floor(month / 12) + 1 };
}

