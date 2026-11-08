// Public API of the music layer (mw-0j5, mw-e28.11).
export {
  AdaptiveMusic,
  type AdaptiveMusicEngine,
  type AdaptiveMusicOptions,
  type AdaptiveMusicState,
  type StingerSource,
} from './adaptive-music.ts';
export {
  DEFAULT_TUNING,
  MUSIC_LAYERS,
  MUSIC_SETS,
  SLICE_MUSIC_CUES,
  musicSetFor,
  type LayerSpec,
  type MusicLayer,
  type MusicSet,
  type MusicTuning,
} from './music-sets.ts';
export {
  HUM_FADE_OUT_S,
  SCENE_HUMS,
  SceneHums,
  type HumEngine,
  type SceneHum,
  type SceneHumsOptions,
} from './scene-hums.ts';
export {
  BED_FADE_OUT_S,
  SCENE_BEDS,
  SceneBeds,
  type BedEngine,
  type SceneBed,
  type SceneBedsOptions,
} from './scene-beds.ts';
export {
  SALE_MIN_GAP_MS,
  SHOP_STINGERS,
  STINGER_FADE_S,
  ShopStingers,
  type ShopStingerEvent,
  type ShopStingerSet,
  type ShopStingersOptions,
  type StingerEngine,
} from './shop-stingers.ts';
export {
  AlertStingerHooks,
  STINGER_ALERT_STATES,
  type AlertStingerHooksOptions,
  type MusicStinger,
  type MusicStingerListener,
  type StingerAlertState,
} from './stinger-hooks.ts';
