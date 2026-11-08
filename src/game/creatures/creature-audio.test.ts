// Creature idle loops (mw-e28.8): started per live creature, stopped on death within 200 ms.

import { describe, expect, it } from 'vitest';
import type { PlayOptions, SoundHandle } from '@audio/index';
import { loadGameContent } from '@content/index';
import { AudioCueBridge, worldCueLookups } from '@game/cues/audio-bridge';
import {
  CreatureComponent,
  Died,
  registerCreatureComponents,
  registerWorldProperties,
  World,
  type EntityId,
} from '@sim/index';
import { CreatureIdleLoops, IDLE_STOP_S, type IdleLoopEngine } from './creature-audio.ts';

const content = loadGameContent();
const AUDIO = {
  idleLoop: 'sfx-t-idle',
  footsteps: 'sfx-t-step',
  alertBark: 'sfx-t-bark',
  telegraph: 'sfx-t-tele',
  hurt: 'sfx-t-hurt',
  poiseBreak: 'sfx-t-stagger',
  death: 'sfx-t-death',
};
const creatures = [
  { id: 'skeleton', audio: AUDIO },
  { id: 'mute', audio: { ...AUDIO, idleLoop: undefined } },
];

function setup(state = 'running') {
  const world = registerCreatureComponents(registerWorldProperties(new World({ seed: 1 })));
  const stops: { cue: string; fade: number | undefined }[] = [];
  const played: { cue: string; options: PlayOptions | undefined }[] = [];
  let context: { state: string } | undefined = { state };
  const engine: IdleLoopEngine = {
    get context() {
      return context;
    },
    play(cue, options) {
      played.push({ cue, options });
      if (cue === 'sfx-unknown') return null;
      return {
        cueId: cue,
        state: 'playing',
        stop: (fade) => stops.push({ cue, fade }),
        fade: () => undefined,
      } satisfies SoundHandle;
    },
  };
  const loops = new CreatureIdleLoops({ world, engine, creatures });
  const spawn = (creature: string): EntityId => {
    const entity = world.spawn();
    world.add(entity, CreatureComponent, {
      origin: { creature, at: { x: 0, y: 0, z: 0 }, facing: { x: 0, y: 0, z: 1 } },
      behaviour: 'x',
      tuning: {},
      needs: {},
    });
    world.step();
    return entity;
  };
  return {
    world,
    loops,
    stops,
    played,
    spawn,
    setContext: (next: { state: string } | undefined) => (context = next),
  };
}

describe('creature idle loops (mw-e28.8)', () => {
  it('starts one loop per creature that has one, following it, once audio is running', () => {
    const { loops, played, spawn, setContext } = setup('suspended');
    const skeleton = spawn('skeleton');
    spawn('mute');
    loops.update();
    expect(played).toEqual([]);
    setContext({ state: 'running' });
    loops.update();
    loops.update();
    expect(played).toEqual([{ cue: 'sfx-t-idle', options: { entity: skeleton } }]);
    expect(loops.count).toBe(1);
    setContext(undefined);
    spawn('skeleton');
    loops.update();
    expect(played).toHaveLength(1);
  });

  it('AC-4: on Died the idle loop stops within 200 ms and the death cue plays', () => {
    const { world, loops, stops, spawn } = setup();
    const skeleton = spawn('skeleton');
    loops.update();
    expect(loops.count).toBe(1);
    const deaths: string[] = [];
    new AudioCueBridge({
      sheets: [content.get('cue-sheet', 'creature')],
      player: { play: (cue) => deaths.push(cue) },
      now: () => world.tick * 1000,
      lookups: worldCueLookups(world, content.all('material'), { creatures }),
    }).attach(world.events);
    world.events.emit(Died, { tick: 1, target: skeleton, killer: null, source: null, tags: [] });
    world.step();
    expect(stops).toEqual([{ cue: 'sfx-t-idle', fade: IDLE_STOP_S }]);
    expect(IDLE_STOP_S * 1000).toBeLessThanOrEqual(200);
    expect(deaths).toEqual(['sfx-t-death']);
    expect(loops.count).toBe(0);
    // The corpse is still in the world this frame: its loop does not restart.
    loops.update();
    expect(loops.count).toBe(0);
  });

  it('stops the loop of a creature that is gone, ignores deaths of others, and disposes cleanly', () => {
    const { world, loops, stops, spawn } = setup();
    const gone = spawn('skeleton');
    const stays = spawn('skeleton');
    loops.update();
    expect(loops.count).toBe(2);
    world.events.emit(Died, {
      tick: 1,
      target: world.spawn(),
      killer: null,
      source: null,
      tags: [],
    });
    world.destroy(gone);
    world.step();
    loops.update();
    expect(stops).toHaveLength(1);
    expect(loops.count).toBe(1);
    // A killed creature that is then despawned can come back (respawn) with a fresh entity.
    world.events.emit(Died, { tick: 2, target: stays, killer: null, source: null, tags: [] });
    world.destroy(stays);
    world.step();
    loops.update();
    loops.dispose();
    expect(stops).toHaveLength(2);
    expect(loops.count).toBe(0);
  });

  it('a loop whose cue is unknown makes no handle and the creature is simply silent', () => {
    const world = registerCreatureComponents(registerWorldProperties(new World({ seed: 1 })));
    const engine: IdleLoopEngine = { context: { state: 'running' }, play: () => null };
    const loops = new CreatureIdleLoops({ world, engine, creatures });
    const entity = world.spawn();
    world.add(entity, CreatureComponent, {
      origin: { creature: 'skeleton', at: { x: 0, y: 0, z: 0 }, facing: { x: 0, y: 0, z: 1 } },
      behaviour: 'x',
      tuning: {},
      needs: {},
    });
    world.step();
    loops.update();
    expect(loops.count).toBe(0);
    loops.dispose();
  });

  it('with no creature loops declared it does nothing at all', () => {
    const world = registerCreatureComponents(new World({ seed: 1 }));
    const play = () => {
      throw new Error('must not play');
    };
    const loops = new CreatureIdleLoops({
      world,
      engine: { context: { state: 'running' }, play },
      creatures: [],
    });
    loops.update();
    expect(loops.count).toBe(0);
  });
});
