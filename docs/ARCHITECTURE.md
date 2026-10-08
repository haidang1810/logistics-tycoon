# Architecture

## Layers

```
src/
  sim/      Pure TypeScript simulation. No DOM, no Three.js, no React.
  render/   Three.js renderer. Reads WorldState, never mutates it.
  game/     Glue: game loop, input → sim commands, snapshot store for React, map labels.
  ui/       React HUD (panels, toolbar, info cards). Talks to Game only.
  i18n/     vi/en dictionaries + t() helper.
```

Dependency direction: `ui → game → (sim, render)`, `render → sim/types`. `sim` imports nothing from the other layers.

## Simulation (`src/sim`)

- `WorldState` (in `types.ts`) is plain data: typed arrays for the grid, arrays of plain objects for entities. It is serializable as-is, which keeps save/load and moving the sim into a Web Worker simple.
- `Simulation` owns a `WorldState` and exposes **commands** (`buildRoad`, `bulldoze`, `buyTruck`, `sellTruck`, `acceptContract`) and `step()`.
- Commands return `CommandResult { ok, reason?, cost? }`. `reason` is an i18n key, so the sim never produces display text.
- **Fixed tick**: `TICKS_PER_SECOND = 20` at 1x speed, `TICKS_PER_DAY = 40`. The loop in `Game` runs as many `step()`s as the speed requires.
- **Deterministic**: all randomness goes through `Rng` (seeded mulberry32) whose state lives in `world.rngState`. No `Math.random()`, no `Date` in sim code.
- All balance numbers are in `config.ts`.
- Pathfinding: A* over road tiles (`pathfinding.ts`). Trucks re-path when `world.roadVersion` changes.

## Rendering (`src/render`)

- One `Renderer` builds the scene from primitives (low-poly boxes/cones with `flatShading`), no external models yet.
- Large repeated things use `InstancedMesh` (terrain tiles, roads, trees). Roads/trees rebuild when `roadVersion` changes.
- Trucks are small `Group`s, smoothed towards the sim position each frame so 20 Hz ticks look fluid at 60 fps.
- Camera: `MapControls`. Left mouse is reserved for game tools; right = pan, middle = rotate, wheel = zoom, WASD = pan.

## UI (`src/ui`)

- `Game` exposes `subscribe` / `getSnapshot` for `useSyncExternalStore`. Snapshots are rebuilt at most every 200 ms or after a command, so React never re-renders at frame rate.
- Map labels above buildings are plain DOM elements positioned by `Game` each frame (not React).

## Testing and debugging

- `npm test` runs Vitest on `src/sim/*.test.ts`. The sim runs headless, so balance can be checked by simulating months in milliseconds.
- In the browser, `window.game` is the live `Game` (e.g. `game.sim.world.money = 1e9`).
- `?seed=123` in the URL picks a map seed.

## Planned

- Move `Simulation` into a Web Worker once it gets heavy (commands in, snapshots out).
- Save/load = serialize `WorldState`.
- Electron wrapper for Steam.
