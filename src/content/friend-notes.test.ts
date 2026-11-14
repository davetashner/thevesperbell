// mw-nro9: where the seven friend-below notes are placed and what reading one publishes. All seven are
// placed (the Sleeping Ox room, the Deepworks gate, four in the Knot's outer half, mw-cqfn, and the
// last in the Cradle, mw-bj41).
import { describe, expect, it } from 'vitest';
import { loadGameContent } from './game-content.ts';

const content = loadGameContent();
type Scene = ReturnType<typeof content.get<'scene'>>;
/** Where spawn `id` of `scene` stands. */
function at(scene: Scene, id: string): readonly [number, number, number] {
  const found = scene.spawns.find((s) => s.id === id)?.at;
  if (found === undefined) throw new Error(`no spawn ${id}`);
  return found;
}
const NOTES = content.all('note').filter((n) => n.id.startsWith('note-friend-below-'));

const PLACED: Record<string, { scene: string; spawn: string }> = {
  'note-friend-below-door': { scene: 'sleeping-ox', spawn: 'read-friend-note-door' },
  'note-friend-below-deepworks': { scene: 'deepworks', spawn: 'read-friend-note-gate' },
  'note-friend-below-outer-ring': { scene: 'knot-outer', spawn: 'read-friend-note-outer-ring' },
  'note-friend-below-spiders': { scene: 'knot-outer', spawn: 'read-friend-note-spiders' },
  'note-friend-below-ossuary': { scene: 'knot-outer', spawn: 'read-friend-note-ossuary' },
  'note-friend-below-warden': { scene: 'knot-outer', spawn: 'read-friend-note-warden' },
  'note-friend-below-cradle': { scene: 'knot-inner', spawn: 'read-friend-note-cradle' },
};

describe('the friend-below notes (mw-nro9)', () => {
  it('AC-3: all seven notes emit friend-note-found on first read', () => {
    expect(NOTES).toHaveLength(7);
    for (const note of NOTES) expect(note.emits, note.id).toEqual(['friend-note-found']);
  });

  it('AC-1: the seven placed notes are readable spawns with a read affordance', () => {
    for (const [text, { scene, spawn }] of Object.entries(PLACED)) {
      const found = content.get('scene', scene).spawns.filter((s) => s.tags.includes(text));
      expect(found.map((s) => s.id)).toEqual([spawn]);
      expect(found[0]?.tags).toContain('readable');
      expect(found[0]?.interact?.affordances[0]?.verb).toBe('read');
    }
  });

  it('AC-2: the Deepworks note stands on baked navmesh by the mine gate', () => {
    const scene = content.get('scene', 'deepworks');
    const note = at(scene, 'read-friend-note-gate');
    const gate = at(scene, 'mine-gate');
    expect(Math.hypot(note[0] - gate[0], note[2] - gate[2])).toBeLessThan(8);
    const nav = content.get('navmesh', 'deepworks');
    const [ox, oz] = nav.origin;
    const cell = nav.settings.cellSize;
    const onMesh = nav.polys.some(
      (p) =>
        note[0] >= ox + p[0] * cell &&
        note[0] < ox + p[2] * cell &&
        note[2] >= oz + p[1] * cell &&
        note[2] < oz + p[3] * cell,
    );
    expect(onMesh).toBe(true);
  });

  it('AC-2: the door note lies on the rented room floor, inside the doorway', () => {
    const scene = content.get('scene', 'sleeping-ox');
    const note = at(scene, 'read-friend-note-door');
    const floors = scene.placements.filter((p) => p.piece.id === 'floor');
    const onFloor = floors.some(
      (f) => Math.abs(note[0] - f.at[0]) <= f.scale[0] && Math.abs(note[2] - f.at[2]) <= f.scale[2],
    );
    expect(onFloor).toBe(true);
    const room = at(scene, 'room-door');
    expect(Math.hypot(note[0] - room[0], note[2] - room[2])).toBeLessThan(2);
  });

  it('AC-2 (mw-cqfn): each Knot note stands on baked navmesh in the area the bible puts it in', () => {
    const scene = content.get('scene', 'knot-outer');
    const nav = content.get('navmesh', 'knot-outer');
    const [ox, oz] = nav.origin;
    const cell = nav.settings.cellSize;
    const onMesh = (p: readonly [number, number, number]) =>
      nav.polys.some(
        (q) =>
          p[0] >= ox + q[0] * cell &&
          p[0] < ox + q[2] * cell &&
          p[2] >= oz + q[1] * cell &&
          p[2] < oz + q[3] * cell,
      );
    const where: Record<string, readonly [number, number]> = {
      'read-friend-note-outer-ring': [0, 90],
      'read-friend-note-spiders': [0, 90],
      'read-friend-note-ossuary': [90, 162],
      'read-friend-note-warden': [242, 262],
    };
    for (const [spawn, [z0, z1]] of Object.entries(where)) {
      const p = at(scene, spawn);
      expect(onMesh(p), spawn).toBe(true);
      expect(p[2], spawn).toBeGreaterThanOrEqual(z0);
      expect(p[2], spawn).toBeLessThan(z1);
    }
  });

  it('AC-1 (mw-bj41): the Cradle note stands on baked navmesh inside the Cradle, by its south entrance', () => {
    const scene = content.get('scene', 'knot-inner');
    const nav = content.get('navmesh', 'knot-inner');
    const [ox, oz] = nav.origin;
    const cell = nav.settings.cellSize;
    const p = at(scene, 'read-friend-note-cradle');
    const onMesh = nav.polys.some(
      (q) =>
        p[0] >= ox + q[0] * cell &&
        p[0] < ox + q[2] * cell &&
        p[2] >= oz + q[1] * cell &&
        p[2] < oz + q[3] * cell,
    );
    expect(onMesh).toBe(true);
    const cradle = scene.regions.find((r) => r.id === 'the-cradle');
    expect(cradle).toBeDefined();
    expect(p[0]).toBeGreaterThan(cradle?.min[0] ?? Infinity);
    expect(p[0]).toBeLessThan(cradle?.max[0] ?? -Infinity);
    expect(p[2]).toBeGreaterThan(cradle?.min[2] ?? Infinity);
    expect(p[2]).toBeLessThan(cradle?.max[2] ?? -Infinity);
  });
});
