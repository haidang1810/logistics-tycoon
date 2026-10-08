# Logistics Tycoon Roguelite

Top-down low-poly logistics tycoon + roguelite set in Vietnam (cozy tone). Claude writes all the code; the user is designer/playtester.

- Design: `docs/GDD.md` (source of truth for gameplay). Architecture: `docs/ARCHITECTURE.md`.
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
- `debug-models.html` (dev only) shows KayKit road pieces from above to check model orientation.

## Assets

- `public/models/kaykit/` — KayKit City Builder Bits 1.0 by Kay Lousberg, CC0 (license file alongside). Credit "Kay Lousberg, www.kaylousberg.com" in the game credits (optional but kind).
- KayKit tile = 2 units → scaled 0.5 (`KAYKIT_SCALE`). Road pieces: straight runs N–S, corner joins E+S, T-split joins N+S+E; building fronts and car noses face +Z. Auto-tiling lives in `ROAD_TABLE` in `src/render/Renderer.ts`.
