import { describe, expect, it, vi } from 'vitest';
import type { PlayOptions } from '@audio/index';
import { PlacementComponent, registerWorldProperties, World, type EntityId } from '@sim/index';
import { BED_CROSSFADE_S, SCENE_BEDS, SceneBeds, type BedEngine } from './scene-beds.ts';

const BED = SCENE_BEDS[0];
if (BED === undefined) throw new Error('no beds');

function setup(scene = 'marsh-store', contextState = 'running') {
  const world = registerWorldProperties(new World({ seed: 1 }));
  world.register(PlacementComponent);
  let state = contextState;
  const played: { cue: string; options: PlayOptions | undefined }[] = [];
  const handles: { stop: ReturnType<typeof vi.fn>; fade: ReturnType<typeof vi.fn> }[] = [];
  const engine: BedEngine = {
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
  let player: EntityId | undefined;
  const beds = new SceneBeds({ world, engine, scene, player: () => player });
  const spawn = (y: number): EntityId => {
    const entity = world.spawn();
    world.add(entity, PlacementComponent, { x: 0, y, z: 0, radius: 0 });
    player = entity;
    return entity;
  };
  const bare = (): void => {
    player = world.spawn();
  };
  const moveTo = (y: number): void => {
    if (player === undefined) throw new Error('no player');
    world.add(player, PlacementComponent, { x: 0, y, z: 0, radius: 0 });
  };
  return {
    beds,
    played,
    handles,
    spawn,
    bare,
    moveTo,
    setState: (value: string) => {
      state = value;
    },
  };
}

describe('SceneBeds (mw-ju8.11)', () => {
  it('AC-2: the ground floor plays the shop theme once, however long you stay', () => {
    const t = setup();
    t.spawn(0);
    t.beds.update();
    t.beds.update();
    expect(t.played).toEqual([{ cue: BED.ground, options: undefined }]);
    expect(t.beds.floor).toBe('ground');
  });

  it('AC-2: arriving upstairs starts the home variant', () => {
    const t = setup();
    t.spawn(3);
    t.beds.update();
    expect(t.played.map((p) => p.cue)).toEqual([BED.upper]);
    expect(t.beds.floor).toBe('upper');
  });

  it('AC-3: climbing the stair crossfades to the home variant, and back down again', () => {
    const t = setup();
    t.spawn(0);
    t.beds.update();
    t.moveTo(1.5);
    t.beds.update();
    expect(t.played).toHaveLength(1);
    t.moveTo(2.6);
    t.beds.update();
    expect(t.handles[0]?.stop).toHaveBeenCalledWith(BED_CROSSFADE_S);
    expect(t.played[1]).toEqual({ cue: BED.upper, options: { volume: 0 } });
    expect(t.handles[1]?.fade).toHaveBeenCalledWith(1, BED_CROSSFADE_S);
    t.moveTo(2.2); // on the stair: no flip back (hysteresis)
    t.beds.update();
    expect(t.played).toHaveLength(2);
    t.moveTo(1.9);
    t.beds.update();
    expect(t.handles[1]?.stop).toHaveBeenCalledWith(BED_CROSSFADE_S);
    expect(t.played[2]).toEqual({ cue: BED.ground, options: { volume: 0 } });
    expect(t.beds.floor).toBe('ground');
  });

  it('AC-2: nothing is requested until the audio context runs and the player is placed', () => {
    const t = setup('marsh-store', 'suspended');
    t.beds.update();
    t.setState('running');
    t.beds.update(); // no player yet
    expect(t.played).toEqual([]);
    t.spawn(0);
    t.beds.update();
    expect(t.played).toHaveLength(1);
  });

  it('AC-2: with no audio context at all it stays quiet', () => {
    const t = setup('marsh-store', 'none');
    t.spawn(0);
    t.beds.update();
    expect(t.played).toEqual([]);
  });

  it('AC-2: a player with no placement waits', () => {
    const t = setup();
    t.bare();
    t.beds.update();
    expect(t.played).toEqual([]);
    t.spawn(0);
    t.beds.update();
    expect(t.played).toHaveLength(1);
  });

  it('AC-2: other scenes have no floor bed', () => {
    const t = setup('briar-glen-lane');
    t.spawn(0);
    t.beds.update();
    expect(t.played).toEqual([]);
    expect(t.beds.floor).toBeUndefined();
  });

  it('AC-2: dispose fades the bed out and lets it start afresh', () => {
    const t = setup();
    t.spawn(0);
    t.beds.update();
    t.beds.dispose();
    expect(t.handles[0]?.stop).toHaveBeenCalledWith(BED_CROSSFADE_S);
    expect(t.beds.floor).toBeUndefined();
    t.beds.update();
    expect(t.played).toHaveLength(2);
  });
});
