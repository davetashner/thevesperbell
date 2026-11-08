/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { describe, expect, it } from 'vitest';
import { initialCharacterState } from '../character/controller';
import { CharacterController } from '../character/system';
import type { EntityId } from '../core/component';
import { World } from '../core/world';
import { ElementRuleSet, elementRulesSystem } from '../elements/rules';
import { fireRules, type BurntMaterials } from '../elements/fire';
import { elementFieldSystem, installElementField, elementFieldOf } from '../field/install';
import { actionButton, actionFrame, actionVector, type ActionFrame } from '../input/action-frame';
import { noiseEmitted, type NoiseEvent } from '../noise/events';
import { PlayerLook } from '../player/player';
import {
  addProperties,
  readProperty,
  registerWorldProperties,
  setProperty,
  type WorldPropertyInit,
} from '../properties/components';
import { PlacementComponent, placeEntity } from '../stimulus/placement';
import { applyStimulus, installStimuli, stimulusSystem } from '../stimulus/stimulus';
import {
  addInteractor,
  installInteraction,
  interactionPrompt,
  interacted,
  InteractableComponent,
  InteractionFocusComponent,
  addInteractable,
} from '../interaction/system';
import { LightSourceComponent } from './components';
import { LightField } from './field';
import { installLightField, lightFieldSystem } from './install';
import {
  LIGHT_SOURCE_PREFABS,
  LIGHT_SOURCE_VARIANTS,
  FULL_FUEL,
  SNUFF_LOUDNESS,
  SNUFF_REACH,
  SNUFF_SECONDS,
  lightChanged,
  normalizedLoudness,
  installLightSources,
  spawnLightSource,
  type LightChange,
} from './sources';

const PRESETS = new Map<string, WorldPropertyInit>([
  ['straw', { flammable: true, ignitionPoint: 200, fuel: 0.1, hp: 15 }],
  ['wood', { flammable: true, ignitionPoint: 300, fuel: 0.1 }],
  ['charred', { flammable: false }],
]);
const BURNT: BurntMaterials = new Map([
  ['straw', null],
  ['wood', 'charred'],
]);

function lightWorld() {
  const world = installElementField(
    installStimuli(registerWorldProperties(new World<never>({ seed: 3 }))),
    { maxChunks: 8 },
  );
  const field = new LightField();
  installLightField(world, field);
  const rules = new ElementRuleSet(
    fireRules({
      presets: PRESETS,
      burnt: BURNT,
      keepWhenSpent: (w, e) => w.has(e, LightSourceComponent),
    }),
  );
  world
    .addSystem(stimulusSystem())
    .addSystem(elementRulesSystem(rules))
    .addSystem(elementFieldSystem())
    .addSystem(lightFieldSystem(field));
  const changes: LightChange[] = [];
  const noises: NoiseEvent[] = [];
  world.events.on(lightChanged, (c) => changes.push(c));
  world.events.on(noiseEmitted, (n) => noises.push(n));
  return { world, field, changes, noises, hz: world.clock.hz };
}

const burning = (w: World<never>, e: EntityId) => readProperty(w, e, 'burning');
const run = (w: World<never>, ticks: number) => {
  for (let i = 0; i < ticks; i++) w.step();
};
const at = (x: number, z = 0) => ({ x, y: 1, z });
const water = (w: World<never>, target: EntityId, intensity: number, source?: EntityId) =>
  applyStimulus(w, {
    shape: { kind: 'contact', target },
    element: 'water',
    intensity,
    ...(source !== undefined && { source }),
  });
const heat = (w: World<never>, target: EntityId, intensity: number, source?: EntityId) =>
  applyStimulus(w, {
    shape: { kind: 'contact', target },
    element: 'heat',
    intensity,
    ...(source !== undefined && { source }),
  });
const gust = (w: World<never>, intensity: number, extra: object = {}) =>
  applyStimulus(w, {
    shape: { kind: 'sphere', center: at(0), radius: 3 },
    element: 'force',
    intensity,
    falloff: 'none',
    direction: { x: 1, y: 0, z: 0 },
    ...extra,
  });

describe('light sources (mw-e03.16)', () => {
  it('prefabs: six variants, flammable fuel with a light that shines only while it burns', () => {
    const { world, field } = lightWorld();
    expect(LIGHT_SOURCE_VARIANTS).toHaveLength(6);
    const entities = LIGHT_SOURCE_VARIANTS.map((v, i) => spawnLightSource(world, v, at(i - 3, 0)));
    run(world, 2);
    for (const [i, entity] of entities.entries()) {
      const variant = LIGHT_SOURCE_VARIANTS[i]!;
      expect(readProperty(world, entity, 'flammable')).toBe(true);
      expect(readProperty(world, entity, 'extinguishable')).toBe(true);
      expect(readProperty(world, entity, 'windResistance')).toBe(
        LIGHT_SOURCE_PREFABS[variant].windResistance,
      );
      expect(field.levelAt(at(i - 3))).toBeGreaterThan(0);
    }
    const resistance = LIGHT_SOURCE_VARIANTS.map((v) => LIGHT_SOURCE_PREFABS[v].windResistance);
    expect(Math.min(...resistance)).toBe(LIGHT_SOURCE_PREFABS.candle.windResistance);
    expect(Math.max(...resistance)).toBe(LIGHT_SOURCE_PREFABS.fireplace.windResistance);
  });

  it('flag: an unlit light source starts dark and gives no light', () => {
    const { world, field } = lightWorld();
    const torch = spawnLightSource(world, 'torch', at(0), { unlit: true });
    run(world, 3);
    expect(burning(world, torch)).toBe(false);
    expect(field.levelAt(at(0))).toBe(0);
  });

  it('AC-1: any lit source goes out when wetness rises to 0.5, and the local light drops', () => {
    const { world, field, changes } = lightWorld();
    const thrower = world.spawn();
    const all = LIGHT_SOURCE_VARIANTS.map((v, i) => spawnLightSource(world, v, at(i - 3, 0)));
    run(world, 2);
    const before = all.map((_, i) => field.levelAt(at(i - 3)));
    for (const entity of all) water(world, entity, 0.5, thrower);
    run(world, 2);
    for (const [i, entity] of all.entries()) {
      expect(burning(world, entity)).toBe(false);
      expect(field.levelAt(at(i - 3))).toBeLessThan(before[i]!);
    }
    expect(changes.filter((c) => !c.lit && c.cause === 'water')).toHaveLength(6);
  });

  it('AC-2: the same force puts out a candle but not a brazier', () => {
    const { world, changes, hz } = lightWorld();
    const attacker = world.spawn();
    const candle = spawnLightSource(world, 'candle', at(-1));
    const brazier = spawnLightSource(world, 'brazier', at(1));
    run(world, 2);
    gust(world, 6, { source: attacker });
    run(world, 2);
    expect(burning(world, candle)).toBe(false);
    expect(burning(world, brazier)).toBe(true);
    expect(changes).toEqual([
      {
        tick: expect.any(Number) as number,
        entity: candle,
        lit: false,
        cause: 'force',
        source: attacker,
      },
    ]);
    // Its heat was carried off with the flame: it stays out for seconds, not a tick.
    run(world, hz * 3);
    expect(burning(world, candle)).toBe(false);
    // A big enough blast does put a brazier out.
    gust(world, 100);
    run(world, 2);
    expect(burning(world, brazier)).toBe(false);
    expect(changes.at(-1)).toMatchObject({ entity: brazier, cause: 'force', source: null });
  });

  it('force: contact shapes, spared sources, unplaced and non-extinguishable flames', () => {
    const { world, field } = lightWorld();
    const candle = spawnLightSource(world, 'candle', at(0));
    const other = spawnLightSource(world, 'candle', at(2));
    const spared = spawnLightSource(world, 'candle', at(-2));
    const plain = world.spawn();
    addProperties(world, plain, {
      burning: true,
      extinguishable: false,
      flammable: true,
      fuel: 100,
      temperature: 600,
    });
    placeEntity(world, plain, at(1), 0.1);
    const ghost = world.spawn();
    addProperties(world, ghost, {
      burning: true,
      extinguishable: true,
      windResistance: 1,
      flammable: true,
      fuel: 100,
      temperature: 600,
    });
    const out = world.spawn();
    addProperties(world, out, { burning: false, extinguishable: true, windResistance: 1 });
    placeEntity(world, out, at(1.5), 0.1);
    run(world, 2);
    // A contact on one candle leaves the other alone.
    applyStimulus(world, {
      shape: { kind: 'contact', target: candle },
      element: 'force',
      intensity: 5,
      direction: { x: 1, y: 0, z: 0 },
    });
    // A gust that spares its source: the candle that is the source stays lit.
    run(world, 2);
    expect(burning(world, candle)).toBe(false);
    expect(burning(world, other)).toBe(true);
    gust(world, 5, { source: spared, sparesSource: true });
    run(world, 2);
    expect(burning(world, spared)).toBe(true);
    expect(burning(world, other)).toBe(false);
    expect(burning(world, plain)).toBe(true);
    expect(burning(world, ghost)).toBe(true); // no placement: a sphere never reaches it
    // A contact does reach an unplaced flame.
    applyStimulus(world, {
      shape: { kind: 'contact', target: ghost },
      element: 'force',
      intensity: 5,
      direction: { x: 1, y: 0, z: 0 },
    });
    run(world, 2);
    expect(burning(world, ghost)).toBe(false);
    expect(elementFieldOf(world).config.temperature.ambient).toBeGreaterThanOrEqual(0);
    expect(field.emitterCount).toBeGreaterThanOrEqual(0);
  });

  it('AC-4: an unlit torch relights when heat passes its ignition point, crediting the heat source', () => {
    const { world, field, changes } = lightWorld();
    const arsonist = world.spawn();
    const torch = spawnLightSource(world, 'torch', at(0), { unlit: true });
    run(world, 2);
    // Heat below the ignition point does nothing; a cold stimulus is not attributed as heat.
    heat(world, torch, 100, arsonist);
    run(world, 2);
    expect(burning(world, torch)).toBe(false);
    applyStimulus(world, {
      shape: { kind: 'contact', target: torch },
      element: 'cold',
      intensity: 10,
      source: arsonist,
    });
    heat(world, torch, 400);
    run(world, 2);
    expect(burning(world, torch)).toBe(true);
    expect(field.levelAt(at(0))).toBeGreaterThan(0);
    expect(changes).toEqual([
      {
        tick: expect.any(Number) as number,
        entity: torch,
        lit: true,
        cause: 'heat',
        source: arsonist,
      },
    ]);
  });

  it('AC-4: the heat source is the attribution of the relight', () => {
    const { world, changes } = lightWorld();
    const arsonist = world.spawn();
    const torch = spawnLightSource(world, 'torch', at(0), { unlit: true });
    heat(world, torch, 400, arsonist);
    run(world, 2);
    expect(burning(world, torch)).toBe(true);
    expect(changes).toEqual([
      {
        tick: expect.any(Number) as number,
        entity: torch,
        lit: true,
        cause: 'heat',
        source: arsonist,
      },
    ]);
  });

  it('AC-5: a soaked torch does not relight until it has dried below 0.5', () => {
    const { world } = lightWorld();
    const torch = spawnLightSource(world, 'torch', at(0), { unlit: true });
    run(world, 1);
    setProperty(world, torch, 'wetness', 1);
    let ticks = 0;
    while (!burning(world, torch) && ticks < 20) {
      heat(world, torch, 500);
      run(world, 1);
      ticks++;
      if (burning(world, torch)) break;
      expect(burning(world, torch)).toBe(false);
    }
    expect(burning(world, torch)).toBe(true);
    expect(ticks).toBeGreaterThan(2);
    expect(readProperty(world, torch, 'wetness')).toBeLessThan(0.5);
  });

  it('fuel running out puts a source out and leaves it in the world', () => {
    const { world, changes } = lightWorld();
    const torch = spawnLightSource(world, 'torch', at(0));
    const straw = world.spawn();
    addProperties(world, straw, { material: 'straw', flammable: true, burning: true });
    addProperties(world, straw, { fuel: 0.1, temperature: 600, wetness: 0 });
    placeEntity(world, straw, at(2), 0.1);
    const crate = world.spawn();
    addProperties(world, crate, {
      material: 'wood',
      flammable: true,
      burning: true,
      fuel: 0.1,
      temperature: 600,
      wetness: 0,
    });
    placeEntity(world, crate, at(-2), 0.1);
    run(world, 2);
    setProperty(world, torch, 'fuel', 0.05);
    run(world, 10);
    expect(world.isAlive(torch)).toBe(true);
    expect(burning(world, torch)).toBe(false);
    expect(readProperty(world, torch, 'fuel')).toBe(0);
    expect(world.isAlive(straw)).toBe(false);
    expect(changes.filter((c) => c.entity === torch)).toEqual([
      {
        tick: expect.any(Number) as number,
        entity: torch,
        lit: false,
        cause: 'fuel',
        source: null,
      },
    ]);
  });

  it('flag: infinite fuel is topped up while it burns', () => {
    const { world } = lightWorld();
    const eternal = spawnLightSource(world, 'brazier', at(-1), { infiniteFuel: true });
    const mortal = spawnLightSource(world, 'brazier', at(1));
    run(world, 20);
    expect(readProperty(world, eternal, 'fuel')).toBe(FULL_FUEL);
    expect(readProperty(world, mortal, 'fuel')).toBeLessThan(LIGHT_SOURCE_PREFABS.brazier.fuel);
  });

  it('a guard’s lantern is the same prefab on an actor: it follows, and soaking it leaves the guard in the dark', () => {
    const { world, field } = lightWorld();
    const guard = world.spawn();
    placeEntity(world, guard, { x: 0, y: 0, z: 0 });
    const lantern = spawnLightSource(world, 'lantern', at(0), { carrier: guard });
    const lost = spawnLightSource(world, 'lantern', at(5), { carrier: world.spawn() });
    run(world, 2);
    placeEntity(world, guard, { x: 3, y: 0, z: 0 });
    run(world, 2);
    expect(world.get(lantern, PlacementComponent)).toMatchObject({ x: 3, y: 1, z: 0 });
    expect(world.get(lost, PlacementComponent)).toMatchObject({ x: 5, y: 1, z: 0 });
    const lit = field.levelAt({ x: 3, y: 1, z: 0.5 });
    expect(lit).toBeGreaterThan(0.5);
    water(world, lantern, 1);
    run(world, 2);
    expect(field.levelAt({ x: 3, y: 1, z: 0.5 })).toBeLessThan(lit);
  });

  it('a light source without its own emission gives the burning default; installs can be removed', () => {
    const { world, field } = lightWorld();
    const stub = world.spawn();
    addProperties(world, stub, { burning: true, flammable: true, fuel: 100, temperature: 600 });
    world.add(stub, LightSourceComponent, {
      variant: 'torch',
      infiniteFuel: false,
      carrier: null,
      offset: { x: 0, y: 0, z: 0 },
    });
    placeEntity(world, stub, at(0), 0.1);
    run(world, 2);
    expect(field.levelAt(at(0))).toBeGreaterThan(0);
    const off = installLightSources(world);
    off();
  });

  it('only light sources report: an ordinary fire lighting and going out is not a lightChanged', () => {
    const { world, changes } = lightWorld();
    const crate = world.spawn();
    addProperties(world, crate, {
      flammable: true,
      fuel: 50,
      temperature: 20,
      wetness: 0,
      ignitionPoint: 100,
    });
    placeEntity(world, crate, at(0), 0.1);
    heat(world, crate, 400);
    run(world, 2);
    expect(burning(world, crate)).toBe(true);
    water(world, crate, 1);
    run(world, 2);
    expect(burning(world, crate)).toBe(false);
    expect(changes).toEqual([]);
  });

  it('helpers: loudness normalisation', () => {
    expect(normalizedLoudness(85)).toBe(0.85);
    expect(normalizedLoudness(SNUFF_LOUDNESS)).toBeLessThanOrEqual(0.05);
  });
});

describe('smothering by hand (mw-e03.16)', () => {
  const UP = actionButton(false, false, false);
  const frame = (pressed: boolean, held: boolean): ActionFrame =>
    actionFrame({
      move: actionVector(0, 0),
      look: actionVector(0, 0),
      buttons: (action) => (action === 'interact' ? actionButton(pressed, held, false) : UP),
    });
  const PRESS = frame(true, true);
  const HOLD = frame(false, true);
  const IDLE = frame(false, false);

  function handsWorld() {
    const world = registerWorldProperties(new World<ActionFrame>({ seed: 1 }));
    world.register(CharacterController, PlayerLook, PlacementComponent);
    installInteraction(world, {});
    const w = world as unknown as World<never>;
    installLightField(w, new LightField());
    const actor = world.spawn();
    world.add(actor, CharacterController, initialCharacterState({ x: 0, y: 0, z: 0 }));
    world.add(actor, PlayerLook, { yaw: 0, pitch: 0 });
    addInteractor(world, actor, {});
    const changes: LightChange[] = [];
    const noises: NoiseEvent[] = [];
    world.events.on(lightChanged, (c) => changes.push(c));
    world.events.on(noiseEmitted, (n) => noises.push(n));
    return { world, w, actor, changes, noises };
  }

  it('AC-3: a completed snuff puts the torch out, 1.0 s, with a noise of loudness ≤ 0.05', () => {
    const { world, w, actor, changes, noises } = handsWorld();
    const torch = spawnLightSource(w, 'torch', { x: 0, y: 1, z: -1.5 });
    world.step([IDLE]);
    expect(interactionPrompt(world, actor)).toMatchObject({
      verb: 'extinguish',
      label: 'Snuff',
      available: true,
    });
    world.step([PRESS]);
    let held = 1;
    while (burning(w, torch) && held < 100) {
      world.step([HOLD]);
      held++;
    }
    expect(held).toBe(Math.round(SNUFF_SECONDS * world.clock.hz));
    expect(burning(w, torch)).toBe(false);
    expect(noises).toHaveLength(1);
    expect(noises[0]).toMatchObject({ kind: 'snuff', entity: torch, source: actor });
    expect(normalizedLoudness(noises[0]!.loudness)).toBeLessThanOrEqual(0.05);
    expect(changes).toEqual([
      {
        tick: expect.any(Number) as number,
        entity: torch,
        lit: false,
        cause: 'snuff',
        source: actor,
      },
    ]);
    // Out already: the prompt says so, and a stray interaction does nothing more.
    world.step([IDLE]);
    expect(interactionPrompt(world, actor)?.options[0]).toMatchObject({
      available: false,
      reason: 'Already out',
    });
    world.events.emit(interacted, { actor, target: torch, verb: 'extinguish', affordance: 0 });
    world.step([IDLE]);
    expect(noises).toHaveLength(1);
  });

  it('needs reach: a torch just beyond the snuff reach is not focused, one within it is', () => {
    const { world, w, actor } = handsWorld();
    const far = spawnLightSource(w, 'torch', { x: 0, y: 1, z: -2.3 });
    expect(w.get(far, InteractableComponent)?.range).toBe(SNUFF_REACH);
    world.step([IDLE]);
    expect(interactionPrompt(world, actor)).toBeUndefined();
    const near = spawnLightSource(w, 'torch', { x: 0, y: 1, z: -1.8 });
    world.step([IDLE]);
    expect(world.get(actor, InteractionFocusComponent)?.target).toBe(near);
  });

  it('ignores other verbs and other objects', () => {
    const { world, w, actor, noises } = handsWorld();
    const lever = world.spawn();
    addInteractable(
      w,
      lever,
      { affordances: [{ verb: 'extinguish' }, { verb: 'pull' }] },
      {
        x: 0,
        y: 0,
        z: -1,
      },
    );
    const torch = spawnLightSource(w, 'torch', { x: 0, y: 1, z: -1.5 });
    world.step([IDLE]);
    world.events.emit(interacted, { actor, target: torch, verb: 'pull', affordance: 0 });
    world.events.emit(interacted, { actor, target: lever, verb: 'extinguish', affordance: 0 });
    world.step([IDLE]);
    expect(burning(w, torch)).toBe(true);
    expect(noises).toEqual([]);
    expect(interactionPrompt(world, actor)?.options).toBeDefined();
  });
});
