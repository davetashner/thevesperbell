// mw-e29.6: swing trails and charge glow, driven by the real combat timeline in the testbed world
// (the knight's content moves and socket tracks, the real hit-volume sweeps and ChargeReady) through
// the trail controller. No renderer: the controller's drawable trails and glow states are what the
// Three.js layer uploads.
import * as RAPIER from '@dimforge/rapier3d-deterministic';
import { describe, expect, it } from 'vitest';
import { loadGameContent, type MoveTable, type RuntimeMove } from '@content/index';
import { markExercised } from '@content/testing';
import { prepareTestbedCombat } from '@game/combat/testbed-combat';
import { ActionSampler } from '@game/input/index';
import {
  CHARGE_BURST_EFFECT,
  compileTrailTints,
  SwingTrails,
  trailTints,
  type VfxSpawnOptions,
} from '@game/vfx/index';
import {
  actionOf,
  ActionPhaseChanged,
  ChargeReady,
  PlayerLook,
  type ActionPhaseInfo,
} from '@sim/index';
import { createTestbedWorld } from '@tools/replay/testbed-player-scenario';

const content = loadGameContent();
const combat = prepareTestbedCombat(content);

function testbed(moves: MoveTable = combat.moves) {
  const world = createTestbedWorld(RAPIER, { seed: 1, hz: 60 });
  const [player] = world.query(PlayerLook).ids();
  if (player === undefined) throw new Error('no player');
  const sampler = new ActionSampler();
  const spawned: { effect: string; options: VfxSpawnOptions }[] = [];
  const trails = new SwingTrails(
    {
      world,
      moves,
      tracks: combat.tracks,
      tints: trailTints(),
      vfx: {
        spawn: (effect, options) => {
          spawned.push({ effect, options });
          return 1;
        },
        stop: () => undefined,
        alive: () => true,
        has: () => true,
      },
    },
    [player],
  );
  const phases: ActionPhaseInfo[] = [];
  world.events.on(ActionPhaseChanged, (e) => phases.push(e));
  const step = (codes: readonly string[] = []) => {
    for (const code of codes) sampler.down(code);
    world.step(sampler.sampleCommands(world.tick));
    for (const code of codes) sampler.up(code);
    trails.frame();
  };
  const run = (ticks: number) => {
    for (let i = 0; i < ticks; i++) step();
  };
  return { world, player, sampler, trails, spawned, phases, step, run };
}

describe('swing trails against the real combat timeline (mw-e29.6)', () => {
  it('AC-1: a light attack’s trail is visible only on ticks inside its active window', ({
    task,
  }) => {
    markExercised(task, 'move', 'sword-light-1');
    const t = testbed();
    t.run(30);
    const frames: { tick: number; phase: string | undefined; visible: number }[] = [];
    t.step(['Mouse0']);
    for (let i = 0; i < 60; i++) {
      const current = actionOf(t.world, t.player);
      const move = current === undefined ? undefined : combat.moves.get(current.move);
      const phase =
        current === undefined || move === undefined
          ? undefined
          : current.tick < move.activeFrom
            ? 'startup'
            : current.tick < move.recoveryFrom
              ? 'active'
              : 'recovery';
      frames.push({ tick: t.world.tick, phase, visible: t.trails.visible });
      t.step();
    }
    const shown = frames.filter((f) => f.visible > 0);
    expect(shown.length).toBeGreaterThan(0);
    for (const frame of frames) {
      if (frame.visible > 0) expect(frame.phase).toBe('active');
    }
    // The trail has two or more samples by the end of the window, then is released with it.
    const active = t.phases.find((p) => p.phase === 'active');
    const recovery = t.phases.find((p) => p.phase === 'recovery');
    expect(active).toBeDefined();
    expect(recovery).toBeDefined();
    const last = shown[shown.length - 1];
    expect(last?.tick).toBeLessThan((recovery?.tick ?? 0) + 1);
    expect(shown[0]?.tick).toBeGreaterThanOrEqual((active?.tick ?? 0) + 1);
    expect(t.trails.visible).toBe(0);
  });

  it('AC-2: a fire-damage weapon’s trail uses the fire tint from data', () => {
    const fire: RuntimeMove[] = [...combat.moves.values()].map((move) =>
      move.id === 'sword-light-1' && move.damage !== null
        ? { ...move, damage: { ...move.damage, amounts: { fire: 20, slash: 5 } } }
        : move,
    );
    const t = testbed(new Map(fire.map((m) => [m.id, m])));
    t.run(30);
    t.step(['Mouse0']);
    let seen: readonly number[] | undefined;
    for (let i = 0; i < 40 && seen === undefined; i++) {
      t.step();
      const trail = t.trails.set.trails.find((x) => x.visible);
      if (trail !== undefined) seen = [trail.r, trail.g, trail.b];
    }
    expect(seen).toEqual([...trailTints().damage.fire]);
    expect(seen).not.toEqual([...trailTints().damage.slash]);
  });

  it('AC-4: ChargeReady spawns the burst at the weapon socket, and the glow steps up to full', ({
    task,
  }) => {
    markExercised(task, 'move', 'sword-heavy');
    const t = testbed();
    t.run(30);
    const ready: unknown[] = [];
    t.world.events.on(ChargeReady, (e) => ready.push(e));
    t.sampler.down('Digit1');
    const steps: number[] = [];
    for (let i = 0; i < 70; i++) {
      t.step();
      steps.push(t.trails.glows[0]?.step ?? -1);
    }
    t.sampler.up('Digit1');
    expect(ready).toHaveLength(1);
    expect(t.spawned).toHaveLength(1);
    const [burst] = t.spawned;
    expect(burst?.effect).toBe(CHARGE_BURST_EFFECT);
    const glow = t.trails.glows[0];
    // At the weapon socket: in front of and above the knight, where the glow draws.
    expect(burst?.options.position?.x).toBeCloseTo(glow?.x ?? NaN, 3);
    expect(burst?.options.position?.y).toBeCloseTo(glow?.y ?? NaN, 3);
    expect(burst?.options.position?.z).toBeCloseTo(glow?.z ?? NaN, 3);
    expect(burst?.options.position?.y).toBeGreaterThan(0.5);
    // 33 / 66 / 100% steps, in order, never skipping or going back while held.
    const distinct = steps.filter((s, i) => i === 0 || s !== steps[i - 1]);
    expect(distinct).toEqual([0, 1, 2, 3]);
  });

  it('the glow goes out when the charge is released', () => {
    const t = testbed();
    t.run(30);
    t.sampler.down('Digit1');
    t.run(70);
    t.sampler.up('Digit1');
    t.run(2);
    expect(t.trails.glows[0]?.step).toBe(0);
  });
});

describe('trail tint data', () => {
  it('rejects a colour that is not #RRGGBB, naming the path', () => {
    const data = JSON.parse(JSON.stringify({ ...trailTints() })) as unknown;
    expect(() => compileTrailTints({ ...(data as object), neutral: 'red' })).toThrow(/neutral/);
  });
});
