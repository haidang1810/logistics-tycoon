/** A* over road tiles (4-neighbour grid). Returns tile indices from start to a goal, or null. */

class MinHeap {
  private items: number[] = [];
  private prio: number[] = [];

  get size() {
    return this.items.length;
  }

  push(item: number, p: number) {
    const items = this.items;
    const prio = this.prio;
    let i = items.length;
    items.push(item);
    prio.push(p);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (prio[parent] <= p) break;
      items[i] = items[parent];
      prio[i] = prio[parent];
      i = parent;
    }
    items[i] = item;
    prio[i] = p;
  }

  pop(): number {
    const items = this.items;
    const prio = this.prio;
    const top = items[0];
    const lastItem = items.pop()!;
    const lastP = prio.pop()!;
    const n = items.length;
    if (n > 0) {
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        let mp = lastP;
        if (l < n && prio[l] < mp) {
          m = l;
          mp = prio[l];
        }
        if (r < n && prio[r] < mp) {
          m = r;
          mp = prio[r];
        }
        if (m === i) break;
        items[i] = items[m];
        prio[i] = prio[m];
        i = m;
      }
      items[i] = lastItem;
      prio[i] = lastP;
    }
    return top;
  }
}

export interface PathGrid {
  width: number;
  height: number;
  road: Uint8Array;
}

export function findPath(
  grid: PathGrid,
  start: number,
  goals: ReadonlySet<number>,
  heuristic: (tile: number) => number,
): number[] | null {
  if (!grid.road[start] || goals.size === 0) return null;
  if (goals.has(start)) return [start];

  const { width, height, road } = grid;
  const size = width * height;
  const g = new Float64Array(size).fill(Infinity);
  const cameFrom = new Int32Array(size).fill(-1);
  const closed = new Uint8Array(size);
  const open = new MinHeap();

  g[start] = 0;
  open.push(start, heuristic(start));

  while (open.size > 0) {
    const cur = open.pop();
    if (closed[cur]) continue;
    if (goals.has(cur)) {
      const path = [cur];
      let t = cur;
      while (cameFrom[t] !== -1) {
        t = cameFrom[t];
        path.push(t);
      }
      return path.reverse();
    }
    closed[cur] = 1;

    const cx = cur % width;
    const cy = (cur - cx) / width;
    const base = g[cur] + 1;
    for (let d = 0; d < 4; d++) {
      const nx = d === 0 ? cx + 1 : d === 1 ? cx - 1 : cx;
      const ny = d === 2 ? cy + 1 : d === 3 ? cy - 1 : cy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const n = ny * width + nx;
      if (!road[n] || closed[n]) continue;
      if (base < g[n]) {
        g[n] = base;
        cameFrom[n] = cur;
        open.push(n, base + heuristic(n));
      }
    }
  }
  return null;
}
