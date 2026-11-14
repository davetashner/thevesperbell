// scene (scene loader, world items, containers, the player at its start spawn, level deltas, the
// transition volumes), and a "page reload" is a fresh world booted from what the previous one wrote
// into session storage. AC-1 (the target loads, the player stands at the named spawn, the old area's
// changes persist), AC-2 (pursuers stay behind) and the walk from the first valley scene to the shop.
import * as RAPIER from '@dimforge/rapier3d-deterministic';
import {
  controllerTuningFor,
  materialPresets,
  loadGameContent,
  PLAYER_CONTROLLER_ID,
  type GameContent,
} from '@content/index';
import { gameContentSources } from '@content/game-content';
import { loadContent, type ContentSource } from '@content/loader';
import { contentChecks, contentTypes } from '@content/registry';
import {
  BrainComponent,
  InventoryComponent,
  merchantStoreOf,
  CharacterController,
  DAMAGE_COMPONENTS,
  HealthComponent,
  HIT_VOLUME_COMPONENTS,
  initialCharacterState,
  installInteraction,
  installMechanisms,
  installPlayer,
  inventoryOf,
  levelDeltasOf,
  PlayerLook,
  spawnYaw,
  RapierCollisionWorld,
  RapierSightWorld,
  RapierPhysics,
  registerPersistence,
  registerSceneComponents,
  sceneAuthoredEntities,
  installSceneTransitions,
  SKIN,
  World,
  WorldPersistence,
  worldItemSpawner,
  type Containers,
  type EntityId,
  DoorComponent,
  doorStatus,
  InMemoryColliderSink,
  installLightSources,
  lightComponents,
  type SceneMechanisms,
  type LoadedScene,
} from '@sim/index';
import { describe, expect, it } from 'vitest';
import { installFactRegistry } from '../facts';
import { hasMechanisms, startMechanisms } from '../mechanisms';
import { prepareTestbedCombat, startTestbedCombat } from '../combat';
import { prepareCreatures, startCreatures, SceneNavigation } from '../creatures';
import {
  ContainerWatch,
  hasContainers,
  prepareContainers,
  startContainers,
} from '../items/containers';
import { prepareWorldItems, startWorldItems } from '../items';
import { RenderSync } from '../loop/render-sync';
import { installGamePhysics } from '../physics-objects';
import { SceneLoader } from '../scene/scene-loader';
import { createGameSaveRegistry } from '../save/sections';
import {
  applyCarriedPlayer,
  applyCarriedWorld,
  TransitionController,
  takeTransit,
  type Transit,
  type TransitStorage,
} from './index';

const baseContent = loadGameContent();

/** The game content with `edit` applied to the scene file ending in `path`. */
function contentWith(path: string, edit: (scene: Record<string, unknown>) => void): GameContent {
  const sources: ContentSource[] = gameContentSources().map((source) => {
    if (!source.path.endsWith(path)) return source;
    const json = JSON.parse(source.text) as Record<string, unknown>;
    edit(json);
    return { ...source, text: JSON.stringify(json) };
  });
  return loadContent(contentTypes, sources, contentChecks);
}

class MemoryStorage implements TransitStorage {
  readonly items = new Map<string, string>();
  getItem(key: string): string | null {
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.items.set(key, value);
  }
  removeItem(key: string): void {
    this.items.delete(key);
  }
}

/** One booted area: what a page holds between its load and the next transition. */
interface Area {
  readonly content: GameContent;
  readonly scene: string;
  readonly world: World<never>;
  readonly loaded: LoadedScene;
  readonly player: EntityId;
  readonly chests: Map<string, EntityId>;
  readonly watch: ContainerWatch | undefined;
  readonly containers: Containers;
  readonly creatures: readonly EntityId[];
  readonly controller: TransitionController;
  /** The scene's doors, when it has mechanisms. */
  readonly mechanisms: SceneMechanisms | undefined;
  /** The search strings the page would have been reloaded with. */
  readonly navigated: string[];
  /** The transition this area was entered by, if any. */
  readonly arrivedBy: Transit | undefined;
  /** Steps the sim once, then lets the transition controller act, as the game loop does. */
  step(): void;
  /** Puts the player's feet in the middle of the transition volume `id` and steps twice. */
  enter(id: string): void;
}

/** Builds scene `scene` the way main.ts does, applying the pending hand-off in `session` if any. */
function boot(content: GameContent, session: MemoryStorage, scene: string, spawn?: string): Area {
  const physics = new RapierPhysics(RAPIER);
  const world = installGamePhysics(registerSceneComponents(new World<never>({ seed: 1, physics })));
  installFactRegistry(world.facts, content);
  world.register(...HIT_VOLUME_COMPONENTS, ...DAMAGE_COMPONENTS);
  installInteraction(world);
  const loader = new SceneLoader({
    world,
    sync: new RenderSync(world),
    colliders: physics,
    content,
    objects: { staticGeometry: () => ({}), spawn: () => ({}) },
    binding: (object, read) => ({ object, read, apply: () => undefined, dispose: () => undefined }),
    physics: {},
  });
  const loaded = loader.load(scene);
  let mechanisms: SceneMechanisms | undefined;
  if (!hasMechanisms(loaded.layout)) installMechanisms(world);
  else {
    world.register(...lightComponents);
    installLightSources(world);
    mechanisms = startMechanisms(world, loaded, {
      content,
      materials: materialPresets(content.all('material')),
      colliders: physics,
      occluders: new InMemoryColliderSink(),
    });
  }
  const handOff = takeTransit(session);
  const arrivedBy = handOff?.to === scene ? handOff : undefined;
  const registry = createGameSaveRegistry({ knownItem: (id) => content.has('item', id) });
  const carryOptions = { registry, knownItem: (id: string) => content.has('item', id) };
  if (arrivedBy !== undefined) applyCarriedWorld(world, arrivedBy.carry, carryOptions);
  const startSpawn = arrivedBy?.spawn ?? spawn;
  const collision = new RapierCollisionWorld(physics);
  const player = installPlayer(world, {
    spawns: loaded.layout.spawns,
    ...(startSpawn !== undefined && { startSpawn }),
    collision,
    tuning: controllerTuningFor(content.get('controller', PLAYER_CONTROLLER_ID)),
  });
  const combat = prepareTestbedCombat(content);
  startTestbedCombat(world, combat, loaded.layout.spawns, player, collision);
  const items = prepareWorldItems(content);
  startWorldItems(world, items, loaded.spawns, player);
  const containers = prepareContainers(content, items.inventory);
  const chests = new Map<string, EntityId>();
  let watch: ContainerWatch | undefined;
  if (hasContainers(loaded.layout)) {
    const made = startContainers(
      world,
      prepareContainers(content, items.inventory),
      loaded,
      content,
    );
    watch = new ContainerWatch(world, made);
    loaded.spawns.forEach(({ entity, spawn: placed }) => {
      if (made.includes(entity)) chests.set(placed.id, entity);
    });
  }
  const creatureTable = prepareCreatures(content, combat);
  const started = startCreatures(world, creatureTable, combat, loaded.layout.spawns, {
    content,
    player,
    light: { levelAt: () => 1 },
    sight: new RapierSightWorld(physics),
    navigation: new SceneNavigation(),
  });
  if (arrivedBy !== undefined) applyCarriedPlayer(world, player, arrivedBy.carry, carryOptions);
  registerPersistence(world);
  levelDeltasOf(world).enter(
    world,
    new WorldPersistence({ spawners: [worldItemSpawner(items)] }),
    scene,
    sceneAuthoredEntities(world, loaded),
  );
  installSceneTransitions(world, loaded.layout, player);
  const navigated: string[] = [];
  const controller = new TransitionController({
    world,
    player,
    registry,
    areaName: (id) => content.get('scene', id).name,
    session,
    now: () => 1_000,
    navigate: (search) => navigated.push(search),
    search: () => '',
    // The overlay's timer never fires here (it is tested on its own), so the parent is never used.
    overlayParent: {} as HTMLElement,
    overlay: { setTimer: () => 0, clearTimer: () => undefined },
  });
  const step = (): void => {
    world.step();
    controller.afterStep();
  };
  // One tick as booted: the transition system reads where the player stands (see transitions.ts).
  step();
  return {
    content,
    scene,
    world,
    loaded,
    player,
    chests,
    watch,
    containers,
    creatures: started.entities,
    controller,
    mechanisms,
    navigated,
    arrivedBy,
    step,
    enter(id) {
      const t = loaded.layout.transitions.find((candidate) => candidate.id === id);
      if (t === undefined) throw new Error(`${scene} has no transition ${id}`);
      const feet = {
        x: (t.min.x + t.max.x) / 2,
        y: t.min.y + 1 + SKIN,
        z: (t.min.z + t.max.z) / 2,
      };
      world.set(player, CharacterController, initialCharacterState(feet));
      step();
      step();
    },
  };
}

/** Leaves `area` by the transition `id` and boots the area the page would reload into. */
function cross(area: Area, session: MemoryStorage, id: string): Area {
  area.enter(id);
  const search = area.navigated[0];
  if (search === undefined) throw new Error(`crossing ${id} did not navigate`);
  const next = new URLSearchParams(search).get('scene');
  if (next === null) throw new Error('the search names no scene');
  return boot(area.content, session, next);
}

const feetOf = (area: Area) => area.world.get(area.player, CharacterController)?.position;

/** Where the player stands, against the spawn `id` of the area's scene. */
function expectAt(area: Area, id: string): void {
  const spawn = area.loaded.layout.spawns.find((candidate) => candidate.id === id);
  if (spawn === undefined) throw new Error(`${area.scene} has no spawn ${id}`);
  const feet = feetOf(area);
  expect(feet?.x).toBeCloseTo(spawn.position.x, 1);
  expect(feet?.z).toBeCloseTo(spawn.position.z, 1);
  const look = area.world.get(area.player, PlayerLook);
  // The look faces the way the spawn faces: yaw 0 faces +z, 180 faces -z.
  expect(look?.yaw).toBeCloseTo(spawnYaw(spawn), 5);
}

describe('area transitions (mw-e01.11)', () => {
  it('AC-1: leaving valley-01 by its north gate loads valley-02 with the player at the named spawn', () => {
    const session = new MemoryStorage();
    const first = boot(baseContent, session, 'valley-01');
    // The player starts at the start spawn, facing the way it faces.
    expectAt(first, 'player-start');
    const second = cross(first, session, 'north-gate');
    expect(second.scene).toBe('valley-02');
    expect(second.arrivedBy).toMatchObject({
      from: 'valley-01',
      to: 'valley-02',
      spawn: 'arrive-from-valley-01',
    });
    expectAt(second, 'arrive-from-valley-01');
    // The page reloaded into the target scene, and the hand-off was consumed.
    expect(first.navigated).toEqual(['scene=valley-02']);
    expect(session.items.size).toBe(0);
  });

  it('AC-1: the old area’s changes persist: a chest opened and emptied in valley-02 is still so on return', () => {
    const session = new MemoryStorage();
    let area = cross(boot(baseContent, session, 'valley-01'), session, 'north-gate');
    const chest = area.chests.get('chest-valley-02-glade-east');
    expect(chest).toBeDefined();
    if (chest === undefined) return;
    expect(area.watch?.readout()['chest-valley-02-glade-east']?.opened).toBe(false);
    expect(area.containers.open(area.world, chest, area.player).ok).toBe(true);
    expect(area.containers.takeAll(area.world, chest, area.player).ok).toBe(true);
    expect(area.watch?.readout()['chest-valley-02-glade-east']).toMatchObject({
      opened: true,
      items: [],
    });
    const taken = inventoryOf(area.world, area.player)?.items.map((item) => item.defId) ?? [];
    expect(taken).toContain('valley-chest-key');

    // On to valley-03 and back to valley-02: a fresh page each time.
    area = cross(area, session, 'north-gate');
    expect(area.scene).toBe('valley-03');
    area = cross(area, session, 'south-gate');
    expect(area.scene).toBe('valley-02');
    expectAt(area, 'arrive-from-valley-03');
    expect(area.watch?.readout()['chest-valley-02-glade-east']).toMatchObject({
      opened: true,
      items: [],
    });
    // What the player took is still the player's.
    const kept = inventoryOf(area.world, area.player)?.items.map((item) => item.defId) ?? [];
    expect(kept).toContain('valley-chest-key');
  });

  it('keeps crowns, pack, health, class, facts, merchant state and the time of day', () => {
    const session = new MemoryStorage();
    const first = boot(baseContent, session, 'valley-01');
    const { world, player } = first;
    const pack = inventoryOf(world, player);
    expect(pack).toBeDefined();
    if (pack === undefined) return;
    world.set(player, InventoryComponent, { ...pack, gold: 137 });
    const health = world.get(player, HealthComponent);
    expect(health).toBeDefined();
    world.set(player, HealthComponent, { max: 100, current: 61.5 });
    world.facts.set('time.day', 3);
    world.facts.set('time.minute', 615);
    const merchant = {
      gold: 321,
      nextId: 4,
      stock: [],
      buyback: [],
    };
    merchantStoreOf(world).restore({ 'marsh-general-store': merchant });

    const second = cross(first, session, 'north-gate');
    expect(inventoryOf(second.world, second.player)?.gold).toBe(137);
    expect(second.world.get(second.player, HealthComponent)).toEqual({ max: 100, current: 61.5 });
    expect(second.world.facts.get('time.day')).toBe(3);
    expect(second.world.facts.get('time.minute')).toBe(615);
    expect(merchantStoreOf(second.world).capture()).toEqual({ 'marsh-general-store': merchant });
  });

  it('AC-2: a creature in Combat does not follow, and is not in Combat when the player returns', () => {
    const content = contentWith('scene/valley-01.json', (scene) => {
      (scene['spawns'] as unknown[]).push({
        id: 'miner',
        at: [6, 0, 40],
        creature: 'forgotten-miner',
        tags: ['test'],
      });
    });
    // valley-01 already has its own skeletons (mw-ju8.21); the test adds one more and drives that one.
    const placed =
      baseContent.get('scene', 'valley-01').spawns.filter((s) => s.creature !== undefined).length +
      1;
    const session = new MemoryStorage();
    const first = boot(content, session, 'valley-01');
    expect(first.creatures).toHaveLength(placed);
    const miner = first.creatures.at(-1) ?? -1;
    const brain = first.world.get(miner, BrainComponent);
    expect(brain?.state).not.toBe('combat');
    if (brain === undefined) return;
    first.world.set(miner, BrainComponent, { ...brain, state: 'combat' });

    const second = cross(first, session, 'north-gate');
    // Nothing of the creature crossed: not in the world, not in what was carried.
    // Only valley-02's own skeletons are there, all unaware: none came over in Combat.
    const own = baseContent
      .get('scene', 'valley-02')
      .spawns.filter((s) => s.creature !== undefined);
    expect(second.world.query(BrainComponent).ids()).toHaveLength(own.length);
    for (const id of second.world.query(BrainComponent).ids()) {
      expect(second.world.get(id, BrainComponent)?.state).toBe('unaware');
    }
    expect(second.arrivedBy?.carry).toBeDefined();
    expect(JSON.stringify(second.arrivedBy?.carry)).not.toContain('forgotten-miner');
    expect(JSON.stringify(second.arrivedBy?.carry)).not.toContain('ai.brain');

    // Back in valley-01 the creature is where the scene put it and has stood down.
    const back = cross(second, session, 'south-gate');
    expect(back.scene).toBe('valley-01');
    expectAt(back, 'arrive-from-valley-02');
    expect(back.creatures).toHaveLength(placed);
    for (const id of back.creatures) {
      expect(back.world.get(id, BrainComponent)?.state).toBe('unaware');
    }
  });

  it('walks the whole chain from valley-01 to Marsh’s store and back', () => {
    const session = new MemoryStorage();
    const route = [
      ['valley-01', 'north-gate', 'valley-02', 'arrive-from-valley-01'],
      ['valley-02', 'north-gate', 'valley-03', 'arrive-from-valley-02'],
      ['valley-03', 'bridge-gate', 'briar-glen-lane', 'arrive-from-valley-03'],
      ['briar-glen-lane', 'marsh-store-door', 'marsh-store', 'arrive-from-briar-glen-lane'],
      ['marsh-store', 'street-exit', 'briar-glen-lane', 'arrive-from-marsh-store'],
      ['briar-glen-lane', 'bridge-gate', 'valley-03', 'arrive-from-briar-glen-lane'],
      ['valley-03', 'south-gate', 'valley-02', 'arrive-from-valley-03'],
      ['valley-02', 'south-gate', 'valley-01', 'arrive-from-valley-02'],
    ] as const;
    let area = boot(baseContent, session, 'valley-01');
    for (const [from, gate, to, spawn] of route) {
      expect(area.scene).toBe(from);
      area = cross(area, session, gate);
      expect(area.scene).toBe(to);
      expect(area.arrivedBy?.spawn).toBe(spawn);
      expectAt(area, spawn);
    }
    expect(area.scene).toBe('valley-01');
  });

  it('mw-e24.21 AC-1: crossing the mountain road past the slice vestibule loads valley-01 at arrive-from-slice', () => {
    const session = new MemoryStorage();
    const slice = boot(baseContent, session, 'slice');
    // slice.complete is true once the vestibule is entered; it is carried across the hand-off.
    slice.world.facts.set('slice.complete', true);
    const valley = cross(slice, session, 'mountain-road');
    expect(valley.scene).toBe('valley-01');
    expect(slice.navigated).toEqual(['scene=valley-01']);
    expect(valley.arrivedBy).toMatchObject({
      from: 'slice',
      to: 'valley-01',
      spawn: 'arrive-from-slice',
    });
    expectAt(valley, 'arrive-from-slice');
    expect(valley.world.facts.get('slice.complete')).toBe(true);
  });

  it('mw-e24.21 AC-2: valley-01’s south gate returns to the vestibule passage, and the slice’s door and chest stay as left', () => {
    const session = new MemoryStorage();
    const slice = boot(baseContent, session, 'slice');
    const doorEntity = slice.mechanisms?.doors[1];
    expect(doorEntity).toBeDefined();
    if (doorEntity === undefined) return;
    // The exit door is opened (as the key does), and the alcove chest looted.
    const door = slice.world.get(doorEntity, DoorComponent);
    if (door === undefined) throw new Error('the exit door has no door component');
    slice.world.set(doorEntity, DoorComponent, { ...door, openness: 1, target: 1 });
    const chest = slice.chests.get('alcove-chest');
    expect(chest).toBeDefined();
    if (chest === undefined) return;
    expect(slice.containers.open(slice.world, chest, slice.player).ok).toBe(true);
    expect(slice.containers.takeAll(slice.world, chest, slice.player).ok).toBe(true);
    slice.world.facts.set('slice.complete', true);

    const valley = cross(slice, session, 'mountain-road');
    expect(valley.scene).toBe('valley-01');
    const back = cross(valley, session, 'south-gate');
    expect(back.scene).toBe('slice');
    expect(back.arrivedBy).toMatchObject({ from: 'valley-01', spawn: 'arrive-from-valley-01' });
    expectAt(back, 'arrive-from-valley-01');
    // Arriving is not crossing: the player stands in the passage, clear of the road's volume.
    back.step();
    expect(back.navigated).toEqual([]);

    expect(back.world.facts.get('slice.complete')).toBe(true);
    const doorBack = back.mechanisms?.doors[1];
    expect(doorBack === undefined ? undefined : doorStatus(back.world, doorBack)).toBe('open');
    expect(back.watch?.readout()['alcove-chest']).toMatchObject({ opened: true, items: [] });
  });

  it('a player who arrives must step out and back in to leave again: an arrival is not a crossing', () => {
    const session = new MemoryStorage();
    const second = cross(boot(baseContent, session, 'valley-01'), session, 'north-gate');
    second.step();
    second.step();
    expect(second.navigated).toEqual([]);
    expect(second.controller.leaving).toBe(false);
  });

  it('the Sleeping Ox’s street exit leads to the lane’s arrival spawn for it', () => {
    const session = new MemoryStorage();
    const lane = cross(boot(baseContent, session, 'sleeping-ox'), session, 'street-exit');
    expect(lane.scene).toBe('briar-glen-lane');
    expectAt(lane, 'arrive-from-sleeping-ox');
  });

  it('AC-5 (in-process stand-in for the leak harness, mw-e32.12): 50 round trips grow nothing', () => {
    const session = new MemoryStorage();
    let area = boot(baseContent, session, 'valley-01');
    const sizes: number[] = [];
    for (let trip = 0; trip < 50; trip += 1) {
      area = cross(area, session, 'north-gate');
      area = cross(area, session, 'south-gate');
      expect(session.items.size).toBe(0);
      expect(area.scene).toBe('valley-01');
      expect(levelDeltasOf(area.world).levels()).toEqual(['valley-02']);
      sizes.push(JSON.stringify(area.arrivedBy?.carry).length);
    }
    // What is carried is the same size on the 50th trip as on the 2nd: nothing accumulates.
    expect(sizes[49]).toBe(sizes[1]);
  });
});
