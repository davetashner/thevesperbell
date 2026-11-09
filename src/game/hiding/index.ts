// Hiding spots in the game (mw-e03.23): the glue between a scene's `hiding` spawns, the sim's hiding
// rules (src/sim/hiding) and the player's camera.
//
// - `startHiding` installs hiding in a world and makes a loaded scene's hiding spawns hiding spots,
//   each opening the way its yaw faces. Call after the player (its input is cut while hidden and its
//   controller held), mechanisms and containers, once, between steps. Only scenes that have hiding
//   spawns call it, so every other world is exactly as it was.
// - `peekView` is the player's camera while hidden (the peek hook of setupTestbedPlayer): the eye of
//   the spot it hides in, looking where the player's look points (the sim holds it to the opening's
//   arc), with the player's own body hidden.
// - `HidingWatch` publishes who hides where for the e2e (#app[data-hiding]).

import {
  addSceneHidingSpots,
  hiddenOf,
  HidingSpotComponent,
  installHiding,
  isHidden,
  isOccupied,
  peekOf,
  PlayerLook,
  SceneSpawnComponent,
  spawnYaw,
  type CollisionWorld,
  type EntityId,
  type Hiding,
  type LoadedScene,
  type SceneLayout,
  type World,
} from '@sim/index';
import type { Capsule } from '@sim/index';
import type { SimView, Transform } from '../loop/render-sync';
import type { PeekView } from '../player/testbed-player';

/** The id the hiding veto is registered under in the saves' safety vetoes. */
export const HIDING_VETO_ID = 'hiding';

/** Why saving is unsafe while the player hides (the pause menu's Save shows it too). */
export const HIDING_VETO_REASON = "Can't save while hiding";

/**
 * The safety veto (mw-e03.23): HIDING_VETO_REASON while `player` hides in a spot, so an autosave or a
 * requested save never steps them out of a wardrobe in front of a guard. `settleHidden` stays in the
 * save's `beforeWrite` as the safety net for routes that skip the vetoes (the debug console).
 */
export function hidingVeto(
  world: World<never>,
  player: () => EntityId | undefined,
): () => string | null {
  return () => {
    const hero = player();
    return hero !== undefined && world.isAlive(hero) && isHidden(world, hero)
      ? HIDING_VETO_REASON
      : null;
  };
}

/** Whether a scene has hiding spots. */
export function hasHiding(layout: SceneLayout): boolean {
  return layout.spawns.some((spawn) => spawn.hiding !== undefined);
}

/**
 * Installs hiding in `world` and makes `loaded`'s hiding spawns hiding spots. Returns the spots, in
 * scene order, and the rules.
 */
export function startHiding<T>(
  world: World<T>,
  loaded: LoadedScene,
  options: { readonly collision: CollisionWorld; readonly capsule: Capsule },
): { readonly spots: EntityId[]; readonly hiding: Hiding } {
  const { hiding } = installHiding(world, options);
  const spots = addSceneHidingSpots(world, loaded.spawns, spawnYaw);
  return { spots, hiding };
}

/** `entity`'s peek view, or undefined when it is not hiding (or hiding is not installed). */
export function peekView(world: World<never>, entity: EntityId): PeekView | undefined {
  const peek = peekOf(world, entity);
  if (peek === undefined) return undefined;
  const look = world.get(entity, PlayerLook);
  return {
    eye: peek.eye,
    yaw: look?.yaw ?? peek.yaw,
    pitch: look?.pitch ?? 0,
  };
}

/** A hiding spot spawn's greybox box (the scene data's `size` and `look`). */
export interface SpotLook {
  readonly entity: EntityId;
  readonly size: { readonly x: number; readonly y: number; readonly z: number };
  readonly look: 'wood' | 'hay';
}

/** The greybox boxes of a scene's hiding spots, for the spawns that give a `size`. */
export function spotLooks(loaded: LoadedScene): SpotLook[] {
  const looks: SpotLook[] = [];
  for (const { entity, spawn } of loaded.spawns) {
    const own = spawn.hiding;
    if (own?.size === undefined) continue;
    const [x, y, z] = own.size;
    looks.push({ entity, size: { x, y, z }, look: own.look ?? 'wood' });
  }
  return looks;
}

/** The pose a hiding spot's box takes: standing on its origin, its opening facing out. */
export function readHidingSpot(
  view: SimView,
  entity: EntityId,
  height: number,
): Transform | undefined {
  const spot = view.get(entity, HidingSpotComponent);
  if (spot === undefined) return undefined;
  const { origin, yaw } = spot;
  return {
    position: { x: origin.x, y: origin.y + height / 2, z: origin.z },
    rotation: { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) },
  };
}

/** One spot, as the readout reports it. */
export interface HidingReading {
  /** The spot's entity id (the debug console's `prop <id> ...` takes it). */
  readonly entity: number;
  readonly occupied: boolean;
  /** Who hides in it: `player` for the player, else the entity id. */
  readonly occupants: readonly string[];
}

/** What the readout reports: who hides where, by spawn id. */
export interface HidingReadout {
  readonly spots: Readonly<Record<string, HidingReading>>;
  /** The spawn id of the spot the player hides in, or null. */
  readonly player: string | null;
}

/** Reads a scene's hiding spots, by spawn id. */
export class HidingWatch {
  constructor(
    private readonly world: World<never>,
    private readonly spots: readonly EntityId[],
    private readonly player: EntityId | undefined,
  ) {}

  readout(): HidingReadout {
    const { world } = this;
    const readings: Record<string, HidingReading> = {};
    for (const entity of this.spots) {
      const spot = world.get(entity, HidingSpotComponent);
      if (spot === undefined) continue; // gone (broken, burnt away)
      const name = world.get(entity, SceneSpawnComponent)?.id ?? String(entity);
      readings[name] = {
        entity,
        occupied: isOccupied(world, entity),
        occupants: spot.occupants.map((who) => (who === this.player ? 'player' : String(who))),
      };
    }
    const mine =
      this.player === undefined || !world.isAlive(this.player)
        ? undefined
        : hiddenOf(world, this.player);
    const at = mine === undefined ? undefined : world.get(mine.spot, SceneSpawnComponent)?.id;
    return { spots: readings, player: at ?? null };
  }
}
