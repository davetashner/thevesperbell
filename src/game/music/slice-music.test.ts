import { describe, expect, it, vi } from 'vitest';
import type { PlayOptions, SoundHandle } from '@audio/index';
import { AlertStateChanged, Died, registerWorldProperties, World } from '@sim/index';
import {
  COMBAT_EXIT_DELAY_MS,
  COMBAT_FADE_IN_S,
  COMBAT_FADE_OUT_S,
  EXPLORE_DUCK_S,
  EXPLORE_RESTORE_S,
  SLICE_MUSIC_CUES,
  SliceMusic,
  type MusicEngine,
} from './slice-music.ts';

interface FakeHandle extends SoundHandle {
  readonly stop: ReturnType<typeof vi.fn<(fade?: number) => void>>;
  readonly fade: ReturnType<typeof vi.fn<(volume: number, seconds: number) => void>>;
}

function setup(contextState = 'running') {
  const world = registerWorldProperties(new World({ seed: 1 }));
  let state = contextState;
  let time = 0;
  const handles: FakeHandle[] = [];
  const played: { cue: string; options: PlayOptions | undefined }[] = [];
  const engine: MusicEngine = {
    get context() {
      return state === 'none' ? undefined : { state };
    },
    play: (cue, options) => {
      played.push({ cue, options });
      const handle: FakeHandle = {
        cueId: cue,
        state: 'playing',
        stop: vi.fn(),
        fade: vi.fn(),
      };
      handles.push(handle);
      return handle;
    },
    setBusGain: vi.fn(),
  };
  const music = new SliceMusic({ world, engine, now: () => time });
  const handle = (index: number): FakeHandle => {
    const found = handles[index];
    if (found === undefined) throw new Error(`no handle ${String(index)}`);
    return found;
  };
  const creature = world.spawn();
  const other = world.spawn();
  const alert = (entity: number, from: 'unaware' | 'combat', to: 'unaware' | 'combat'): void => {
    world.events.emit(AlertStateChanged, { tick: 0, entity, from, to, cause: 'test' });
    world.step();
  };
  const die = (target: number): void => {
    world.events.emit(Died, { tick: 0, target, killer: null, source: null, tags: [] });
    world.step();
  };
  return {
    world,
    music,
    played,
    handles,
    handle,
    creature,
    other,
    alert,
    die,
    setState: (value: string) => {
      state = value;
    },
    advance: (ms: number) => {
      time += ms;
    },
  };
}

describe('SliceMusic (mw-0j5)', () => {
  it('AC-1: nothing is requested until the audio context is running', () => {
    const t = setup('suspended');
    t.music.update();
    expect(t.played).toEqual([]);
    expect(t.music.state.started).toBe(false);
    t.setState('running');
    t.music.update();
    expect(t.played.map((p) => p.cue)).toEqual([SLICE_MUSIC_CUES.explore]);
    t.music.update();
    expect(t.played).toHaveLength(1);
  });

  it('AC-1: with no context at all it stays quiet', () => {
    const t = setup('none');
    t.music.update();
    expect(t.played).toEqual([]);
  });

  it('AC-2: entering combat ducks the explore bed and fades the combat loop in at once', () => {
    const t = setup();
    t.music.update();
    t.alert(t.creature, 'unaware', 'combat');
    t.music.update();
    expect(t.music.state.inCombat).toBe(true);
    const explore = t.handle(0);
    expect(explore.fade).toHaveBeenCalledWith(0, EXPLORE_DUCK_S);
    expect(t.played[1]).toEqual({ cue: SLICE_MUSIC_CUES.combat, options: { volume: 0 } });
    expect(t.handle(1).fade).toHaveBeenCalledWith(1, COMBAT_FADE_IN_S);
  });

  it('AC-3: leaving combat waits 4 s of no combat, then fades out and restores the explore bed', () => {
    const t = setup();
    t.music.update();
    t.alert(t.creature, 'unaware', 'combat');
    t.music.update();
    t.alert(t.creature, 'combat', 'unaware');
    t.music.update();
    t.advance(COMBAT_EXIT_DELAY_MS - 1);
    t.music.update();
    expect(t.music.state.inCombat).toBe(true);
    t.advance(1);
    t.music.update();
    expect(t.music.state.inCombat).toBe(false);
    expect(t.handle(1).stop).toHaveBeenCalledWith(COMBAT_FADE_OUT_S);
    expect(t.handle(0).fade).toHaveBeenLastCalledWith(1, EXPLORE_RESTORE_S);
  });

  it('AC-3: going back into combat inside the delay keeps the same loop playing', () => {
    const t = setup();
    t.music.update();
    t.alert(t.creature, 'unaware', 'combat');
    t.music.update();
    t.alert(t.creature, 'combat', 'unaware');
    t.music.update();
    t.advance(3000);
    t.alert(t.creature, 'unaware', 'combat');
    t.music.update();
    t.advance(3000);
    t.music.update();
    expect(t.music.state.inCombat).toBe(true);
    expect(t.played.filter((p) => p.cue === SLICE_MUSIC_CUES.combat)).toHaveLength(1);
  });

  it('AC-4: a death ends that creature’s combat; music stays while another still fights', () => {
    const t = setup();
    t.music.update();
    t.alert(t.creature, 'unaware', 'combat');
    t.alert(t.other, 'unaware', 'combat');
    t.music.update();
    t.die(t.creature);
    t.advance(COMBAT_EXIT_DELAY_MS * 2);
    t.music.update();
    expect(t.music.state.inCombat).toBe(true);
    t.die(t.other);
    t.music.update();
    t.advance(COMBAT_EXIT_DELAY_MS);
    t.music.update();
    expect(t.music.state.inCombat).toBe(false);
  });

  it('AC-5: dispose stops every bed, unsubscribes and allows a restart', () => {
    const t = setup();
    t.music.update();
    t.alert(t.creature, 'unaware', 'combat');
    t.music.update();
    t.music.dispose();
    for (const handle of t.handles) expect(handle.stop).toHaveBeenCalledWith(1);
    t.alert(t.other, 'unaware', 'combat');
    t.music.update();
    expect(t.music.state).toEqual({ started: true, inCombat: false });
  });

  it('AC-6: a cue the engine refuses (null handle) never breaks the combat flow', () => {
    const world = registerWorldProperties(new World({ seed: 1 }));
    let time = 0;
    const music = new SliceMusic({
      world,
      engine: { context: { state: 'running' }, play: () => null, setBusGain: vi.fn() },
      now: () => time,
    });
    const creature = world.spawn();
    music.update();
    world.events.emit(AlertStateChanged, {
      tick: 0,
      entity: creature,
      from: 'unaware',
      to: 'combat',
      cause: 'test',
    });
    world.step();
    music.update();
    expect(music.state.inCombat).toBe(true);
    world.events.emit(Died, { tick: 0, target: creature, killer: null, source: null, tags: [] });
    world.step();
    music.update();
    time += COMBAT_EXIT_DELAY_MS;
    music.update();
    expect(music.state.inCombat).toBe(false);
    music.dispose();
  });

  it('AC-7: alert changes that do not involve combat leave the score alone', () => {
    const t = setup();
    t.music.update();
    t.alert(t.creature, 'unaware', 'unaware');
    t.music.update();
    expect(t.music.state.inCombat).toBe(false);
    expect(t.played).toHaveLength(1);
  });
});
