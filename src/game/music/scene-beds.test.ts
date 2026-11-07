import { describe, expect, it, vi } from 'vitest';
import { BED_FADE_OUT_S, SCENE_BEDS, SceneBeds, type BedEngine } from './scene-beds.ts';

const BED = SCENE_BEDS[0];
if (BED === undefined) throw new Error('no beds');

function setup(scene = 'marsh-store', contextState = 'running') {
  let state = contextState;
  const played: string[] = [];
  const handles: { stop: ReturnType<typeof vi.fn> }[] = [];
  const engine: BedEngine = {
    get context() {
      return state === 'none' ? undefined : { state };
    },
    play: (cue) => {
      played.push(cue);
      const handle = { cueId: cue, state: 'playing' as const, stop: vi.fn(), fade: vi.fn() };
      handles.push(handle);
      return handle;
    },
  };
  return {
    beds: new SceneBeds({ engine, scene }),
    played,
    handles,
    setState: (value: string) => {
      state = value;
    },
  };
}

describe('SceneBeds (mw-ju8.11)', () => {
  it('AC-2: the store plays its shop theme once and keeps it for the whole scene', () => {
    const t = setup();
    t.beds.update();
    t.beds.update();
    expect(t.played).toEqual([BED.cue]);
    expect(t.beds.started).toBe(true);
  });

  it('AC-2: nothing is requested until the audio context is running', () => {
    const t = setup('marsh-store', 'suspended');
    t.beds.update();
    expect(t.played).toEqual([]);
    t.setState('running');
    t.beds.update();
    expect(t.played).toEqual([BED.cue]);
  });

  it('AC-2: with no audio context at all it stays quiet', () => {
    const t = setup('marsh-store', 'none');
    t.beds.update();
    expect(t.played).toEqual([]);
  });

  it('AC-2: other scenes have no bed', () => {
    const t = setup('briar-glen-lane');
    t.beds.update();
    expect(t.played).toEqual([]);
    expect(t.beds.started).toBe(false);
  });

  it('AC-2: dispose fades the bed out and lets it start afresh', () => {
    const t = setup();
    t.beds.update();
    t.beds.dispose();
    expect(t.handles[0]?.stop).toHaveBeenCalledWith(BED_FADE_OUT_S);
    expect(t.beds.started).toBe(false);
    t.beds.update();
    expect(t.played).toHaveLength(2);
  });
});
