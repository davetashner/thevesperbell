// The testbed player replay (mw-e02.23 AC-4): the player walking the greybox testbed, built through
// the same wiring the game boots (the sim's Rapier physics with physics objects and the scene's
// movable props (mw-e03.39), the scene loader, setupTestbedPlayer with RapierCollisionWorld, lock-on
// over RapierSightWorld (mw-e02.16) and the bow, whose arrows fly against the same world (mw-e05.21)) and driven by ActionFrames sampled from a scripted key and mouse log by
// the real ActionSampler. Its recording (tests/integration/fixtures/testbed-player.replay.json)
// replays in tests/integration/testbed-player.test.ts on every CI run, so a change to the wiring, the
// testbed scene, the input mapping, the controller or Rapier that moves the player fails at the first
// diverging checkpoint.
//
// Not a tests/replays golden: the replay CLI runs under plain Node, which cannot load Rapier's
// non-compat WASM package (see tests/integration/character-course-rapier.test.ts), so the Rapier
// module is passed in and the recording is re-made by the integration test:
//   TESTBED_PLAYER_RECORD=1 pnpm vitest run tests/integration/testbed-player.test.ts

import { loadGameContent } from '@content/game-content';
import {
  controllerTuningFor,
  materialPresets,
  PLAYER_CAMERA_ID,
  PLAYER_CONTROLLER_ID,
  PLAYER_LOCK_ON_ID,
  type EnvironmentDamageTuning,
  type Frozen,
  type GameContent,
} from '@content/index';
import {
  installSandboxRules,
  prepareTestbedCombat,
  startTestbedCombat,
  type TestbedCombat,
  type TestbedCombatants,
} from '@game/combat/index';
import {
  prepareCreatures,
  SceneNavigation,
  startCreatureDrops,
  startCreatures,
  startSceneNoise,
  type AiWatch,
  type CreatureAi,
  type GameCreatures,
  type SceneNoise,
  watchCreatureAi,
  watchPresence,
} from '@game/creatures/index';
import { ActionSampler } from '@game/input/index';
import {
  prepareConsumables,
  prepareWorldItems,
  startConsumables,
  startWorldItems,
} from '@game/items/index';
import { hasContainers, prepareContainers, startContainers } from '@game/items/containers';
import { hasMechanisms, startMechanisms } from '@game/mechanisms/index';
import { RenderSync, type SceneBinding } from '@game/loop/index';
import { createGameLight, installGameLight, type GameLight } from '@game/light/index';
import { installGamePhysics, playerFocus } from '@game/physics-objects';
import { setupTestbedPlayer, type TransformReader } from '@game/player/index';
import { SceneLoader } from '@game/scene/index';
import {
  LineOfSight,
  physicsBodiesOf,
  DAMAGE_COMPONENTS,
  HIT_VOLUME_COMPONENTS,
  installDebugCommands,
  DAY_CLOCK_FACTS,
  PHASE_FACT,
  installSlainFacts,
  LEDGE_HANG_CAPABILITY,
  testPropSpawners,
  type EntityId,
  RapierCollisionWorld,
  RapierPhysics,
  RapierSightWorld,
  registerSceneComponents,
  World,
  zeroHealth,
  type ActionFrame,
  type RapierModule,
  type ReplayScenario,
  type LoadedScene,
  type SceneCreatures,
  type SceneMechanisms,
  type Consumables,
  type WorldItems,
} from '@sim/index';

import { actionFrameCommand } from './action-frame-command';

export { actionFrameCommand };

/** Keys held (KeyboardEvent.code) and mouse counts moved right per tick, for a stretch of ticks. */
export interface ScriptStep {
  readonly ticks: number;
  readonly keys?: readonly string[];
  readonly lookX?: number;
}

/**
 * About twelve seconds in the testbed: through the doorway, a jump, a turn, into a wall and back, then
 * a roll and a backstep (mw-e04.8), the light chain and a walk behind the raised shield (mw-e04.6).
 */
export const TESTBED_SCRIPT: readonly ScriptStep[] = [
  { ticks: 30 },
  { ticks: 90, keys: ['KeyW'] }, // across the room towards the doorway
  { ticks: 1, keys: ['KeyW', 'Space'] },
  { ticks: 45, keys: ['KeyW'] }, // a running jump
  { ticks: 60, keys: ['KeyW', 'ShiftLeft'] }, // sprint through the doorway into the corridor
  { ticks: 20, lookX: 25 }, // turn right, towards the corridor's east wall
  { ticks: 60, keys: ['KeyW'] }, // into the wall: blocked
  { ticks: 40, keys: ['KeyS', 'KeyA'] },
  { ticks: 30, keys: ['KeyC', 'KeyD'] }, // crouch-walk
  { ticks: 1, keys: ['Space'] },
  { ticks: 60 },
  { ticks: 20, lookX: -40 },
  { ticks: 90, keys: ['KeyS'] }, // back out towards the room
  { ticks: 1, keys: ['KeyW', 'KeyR'] }, // roll forward, out of the corner the walk ended in
  { ticks: 40 },
  { ticks: 1, keys: ['KeyR'] }, // no direction held: backstep
  { ticks: 40 },
  { ticks: 1, keys: ['Mouse0'] }, // the light chain (mw-e04.6): three swings…
  { ticks: 29 },
  { ticks: 1, keys: ['Mouse0'] },
  { ticks: 33 },
  { ticks: 1, keys: ['Mouse0'] },
  { ticks: 50 },
  { ticks: 40, keys: ['Mouse2', 'KeyW'] }, // …then the shield up, walking at half speed
];

/**
 * A per-tick driver that replays `script` into `sampler` just before each tick is sampled: keys go
 * down and up at the step boundaries, mouse movement arrives every tick of a step.
 */
export function scriptedInput(
  script: readonly ScriptStep[],
  sampler: ActionSampler,
): (tick: number) => void {
  const steps = script.flatMap((step) => Array.from({ length: step.ticks }, () => step));
  let held: readonly string[] = [];
  return (tick) => {
    const step = steps[tick] ?? { ticks: 1 };
    const keys = step.keys ?? [];
    for (const code of held) if (!keys.includes(code)) sampler.up(code);
    for (const code of keys) if (!held.includes(code)) sampler.down(code);
    held = keys;
    if (step.lookX !== undefined) sampler.look(step.lookX, 0);
  };
}

/** The script's length in ticks. */
export const TESTBED_TICKS = TESTBED_SCRIPT.reduce((sum, step) => sum + step.ticks, 0);

/** The ActionFrames the script samples to, one per tick. */
export function testbedLog(script: readonly ScriptStep[] = TESTBED_SCRIPT): ActionFrame[] {
  const sampler = new ActionSampler();
  const drive = scriptedInput(script, sampler);
  const ticks = script.reduce((sum, step) => sum + step.ticks, 0);
  return Array.from({ length: ticks }, (_, tick) => {
    drive(tick);
    return sampler.sample();
  });
}

const nothing = (): undefined => undefined;

/** A scene object for headless runs: render sync binds it and nothing draws it. */
const headless = (object: object, read: TransformReader): SceneBinding<object> => ({
  object,
  read,
  apply: nothing,
  dispose: nothing,
});

/** A scene with the player, headless (see `createGameWorld`). */
export interface HeadlessGame<TInput> {
  readonly world: World<TInput>;
  readonly player: EntityId;
  readonly combat: TestbedCombat;
  readonly combatants: TestbedCombatants;
  /** The world-item rules (mw-e17.7); the player has an inventory. */
  readonly items: WorldItems;
  /** The consumable rules (mw-e17.6); the player has quick slots. */
  readonly consumables: Consumables;
  /** The scene's doors and switches (mw-e03.18), or undefined in a scene without mechanisms. */
  readonly mechanisms: SceneMechanisms | undefined;
  /** The scene's containers (mw-e18.3), in scene order. */
  readonly containers: readonly EntityId[];
  /** The creatures content has, and what the scene's creature spawns spawned (mw-e12.4). */
  readonly creatures: GameCreatures;
  readonly sceneCreatures: SceneCreatures;
  /** Render sync with headless objects (nothing draws them). */
  readonly sync: RenderSync;
  /** The loaded scene. */
  readonly scene: LoadedScene;
  /** The light field (mw-e03.37), as the game installs it. */
  readonly light: GameLight;
  /** The scene's noise propagation (mw-e09.22). */
  readonly noise: SceneNoise;
  /** How AI travels: the scene's navmesh, when it has one (mw-e11.21). */
  readonly navigation: SceneNavigation;
  /** Creature perception, awareness and AI (mw-e11.23), when content has creatures. */
  readonly ai: CreatureAi | undefined;
  /** Watches the AI after each step (#app[data-ai] in the game); undefined without AI. */
  readonly aiWatch: AiWatch | undefined;
}

/** The testbed with the player, wired as src/main.ts wires it, minus the renderer. */
export function createTestbedWorld(
  rapier: RapierModule,
  options: { readonly seed: number; readonly hz: number },
): World<ActionFrame> {
  return createGameWorld<ActionFrame>(rapier, options).world;
}

/**
 * Scene `scene` (default the testbed) with the player, wired as src/main.ts wires it — debug
 * commands with the sandbox's and creatures' spawners, the combat sandbox rules, physics, the light
 * field, noise propagation (mw-e09.22), the player, combat, world items, mechanisms, containers and
 * creatures with perception and AI on the scene's navmesh (mw-e11.21, mw-e11.23) — minus the
 * renderer. The combat sandbox's and creatures' e2e-free
 * tests (tests/integration) run on it. `content` defaults to the game's; debug builds pass the dev
 * content (src/content/dev-content.ts), which has the fixture creatures.
 */
export function createGameWorld<TInput>(
  rapier: RapierModule,
  {
    seed,
    hz,
    scene: sceneId = 'testbed',
    environment,
    content = loadGameContent(),
    phase,
  }: {
    seed: number;
    hz: number;
    scene?: string;
    /** Environmental damage rules in place of content's (tests of other curves). */
    environment?: Frozen<EnvironmentDamageTuning>;
    /** Content in place of the game's (debug-build content with the fixture creatures). */
    content?: GameContent;
    /**
     * The clock phase the scene loads in (`time.phase`; mw-ju8.14): scene spawns that keep to some
     * phases of the day are there or not by it. Without it the world has no clock and they all are.
     */
    phase?: string;
  },
): HeadlessGame<TInput> {
  const physics = new RapierPhysics(rapier);
  const world = registerSceneComponents(new World<TInput>({ seed, hz, physics }));
  const prepared = prepareTestbedCombat(content);
  const combat = environment === undefined ? prepared : { ...prepared, environment };
  const creatures = prepareCreatures(content, combat);
  const props = testPropSpawners(content.all('testprop').map((prop) => prop.id));
  installDebugCommands(world, {
    spawners: new Map([...props, ...combat.spawners, ...creatures.spawners]),
    damage: combat.damage,
  });
  installSandboxRules(world, combat);
  world.register(...HIT_VOLUME_COMPONENTS, ...DAMAGE_COMPONENTS);
  const focus = playerFocus(world);
  // The light field (mw-e03.37), as src/main.ts builds it: level geometry feeds physics and the
  // field's occluders through one sink; creatures see the player by it (mw-e11.23).
  const light = createGameLight(physics);
  installGamePhysics(world, { focus: focus.read, levelColliders: light.colliders });
  installGameLight(world, light.field);
  const sync = new RenderSync(world);
  const scenes = new SceneLoader({
    world,
    sync,
    colliders: light.colliders,
    content,
    objects: { staticGeometry: () => ({}), spawn: () => ({}) },
    binding: headless,
    physics: {},
    light: light.field,
  });
  const scene = scenes.load(sceneId);
  // Noise propagation through the scene's rooms and doors (mw-e09.22).
  const noise = startSceneNoise(world, content, scene);
  const navigation = new SceneNavigation();
  navigation.load(world, content, scene);
  const collision = new RapierCollisionWorld(physics);
  const player = setupTestbedPlayer({
    world,
    scene,
    sync,
    tuning: controllerTuningFor(content.get('controller', PLAYER_CONTROLLER_ID)),
    cameraTuning: content.get('camera', PLAYER_CAMERA_ID),
    collision,
    object: {},
    binding: headless,
    camera: { position: { set: nothing }, lookAt: nothing, fov: 70, near: 0.1, aspect: 16 / 9 },
    interaction: {
      sight: new RapierSightWorld(physics),
      bodiesOf: (entity) => physicsBodiesOf(world, entity),
    },
    moves: combat.moves,
    melee: combat.melee,
    bow: combat.bow,
    // A target at zero health is defeated, as in src/main.ts (mw-e02.32: the dummy's death hands
    // the lock on).
    lockOn: {
      tuning: content.get('lock-on', PLAYER_LOCK_ON_ID),
      sight: new LineOfSight({ world: new RapierSightWorld(physics) }),
      profile: (id) => content.get('targetable', id),
      defeated: zeroHealth,
    },
    ledges: { capabilities: [LEDGE_HANG_CAPABILITY] },
    climb: {},
  }).entity;
  focus.entity = player;
  const combatants = startTestbedCombat(world, combat, scene.layout.spawns, player, collision);
  // World items (mw-e17.7): the scene's items, taken with Interact, dropped and thrown.
  const items = prepareWorldItems(content);
  startWorldItems(world, items, scene.spawns, player);
  // Consumables (mw-e17.6): the use pipeline and the player's quick slots.
  const consumables = prepareConsumables(content, items);
  startConsumables(world, consumables, player);
  // Mechanisms (mw-e03.18) in scenes that have them, as src/main.ts starts them: door leaves collide
  // in the physics port, keys come off the player's keyring (mw-e17.5) and player-filtered trigger
  // volumes count the player (mw-e01.4); closed leaves occlude the light field.
  const mechanisms = hasMechanisms(scene.layout)
    ? startMechanisms(world, scene, {
        content,
        materials: materialPresets(content.all('material')),
        colliders: physics,
        occluders: light.field.statics,
        player,
      })
    : undefined;
  // Containers (mw-e18.3) in scenes that have them, after mechanisms (which unlock a locked chest).
  const containers = hasContainers(scene.layout)
    ? startContainers(world, prepareContainers(content, items.inventory), scene, content)
    : [];
  // Creatures (mw-e12.4) with senses and AI (mw-e11.21, mw-e11.23): perception sees the player by
  // the light field over the sim's Rapier world; AI walks the scene's navmesh.
  if (phase !== undefined) {
    for (const [key, spec] of Object.entries(DAY_CLOCK_FACTS)) world.facts.declare(key, spec);
    world.facts.set(PHASE_FACT, phase);
  }
  const sceneCreatures = startCreatures(world, creatures, combat, scene.layout.spawns, {
    content,
    player,
    light: light.field,
    sight: new RapierSightWorld(physics),
    navigation,
  });
  // A placed creature's death sets its slain fact (mw-e01.7).
  installSlainFacts(world, scene.id, scene.layout.spawns);
  // A dying creature drops what it carries and rolls its loot table (mw-e01.5).
  startCreatureDrops(world, content, items, scene.id, scene.layout.spawns);
  const aiWatch = watchCreatureAi(world, sceneCreatures.ai, navigation);
  // Spawns that keep to some phases of the day come and go with the clock (mw-ju8.14).
  watchPresence(world, creatures.spawn, scene.layout.spawns);
  return {
    world,
    player,
    combat,
    combatants,
    items,
    consumables,
    mechanisms,
    containers,
    creatures,
    sceneCreatures,
    sync,
    scene,
    light,
    noise,
    navigation,
    ai: sceneCreatures.ai,
    aiWatch,
  };
}

/** The replay scenario, on the given Rapier module. */
export function testbedPlayerScenario(rapier: RapierModule): ReplayScenario<ActionFrame> {
  let log: readonly ActionFrame[] | undefined;
  return {
    name: 'testbed-player',
    usesContent: true,
    command: actionFrameCommand,
    ticks: TESTBED_TICKS,
    create: (options) => createTestbedWorld(rapier, options),
    drive: ({ tick }) => {
      log ??= testbedLog();
      const frame = log[tick];
      return frame === undefined ? [] : [frame];
    },
  };
}
