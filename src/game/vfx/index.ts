// Public API of the VFX layer (mw-e29.1): data-driven effects with pooling and a particle budget.
// Renderer-agnostic; src/render/vfx draws the batches. Event → effect mapping is e29.3's cue sheets.

export {
  lodScale,
  ParticleBudget,
  VFX_LOD_TIERS,
  VFX_PARTICLE_CAPS,
  type BudgetEntry,
  type VfxLodTier,
} from './budget.ts';
export {
  bakeColour,
  bakeScalar,
  CURVE_SAMPLES,
  parseHexColour,
  sampleIndex,
  type ColourCurve,
  type ScalarCurve,
} from './curves.ts';
export {
  compileEffect,
  effectCost,
  emitterCapacity,
  type CompiledEffect,
  type CompiledEmitter,
  type VfxBatchKey,
  type VfxEffectEntry,
} from './effects.ts';
export { at, known } from './indexing.ts';
export { Pool } from './pool.ts';
export {
  DEFAULT_VFX_SEED,
  flipbookFrame,
  VFX_INSTANCE_FLOATS,
  VFX_MARKER_SECONDS,
  VFX_MAX_MARKERS,
  VFX_MAX_STEP,
  VfxSystem,
  type VfxAnchor,
  type VfxAnchorResolver,
  type VfxBatch,
  type VfxHandle,
  type VfxMarkers,
  type VfxSpawnOptions,
  type VfxStats,
  type VfxSystemOptions,
} from './system.ts';
export { vfxTextureManifest } from './texture-data.ts';
export {
  textureProblems,
  VFX_TEXTURE_BASE_URL,
  vfxTextureManifestSchema,
  vfxTextureUrls,
  type VfxTextureEntry,
} from './textures.ts';
export * from './screen-feedback.ts';
