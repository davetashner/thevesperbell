// mw-e04.26 AC-3: every shipped move that can hit resolves its socket track from content and, swept
// through its active ticks by the sim's hit-volume system, moves its hit volume along a real arc.
import { describe, expect, it } from 'vitest';
import { compileMoves, compileSocketTracks, loadGameContent } from '@content/index';
import { markExercised } from '@content/testing';
import {
  DAMAGE_COMPONENTS,
  giveHitboxes,
  HIT_VOLUME_COMPONENTS,
  hitboxFromMove,
  hitVolumeDebug,
  hitVolumeSystem,
  moveTrack,
  noAllies,
  openHitbox,
  PlacementComponent,
  placeEntity,
  World,
  type GeomShape,
} from '@sim/index';

interface P {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** Points that follow a shape: a capsule's two ends, a sphere's or box's centre. */
const pointsOf = (shape: GeomShape): readonly P[] =>
  shape.kind === 'capsule' ? [shape.from, shape.to] : [shape.center];

const distance = (a: P, b: P) => Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2);

/** How far the shape's points moved between two shapes (the largest). */
const travel = (from: GeomShape, to: GeomShape): number => {
  const a = pointsOf(from);
  const b = pointsOf(to);
  return Math.max(...a.map((p, i) => distance(p, b[i] ?? p)));
};

const content = loadGameContent();
const moves = [...compileMoves(content.all('move')).values()].filter((m) => m.hitbox !== null);
const tracks = compileSocketTracks(content.all('socket-track'));

describe('socket tracks (mw-e04.26)', () => {
  it('ships a track for every move that can hit', () => {
    expect(moves.map((m) => m.id)).toEqual([
      'forgotten-archer-shot',
      'forgotten-archer-shove',
      'forgotten-brute-overhead',
      'forgotten-brute-sweep',
      'forgotten-lunging-thrust',
      'forgotten-overhead-chop',
      'forgotten-shield-bash',
      'forgotten-shield-counter',
      'forgotten-slash-1',
      'forgotten-slash-2',
      'halberd-chop',
      'halberd-sweep',
      'kick',
      'mace-light',
      'roll-attack',
      'shield-bash',
      'spear-thrust',
      'sword-heavy',
      'sword-heavy-charged',
      'sword-light-1',
      'sword-light-2',
      'sword-light-3',
      'sword-riposte',
      'training-dummy-swing',
    ]);
  });

  for (const move of moves) {
    it(`AC-3: ${move.id} sweeps a non-empty arc through its active ticks, every key finite`, ({
      task,
    }) => {
      const track = moveTrack(move, tracks);
      markExercised(task, 'move', move.id);
      markExercised(task, 'socket-track', track.id);
      for (const { position: p, rotation: q } of track.keys) {
        expect([p.x, p.y, p.z, q.x, q.y, q.z, q.w].every(Number.isFinite)).toBe(true);
      }

      const world = new World<never>({ seed: 1 }).register(
        ...HIT_VOLUME_COMPONENTS,
        ...DAMAGE_COMPONENTS,
        PlacementComponent,
      );
      world.addSystem(hitVolumeSystem({ isAlly: noAllies }));
      const attacker = world.spawn();
      placeEntity(world, attacker, { x: 2, y: 0, z: -3 }, 0.4);
      giveHitboxes(world, attacker);
      openHitbox(world, attacker, hitboxFromMove(move, track, { x: 1, y: 0, z: 1 }));

      const sweeps: number[] = [];
      let first: GeomShape | null = null;
      let last: GeomShape | null = null;
      for (let tick = 1; tick <= move.active; tick++) {
        world.step();
        const [sweep] = hitVolumeDebug(world).hitboxes;
        if (sweep === undefined) throw new Error(`no sweep on active tick ${String(tick)}`);
        expect(sweep.activeTick).toBe(tick);
        first ??= sweep.from;
        last = sweep.to;
        sweeps.push(travel(sweep.from, sweep.to));
      }
      // Every active tick sweeps somewhere, and the whole window covers a real arc.
      expect(sweeps).toHaveLength(move.active);
      for (const step of sweeps) expect(step).toBeGreaterThan(0.01);
      if (first === null || last === null) throw new Error('no sweeps');
      expect(travel(first, last)).toBeGreaterThan(0.3);
      world.step();
      expect(hitVolumeDebug(world).hitboxes).toEqual([]);
    });
  }
});
