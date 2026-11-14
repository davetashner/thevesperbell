// mw-e40.26.1 (part of mw-e40.26) on real content, headless: the riverbank under the Miners' Bridge links to the Stone Wharf
// (AC-1: the player can walk from Briar Glen to Wendmouth), the world map lists the edge and the main
// quest still never needs it (AC-2). The barge and Kestrel Lock legs stay planned (mw-e25.15, mw-e25.24).
import { describe, expect, it } from 'vitest';
import {
  deriveNavAgent,
  loadGameContent,
  NAV_BITS,
  resolveLocomotion,
  type NavAgent,
} from '@content/index';
import { NavMesh, NavMeshQuery } from '@sim/index';
import { buildEnv, validateWorld } from '@tools/world/validate';

const content = loadGameContent();
const [world] = content.all('world');
const bank = content.get('scene', 'under-the-bridge');
const harbour = content.get('scene', 'wendmouth-harbour');
const query = new NavMeshQuery(new NavMesh(content.get('navmesh', 'wendmouth-harbour')));

const humanoid = deriveNavAgent(resolveLocomotion(content.get('locomotion', 'humanoid'), content));
const walker: NavAgent = { ...humanoid, mask: humanoid.mask & ~NAV_BITS.climb, maxClimbGrade: 0 };

const spot = (scene: typeof harbour, id: string) => {
  const spawn = scene.spawns.find((s) => s.id === id);
  if (spawn === undefined) throw new Error(`no spawn ${id} in ${scene.id}`);
  return { x: spawn.at[0], y: spawn.at[1], z: spawn.at[2] };
};

describe('the riverbank to the Stone Wharf (mw-e40.26 AC-1)', () => {
  it('AC-1: the bank has a towpath-down transition to the wharf, and the wharf a towpath-gate back', () => {
    expect(bank.transitions.find((t) => t.id === 'towpath-down')).toMatchObject({
      scene: { id: 'wendmouth-harbour' },
      spawn: 'arrive-from-under-the-bridge',
    });
    expect(harbour.transitions.find((t) => t.id === 'towpath-gate')).toMatchObject({
      scene: { id: 'under-the-bridge' },
      spawn: 'arrive-from-wendmouth-harbour',
    });
    expect(bank.spawns.find((s) => s.id === 'arrive-from-wendmouth-harbour')).toBeDefined();
    expect(harbour.spawns.find((s) => s.id === 'arrive-from-under-the-bridge')).toBeDefined();
  });

  it('AC-1: arriving on the towpath, a walker reaches the wharf and the barge berth on the navmesh', () => {
    const start = spot(harbour, 'arrive-from-under-the-bridge');
    for (const id of ['player-start', 'barge-berth', 'exit-towpath']) {
      const result = query.findPath({
        start,
        goal: spot(harbour, id),
        agent: walker,
        doors: () => 'open',
      });
      expect(result.status, id).toBe('found');
    }
  });

  it('AC-1: the towpath gate in the south wall is an open doorway, no locked door stub is left', () => {
    expect(harbour.spawns.find((s) => s.id === 'door-exit-towpath')).toBeUndefined();
    expect(harbour.spawns.find((s) => s.id === 'exit-towpath')?.tags).not.toContain('exit-stub');
  });
});

describe('the edge in the world map (mw-e40.26 AC-2)', () => {
  it('AC-2: riverbank-wharf-link lists both transitions, and every listed transition exists', () => {
    const edge = world?.edges.find((e) => e.id === 'riverbank-wharf-link');
    expect(edge).toMatchObject({ from: 'under-the-bridge', to: 'stone-wharf' });
    expect(edge?.transitions).toEqual([
      'under-the-bridge/towpath-down',
      'wendmouth-harbour/towpath-gate',
    ]);
  });

  it('AC-2: the barge and Kestrel Lock edges stay planned under their beads', () => {
    expect(world?.edges.find((e) => e.id === 'towpath-lock-wharf')?.bead).toBe('mw-e40.26');
    expect(world?.edges.find((e) => e.id === 'barge-lock-wharf')?.bead).toBe('mw-e40.26');
    expect(world?.edges.find((e) => e.id === 'barge-quay-lock')?.bead).toBe('mw-e25.15');
  });

  it('AC-2: the main quest still never needs Wendmouth (world validation AC-5, no errors)', () => {
    if (world === undefined) throw new Error('no world map');
    const report = validateWorld(world, buildEnv(content), content);
    expect(report.errors).toEqual([]);
    expect(report.criticalPath).not.toContain('stone-wharf');
    expect(report.criticalPath).not.toContain('under-the-bridge');
    expect(world.mainQuest).not.toContain('stone-wharf');
  });
});
