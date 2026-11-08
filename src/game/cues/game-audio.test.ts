import { describe, expect, it, vi } from 'vitest';
import { cueRuleSchema } from '@content/index';
import {
  ActionPhaseChanged,
  addProperties,
  arrowImpact,
  Died,
  LocomotionEvents,
  registerWorldProperties,
  World,
  type EntityId,
} from '@sim/index';
import { attachGameAudio, soundPositions, type GameAudioEngine } from './game-audio.ts';

function setup() {
  const world = registerWorldProperties(new World({ seed: 1 }));
  let state = 'suspended';
  const play = vi.fn<(cue: string, options: unknown) => null>(() => null);
  const engine: GameAudioEngine = {
    get context() {
      return state === 'none' ? undefined : { state };
    },
    play,
  };
  const onPlay = vi.fn();
  const detach = attachGameAudio({
    world,
    engine,
    registry: {
      get: (id) => (id === 'sfx-combat-death-bone' ? { variants: ['a', 'b'] } : undefined),
    },
    sheets: [{ rules: [cueRuleSchema.parse({ event: 'Died', cue: 'sfx-combat-death-{target}' })] }],
    materials: [
      { id: 'bone', impactSound: 'sfx-impact-bone' },
      { id: 'generic', impactSound: 'sfx-impact-stone' },
    ],
    now: () => 0,
    onPlay,
  });
  const skeleton = world.spawn();
  addProperties(world, skeleton, { material: 'bone' });
  const die = (target: EntityId) => {
    world.events.emit(Died, { tick: world.tick, target, killer: null, source: null, tags: [] });
    world.step();
  };
  return {
    world,
    skeleton,
    play,
    onPlay,
    detach,
    die,
    setState: (s: string) => {
      state = s;
    },
  };
}

describe('game audio wiring (mw-e28.2)', () => {
  it('plays nothing before the first gesture lets the context run (autoplay policy)', () => {
    const { skeleton, play, onPlay, die, setState } = setup();
    die(skeleton);
    setState('none');
    die(skeleton);
    expect(play).not.toHaveBeenCalled();
    expect(onPlay).not.toHaveBeenCalled();
  });

  it('once running, sim events play their cue sheet sounds through the engine, by material', () => {
    const { world, skeleton, play, onPlay, detach, die, setState } = setup();
    setState('running');
    die(skeleton);
    expect(play).toHaveBeenCalledOnce();
    expect(play.mock.calls[0]?.[0]).toBe('sfx-combat-death-bone');
    const options = play.mock.calls[0]?.[1] as { entity: number; variant: number };
    expect(options.entity).toBe(skeleton);
    expect([0, 1]).toContain(options.variant);
    expect(onPlay).toHaveBeenCalledWith('sfx-combat-death-bone', options);
    const plain = world.spawn();
    die(plain);
    expect(play.mock.calls[1]?.[0]).toBe('sfx-combat-death-stone');
    detach();
    die(world.spawn());
    expect(play).toHaveBeenCalledTimes(2);
  });

  it('reports captioned cues with their position, even before the audio context runs', () => {
    const world = registerWorldProperties(new World({ seed: 1 }));
    const onCaption = vi.fn();
    const target = world.spawn();
    attachGameAudio({
      world,
      engine: { context: undefined, play: vi.fn(() => null) },
      registry: { get: () => undefined },
      sheets: [
        {
          rules: [
            cueRuleSchema.parse({ event: 'Died', cue: 'sfx-death', caption: 'caption.breaking' }),
          ],
        },
      ],
      materials: [],
      now: () => 0,
      onCaption,
      positionOf: (entity) => (entity === target ? { x: 1, y: 2, z: 3 } : undefined),
    });
    world.events.emit(Died, { tick: 0, target, killer: null, source: null, tags: [] });
    world.step();
    expect(onCaption).toHaveBeenCalledWith({
      stringId: 'caption.breaking',
      source: `e${String(target)}`,
      position: { x: 1, y: 2, z: 3 },
      priority: 50,
    });
  });

  it('works without an onPlay probe', () => {
    const world = registerWorldProperties(new World({ seed: 1 }));
    const play = vi.fn(() => null);
    attachGameAudio({
      world,
      engine: { context: { state: 'running' }, play },
      registry: { get: () => undefined },
      sheets: [{ rules: [cueRuleSchema.parse({ event: 'Died', cue: 'sfx-death' })] }],
      materials: [],
      now: () => 0,
    });
    world.events.emit(Died, {
      tick: 0,
      target: world.spawn(),
      killer: null,
      source: null,
      tags: [],
    });
    world.step();
    expect(play).toHaveBeenCalledWith('sfx-death', expect.any(Object));
  });

  it('passes moves and the armour lookup to the cue lookups (swing whooshes, armour layers)', () => {
    const world = registerWorldProperties(new World({ seed: 1 }));
    const play = vi.fn(() => null);
    attachGameAudio({
      world,
      engine: { context: { state: 'running' }, play },
      registry: { get: () => undefined },
      sheets: [
        {
          rules: [
            cueRuleSchema.parse({ event: 'ActionPhaseChanged', cue: '{sound}' }),
            cueRuleSchema.parse({
              event: 'LocomotionEvents',
              match: { armor: 'plate' },
              cue: 'sfx-armor-plate-layer',
            }),
          ],
        },
      ],
      materials: [],
      moves: [
        { id: 'kick', presentation: { anim: 'anim-knight-kick', audioCue: 'sfx-knight-kick' } },
      ],
      armorOf: () => 'plate',
      now: () => 0,
    });
    const knight = world.spawn();
    world.events.emit(ActionPhaseChanged, {
      tick: 0,
      entity: knight,
      move: 'kick',
      phase: 'active',
      moveTick: 3,
    });
    world.events.emit(LocomotionEvents, { tick: 0, entity: knight, kind: 'jumpStart' });
    world.step();
    expect(play.mock.calls.map((call) => (call as unknown[])[0])).toEqual([
      'sfx-knight-kick',
      'sfx-armor-plate-layer',
    ]);
  });

  it('passes arrows to the cue lookups (an arrow’s own impact sound)', () => {
    const world = registerWorldProperties(new World({ seed: 1 }));
    const play = vi.fn(() => null);
    attachGameAudio({
      world,
      engine: { context: { state: 'running' }, play },
      registry: { get: () => undefined },
      sheets: [{ rules: [cueRuleSchema.parse({ event: 'arrowImpact', cue: '{sound}' })] }],
      materials: [],
      arrows: [
        {
          id: 'water',
          cues: {
            trailVfx: 'vfx-trail',
            flightSfx: 'sfx-arrow-flyby',
            impactSfx: 'sfx-arrow-water-splash',
          },
        },
      ],
      now: () => 0,
    });
    world.events.emit(arrowImpact, {
      tick: 0,
      entity: world.spawn(),
      arrow: 'water',
      shooter: null,
      other: null,
      material: 'stone',
      hardness: 'hard',
      outcome: 'drop',
      speed: 20,
      energy: 10,
      impulse: 0.5,
      normal: { x: 0, y: 1, z: 0 },
      position: { x: 0, y: 0, z: 0 },
    });
    world.step();
    expect(play.mock.calls.map((call) => (call as unknown[])[0])).toEqual([
      'sfx-arrow-water-splash',
    ]);
  });

  it('soundPositions asks each transform reader in turn', () => {
    const world = new World({ seed: 1 });
    const rotation = { x: 0, y: 0, z: 0, w: 1 };
    const position = soundPositions(world, [
      (_, entity) => (entity === 1 ? { position: { x: 1, y: 0, z: 0 }, rotation } : undefined),
      (_, entity) => (entity === 2 ? { position: { x: 2, y: 0, z: 0 }, rotation } : undefined),
    ]);
    expect(position(1)).toEqual({ x: 1, y: 0, z: 0 });
    expect(position(2)).toEqual({ x: 2, y: 0, z: 0 });
    expect(position(3)).toBeUndefined();
  });
});
