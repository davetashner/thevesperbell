// Creature audio slots through the cue bridge (mw-e28.8): the unblockable telegraph a skeleton plays
// well before its blow lands (a real creature on the real move system), the alert bark and music
// stinger on Suspicious → Alerted, and the hurt, poise break, death and footstep slots.

import { describe, expect, it } from 'vitest';
import type { PlayOptions } from '@audio/index';
import { CREATURE_AUDIO_MIN_LEAD_TICKS } from '@content/index';
import { loadDevContent } from '@content/dev-content';
import { installSandboxRules, prepareTestbedCombat, startTestbedCombat } from '@game/combat/index';
import { prepareCreatures, startCreatures } from '@game/creatures/index';
import { AlertStingerHooks, type MusicStinger } from '@game/music/index';
import {
  actionTimelineSystem,
  ActionPhaseChanged,
  AlertStateChanged,
  CreatureComponent,
  DAMAGE_COMPONENTS,
  DamageApplied,
  Died,
  HIT_VOLUME_COMPONENTS,
  LocomotionEvents,
  PoiseBroken,
  registerCreatureComponents,
  registerWorldProperties,
  startAttack,
  TelegraphStarted,
  World,
  type DamageResult,
  type EntityId,
} from '@sim/index';
import { AudioCueBridge, worldCueLookups } from './audio-bridge.ts';

const content = loadDevContent();
const AUDIO = {
  idleLoop: 'sfx-skel-idle',
  footsteps: 'sfx-skel-step',
  alertBark: 'sfx-skel-bark',
  telegraph: 'sfx-skel-tell',
  unblockableTelegraph: 'sfx-skel-tell-heavy',
  hurt: 'sfx-skel-hurt',
  poiseBreak: 'sfx-skel-stagger',
  death: 'sfx-skel-death',
};
const creatures = [{ id: 'fixture-guard', audio: AUDIO }];

function must<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error('missing test value');
  return value;
}

interface Played {
  readonly cue: string;
  readonly options: PlayOptions;
  readonly tick: number;
}

/** A bare world with a skeleton entity, the cue bridge on it, and everything it plays. */
function setupBare() {
  const world = registerCreatureComponents(registerWorldProperties(new World({ seed: 1 })));
  const played: Played[] = [];
  const captions: string[] = [];
  const bridge = new AudioCueBridge({
    sheets: [content.get('cue-sheet', 'combat'), content.get('cue-sheet', 'creature')],
    player: { play: (cue, options) => played.push({ cue, options, tick: world.tick }) },
    now: () => world.tick * 1000,
    lookups: worldCueLookups(world, content.all('material'), { creatures }),
    onCaption: (c) => captions.push(c.stringId),
    positionOf: () => ({ x: 4, y: 0, z: 2 }),
  });
  bridge.attach(world.events);
  const skeleton = world.spawn();
  world.add(skeleton, CreatureComponent, {
    origin: { creature: 'fixture-guard', at: { x: 4, y: 0, z: 2 }, facing: { x: 0, y: 0, z: 1 } },
    behaviour: 'fixture-guard',
    tuning: {},
    needs: {},
  });
  const stranger = world.spawn(); // not a creature: it has no slots
  world.step();
  return { world, played, captions, skeleton, stranger };
}

const cues = (played: Played[]) => played.map((p) => p.cue);

describe('creature audio slots (mw-e28.8)', () => {
  it('AC-3: Suspicious → Alerted plays the alert bark at the creature and emits a MusicStinger', () => {
    const { world, played, captions, skeleton } = setupBare();
    const stingers: MusicStinger[] = [];
    new AlertStingerHooks({ world }).on((s) => stingers.push(s));
    world.events.emit(AlertStateChanged, {
      tick: world.tick,
      entity: skeleton,
      from: 'suspicious',
      to: 'alerted',
      cause: 'event:saw-target',
    });
    world.step();
    expect(played).toHaveLength(1);
    expect(played[0]?.cue).toBe('sfx-skel-bark');
    expect(played[0]?.options.entity).toBe(skeleton);
    expect(stingers).toEqual([
      {
        type: 'MusicStinger',
        entity: skeleton,
        state: 'alerted',
        from: 'suspicious',
        tick: world.tick - 1,
      },
    ]);
    // The bark is captioned, so sound captions cover barks too.
    expect(captions).toEqual(['caption.alert-bark']);
  });

  it('a bark is once per alarm: Alerted then Combat within moments barks once; a stranger never barks', () => {
    const { world, played, skeleton, stranger } = setupBare();
    const change = (entity: EntityId, from: 'suspicious' | 'alerted', to: 'alerted' | 'combat') => {
      world.events.emit(AlertStateChanged, {
        tick: world.tick,
        entity,
        from,
        to,
        cause: 'timeout',
      });
    };
    change(skeleton, 'suspicious', 'alerted');
    change(skeleton, 'alerted', 'combat');
    change(stranger, 'suspicious', 'alerted');
    world.step();
    expect(cues(played)).toEqual(['sfx-skel-bark']);
  });

  it('hurt, poise break, death and footsteps play the creature’s slots where it stands', () => {
    const { world, played, skeleton, stranger } = setupBare();
    const result = (target: EntityId, extra: Partial<DamageResult> = {}): DamageResult =>
      ({
        tick: 1,
        target,
        packet: { instigator: null, source: null, amounts: { slash: 5 }, tags: [] },
        amounts: { slash: 5 },
        total: 5,
        immune: false,
        poiseDamage: 0,
        staminaDamage: 0,
        tags: [],
        healthBefore: 50,
        healthAfter: 45,
        poiseBroken: false,
        died: false,
        ...extra,
      }) as never;
    world.events.emit(DamageApplied, result(skeleton));
    world.events.emit(DamageApplied, result(stranger));
    world.events.emit(PoiseBroken, { tick: 1, target: skeleton, instigator: null, source: null });
    world.events.emit(LocomotionEvents, {
      tick: 1,
      entity: skeleton,
      kind: 'footstep',
      foot: 'left',
      gait: 'walk',
    } as never);
    world.events.emit(Died, { tick: 1, target: skeleton, killer: null, source: null, tags: [] });
    world.step();
    const creatureCues = cues(played).filter((c) => c.startsWith('sfx-skel-'));
    expect(creatureCues).toEqual([
      'sfx-skel-hurt',
      'sfx-skel-stagger',
      'sfx-skel-step',
      'sfx-skel-death',
    ]);
    expect(
      played
        .filter((p) => p.cue.startsWith('sfx-skel-'))
        .every((p) => p.options.entity === skeleton),
    ).toBe(true);
    // A killing blow is the death cue's, not a hurt too.
    world.events.emit(DamageApplied, result(skeleton, { died: true, healthAfter: 0 }));
    world.step();
    expect(cues(played).filter((c) => c === 'sfx-skel-hurt')).toHaveLength(1);
  });
});

describe('unblockable telegraph on a real skeleton (mw-e28.8)', () => {
  /** The fixture guard's overhead chop made unblockable, run on the real move system. */
  function run() {
    const combat = prepareTestbedCombat(content);
    const game = prepareCreatures(content, combat);
    const chop = must(game.attacks.get('forgotten-overhead-chop'));
    const move = { ...chop.move, unblockable: true, blockable: false, parryable: false };
    (game.attacks as Map<string, unknown>).set('forgotten-overhead-chop', {
      ...chop,
      move,
      chain: [move],
    });
    const world = new World<unknown>({ seed: 1 });
    installSandboxRules(world, combat);
    world.register(...HIT_VOLUME_COMPONENTS, ...DAMAGE_COMPONENTS);
    world.addSystem(actionTimelineSystem({ moves: combat.moves }));
    startTestbedCombat(world, combat, []);
    const w: World<never> = world;
    const spawned = startCreatures(world, game, combat, [
      {
        id: 'skeleton',
        position: { x: 0, y: 0, z: 0 },
        yaw: 0,
        rotation: { x: 0, y: 0, z: 0, w: 1 },
        prop: undefined,
        tags: [],
        creature: 'fixture-guard',
      },
    ]);
    const skeleton = must(spawned.entities[0]);
    const played: Played[] = [];
    registerWorldProperties(w);
    new AudioCueBridge({
      sheets: [content.get('cue-sheet', 'combat'), content.get('cue-sheet', 'creature')],
      player: { play: (cue, options) => played.push({ cue, options, tick: w.tick }) },
      now: () => w.tick * 1000,
      lookups: worldCueLookups(w, content.all('material'), {
        creatures,
        moves: content.all('move'),
      }),
    }).attach(w.events);
    let telegraphTick: number | undefined;
    let activeTick: number | undefined;
    w.events.on(TelegraphStarted, (e) => {
      telegraphTick = e.tick;
    });
    w.events.on(ActionPhaseChanged, (e) => {
      if (e.entity === skeleton && e.phase === 'active') activeTick ??= e.tick;
    });
    startAttack(w, skeleton, must(game.attacks.get('forgotten-overhead-chop')), {
      x: 0,
      y: 0,
      z: 1,
    });
    for (let i = 0; i < 60; i++) world.step([]);
    return { played, telegraphTick, activeTick, skeleton };
  }

  it('AC-2: the unblockable telegraph cue plays at least 250 ms (15 ticks) before the first active tick', () => {
    const { played, telegraphTick, activeTick, skeleton } = run();
    expect(telegraphTick).toBeDefined();
    expect(activeTick).toBeDefined();
    const telegraph = must(played.find((p) => p.cue === 'sfx-skel-tell-heavy'));
    // The unblockable cue, not the creature's ordinary telegraph, at the skeleton, at high priority.
    expect(cues(played)).not.toContain('sfx-skel-tell');
    expect(telegraph.options.entity).toBe(skeleton);
    expect(telegraph.options.priority).toBe(95);
    expect(telegraph.tick).toBe(telegraphTick);
    expect(must(activeTick) - telegraph.tick).toBeGreaterThanOrEqual(CREATURE_AUDIO_MIN_LEAD_TICKS);
  });
});
