// Public API of the audio layer (mw-e28.1): Web Audio playback and mixing. Presentation only — it
// reacts to what src/game tells it and never writes sim state. fake-context.ts is test-only and is
// deliberately not exported here.

/** Layer marker, checked by the alias smoke test. */
export const layer = 'audio' as const;

export {
  AudioEngine,
  MAX_REQUEST_AGE_MS,
  makeBeep,
  type AudioEngineOptions,
  type AudioEngineStats,
  type CueStatus,
  type PlayOptions,
  type SoundHandle,
  type SoundHandleState,
} from './engine.ts';
export {
  AUDIO_BASE_URL,
  GESTURE_EVENTS,
  browserFormat,
  createBrowserAudioEngine,
  documentVisibility,
  fetchBytes,
  installGestureUnlock,
  type BrowserAudioOptions,
} from './browser.ts';
export {
  BUS_IDS,
  DEFAULT_PRIORITY,
  OPUS_MIME,
  PLAYABLE_BUS_IDS,
  SIDECAR_SAMPLE_RATE,
  SoundRegistry,
  assetCategory,
  assetUrl,
  loopSeconds,
  loopSidecarSchema,
  pickFormat,
  PLACEHOLDER_FORMAT,
  registryAssetUrl,
  soundDefSchema,
  soundManifestSchema,
  type AudioFormat,
  type BusId,
  type LoopSidecar,
  type PlayableBusId,
  type SoundDef,
  type SoundDefInput,
} from './manifest.ts';
export {
  BUS_PARENT,
  LIMITER,
  LOWPASS_OPEN_HZ,
  MIX_BUS_IDS,
  NIGHT_BYPASS,
  NIGHT_COMPRESSOR,
  applyMono,
  applyNightMode,
  applyDuckStage,
  applySnapshotStage,
  buildBusGraph,
  dbToGain,
  rampParam,
  type BusGraph,
  type MixBusId,
  type MixStage,
} from './buses.ts';
export { MixController, type MixEngine } from './mix.ts';
export {
  DUCKS,
  DUCK_ATTACK_MS,
  DUCK_NAMES,
  SNAPSHOTS,
  SNAPSHOT_NAMES,
  type BusMix,
  type Duck,
  type DuckName,
  type Snapshot,
  type SnapshotName,
} from './mix-snapshots.ts';
export {
  MIN_DB,
  MIXER_BUSES,
  MIXER_RAMP_S,
  bindMixer,
  sliderToGain,
  type MixerBinding,
  type MixerEngine,
  type MixerKey,
  type MixerSettings,
  type MixerValues,
  type MixerVolumeKey,
  type Visibility,
} from './mixer.ts';
export {
  BufferCache,
  DEFAULT_CACHE_BYTES,
  decodedBytes,
  type LoadedSound,
} from './buffer-cache.ts';
export { MAX_VOICES, pickVictim, type VoiceRank } from './voice-pool.ts';
export {
  DEFAULT_LISTENER,
  MAX_DISTANCE,
  REF_DISTANCE,
  ROLLOFF,
  applyListener,
  configurePanner,
  distance,
  inverseDistanceGain,
  listenerPose,
  rotate,
  type AudioQuality,
  type ListenerPose,
  type Quat,
  type Vec3,
} from './spatial.ts';
export { gameSoundRegistry, SOUND_MANIFEST } from './sounds.ts';
export { encodeWav, sineTone } from './wav.ts';
export type * from './web-audio.ts';
