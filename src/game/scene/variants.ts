// Fact-gated spawns in the running game (mw-e27.8): the glue between the sim's variant rules
// (src/sim/scene/variants.ts), the scene loader, creatures, breakables and the level deltas.
// When the scene loads, spawns whose gate is closed are simply left out (the sim loader does it).
// While it is loaded, `watchSpawnVariants` brings a spawn in or takes it out when its facts change and
// it is out of the player's view; a spawn that leaves keeps what happened to it as a level delta
// (`retire`) and gets it back when it returns (`activate`), so a broken board or a dead creature stays
// that way across swaps. Supported live: props (with or without a body) and markers, interactions, breakables and
// creatures;
// the content check (src/content/variant-checks.ts) rejects gates on spawns of other kinds.

import type { GameContent } from '@content/index';
import {
  addInteractable,
  addSceneBreakables,
  BreakableComponent,
  CreatureComponent,
  creaturesInstalled,
  despawnCreature,
  InteractableComponent,
  levelDeltasOf,
  originOfSpawn,
  spawnCreature,
  spawnErrorMessage,
  SpawnVariants,
  type CreatureSpawnOptions,
  type EntityId,
  type LoadedScene,
  type SceneSpawnPlacement,
  type Vec3,
  type World,
} from '@sim/index';
import { breakableProfiles } from '../breakables';

/** How far outside the screen edge (normalised device units) a point still counts as in view. */
export const VIEW_MARGIN = 0.15;

/** Whether a point at `ndc` (camera normalised device coordinates, z > 1 behind) is in view. */
export function ndcInView(ndc: Vec3, margin: number = VIEW_MARGIN): boolean {
  const limit = 1 + margin;
  return ndc.z <= 1 && Math.abs(ndc.x) <= limit && Math.abs(ndc.y) <= limit;
}

/** What the watcher needs from the scene loader. */
export interface SpawnLoader {
  readonly current: LoadedScene | undefined;
  addSpawn(spawn: SceneSpawnPlacement): EntityId;
  removeSpawn(id: string): boolean;
}

export interface WatchSpawnVariantsOptions {
  readonly world: World<never>;
  readonly loader: SpawnLoader;
  readonly content: GameContent;
  /** The creature spawn options; absent when the world has no creatures. */
  readonly creatures?: CreatureSpawnOptions | undefined;
  /** Whether a world point is on the player's screen; absent = never (changes happen at once). */
  readonly inView?: ((position: Vec3) => boolean) | undefined;
  /** Hears a creature that could not be spawned. */
  readonly onError?: (line: string) => void;
}

/** Entities of the creatures spawned from `point`. */
function creaturesAt(world: World<never>, point: string): EntityId[] {
  if (!creaturesInstalled(world)) return [];
  return [...world.query(CreatureComponent).ids()].filter(
    (entity) => world.get(entity, CreatureComponent)?.origin.point === point,
  );
}

/**
 * Keeps the loaded scene's gated spawns in step with the world facts. Call after the level deltas
 * were entered; call `step()` after each sim step; `dispose()` stops it. Returns undefined when the
 * scene has no gated spawn.
 */
export function watchSpawnVariants(options: WatchSpawnVariantsOptions): SpawnVariants | undefined {
  const { world, loader, content, creatures, inView } = options;
  const onError =
    options.onError ??
    ((line: string) => {
      console.error(line);
    });
  const { current } = loader;
  if (current?.authoredSpawns.some(({ gate }) => gate !== undefined) !== true) return undefined;
  const deltas = levelDeltasOf(world);
  const profiles = breakableProfiles(content);
  const scene = current;
  const bring = (spawn: SceneSpawnPlacement): void => {
    const entity = loader.addSpawn(spawn);
    const brought: [string, EntityId][] = [[`spawn:${spawn.id}`, entity]];
    if (spawn.interact !== undefined && world.isRegistered(InteractableComponent)) {
      addInteractable(world, entity, spawn.interact, spawn.position);
    }
    if (spawn.breakable !== undefined && world.isRegistered(BreakableComponent)) {
      addSceneBreakables(world, { ...scene, spawns: [{ entity, spawn }], pieces: [] }, profiles);
    }
    if (spawn.creature !== undefined && creatures !== undefined && creaturesInstalled(world)) {
      const result = spawnCreature(world, creatures, originOfSpawn(spawn, spawn.creature));
      if (result.ok) brought.push([`creature:${spawn.id}`, result.entity]);
      else onError(`variant spawn "${spawn.id}": ${spawnErrorMessage(result.error)}`);
    }
    if (deltas.current !== undefined) deltas.activate(world, brought);
  };
  const takeAway = (spawn: SceneSpawnPlacement): void => {
    if (deltas.current !== undefined) {
      deltas.retire(world, [`spawn:${spawn.id}`, `creature:${spawn.id}`]);
    }
    for (const entity of creaturesAt(world, spawn.id)) despawnCreature(world, entity);
    loader.removeSpawn(spawn.id);
  };
  return new SpawnVariants(
    world,
    current.authoredSpawns,
    current.layout.spawns.map(({ id }) => id),
    {
      ...(inView !== undefined && { inView }),
      apply: (spawn, present) => {
        if (present) bring(spawn);
        else takeAway(spawn);
      },
    },
  );
}
