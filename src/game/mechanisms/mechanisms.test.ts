// Mechanisms glue (mw-e03.18): the grey-box mechanism room loaded headless from the game's content.
import { describe, expect, it } from 'vitest';
import { loadGameContent, materialPresets } from '@content/index';
import {
  INTERACTION_COMPONENTS,
  InMemoryColliderSink,
  installSignals,
  installStimuli,
  loadScene,
  registerSceneComponents,
  registerWorldProperties,
  hasTag,
  SceneSpawnComponent,
  signalSystem,
  stimulusSystem,
  useSwitch,
  World,
  type EntityId,
  type KitLookup,
  lightComponents,
} from '@sim/index';
import {
  doorLeafLooks,
  doorProfiles,
  hasMechanisms,
  lockSpecs,
  MechanismWatch,
  PLAYER_TAG,
  plateOptions,
  readDoorLeaf,
  sceneCheckpoints,
  startMechanisms,
} from './index';

const content = loadGameContent();
const kit: KitLookup = (id) => (content.has('kit', id) ? content.get('kit', id) : undefined);

function room(
  preSignals = false,
  sceneId = 'mechanism-room',
  player?: (world: World<never>) => EntityId,
) {
  const world = installStimuli(
    registerWorldProperties(registerSceneComponents(new World<never>({ seed: 9 }))),
  );
  world.register(...INTERACTION_COMPONENTS, ...lightComponents);
  world.addSystem(stimulusSystem());
  if (preSignals) {
    installSignals(world);
    world.addSystem(signalSystem());
  }
  const colliders = new InMemoryColliderSink();
  const occluders = new InMemoryColliderSink();
  const loaded = loadScene(world, content.get('scene', sceneId), kit, colliders);
  const hero = player?.(world);
  const made = startMechanisms(world, loaded, {
    content,
    materials: materialPresets(content.all('material')),
    colliders,
    occluders,
    player: hero,
  });
  const spawn = (id: string): EntityId => {
    const found = loaded.spawns.find((s) => s.spawn.id === id);
    if (found === undefined) throw new Error(`no spawn ${id}`);
    return found.entity;
  };
  return { world, loaded, made, spawn, occluders, hero };
}

describe('mechanisms in the game (mw-e03.18)', () => {
  it('turns content doors and locks into sim lookups', () => {
    expect(doorProfiles(content)('portcullis')).toMatchObject({
      kind: 'portcullis',
      size: { x: 1.2, y: 2.2, z: 0.1 },
      manual: false,
      crush: 2000,
    });
    expect(doorProfiles(content)('no-such-door')).toBeUndefined();
    expect(lockSpecs(content)('slice-exit')).toEqual({
      id: 'slice-exit',
      tier: 2,
      pickTier: 2,
      sealed: false,
      tags: [],
      hint: 'Locked.',
    });
    expect(lockSpecs(content)('no-such-lock')).toBeUndefined();
  });

  it('knows which scenes have mechanisms', () => {
    const { loaded } = room();
    expect(hasMechanisms(loaded.layout)).toBe(true);
    const testbed = loadScene(
      registerSceneComponents(new World<never>({ seed: 1 })),
      content.get('scene', 'weak-wall-room'),
      kit,
      new InMemoryColliderSink(),
    );
    expect(hasMechanisms(testbed.layout)).toBe(false);
    expect(
      hasMechanisms({
        ...testbed.layout,
        signals: [{ graph: 'mechanism-room', bindings: {}, checkpoints: [] }],
      }),
    ).toBe(true);
    // A locked chest (mw-e18.3) needs mechanisms to unlock it; an unlocked one does not.
    const spawn = (container: object) => ({ ...testbed.layout.spawns[0], container }) as never;
    const chest = (lock?: string) => ({
      ...testbed.layout,
      spawns: [spawn({ contents: [], ...(lock !== undefined && { lock }) })],
    });
    expect(hasMechanisms(chest('testbed-closet'))).toBe(true);
    expect(hasMechanisms(chest())).toBe(false);
  });

  it('starts the room: doors of every kind, its switches, and the lever raises the portcullis', () => {
    const { world, made, spawn, occluders } = room();
    expect(made.doors).toHaveLength(5);
    expect(made.switches).toHaveLength(3);
    const watch = new MechanismWatch(world, made);
    expect(watch.readout()).toEqual({
      doors: {
        'north-gate': { status: 'closed', openness: 0 },
        'west-door': { status: 'closed', openness: 0 },
        'south-door': { status: 'locked', openness: 0 },
        'east-door': { status: 'closed', openness: 0 },
        trapdoor: { status: 'closed', openness: 0 },
      },
      switches: { 'north-lever': 0, 'east-button': 0, 'floor-crank': 0 },
    });
    world.step();
    // Closed doors that shut out light occlude it; the grille does not.
    expect(occluders.count()).toBe(4);
    useSwitch(world, spawn('north-lever'));
    for (let i = 0; i < 125; i++) world.step();
    expect(watch.readout().doors['north-gate']).toEqual({ status: 'open', openness: 1 });
    expect(watch.broken(spawn('north-gate'))).toBe(false);
  });

  it('describes each leaf for drawing and follows its pose', () => {
    const { world, made, spawn } = room(true);
    const looks = doorLeafLooks(world, made, content);
    expect(looks.map((l) => l.material)).toEqual(['iron', 'wood', 'iron', 'stone', 'wood']);
    expect(looks[0]).toMatchObject({
      size: { x: 1.2, y: 2.2, z: 0.1 },
      centre: { x: 0, y: 1.1, z: 0 },
    });
    const gate = spawn('north-gate');
    expect(readDoorLeaf(world, gate)?.position).toEqual({ x: 0, y: 0, z: 5 });
    expect(readDoorLeaf(world, spawn('player-start'))).toBeUndefined();
    // A door that is gone is left out of both.
    world.destroy(gate);
    expect(doorLeafLooks(world, made, content)).toHaveLength(4);
    expect(Object.keys(new MechanismWatch(world, made).readout().doors)).not.toContain(
      'north-gate',
    );
    // Unknown profiles draw as generic; unnamed entities report by id.
    const odd = world.spawn();
    expect(
      doorLeafLooks(
        world,
        {
          doors: [spawn('west-door')],
          switches: [],
          plates: [],
          impactSwitches: [],
          ropes: [],
          lights: [],
          receivers: [],
          graphs: [],
        },
        {
          ...content,
          has: () => false,
          all: content.all.bind(content),
          get: content.get.bind(content),
        },
      )[0]?.material,
    ).toBe('generic');
    world.remove(spawn('east-button'), SceneSpawnComponent);
    const watch = new MechanismWatch(world, {
      doors: [],
      switches: [spawn('east-button'), odd],
      plates: [],
      impactSwitches: [],
      ropes: [],
      lights: [],
      receivers: [],
      graphs: [],
    });
    expect(watch.readout().switches).toEqual({ [String(spawn('east-button'))]: 0 });
  });
});

describe('slice triggers in the game (mw-e01.4)', () => {
  it('tags the player for player-filtered volumes in scenes that place signal graphs', () => {
    const slice = room(false, 'slice', (world) => world.spawn());
    expect(slice.hero).toBeDefined();
    expect(hasTag(slice.world, slice.hero ?? 0, PLAYER_TAG)).toBe(true);
    // Without a player, or in a scene with no graphs, nothing is tagged.
    expect(room(false, 'slice').made.graphs).toHaveLength(1);
    const testbed = room(false, 'testbed', (world) => world.spawn());
    expect(testbed.made.graphs).toHaveLength(0);
    expect(hasTag(testbed.world, testbed.hero ?? 0, PLAYER_TAG)).toBe(false);
  });

  it('knows which volume crossings are the scene’s checkpoints', () => {
    const { loaded } = room(false, 'slice');
    const isCheckpoint = sceneCheckpoints(loaded.layout);
    const crossing = (graphId: string, node: string) => ({
      graph: 1,
      graphId,
      node,
      entity: 2,
      tick: 0,
    });
    expect(isCheckpoint(crossing('slice', 'cp-1'))).toBe(true);
    expect(isCheckpoint(crossing('slice', 'cp-2'))).toBe(true);
    expect(isCheckpoint(crossing('slice', 'slice-complete'))).toBe(false);
    expect(isCheckpoint(crossing('other', 'cp-1'))).toBe(false);
    expect(sceneCheckpoints(room().loaded.layout)(crossing('mechanism-room', 'cp-1'))).toBe(false);
  });
});

describe('plate options (mw-e03.19)', () => {
  it('reads worn weight from equipment (0 without) and gravity from remote holds (1 without)', () => {
    const world = registerWorldProperties(new World<never>({ seed: 1 }));
    const actor = world.spawn();
    const options = plateOptions(content);
    expect(options.gear?.(world, actor)).toBe(0);
    expect(options.gravityScale?.(world, actor)).toBe(1);
  });
});
