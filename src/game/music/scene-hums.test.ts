import { describe, expect, it, vi } from 'vitest';
import type { PlayOptions } from '@audio/index';
import { CreatureComponent, registerWorldProperties, World, type EntityId } from '@sim/index';
import { SCENE_HUMS, HUM_FADE_OUT_S, SceneHums, type HumEngine } from './scene-hums.ts';

const OTTILIE = SCENE_HUMS[0];
if (OTTILIE === undefined) throw new Error('no hums');

function setup(scene = 'marsh-store', contextState = 'running') {
  const world = registerWorldProperties(new World({ seed: 1 }));
  world.register(CreatureComponent);
  let state = contextState;
  const played: { cue: string; options: PlayOptions | undefined }[] = [];
  const handles: { stop: ReturnType<typeof vi.fn>; fade: ReturnType<typeof vi.fn> }[] = [];
  const engine: HumEngine = {
    get context() {
      return state === 'none' ? undefined : { state };
    },
    play: (cue, options) => {
      played.push({ cue, options });
      const handle = { cueId: cue, state: 'playing' as const, stop: vi.fn(), fade: vi.fn() };
      handles.push(handle);
      return handle;
    },
  };
  const hums = new SceneHums({ world, engine, scene });
  const creature = (point: string | undefined): EntityId => {
    const entity = world.spawn();
    world.add(entity, CreatureComponent, {
      origin: {
        creature: 'npc-ottilie',
        at: { x: -2, y: 0, z: 3 },
        facing: { x: 0, y: 0, z: -1 },
        ...(point === undefined ? {} : { point }),
      },
      behaviour: 'shopkeeper',
      tuning: {},
      needs: {},
    });
    return entity;
  };
  return {
    world,
    hums,
    played,
    handles,
    creature,
    setState: (value: string) => {
      state = value;
    },
  };
}

describe('SceneHums (mw-ju8.40)', () => {
  it('AC-2: the hum plays on the entity that came from Ottilie’s spawn point, once', () => {
    const t = setup();
    const ottilie = t.creature(OTTILIE.point);
    t.creature('some-other-spawn');
    t.creature(undefined);
    t.hums.update();
    t.hums.update();
    expect(t.played).toEqual([{ cue: OTTILIE.cue, options: { entity: ottilie } }]);
    expect(t.hums.count).toBe(1);
  });

  it('AC-2: nothing is requested until the audio context is running', () => {
    const t = setup('marsh-store', 'suspended');
    t.creature(OTTILIE.point);
    t.hums.update();
    expect(t.played).toEqual([]);
    t.setState('running');
    t.hums.update();
    expect(t.played).toHaveLength(1);
  });

  it('AC-2: with no audio context at all it stays quiet', () => {
    const t = setup('marsh-store', 'none');
    t.creature(OTTILIE.point);
    t.hums.update();
    expect(t.played).toEqual([]);
  });

  it('AC-2: other scenes have no hum', () => {
    const t = setup('briar-glen-lane');
    t.creature(OTTILIE.point);
    t.hums.update();
    expect(t.played).toEqual([]);
    expect(t.hums.count).toBe(0);
  });

  it('AC-2: a hum waits for its creature and moves to the respawned one', () => {
    const t = setup();
    t.hums.update();
    expect(t.played).toEqual([]);
    const first = t.creature(OTTILIE.point);
    t.hums.update();
    expect(t.played[0]?.options?.entity).toBe(first);
    t.world.destroy(first);
    t.hums.update();
    expect(t.handles[0]?.stop).toHaveBeenCalledWith(HUM_FADE_OUT_S);
    expect(t.hums.count).toBe(0);
    const second = t.creature(OTTILIE.point);
    t.hums.update();
    expect(t.played[1]?.options?.entity).toBe(second);
  });

  it('AC-2: dispose fades the hum out', () => {
    const t = setup();
    t.creature(OTTILIE.point);
    t.hums.update();
    t.hums.dispose();
    expect(t.handles[0]?.stop).toHaveBeenCalledWith(HUM_FADE_OUT_S);
    expect(t.hums.count).toBe(0);
  });
});
