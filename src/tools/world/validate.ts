// The world map validator (mw-e24.1), `pnpm world:validate`: proves the connectivity map in
// src/content/data/world/connectivity.json (docs/design/world-map.md) holds together.
//
//   AC-1  every node is reachable from the town spawn using only edges every base class can take: an
//         edge is open to a class when it lists no `routes` (a quest or puzzle outcome anyone can
//         cause) or the class's MVP capabilities include one of them.
//   AC-2  each shortcut's unlock facts are produced by some placed content (a signal graph a scene
//         places, a puzzle in a scene, a respawn rule, an entity fact of a placed spawn): an
//         unproduced fact is a warning, a shortcut with no unlock an error.
//   AC-3  the loops of bible 3.1 exist and are real cycles, the towpath and the barge reach Wendmouth,
//         and every class has an ability-gated shortcut.
//   AC-5  the main-quest critical path (waypoints joined by shortest paths) exists without any
//         optional node (Wendmouth, Kestrel Lock) and without a barge edge.
// Edges naming an unknown node fail when the file loads (schema, AC-4); `checkWorld` covers what
// needs other content. Planned edges without a bead are warnings.

import type { Frozen, GameContent, WorldMap } from '@content/index';

type World = Frozen<WorldMap>;
type Edge = World['edges'][number];

/** The four base classes. */
export const BASE_CLASSES = ['knight', 'archer', 'sorcerer', 'thief'] as const;

/** Loops story bible 3.1 promises; each must be in the map. */
export const REQUIRED_LOOPS = [
  'forest-watchtower-priory',
  'watchtower-tunnel-upper-mine',
  'priory-crypt-sounding-shaft-knot',
  'glen-well-cistern-priory',
  'jail-drain-cistern',
  'weeping-adit-lower-deepworks',
  'stone-stair',
  'millweir-far-bank',
  'towpath-barge',
  'wendmouth-link',
] as const;

/** A value known to be present by construction (noUncheckedIndexedAccess cannot see it). */
const known = <T>(value: T | null | undefined): T => value as T;

/** What the validator needs from the rest of the content. */
export interface WorldEnv {
  readonly classes: readonly { readonly id: string; readonly mvpCapabilities: readonly string[] }[];
  /** Facts some placed content writes. */
  readonly produced: ReadonlySet<string>;
}

export interface WorldReport {
  readonly errors: string[];
  readonly warnings: string[];
  /** The main-quest critical path, node ids in order (empty when it cannot be computed). */
  readonly criticalPath: string[];
  readonly built: { readonly nodes: number; readonly edges: number };
  readonly planned: { readonly nodes: number; readonly edges: number };
}

/** Every fact a condition reads (count patterns and live leaves read none). */
export function conditionFacts(condition: unknown): string[] {
  if (typeof condition !== 'object' || condition === null) return [];
  const c = condition as Record<string, unknown>;
  if (typeof c['fact'] === 'string') return [c['fact']];
  if (Array.isArray(c['all'])) return c['all'].flatMap(conditionFacts);
  if (Array.isArray(c['any'])) return c['any'].flatMap(conditionFacts);
  return conditionFacts(c['not'] ?? c['sustained']);
}

/** Facts that placed content writes: graphs and puzzles in scenes, respawn rules, entity facts. */
export function producedFacts(content: GameContent): Set<string> {
  const produced = new Set<string>();
  const scenes = new Map(content.all('scene').map((scene) => [scene.id, scene]));
  const graphs = new Map(content.all('signal-graph').map((graph) => [graph.id, graph]));
  for (const scene of scenes.values()) {
    for (const { graph } of scene.signals) {
      for (const node of graphs.get(graph.id)?.nodes ?? []) {
        if (node.kind === 'receiver' && node.receiver === 'fact' && node.key !== undefined) {
          produced.add(node.key);
        }
      }
    }
  }
  for (const puzzle of content.all('puzzle')) {
    if (!scenes.has(puzzle.scene.id)) continue;
    produced.add(puzzle.outputs.solvedFact);
    for (const { fact } of puzzle.outputs.set) produced.add(fact);
    for (const tier of puzzle.hints) if (tier.rumour !== undefined) produced.add(tier.rumour);
    for (const policy of puzzle.policy.recovery) {
      if (policy.kind === 'reset' && policy.fact !== undefined) produced.add(policy.fact);
    }
  }
  for (const rules of content.all('respawn-rules')) {
    for (const rule of rules.rules) for (const { fact } of rule.factsToSet) produced.add(fact);
  }
  return produced;
}

const ENTITY_KEY = /^entity:([a-z0-9-]+)\/([a-z0-9-]+)\./;

/** Whether `key` is written by placed content (entity facts count when their spawn is placed). */
export function isProduced(
  key: string,
  produced: ReadonlySet<string>,
  content?: GameContent,
): boolean {
  if (produced.has(key)) return true;
  const match = ENTITY_KEY.exec(key);
  if (match === null || content === undefined) return false;
  return content
    .all('scene')
    .some((s) => s.id === match[1] && s.spawns.some((p) => p.id === match[2]));
}

/** Builds the validator's environment from loaded content. */
export function buildEnv(content: GameContent): WorldEnv {
  return {
    classes: content.all('class').map(({ id, mvpCapabilities }) => ({ id, mvpCapabilities })),
    produced: producedFacts(content),
  };
}

const openTo = (edge: Edge, caps: readonly string[]): boolean =>
  edge.routes.length === 0 || edge.routes.some((route) => caps.includes(route));

/** Nodes reachable from `start` over the edges `usable` accepts (one-way edges only from → to). */
export function reachable(
  world: World,
  start: string,
  usable: (edge: Edge) => boolean,
  allowNode: (id: string) => boolean = () => true,
): Set<string> {
  const seen = new Set([start]);
  const queue = [start];
  while (queue.length > 0) {
    const at = known(queue.shift());
    for (const edge of world.edges) {
      if (!usable(edge)) continue;
      const next =
        edge.from === at
          ? edge.to
          : edge.to === at && edge.kind !== 'one-way'
            ? edge.from
            : undefined;
      if (next === undefined || seen.has(next) || !allowNode(next)) continue;
      seen.add(next);
      queue.push(next);
    }
  }
  return seen;
}

/** Shortest node path from `a` to `b` over usable edges, or undefined. */
export function shortestPath(
  world: World,
  a: string,
  b: string,
  usable: (edge: Edge) => boolean,
  allowNode: (id: string) => boolean,
): string[] | undefined {
  const via = new Map<string, string>();
  const seen = new Set([a]);
  const queue = [a];
  while (queue.length > 0) {
    const at = known(queue.shift());
    if (at === b) {
      const path = [b];
      for (let step = b; step !== a;) {
        step = known(via.get(step));
        path.unshift(step);
      }
      return path;
    }
    for (const edge of world.edges) {
      if (!usable(edge)) continue;
      const next =
        edge.from === at
          ? edge.to
          : edge.to === at && edge.kind !== 'one-way'
            ? edge.from
            : undefined;
      if (next === undefined || seen.has(next) || !allowNode(next)) continue;
      seen.add(next);
      via.set(next, at);
      queue.push(next);
    }
  }
  return undefined;
}

/** Whether `edgeIds` form one simple cycle (every node on exactly two of them, all connected). */
export function isCycle(world: World, edgeIds: readonly string[]): boolean {
  const byId = new Map(world.edges.map((edge) => [edge.id, edge]));
  const degree = new Map<string, number>();
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    const p = parent.get(x) ?? x;
    return p === x ? x : find(p);
  };
  for (const id of edgeIds) {
    const edge = byId.get(id);
    if (edge === undefined) return false;
    for (const end of [edge.from, edge.to]) degree.set(end, (degree.get(end) ?? 0) + 1);
    parent.set(find(edge.from), find(edge.to));
  }
  const roots = new Set([...degree.keys()].map(find));
  return roots.size === 1 && [...degree.values()].every((d) => d === 2);
}

/** Runs every check on one map. */
export function validateWorld(world: World, env: WorldEnv, content?: GameContent): WorldReport {
  const errors: string[] = [];
  const warnings: string[] = [];
  const classCaps = BASE_CLASSES.map(
    (id) => env.classes.find((c) => c.id === id)?.mvpCapabilities ?? [],
  );
  const baseOpen = (edge: Edge): boolean => classCaps.every((caps) => openTo(edge, caps));
  const nodes = new Map(world.nodes.map((n) => [n.id, n]));

  // AC-1
  const reached = reachable(world, world.townSpawn, baseOpen);
  for (const node of world.nodes) {
    if (!reached.has(node.id)) {
      errors.push(
        `AC-1: node "${node.id}" is not reachable from the town spawn "${world.townSpawn}" with the base classes' capabilities`,
      );
    }
  }

  // AC-2
  const produced = env.produced;
  for (const edge of world.edges) {
    if (edge.kind !== 'shortcut') continue;
    if (edge.unlock === undefined) {
      errors.push(`AC-2: shortcut "${edge.id}" has no unlock condition`);
      continue;
    }
    for (const fact of new Set(conditionFacts(edge.unlock))) {
      if (!isProduced(fact, produced, content)) {
        warnings.push(
          `AC-2: shortcut "${edge.id}" unlocks on fact "${fact}", which no placed content produces yet${edge.bead === undefined ? '' : ` (${edge.bead})`}`,
        );
      }
    }
  }

  // AC-3
  const loops = new Map(world.loops.map((l) => [l.id, l]));
  for (const id of REQUIRED_LOOPS) {
    if (!loops.has(id)) errors.push(`AC-3: loop "${id}" of the story bible (3.1) is missing`);
  }
  for (const loop of world.loops) {
    if (!isCycle(world, loop.edges)) {
      errors.push(
        `AC-3: loop "${loop.id}" is not a single cycle (each node needs exactly two of its edges)`,
      );
    }
  }
  const wendmouth = (id: string): boolean => nodes.get(id)?.area === 'wendmouth';
  const toWendmouth = world.edges.filter((e) => wendmouth(e.to) || wendmouth(e.from));
  if (!toWendmouth.some((e) => e.travel === 'barge'))
    errors.push('AC-3: no barge edge reaches Wendmouth');
  if (
    !toWendmouth.some(
      (e) =>
        e.travel === 'foot' && e.kind === 'path' && e.routes.length === 0 && e.unlock === undefined,
    )
  ) {
    errors.push('AC-3: no always-open towpath edge reaches Wendmouth');
  }
  for (const id of BASE_CLASSES) {
    if (
      !world.edges.some(
        (e) => (e.kind === 'shortcut' || e.kind === 'secret') && e.classesHint.includes(id),
      )
    ) {
      errors.push(`AC-3: class "${id}" has no ability-gated shortcut`);
    }
  }

  // AC-5
  const required = (edge: Edge): boolean => baseOpen(edge) && edge.travel === 'foot';
  const allowed = (id: string): boolean => nodes.get(id)?.optional !== true;
  const criticalPath: string[] = [];
  for (const id of world.mainQuest) {
    if (nodes.get(id)?.optional === true)
      errors.push(`AC-5: main-quest waypoint "${id}" is optional (Wendmouth is never required)`);
  }
  for (let i = 1; i < world.mainQuest.length; i++) {
    const a = known(world.mainQuest[i - 1]);
    const b = known(world.mainQuest[i]);
    const leg = shortestPath(world, a, b, required, allowed);
    if (leg === undefined) {
      errors.push(
        `AC-5: the main quest cannot get from "${a}" to "${b}" without an optional node or a barge edge`,
      );
      criticalPath.length = 0;
      break;
    }
    criticalPath.push(...(i === 1 ? leg : leg.slice(1)));
  }

  // Built versus planned.
  for (const edge of world.edges) {
    if (edge.transitions.length === 0 && edge.bead === undefined) {
      warnings.push(`edge "${edge.id}" is planned but names no bead that builds it`);
    }
  }
  const builtNodes = world.nodes.filter((n) => n.scene !== undefined).length;
  const builtEdges = world.edges.filter((e) => e.transitions.length > 0).length;
  return {
    errors,
    warnings,
    criticalPath,
    built: { nodes: builtNodes, edges: builtEdges },
    planned: { nodes: world.nodes.length - builtNodes, edges: world.edges.length - builtEdges },
  };
}
