// Creatures in the grey-box scenes (mw-e12.4): the game's side of the sim's creature spawner
// (src/sim/creatures). In two halves, like the testbed's combat (src/game/combat/testbed-combat.ts):
//
// 1. `prepareCreatures` (before the debug commands are installed): compiles every creature in
//    content (senses and locomotion resolved), the faction table and the creature attack table, and
//    makes the debug console's spawners, one per creature id (`spawn fixture-hound 3`, or walking a
//    route: `spawn fixture-guard --patrol 0,0,12;0,0,20`).
// 2. `startCreatures` (after startTestbedCombat, so the hit volumes, reactions and lock-on are in):
//    registers the creature components, installs factions and the creature attack executor (with
//    the shared invulnerability rule, mw-e04.28) and spawns the scene's creature spawns. Given
//    `ai` (the game and the headless game world always give it), perception, awareness and AI are
//    installed first (./ai.ts, mw-e11.21, mw-e11.23), so every creature whose behaviour content has
//    spawns with a brain and runs it; without `ai` creatures stand where they spawned and take hits.
//
// With no creature in content there is nothing to install: the world, its entity ids and its state
// hashes stay exactly as before. The game's own content has the bestiary's creatures (E13; the first
// is the Forgotten miner, mw-e13.1), so every scene installs them and the console can spawn them.
// Debug builds also load the frozen fixture creatures (src/content/dev-content.ts).
//
// `bindCreatures` gives every creature without one a render proxy after each step (scene, console
// and respawned creatures alike); render sync drops a despawned creature's proxy on the next frame.
//
// `CreatureTelegraphs` (mw-e04.20) tells the render which creatures are winding up a telegraphed
// move, and what kind: from TelegraphStarted until the move turns active, the attack ends or the
// creature is gone. Event-driven: a frame with no telegraph change costs one empty check.

import {
  compileAttacks,
  compileCreatures,
  compileShield,
  type AttackTable,
  type CreatureTable,
  type GameContent,
  type NavAgent,
  type RuntimeShield,
} from '@content/index';
import {
  ATTACK_COMPONENTS,
  AttackerComponent,
  buildFactionTable,
  creatureSpawners,
  CreatureComponent,
  creaturesInstalled,
  CreatureNavComponent,
  factionSpecFromDef,
  installAttacks,
  installTargetSharing,
  installFactions,
  invulnerabilityRule,
  PlacementComponent,
  registerCreatureComponents,
  spawnErrorMessage,
  spawnSceneCreatures,
  ActionPhaseChanged,
  AttackEnded,
  TelegraphStarted,
  type CreatureSpawnOptions,
  type EntityId,
  type RapierPhysics,
  PHASE_FACT,
  type SceneCreatures,
  type SceneSpawnPlacement,
  type Spawner,
  type Vec3,
  type World,
} from '@sim/index';
import type { TestbedCombat } from '../combat/testbed-combat';
import { installCreatureAi, type CreatureAi, type CreatureAiOptions } from './ai';
import type { RenderSync, SceneBinding } from '../loop/render-sync';

export * from './ai';
export * from './drops';
export * from './presence';
export * from './save-veto';

/** The first half of the creature wiring (see the file header). */
export interface GameCreatures {
  /** Spawnable creatures by id. */
  readonly table: CreatureTable;
  /** What the sim's spawner needs: the creatures and the faction table. */
  readonly spawn: CreatureSpawnOptions;
  /** The creatures' attacks (the attack executor's table). */
  readonly attacks: AttackTable;
  /** The debug console's spawners, keyed by creature id. */
  readonly spawners: ReadonlyMap<string, Spawner>;
}

/** Compiles the creatures, factions and creature attacks in `content` (step 1). */
export function prepareCreatures(content: GameContent, combat: TestbedCombat): GameCreatures {
  const table = compileCreatures(content.all('creature'), content);
  const factions = buildFactionTable(content.all('faction').map(factionSpecFromDef));
  // The shield each creature carries (mw-ju8.19), compiled once.
  const shields = new Map<string, RuntimeShield>();
  for (const def of content.all('creature')) {
    if (def.shield !== undefined)
      shields.set(def.id, compileShield(content.get('shield', def.shield.id)));
  }
  const spawn = { creatures: table, factions, shields };
  return {
    table,
    spawn,
    attacks: compileAttacks(content.all('attack'), combat.moves),
    spawners: creatureSpawners(spawn),
  };
}

/**
 * Installs creatures into `world` and spawns the creature spawns among `spawns` (step 2). Does
 * nothing when content has no creatures. Failed spawns come back in `errors` (never thrown).
 */
export function startCreatures<TInput>(
  world: World<TInput>,
  creatures: GameCreatures,
  combat: TestbedCombat,
  spawns: readonly SceneSpawnPlacement[],
  ai?: CreatureAiOptions,
): StartedCreatures {
  if (creatures.table.size === 0) return { entities: [], errors: [], ai: undefined };
  const w: World<never> = world;
  // Once per world: nothing else installs the creature attack executor or factions yet.
  installFactions(registerCreatureComponents(w).register(...ATTACK_COMPONENTS));
  // Senses and AI before the attack executor (a think's attack starts that tick) and the spawns.
  const installed = ai === undefined ? undefined : installCreatureAi(world, creatures.attacks, ai);
  // Allies in a fight hear where each other's target is (mw-e11.13).
  if (installed !== undefined) installTargetSharing(w, { factions: creatures.spawn.factions });
  installAttacks(world, {
    attacks: creatures.attacks,
    damage: combat.damage,
    invulnerable: invulnerabilityRule(combat.moves),
  });
  // A creature that keeps to some phases of the day is spawned only in those (mw-ju8.14).
  const phase = world.facts.get(PHASE_FACT);
  const scene = spawnSceneCreatures(
    w,
    creatures.spawn,
    spawns,
    typeof phase === 'string' ? phase : undefined,
  );
  return { ...scene, ai: installed };
}

/** What `startCreatures` spawned, and the creature AI it installed (undefined without `ai`). */
export interface StartedCreatures extends SceneCreatures {
  readonly ai: CreatureAi | undefined;
}

/** One line per failed scene spawn, for the browser console. */
export function sceneCreatureErrors(result: SceneCreatures): string[] {
  return result.errors.map(
    ({ point, error }) => `creature spawn "${point}": ${spawnErrorMessage(error)}`,
  );
}

/** What a creature's render proxy is built from. */
export interface CreatureLook {
  readonly id: string;
  readonly nav: NavAgent;
  /** It has attacks (drawn differently). */
  readonly armed: boolean;
}

/**
 * Binds a render object to every creature not bound yet (call after each sim step): `create` builds
 * it from the creature's look. Returns how many it bound. Call after `startCreatures`.
 */
export function bindCreatures<TObject>(
  world: World<never>,
  sync: RenderSync,
  create: (entity: EntityId, look: CreatureLook) => SceneBinding<TObject>,
): number {
  if (!creaturesInstalled(world)) return 0;
  const unbound: [EntityId, CreatureLook][] = [];
  world.query(CreatureComponent, CreatureNavComponent).forEach((entity, creature, nav) => {
    if (sync.has(entity)) return;
    const armed = world.has(entity, AttackerComponent);
    unbound.push([entity, { id: creature.origin.creature, nav, armed }]);
  });
  for (const [entity, look] of unbound) sync.bind(entity, create(entity, look));
  return unbound.length;
}

/** The creatures now, for the e2e: how many, how many are drawn and in view, and of which kinds. */
export interface CreatureReadout {
  readonly count: number;
  /** How many have a render proxy. */
  readonly drawn: number;
  /** How many of those are inside the camera's view (their middle projects on screen). */
  readonly inView: number;
  /** Creature id → how many. */
  readonly kinds: Readonly<Record<string, number>>;
}

/** Normalised device coordinates of a world point (−1…1 on screen and between the clip planes). */
export type ProjectToNdc = (point: Vec3) => Vec3;

const onScreen = ({ x, y, z }: Vec3): boolean =>
  Math.max(Math.abs(x), Math.abs(y), Math.abs(z)) <= 1;

/**
 * `world`'s creature readout (all zero when creatures are not installed). Without `project`, none
 * counts as in view.
 */
export function creatureReadout(
  world: World<never>,
  isBound: (entity: EntityId) => boolean,
  project: ProjectToNdc = () => ({ x: 2, y: 2, z: 2 }),
): CreatureReadout {
  const kinds: Record<string, number> = {};
  let count = 0;
  let drawn = 0;
  let inView = 0;
  if (!creaturesInstalled(world)) return { count, drawn, inView, kinds };
  world
    .query(CreatureComponent, CreatureNavComponent, PlacementComponent)
    .forEach((entity, creature, nav, at) => {
      count++;
      const id = creature.origin.creature;
      kinds[id] = (kinds[id] ?? 0) + 1;
      if (!isBound(entity)) return;
      drawn++;
      if (onScreen(project({ x: at.x, y: at.y + nav.height / 2, z: at.z }))) inView++;
    });
  return { count, drawn, inView, kinds };
}

/** A camera pose: position and orientation (a unit quaternion). */
export interface ViewPose {
  readonly position: Vec3;
  readonly quaternion: {
    readonly x: number;
    readonly y: number;
    readonly z: number;
    readonly w: number;
  };
}

/** How far `viewCentrePoint` looks, metres. */
export const VIEW_POINT_RANGE = 60;

/**
 * The point at the centre of the view (`spawn … at-cursor`): where the camera's forward ray (−z in
 * camera space) first meets a collider in the sim's physics world within VIEW_POINT_RANGE, or
 * undefined when it meets none. A read-only query; the sim is not touched.
 */
export function viewCentrePoint(physics: RapierPhysics, view: ViewPose): Vec3 | undefined {
  const { x, y, z, w } = view.quaternion;
  const dir = { x: -2 * (x * z + w * y), y: -2 * (y * z - w * x), z: -(1 - 2 * (x * x + y * y)) };
  const origin = view.position;
  const ray = new physics.rapier.Ray(
    { x: origin.x, y: origin.y, z: origin.z },
    { x: dir.x, y: dir.y, z: dir.z },
  );
  const hit = physics.rapierWorld.castRay(ray, VIEW_POINT_RANGE, true);
  if (hit === null) return undefined;
  const t = hit.timeOfImpact;
  return { x: origin.x + dir.x * t, y: origin.y + dir.y * t, z: origin.z + dir.z * t };
}

/**
 * How a telegraph reads (mw-e04.20): `parry` for a move a parry deflects, `block` for one a shield
 * stops but a parry does not, `unblockable` for an unblockable move or a grab — dodge it.
 */
export type TelegraphLook = 'parry' | 'block' | 'unblockable';

/** Which creatures are telegraphing, from the sim's events (see the file header). */
export class CreatureTelegraphs {
  readonly #showing = new Map<EntityId, { readonly move: string; readonly look: TelegraphLook }>();
  readonly #changed = new Map<EntityId, TelegraphLook | null>();
  readonly #offs: (() => void)[];

  constructor(world: World<never>) {
    const stop = (entity: EntityId) => {
      if (!this.#showing.delete(entity)) return;
      this.#changed.set(entity, null);
    };
    this.#offs = [
      world.events.on(TelegraphStarted, (e) => {
        const look: TelegraphLook = e.unblockable ? 'unblockable' : e.parryable ? 'parry' : 'block';
        this.#showing.set(e.attacker, { move: e.move, look });
        this.#changed.set(e.attacker, look);
      }),
      world.events.on(ActionPhaseChanged, (e) => {
        if (e.phase === 'active' && this.#showing.get(e.entity)?.move === e.move) stop(e.entity);
      }),
      world.events.on(AttackEnded, (e) => {
        stop(e.attacker);
      }),
    ];
  }

  /** The look `entity` telegraphs now, or null. */
  lookOf(entity: EntityId): TelegraphLook | null {
    return this.#showing.get(entity)?.look ?? null;
  }

  /**
   * Telegraphs that changed since the last call (entity → its look, null when it stopped), in the
   * order they changed; empty (and cheap) when nothing did.
   */
  drain(): [EntityId, TelegraphLook | null][] {
    if (this.#changed.size === 0) return [];
    const out = [...this.#changed];
    this.#changed.clear();
    return out;
  }

  dispose(): void {
    for (const off of this.#offs) off();
    this.#showing.clear();
    this.#changed.clear();
  }
}
