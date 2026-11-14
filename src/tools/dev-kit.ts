// The demos and probes src/main.ts reaches through one dynamic import (mw-e32.18). They are for
// debug builds only: a release build (`VESPER_DEBUG_CONSOLE=off`) folds the import away, so none
// of this reaches any chunk (pnpm size:check), and a debug build fetches it as its own chunk.

export { compactProbe, playerAnimationProbe, setupAnimationDemo } from './anim-demo/setup';
export type { AnimDemo } from './anim-demo/setup';
export { ArrowDemo, parseArrowDemoLane, parseArrowDemoParam } from './arrow-demo/index';
export {
  AWARENESS_DEMO_NOISE_MS,
  awarenessDemoAgents,
  awarenessDemoNoise,
  parseAwarenessDemoParam,
} from './awareness-demo/index';
export { bindDebugCameraInput, DebugCamera } from './debug-camera/index';
export { sceneAgitator } from './perf/agitator';
export { FramePerfProbe, formatPerfReport, parsePerfParam } from './perf/frame-probe';
export { parseSpellDemoParam, spellDemoBlocks, SpellVfxDemo } from './spell-vfx-demo/index';
export { formatVfxStats, parseVfxParam, VfxDemo } from './vfx-demo/index';
