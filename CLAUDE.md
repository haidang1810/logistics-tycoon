# Logistics Tycoon Roguelite

Top-down low-poly logistics tycoon + roguelite set in Vietnam (cozy tone). Claude writes all the code; the user is designer/playtester.

- Design: `docs/GDD.md` (source of truth for gameplay). Architecture: `docs/ARCHITECTURE.md`. Status, roadmap, asset inventory: `docs/PROGRESS.md` (keep it updated after each milestone).
- Stack: TypeScript, Vite, React 19, Three.js, Vitest.

## Commands

Node is installed via nvm-windows at `C:\nvm4w\nodejs`; if `node` is not on PATH in a shell, prepend it (`$env:Path="C:\nvm4w\nodejs;$env:Path"` or `export PATH="/c/nvm4w/nodejs:$PATH"`).

- `npm run dev` — dev server on http://localhost:5173 (preview config: `.claude/launch.json`, name `game`)
- `npm test` — simulation tests
- `npx tsc -p tsconfig.json --noEmit` — type-check

## Rules

- `src/sim` stays pure and deterministic: no DOM/Three/React imports, no `Math.random()`/`Date`; use `Rng`.
- Balance numbers only in `src/sim/config.ts`. Money unit = thousands of VND.
- All player-facing text goes through `t()` with keys in both `src/i18n/vi.ts` and `src/i18n/en.ts`.
- Sim commands return i18n keys as failure reasons, never display text.
- When the Browser pane is hidden, `requestAnimationFrame` does not run: drive the sim with `game.sim.step()` and call `game.renderer.render()` before screenshots.
- Screenshots when the app window is hidden/minimized: in the page run `await game.debugShot('name')` → saved to `.shots/name.jpg` (dev server only), then Read the file.

## Assets

- `public/models/{kaykit,forest,medieval,resources}/` — KayKit packs by Kay Lousberg, all CC0 (license file in each folder): City Builder Bits, Forest Nature Pack, Medieval Hexagon Pack, Resource Bits. Only the models we use are copied; the full zips sit untracked in the repo root. Credit "Kay Lousberg, www.kaylousberg.com" in the game credits (optional but kind).
- Model keys → files: `MODEL_FILES` in `src/render/assets.ts`. Nature props are sized by their bounding box (`modelWidth`), since native sizes vary a lot.
- `debug-models.html?m=forest/Tree_1_A_Color1,medieval/building_grain&s=1` (dev only) renders models with +X/+Z markers and saves `.shots/models.jpg`.
- KayKit tile = 2 units → scaled 0.5 (`KAYKIT_SCALE`). Road pieces: straight runs N–S, corner joins E+S, T-split joins N+S+E; building fronts and car noses face +Z. Auto-tiling lives in `ROAD_TABLE` in `src/render/Renderer.ts`.
