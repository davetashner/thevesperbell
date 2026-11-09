import { describe, expect, it, vi } from 'vitest';
import type { CaptionTrigger, PlayOptions } from '@audio/index';
import { cueRuleSchema, loadGameContent, type CueRuleDef } from '@content/index';
import {
  addProperties,
  DamageApplied,
  Died,
  physicsImpact,
  registerWorldProperties,
  World,
  type EventType,
} from '@sim/index';
import {
  AudioCueBridge,
  DEFAULT_CAPTION_PRIORITY,
  soundVariantCount,
  worldCueLookups,
  type AudioCueBridgeOptions,
  type CueEventSource,
} from './audio-bridge.ts';
import type { CueReading } from './events.ts';

type RuleInput = Parameters<typeof cueRuleSchema.parse>[0];

const rules = (...inputs: RuleInput[]): CueRuleDef[] => inputs.map((r) => cueRuleSchema.parse(r));

function setup(ruleList: CueRuleDef[], options: Partial<AudioCueBridgeOptions> = {}) {
  let now = 0;
  const played: { cue: string; options: PlayOptions }[] = [];
  const bridge = new AudioCueBridge({
    sheets: [{ rules: ruleList }],
    player: { play: (cue, opts) => played.push({ cue, options: opts }) },
    now: () => now,
    ...options,
  });
  return {
    bridge,
    played,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

const hit = (facts: CueReading['facts'], target = 1): CueReading => ({
  anchors: { target: { entity: target } },
  facts,
});

describe('AudioCueBridge', () => {
  it('AC-1: given generic and metal-on-bone DamageApplied rules, a metal-on-bone hit plays the specific cue', () => {
    const { bridge, played } = setup(
      rules(
        { event: 'DamageApplied', cue: 'sfx-impact-generic' },
        {
          event: 'DamageApplied',
          match: { weapon: 'metal', target: 'bone' },
          cue: 'sfx-metal-bone',
        },
      ),
    );
    bridge.handle('DamageApplied', hit({ weapon: 'metal', target: 'bone' }));
    bridge.handle('DamageApplied', hit({ weapon: 'wood', target: 'bone' }, 2));
    expect(played.map((p) => p.cue)).toEqual(['sfx-metal-bone', 'sfx-impact-generic']);
    expect(played[0]?.options).toMatchObject({ entity: 1, volume: 1, pitch: 1 });
  });

  it('AC-2: two identical cue requests on one entity 20 ms apart play once', () => {
    const { bridge, played, advance } = setup(rules({ event: 'Died', cue: 'sfx-combat-death' }));
    const died: CueReading = { anchors: { target: { entity: 7 } }, facts: {} };
    expect(bridge.handle('Died', died)).toHaveLength(1);
    advance(20);
    expect(bridge.handle('Died', died)).toEqual([]);
    // Another entity is not de-duplicated, and the same one plays again once the 30 ms window ends.
    expect(bridge.handle('Died', { anchors: { target: { entity: 8 } }, facts: {} })).toHaveLength(
      1,
    );
    advance(10);
    expect(bridge.handle('Died', died)).toHaveLength(1);
    expect(played.map((p) => p.options.entity)).toEqual([7, 8, 7]);
  });

  it('de-dupes positional anchors by position and anchorless cues together', () => {
    const { bridge } = setup(rules({ event: 'stimulusResolved', cue: 'sfx-splash' }));
    const at = (x: number): CueReading => ({
      anchors: { at: { position: { x, y: 0, z: 0 } } },
      facts: {},
    });
    expect(bridge.handle('stimulusResolved', at(1))[0]?.options.position).toEqual({
      x: 1,
      y: 0,
      z: 0,
    });
    expect(bridge.handle('stimulusResolved', at(1))).toEqual([]);
    expect(bridge.handle('stimulusResolved', at(2))).toHaveLength(1);
    const nowhere: CueReading = { anchors: {}, facts: {} };
    expect(bridge.handle('stimulusResolved', nowhere)[0]?.options).not.toHaveProperty('entity');
    expect(bridge.handle('stimulusResolved', nowhere)).toEqual([]);
  });

  it('AC-4: 4 variants with ±5% pitch jitter: 1000 triggers use every variant and stay within ±5%', () => {
    const { bridge, played, advance } = setup(
      rules({ event: 'DamageApplied', cue: 'sfx-impact-{target}', variants: 4, pitchJitter: 0.05 }),
    );
    for (let i = 0; i < 1000; i++) {
      bridge.handle('DamageApplied', hit({ target: 'bone' }));
      advance(50);
    }
    expect(played).toHaveLength(1000);
    const counts = [0, 0, 0, 0];
    let previous: number | undefined;
    for (const { options } of played) {
      const variant = options.variant ?? -1;
      expect(variant).toBeGreaterThanOrEqual(0);
      expect(variant).toBeLessThan(4);
      expect(variant).not.toBe(previous); // never the same variant twice in a row
      previous = variant;
      counts[variant] = (counts[variant] ?? 0) + 1;
      expect(options.pitch).toBeGreaterThanOrEqual(0.95);
      expect(options.pitch).toBeLessThanOrEqual(1.05);
    }
    expect(counts.every((n) => n > 150)).toBe(true);
    const pitches = played.map((p) => p.options.pitch ?? 1);
    expect(Math.min(...pitches)).toBeLessThan(0.96);
    expect(Math.max(...pitches)).toBeGreaterThan(1.04);
  });

  it('is reproducible for a seed and differs between seeds', () => {
    const run = (seed: number) => {
      const { bridge, played, advance } = setup(
        rules({ event: 'Died', cue: 'sfx-death', variants: 3, pitchJitter: 0.1 }),
        { seed },
      );
      for (let i = 0; i < 20; i++) {
        bridge.handle('Died', { anchors: { target: { entity: 1 } }, facts: {} });
        advance(100);
      }
      return played.map((p) => [p.options.variant, p.options.pitch]);
    };
    expect(run(1)).toEqual(run(1));
    expect(run(1)).not.toEqual(run(2));
  });

  it('limits variants by the manifest and leaves the round-robin when neither knows a count', () => {
    const variantCount = (cue: string) =>
      cue === 'sfx-two' ? 2 : cue === 'sfx-one' ? 1 : undefined;
    const { bridge } = setup(
      rules(
        { event: 'Died', cue: 'sfx-two', variants: 4 },
        { event: 'Died', layer: 'b', cue: 'sfx-one' },
        { event: 'Died', layer: 'c', cue: 'sfx-unknown' },
      ),
      { variantCount },
    );
    const plays = bridge.handle('Died', { anchors: { target: { entity: 1 } }, facts: {} });
    expect(plays.map((p) => [p.cue, p.options.variant])).toEqual([
      ['sfx-two', expect.any(Number)],
      ['sfx-one', 0],
      ['sfx-unknown', undefined],
    ]);
    expect(plays[0]?.options.variant).toBeLessThan(2);
  });

  it('applies volume, volume jitter, volume by a number fact and the rule priority', () => {
    const { bridge, advance } = setup(
      rules({
        event: 'DamageApplied',
        cue: 'sfx-hit',
        volumeDb: -6,
        volumeJitterDb: 2,
        volumeBy: { fact: 'total', min: 0, max: 40, floorDb: -12 },
        priority: 70,
      }),
    );
    const dbOf = (total: number | undefined) => {
      advance(100);
      const [play] = bridge.handle('DamageApplied', hit(total === undefined ? {} : { total }));
      expect(play?.options.priority).toBe(70);
      return 20 * Math.log10(play?.options.volume ?? 1);
    };
    const loud = dbOf(40);
    expect(loud).toBeGreaterThanOrEqual(-8);
    expect(loud).toBeLessThanOrEqual(-4);
    const quiet = dbOf(0);
    expect(quiet).toBeGreaterThanOrEqual(-20);
    expect(quiet).toBeLessThanOrEqual(-16);
    expect(dbOf(80)).toBeGreaterThanOrEqual(-8); // clamped to max
    expect(dbOf(undefined)).toBeGreaterThanOrEqual(-8); // absent fact: no scaling
  });

  it('honours per-rule cooldowns per anchor', () => {
    const { bridge, advance } = setup(
      rules({ event: 'StaminaExhausted', cue: 'sfx-wheeze', cooldownMs: 400 }),
    );
    const on = (entity: number): CueReading => ({ anchors: { entity: { entity } }, facts: {} });
    expect(bridge.handle('StaminaExhausted', on(1))).toHaveLength(1);
    advance(100);
    expect(bridge.handle('StaminaExhausted', on(1))).toEqual([]);
    expect(bridge.handle('StaminaExhausted', on(2))).toHaveLength(1);
    advance(300);
    expect(bridge.handle('StaminaExhausted', on(1))).toHaveLength(1);
  });

  it('plays nothing when a template fact is missing, and uses an explicit anchor', () => {
    const { bridge } = setup(
      rules(
        { event: 'DamageApplied', cue: 'sfx-impact-{target}' },
        { event: 'DamageApplied', layer: 'swing', cue: 'sfx-swing', at: 'instigator' },
      ),
    );
    const plays = bridge.handle('DamageApplied', {
      anchors: { target: { entity: 1 }, instigator: { entity: 4 } },
      facts: {},
    });
    expect(plays.map((p) => [p.cue, p.options.entity])).toEqual([['sfx-swing', 4]]);
  });

  it('prunes old de-dupe entries once many anchors have played', () => {
    const { bridge, advance } = setup(rules({ event: 'Died', cue: 'sfx-death', cooldownMs: 50 }));
    for (let e = 0; e < 600; e++) {
      bridge.handle('Died', { anchors: { target: { entity: e } }, facts: {} });
    }
    advance(1000);
    // Pruning must not lose entries still inside their window.
    expect(bridge.handle('Died', { anchors: { target: { entity: 0 } }, facts: {} })).toHaveLength(
      1,
    );
    expect(bridge.handle('Died', { anchors: { target: { entity: 0 } }, facts: {} })).toEqual([]);
  });

  it('attaches to only the events its rules use, reads payloads, and detaches', () => {
    const handlers = new Map<EventType<unknown>, (payload: unknown) => void>();
    const offs: string[] = [];
    const source: CueEventSource = {
      on: <T>(type: EventType<T>, handler: (payload: T) => void) => {
        handlers.set(type as EventType<unknown>, handler as (payload: unknown) => void);
        return () => offs.push(type.name);
      },
    };
    const { bridge, played } = setup(rules({ event: 'Died', cue: 'sfx-death' }));
    const detach = bridge.attach(source);
    expect([...handlers.keys()]).toEqual([Died as EventType<unknown>]);
    handlers.get(Died as EventType<unknown>)?.({
      tick: 1,
      target: 3,
      killer: null,
      source: null,
      tags: [],
    });
    expect(played).toEqual([{ cue: 'sfx-death', options: { entity: 3, volume: 1, pitch: 1 } }]);
    detach();
    expect(offs).toEqual(['Died']);
  });

  it('catches a failing reader and warns instead of throwing into the sim', () => {
    const warn = vi.fn();
    const { bridge } = setup(rules({ event: 'Died', cue: 'sfx-death' }), { warn });
    const world = new World({ seed: 1 });
    bridge.attach(world.events);
    world.events.emit(Died, null as never);
    expect(() => {
      world.step();
    }).not.toThrow();
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/^audio cues: Died failed/));
  });

  it('warns through console.warn by default', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { bridge } = setup(rules({ event: 'Died', cue: 'sfx-death' }));
    const world = new World({ seed: 1 });
    bridge.attach(world.events);
    world.events.emit(Died, null as never);
    world.step();
    expect(spy).toHaveBeenCalledOnce();
    spy.mockRestore();
  });
});

describe('cue captions (mw-e28.14)', () => {
  const step = {
    event: 'LocomotionEvents',
    match: { kind: 'footstep' },
    cue: 'sfx-foot-stone-walk',
  };
  const stepAt = (entity: number): CueReading => ({
    anchors: { entity: { entity } },
    facts: { kind: 'footstep' },
  });

  it('reports a captioned rule with its source position and priority, besides playing it', () => {
    const captions: CaptionTrigger[] = [];
    const { bridge, played } = setup(
      rules({ ...step, caption: 'caption.footsteps', priority: 33 }),
      {
        onCaption: (c) => captions.push(c),
        positionOf: (entity) => ({ x: entity, y: 0, z: 0 }),
      },
    );
    bridge.handle('LocomotionEvents', stepAt(4));
    expect(played).toHaveLength(1);
    expect(captions).toEqual([
      { stringId: 'caption.footsteps', source: 'e4', position: { x: 4, y: 0, z: 0 }, priority: 33 },
    ]);
  });

  it('captions even when the audio de-dupe drops the repeat, and with a default priority', () => {
    const captions: CaptionTrigger[] = [];
    const { bridge, played } = setup(rules({ ...step, caption: 'caption.footsteps' }), {
      onCaption: (c) => captions.push(c),
      positionOf: () => ({ x: 1, y: 0, z: 0 }),
    });
    bridge.handle('LocomotionEvents', stepAt(4));
    bridge.handle('LocomotionEvents', stepAt(4));
    expect(played).toHaveLength(1);
    expect(captions.map((c) => c.priority)).toEqual([
      DEFAULT_CAPTION_PRIORITY,
      DEFAULT_CAPTION_PRIORITY,
    ]);
  });

  it('uses a fixed-position anchor directly and skips sources whose position is unknown', () => {
    const captions: CaptionTrigger[] = [];
    const { bridge } = setup(rules({ ...step, caption: 'caption.footsteps' }), {
      onCaption: (c) => captions.push(c),
    });
    bridge.handle('LocomotionEvents', {
      anchors: { entity: { position: { x: 1, y: 2, z: 3 } } },
      facts: { kind: 'footstep' },
    });
    bridge.handle('LocomotionEvents', stepAt(4)); // an entity with no positionOf
    bridge.handle('LocomotionEvents', { anchors: {}, facts: { kind: 'footstep' } });
    expect(captions.map((c) => c.position)).toEqual([{ x: 1, y: 2, z: 3 }]);
  });

  it('does nothing for rules without a caption or bridges without a caption listener', () => {
    const captions: CaptionTrigger[] = [];
    setup(rules(step), { onCaption: (c) => captions.push(c) }).bridge.handle(
      'LocomotionEvents',
      stepAt(4),
    );
    expect(captions).toEqual([]);
    expect(() =>
      setup(rules({ ...step, caption: 'caption.footsteps' })).bridge.handle(
        'LocomotionEvents',
        stepAt(4),
      ),
    ).not.toThrow();
  });
});

describe('cue bridge helpers', () => {
  it('soundVariantCount reads variant counts from a registry', () => {
    const count = soundVariantCount({
      get: (id) => (id === 'sfx-a' ? { variants: ['1', '2', '3'] } : undefined),
    });
    expect(count('sfx-a')).toBe(3);
    expect(count('sfx-b')).toBeUndefined();
  });

  it('worldCueLookups reads entity materials and their impact classes', () => {
    const world = registerWorldProperties(new World({ seed: 1 }));
    const sword = world.spawn();
    addProperties(world, sword, { material: 'iron' });
    const plain = world.spawn();
    const lookups = worldCueLookups(world, [
      { id: 'iron', impactSound: 'sfx-impact-metal' },
      { id: 'generic', impactSound: 'sfx-impact-stone' },
    ]);
    expect(lookups.materialOf(sword)).toBe('iron');
    expect(lookups.materialOf(plain)).toBe('generic');
    expect(lookups.impactClassOf('iron')).toBe('metal');
    expect(lookups.impactClassOf('unknown')).toBeUndefined();
    world.destroy(sword);
    world.step();
    expect(lookups.materialOf(sword)).toBeUndefined();
  });

  it('worldCueLookups names the footstep surface of a material a character stands in (mw-e02.14)', () => {
    const world = registerWorldProperties(new World({ seed: 1 }));
    const lookups = worldCueLookups(world, [
      { id: 'water', impactSound: 'sfx-impact-water', footstepSurface: 'water-shallow' },
      { id: 'iron', impactSound: 'sfx-impact-metal' },
    ]);
    expect(lookups.surfaceOfMaterial?.('water')).toBe('water-shallow');
    expect(lookups.surfaceOfMaterial?.('iron')).toBeUndefined();
    expect(lookups.surfaceOfMaterial?.('unknown')).toBeUndefined();
  });

  it('worldCueLookups plays a tagged region’s surface when the manifest has its set, else the ground (mw-1jm)', () => {
    const world = registerWorldProperties(new World({ seed: 1 }));
    const sets = new Set(['sfx-foot-gravel-walk', 'sfx-foot-stone-walk']);
    const lookups = worldCueLookups(
      world,
      [
        { id: 'water', impactSound: 'sfx-impact-water', footstepSurface: 'water-shallow' },
        { id: 'iron', impactSound: 'sfx-impact-metal' },
      ],
      { knownCue: (cue) => sets.has(cue) },
    );
    // A region surface with a set plays it; one without (carpet) and unknown names fall back to the ground.
    expect(lookups.surfaceOfMaterial?.('gravel')).toBe('gravel');
    expect(lookups.surfaceOfMaterial?.('carpet')).toBeUndefined();
    // Material ids keep their own mapping, and a material with no set of its own is not a surface.
    expect(lookups.surfaceOfMaterial?.('iron')).toBeUndefined();
    expect(lookups.surfaceOfMaterial?.('water')).toBe('water-shallow');
  });

  it('a DamageApplied through the world bus plays the struck material’s impact cue', () => {
    const world = registerWorldProperties(new World({ seed: 1 }));
    const skeleton = world.spawn();
    addProperties(world, skeleton, { material: 'bone' });
    const sword = world.spawn();
    addProperties(world, sword, { material: 'iron' });
    world.step();
    const played: string[] = [];
    const bridge = new AudioCueBridge({
      sheets: [
        {
          rules: rules(
            { event: 'DamageApplied', cue: 'sfx-impact-{target}' },
            {
              event: 'DamageApplied',
              match: { weapon: 'metal', target: 'bone' },
              cue: 'sfx-metal-bone',
            },
          ),
        },
      ],
      player: { play: (cue) => played.push(cue) },
      now: () => 0,
      lookups: worldCueLookups(world, [
        { id: 'iron', impactSound: 'sfx-impact-metal' },
        { id: 'bone', impactSound: 'sfx-impact-bone' },
      ]),
    });
    bridge.attach(world.events);
    world.events.emit(DamageApplied, {
      tick: 1,
      target: skeleton,
      packet: { instigator: null, source: sword, amounts: { slash: 10 }, tags: [] },
      amounts: { slash: 10 },
      total: 10,
      immune: false,
      poiseDamage: 0,
      staminaDamage: 0,
      tags: [],
      healthBefore: 20,
      healthAfter: 10,
      poiseBroken: false,
      died: false,
    } as never);
    world.step();
    expect(played).toEqual(['sfx-metal-bone']);
  });

  it('AC-2: with the physics cue sheet, a wood crate landing on stone plays sfx-impact-wood at the crate, louder the harder it lands', () => {
    const content = loadGameContent();
    const world = registerWorldProperties(new World({ seed: 1 }));
    const crate = world.spawn();
    addProperties(world, crate, { material: 'wood' });
    const floor = world.spawn();
    addProperties(world, floor, { material: 'stone' });
    world.step();
    const played: { cue: string; options: PlayOptions }[] = [];
    const bridge = new AudioCueBridge({
      sheets: [content.get('cue-sheet', 'physics')],
      player: { play: (cue, options) => played.push({ cue, options }) },
      now: () => world.tick * 1000, // a second per tick: the cooldown never interferes
      lookups: worldCueLookups(world, content.all('material')),
    });
    bridge.attach(world.events);
    const land = (energy: number): void => {
      world.events.emit(physicsImpact, {
        entity: crate,
        other: floor,
        materials: ['wood', 'stone'],
        energy,
        impulse: 10,
        speed: 4,
        normal: { x: 0, y: -1, z: 0 },
        position: { x: 0, y: 0.3, z: 0 },
      });
      world.step();
    };
    land(5);
    land(250);
    expect(played.map((p) => p.cue)).toEqual(['sfx-impact-wood', 'sfx-impact-wood']);
    const [soft, hard] = played.map((p) => p.options);
    expect(soft?.entity).toBe(crate);
    expect(hard?.entity).toBe(crate);
    expect(hard?.volume ?? 0).toBeGreaterThan(soft?.volume ?? 0);
  });
});
