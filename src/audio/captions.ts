// Directional sound captions (mw-e28.14): which important sounds to caption, where they are
// relative to the camera, and in what order. Pure logic, no DOM or audio context: the cue bridge
// reports each captioned cue with its source position; the tracker applies the rules below and the
// caption widget (src/ui/sound-captions.ts) shows what it keeps.
//
// - Range: a source more than 20 m from the listener is not captioned.
// - De-dupe: one caption per source and caption id per 2 s, so a creature's footsteps or a rattling
//   arrow show once, not once per step.
// - Limit: at most 4 captions at once; when more are alive the highest priority shows, newest first
//   among equals. A caption lives 2.5 s after its last trigger.
// - Direction: the bearing of the source from the camera's heading on the ground plane, in 8 sectors.
//   Bearing 0° is dead ahead and grows clockwise seen from above (90° = right, 180° = behind); each
//   sector is 45° wide and centred on its heading, so the boundaries fall at 22.5° + 45° × k:
//
//     ahead         [-22.5°,   22.5°)      behind         [157.5°, 180°] and (-180°, -157.5°)
//     ahead right   [ 22.5°,   67.5°)      behind left    [-157.5°, -112.5°)
//     right         [ 67.5°,  112.5°)      left           [-112.5°,  -67.5°)
//     behind right  [112.5°,  157.5°)      ahead left     [ -67.5°,  -22.5°)
//
//   A source 135° to the left of the front (bearing -135°) is therefore "behind left". A source
//   straight above or below the camera has no bearing and reads as ahead.

import type { ListenerPose, Vec3 } from './spatial.ts';

/** Furthest a captioned source may be from the listener, metres. */
export const CAPTION_RANGE_M = 20;
/** One caption per source and caption id within this window, ms. */
export const CAPTION_DEDUPE_MS = 2000;
/** Most captions shown at once. */
export const CAPTION_MAX_VISIBLE = 4;
/** How long a caption stays after its last trigger, ms. */
export const CAPTION_LIFETIME_MS = 2500;

/** The 8 direction sectors, clockwise from ahead; ids match `caption.direction.<id>` strings. */
export const CAPTION_SECTORS = [
  'ahead',
  'ahead-right',
  'right',
  'behind-right',
  'behind',
  'behind-left',
  'left',
  'ahead-left',
] as const;
export type CaptionSector = (typeof CAPTION_SECTORS)[number];

const SECTOR_DEG = 360 / CAPTION_SECTORS.length;

/** Where a source is relative to the listener's heading. */
export interface CaptionDirection {
  /** Degrees from the heading, -180 (exclusive) to 180, clockwise positive (right). */
  readonly bearingDeg: number;
  readonly sector: CaptionSector;
}

/** The direction of `source` from `listener`, on the ground plane (y is up). */
export function captionDirection(listener: ListenerPose, source: Vec3): CaptionDirection {
  const dx = source.x - listener.position.x;
  const dz = source.z - listener.position.z;
  const { x: fx, z: fz } = listener.forward;
  if (Math.hypot(dx, dz) < 1e-6 || Math.hypot(fx, fz) < 1e-6) {
    return { bearingDeg: 0, sector: 'ahead' };
  }
  // Right of the heading on the ground plane (y up, forward × up) is (-fz, fx).
  const ahead = dx * fx + dz * fz;
  const right = dx * -fz + dz * fx;
  let bearingDeg = (Math.atan2(right, ahead) * 180) / Math.PI;
  if (bearingDeg <= -180) bearingDeg += 360;
  const index =
    Math.floor((bearingDeg + SECTOR_DEG / 2 + 360) / SECTOR_DEG) % CAPTION_SECTORS.length;
  // index is 0–7 by construction
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  return { bearingDeg, sector: CAPTION_SECTORS[index]! };
}

/** One captioned cue as the bridge reports it. */
export interface CaptionTrigger {
  /** Localisation key of the caption text, e.g. "caption.footsteps". */
  readonly stringId: string;
  /** Stable identity of the sound's source (an entity or a fixed position). */
  readonly source: string;
  readonly position: Vec3;
  /** Ordering when more than the limit are alive (the cue rule's priority, 0–100). */
  readonly priority: number;
}

/** A caption to show, with its direction from the current listener. */
export interface VisibleCaption extends CaptionDirection {
  readonly key: string;
  readonly stringId: string;
  readonly priority: number;
}

interface Entry {
  readonly stringId: string;
  readonly priority: number;
  position: Vec3;
  readonly firstAt: number;
  lastAt: number;
}

/** Tracks live captions. One per game; time is the presentation clock, in ms. */
export class CaptionTracker {
  readonly #entries = new Map<string, Entry>();
  readonly #listener: () => ListenerPose;

  constructor(listener: () => ListenerPose) {
    this.#listener = listener;
  }

  /** Records a trigger; returns whether it started a new caption (false: out of range or a repeat). */
  trigger(trigger: CaptionTrigger, nowMs: number): boolean {
    const { position } = trigger;
    const pose = this.#listener();
    const dx = position.x - pose.position.x;
    const dy = position.y - pose.position.y;
    const dz = position.z - pose.position.z;
    if (Math.hypot(dx, dy, dz) > CAPTION_RANGE_M) return false;
    const key = `${trigger.source}|${trigger.stringId}`;
    const entry = this.#entries.get(key);
    if (entry !== undefined && nowMs - entry.firstAt < CAPTION_DEDUPE_MS) {
      // A repeat inside the window follows the source and keeps the caption alive, but adds nothing.
      entry.position = position;
      entry.lastAt = nowMs;
      return false;
    }
    this.#entries.set(key, {
      stringId: trigger.stringId,
      priority: trigger.priority,
      position,
      firstAt: nowMs,
      lastAt: nowMs,
    });
    return true;
  }

  /** The captions to show now: at most 4, highest priority first (newest first among equals). */
  visible(nowMs: number): VisibleCaption[] {
    const pose = this.#listener();
    const alive: { readonly lastAt: number; readonly caption: VisibleCaption }[] = [];
    for (const [key, entry] of this.#entries) {
      if (nowMs - entry.lastAt >= CAPTION_LIFETIME_MS) {
        this.#entries.delete(key);
        continue;
      }
      alive.push({
        lastAt: entry.lastAt,
        caption: {
          key,
          stringId: entry.stringId,
          priority: entry.priority,
          ...captionDirection(pose, entry.position),
        },
      });
    }
    alive.sort((a, b) => b.caption.priority - a.caption.priority || b.lastAt - a.lastAt);
    return alive.slice(0, CAPTION_MAX_VISIBLE).map((a) => a.caption);
  }

  /** Drops every caption (a scene change). */
  clear(): void {
    this.#entries.clear();
  }
}
