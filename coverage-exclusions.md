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
| `src/render/**` | Renderer-specific code (Three.js bootstrap, scene graph, materials, shaders, VFX) needs a GPU context. Pure helpers here (e.g. `bootstrap/sizing.ts`) are still unit tested. | mw-e00.19 | Playwright boot smoke `e2e/render-boot.spec.ts` (first frame ≤ 3 s, non-blank pixel sample + screenshot artifact, DPR-capped resize, dispose/recreate context count) and perf budgets (`mw-e32.1`). VFX drawing (`src/render/vfx`, mw-e29.1): `e2e/vfx.spec.ts` (20 effects render, no console errors, screenshot sanity) and opt-in `e2e/vfx-perf.spec.ts`. AI debug overlay drawing (`src/render/debug/ai-overlay.ts`, mw-e11.17): `e2e/ai-debug.spec.ts` (3 guards, cones and labels, no console errors) and the frame-time budget `tests/bench/ai-debug-overlay.bench.ts`. Trail and charge-glow drawing (`src/render/vfx/trails.ts`, mw-e29.6): the ribbon geometry it uploads (`trail-ribbon.ts`) and the controller that feeds it are unit and integration tested (`tests/integration/swing-trails.test.ts`); the smoke `e2e/smoke.spec.ts` boots it with no console errors. Element state looks (`src/render/element-look.ts`, mw-e03.28): the look maths and the bridge that feeds it are unit tested (`src/game/vfx/element-look.ts`, `element-feedback.ts`); the drawing is checked by `e2e/element-states.spec.ts` (four states side by side, no console errors, screenshot). Spell visuals (`src/render/magic`, mw-e06.15): `e2e/spell-cast.spec.ts` (an Ember bolt and the reticle drawn, no console errors). Magical materials (`src/render/magic-materials`, mw-e29.7): the rules are unit tested (`rules.ts`, `demo-layout.ts`, `src/game/vfx/magic-materials.ts`, `corpse-glue.ts`), and the library runs against real Three.js objects and a stand-in renderer in `tests/integration/magic-materials.test.ts` (shared materials never dissolve together, Low skips distortion and runs no pass, one frame copy for six hazes, depth only while a soft particle exists, the sim's death path removes the render entity after 1.2 s); the shaders compile and draw in `e2e/magic-materials.spec.ts` (Chromium, Firefox and WebKit projects: no console errors, screenshot sanity) and `e2e/creature-dissolve.spec.ts` (a killed skeleton dissolves and is removed); the frame-time budget is the opt-in `e2e/magic-perf.spec.ts`. Arrow effects drawing (`src/render/combat/arrow.ts`, `arrow-fx.ts`, mw-e29.11): the rules it draws (decal, ring, rope, wobble, broken shaft) are unit tested in `src/game/vfx/arrow-fx.test.ts` and driven through the real arrow system in `tests/integration/arrow-vfx.test.ts`; the drawing runs in `e2e/arrow-vfx.spec.ts` (`?arrows=<id>` looses each arrow at the back wall: decal at 1.5 m, ring, rope ribbon, wobble, broken shaft, no console errors). Awareness indicator drawing (`src/render/stealth/awareness.ts`, mw-e29.12): the shapes, fill clipping and colour-blind rules are unit tested in `src/render/stealth/indicator-shapes.test.ts`, the rules it draws (state to shape and fill, range, pop-in, 2 Hz pulse ceiling, ghost, ripple and their settings) in `src/game/vfx/awareness-fx.test.ts`, and the renderer builds its real Three.js objects headless over real guards in `tests/integration/awareness-indicators.test.ts`; the drawing runs in `e2e/awareness.spec.ts` (`?awareness=demo` lines up one stand-in per state, no console errors, screenshots). |
| `src/testbed/**` | Browser testbed page bootstraps (DOM buttons, rAF loop, real `AudioContext`, real WebGL renderer); the logic they call is unit tested in `src/audio` or verified in `src/render` e2e. | mw-e28.1 | Playwright `e2e/audio.spec.ts` in Chromium, Firefox and WebKit (context running, cue plays, zero console errors); `e2e/render-boot.spec.ts` AC-4 drives `testbed/render.html` (mw-e00.19). |

## Glue-layer gaps

Files in the ≥ 90% layers that are below 100% lines or branches, with the reason the gap is acceptable.

| File | Reason | Bead |
|---|---|---|
