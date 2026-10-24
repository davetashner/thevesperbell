# Coverage exclusions

The **only** place a file may be excluded from unit coverage (backlog contract §3). `vite.config.ts` reads
the Exclusions table below, and `pnpm coverage:exclusions` (run by CI in the `coverage-gate` job) fails
when:

- Vitest excludes anything that isn't listed here;
- a row lacks a reason, a `mw-` bead id or an alternative verification;
- a row touches a 100% layer (`src/sim`, `src/content`, `src/game/save`, `scripts`);
- a glue-layer file (`src/game`, `src/ui`, `src/audio`, `src/tools`) is below 100% lines or branches
  without a row in Glue-layer gaps;
- a `v8`, `istanbul` or `c8` ignore comment appears in a file that isn't excluded here.

**To request an exclusion:** add a row in the same PR as the code, name the bead that justifies it, and
say how the code is verified instead (Playwright smoke, perf budget, manual test plan). The reviewer
approves the row, not just the code.

## Exclusions

| Path glob | Reason | Bead | Alternative verification |
|---|---|---|---|
| `src/main.ts` | Browser bootstrap: wires the layers into the page; no logic of its own. | mw-e00.1 | Playwright smoke `e2e/smoke.spec.ts` (page loads, zero console errors). |
| `src/render/**` | Renderer-specific code (Three.js bootstrap, scene graph, materials, shaders, VFX) needs a GPU context. Pure helpers here (e.g. `bootstrap/sizing.ts`) are still unit tested. | mw-e00.19 | Playwright boot smoke `e2e/render-boot.spec.ts` (first frame ≤ 3 s, non-blank pixel sample + screenshot artifact, DPR-capped resize, dispose/recreate context count) and perf budgets (`mw-e32.1`). VFX drawing (`src/render/vfx`, mw-e29.1): `e2e/vfx.spec.ts` (20 effects render, no console errors, screenshot sanity) and opt-in `e2e/vfx-perf.spec.ts`. AI debug overlay drawing (`src/render/debug/ai-overlay.ts`, mw-e11.17): `e2e/ai-debug.spec.ts` (3 guards, cones and labels, no console errors) and the frame-time budget `tests/bench/ai-debug-overlay.bench.ts`. Spell visuals (`src/render/magic`, mw-e06.15): `e2e/spell-cast.spec.ts` (an Ember bolt and the reticle drawn, no console errors). |
| `src/testbed/**` | Browser testbed page bootstraps (DOM buttons, rAF loop, real `AudioContext`, real WebGL renderer); the logic they call is unit tested in `src/audio` or verified in `src/render` e2e. | mw-e28.1 | Playwright `e2e/audio.spec.ts` in Chromium, Firefox and WebKit (context running, cue plays, zero console errors); `e2e/render-boot.spec.ts` AC-4 drives `testbed/render.html` (mw-e00.19). |

## Glue-layer gaps

Files in the ≥ 90% layers that are below 100% lines or branches, with the reason the gap is acceptable.

| File | Reason | Bead |
|---|---|---|
