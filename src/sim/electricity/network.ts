// The conduction graph (mw-e03.8): which conducting things touch which.
//
// A node is an entity that conducts right now (`conductsNow`: conductive or soaked, not frozen) and
// has a place: its bounding sphere, or for a liquid layer the slab of its volume's box (a pool is a
// box, not a ball). Two nodes are joined when their shapes touch or overlap, within a small contact
// gap. Nodes are in ascending entity id order and every node's neighbours are too, so a breadth-first
// flood over it is deterministic.
//
// Building it costs a sweep over the nodes, so it is cached: `refresh` compares the nodes' shapes
// with the last build's and only rebuilds when a node appeared or went (a crate soaked through, a
// wire dried, ice formed), moved, or a layer's slab changed. The comparison is one pass over the
// conducting things; a world with no charge does not call it at all.

import type { EntityId } from '../core/component';
import type { World } from '../core/world';
import { LiquidLayerComponent, LiquidVolumeComponent } from '../liquids/components';
import { layerSlabs } from '../liquids/volumes';
import { WorldProperties } from '../properties/components';
import { conductsNow, SOAKED_WETNESS } from '../properties/derived';
import { boundingSphereOf, PlacementComponent } from '../stimulus/placement';

const known = <T>(value: T | undefined): T => value as T;

/** One node's shape: a sphere (`box` false: x y z r) or an axis-aligned box (min and max corners). */
interface NodeShape {
  readonly id: EntityId;
  readonly box: boolean;
  readonly a: readonly [number, number, number];
  /** Sphere: [r, r, r]. Box: the max corner. */
  readonly b: readonly [number, number, number];
}

/** The graph: nodes by ascending id, and each node's neighbours (indices, ascending). */
export interface ConductionGraph {
  readonly ids: readonly EntityId[];
  readonly index: ReadonlyMap<EntityId, number>;
  readonly neighbours: readonly (readonly number[])[];
}

const sameShape = (x: NodeShape, y: NodeShape): boolean =>
  x.id === y.id &&
  x.box === y.box &&
  x.a[0] === y.a[0] &&
  x.a[1] === y.a[1] &&
  x.a[2] === y.a[2] &&
  x.b[0] === y.b[0] &&
  x.b[1] === y.b[1] &&
  x.b[2] === y.b[2];

/** The shapes of everything that conducts right now, ascending id. */
function conductingShapes(world: World<never>): NodeShape[] {
  const candidates = new Set<EntityId>();
  world.query(WorldProperties.conductive).forEach((entity, conductive) => {
    if (conductive) candidates.add(entity);
  });
  world.query(WorldProperties.wetness).forEach((entity, wetness) => {
    if (wetness >= SOAKED_WETNESS) candidates.add(entity);
  });
  const slabs = new Map<EntityId, NodeShape>();
  world.query(LiquidVolumeComponent).forEach((_, volume) => {
    const stacked = layerSlabs(volume);
    volume.layers.forEach((layer, i) => {
      const slab = stacked[i] as { bottom: number; top: number };
      slabs.set(layer.entity, {
        id: layer.entity,
        box: true,
        a: [volume.min.x, slab.bottom, volume.min.z],
        b: [volume.max.x, slab.top, volume.max.z],
      });
    });
  });
  const shapes: NodeShape[] = [];
  for (const entity of [...candidates].sort((x, y) => x - y)) {
    if (!conductsNow(world, entity)) continue;
    const slab = slabs.get(entity);
    if (slab !== undefined) {
      shapes.push(slab);
      continue;
    }
    if (world.has(entity, LiquidLayerComponent)) continue; // a layer its volume has forgotten
    const placement = world.get(entity, PlacementComponent);
    if (placement === undefined) continue;
    const at = boundingSphereOf(world, entity, placement);
    shapes.push({
      id: entity,
      box: false,
      a: [at.x, at.y, at.z],
      b: [at.radius, at.radius, at.radius],
    });
  }
  return shapes;
}

/** Squared distance from a sphere's centre to a box. */
function distanceToBox(centre: NodeShape, box: NodeShape): number {
  let sum = 0;
  for (let k = 0; k < 3; k++) {
    const c = known(centre.a[k]);
    const over = Math.max(known(box.a[k]) - c, 0, c - known(box.b[k]));
    sum += over * over;
  }
  return sum;
}

/** Whether two shapes touch or overlap within `gap`. */
function touches(p: NodeShape, q: NodeShape, gap: number): boolean {
  if (p.box && q.box) {
    for (let k = 0; k < 3; k++) {
      if (known(p.a[k]) > known(q.b[k]) + gap) return false;
      if (known(q.a[k]) > known(p.b[k]) + gap) return false;
    }
    return true;
  }
  if (p.box || q.box) {
    const [centre, box] = p.box ? [q, p] : [p, q];
    const reach = centre.b[0] + gap;
    return distanceToBox(centre, box) <= reach * reach;
  }
  const reach = p.b[0] + q.b[0] + gap;
  let sum = 0;
  for (let k = 0; k < 3; k++) {
    const d = known(p.a[k]) - known(q.a[k]);
    sum += d * d;
  }
  return sum <= reach * reach;
}

/** The lowest and highest x a shape reaches. */
const minX = (s: NodeShape): number => (s.box ? s.a[0] : s.a[0] - s.b[0]);
const maxX = (s: NodeShape): number => (s.box ? s.b[0] : s.a[0] + s.b[0]);

/** Builds the graph over `shapes` (ascending id) by a sweep along x. */
export function buildGraph(shapes: readonly NodeShape[], gap: number): ConductionGraph {
  const order = shapes
    .map((_, i) => i)
    .sort((x, y) => minX(known(shapes[x])) - minX(known(shapes[y])) || x - y);
  const links: number[][] = shapes.map(() => []);
  for (let i = 0; i < order.length; i++) {
    const p = known(order[i]);
    const reach = maxX(known(shapes[p])) + gap;
    for (let j = i + 1; j < order.length; j++) {
      const q = known(order[j]);
      if (minX(known(shapes[q])) > reach) break;
      if (touches(known(shapes[p]), known(shapes[q]), gap)) {
        known(links[p]).push(q);
        known(links[q]).push(p);
      }
    }
  }
  for (const list of links) list.sort((x, y) => x - y);
  const ids = shapes.map((s) => s.id);
  return { ids, index: new Map(ids.map((id, i) => [id, i])), neighbours: links };
}

/** The cached conduction graph of one world (derived data: never saved, rebuilt on demand). */
export class ConductionGraphCache {
  private shapes: readonly NodeShape[] = [];
  private graph: ConductionGraph | undefined;
  /** How many times the graph has been built (tests and the debug overlay read it). */
  builds = 0;

  /** The graph for `world` as it is now: the last build while nothing relevant changed. */
  refresh(world: World<never>, gap: number): ConductionGraph {
    const shapes = conductingShapes(world);
    const same =
      this.graph !== undefined &&
      shapes.length === this.shapes.length &&
      shapes.every((shape, i) => sameShape(shape, known(this.shapes[i])));
    if (same) return known(this.graph);
    this.shapes = shapes;
    this.graph = buildGraph(shapes, gap);
    this.builds += 1;
    return this.graph;
  }
}
