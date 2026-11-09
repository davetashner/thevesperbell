// mw-e03.23: hiding in wardrobes, barrels and haystacks, as the game wires it (createGameWorld: Rapier
// physics, the player with interaction, carrying, containers, hiding, fire), driven by ActionFrames. The
// player slips into the testbed's wardrobe with Interact and out again; a burning haystack evicts them
// the tick it ignites; they cannot attack or move from inside; death inside lets them out; a save written
// while hidden loads with the player outside, and a save with an item and a body in a chest brings both
// back (AC-6).
import * as RAPIER from '@dimforge/rapier3d-deterministic';
import { createGameSaveRegistry } from '@game/save/sections';
import {
  actionButton,
  actionFrame,
  actionVector,
  ActionTimelineComponent,
  applyStimulus,
  CharacterController,
  concealmentOf,
  fireIgnited,
  hashWorld,
  hiddenOf,
  hidingEjected,
  hidingEntered,
  hidingLeft,
  holdOf,
  interactionPrompt,
  inventoryOf,
  isHidden,
  isOccupied,
  killCommand,
  PlayerLook,
  readProperty,
  StashComponent,
  teleportCommand,
  type ActionFrame,
  type ButtonAction,
  type EntityId,
  type HidingEjected,
  type NoiseEvent,
  noiseEmitted,
  type World,
} from '@sim/index';
import { createGameWorld } from '@tools/replay/testbed-player-scenario';
import { describe, expect, it, vi } from 'vitest';

// Whole-world runs: slow under coverage and on a loaded runner.
vi.setConfig({ testTimeout: 120_000 });

/** A value the test knows is there. */
function must<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('missing');
  return value;
}

const HZ = 60;
const build = { gameVersion: '0.1.0', buildSha: 'deadbee', contentHash: 'c0ffee' };

type Spec = Partial<Record<ButtonAction, 'press' | 'hold'>>;
function frame(spec: Spec = {}, move: [number, number] = [0, 0]): ActionFrame {
  return actionFrame({
    move: actionVector(move[0], move[1]),
    look: actionVector(0, 0),
    buttons: (action) => {
      const s = spec[action];
      return actionButton(s === 'press', s === 'press' || s === 'hold', false);
    },
  });
}
const IDLE = frame();
const PRESS = frame({ interact: 'press' });

/** Look yaw that faces +x, −x, +z and −z. */
const FACE = { east: -Math.PI / 2, west: Math.PI / 2, south: Math.PI, north: 0 };

function game() {
  const g = createGameWorld<ActionFrame>(RAPIER, { seed: 1, hz: HZ, magic: true });
  const world = g.world;
  const sim = world as unknown as World<never>;
  const spots = g.hiding?.spots ?? [];
  const [wardrobe, haystack, barrel] = spots;
  if (wardrobe === undefined || haystack === undefined || barrel === undefined) {
    throw new Error('the testbed has no hiding spots');
  }
  for (let i = 0; i < 4; i++) world.step([IDLE]);
  const feet = () => (world.get(g.player, CharacterController) ?? { position: null }).position;
  /** Stands the player at (x, z) facing `yaw`, settled and idle for a few ticks. */
  const stand = (x: number, z: number, yaw: number) => {
    world.step([teleportCommand(g.player, { x, y: 0, z }) as unknown as ActionFrame]);
    world.set(g.player, PlayerLook, { yaw, pitch: 0 });
    for (let i = 0; i < 12; i++) world.step([IDLE]);
  };
  const noises: NoiseEvent[] = [];
  const ejected: HidingEjected[] = [];
  world.events.on(noiseEmitted, (e) => noises.push(e));
  world.events.on(hidingEjected, (e) => ejected.push(e));
  return { g, world, sim, wardrobe, haystack, barrel, feet, stand, noises, ejected };
}

type Game = ReturnType<typeof game>;

const prompt = (t: Game) => interactionPrompt(t.sim, t.g.player);

/** Stands at the wardrobe's front (it faces −x from x = 4.5) looking at it, and hides. */
function intoTheWardrobe(t: Game): void {
  t.stand(3.3, 1.5, FACE.east);
  t.world.step([PRESS]);
  t.world.step([IDLE]);
}

describe('hiding in the testbed (mw-e03.23)', () => {
  it('Interact on the wardrobe hides the player inside it, with the spot’s concealment, noise and prompt; Interact again steps out', () => {
    const t = game();
    const entered: unknown[] = [];
    const left: unknown[] = [];
    t.world.events.on(hidingEntered, (e) => entered.push(e));
    t.world.events.on(hidingLeft, (e) => left.push(e));
    t.stand(3.3, 1.5, FACE.east);
    expect(prompt(t)).toMatchObject({
      target: t.wardrobe,
      verb: 'hide',
      label: 'Hide',
      available: true,
    });
    t.world.step([PRESS]);
    t.world.step([IDLE]);
    expect(isHidden(t.sim, t.g.player)).toBe(true);
    expect(hiddenOf(t.sim, t.g.player)?.spot).toBe(t.wardrobe);
    expect(concealmentOf(t.sim, t.g.player)).toBe(1);
    expect(isOccupied(t.sim, t.wardrobe)).toBe(true);
    expect(t.feet()?.x).toBeCloseTo(4.5, 3);
    expect(t.feet()?.z).toBeCloseTo(1.5, 3);
    expect(entered).toHaveLength(1);
    expect(t.noises.filter((n) => n.kind === 'hide-enter')).toHaveLength(1);
    // Inside, the prompt is to leave.
    expect(prompt(t)).toMatchObject({
      target: t.wardrobe,
      verb: 'leave',
      label: 'Leave',
      available: true,
    });
    // Facing the way out: the opening is −x.
    expect(t.world.get(t.g.player, PlayerLook)?.yaw).toBeCloseTo(FACE.west, 6);
    t.world.step([PRESS]);
    t.world.step([IDLE]);
    expect(isHidden(t.sim, t.g.player)).toBe(false);
    expect(isOccupied(t.sim, t.wardrobe)).toBe(false);
    expect(t.feet()?.x).toBeCloseTo(3.55, 2);
    expect(left).toHaveLength(1);
    expect(t.noises.filter((n) => n.kind === 'hide-exit')).toHaveLength(1);
  });

  it('inside, the player cannot walk, attack or jump, and cannot be trapped by held input', () => {
    const t = game();
    intoTheWardrobe(t);
    const at = t.feet();
    const timeline = () => t.world.get(t.g.player, ActionTimelineComponent)?.current ?? null;
    for (let i = 0; i < 60; i++) {
      t.world.step([
        frame(
          { primaryAttack: 'press', jump: 'press', dodge: 'press', cast: 'press', sprint: 'hold' },
          [1, 1],
        ),
      ]);
      expect(timeline()).toBeNull();
    }
    expect(t.feet()).toEqual(at);
    expect(isHidden(t.sim, t.g.player)).toBe(true);
    // Whatever else is held, Interact still gets them out.
    t.world.step([frame({ interact: 'press', primaryAttack: 'hold', sprint: 'hold' }, [0, 1])]);
    t.world.step([IDLE]);
    expect(isHidden(t.sim, t.g.player)).toBe(false);
  });

  it('a burning haystack evicts the player the tick it ignites, and heats them', () => {
    const t = game();
    t.stand(1.5, 1.7, FACE.south); // the haystack at (1.5, 3) opens towards −z
    expect(prompt(t)).toMatchObject({ target: t.haystack, verb: 'hide', available: true });
    t.world.step([PRESS]);
    t.world.step([IDLE]);
    expect(isHidden(t.sim, t.g.player)).toBe(true);
    expect(concealmentOf(t.sim, t.g.player)).toBe(0.9);
    expect(readProperty(t.sim, t.haystack, 'flammable')).toBe(true);
    const lit: { entity: EntityId; tick: number }[] = [];
    t.world.events.on(fireIgnited, (e) => lit.push({ entity: e.entity, tick: t.world.tick }));
    applyStimulus(t.sim, {
      shape: { kind: 'contact', target: t.haystack },
      element: 'heat',
      intensity: 900,
    });
    for (let i = 0; i < 120 && lit.every((l) => l.entity !== t.haystack); i++) t.world.step([IDLE]);
    const ignition = lit.find((l) => l.entity === t.haystack);
    expect(ignition).toBeDefined();
    expect(isHidden(t.sim, t.g.player)).toBe(false);
    const out = t.ejected.find((e) => e.spot === t.haystack);
    expect(out).toMatchObject({ actor: t.g.player, cause: 'burning', heat: 60 });
    expect(out?.tick).toBe(ignition?.tick);
    // Ejected to an exit (in front of the haystack), not left inside it.
    expect(Math.hypot((t.feet()?.x ?? 0) - 1.5, (t.feet()?.z ?? 0) - 3)).toBeGreaterThan(0.5);
    // A burning spot cannot be entered again.
    t.world.set(t.g.player, PlayerLook, { yaw: FACE.south, pitch: 0 });
    for (let i = 0; i < 5; i++) t.world.step([IDLE]);
    expect(prompt(t)?.options.find((o) => o.verb === 'hide')).toMatchObject({
      available: false,
      reason: 'Burning',
    });
  });

  it('dying inside lets the player out of the spot', () => {
    const t = game();
    intoTheWardrobe(t);
    t.world.step([killCommand(t.g.player) as unknown as ActionFrame]);
    t.world.step([IDLE]);
    expect(isHidden(t.sim, t.g.player)).toBe(false);
    expect(t.ejected.at(-1)).toMatchObject({ cause: 'died' });
    expect(isOccupied(t.sim, t.wardrobe)).toBe(false);
  });

  it('a save written while hidden loads with the player standing outside the wardrobe', () => {
    const t = game();
    intoTheWardrobe(t);
    expect(isHidden(t.sim, t.g.player)).toBe(true);
    const bytes = createGameSaveRegistry().write(t.world, {
      build,
      wallClockSavedAt: 1_790_000_000_000,
    });
    // The writing stepped them out: nobody is left hidden in a prop the load rebuilds empty.
    expect(isHidden(t.sim, t.g.player)).toBe(false);
    const back = game();
    expect(createGameSaveRegistry().read(back.world, bytes)).toMatchObject({ ok: true });
    expect(isHidden(back.sim, back.g.player)).toBe(false);
    expect(isOccupied(back.sim, back.wardrobe)).toBe(false);
    expect(back.feet()?.x).toBeCloseTo(3.55, 2);
    for (let i = 0; i < 10; i++) back.world.step([IDLE]);
    // Free to go in again.
    back.world.set(back.g.player, PlayerLook, { yaw: FACE.east, pitch: 0 });
    for (let i = 0; i < 3; i++) back.world.step([IDLE]);
    back.world.step([PRESS]);
    back.world.step([IDLE]);
    expect(isHidden(back.sim, back.g.player)).toBe(true);
  });

  it('a spot cannot be entered with the hands full: the body must be set down first', () => {
    const t = game();
    const [, body] = t.g.containers;
    expect(body).toBeDefined();
    t.stand(-0.5, 1.25, FACE.south); // the first body lies at (-0.5, 2.25)
    t.world.step([PRESS]);
    expect(holdOf(t.sim, t.g.player)).toBeDefined();
    t.stand(3.3, 1.5, FACE.east);
    t.world.step([PRESS]);
    t.world.step([IDLE]);
    expect(isHidden(t.sim, t.g.player)).toBe(false);
  });
});

describe('bodies in the testbed’s chest (mw-e03.23)', () => {
  /** The player carries limp-body-a to the chest at (-2, 3.5) and stashes it. */
  function stashABody(t: Game): { chest: EntityId } {
    const chest = must(t.g.containers[1]);
    t.stand(-0.5, 1.25, FACE.south);
    expect(prompt(t)).toMatchObject({ verb: 'pick-up' });
    t.world.step([PRESS]);
    for (let i = 0; i < 4; i++) t.world.step([IDLE]);
    expect(holdOf(t.sim, t.g.player)).toBeDefined();
    // Walk-free: carrying moves with the player, so teleport and let the hold follow.
    t.world.step([teleportCommand(t.g.player, { x: -2, y: 0, z: 2.3 }) as unknown as ActionFrame]);
    t.world.set(t.g.player, PlayerLook, { yaw: FACE.south, pitch: 0 });
    for (let i = 0; i < 12; i++) t.world.step([IDLE]);
    return { chest };
  }

  it('AC-5, AC-6: a carried body goes into the chest if it fits; the chest, its item and its body survive a save and reload', () => {
    const t = game();
    const chest = must(t.g.containers[1]);
    t.g.items.inventory.add(t.sim, chest, 'healing-draught', 1);
    stashABody(t);
    expect(prompt(t)).toMatchObject({
      target: chest,
      verb: 'stash',
      label: 'Stash body',
      available: true,
    });
    t.world.step([PRESS]);
    for (let i = 0; i < 4; i++) t.world.step([IDLE]);
    expect(t.sim.get(chest, StashComponent)?.bodies).toEqual([{ kind: 'body', weight: 45 }]);
    expect(holdOf(t.sim, t.g.player)).toBeUndefined();
    expect(inventoryOf(t.sim, chest)?.items.map((i) => i.defId)).toEqual(['healing-draught']);

    const bytes = createGameSaveRegistry().write(t.world, {
      build,
      wallClockSavedAt: 1_790_000_000_000,
    });
    const back = game();
    const backChest = must(back.g.containers[1]);
    expect(back.sim.get(backChest, StashComponent)?.bodies).toEqual([]);
    expect(createGameSaveRegistry().read(back.world, bytes)).toMatchObject({ ok: true });
    expect(back.sim.get(backChest, StashComponent)?.bodies).toEqual([{ kind: 'body', weight: 45 }]);
    expect(inventoryOf(back.sim, backChest)?.items.map((i) => i.defId)).toEqual([
      'healing-draught',
    ]);
    expect(hashWorld(back.world)).toBe(hashWorld(t.world));
  });

  it('AC-5: a second 45 kg body does not fit in the 60 kg chest: the prompt says "Too heavy"', () => {
    const t = game();
    const chest = must(t.g.containers[1]);
    stashABody(t);
    t.world.step([PRESS]);
    for (let i = 0; i < 4; i++) t.world.step([IDLE]);
    expect(t.sim.get(chest, StashComponent)?.bodies).toHaveLength(1);
    t.stand(0.5, 1.25, FACE.south);
    t.world.step([PRESS]);
    for (let i = 0; i < 4; i++) t.world.step([IDLE]);
    expect(holdOf(t.sim, t.g.player)).toBeDefined();
    t.world.step([teleportCommand(t.g.player, { x: -2, y: 0, z: 2.3 }) as unknown as ActionFrame]);
    t.world.set(t.g.player, PlayerLook, { yaw: FACE.south, pitch: 0 });
    for (let i = 0; i < 12; i++) t.world.step([IDLE]);
    expect(prompt(t)?.options[0]).toMatchObject({
      verb: 'stash',
      available: false,
      reason: 'Too heavy',
    });
  });
});
