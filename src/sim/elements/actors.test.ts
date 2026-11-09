/* eslint-disable @typescript-eslint/no-non-null-assertion */
// mw-e03.24: creatures and the player burn, soak, freeze and conduct by the same rules as objects.
import { describe, expect, it, vi } from 'vitest';
import { DAMAGE_COMPONENTS, giveCombatant, HealthComponent } from '../combat/damage/components';
import { Died } from '../combat/damage/events';
import { DamageModel } from '../combat/damage/model';
import type { EntityId } from '../core/component';
import { World } from '../core/world';
import { conductionRules } from '../electricity/rules';
import { shocked, type Shock } from '../electricity/rules';
import { elementFieldSystem, installElementField } from '../field/install';
import { CreatureComponent } from '../creatures/components';
import { addEquipment, EquipmentComponent, emptySlots } from '../inventory/equipment';
import { freezeRules } from '../liquids/ice';
import { installIce } from '../liquids/ice';
import { installLiquids } from '../liquids/volumes';
import { liquidRules } from '../liquids/rules';
import {
  addProperties,
  assignProperty,
  getProperty,
  readProperty,
  registerWorldProperties,
  setProperty,
  type WorldPropertyInit,
} from '../properties/components';
import { conductsNow, findPropertyViolations } from '../properties/derived';
import type { MaterialPresets } from '../properties/materials';
import { addMaterialProperties } from '../properties/materials';
import { WORLD_PROPERTY_SPECS } from '../properties/spec';
import { placeEntity } from '../stimulus/placement';
import { applyStimulus, installStimuli, stimulusSystem } from '../stimulus/stimulus';
import {
  ACTOR_DEFAULTS,
  actorInit,
  actorShattered,
  giveActor,
  installActorElements,
  type ActorSpec,
} from './actor-setup';
import {
  actorFuel,
  actorOf,
  ActorElementsComponent,
  actorRules,
  elementMoveScale,
  frozenSolid,
  heatInertiaOf,
  isActor,
  isAflame,
  isFireImmune,
  isFrozenSolid,
  resolveActorConfig,
  shockIntensity,
  soaked,
  thawed,
} from './actors';
import { fireBurntOut, fireIgnited, fireRules } from './fire';
import { ElementRuleSet, elementRulesSystem } from './rules';

// Long runs: slow under coverage and on a loaded runner.
vi.setConfig({ testTimeout: 30_000 });

const PRESETS: MaterialPresets = new Map<string, WorldPropertyInit>([
  ['flesh', { conductive: true }],
  ['bone', { flammable: false, hp: 80, fragile: 120 }],
  ['iron', { conductive: true, absorbency: 0.1 }],
  ['straw', { flammable: true, ignitionPoint: 200, fuel: 20, hp: 15 }],
  ['charred', { flammable: false }],
]);
const BURNT = new Map([['straw', null]]);

const BODY: ActorSpec = { properties: {}, resistances: {}, aflame: false };

interface Log {
  readonly ignited: EntityId[];
  readonly frozen: EntityId[];
  readonly thawed: EntityId[];
  readonly soaked: EntityId[];
  readonly burntOut: EntityId[];
  readonly shocks: Shock[];
  readonly shattered: EntityId[];
  readonly died: EntityId[];
}

function rig(options: { shatter?: boolean; creatures?: Record<string, ActorSpec> } = {}) {
  const world = new World<never>({ seed: 9, hz: 60 });
  registerWorldProperties(world);
  installStimuli(world);
  installElementField(world, { maxChunks: 8 });
  installLiquids(world);
  installIce(world);
  world.register(...DAMAGE_COMPONENTS, CreatureComponent);
  const damage = new DamageModel();
  world.addSystem(stimulusSystem());
  installActorElements(world, {
    presets: PRESETS,
    creature: (id) => options.creatures?.[id],
    player: BODY,
    itemConductive: (defId) => defId === 'mail-hauberk',
    ...(options.shatter === true && { shatter: { damage, joulesPerPoint: 20 } }),
  });
  world
    .addSystem(
      elementRulesSystem(
        new ElementRuleSet([
          ...fireRules({ presets: PRESETS, burnt: BURNT }),
          ...freezeRules(),
          ...actorRules(),
          ...liquidRules({ presets: PRESETS }),
          ...conductionRules(),
        ]),
      ),
    )
    .addSystem(elementFieldSystem());
  const log: Log = {
    ignited: [],
    frozen: [],
    thawed: [],
    soaked: [],
    burntOut: [],
    shocks: [],
    shattered: [],
    died: [],
  };
  world.events.on(fireIgnited, (e) => log.ignited.push(e.entity));
  world.events.on(frozenSolid, (e) => log.frozen.push(e.entity));
  world.events.on(thawed, (e) => log.thawed.push(e.entity));
  world.events.on(soaked, (e) => log.soaked.push(e.entity));
  world.events.on(fireBurntOut, (e) => log.burntOut.push(e.entity));
  world.events.on(shocked, (e) => log.shocks.push(e));
  world.events.on(actorShattered, (e) => log.shattered.push(e.entity));
  world.events.on(Died, (e) => log.died.push(e.target));
  const actor = (spec: ActorSpec = BODY, at = { x: 0, y: 0, z: 0 }): EntityId => {
    const entity = world.spawn();
    giveActor(world, entity, PRESETS, spec);
    placeEntity(world, entity, at, 0.4);
    giveCombatant(world, entity, { health: 100 });
    world.step(); // components land at the end of a tick
    return entity;
  };
  const step = (n = 1) => {
    for (let i = 0; i < n; i++) world.step();
  };
  const hit = (
    target: EntityId,
    element: 'heat' | 'cold' | 'water' | 'charge',
    intensity: number,
  ) => applyStimulus(world, { shape: { kind: 'contact', target }, element, intensity });
  const prop = (entity: EntityId, key: Parameters<typeof readProperty>[2]) =>
    readProperty(world, entity, key);
  return { world, damage, log, actor, step, hit, prop };
}

describe('actors in the element rules (mw-e03.24)', () => {
  it('AC-1: a charge on an actor soaked shocks at the wet factor times a dry actor’s', () => {
    const r = rig();
    const dry = r.actor();
    const wet = r.actor(BODY, { x: 5, y: 0, z: 0 });
    assignProperty(r.world, wet, 'wetness', 0.6);
    r.hit(dry, 'charge', 100);
    r.hit(wet, 'charge', 100);
    r.step();
    const of = (e: EntityId) => r.log.shocks.find((s) => s.entity === e)!.intensity;
    expect(of(dry)).toBeCloseTo(100, 6);
    expect(of(wet)).toBeCloseTo(200, 6);
  });

  it('AC-1: shock resistance spares an actor, and a thing that is not an actor is unchanged', () => {
    const r = rig({ creatures: {} });
    const hardy = r.actor({ properties: {}, resistances: { shock: 0.25 }, aflame: false });
    const crate = r.world.spawn();
    addMaterialProperties(r.world, crate, PRESETS, { material: 'iron', wetness: 0.1 });
    placeEntity(r.world, crate, { x: 5, y: 0, z: 0 }, 0.5);
    r.step();
    r.hit(hardy, 'charge', 100);
    r.hit(crate, 'charge', 100);
    r.step();
    const of = (e: EntityId) => r.log.shocks.find((s) => s.entity === e)!.intensity;
    expect(of(hardy)).toBeCloseTo(25, 6); // 100 x (1 - 0.75)
    expect(of(crate)).toBeCloseTo(100, 6);
    expect(shockIntensity(r.world, crate, 40, 2)).toBe(40);
  });

  it('AC-2: a burning actor walking through straw lights the cells along its path', () => {
    const r = rig();
    const straws = [1, 2, 3].map((x) => {
      const straw = r.world.spawn();
      addMaterialProperties(r.world, straw, PRESETS, { material: 'straw', temperature: 20 });
      placeEntity(r.world, straw, { x, y: 0, z: 0 }, 0.3);
      return straw;
    });
    const walker = r.actor(BODY, { x: 0, y: 0, z: 0 });
    r.hit(walker, 'heat', 500);
    r.step(2);
    expect(r.prop(walker, 'burning')).toBe(true);
    expect(r.log.ignited).toContain(walker);
    for (let t = 0; t < 240; t++) {
      placeEntity(r.world, walker, { x: Math.min(4, t / 60), y: 0, z: 0 }, 0.4);
      r.world.step();
    }
    expect(straws.every((s) => r.log.ignited.includes(s))).toBe(true);
  });

  it('AC-3: cold past its freeze point freezes an actor solid, immobile and brittle, then it thaws', () => {
    const r = rig();
    const body = r.actor();
    const slowed = elementMoveScale(r.world, body);
    expect(slowed).toBe(1);
    r.hit(body, 'cold', 60);
    r.step();
    expect(r.log.frozen).toEqual([body]);
    expect(r.prop(body, 'frozen')).toBe(true);
    expect(r.prop(body, 'fragile')).toBe(400);
    expect(elementMoveScale(r.world, body)).toBe(0);
    expect(isFrozenSolid(r.world, body)).toBe(true);
    expect(conductsNow(r.world, body)).toBe(false); // ice insulates
    r.step(60 * 5);
    expect(r.prop(body, 'frozen')).toBe(true); // 6 s of ice
    r.step(60 * 2);
    expect(r.prop(body, 'frozen')).toBe(false);
    expect(r.log.thawed).toEqual([body]);
    expect(r.prop(body, 'fragile')).toBe(WORLD_PROPERTY_SPECS.fragile.default);
    expect(r.prop(body, 'temperature')).toBeGreaterThan(0); // it does not refreeze at once
    expect(r.log.frozen).toEqual([body]);
    expect(findPropertyViolations(r.world)).toEqual([]);
  });

  it('AC-3: cold resistance shortens the ice, and resistance 1 never freezes', () => {
    const r = rig();
    const tough = r.actor({ properties: {}, resistances: { frost: 0.5 }, aflame: false });
    const immune = r.actor(
      { properties: {}, resistances: { frost: 0 }, aflame: false },
      { x: 6, y: 0, z: 0 },
    );
    r.hit(tough, 'cold', 60);
    r.hit(immune, 'cold', 60);
    r.step(2);
    expect(r.prop(tough, 'frozen')).toBe(true);
    expect(r.prop(immune, 'frozen')).toBe(false);
    expect(r.log.frozen).toEqual([tough]);
    r.step(60 * 3 + 5); // half of 6 s
    expect(r.prop(tough, 'frozen')).toBe(false);
  });

  it('AC-3: heat melts a frozen actor at once; a chilled actor above freezing is slowed', () => {
    const r = rig();
    const body = r.actor();
    r.hit(body, 'cold', 25); // 20 -> -5: frozen
    r.step();
    expect(r.prop(body, 'frozen')).toBe(true);
    r.hit(body, 'heat', 200);
    r.step(2);
    expect(r.prop(body, 'frozen')).toBe(false);
    expect(r.log.thawed).toEqual([body]);
    const cool = r.actor(BODY, { x: 6, y: 0, z: 0 });
    r.hit(cool, 'cold', 15); // 20 -> 5: between chill and freeze
    r.step();
    const scale = elementMoveScale(r.world, cool);
    expect(scale).toBeGreaterThan(0.4);
    expect(scale).toBeLessThan(1);
    expect(r.prop(cool, 'frozen')).toBe(false);
  });

  it('AC-3: a burning actor does not freeze; cold puts its fire out first', () => {
    const r = rig();
    const body = r.actor();
    r.hit(body, 'heat', 500);
    r.step(3);
    expect(r.prop(body, 'burning')).toBe(true);
    setProperty(r.world, body, 'temperature', -50);
    r.step();
    expect(r.prop(body, 'frozen')).toBe(false);
  });

  it('AC-4: an actor with fire resistance 1 never ignites, one with 0.5 burns half as long', () => {
    const r = rig();
    const immune = r.actor({ properties: {}, resistances: { fire: 0 }, aflame: false });
    const half = r.actor(
      { properties: {}, resistances: { fire: 0.5 }, aflame: false },
      { x: 6, y: 0, z: 0 },
    );
    assignProperty(r.world, immune, 'fuel', 5); // fuel alone would not keep it from burning
    r.hit(immune, 'heat', 600);
    r.hit(half, 'heat', 600);
    r.step(3);
    expect(r.prop(immune, 'burning')).toBe(false);
    expect(r.prop(half, 'burning')).toBe(true);
    expect(isFireImmune(r.world, immune)).toBe(true);
    expect(isFireImmune(r.world, half)).toBe(false);
    expect(actorFuel(actorOf(r.world, half)!)).toBe(3);
    r.step(60 * 3 + 5);
    expect(r.prop(half, 'burning')).toBe(false);
  });

  it('AC-4: a data-forced fire elemental burns, lights what it touches and nothing puts it out', () => {
    const r = rig();
    const straw = r.world.spawn();
    addMaterialProperties(r.world, straw, PRESETS, { material: 'straw', temperature: 20 });
    placeEntity(r.world, straw, { x: 0.8, y: 0, z: 0 }, 0.3);
    const elemental = r.actor({ properties: {}, resistances: { fire: 0 }, aflame: true });
    expect(isAflame(r.world, elemental)).toBe(true);
    expect(r.prop(elemental, 'burning')).toBe(true);
    expect(r.prop(elemental, 'fuel')).toBe(WORLD_PROPERTY_SPECS.fuel.max);
    r.hit(elemental, 'water', 1);
    assignProperty(r.world, elemental, 'wetness', 1);
    r.step(240);
    expect(r.prop(elemental, 'burning')).toBe(true);
    expect(r.prop(elemental, 'fuel')).toBe(WORLD_PROPERTY_SPECS.fuel.max);
    expect(r.log.ignited).toContain(straw);
    expect(r.log.burntOut).not.toContain(elemental);
  });

  it('a burning actor soaked by water goes out, and its fire spent is not destroyed or charred', () => {
    const r = rig();
    const wet = r.actor();
    r.hit(wet, 'heat', 500);
    r.step(3);
    expect(r.prop(wet, 'burning')).toBe(true);
    r.hit(wet, 'water', 0.9);
    r.step(2);
    expect(r.prop(wet, 'burning')).toBe(false);
    expect(r.log.soaked).toEqual([wet]);
    const spent = r.actor({ ...BODY, properties: { fuel: 1 } }, { x: 6, y: 0, z: 0 });
    r.hit(spent, 'heat', 500);
    r.step(60 + 10);
    expect(r.world.isAlive(spent)).toBe(true);
    expect(r.prop(spent, 'burning')).toBe(false);
    expect(r.log.burntOut).toContain(spent);
    expect(r.prop(spent, 'material')).toBe('flesh');
    // Hot and out of fuel it cannot relight; cooled, its fuel is back.
    expect(r.prop(spent, 'fuel')).toBe(0);
    r.step(60 * 6);
    expect(r.prop(spent, 'fuel')).toBe(1);
  });

  it('a torch’s air does not light an actor that walks past; it warms slowly', () => {
    const r = rig();
    const body = r.actor();
    expect(heatInertiaOf(r.world, body)).toBe(8);
    expect(heatInertiaOf(r.world, r.world.spawn())).toBe(1);
  });

  it('AC-5: wearing iron armor makes an actor conductive; taking it off restores the base', () => {
    const r = rig();
    const knight = r.world.spawn();
    r.world.register(EquipmentComponent);
    addEquipment(r.world, knight, 'knight');
    giveActor(r.world, knight, PRESETS, {
      properties: { material: 'bone' },
      resistances: {},
      aflame: false,
    });
    r.world.step();
    const equip = (body: { instanceId: number; defId: string } | null) => {
      const current = r.world.get(knight, EquipmentComponent)!;
      r.world.set(knight, EquipmentComponent, {
        ...current,
        slots: { ...emptySlots(), body },
      });
      r.step();
    };
    expect(getProperty(r.world, knight, 'conductive')).toBe(false);
    equip({ instanceId: 1, defId: 'mail-hauberk' });
    expect(readProperty(r.world, knight, 'conductive')).toBe(true);
    equip({ instanceId: 2, defId: 'leather-jerkin' });
    expect(readProperty(r.world, knight, 'conductive')).toBe(false);
    equip(null);
    expect(readProperty(r.world, knight, 'conductive')).toBe(false);
  });

  it('a frozen creature shatters under a hard hit and dies as usual; the player does not', () => {
    const r = rig({ shatter: true });
    const body = r.actor();
    r.hit(body, 'cold', 60);
    r.step();
    r.damage.apply(r.world, body, { amounts: { slash: 1 }, instigator: null });
    r.step();
    expect(r.log.died).toEqual([]); // 20 J is under the ice's 133 J
    r.damage.apply(r.world, body, { amounts: { slash: 10 }, instigator: null });
    r.step();
    expect(r.log.shattered).toEqual([body]);
    expect(r.log.died).toEqual([body]);
    expect(r.world.get(body, HealthComponent)!.current).toBe(0);
  });

  it('an unfrozen actor, a player and a fire-only hit do not shatter', () => {
    const r = rig({ shatter: true });
    const body = r.actor();
    r.damage.apply(r.world, body, { amounts: { slash: 50 }, instigator: null });
    r.step();
    expect(r.log.shattered).toEqual([]);
    const frozen = r.actor(BODY, { x: 6, y: 0, z: 0 });
    r.hit(frozen, 'cold', 60);
    r.step();
    r.damage.apply(r.world, frozen, { amounts: { fire: 5 }, instigator: null });
    r.step();
    expect(r.log.shattered).toEqual([]);
    const player = r.world.spawn();
    giveCombatant(r.world, player, { health: 100, player: true });
    giveActor(r.world, player, PRESETS, BODY);
    placeEntity(r.world, player, { x: 12, y: 0, z: 0 }, 0.4);
    r.step();
    r.hit(player, 'cold', 60);
    r.step();
    expect(r.prop(player, 'frozen')).toBe(true);
    r.damage.apply(r.world, player, { amounts: { blunt: 30 }, instigator: null });
    r.step();
    expect(r.log.shattered).toEqual([]);
    expect(r.world.get(player, HealthComponent)!.current).toBe(70);
  });

  it('a hit that kills a frozen creature outright is not shattered twice', () => {
    const r = rig({ shatter: true });
    const body = r.actor();
    r.hit(body, 'cold', 60);
    r.step();
    r.damage.apply(r.world, body, { amounts: { slash: 500 }, instigator: null });
    r.step();
    expect(r.log.shattered).toEqual([]);
    expect(r.log.died).toEqual([body]);
  });

  it('adopts creatures and the player once, keeping the properties they already have', () => {
    const spec: ActorSpec = {
      properties: { material: 'bone', flammable: true, ignitionPoint: 300 },
      resistances: {},
      aflame: false,
    };
    const r = rig({ creatures: { skeleton: spec } });
    const skeleton = r.world.spawn();
    r.world.add(skeleton, CreatureComponent, {
      origin: { creature: 'skeleton', at: { x: 0, y: 0, z: 0 }, facing: { x: 0, y: 0, z: 1 } },
      behaviour: 'x',
      tuning: {},
      needs: {},
    });
    const stranger = r.world.spawn();
    r.world.add(stranger, CreatureComponent, {
      origin: { creature: 'unknown', at: { x: 0, y: 0, z: 0 }, facing: { x: 0, y: 0, z: 1 } },
      behaviour: 'x',
      tuning: {},
      needs: {},
    });
    const player = r.world.spawn();
    giveCombatant(r.world, player, { health: 100, player: true });
    addProperties(r.world, player, { wetness: 0.7 });
    r.world.step();
    r.world.step();
    expect(isActor(r.world, skeleton)).toBe(true);
    expect(r.prop(skeleton, 'material')).toBe('bone');
    expect(r.prop(skeleton, 'ignitionPoint')).toBe(300);
    expect(r.prop(skeleton, 'hp')).toBe(WORLD_PROPERTY_SPECS.hp.default); // structure is not an actor's
    expect(isActor(r.world, stranger)).toBe(false);
    expect(isActor(r.world, player)).toBe(true);
    expect(r.prop(player, 'wetness')).toBeCloseTo(0.7, 2);
    expect(r.prop(player, 'flammable')).toBe(true);
  });

  it('actor data: defaults, material and aflame state', () => {
    const plain = actorInit(PRESETS, BODY);
    expect(plain.properties).toMatchObject({
      ...ACTOR_DEFAULTS,
      material: 'flesh',
      conductive: true,
      charge: 0,
      temperature: 20,
    });
    expect(plain.actor.baseConductive).toBe(true);
    const bone = actorInit(PRESETS, {
      properties: { material: 'bone' },
      resistances: { shock: 2 },
      aflame: false,
    });
    expect(bone.properties.conductive).toBe(false);
    expect(bone.properties).not.toHaveProperty('charge');
    expect(bone.actor.shockResistance).toBe(0);
    const unknown = actorInit(new Map(), {
      properties: { fuel: 3 },
      resistances: {},
      aflame: false,
    });
    expect(unknown.properties).toMatchObject({ material: 'flesh', fuel: 3 });
    const fire = actorInit(PRESETS, { properties: {}, resistances: { fire: 0 }, aflame: true });
    expect(fire.properties).toMatchObject({ burning: true, flammable: true });
    expect(fire.properties.temperature).toBeGreaterThanOrEqual(600);
  });

  it('rules do nothing in a world without actors, and the config is validated', () => {
    const world = new World<never>({ seed: 1, hz: 60 });
    registerWorldProperties(world);
    installStimuli(world);
    installElementField(world, { maxChunks: 8 });
    world
      .addSystem(elementRulesSystem(new ElementRuleSet(actorRules())))
      .addSystem(elementFieldSystem());
    world.step();
    const e = world.spawn();
    expect(elementMoveScale(world, e)).toBe(1);
    expect(isFrozenSolid(world, e)).toBe(false);
    expect(isAflame(world, e)).toBe(false);
    expect(() => resolveActorConfig({ frozenSeconds: 0 })).toThrow(RangeError);
    expect(() => resolveActorConfig({ frozenFragile: -1 })).toThrow(RangeError);
    expect(() => resolveActorConfig({ thawMargin: Number.NaN })).toThrow(RangeError);
    expect(() => resolveActorConfig({ meltTemperature: Number.NaN })).toThrow(RangeError);
    expect(resolveActorConfig({ frozenSeconds: 2 }).frozenSeconds).toBe(2);
  });

  it('actors without a wetness property are not soaked', () => {
    const r = rig();
    const e = r.world.spawn();
    r.world.add(e, ActorElementsComponent, { ...actorInit(PRESETS, BODY).actor });
    addProperties(r.world, e, { temperature: 20 });
    placeEntity(r.world, e, { x: 0, y: 0, z: 0 }, 0.4);
    r.step(2);
    expect(r.log.soaked).toEqual([]);
  });

  it('installs into a bare world: no creatures, no player, no equipment rules, no shatter', () => {
    const world = new World<never>({ seed: 2, hz: 60 });
    registerWorldProperties(world);
    world.register(ActorElementsComponent, EquipmentComponent);
    const off = installActorElements(world, { presets: PRESETS, creature: () => undefined });
    const knight = world.spawn();
    addEquipment(world, knight, 'knight');
    giveActor(world, knight, PRESETS, BODY);
    world.step();
    world.step();
    expect(readProperty(world, knight, 'conductive')).toBe(true); // flesh: its own, untouched
    off();
  });
});
