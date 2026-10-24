// The combat HUD's game glue (mw-e04.10): what the player's health and stamina bars show, and which
// sim events make them react. The UI widget (src/ui/combat-hud.ts) holds no rules and reads no sim
// state; this file reads the sim once per drawn frame and turns its events into HUD feedback:
//
// - ActionRejected{reason:"stamina"} on the player → the stamina bar flashes.
// - DamageApplied on the player → an arc towards where the hit came from, when that is off screen.
//   "Where it came from" is the instigator's position at the hit (the swinging dummy, the archer),
//   else the delivering entity's, else the reverse of the packet's travel direction. The bearing is
//   taken against the camera's forward on the frame the HUD shows it, so it reads relative to the
//   view the player has, and only hits outside the horizontal field of view get an arc.
//
// Events are queued as the sim emits them and handed to the widget on the next drawn frame, with
// that frame's time, so the bars and the feedback always describe the same sim state.

import {
  ActionRejected,
  DamageApplied,
  healthOf,
  ManaComponent,
  manaOf,
  PlacementComponent,
  staminaOf,
  type DamageResult,
  type EntityId,
  type World,
} from '@sim/index';
import type { CombatHud, CombatHudModel } from '@ui/index';

/** A point or direction on the ground plane (x right, z towards the default camera; y ignored). */
export interface GroundVec {
  readonly x: number;
  readonly z: number;
}

/** What the HUD needs of the drawn camera each frame. */
export interface HudView {
  /** The camera's forward direction (need not be unit length; y is ignored). */
  readonly forward: GroundVec;
  /** Half the horizontal field of view, radians. */
  readonly halfFov: number;
}

const DEG = 180 / Math.PI;
const EPSILON = 1e-6;

/**
 * Degrees clockwise (seen from above) from `forward` to `toward`, in [0, 360): 0 ahead, 90 to the
 * right, 180 behind. Undefined when either vector has no ground-plane length.
 */
export function damageBearing(forward: GroundVec, toward: GroundVec): number | undefined {
  if (Math.hypot(forward.x, forward.z) < EPSILON || Math.hypot(toward.x, toward.z) < EPSILON) {
    return undefined;
  }
  // y up: the right of forward (fx, fz) is (−fz, fx).
  const ahead = toward.x * forward.x + toward.z * forward.z;
  const right = toward.x * -forward.z + toward.z * forward.x;
  const deg = Math.atan2(right, ahead) * DEG;
  return deg < 0 ? deg + 360 : deg;
}

/** Whether a bearing lies outside a view of half-angle `halfFov` radians (i.e. off screen). */
export function offScreen(bearing: number, halfFov: number): boolean {
  const fromAhead = bearing > 180 ? 360 - bearing : bearing;
  return fromAhead > halfFov * DEG;
}

/** The ground-plane forward of a camera with rotation `q` (a camera looks along its local −z). */
export function cameraForward(q: {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly w: number;
}): GroundVec {
  return { x: -2 * (q.x * q.z + q.w * q.y), z: -(1 - 2 * (q.x * q.x + q.y * q.y)) };
}

/** Half the horizontal field of view of a perspective camera (vertical fov in degrees). */
export function horizontalHalfFov(verticalFovDeg: number, aspect: number): number {
  return Math.atan(Math.tan(verticalFovDeg / DEG / 2) * aspect);
}

/** The bars' model for `player`, or null while it is not a combatant. */
export function combatHudModel(world: World<never>, player: EntityId): CombatHudModel | null {
  const health = healthOf(world, player);
  if (health === undefined) return null;
  const stamina = staminaOf(world, player);
  const mana = world.isRegistered(ManaComponent) ? manaOf(world, player) : undefined;
  return {
    health: { value: health.current, max: health.max },
    stamina: stamina === undefined ? EMPTY : { value: stamina.current, max: stamina.profile.max },
    ...(mana !== undefined && { mana: { value: mana.current, max: mana.profile.max } }),
  };
}

const EMPTY = Object.freeze({ value: 0, max: 0 });

/** Where a hit came from, relative to its target, on the ground plane (undefined: unknown). */
export function hitOrigin(world: World<never>, hit: DamageResult): GroundVec | undefined {
  const at = world.get(hit.target, PlacementComponent);
  const { packet } = hit;
  if (at !== undefined) {
    for (const from of [packet.instigator, packet.source]) {
      const where = from === null ? undefined : world.get(from, PlacementComponent);
      if (where === undefined) continue;
      const toward = { x: where.x - at.x, z: where.z - at.z };
      if (Math.hypot(toward.x, toward.z) >= EPSILON) return toward;
    }
  }
  const dir = packet.direction;
  if (dir === undefined || Math.hypot(dir.x, dir.z) < EPSILON) return undefined;
  return { x: -dir.x, z: -dir.z };
}

export interface CombatHudGlueOptions {
  readonly world: World<never>;
  readonly player: EntityId;
  readonly hud: CombatHud;
  /** The drawn camera this frame. */
  readonly view: () => HudView;
}

export interface CombatHudGlue {
  /** Call once per drawn frame, after the sim stepped, with the frame's time. */
  frame(nowMs: number): void;
  /** Stops listening to the sim. */
  dispose(): void;
}

/** Wires `hud` to the player's sim state and events (see the file header). */
export function attachCombatHud(options: CombatHudGlueOptions): CombatHudGlue {
  const { world, player, hud, view } = options;
  let rejected = false;
  const hits: GroundVec[] = [];
  const offRejected = world.events.on(ActionRejected, (event) => {
    if (event.entity === player && event.reason === 'stamina') rejected = true;
  });
  const offDamage = world.events.on(DamageApplied, (hit) => {
    if (hit.target !== player || hit.total <= 0) return;
    const origin = hitOrigin(world, hit);
    if (origin !== undefined) hits.push(origin);
  });
  return {
    frame(nowMs) {
      if (rejected) hud.staminaRejected(nowMs);
      rejected = false;
      if (hits.length > 0) {
        const { forward, halfFov } = view();
        for (const toward of hits.splice(0)) {
          const bearing = damageBearing(forward, toward);
          if (bearing !== undefined && offScreen(bearing, halfFov)) hud.damageFrom(bearing, nowMs);
        }
      }
      const model = combatHudModel(world, player);
      if (hud.element.hidden !== (model === null)) hud.element.hidden = model === null;
      if (model !== null) hud.update(model, nowMs);
    },
    dispose() {
      offRejected();
      offDamage();
    },
  };
}
