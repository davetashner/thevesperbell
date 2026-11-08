// Mechanisms in the game (mw-e03.18): the glue between the sim's doors, locks and switches
// (src/sim/mechanisms), content's door profiles, locks and signal graphs, and the renderer.
//
// - `startMechanisms` sets a loaded scene's mechanisms going: it installs signals (if nothing has
//   yet) and mechanisms, with door leaves colliding in the physics port, closed doors occluding the
//   light field, and keys found on the actor's keyring, then makes the scene's doors and switches
//   and wires its signal graphs. Call it after the player is set up, so doors and switches get their
//   prompts and run after the interaction system.
// - `readDoorLeaf` is how a door's leaf object follows the sim: the leaf's pose at its openness,
//   which RenderSync interpolates between ticks.
// - `MechanismWatch` publishes what the doors and switches are doing, for the e2e
//   (#app[data-mechanisms]).
//
// - `sceneCheckpoints` reads which of a scene's trigger volumes are checkpoints (mw-e01.4), the
//   predicate the autosave's `autosaveAtCheckpoints` (mw-e30.5) takes.
//
// No mechanisms, no cost: the game only starts them in scenes that have some (`hasMechanisms`).

import type { GameContent } from '@content/index';
import {
  addSceneMechanisms,
  DoorComponent,
  doorStatus,
  EquipmentRules,
  gravityScaleOf,
  installMechanisms,
  installSignals,
  InventoryRules,
  keyring,
  leafPose,
  SceneSpawnComponent,
  SignalGraphComponent,
  signalSystem,
  SwitchComponent,
  tagEntity,
  type DoorProfile,
  type DoorProfileLookup,
  type DoorStatus,
  type EntityId,
  type LoadedScene,
  type LockLookup,
  type MaterialPresets,
  type SceneLayout,
  type SceneMechanisms,
  type SignalGraphDef,
  type StaticColliderSink,
  type Vec3,
  type VolumeCrossing,
  type World,
} from '@sim/index';
import type { SimView, Transform } from '../loop/render-sync';

type Content = Pick<GameContent, 'all' | 'get' | 'has'>;

/** The sim's door profile lookup over content `door` entries. */
export function doorProfiles(content: Content): DoorProfileLookup {
  return (id) => {
    if (!content.has('door', id)) return undefined;
    const door = content.get('door', id);
    const [x, y, z] = door.size;
    const profile: DoorProfile = {
      id,
      kind: door.kind,
      size: { x, y, z },
      seconds: door.seconds,
      crush: door.crush,
      manual: door.manual,
      blocks: { ...door.blocks },
      loudness: door.loudness,
    };
    return profile;
  };
}

/** The sim's lock lookup over content `lock` entries. */
export function lockSpecs(content: Content): LockLookup {
  return (id) => {
    if (!content.has('lock', id)) return undefined;
    const { tier, pickTier, sealed, tags, hint } = content.get('lock', id);
    return { id, tier, pickTier, sealed, tags: [...tags], hint };
  };
}

/** Whether a scene has doors, switches, signal graphs or locked containers (mw-e18.3). */
export function hasMechanisms(layout: SceneLayout): boolean {
  return (
    layout.signals.length > 0 ||
    layout.spawns.some(
      (spawn) =>
        spawn.door !== undefined ||
        spawn.switch !== undefined ||
        spawn.container?.lock !== undefined,
    )
  );
}

export interface StartMechanismsOptions {
  readonly content: Content;
  readonly materials: MaterialPresets;
  /** Where door leaves collide: the world's physics port. */
  readonly colliders: StaticColliderSink;
  /** Where closed doors occlude light: the light field's statics. */
  readonly occluders: StaticColliderSink;
  /**
   * The player, tagged `player` when the scene places signal graphs, so player-filtered trigger
   * volumes (checkpoints, the slice-complete volume) count it.
   */
  readonly player?: EntityId | undefined;
}

/** The tag player-filtered trigger volumes test for. */
export const PLAYER_TAG = 'player';

/**
 * Installs signals (unless installed) and mechanisms in `world` and makes `loaded`'s doors, switches
 * and signal graphs. Call between steps, once, after the player is set up.
 */
export function startMechanisms<T>(
  world: World<T>,
  loaded: LoadedScene,
  options: StartMechanismsOptions,
): SceneMechanisms {
  const sim = world as unknown as World<never>;
  const { content } = options;
  if (!sim.isRegistered(SignalGraphComponent)) {
    installSignals(sim);
    world.addSystem(signalSystem());
  }
  if (options.player !== undefined && loaded.layout.signals.length > 0) {
    tagEntity(sim, options.player, PLAYER_TAG);
  }
  const equipment = new EquipmentRules(content.all('item'), content.all('class'));
  installMechanisms(world, {
    colliders: options.colliders,
    occluders: options.occluders,
    keys: keyring(new InventoryRules(content.all('item'))),
    plates: {
      gravityScale: gravityScaleOf,
      gear: (actors, actor) => equipment.wornKg(actors as unknown as World, actor),
    },
  });
  return addSceneMechanisms(world, loaded, {
    doors: doorProfiles(content),
    locks: lockSpecs(content),
    // Scene references are checked at content load, so every graph and profile named exists.
    graphs: (id) => content.get('signal-graph', id) as unknown as SignalGraphDef,
    doorMaterial: (id) => content.get('door', id).material.id,
    materials: options.materials,
  });
}

/**
 * Whether a volume crossing is a checkpoint of `layout`: the scene marks the volume node as one in
 * the graph it places (`signals[].checkpoints`). Pass it to `autosaveAtCheckpoints`.
 */
export function sceneCheckpoints(layout: SceneLayout): (crossing: VolumeCrossing) => boolean {
  const marked = new Set(
    layout.signals.flatMap(({ graph, checkpoints }) =>
      checkpoints.map((node) => `${graph}/${node}`),
    ),
  );
  return (crossing) => marked.has(`${crossing.graphId}/${crossing.node}`);
}

/** What a door's leaf object looks like: its box about its pivot, and its material. */
export interface DoorLeafLook {
  readonly entity: EntityId;
  readonly size: Vec3;
  readonly centre: Vec3;
  readonly material: string;
}

/** The leaf looks of a scene's doors (the material from its profile, `generic` without one). */
export function doorLeafLooks(
  world: World<never>,
  made: SceneMechanisms,
  content: Content,
): DoorLeafLook[] {
  return made.doors.flatMap((entity) => {
    const door = world.get(entity, DoorComponent);
    if (door === undefined) return [];
    const { size, centre } = leafPose(door, 0);
    const material = content.has('door', door.profile)
      ? content.get('door', door.profile).material.id
      : 'generic';
    return [{ entity, size, centre, material }];
  });
}

/** The pose a door's leaf object takes: its pivot at the leaf's openness. */
export function readDoorLeaf(view: SimView, entity: EntityId): Transform | undefined {
  const door = view.get(entity, DoorComponent);
  if (door === undefined) return undefined;
  const { position, rotation } = leafPose(door, door.openness);
  return { position, rotation };
}

/** One door as the readout reports it. */
export interface DoorReading {
  readonly status: DoorStatus;
  /** 0 closed … 1 open, to 2 decimals. */
  readonly openness: number;
}

/** What the doors and switches are doing, by spawn id. */
export interface MechanismReadout {
  readonly doors: Readonly<Record<string, DoorReading>>;
  readonly switches: Readonly<Record<string, number>>;
}

/** Reads a scene's doors and switches. */
export class MechanismWatch {
  constructor(
    private readonly world: World<never>,
    private readonly made: SceneMechanisms,
  ) {}

  /** The readout now; entities that are gone (a door burnt away) are left out. */
  readout(): MechanismReadout {
    const { world } = this;
    const name = (entity: EntityId) => world.get(entity, SceneSpawnComponent)?.id ?? String(entity);
    const doors: Record<string, DoorReading> = {};
    for (const entity of this.made.doors) {
      const door = world.get(entity, DoorComponent);
      const status = doorStatus(world, entity);
      if (door === undefined || status === undefined) continue;
      doors[name(entity)] = { status, openness: Math.round(door.openness * 100) / 100 };
    }
    const switches: Record<string, number> = {};
    for (const entity of this.made.switches) {
      const own = world.get(entity, SwitchComponent);
      if (own !== undefined) switches[name(entity)] = own.position;
    }
    return { doors, switches };
  }

  /** Whether a door is broken (its leaf is no longer drawn). */
  broken(entity: EntityId): boolean {
    return this.world.get(entity, DoorComponent)?.broken === true;
  }
}
