// The combat cue sheet (mw-e28.4): the weapon × material impact matrix, blocks, guard breaks,
// whiffs and swing whooshes, run through the real content and the cue bridge on a world's bus.

import { describe, expect, it } from 'vitest';
import type { PlayOptions } from '@audio/index';
import { loadGameContent, type CueRuleDef } from '@content/index';
import {
  ActionPhaseChanged,
  addProperties,
  DamageApplied,
  DodgedHit,
  GuardBroken,
  HitParried,
  WallRecoil,
  registerWorldProperties,
  World,
  type DamageResult,
  type EntityId,
  type System,
} from '@sim/index';
import { AudioCueBridge, worldCueLookups } from './audio-bridge.ts';

const content = loadGameContent();
const combat = content.get('cue-sheet', 'combat');

function setup() {
  const world = registerWorldProperties(new World({ seed: 1 }));
  const played: { cue: string; options: PlayOptions; tick: number }[] = [];
  const bridge = new AudioCueBridge({
    sheets: [combat],
    player: { play: (cue, options) => played.push({ cue, options, tick: world.tick }) },
    now: () => world.tick * 1000, // a second per tick: de-dupe and cooldowns never interfere
    lookups: worldCueLookups(world, content.all('material'), { moves: content.all('move') }),
  });
  bridge.attach(world.events);
  const spawn = (material?: string): EntityId => {
    const entity = world.spawn();
    if (material !== undefined) addProperties(world, entity, { material });
    return entity;
  };
  return { world, played, spawn };
}

/** A resolved hit on `target` with the given damage amounts and tags. */
function hit(
  target: EntityId,
  amounts: Record<string, number>,
  extra: Partial<DamageResult> = {},
): DamageResult {
  const total = Object.values(amounts).reduce((a, b) => a + b, 0);
  return {
    tick: 1,
    target,
    packet: { instigator: null, source: null, amounts, tags: [] } as never,
    amounts: amounts,
    total,
    immune: false,
    poiseDamage: 0,
    staminaDamage: 0,
    tags: [],
    healthBefore: 100,
    healthAfter: 100 - total,
    poiseBroken: false,
    died: false,
    ...extra,
  };
}

/** The priority the combat sheet gives a cue. */
const priorityOf = (cue: string): number | undefined =>
  combat.rules.find((rule: CueRuleDef) => rule.cue === cue)?.priority;

describe('combat impact audio (mw-e28.4)', () => {
  it('AC-1: a sword (slash) hitting a skeleton (bone) plays the blade × bone cue at the victim', () => {
    const { world, played, spawn } = setup();
    const skeleton = spawn('bone');
    world.step();
    world.events.emit(DamageApplied, hit(skeleton, { slash: 20 }));
    world.step();
    expect(played.map((p) => p.cue)).toEqual(['sfx-blade-impact-bone']);
    expect(played[0]?.options.entity).toBe(skeleton);
  });

  it('AC-4: a pair without its own rule plays the attacker’s generic strike, never silence', () => {
    const { world, played, spawn } = setup();
    const bottle = spawn('glass');
    const straw = spawn('straw');
    world.step();
    world.events.emit(DamageApplied, hit(bottle, { slash: 10 }));
    world.events.emit(DamageApplied, hit(straw, { blunt: 10 }));
    world.events.emit(DamageApplied, hit(bottle, { pierce: 10 }));
    // No damage type dealt anything: the struck material's own impact set.
    world.events.emit(DamageApplied, hit(straw, { fire: 0 }));
    world.step();
    expect(played.map((p) => p.cue)).toEqual([
      'sfx-blade-impact',
      'sfx-blunt-impact',
      'sfx-pierce-impact',
      'sfx-impact-straw',
    ]);
  });

  it('attacker sides differ on one target: blade, blunt and point on flesh, bone and metal', () => {
    const { world, played, spawn } = setup();
    const targets = { flesh: spawn('flesh'), bone: spawn('bone'), metal: spawn('iron') };
    world.step();
    for (const target of Object.values(targets)) {
      for (const type of ['slash', 'blunt', 'pierce']) {
        world.events.emit(DamageApplied, hit(target, { [type]: 10 }));
      }
    }
    world.step();
    expect(played.map((p) => p.cue)).toEqual([
      'sfx-blade-impact-flesh',
      'sfx-blunt-impact-flesh',
      'sfx-arrow-impact-flesh',
      'sfx-blade-impact-bone',
      'sfx-blunt-impact-bone',
      'sfx-pierce-impact',
      'sfx-blade-impact-metal',
      'sfx-blunt-impact-metal',
      'sfx-arrow-impact-metal',
    ]);
  });

  it('heavier hits are louder: light < heavy < critical, with a critical accent', () => {
    const { world, played, spawn } = setup();
    const dummy = spawn('flesh');
    world.step();
    const volumeOf = (amounts: Record<string, number>, tags: string[] = []) => {
      played.length = 0;
      world.events.emit(DamageApplied, hit(dummy, amounts, { tags }));
      world.step();
      return played;
    };
    const light = volumeOf({ slash: 12 })[0]?.options.volume ?? 0;
    const heavy = volumeOf({ slash: 32 })[0]?.options.volume ?? 0;
    const critical = volumeOf({ slash: 60 }, ['critical']);
    expect(heavy).toBeGreaterThan(light);
    expect(critical.map((p) => p.cue)).toEqual(['sfx-blade-impact-flesh', 'sfx-combat-critical']);
    const riposte = volumeOf({ slash: 60 }, ['critical', 'riposte']);
    expect(riposte.map((p) => p.cue)).toEqual(['sfx-blade-impact-flesh', 'sfx-knight-riposte']);
  });

  it('a blocked hit plays the shield block (not flesh) above hits; a guard break clangs higher still', () => {
    const { world, played, spawn } = setup();
    const knight = spawn('flesh');
    world.step();
    world.events.emit(DamageApplied, hit(knight, { slash: 2 }, { tags: ['blocked'] }));
    world.events.emit(GuardBroken, {
      tick: 1,
      entity: knight,
      instigator: null,
      source: null,
      staggerTicks: 60,
    });
    world.events.emit(DamageApplied, hit(knight, { slash: 2 }, { immune: true }));
    world.step();
    expect(played.map((p) => p.cue)).toEqual([
      'sfx-knight-block-shield-wood',
      'sfx-knight-guard-break',
      'sfx-combat-glance',
    ]);
    expect(played[0]?.options.entity).toBe(knight);
    const hitPriority = priorityOf('sfx-blade-impact-flesh') ?? 0;
    expect(played[0]?.options.priority).toBeGreaterThan(hitPriority);
    expect(played[1]?.options.priority).toBeGreaterThan(played[0]?.options.priority ?? 100);
  });

  it('mw-e28.19 AC-2: a swing that recoils off a wall clangs at the contact point', () => {
    const { world, played, spawn } = setup();
    const knight = spawn('flesh');
    world.step();
    const point = { x: 2, y: 1.2, z: -4.5 };
    world.events.emit(WallRecoil, {
      tick: 1,
      entity: knight,
      move: 'sword-light-1',
      activeTick: 1,
      point,
      normal: { x: 0, y: 0, z: 1 },
      ticks: 30,
    });
    world.step();
    expect(played.map((p) => p.cue)).toEqual(['sfx-knight-wall-recoil-clang']);
    expect(played[0]?.options.position).toEqual(point);
  });

  it('mw-e28.16: a parry rings at the top voice priority, once, instead of the deflected hit’s impact', () => {
    const { world, played, spawn } = setup();
    const knight = spawn('flesh');
    world.step();
    world.events.emit(HitParried, {
      tick: 1,
      entity: knight,
      attacker: null,
      source: null,
      parriedTicks: 90,
    });
    world.events.emit(DamageApplied, hit(knight, { slash: 0 }, { tags: ['parried', 'parryable'] }));
    world.step();
    expect(played.map((p) => [p.cue, p.options.priority, p.options.entity])).toEqual([
      ['sfx-knight-parry-metal', 100, knight],
    ]);
    // On its own (a later tick), the deflected hit's impact layer names the ring, never flesh.
    world.events.emit(DamageApplied, hit(knight, { slash: 0 }, { tags: ['parried'] }));
    world.step();
    expect(played.map((p) => p.cue)).toEqual(['sfx-knight-parry-metal', 'sfx-knight-parry-metal']);
    expect(priorityOf('sfx-knight-parry-metal')).toBe(100);
  });

  it('a swing whooshes with its move’s own sound as its active phase starts; a dodged swing whiffs', () => {
    const { world, played, spawn } = setup();
    const knight = spawn();
    const dummy = spawn();
    world.step();
    const phase = (move: string, p: 'startup' | 'active' | 'recovery') => {
      world.events.emit(ActionPhaseChanged, {
        tick: 1,
        entity: knight,
        move,
        phase: p,
        moveTick: 1,
      });
    };
    phase('sword-light-1', 'startup');
    phase('sword-light-1', 'active');
    phase('sword-light-1', 'recovery');
    phase('sword-heavy', 'active');
    phase('no-such-move', 'active'); // no sound known: nothing plays
    world.events.emit(DodgedHit, {
      tick: 1,
      attacker: dummy,
      hitbox: 'training-dummy-swing',
      activeTick: 1,
      target: knight,
      hurtbox: 'torso',
      region: 'torso',
      multiplier: 1,
      armored: false,
      direction: { x: 0, y: 0, z: 1 },
    });
    world.step();
    expect(played.map((p) => p.cue)).toEqual([
      'sfx-knight-sword-swing-light',
      'sfx-knight-sword-swing-heavy',
      'sfx-combat-whiff',
    ]);
    expect(played.map((p) => p.options.entity)).toEqual([knight, knight, knight]);
  });

  it('AC-3: the impact cue is sent in the step the hit lands (no deferral), so it starts on the first frozen frame', () => {
    const { world, played, spawn } = setup();
    const skeleton = spawn('bone');
    const strike: System<unknown> = {
      name: 'test-strike',
      run: ({ world: w }) => {
        if (w.tick === 3) w.events.emit(DamageApplied, hit(skeleton, { slash: 32 }));
      },
    };
    world.addSystem(strike);
    const sentAfterStep: number[] = [];
    for (let i = 0; i < 5; i++) {
      world.step();
      sentAfterStep.push(played.length);
    }
    // Emitted during tick 3's step: sent to the engine before that step returns (before the frame
    // renders), with no start delay in its options.
    expect(sentAfterStep).toEqual([0, 0, 0, 1, 1]);
    expect(played[0]?.cue).toBe('sfx-blade-impact-bone');
    expect(Object.keys(played[0]?.options ?? {})).not.toContain('delay');
  });
});
