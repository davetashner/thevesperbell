// The player's camera options as live look settings (mw-e31.6): the look sensitivity (mouse and right
// stick), the two invert toggles and auto-centre. They are input scaling, not sim state: the input log
// records raw mouse counts and stick deflection, and the sim multiplies them by the settings it reads
// each tick. So a replay (`locked`) uses the camera content's own values, which keeps recorded runs
// identical whatever the player has chosen; at the defaults (sensitivity ×1, nothing inverted,
// auto-centre off) the result equals the content's, bit for bit.

import type { LookSettings } from '../../sim/player';
import type { SettingKey, SettingValue } from '../settings';
import type { CameraTuning } from '../../content/types/camera';
import { toRadians } from './orbit-camera';

/** Seconds of moving without look input before auto-centre starts easing. */
export const RECENTRE_DELAY = 1.5;

/** Degrees per second auto-centre eases the pitch back at. */
export const RECENTRE_RATE = 30;

/** What the look options read: the settings store. */
export interface LookOptionSource {
  get<K extends SettingKey>(key: K): SettingValue<K>;
}

/**
 * The look options now, for `base` (the content's look settings). `locked` returns `base` untouched
 * (a replay). Auto-centre eases toward the camera's resting pitch.
 */
export function liveLook(
  base: LookSettings,
  tuning: Pick<CameraTuning, 'pitch'>,
  source: LookOptionSource,
  locked: () => boolean,
): () => LookSettings {
  return () => {
    if (locked()) return base;
    const scale = source.get('camera.sensitivity');
    return {
      ...base,
      sensitivity: base.sensitivity * scale,
      invertX: source.get('camera.invertX'),
      invertY: base.invertY !== source.get('camera.invertY'),
      stick: {
        ...base.stick,
        yawRate: base.stick.yawRate * scale,
        pitchRate: base.stick.pitchRate * scale,
      },
      ...(source.get('camera.autoCentre') && {
        recentre: {
          pitch: toRadians(tuning.pitch.initial),
          delay: RECENTRE_DELAY,
          rate: toRadians(RECENTRE_RATE),
        },
      }),
    };
  };
}
