// Public API of the slice music layer (mw-0j5).
export {
  COMBAT_EXIT_DELAY_MS,
  COMBAT_FADE_IN_S,
  COMBAT_FADE_OUT_S,
  EXPLORE_DUCK_S,
  EXPLORE_RESTORE_S,
  SLICE_MUSIC_CUES,
  SliceMusic,
  type MusicEngine,
  type SliceMusicOptions,
  type SliceMusicState,
} from './slice-music.ts';
export {
  VOLUME_BUSES,
  VOLUME_RAMP_S,
  bindVolumes,
  type VolumeBinding,
  type VolumeEngine,
  type VolumeKey,
  type VolumeSettings,
} from './volumes.ts';
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
