// Knight combat in the greybox testbed (mw-e04.6): the wiring src/main.ts and the headless testbed
// world share, so the game and its replay run the same combat. In two halves, because the order of
// systems matters:
//
// 1. `prepareTestbedCombat` (before the player is installed): the knight's moves (with the combat
//    sandbox's attacker variants, mw-e04.9), socket tracks and wood shield from content, its heavy
//    attack on ability 1 (held, it charges: mw-e04.13), its shield bash on attack while blocking
//    (mw-e04.14; with no shield it kicks instead), the damage
//    model with the shield rule in its guard stage, and the sandbox tuning. Its `moves` and `melee` go
//    to setupTestbedPlayer, its `spawners` to the debug commands.
// 1b. `installSandboxRules` (with the debug commands, before the player): the combat sandbox's
//    commands, attacker metronomes and infinite-health refills, which must run before the player's
//    action timeline so a metronome swing starts on its beat.
// 2. `startTestbedCombat` (after the player): the hit-volume system — after the player's action
//    timeline, so a swing sweeps on the tick its active phase starts, and honouring dodge and
//    wake-up i-frames (invulnerabilityRule, mw-e04.28) — the melee strikes, hit-stop (mw-e04.11: the
//    hit-stop table's freeze of attacker and victim on every hit), parry and riposte (mw-e04.12: the
//    knight's parry button, Parried stuns, counter-hits, the riposte's critical), hit reactions (mw-e04.7: stagger, knockback, the guard
//    break's stagger, mw-e04.31) with pushes through the controller and physics, the player as a
//    combatant that can be struck and react, a training dummy at every spawn tagged
//    `training-dummy`, and the combat sandbox's dummies at spawns tagged `sandbox-dummy` /
//    `sandbox-attacker`. With lock-on installed (by setupTestbedPlayer, before this), every dummy —
//    the scene's and any the console spawns later — is a lock-on target (mw-e02.32).
//    In a world with physics objects and stimuli (src/main.ts and the replay world, via
//    installGamePhysics) the world is a weapon too (mw-e04.34): every character's placement follows
//    its controller with its capsule as the sphere stimuli reach, force stimuli push characters
//    through the impulse API, the player is pushable with its launch.mass, and the environmental
//    damage rules (falls, wall strikes, crushing objects, burning hazards, from `environment-damage`
//    content) resolve through the same damage model as every blow. And the arrow system
//    (mw-e05.21): arrows the player's bow looses fly against the level (the collision world given)
//    and every hurtbox, honouring the same i-frames, and resolve hits through the same damage model.
//
// Wall recoil (mw-e04.15): right after the hit-volume system, the player's horizontal medium and long
// swings that meet the level (the collision world given) in the first half of their window, before
// any creature, end in a 30-tick recoil and a WallRecoil event.
//
// The player's bow (mw-e05.21): `bow` goes to setupTestbedPlayer with the shortbow and a testbed
// quiver (TESTBED_QUIVER), put away at the start so the attack button still swings the sword. Its
// buttons (TESTBED_BOW_BUTTONS) keep clear of the knight's parry on ability 3.
//
// The caller registers the hit-volume, damage and placement components (src/main.ts does at world
// creation; installGamePhysics registers placement).

import {
  ARCHER_BOW_ID,
  COMBAT_SANDBOX_ID,
  compileBow,
  compileHitStop,
  compileMoves,
  compileReachClasses,
  compileSandbox,
  compileShield,
  compileSocketTracks,
  DEFAULT_ENVIRONMENT_DAMAGE_ID,
  HIT_STOP_ID,
  KNIGHT_SHIELD_ID,
  PLAYER_CONTROLLER_ID,
  REACH_CLASS_TABLE_ID,
  TRAINING_DUMMY_TARGETABLE_ID,
  type ControllerTuning,
  type EnvironmentDamageTuning,
  type Frozen,
  type GameContent,
  type HitStopTable,
  type MoveTable,
  type ReachTable,
  materialPresets,
} from '@content/index';
import {
  ACTION_TIMELINE_COMPONENTS,
  ArrowComponent,
  arrowLookup,
  bowLookup,
  CharacterController,
  CombatFacingComponent,
  DamageModel,
  DEFAULT_REACTION_PROFILE,
  giveCombatant,
  giveHitReactions,
  giveHurtboxes,
  HealthComponent,
  HitReactionComponent,
  HitStopComponent,
  hitVolumeSystem,
  hurtboxFacing,
  invulnerabilityRule,
  installCharacterStimuli,
  installCombatSandbox,
  installEnvironmentDamage,
  installHitReactions,
  installKick,
  installArrows,
  installArrowRetrieval,
  installHitStop,
  installMeleeStrikes,
  installParry,
  CreatureComponent,
  KNIGHT_HEAVY_ATTACK,
  KNIGHT_KICK,
  KNIGHT_PARRY,
  KNIGHT_RIPOSTE,
  KNIGHT_SHIELD_BASH,
  makePushable,
  MELEE_COMPONENTS,
  type MaterialPresets,
  noAllies,
  playerViewRule,
  PhysicsObjectComponent,
  PlacementComponent,
  pushCharacter,
  pushPhysicsObject,
  sandboxSpawners,
  shieldGuard,
  spawnSceneDummies,
  StaminaComponent,
  withAttackerVariants,
  type BowButtons,
  type CollisionWorld,
  type CombatSandboxOptions,
  type ComponentType,
  type DummyLockProfile,
  type EntityId,
  type FacingReader,
  type PlayerBowOptions,
  type PlayerMeleeOptions,
  type Pusher,
  type QuiverSlot,
  type SceneSpawnPlacement,
  type SocketTrackLookup,
  type Spawner,
  type World,
  wallRecoilSystem,
} from '@sim/index';
import { spawnTrainingDummy, trainingDummySpawns } from './training-dummy';

/**
 * The testbed's bow buttons: fire on the primary attack (left click, RB/R1), take out and put away
 * on ability 4 (4, D-pad Left), cycle arrows on ability 2 (2, D-pad Right) — not the sim's default
 * ability 3, which is the knight's parry (docs/design/controls.md). Until class kits bind them
 * (mw-e02.3).
 */
export const TESTBED_BOW_BUTTONS: BowButtons = Object.freeze({
  fire: 'primaryAttack',
  cycle: 'ability2',
  toggle: 'ability4',
});

/** The testbed player's quiver, in cycle order: plain, broadhead and blunt arrows. */
export const TESTBED_QUIVER: readonly QuiverSlot[] = Object.freeze([
  Object.freeze({ arrow: 'standard', count: 20 }),
  Object.freeze({ arrow: 'broadhead', count: 10 }),
  Object.freeze({ arrow: 'blunt', count: 10 }),
]);

/** How the camera narrows while the bow is drawn (the bow's `aim`, presentation). */
export interface BowAimView {
  /** Vertical field of view at full aim, degrees. */
  readonly fov: number;
  /** Seconds to ease about two thirds of the way in (and back out). */
  readonly time: number;
}

/** The player's bow: the sim's options plus the aim camera's. */
export interface TestbedBow extends PlayerBowOptions {
  readonly aim: BowAimView;
}

/** The first half of the testbed's combat wiring. */
export interface TestbedCombat {
  /** Every move in content plus the attacker variants (the action timeline's table). */
  readonly moves: MoveTable;
  readonly tracks: SocketTrackLookup;
  /** The knight's sword and shield, for setupTestbedPlayer. */
  readonly melee: PlayerMeleeOptions;
  /** The damage model every hit resolves through (the shield rule registered). */
  readonly damage: DamageModel;
  /** Hit-stop ticks per hit tier (mw-e04.11). */
  readonly hitStop: HitStopTable;
  /** Reach class metres and the wall recoil rule (mw-e04.15). */
  readonly reach: ReachTable;
  /** The combat sandbox's tuning and move table (mw-e04.9). */
  readonly sandbox: CombatSandboxOptions;
  /** The debug console's spawners for the sandbox's dummies (`dummy`, `attacker-dummy`). */
  readonly spawners: ReadonlyMap<string, Spawner>;
  /** Every dummy's lock-on profile (content `targetable` `training-dummy`, mw-e02.32). */
  readonly targetable: DummyLockProfile;
  /** The characters' controller tuning (the player's): capsule and launch.mass (mw-e04.34). */
  readonly character: Frozen<ControllerTuning>;
  /** The environmental damage rules (mw-e04.34). */
  readonly environment: Frozen<EnvironmentDamageTuning>;
  /** The player's shortbow and quiver (mw-e05.21), for setupTestbedPlayer. */
  readonly bow: TestbedBow;
  /** Each creature's size class, by creature id (the kick knocks back small ones, mw-e04.18). */
  readonly creatureSizes: ReadonlyMap<string, string>;
  /** Material presets, which make an arrow at rest a wooden thing that can burn (mw-e05.7). */
  readonly materials: MaterialPresets;
}

/** Compiles the knight's combat from `content` (see the file header, step 1). */
export function prepareTestbedCombat(content: GameContent): TestbedCombat {
  const damage = new DamageModel();
  damage.register(shieldGuard());
  const moves = withAttackerVariants(compileMoves(content.all('move')));
  const targetable = content.get('targetable', TRAINING_DUMMY_TARGETABLE_ID);
  const shortbow = content.get('bow', ARCHER_BOW_ID);
  const sandbox = {
    tuning: compileSandbox(content.get('sandbox', COMBAT_SANDBOX_ID)),
    moves,
    targetable,
  };
  return {
    moves,
    tracks: compileSocketTracks(content.all('socket-track')),
    melee: {
      shield: compileShield(content.get('shield', KNIGHT_SHIELD_ID)),
      heavyAttack: KNIGHT_HEAVY_ATTACK,
      parry: KNIGHT_PARRY,
      riposte: KNIGHT_RIPOSTE,
      bash: KNIGHT_SHIELD_BASH,
      bashFallback: KNIGHT_KICK,
      kick: KNIGHT_KICK,
    },
    damage,
    hitStop: compileHitStop(content.get('hit-stop', HIT_STOP_ID)),
    reach: compileReachClasses(content.get('reach-class', REACH_CLASS_TABLE_ID)),
    sandbox,
    spawners: sandboxSpawners(sandbox),
    targetable,
    character: content.get('controller', PLAYER_CONTROLLER_ID),
    environment: content.get('environment-damage', DEFAULT_ENVIRONMENT_DAMAGE_ID),
    creatureSizes: new Map(content.all('creature').map((c) => [c.id, c.stats.size])),
    materials: materialPresets(content.all('material')),
    bow: {
      bows: bowLookup(content.all('bow').map(compileBow)),
      arrows: arrowLookup(content.all('arrow')),
      loadout: { bow: shortbow.id, quiver: TESTBED_QUIVER },
      buttons: TESTBED_BOW_BUTTONS,
      aim: { fov: shortbow.aim.fov, time: shortbow.aim.time },
    },
  };
}

/** The combat sandbox's rules (see the file header, step 1b). Once per world. */
export function installSandboxRules<TInput>(world: World<TInput>, combat: TestbedCombat): void {
  installCombatSandbox(world, combat.sandbox);
}

/**
 * The player's hurtbox (mw-e04.31): one torso capsule the height of the knight's capsule, feet at
 * the origin. Geometry, not tuning; region hurtboxes arrive with the knight's rig.
 */
export const PLAYER_HURTBOX = Object.freeze({ bottom: 0.3, top: 1.5, radius: 0.35 });

/**
 * A fighter's facing for hit reactions: its body facing (melee), else its hurtbox frame's.
 * startTestbedCombat registers the melee components, so the facing is always readable.
 */
const bodyFacing: FacingReader = (world, entity) =>
  world.get(entity, CombatFacingComponent)?.facing ?? hurtboxFacing(world, entity);

/** Registers whichever of `types` `world` does not have yet (a scene without a player). */
function ensureRegistered<TInput>(world: World<TInput>, types: readonly ComponentType<unknown>[]) {
  for (const type of types) if (!world.isRegistered(type)) world.register(type);
}

/** Makes the player a combatant that can be struck and reacts to hits (mw-e04.31). */
function arm<TInput>(world: World<TInput>, combat: TestbedCombat, player: EntityId): void {
  const w: World<never> = world;
  if (w.has(player, HealthComponent)) return; // another rule made it a combatant already
  const { health, poise } = combat.sandbox.tuning.player;
  giveCombatant(w, player, { health, poise, player: true });
  const { bottom, top, radius } = PLAYER_HURTBOX;
  giveHurtboxes(w, player, {
    boxes: [
      {
        id: 'torso',
        socket: 'root',
        region: 'torso',
        armored: false,
        multiplier: 1,
        shape: {
          kind: 'capsule',
          from: { x: 0, y: bottom, z: 0 },
          to: { x: 0, y: top, z: 0 },
          radius,
        },
      },
    ],
  });
  giveHitReactions(w, player, DEFAULT_REACTION_PROFILE);
}

/**
 * The world as a weapon (see the file header, step 2), when `world` has physics objects (and so
 * stimuli, which installPhysicsObjects needs first); otherwise nothing (a bare combat world has
 * nothing to push or fall on).
 */
function installWorldHarm<TInput>(
  world: World<TInput>,
  combat: TestbedCombat,
  player: EntityId | undefined,
): void {
  if (!world.isRegistered(PhysicsObjectComponent)) return;
  ensureRegistered(world, [CharacterController]);
  const { character } = combat;
  installCharacterStimuli(world, character);
  installEnvironmentDamage(world, {
    damage: combat.damage,
    tuning: combat.environment,
    capsule: character.capsule,
  });
  if (player !== undefined) makePushable(world, player, character);
}

/** What `startTestbedCombat` spawned. */
export interface TestbedCombatants {
  /** The testbed's training dummies (spawns tagged `training-dummy`), in spawn order. */
  readonly dummies: readonly EntityId[];
  /** The combat sandbox's dummies (spawns tagged `sandbox-dummy` / `sandbox-attacker`). */
  readonly sandboxDummies: readonly EntityId[];
}

/**
 * Adds the hit-volume system, the melee strikes, hit reactions and arrows to `world`, arms `player`
 * (when given) and spawns the scene's dummies (see the file header, step 2). Arrows hit the level in
 * `collision` (RapierCollisionWorld in the game); without it they meet only hurtboxes. Call
 * `installSandboxRules` first.
 */
export function startTestbedCombat<TInput>(
  world: World<TInput>,
  combat: TestbedCombat,
  spawns: readonly SceneSpawnPlacement[],
  player?: EntityId,
  collision?: CollisionWorld,
): TestbedCombatants {
  // A scene without a player has no timeline, stamina or melee yet; console-spawned dummies need them.
  ensureRegistered(world, [...ACTION_TIMELINE_COMPONENTS, ...MELEE_COMPONENTS, StaminaComponent]);
  ensureRegistered(world, [PlacementComponent, HitReactionComponent, HitStopComponent]);
  ensureRegistered(world, [CreatureComponent]);
  world.addSystem(
    hitVolumeSystem({ isAlly: noAllies, invulnerable: invulnerabilityRule(combat.moves) }),
  );
  // The player's horizontal medium and long swings clang off the level (mw-e04.15); without a level
  // to probe, or without a player, nothing recoils.
  if (collision !== undefined && player !== undefined) {
    world.addSystem(
      wallRecoilSystem({
        moves: combat.moves,
        reach: combat.reach,
        collision,
        recoils: (_, entity) => entity === player,
      }),
    );
  }
  installMeleeStrikes(world, combat);
  installHitStop(world, { moves: combat.moves, table: combat.hitStop });
  installParry(world, {
    moves: combat.moves,
    damage: combat.damage,
    hitStop: combat.hitStop,
    riposte: KNIGHT_RIPOSTE,
  });
  const pushers: Pusher[] = [];
  if (world.isRegistered(CharacterController)) pushers.push(pushCharacter);
  if (world.isRegistered(PhysicsObjectComponent)) pushers.push(pushPhysicsObject);
  const reactions = { moves: combat.moves, damage: combat.damage, pushers, facing: bodyFacing };
  installHitReactions(world, reactions);
  installKick(world, {
    moves: combat.moves,
    tracks: combat.tracks,
    damage: combat.damage,
    reactions,
    move: KNIGHT_KICK,
    sizeOf: (w, entity) =>
      combat.creatureSizes.get(w.get(entity, CreatureComponent)?.origin.creature ?? ''),
  });
  if (!world.isRegistered(ArrowComponent)) {
    installArrows(world, {
      arrows: combat.bow.arrows,
      damage: combat.damage,
      invulnerable: invulnerabilityRule(combat.moves),
      ...(collision !== undefined && { collision }),
    });
    // Arrows stay where they land and can be taken back (mw-e05.7). What counts as in view for the
    // 64-arrow cap is read from the player's position and look, never from the camera (view.ts).
    installArrowRetrieval(world, {
      arrows: combat.bow.arrows,
      inView: playerViewRule(),
      materials: combat.materials,
      ...(collision !== undefined && { collision }),
    });
  }
  if (player !== undefined) arm(world, combat, player);
  installWorldHarm(world, combat, player);
  return {
    dummies: trainingDummySpawns(spawns).map((spawn) =>
      spawnTrainingDummy(world, spawn, combat.targetable),
    ),
    sandboxDummies: spawnSceneDummies(world, spawns, combat.sandbox),
  };
}
