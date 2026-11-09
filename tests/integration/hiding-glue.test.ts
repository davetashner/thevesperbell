import 'fake-indexeddb/auto';
// Hiding spots in the game (mw-e03.23): the hiding room's spots as the game makes them, their greybox
// looks and poses, the peek view and the readout the e2e reads.
import * as RAPIER from '@dimforge/rapier3d-deterministic';
import {
  actionButton,
  actionFrame,
  actionVector,
  hidingOf,
  makeHidingSpot,
  PlayerLook,
  teleportCommand,
  type ActionFrame,
  type EntityId,
  type World,
} from '@sim/index';
import { createGameSaveRegistry } from '@game/save/sections';
import { AutosaveScheduler } from '@game/save/autosave/scheduler';
import { SaveSlots } from '@game/save/slots/index';
import { IndexedDbSaveStore } from '@game/save/storage/index';
import { IDBFactory } from 'fake-indexeddb';
import { isHidden } from '@sim/index';
import { createGameWorld } from '@tools/replay/testbed-player-scenario';
import { describe, expect, it } from 'vitest';
import {
  HIDING_VETO_ID,
  hidingVeto,
  HIDING_VETO_REASON,
  hasHiding,
  HidingWatch,
  peekView,
  readHidingSpot,
  spotLooks,
} from '@game/hiding/index';

const IDLE: ActionFrame = actionFrame({
  move: actionVector(0, 0),
  look: actionVector(0, 0),
  buttons: () => actionButton(false, false, false),
});
const PRESS: ActionFrame = actionFrame({
  move: actionVector(0, 0),
  look: actionVector(0, 0),
  buttons: (action) => actionButton(action === 'interact', action === 'interact', false),
});

function game() {
  const g = createGameWorld<ActionFrame>(RAPIER, { seed: 1, hz: 60, scene: 'hiding-room' });
  const sim = g.world as unknown as World<never>;
  for (let i = 0; i < 4; i++) g.world.step([IDLE]);
  return { g, sim };
}

/** A value the test knows is there. */
function must<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('missing');
  return value;
}

describe('hiding in the game (mw-e03.23)', () => {
  it('the hiding room has hiding spots, and without them a scene has none', () => {
    const { g } = game();
    expect(hasHiding(g.scene.layout)).toBe(true);
    expect(g.hiding?.spots).toHaveLength(3);
    expect(hidingOf(g.world as unknown as World<never>)).toBe(g.hiding?.hiding);
    const bare = { ...g.scene.layout, spawns: g.scene.layout.spawns.filter((s) => !s.hiding) };
    expect(hasHiding(bare)).toBe(false);
  });

  it('each spot with a size gets a greybox, posed standing on its origin', () => {
    const { g, sim } = game();
    const looks = spotLooks(g.scene);
    expect(looks.map((l) => l.look)).toEqual(['wood', 'hay', 'wood']);
    const [wardrobe] = looks;
    const view = { get: (entity: EntityId, type: never) => sim.get(entity, type) } as never;
    const pose = readHidingSpot(view, must(wardrobe).entity, 1.9);
    expect(pose?.position).toMatchObject({ x: 4.5, z: 1.5 });
    expect(pose?.position.y).toBeCloseTo(0.95, 9);
    expect(readHidingSpot(view, 99999, 1)).toBeUndefined();
    // A spot with no size draws nothing.
    const sizeless = {
      ...g.scene,
      spawns: g.scene.spawns.map((s) => ({
        ...s,
        spawn: {
          ...s.spawn,
          ...(s.spawn.hiding && { hiding: { ...s.spawn.hiding, size: undefined } }),
        },
      })),
    };
    expect(spotLooks(sizeless as never)).toEqual([]);
    // A spot whose data leaves out its look is drawn as wood.
    const bare = {
      ...g.scene,
      spawns: g.scene.spawns.map((s) => ({
        ...s,
        spawn: {
          ...s.spawn,
          ...(s.spawn.hiding && { hiding: { size: [1, 1, 1] as const } }),
        },
      })),
    };
    expect(spotLooks(bare as never).map((l) => l.look)).toEqual(['wood', 'wood', 'wood']);
  });

  it('the peek view is the spot’s eye while hiding, and nothing otherwise', () => {
    const { g, sim } = game();
    expect(peekView(sim, g.player)).toBeUndefined();
    g.world.step([teleportCommand(g.player, { x: 3.3, y: 0, z: 1.5 }) as unknown as ActionFrame]);
    g.world.set(g.player, PlayerLook, { yaw: -Math.PI / 2, pitch: 0 });
    for (let i = 0; i < 12; i++) g.world.step([IDLE]);
    g.world.step([PRESS]);
    g.world.step([IDLE]);
    const view = peekView(sim, g.player);
    expect(view?.eye.x).toBeCloseTo(4.5 - 0.2, 6);
    expect(view?.eye.y).toBeCloseTo(1.5, 6);
    expect(view?.yaw).toBeCloseTo(Math.PI / 2, 6);
    // Without a look the view falls back to the opening.
    sim.remove(g.player, PlayerLook);
    expect(peekView(sim, g.player)).toMatchObject({ yaw: Math.PI / 2, pitch: 0 });
  });

  it('the readout names who hides where, by spawn id, and leaves out spots that are gone', () => {
    const { g, sim } = game();
    const [wardrobe, haystack] = g.hiding?.spots ?? [];
    const watch = new HidingWatch(sim, g.hiding?.spots ?? [], g.player);
    const idle = watch.readout();
    expect(idle.player).toBeNull();
    expect(idle.spots['hiding-wardrobe']).toMatchObject({
      entity: wardrobe,
      occupied: false,
      occupants: [],
    });
    g.hiding?.hiding.enter(sim, g.player, must(wardrobe));
    const other = g.world.spawn();
    g.world.step([IDLE]);
    g.hiding?.hiding.enter(sim, other, must(haystack));
    const busy = watch.readout();
    expect(busy.player).toBe('hiding-wardrobe');
    expect(busy.spots['hiding-wardrobe']?.occupants).toEqual(['player']);
    expect(busy.spots['hiding-haystack']?.occupants).toEqual([String(other)]);
    g.world.destroy(must(haystack));
    g.world.step([IDLE]);
    expect(Object.keys(watch.readout().spots)).toEqual(['hiding-wardrobe', 'hiding-barrel']);
    // A spot that is not a scene spawn is named by its entity.
    const loose = g.world.spawn();
    makeHidingSpot(sim, loose, { origin: { x: 0, y: 0, z: 0 } });
    g.world.step([IDLE]);
    expect(Object.keys(new HidingWatch(sim, [loose], undefined).readout().spots)).toEqual([
      String(loose),
    ]);
    // No player, or a player that is gone, is hiding nowhere.
    expect(new HidingWatch(sim, [], undefined).readout().player).toBeNull();
    g.world.destroy(g.player);
    g.world.step([IDLE]);
    expect(watch.readout().player).toBeNull();
  });
});

describe('saving while hiding (mw-e03.23)', () => {
  it('an autosave is held back while the player hides, they stay inside, and it is written once they leave', async () => {
    const { g, sim } = game();
    const store = await IndexedDbSaveStore.open(new IDBFactory());
    const scheduler = new AutosaveScheduler({
      slots: new SaveSlots({
        store,
        registry: createGameSaveRegistry(),
        build: { gameVersion: '0.2.0', buildSha: 'abc1234', contentHash: 'c0ffee' },
        now: () => 1_790_000_000_000,
      }),
      describe: () => ({ characterName: 'Aldric', classId: 'thief', areaId: 'testbed' }),
      minGapSeconds: 0,
    });
    scheduler.vetoes.register(
      HIDING_VETO_ID,
      hidingVeto(sim, () => g.player),
    );
    expect(HIDING_VETO_REASON).toBe("Can't save while hiding");
    scheduler.request({ kind: 'checkpoint' });
    expect(await scheduler.update(g.world)).not.toBeNull(); // in the open: saves
    g.world.step([teleportCommand(g.player, { x: 3.3, y: 0, z: 1.5 }) as unknown as ActionFrame]);
    g.world.set(g.player, PlayerLook, { yaw: -Math.PI / 2, pitch: 0 });
    for (let i = 0; i < 12; i++) g.world.step([IDLE]);
    g.world.step([PRESS]);
    g.world.step([IDLE]);
    expect(isHidden(sim, g.player)).toBe(true);
    scheduler.request({ kind: 'checkpoint' });
    expect(scheduler.vetoes.active()).toEqual([{ id: HIDING_VETO_ID, reason: HIDING_VETO_REASON }]);
    for (let i = 0; i < 3; i++) {
      expect(await scheduler.update(g.world)).toBeNull();
      g.world.step([IDLE]);
    }
    expect(isHidden(sim, g.player)).toBe(true);
    g.world.step([PRESS]);
    g.world.step([IDLE]);
    expect(isHidden(sim, g.player)).toBe(false);
    expect(await scheduler.update(g.world)).toMatchObject({ type: 'saved' });
    // A player that is gone objects to nothing.
    expect(hidingVeto(sim, () => undefined)()).toBeNull();
    expect(hidingVeto(sim, () => 999999)()).toBeNull();
  });
});
