// Creature senses, noise and AI in the running game (mw-e09.22, mw-e11.21, mw-e11.23): the game's
// side of the sim's noise propagation (src/sim/noise), perception (src/sim/perception), awareness
// and the behaviour runtime (src/sim/ai) on the navmesh (src/sim/nav). src/main.ts and the headless
// game world (src/tools/replay/testbed-player-scenario.ts) wire them the same way:
//
// - `startSceneNoise` (when a scene loads; it also makes every footstep and landing a noise, mw-e09.5): builds the scene's sound graph from its acoustics and the
//   loaded door spawns (`soundGraphFromScene`) and installs noise propagation with the shipped
//   stealth noise tuning and each door profile's leaf material. A level change swaps the graph
//   (`load`); `unload` leaves an empty graph (every noise falls off with distance alone).
// - `SceneNavigation` (an AiNavigation port): navmesh travel (`navmeshNavigation`) on the loaded
//   scene's baked navmesh (content `navmesh/<scene>`) with the door states read live from its door
//   spawns (`worldNavDoors`); a scene without a navmesh walks in straight lines, as before. A level
//   change swaps the mesh and drops every agent's route (planned on the old mesh).
// - `installCreatureAi` (by `startCreatures`, before the creature attack executor and the scene's
//   creature spawns, so spawned creatures get a brain): the perception system with line of sight over
//   the scene's Rapier sight world, the scene's light field, the shipped stealth visibility tuning
//   and the player as its only target; awareness on its percepts, resolving the player's source to
//   the player; and AI with every behaviour in content on `SceneNavigation`, with the creatures'
//   attacks. Per-tick costs stay within the budgets the sim defines: perception's work units
//   (PERCEPTION_DEFAULT_BUDGET_MS) and the nav request queue's (NAV_DEFAULT_BUDGET_MS).
//
// System order (each is appended when installed): the player and the light field run before
// perception; perception before AI; AI before the creature attack executor. Noise propagation and
// awareness are event listeners, so their place is the events they listen to.
//
// `aiReadout` is the e2e's view (#app[data-ai]): how many creatures think, each one's alert state,
// position and whether it stands on the navmesh, how many times one was seen off it, and perception's
// spend against its budget.

import {
  compileSurfaceTable,
  STEALTH_ID,
  SURFACE_TABLE_ID,
  type GameContent,
} from '@content/index';
import {
  approach,
  BrainComponent,
  buildSoundGraph,
  compileBehaviours,
  createSurfaceMap,
  DEFAULT_FOOTSTEP_SURFACES,
  entitySource,
  installAi,
  installAwareness,
  installFootstepNoise,
  isFriendlyToPlayer,
  installNoisePropagation,
  LineOfSight,
  NavMesh,
  navmeshNavigation,
  NavRouteComponent,
  perceptionSystem,
  perceptSourcePresent,
  PlacementComponent,
  soundGraphFromScene,
  straightDistance,
  surfaceAt,
  straightLineNavigation,
  worldNavDoors,
  type AiNavigation,
  type AiStatus,
  type AttackLookup,
  type BehaviourTable,
  type EntityId,
  type FactionTable,
  type LightField,
  type LoadedScene,
  type NavmeshNavigation,
  type NoisePropagation,
  type PerceptionSystem,
  type SurfaceMap,
  type SightWorld,
  type TravelRequest,
  type Vec3,
  type World,
  StatusLedgerComponent,
  statusScaledNavigation,
} from '@sim/index';
import { statusLookup } from '../magic/install';

/** A scene's noise propagation (see the file header). */
export interface SceneNoise {
  readonly propagation: NoisePropagation;
  /** Swaps in the sound graph of `loaded` (a level change). */
  load(loaded: LoadedScene): void;
  /** Leaves an empty sound graph (the scene unloaded). */
  unload(): void;
}

const EMPTY_GRAPH = { rooms: [], portals: [] };

/** Installs noise propagation for the loaded scene `loaded` (see the file header). */
export function startSceneNoise<TInput>(
  world: World<TInput>,
  content: GameContent,
  loaded: LoadedScene,
): SceneNoise {
  const graphOf = (scene: LoadedScene) =>
    soundGraphFromScene(content.get('scene', scene.id), scene);
  const noise = content.get('stealth', STEALTH_ID).noise;
  const surfaces = compileSurfaceTable(content.get('surface-table', SURFACE_TABLE_ID));
  const mapOf = (scene: LoadedScene): SurfaceMap =>
    createSurfaceMap({ table: surfaces, regions: scene.layout.surfaces });
  let surfaceMap = mapOf(loaded);
  const propagation = installNoisePropagation(world, {
    graph: graphOf(loaded),
    tuning: noise,
    // Door entities exist only for door profiles content has (the mechanisms build them).
    doorMaterial: (profile) => content.get('door', profile).material.id,
  });
  // Every footstep and landing is a noise (mw-e09.5); creatures have no collider to read, so their
  // steps sound by the scene's tagged surfaces (else stone).
  installFootstepNoise(world, {
    tuning: noise.footsteps,
    surfaces,
    creatureSurface: (position) => surfaceAt(surfaceMap, position, DEFAULT_FOOTSTEP_SURFACES),
  });
  return {
    propagation,
    load(scene) {
      propagation.setGraph(graphOf(scene));
      surfaceMap = mapOf(scene);
    },
    unload() {
      propagation.setGraph(buildSoundGraph(EMPTY_GRAPH));
      surfaceMap = createSurfaceMap({ table: surfaces });
    },
  };
}

/** The navmesh baked for scene `id`, or undefined when content has none. */
export function sceneNavMesh(content: GameContent, id: string): NavMesh | undefined {
  return content.has('navmesh', id) ? new NavMesh(content.get('navmesh', id)) : undefined;
}

/** The door spawns of `loaded`: spawn id → door entity. */
export function sceneDoors(loaded: LoadedScene): ReadonlyMap<string, EntityId> {
  const doors = new Map<string, EntityId>();
  for (const { entity, spawn } of loaded.spawns)
    if (spawn.door !== undefined) doors.set(spawn.id, entity);
  return doors;
}

/** AI travel on the loaded scene's navmesh, or in straight lines without one (see the file header). */
export class SceneNavigation implements AiNavigation {
  #navmesh: NavmeshNavigation | undefined;
  #mesh: NavMesh | undefined;

  /** The loaded scene's navmesh, or undefined (straight-line travel). */
  get mesh(): NavMesh | undefined {
    return this.#mesh;
  }

  /** Its path request queue, or undefined without a navmesh. */
  get navmesh(): NavmeshNavigation | undefined {
    return this.#navmesh;
  }

  /** Travels on the navmesh of `loaded` from now on (a scene load or level change). */
  load(world: World<never>, content: GameContent, loaded: LoadedScene): void {
    this.unload(world);
    const mesh = sceneNavMesh(content, loaded.id);
    if (mesh === undefined) return;
    this.#mesh = mesh;
    this.#navmesh = navmeshNavigation({ mesh, doors: worldNavDoors(world, sceneDoors(loaded)) });
  }

  /** Back to straight lines; every agent's route (planned on the old mesh) is dropped. */
  unload(world: World<never>): void {
    this.#mesh = undefined;
    this.#navmesh = undefined;
    if (!world.isRegistered(NavRouteComponent)) return;
    for (const entity of world.query(NavRouteComponent).ids()) {
      world.remove(entity, NavRouteComponent);
    }
  }

  // Fields, not methods: AI calls `distance` detached from the port.
  readonly travel = (world: World<never>, entity: EntityId, request: TravelRequest): AiStatus =>
    (this.#navmesh ?? straightLineNavigation).travel(world, entity, request);

  readonly distance = (world: World<never>, entity: EntityId, goal: Vec3): number =>
    (this.#navmesh?.distance ?? straightDistance)(world, entity, goal);

  /** Navmesh approach (mw-e11.13: wait below a target out of reach); straight-line travel without. */
  readonly approach = (world: World<never>, entity: EntityId, request: TravelRequest) =>
    this.#navmesh === undefined
      ? approach(straightLineNavigation, world, entity, request)
      : this.#navmesh.approach(world, entity, request);
}

/** What `installCreatureAi` runs on (see the file header). */
export interface CreatureAiOptions {
  /** The game's content: its stealth visibility tuning. */
  readonly content: GameContent;
  /** The player, perception's only target; without one, every character-controlled entity. */
  readonly player: EntityId | undefined;
  /** The scene's light field. */
  readonly light: Pick<LightField, 'levelAt'>;
  /** Sight lines: the scene's Rapier sight world. */
  readonly sight: SightWorld;
  /** How AI travels (`SceneNavigation`). */
  readonly navigation: AiNavigation;
  /**
   * The factions: creatures that are friends of the player (shopkeepers, the Watch) do not notice
   * its footsteps (mw-e09.5). Without it every creature does.
   */
  readonly factions?: FactionTable;
}

/** Installed creature senses and AI. */
export interface CreatureAi {
  readonly perception: PerceptionSystem<unknown>;
  readonly behaviours: BehaviourTable;
}

/**
 * Adds perception, awareness and AI to `world` (see the file header): call once, after the player
 * and the light field and before the creature attack executor and creature spawns.
 */
export function installCreatureAi<TInput>(
  world: World<TInput>,
  attacks: AttackLookup,
  options: CreatureAiOptions,
): CreatureAi {
  const w: World<never> = world;
  const { content, player, factions } = options;
  const perception = perceptionSystem<unknown>(w, {
    lineOfSight: new LineOfSight({ world: options.sight }),
    light: options.light,
    visibility: content.get('stealth', STEALTH_ID).visibility,
    ...(player !== undefined && { targets: () => [player] }),
    ...(factions !== undefined && {
      noticesMovement: (agent: EntityId) => !isFriendlyToPlayer(w, factions, agent),
    }),
  });
  world.addSystem(perception);
  installAwareness(w, {
    present: (source) => perceptSourcePresent(w, source),
    target: playerTarget(player),
  });
  const behaviours = compileBehaviours(content.all('behaviour'));
  // Slowed and rooted creatures travel slower or not at all (mw-e06.24; magic, when installed).
  const navigation = world.isRegistered(StatusLedgerComponent)
    ? statusScaledNavigation(options.navigation, statusLookup(content.all('status')))
    : options.navigation;
  installAi(world, { behaviours, navigation, attacks });
  return { perception, behaviours };
}

/**
 * Awareness's target resolver: the player's percept source is the player; nothing else (no other
 * source, and none at all without a player) resolves to a target.
 */
export function playerTarget(
  player: EntityId | undefined,
): (source: string) => EntityId | undefined {
  if (player === undefined) return () => undefined;
  const source = entitySource(player);
  return (s) => (s === source ? player : undefined);
}

/** An AiWatch over `ai`, or undefined when no creature AI was installed. */
export function watchCreatureAi(
  world: World<never>,
  ai: CreatureAi | undefined,
  navigation: SceneNavigation,
): AiWatch | undefined {
  return ai === undefined ? undefined : new AiWatch(world, ai, navigation);
}

/** One thinking creature, for the e2e. */
export interface AiAgentReadout {
  readonly entity: EntityId;
  readonly state: string;
  readonly activity: string | null;
  /** Its feet, rounded to centimetres. */
  readonly at: readonly [number, number, number];
  /** It stands on the navmesh (true without one). */
  readonly onMesh: boolean;
}

/** Creature AI now (#app[data-ai]). */
export interface AiReadout {
  readonly agents: readonly AiAgentReadout[];
  /** The scene has a navmesh. */
  readonly navmesh: boolean;
  /** Agent-ticks seen off the navmesh since the scene loaded (must stay 0). */
  readonly offMesh: number;
  readonly perception: {
    /** Work units a tick may spend. */
    readonly budget: number;
    /** Most units one tick spent so far. */
    readonly peak: number;
    /** Units the last tick spent. */
    readonly last: number;
  };
}

/** Horizontal and vertical slack, metres, within which feet count as on the navmesh. */
const ON_MESH_SLACK = 0.45;

const cm = (n: number): number => Math.round(n * 100) / 100;

/**
 * Watches creature AI after each step for the e2e: call `step()` after every sim step and `readout()`
 * when publishing. The off-mesh count and the perception peak accumulate across steps.
 */
export class AiWatch {
  #offMesh = 0;
  #peak = 0;

  constructor(
    private readonly world: World<never>,
    private readonly ai: CreatureAi,
    private readonly navigation: SceneNavigation,
  ) {}

  /** Counts this step's off-mesh agents and perception's spend. */
  step(): void {
    this.#peak = Math.max(this.#peak, this.ai.perception.lastUnits);
    const mesh = this.navigation.mesh;
    if (mesh === undefined) return;
    this.world.query(BrainComponent, PlacementComponent).forEach((_entity, _brain, at) => {
      if (mesh.locate(at, ON_MESH_SLACK, ON_MESH_SLACK) < 0) this.#offMesh++;
    });
  }

  readout(): AiReadout {
    const mesh = this.navigation.mesh;
    const agents: AiAgentReadout[] = [];
    this.world.query(BrainComponent, PlacementComponent).forEach((entity, brain, at) => {
      agents.push({
        entity,
        state: brain.state,
        activity: brain.activity,
        at: [cm(at.x), cm(at.y), cm(at.z)],
        onMesh: mesh === undefined || mesh.locate(at, ON_MESH_SLACK, ON_MESH_SLACK) >= 0,
      });
    });
    const { perception } = this.ai;
    return {
      agents,
      navmesh: mesh !== undefined,
      offMesh: this.#offMesh,
      perception: { budget: perception.unitsPerTick, peak: this.#peak, last: perception.lastUnits },
    };
  }
}

/** The ?perf overlay's line for creature AI, e.g. `perception 12/150 units (peak 40) · 3 thinking`. */
export function formatPerceptionStats({ agents, perception }: AiReadout): string {
  const { last, budget, peak } = perception;
  return `perception ${String(last)}/${String(budget)} units (peak ${String(peak)}) · ${String(agents.length)} thinking`;
}
