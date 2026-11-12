// mw-e16.1: the MVP obstacle x class route matrix. The data is docs/design/route-matrix.json and
// the page is docs/design/route-matrix.md; these tests prove the matrix against the real capability
// registry, the class files and the world connectivity map, so a route naming a capability that
// does not exist, a class that cannot use it or an edge that is not on the map fails here.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadGameContent } from '@content/index';
import type { CapabilityGroup } from '@content/types/capability';

const CLASSES = ['knight', 'archer', 'sorcerer', 'thief'] as const;

interface Route {
  classes: string[];
  kind: string;
  capabilities: string[];
  needs?: { capability: string; epic: string }[];
  how: string;
  source: string;
  status: string;
  entry?: string;
}
interface Obstacle {
  id: string;
  tier: 'mandatory' | 'quest' | 'optional';
  node: string;
  edge?: string;
  routes: Route[];
}
interface Matrix {
  mineEntries: { id: string; obstacle: string }[];
  obstacles: Obstacle[];
  gaps: {
    obstacle: string;
    classes: string[];
    fix: string;
    edge: { id: string; from: string; to: string; routes: string[] };
  }[];
}

const matrix = JSON.parse(readFileSync('docs/design/route-matrix.json', 'utf8')) as Matrix;
const doc = readFileSync('docs/design/route-matrix.md', 'utf8');
const content = loadGameContent();
const [world] = content.all('world');
const classFiles = content.all('class');
const registry = new Map(
  (content.all('capability') as CapabilityGroup[]).flatMap((g) =>
    g.capabilities.map((c) => [c.id, c] as const),
  ),
);

/** The distinct player classes that have at least one route on the obstacle. */
const classRoutes = (o: Obstacle): string[] =>
  CLASSES.filter((c) => o.routes.some((r) => r.classes.includes(c)));

describe('docs/design/route-matrix.json', () => {
  it('AC-1: every mandatory obstacle has >= 3 class routes and an any-class route or fallback', () => {
    const mandatory = matrix.obstacles.filter((o) => o.tier !== 'optional');
    expect(mandatory.length).toBeGreaterThanOrEqual(15);
    for (const o of mandatory) {
      expect(classRoutes(o).length, `${o.id} class routes`).toBeGreaterThanOrEqual(3);
      expect(
        o.routes.some((r) => r.classes.includes('any')),
        `${o.id} any-class route`,
      ).toBe(true);
    }
  });

  it('AC-1: covers every obstacle the bead names, kebab-case, once', () => {
    const ids = matrix.obstacles.map((o) => o.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    for (const id of [
      'mine-gate',
      'supply-tunnel',
      'goblin-camp-passage',
      'outer-ring-gate',
      'ossuary-crossing',
      'chapel-of-echoes',
      'horns-hall-fold-access',
      'cradle',
      'sounding-shaft',
      'belfry',
      'weeping-adit',
      'vane-strongbox',
      'moorings-watch',
      'restricted-shelf',
      'customs-strongroom',
      'bay-nine',
      'gilded-tern',
      'undertow',
    ])
      expect(ids, id).toContain(id);
  });

  it('AC-1: lists the six mine entries including the Weeping Adit, each carried by a route', () => {
    expect(matrix.mineEntries).toHaveLength(6);
    expect(matrix.mineEntries.map((e) => e.id)).toContain('weeping-adit');
    for (const e of matrix.mineEntries) {
      const o = matrix.obstacles.find((x) => x.id === e.obstacle);
      expect(o, e.id).toBeDefined();
      expect(
        o?.routes.some((r) => r.entry === e.id),
        `entry ${e.id}`,
      ).toBe(true);
    }
    const used = matrix.obstacles.flatMap((o) => o.routes.map((r) => r.entry).filter(Boolean));
    for (const entry of used) expect(matrix.mineEntries.map((e) => e.id)).toContain(entry);
  });

  it('AC-2: every route names registry capabilities a class can hold, or is flagged needs-capability', () => {
    for (const o of matrix.obstacles) {
      for (const r of o.routes) {
        const at = `${o.id}: ${r.how}`;
        for (const id of r.capabilities) {
          const cap = registry.get(id);
          expect(cap, `${at}: unknown capability ${id}`).toBeDefined();
          for (const cls of r.classes.filter((c) => c !== 'any')) {
            const file = classFiles.find((f) => f.id === cls);
            const holds = file?.mvpCapabilities.includes(id) === true || cap?.classAffinity === cls;
            expect(holds, `${at}: ${cls} cannot hold ${id}`).toBe(true);
          }
        }
        for (const n of r.needs ?? []) {
          expect(registry.has(n.capability), `${at}: ${n.capability} now exists, drop needs`).toBe(
            false,
          );
          expect(n.epic, at).toMatch(/^mw-e\d+$/);
        }
        if (r.classes.includes('any')) {
          expect(r.kind, at).not.toBe('capability');
        } else {
          expect(r.kind, at).toBe('capability');
          expect(r.capabilities.length + (r.needs?.length ?? 0), at).toBeGreaterThan(0);
        }
        expect(['canon', 'edge', 'proposal'], at).toContain(r.status);
      }
    }
  });

  it('AC-2: edge-status routes use the capabilities of the connectivity edge', () => {
    for (const o of matrix.obstacles) {
      if (o.edge === undefined) continue;
      const edge = world?.edges.find((e) => e.id === o.edge);
      expect(edge, `${o.id} edge ${o.edge}`).toBeDefined();
      const used = new Set(o.routes.flatMap((r) => r.capabilities));
      for (const cap of edge?.routes ?? []) expect(used, `${o.id} lacks ${cap}`).toContain(cap);
      const node = world?.nodes.find((n) => n.id === o.node);
      expect(node, `${o.id} node ${o.node}`).toBeDefined();
    }
  });

  it('AC-3: obstacles with only 2 class routes are listed in gaps with a proposed edge', () => {
    const two = matrix.obstacles.filter((o) => classRoutes(o).length === 2).map((o) => o.id);
    expect(two.length).toBeGreaterThan(0);
    expect(matrix.gaps.map((g) => g.obstacle).sort()).toEqual([...two].sort());
    for (const g of matrix.gaps) {
      const o = matrix.obstacles.find((x) => x.id === g.obstacle);
      expect(o, g.obstacle).toBeDefined();
      expect(g.classes.sort()).toEqual(o === undefined ? [] : classRoutes(o).sort());
      expect(g.fix.length).toBeGreaterThan(20);
      expect(
        world?.nodes.some((n) => n.id === g.edge.from),
        `${g.edge.id} from`,
      ).toBe(true);
      expect(
        world?.edges.some((e) => e.id === g.edge.id),
        `${g.edge.id} is new`,
      ).toBe(false);
      for (const id of g.edge.routes) expect(registry.has(id), id).toBe(true);
    }
    for (const o of matrix.obstacles) expect(classRoutes(o).length, o.id).toBeGreaterThanOrEqual(2);
  });
});

describe('docs/design/route-matrix.md', () => {
  it('AC-1: has a section per obstacle that names every capability its routes use', () => {
    for (const o of matrix.obstacles) {
      const start = doc.indexOf(`### \`${o.id}\``);
      expect(start, `section for ${o.id}`).toBeGreaterThanOrEqual(0);
      const next = doc.indexOf('\n#', start + 1);
      const section = doc.slice(start, next < 0 ? undefined : next);
      for (const r of o.routes) {
        for (const id of r.capabilities) expect(section, `${o.id} ${id}`).toContain(`\`${id}\``);
        for (const n of r.needs ?? [])
          expect(section, `${o.id} needs ${n.capability}`).toContain(`needs \`${n.capability}\``);
      }
    }
  });

  it('AC-2/AC-3: has the gaps, needs-capability and open-questions sections', () => {
    for (const h of ['## Gaps', '## Needs capability', '## Open questions for the owner'])
      expect(doc).toContain(h);
    for (const g of matrix.gaps) expect(doc).toContain(`\`${g.edge.id}\``);
    for (const o of matrix.obstacles)
      for (const n of o.routes.flatMap((r) => r.needs ?? []))
        expect(doc).toContain(`| \`${n.capability}\` | ${n.epic} |`);
  });
});
