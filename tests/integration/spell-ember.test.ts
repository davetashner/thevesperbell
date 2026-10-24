// Ember, the first shipped spell (mw-e08.2), against real content and the real fire, heat and light
// rules. src/sim tests cannot load content at runtime, so everything that needs ember.json lives here.
// The spell is pure data: nothing in src/sim names it (tests/integration/spell-pipeline-content.test.ts
// and spell-stimuli.test.ts grep the sim for every shipped spell id).
import { describe, expect, it } from 'vitest';
import {
  burntMaterials,
  loadGameContent,
  materialPresets,
  type ItemDef,
} from '@content/index';
import { markExercised } from '@content/testing';
import {
  addMaterialProperties,
  addProperties,
  box,
  DAMAGE_COMPONENTS,
  ElementRuleSet,
  elementFieldOf,
  elementFieldSystem,
  elementRulesSystem,
  FakeCollisionWorld,
  fireIgnited,
  fireRules,
  giveCombatant,
  giveHurtboxes,
  giveMana,
  healthOf,
  HIT_VOLUME_COMPONENTS,
  installElementField,
  installLightField,
  installSpellEmission,
  installMana,
  installSpellProjectiles,
  installSpells,
  installStimuli,
  learnSpell,
  LightField,
  lightFieldSystem,
  manaOf,
  placeEntity,
  PhysicsColliderComponent,
  readProperty,
  registerWorldProperties,
  SpellCast,
  SpellEffectApplied,
  SpellFizzled,
  SpellHit,
  SpellQuenched,
  stimulusSystem,
  World,
  type CastCommand,
  type EntityId,
  type Vec3,
} from '@sim/index';

const content = loadGameContent();
const presets = materialPresets(content.all('material'));
const burnt = burntMaterials(content.all('material'));
const ember = content.get('spell', 'ember');

/** The reference Firebolt damage (docs/design/spells.md): AC-5's 10 % ceiling is measured against it. */
const FIREBOLT_FIRE_DAMAGE = 20;

const v3 = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
const TARGET_X = 6; // a target's centre; its collider face (x = 5.75) is where Ember lands

interface SceneOptions {
  readonly water?: (p: Vec3) => boolean;
}

/** A caster at the origin, a lit-by-default stone floor of nothing, and targets added with `target`. */
function scene(options: SceneOptions = {}) {
  const collision = new FakeCollisionWorld([]);
  const world = installElementField(
    installStimuli(registerWorldProperties(new World<CastCommand>({ seed: 8, hz: 60 }))),
    { maxChunks: 32 },
  );
  world.register(...DAMAGE_COMPONENTS, ...HIT_VOLUME_COMPONENTS, PhysicsColliderComponent);
  elementFieldOf(world).setConductivity({ min: v3(-3.9, -3.9, -3.9), max: v3(11.9, 3.9, 3.9) }, 1);
  const owner = new Map<number, EntityId>();
  const pipeline = installSpells(world, { spells: (id) => (id === 'ember' ? ember : undefined) });
  installMana(world, pipeline);
  installSpellProjectiles(world, pipeline, {
    collision,
    muzzleHeight: 0,
    surfaceOf: (_w, body) => owner.get(body) ?? null,
    ...(options.water === undefined ? {} : { water: options.water }),
  });
  installSpellEmission(world, pipeline);
  const light = new LightField();
  installLightField(world, light);
  world
    .addSystem(stimulusSystem())
    .addSystem(elementRulesSystem(new ElementRuleSet(fireRules({ presets, burnt }))))
    .addSystem(elementFieldSystem())
    .addSystem(lightFieldSystem(light));

  const caster = world.spawn();
  placeEntity(world, caster, v3(0, 0, 0), 0.5);
  giveMana(world, caster);
  learnSpell(world, caster, 'ember');

  const ignited: EntityId[] = [];
  world.events.on(fireIgnited, (e) => ignited.push(e.entity));
  const log: string[] = [];
  world.events.on(SpellCast, () => log.push('cast'));
  world.events.on(SpellHit, () => log.push('hit'));
  world.events.on(SpellEffectApplied, (e) => log.push(`op:${e.op}`));
  world.events.on(SpellFizzled, (e) => log.push(`fizzle:${e.reason}`));
  world.events.on(SpellQuenched, (e) => log.push(`quench:${e.cue}`));

  /** A solid object (its collider is what Ember hits) with the world properties of a material. */
  const target = (
    material: string,
    props: Parameters<typeof addMaterialProperties>[3] = {},
    x = TARGET_X,
  ): EntityId => {
    const entity = world.spawn();
    addMaterialProperties(world, entity, presets, { material, temperature: 20, ...props });
    placeEntity(world, entity, v3(x, 0, 0), 0.5);
    owner.set(collision.add(box(v3(x - 0.25, -0.5, -0.5), v3(x + 0.25, 0.5, 0.5))), entity);
    return entity;
  };
  const fire = (): void => {
    pipeline.cast(world, { caster, spell: 'ember', source: 'free', aim: v3(TARGET_X, 0, 0) });
  };
  const run = (ticks: number): void => {
    for (let i = 0; i < ticks; i++) world.step();
  };
  /** Fires one Ember and waits `ticks` (default: long enough to land and for the cooldown to pass). */
  const hit = (ticks = 40): void => {
    fire();
    run(ticks);
  };
  return { world, pipeline, caster, collision, light, target, fire, run, hit, ignited, log };
}

describe('Ember: the spell file (mw-e08.2)', () => {
  it('AC-1: it validates and loads with a school, a teaching book item and its cues', (ctx) => {
    markExercised(ctx.task, 'spell', 'ember');
    expect(ember).toMatchObject({
      id: 'ember',
      school: 'fire',
      tier: 1,
      bookId: 'ember',
      vfxCue: 'vfx-spell-ember-cast',
      sfxCue: 'sfx-spell-ember-cast',
    });
    const book = content.get('item', 'ember') as ItemDef;
    markExercised(ctx.task, 'item', 'ember');
    if (book.category !== 'book') throw new Error('ember is not a book');
    expect(book.book).toMatchObject({
      kind: 'tome',
      school: 'fire',
      teaches: { kind: 'spell', spell: { id: 'ember' } },
    });
    expect(content.get('capability', 'spells').capabilities.map((c) => c.id)).toContain(
      'spell.ember',
    );
  });

  it('AC-1: the Scroll of Ember casts Ember, and a scroll is the same spell for any class', (ctx) => {
    markExercised(ctx.task, 'item', 'scroll-of-ember');
    const scroll = content.get('item', 'scroll-of-ember') as ItemDef;
    if (scroll.category !== 'book') throw new Error('not a book');
    expect(scroll.book.kind).toBe('scroll');
    expect(scroll.book.casts?.id).toBe('ember');
  });

  it('AC-1: it casts in the headless sim: a learned cast spends 4 mana and Ember lands, lit and loud only a little', () => {
    const s = scene();
    s.target('wood');
    const cast = () => {
      s.world.step([
        { type: 'cast', caster: s.caster, spell: 'ember', aim: v3(TARGET_X, 0, 0) },
      ] satisfies CastCommand[]);
    };
    cast();
    expect(s.log[0]).toBe('cast');
    expect(manaOf(s.world, s.caster)?.current).toBe(96);
    s.run(40);
    expect(s.log).toContain('hit');
    expect(s.log).toContain('op:stimulus');
    expect(s.log).toContain('op:light');
  });

  it('is a cheap starter: a full sorcerer pool pays for 25 casts, and it is not flagged too-useful', () => {
    expect(ember.cost.mana).toBe(4);
    expect(Math.floor(100 / ember.cost.mana)).toBe(25);
    expect(ember.flags.tooUseful).toBe(false);
    expect(ember.delivery).toMatchObject({ kind: 'projectile', speed: 14, maxRange: 12 });
  });
});

describe('Ember: flammable things (mw-e08.2)', () => {
  const flammableMaterials = [...presets]
    .filter(([, props]) => props.flammable === true)
    .map(([id]) => id);

  /** Wetness a material starts with (0 when it has none). */
  const damp = (id: string): number => presets.get(id)?.wetness ?? 0;

  it('AC-2: every flammable material ignites within 1 s of the hit; a damp one (ivy) takes a second Ember to dry first', () => {
    expect(flammableMaterials.length).toBeGreaterThanOrEqual(5);
    for (const material of flammableMaterials) {
      const s = scene();
      const crate = s.target(material);
      let landed = -1;
      s.world.events.on(SpellHit, () => (landed = s.world.tick));
      s.fire();
      for (let i = 0; i < 90 && !s.ignited.includes(crate); i++) s.world.step();
      if (damp(material) > 0.1) {
        // One Ember's heat (500 °C) pays for drying at most ~0.2 wetness (heat.evaporate, latent heat 2000 °C).
        expect(s.ignited, `${material} is dried, not lit, by the first Ember`).toEqual([]);
        s.hit(60);
        s.fire();
        for (let i = 0; i < 90 && !s.ignited.includes(crate); i++) s.world.step();
        expect(s.ignited, `${material} lit by the second Ember`).toContain(crate);
        continue;
      }
      expect(landed, `${material}: Ember landed`).toBeGreaterThan(0);
      expect(s.ignited, `${material} ignited`).toContain(crate);
      expect(s.world.tick - landed, `${material}: ticks from hit to ignition`).toBeLessThanOrEqual(
        60,
      );
    }
  });

  it('AC-2: a non-flammable object is heated but never ignites', () => {
    const s = scene();
    const rock = s.target('stone');
    s.hit(90);
    expect(readProperty(s.world, rock, 'temperature')).toBeGreaterThan(20);
    expect(readProperty(s.world, rock, 'burning')).toBe(false);
    expect(s.ignited).toEqual([]);
  });

  it('AC-3: a soaked flammable object does not ignite, and is dried out (steam) after 3 hits', () => {
    const s = scene();
    const crate = s.target('wood', { wetness: 1 });
    const wet = (): number => readProperty(s.world, crate, 'wetness');
    const readings: number[] = [];
    for (let n = 1; n <= 3; n++) {
      s.hit(60); // lands, steams, and cools before the next
      readings.push(wet());
      expect(readProperty(s.world, crate, 'burning'), `hit ${String(n)}`).toBe(false);
    }
    // Still soaked (>= 0.5, which resists fire) after two hits; no longer after the third.
    expect(readings[0]).toBeLessThan(1);
    expect(readings[1]).toBeGreaterThanOrEqual(0.5);
    expect(readings[2]).toBeLessThan(0.5);
    expect(s.ignited).toEqual([]);
    const steam = elementFieldOf(s.world).readAt('gas:steam', v3(TARGET_X, 0, 0));
    expect(steam).toBeGreaterThan(0);
    // No longer soaked, it dries the rest of the way and then lights: a few more Embers, not a bonfire.
    for (let n = 0; n < 3 && !s.ignited.includes(crate); n++) s.hit(60);
    expect(wet()).toBe(0);
    expect(s.ignited).toContain(crate);
  });

  it('AC-4: an unlit flammable light source is lit by Ember and the light field rises at its position', () => {
    const s = scene();
    // A candle: small, flammable, giving no light until it burns (lit light sources are `burning`).
    const candle = s.target('wood', { fuel: 30 });
    const wick = v3(TARGET_X, 0.2, 0.3);
    expect(readProperty(s.world, candle, 'burning')).toBe(false);
    s.run(2);
    const before = s.light.levelAt(wick);
    expect(before).toBe(0);
    s.hit(90);
    expect(readProperty(s.world, candle, 'burning')).toBe(true);
    expect(s.light.levelAt(wick)).toBeGreaterThan(before);
    expect(s.light.levelAt(wick)).toBeGreaterThan(0.5);
  });

  it('Ember in flight is a small light: it brightens its path and gives itself away quietly', () => {
    const s = scene();
    s.target('stone');
    s.fire();
    s.run(5);
    const glow = s.light.levelAt(v3(1.5, 0, 0));
    expect(glow).toBeGreaterThan(0);
    expect(glow).toBeLessThan(0.5);
  });
});

describe('Ember: creatures (mw-e08.2)', () => {
  function creatureScene() {
    const s = scene();
    const creature = (props: Parameters<typeof addProperties>[2]): EntityId => {
      const e = s.world.spawn();
      placeEntity(s.world, e, v3(TARGET_X, 0, 0), 0.5);
      giveCombatant(s.world, e, { health: 100 });
      giveHurtboxes(s.world, e, {
        boxes: [
          {
            id: 'body',
            socket: 'root',
            region: 'torso',
            armored: false,
            multiplier: 1,
            shape: { kind: 'sphere', center: v3(0, 0, 0), radius: 0.5 },
          },
        ],
      });
      addProperties(s.world, e, { temperature: 20, ...props });
      return e;
    };
    return { ...s, creature };
  }

  it('AC-5: a creature takes fire damage of at most 10% of a Firebolt, and burns only if flammable', () => {
    const damage = ember.effects.find((e) => e.op === 'damage');
    if (damage?.op !== 'damage') throw new Error('no damage op');
    expect(damage.amounts.fire).toBeGreaterThan(0);
    expect(damage.amounts.fire ?? 0).toBeLessThanOrEqual(FIREBOLT_FIRE_DAMAGE * 0.1);
    expect(Object.keys(damage.amounts)).toEqual(['fire']);

    const plain = creatureScene();
    const flesh = plain.creature({});
    plain.hit(90);
    expect(healthOf(plain.world, flesh)?.current).toBe(100 - (damage.amounts.fire ?? 0));
    expect(readProperty(plain.world, flesh, 'burning')).toBe(false);
    expect(plain.ignited).toEqual([]);

    const straw = creatureScene();
    const strawman = straw.creature({ flammable: true, ignitionPoint: 250, fuel: 20 });
    straw.hit(90);
    expect(healthOf(straw.world, strawman)?.current).toBe(100 - (damage.amounts.fire ?? 0));
    expect(straw.ignited).toContain(strawman);
  });
});

describe('Ember: water (mw-e08.2)', () => {
  const pool = (p: Vec3): boolean => p.x >= 3;

  it('AC-6: fired into a water volume it fizzles with no ignition, no hit and a steam cue event', () => {
    const s = scene({ water: pool });
    const crate = s.target('wood');
    const quenched: Vec3[] = [];
    s.world.events.on(SpellQuenched, (e) => quenched.push(e.point));
    s.hit(90);
    expect(quenched).toHaveLength(1);
    expect(quenched[0]?.x).toBeGreaterThanOrEqual(3);
    expect(s.log).toContain('quench:steam');
    expect(s.log).toContain('fizzle:quenched');
    expect(s.log).not.toContain('hit');
    expect(s.ignited).toEqual([]);
    expect(readProperty(s.world, crate, 'temperature')).toBeLessThan(100);
  });

  it('AC-6: cast while submerged it never leaves the hand', () => {
    const s = scene({ water: () => true });
    s.target('wood');
    s.fire();
    s.run(2);
    expect(s.log).toContain('quench:steam');
    expect(s.log).toContain('fizzle:quenched');
    expect(s.log).not.toContain('cast');
    expect(s.ignited).toEqual([]);
  });
});
