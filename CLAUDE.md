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
