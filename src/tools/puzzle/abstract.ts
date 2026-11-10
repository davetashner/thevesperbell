// The abstract layer of the puzzle solver (mw-e15.6): a bounded breadth-first search over an
// abstraction of a puzzle's level, to prove a declared solution reachable before anyone plays it.
//
// Abstract state, extracted from the scene's spawns (prefabs are already expanded into spawns when
// content loads, so push rules, plates, switches, braziers and burning props all arrive here as
// ordinary spawn data): per entity, whether it is lit (a light source that is not unlit, a prop that
// is `burning`) and where a movable thing rests (its home, or at another entity: a plate, a brazier,
// a ledge). Nothing else: no cells, no timing, no geometry, and no signal graphs yet, so goals that
// read a signal, a fact or a count of facts are inconclusive here (the concrete layer still runs).
//
// Actions come from what the actor can do, never from the declared steps (the steps are the concrete
// layer's script, concrete.ts):
//   anyone      carry a burning prop to a lit-able entity (lights it); move a movable thing to any
//               place (the puzzle's entities and plates).
//   capability  each capability stands for the stimulus elements its spell emits (`heat` lights a
//               lit-able entity from range; a tether spell counts as `force`). A capability with no model here makes the search
//               inconclusive rather than pessimistic.
//
// The abstraction over-approximates what is possible (any movable thing can go to any listed place),
// so "unreachable" is trustworthy; where it is too pessimistic (an element it has no rule for) the
// concrete layer can still succeed, and the validator reports an abstraction gap.

import type { Condition, Frozen, Puzzle as PuzzleDef, SceneDef } from '@content/index';

type Puzzle = Frozen<PuzzleDef>;

type Spawn = Frozen<SceneDef>['spawns'][number];

/**
 * How a thing is lost for good: it burns away once lit, breaks, is pushed out of the level, or melts
 * (a frozen thing meets heat). These are the irreversible transitions of the softlock search.
 */
export type LossKind = 'burn' | 'break' | 'fall' | 'melt';

/** What the abstract layer knows of a capability: the elements it brings to bear. */
export type CapabilityElements = ReadonlyMap<string, readonly string[]>;

/** Elements that have abstract rules. */
const MODELLED_ELEMENTS: ReadonlySet<string> = new Set(['heat', 'force']);

/** Bounds on one search (AC-5): states visited, depth, and a wall clock the caller supplies. */
export interface SearchBounds {
  readonly maxNodes: number;
  readonly maxDepth: number;
  /** Stop after this many milliseconds by `now`; undefined: no clock. */
  readonly timeBudgetMs?: number | undefined;
  readonly now?: (() => number) | undefined;
}

export const DEFAULT_BOUNDS: SearchBounds = { maxNodes: 200_000, maxDepth: 40 };

export type AbstractResult =
  | { readonly status: 'reachable'; readonly steps: number; readonly path: readonly string[] }
  | {
      readonly status: 'unreachable';
      /** What the level lacks (a missing entity, a thing that cannot move); empty: no sequence works. */
      readonly missing: readonly string[];
      readonly explored: number;
    }
  | { readonly status: 'inconclusive'; readonly reason: string; readonly explored: number };

/** The elements of every spell capability (`spell.<id>`), from the content's spells. */
export function capabilityElementsOf(
  spells: readonly {
    readonly id: string;
    readonly delivery: { readonly kind: string };
    readonly effects: readonly { readonly op: string; readonly element?: string }[];
  }[],
): CapabilityElements {
  const map = new Map<string, readonly string[]>();
  for (const spell of spells) {
    const elements = new Set<string>();
    for (const effect of spell.effects) {
      if (effect.op === 'stimulus' && effect.element !== undefined) elements.add(effect.element);
    }
    if (spell.delivery.kind === 'tether') elements.add('force');
    map.set(`spell.${spell.id}`, [...elements].sort());
  }
  return map;
}

interface Entity {
  readonly id: string;
  readonly spawn: Spawn;
  readonly litable: boolean;
  readonly lit0: boolean;
  readonly movable: boolean;
  readonly carrier: boolean;
  /** The ways a listed entity can be lost for good (none for one the puzzle does not list). */
  readonly losses: readonly LossKind[];
  /** The losses something already recovers: a recovery policy, the critical return, an anchor. */
  readonly covered: readonly LossKind[];
}

interface State {
  readonly lit: readonly boolean[];
  /** Entities lost for good: burnt away, broken, fallen out of the level, melted (softlocks, below). */
  readonly gone: readonly boolean[];
  /** Index of the entity a movable thing rests at, or -1 for its home. */
  readonly at: readonly number[];
}

/** The abstraction of one puzzle in its scene. */
export interface AbstractPuzzle {
  readonly puzzle: Puzzle;
  readonly entities: readonly Entity[];
  readonly index: ReadonlyMap<string, number>;
  /** Entities a movable thing can be put at: the puzzle's own, and plates. */
  readonly places: readonly number[];
  readonly capabilityElements: CapabilityElements;
}

/** A value known to be present by construction. */
const known = <T>(value: T | undefined): T => value as T;

const properties = (spawn: Spawn): Readonly<Record<string, unknown>> => spawn.properties ?? {};

function entityOf(
  spawn: Spawn,
  listed: ReadonlySet<string>,
  respawned: ReadonlySet<string>,
): Entity {
  const props = properties(spawn);
  const burning = props['burning'] === true;
  const lightSource = spawn.lightSource;
  const hasProp = spawn.prop !== undefined;
  const pushable = spawn.push !== undefined || props['pushable'] === true;
  const movable = pushable || hasProp;
  const flammable = lightSource === undefined && (props['flammable'] === true || burning);
  const losses: LossKind[] = [];
  if (listed.has(spawn.id)) {
    if (flammable) losses.push('burn');
    if (spawn.breakable !== undefined) losses.push('break');
    if (movable) losses.push('fall');
    if (movable && props['frozen'] === true) losses.push('melt');
  }
  return {
    id: spawn.id,
    spawn,
    litable: lightSource !== undefined || props['flammable'] === true || burning,
    lit0: lightSource !== undefined ? lightSource.unlit !== true : burning,
    movable,
    carrier: burning && hasProp && lightSource === undefined,
    losses,
    covered: respawned.has(spawn.id)
      ? losses
      : losses.filter(
          (kind) => (kind === 'fall' || kind === 'break') && spawn.recovery !== undefined,
        ),
  };
}

/** Extracts the abstract puzzle from the puzzle's data and the scene (prefabs expanded) it lives in. */
export function abstractPuzzle(
  puzzle: Puzzle,
  scene: Frozen<Pick<SceneDef, 'spawns'>>,
  capabilityElements: CapabilityElements,
): AbstractPuzzle {
  const listed = new Set(puzzle.entities.map(({ id }) => id));
  const respawned = new Set(
    puzzle.policy.recovery.flatMap((policy) => (policy.kind === 'respawn' ? [policy.entity] : [])),
  );
  // A critical entity that falls out of the level is returned to where it began (mw-e15.7).
  const critical = new Set(puzzle.entities.filter((e) => e.critical).map(({ id }) => id));
  const entities = scene.spawns.map((spawn) => {
    const entity = entityOf(spawn, listed, respawned);
    return critical.has(spawn.id) &&
      entity.losses.includes('fall') &&
      !entity.covered.includes('fall')
      ? { ...entity, covered: [...entity.covered, 'fall' as const] }
      : entity;
  });
  const index = new Map(entities.map((entity, i) => [entity.id, i] as const));
  const places = entities.flatMap((entity, i) =>
    listed.has(entity.id) || entity.spawn.plate !== undefined ? [i] : [],
  );
  return { puzzle, entities, index, places, capabilityElements };
}

/** What the level lacks for a solution's steps: entities that are not spawns, things that cannot move. */
export function missingRequirements(
  abstract: AbstractPuzzle,
  solution: Puzzle['solutions'][number],
): string[] {
  const missing: string[] = [];
  const need = (what: string) => {
    missing.push(what);
  };
  solution.steps.forEach((step, i) => {
    const at = `step ${String(i + 1)} (${step.do})`;
    if (step.do === 'wait') return;
    const spawnOf = (id: string) => {
      const found = abstract.index.get(id);
      if (found === undefined) need(`${at}: the level has no entity "${id}"`);
      return found;
    };
    if (step.do === 'move') {
      const target = step.target === 'player' ? undefined : spawnOf(step.target);
      spawnOf(step.to);
      const entity = target === undefined ? undefined : abstract.entities[target];
      if (entity !== undefined && !entity.movable) {
        need(`${at}: "${entity.id}" cannot be moved (no prop, push rule or pushable property)`);
      }
      return;
    }
    spawnOf(step.target);
  });
  return missing;
}

function initial(abstract: AbstractPuzzle): State {
  return {
    lit: abstract.entities.map((e) => e.lit0),
    gone: abstract.entities.map(() => false),
    at: abstract.entities.map(() => -1),
  };
}

const keyOf = (s: State): string =>
  `${s.lit.map(Number).join('')}|${s.gone.map(Number).join('')}|${s.at.join(',')}`;

const withAt = <T>(list: readonly T[], i: number, value: T): T[] => {
  const next = [...list];
  next[i] = value;
  return next;
};

/** Every action available to an actor with `elements`, as (label, next state) pairs. */
function successors(
  abstract: AbstractPuzzle,
  state: State,
  elements: ReadonlySet<string>,
  losses?: ReadonlySet<number>,
): [string, State][] {
  const out: [string, State][] = [];
  const { entities, places } = abstract;
  entities.forEach((target, t) => {
    // Heat from range, or a flame carried from a burning prop.
    if (target.litable && !state.lit[t] && !state.gone[t]) {
      if (elements.has('heat')) {
        out.push([`heat ${target.id}`, { ...state, lit: withAt(state.lit, t, true) }]);
      }
      entities.forEach((carrier, c) => {
        if (carrier.carrier && state.lit[c] && !state.gone[c] && c !== t) {
          out.push([
            `carry ${carrier.id} to ${target.id}`,
            { ...state, lit: withAt(state.lit, t, true), at: withAt(state.at, c, t) },
          ]);
        }
      });
    }
  });
  // A movable thing is put at any place (by hand, or dragged from range).
  entities.forEach((thing, m) => {
    if (!thing.movable || state.gone[m]) return;
    for (const place of places) {
      if (place === m || state.at[m] === place || state.gone[place]) continue;
      out.push([
        `move ${thing.id} to ${known(entities[place]).id}`,
        { ...state, at: withAt(state.at, m, place) },
      ]);
    }
  });
  // Irreversible losses of the entities that can suffer them (the softlock search only).
  for (const t of losses ?? []) {
    if (state.gone[t]) continue;
    for (const kind of lossKinds(abstract, state, elements, t)) {
      out.push([
        `${kind} ${known(entities[t]).id}`,
        {
          lit: withAt(state.lit, t, false),
          gone: withAt(state.gone, t, true),
          at: withAt(state.at, t, -1),
        },
      ]);
    }
  }
  return out;
}

/** The ways a listed entity can be lost for good in `state` (see `Entity.losses`). */
function lossKinds(
  abstract: AbstractPuzzle,
  state: State,
  elements: ReadonlySet<string>,
  i: number,
): LossKind[] {
  const entity = known(abstract.entities[i]);
  return entity.losses.filter((kind) => {
    if (kind === 'burn') return Boolean(state.lit[i]);
    if (kind === 'melt') return elements.has('heat') || state.lit.some(Boolean);
    return true;
  });
}

const COMPARISONS: readonly [string, (count: number, bound: number) => boolean][] = [
  ['eq', (a, b) => a === b],
  ['neq', (a, b) => a !== b],
  ['gt', (a, b) => a > b],
  ['gte', (a, b) => a >= b],
  ['lt', (a, b) => a < b],
  ['lte', (a, b) => a <= b],
];

/** The count against the condition's operator (an entities condition has match or exactly one). */
function compare(count: number, cond: Record<string, unknown>): boolean {
  const found = COMPARISONS.find(([name]) => cond[name] !== undefined);
  return found?.[1](count, cond[found[0]] as number) === true;
}

interface Volume {
  readonly kind: string;
  readonly center: { readonly x: number; readonly y: number; readonly z: number };
  readonly halfExtents: { readonly x: number; readonly y: number; readonly z: number };
  readonly radius: number;
}

/** Whether `at` is in a box or sphere volume (capsules are screened out by `unmodelled`). */
function inside(volume: unknown, at: readonly [number, number, number]): boolean {
  const { kind, center: c, halfExtents: h, radius } = volume as Volume;
  const [x, y, z] = at;
  if (kind === 'box') {
    return Math.abs(x - c.x) <= h.x && Math.abs(y - c.y) <= h.y && Math.abs(z - c.z) <= h.z;
  }
  return Math.hypot(x - c.x, y - c.y, z - c.z) <= radius;
}

/** Whether a predicate reads whether the entity burns (`element fire`, `burning` equal to a value). */
const readsFire = (p: Record<string, unknown>): boolean =>
  (p['test'] === 'element' && p['element'] === 'fire') ||
  (p['test'] === 'property' && p['property'] === 'burning' && p['op'] === 'eq');

/** What in a goal the abstraction has no model of, or undefined when it models all of it. */
export function unmodelled(condition: Frozen<Condition>): string | undefined {
  const cond = condition as Record<string, unknown>;
  const inner = cond['sustained'] ?? cond['not'];
  if (inner !== undefined) return unmodelled(inner as Frozen<Condition>);
  const list = (cond['all'] ?? cond['any']) as Frozen<Condition>[] | undefined;
  if (list !== undefined) {
    return list.map(unmodelled).find((gap) => gap !== undefined);
  }
  if (!('entities' in cond)) return 'fact, count and signal conditions';
  if ((cond['inside'] as { kind?: string } | undefined)?.kind === 'capsule') {
    return 'a capsule volume';
  }
  const where = (cond['where'] ?? []) as Record<string, unknown>[];
  const odd = where.find((p) => p['test'] !== 'tag' && !readsFire(p));
  return odd === undefined ? undefined : `the "${String(odd['test'])}" predicate`;
}

/** Evaluates a goal over an abstract state; the goal must pass `unmodelled`. */
function holds(abstract: AbstractPuzzle, state: State, condition: Frozen<Condition>): boolean {
  const cond = condition as Record<string, unknown>;
  if ('sustained' in cond) return holds(abstract, state, cond['sustained'] as Frozen<Condition>);
  if ('all' in cond)
    return (cond['all'] as Frozen<Condition>[]).every((c) => holds(abstract, state, c));
  if ('any' in cond)
    return (cond['any'] as Frozen<Condition>[]).some((c) => holds(abstract, state, c));
  if ('not' in cond) return !holds(abstract, state, cond['not'] as Frozen<Condition>);
  const select = cond['entities'] as { tag?: string; entity?: string };
  const picked = abstract.entities.flatMap((entity, i) =>
    (select.tag === undefined || entity.spawn.tags.includes(select.tag)) &&
    (select.entity === undefined || entity.id === select.entity)
      ? [i]
      : [],
  );
  const where = (cond['where'] ?? []) as Record<string, unknown>[];
  const passes = (i: number): boolean => {
    const entity = known(abstract.entities[i]);
    const placed = known(state.at[i]);
    const spawn = placed >= 0 ? known(abstract.entities[placed]).spawn : entity.spawn;
    if (cond['inside'] !== undefined && !inside(cond['inside'], spawn.at)) return false;
    return where.every((p) => {
      if (p['test'] === 'tag') return entity.spawn.tags.includes(p['tag'] as string);
      const want = p['test'] === 'property' ? p['value'] === true : true;
      return Boolean(state.lit[i]) === want;
    });
  };
  const passing = picked.filter(passes).length;
  const match = cond['match'];
  if (match === 'all') return picked.length > 0 && passing === picked.length;
  if (match === 'any') return passing > 0;
  if (match === 'none') return passing === 0;
  return compare(passing, cond);
}

/**
 * Searches, breadth first, for the fewest actions that make the puzzle's goal true for an actor with
 * `capabilities` (all of them), within `bounds`. States are memoised by a canonical key.
 */
export function searchGoal(
  abstract: AbstractPuzzle,
  capabilities: readonly string[],
  bounds: SearchBounds = DEFAULT_BOUNDS,
): AbstractResult {
  const elements = new Set<string>();
  for (const capability of capabilities) {
    const known = abstract.capabilityElements.get(capability);
    if (known === undefined || known.some((e) => !MODELLED_ELEMENTS.has(e))) {
      return {
        status: 'inconclusive',
        reason: `capability "${capability}" has no abstract model`,
        explored: 0,
      };
    }
    known.forEach((e) => elements.add(e));
  }
  const goal = abstract.puzzle.goal;
  const gap = unmodelled(goal);
  if (gap !== undefined) {
    return {
      status: 'inconclusive',
      reason: `the goal uses ${gap}, which the abstraction does not model`,
      explored: 0,
    };
  }
  const reached = (state: State) => holds(abstract, state, goal);
  const start = initial(abstract);
  if (reached(start)) return { status: 'reachable', steps: 0, path: [] };
  const seen = new Set([keyOf(start)]);
  const parent = new Map<string, [string, string]>();
  let frontier: State[] = [start];
  const clock = bounds.now;
  const began = clock?.() ?? 0;
  for (let depth = 1; depth <= bounds.maxDepth; depth++) {
    const next: State[] = [];
    for (const state of frontier) {
      const from = keyOf(state);
      for (const [label, after] of successors(abstract, state, elements)) {
        const key = keyOf(after);
        if (seen.has(key)) continue;
        seen.add(key);
        parent.set(key, [from, label]);
        if (reached(after)) {
          const path: string[] = [];
          for (let at = key, link = parent.get(at); link !== undefined; link = parent.get(at)) {
            path.unshift(link[1]);
            at = link[0];
          }
          return { status: 'reachable', steps: depth, path };
        }
        if (seen.size >= bounds.maxNodes) {
          return {
            status: 'inconclusive',
            reason: `search bound of ${String(bounds.maxNodes)} states reached`,
            explored: seen.size,
          };
        }
        next.push(after);
      }
      if (
        clock !== undefined &&
        bounds.timeBudgetMs !== undefined &&
        clock() - began > bounds.timeBudgetMs
      ) {
        return {
          status: 'inconclusive',
          reason: `time budget of ${String(bounds.timeBudgetMs)} ms used up`,
          explored: seen.size,
        };
      }
    }
    if (next.length === 0) return { status: 'unreachable', missing: [], explored: seen.size };
    frontier = next;
  }
  return {
    status: 'inconclusive',
    reason: `depth bound of ${String(bounds.maxDepth)} actions reached`,
    explored: seen.size,
  };
}

/** The abstract verdict on one declared solution: its missing requirements first, then the search. */
export function checkSolution(
  abstract: AbstractPuzzle,
  solution: Puzzle['solutions'][number],
  bounds: SearchBounds = DEFAULT_BOUNDS,
): AbstractResult {
  const missing = missingRequirements(abstract, solution);
  if (missing.length > 0) return { status: 'unreachable', missing, explored: 0 };
  return searchGoal(abstract, solution.capabilities, bounds);
}

export interface Shortcut {
  /** The smaller capability set that already reaches the goal. */
  readonly capabilities: readonly string[];
  readonly steps: number;
}

/**
 * A shortcut around a class-specific solution (one that needs capabilities): the goal reachable with
 * none of them, or else with all but one. Undefined when there is none.
 */
export function findShortcut(
  abstract: AbstractPuzzle,
  solution: Puzzle['solutions'][number],
  bounds: SearchBounds = DEFAULT_BOUNDS,
): Shortcut | undefined {
  const needs = solution.capabilities;
  if (needs.length === 0) return undefined;
  const smaller: (readonly string[])[] = [
    [],
    ...(needs.length > 1 ? needs.map((_, i) => needs.filter((__, j) => j !== i)) : []),
  ];
  for (const capabilities of smaller) {
    const result = searchGoal(abstract, capabilities, bounds);
    if (result.status === 'reachable') return { capabilities, steps: result.steps };
  }
  return undefined;
}

export type SoftlockResult =
  /** No reachable loss leaves the goal out of reach (or the goal is already out of reach: see the goal search). */
  | { readonly status: 'none'; readonly explored: number }
  /** A reachable state, after the `lost` entities were lost for good, from which no action reaches the goal. */
  | {
      readonly status: 'softlock';
      readonly lost: readonly string[];
      /** Actions from the start to that state, the losses included. */
      readonly path: readonly string[];
      readonly explored: number;
    }
  /** Without the recovery declared a softlock exists; with it, none. */
  | { readonly status: 'covered'; readonly by: readonly string[]; readonly explored: number }
  | { readonly status: 'inconclusive'; readonly reason: string; readonly explored: number };

/** Explores every reachable state, losses included, and returns the shallowest dead one (goal out of reach). */
function deadState(
  abstract: AbstractPuzzle,
  elements: ReadonlySet<string>,
  losses: ReadonlySet<number>,
  bounds: SearchBounds,
): { dead: State | undefined; path: string[]; explored: number } | string {
  const goal = abstract.puzzle.goal;
  const start = initial(abstract);
  const states: State[] = [start];
  const index = new Map([[keyOf(start), 0]]);
  const parent: ([number, string] | undefined)[] = [undefined];
  const into: number[][] = [[]];
  const depth: number[] = [0];
  const clock = bounds.now;
  const began = clock?.() ?? 0;
  for (let at = 0; at < states.length; at++) {
    if (known(depth[at]) >= bounds.maxDepth) {
      return `depth bound of ${String(bounds.maxDepth)} actions reached`;
    }
    if (
      clock !== undefined &&
      bounds.timeBudgetMs !== undefined &&
      clock() - began > bounds.timeBudgetMs
    ) {
      return `time budget of ${String(bounds.timeBudgetMs)} ms used up`;
    }
    for (const [label, after] of successors(abstract, known(states[at]), elements, losses)) {
      const key = keyOf(after);
      let to = index.get(key);
      if (to === undefined) {
        if (states.length >= bounds.maxNodes) {
          return `search bound of ${String(bounds.maxNodes)} states reached`;
        }
        to = states.length;
        index.set(key, to);
        states.push(after);
        parent.push([at, label]);
        into.push([]);
        depth.push(known(depth[at]) + 1);
      }
      known(into[to]).push(at);
    }
  }
  // Backwards from the states that meet the goal: everything that can still win.
  const winning = new Set<number>();
  const queue = states.flatMap((state, i) => (holds(abstract, state, goal) ? [i] : []));
  queue.forEach((i) => winning.add(i));
  for (const i of queue) {
    for (const before of known(into[i])) {
      if (winning.has(before)) continue;
      winning.add(before);
      queue.push(before);
    }
  }
  // A goal out of reach from the start is the goal search's finding, not a softlock.
  const deadAt = winning.has(0) ? states.findIndex((_, i) => !winning.has(i)) : -1;
  if (deadAt < 0) return { dead: undefined, path: [], explored: states.length };
  const path: string[] = [];
  for (let i = deadAt, link = parent[i]; link !== undefined; link = parent[i]) {
    path.unshift(link[1]);
    i = link[0];
  }
  return { dead: states[deadAt], path, explored: states.length };
}

/**
 * Searches for a softlock for an actor with `capabilities`: a reachable state, after something the
 * puzzle lists is lost for good (burnt away, broken, pushed out of the level, melted), from which no
 * action reaches the goal. A loss that something recovers (a respawn policy for it, the return of a
 * critical entity that falls out of the level, a recovery anchor) is not explored; a softlock that
 * only that recovery removes is reported as `covered`. Conservative: it assumes every listed thing
 * can suffer every loss its properties allow, and stops at the bounds as inconclusive.
 */
export function findSoftlock(
  abstract: AbstractPuzzle,
  capabilities: readonly string[],
  bounds: SearchBounds = DEFAULT_BOUNDS,
): SoftlockResult {
  const elements = new Set<string>();
  for (const capability of capabilities) {
    const known = abstract.capabilityElements.get(capability);
    if (known === undefined || known.some((e) => !MODELLED_ELEMENTS.has(e))) {
      return {
        status: 'inconclusive',
        reason: `capability "${capability}" has no abstract model`,
        explored: 0,
      };
    }
    known.forEach((e) => elements.add(e));
  }
  const gap = unmodelled(abstract.puzzle.goal);
  if (gap !== undefined) {
    return {
      status: 'inconclusive',
      reason: `the goal uses ${gap}, which the abstraction does not model`,
      explored: 0,
    };
  }
  const exposed = (all: boolean): Set<number> =>
    new Set(
      abstract.entities.flatMap((entity, i) =>
        entity.losses.some((kind) => all || !entity.covered.includes(kind)) ? [i] : [],
      ),
    );
  // The protected search prunes covered kinds per entity: a covered entity keeps only its open kinds.
  const protectedAbstract: AbstractPuzzle = {
    ...abstract,
    entities: abstract.entities.map((entity) => ({
      ...entity,
      losses: entity.losses.filter((kind) => !entity.covered.includes(kind)),
    })),
  };
  const open = deadState(protectedAbstract, elements, exposed(false), bounds);
  if (typeof open === 'string') return { status: 'inconclusive', reason: open, explored: 0 };
  if (open.dead !== undefined) {
    return {
      status: 'softlock',
      lost: abstract.entities.flatMap((e, i) => (open.dead?.gone[i] === true ? [e.id] : [])),
      path: open.path,
      explored: open.explored,
    };
  }
  const by = abstract.entities.flatMap((entity) =>
    entity.covered.map((kind) => `${kind} of ${entity.id}`),
  );
  if (by.length === 0) return { status: 'none', explored: open.explored };
  const bare = deadState(abstract, elements, exposed(true), bounds);
  if (typeof bare === 'string') return { status: 'inconclusive', reason: bare, explored: 0 };
  return bare.dead === undefined
    ? { status: 'none', explored: open.explored }
    : { status: 'covered', by, explored: bare.explored };
}
