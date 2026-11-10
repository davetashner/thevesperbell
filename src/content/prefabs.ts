// Expanding puzzle prefabs (mw-e15.4). A scene instance names a prefab, a place, a turn and parameter
// values; `instantiate` turns that into plain scene spawns (ids `<instance>-<local>`, positions
// moved and turned with the instance) and a signal graph (id `<instance>`, bound to those spawns).
// `expandScenePrefabs` runs inside the content loader, before references and checks, so a scene with
// prefabs is parsed again as the ordinary scene it expands to and every existing check sees the
// result. Problems name the scene file, the instance and the parameter.
//
// Nothing here knows a prefab's contents: it substitutes `$name` values, moves and turns what has a
// position or a direction, and prefixes ids.

import type { ContentCheck, ContentIssue, Frozen, LoadedEntry } from './loader.ts';
import { ContentRef } from './schema.ts';
import {
  PARAMETER_REFERENCE,
  type PrefabEntry as PrefabData,
  type PrefabParameter,
} from './types/prefab.ts';

/** A prefab as loaded: deeply readonly. */
export type PrefabEntry = Frozen<PrefabData>;
import { sceneSchema, sceneSpawnSchema, SCENE_YAWS } from './types/scene.ts';
import { signalGraphSchema } from './types/signal-graph.ts';

/** A JSON object whose fields this file touches are named, so they read with dots. */
interface Json {
  [key: string]: unknown;
  id?: unknown;
  at?: unknown;
  yaw?: unknown;
  push?: unknown;
  plate?: unknown;
  liquid?: unknown;
  axis?: unknown;
  size?: unknown;
  prefabs?: unknown;
  spawns?: unknown;
  signals?: unknown;
}

/** What `instantiate` produced for one instance. */
export interface PrefabInstance {
  /** Scene spawns as data-file JSON, ready for the scene schema. */
  readonly spawns: readonly Json[];
  /** The signal graph as data-file JSON, when the prefab has one. */
  readonly graph?: Json;
  /** Binding names (the prefab's local spawn names) to the instance's spawn ids. */
  readonly bindings: Readonly<Record<string, string>>;
}

/** The instance as written in a scene file. */
export interface PrefabPlacement {
  readonly id: string;
  readonly at: readonly [number, number, number];
  readonly yaw: number;
  readonly params: Readonly<Record<string, number | boolean | string>>;
}

const TURNS: Readonly<Record<0 | 90 | 180 | 270, readonly [number, number]>> = {
  0: [1, 0],
  90: [0, 1],
  180: [-1, 0],
  270: [0, -1],
};

/** Turns (x, z) by a quarter-turn yaw about +y, as the scene layout does. */
function turn(x: number, z: number, yaw: number): [number, number] {
  const [cos, sin] = TURNS[yaw as 0 | 90 | 180 | 270];
  return [x * cos + z * sin + 0, -x * sin + z * cos + 0];
}

function describeParameter(parameter: Frozen<PrefabParameter>): string {
  return parameter.type === 'enum'
    ? `one of ${parameter.values.join(', ')}`
    : `a ${parameter.type}`;
}

/** Why `value` does not suit `parameter`, or undefined when it does. */
function parameterProblem(parameter: Frozen<PrefabParameter>, value: unknown): string | undefined {
  switch (parameter.type) {
    case 'boolean':
      return typeof value === 'boolean' ? undefined : 'must be true or false';
    case 'enum':
      return typeof value === 'string' && parameter.values.includes(value)
        ? undefined
        : `must be one of ${parameter.values.join(', ')}`;
    case 'integer':
    case 'number': {
      if (typeof value !== 'number' || !Number.isFinite(value))
        return `must be ${describeParameter(parameter)}`;
      if (parameter.type === 'integer' && !Number.isInteger(value)) return 'must be a whole number';
      if (parameter.min !== undefined && value < parameter.min)
        return `must be at least ${String(parameter.min)}`;
      if (parameter.max !== undefined && value > parameter.max)
        return `must be at most ${String(parameter.max)}`;
      return undefined;
    }
  }
}

function substitute(value: unknown, values: ReadonlyMap<string, unknown>): unknown {
  if (typeof value === 'string') {
    const name = PARAMETER_REFERENCE.exec(value)?.[1];
    return name !== undefined && values.has(name) ? values.get(name) : value;
  }
  if (Array.isArray(value)) return value.map((item) => substitute(item, values));
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, substitute(item, values)]),
    );
  }
  return value;
}

/** `value` as a list of `length` numbers, or undefined. */
function numbers(value: unknown, length: 2): [number, number] | undefined;
function numbers(value: unknown, length: 3): [number, number, number] | undefined;
function numbers(value: unknown, length: number): number[] | undefined {
  return Array.isArray(value) &&
    value.length === length &&
    value.every((n) => typeof n === 'number')
    ? value
    : undefined;
}
const triple = (value: unknown) => numbers(value, 3);

/** Moves and turns one spawn template by the instance. Problems go to `fail`. */
function place(
  template: Json,
  id: string,
  placement: PrefabPlacement,
  fail: (message: string) => void,
): Json {
  const out: Json = { ...template, id };
  delete out['local'];
  const local = triple(template.at ?? [0, 0, 0]);
  if (local === undefined) {
    fail(`spawn "${id}" has an "at" that is not three numbers`);
  } else {
    const [x, z] = turn(local[0], local[2], placement.yaw);
    out.at = [placement.at[0] + x, placement.at[1] + local[1], placement.at[2] + z];
  }
  const ownYaw = typeof template.yaw === 'number' ? template.yaw : 0;
  out.yaw = (ownYaw + placement.yaw) % 360;
  const vector = (key: string, field: string) => {
    const group = out[key];
    if (typeof group !== 'object' || group === null) return;
    const value = triple((group as Json)[field]);
    if (value !== undefined) {
      const [x, z] = turn(value[0], value[2], placement.yaw);
      out[key] = { ...(group as Json), [field]: [x, value[1], z] };
    }
  };
  vector('optic', 'normal');
  vector('beamEmitter', 'direction');
  const push = out.push;
  if (typeof push === 'object' && push !== null) {
    const axis = numbers((push as Json).axis, 2);
    if (axis !== undefined) {
      const [x, z] = turn(axis[0], axis[1], placement.yaw);
      out.push = { ...(push as Json), axis: [x, z] };
    }
  }
  // A quarter turn swaps a footprint's width and depth.
  if (placement.yaw === 90 || placement.yaw === 270) {
    const plate = out.plate;
    if (typeof plate === 'object' && plate !== null) {
      const { width, depth } = plate as Json;
      out.plate = {
        ...(plate as Json),
        ...(width !== undefined && { depth: width }),
        ...(depth !== undefined && { width: depth }),
      };
    }
    const liquid = out.liquid;
    if (typeof liquid === 'object' && liquid !== null) {
      const size = triple((liquid as Json).size);
      if (size !== undefined)
        out.liquid = { ...(liquid as Json), size: [size[2], size[1], size[0]] };
    }
  }
  return out;
}

/**
 * Expands `prefab` for one instance: parameters resolved (defaults for the ones left out), `$name`
 * values substituted, spawns moved and turned, ids prefixed, the graph bound to the spawns.
 * @returns the expansion, or the problems that stopped it (a missing required parameter, a value out
 *   of range, an unknown parameter).
 */
export function instantiate(
  prefab: PrefabEntry,
  placement: PrefabPlacement,
): { readonly instance: PrefabInstance } | { readonly problems: readonly string[] } {
  const problems: string[] = [];
  const values = new Map<string, unknown>();
  for (const name of Object.keys(placement.params)) {
    if (!Object.hasOwn(prefab.parameters, name)) {
      const known = Object.keys(prefab.parameters);
      problems.push(
        `prefab "${prefab.id}" has no parameter "${name}"${known.length === 0 ? ' (it takes none)' : `; its parameters: ${known.join(', ')}`}`,
      );
    }
  }
  for (const [name, parameter] of Object.entries(prefab.parameters)) {
    const given = placement.params[name];
    const value = given ?? parameter.default;
    if (value === undefined) {
      problems.push(
        `missing required parameter "${name}" of prefab "${prefab.id}" (${describeParameter(parameter)}, no default): ${parameter.description}`,
      );
      continue;
    }
    const problem = parameterProblem(parameter, value);
    if (problem !== undefined)
      problems.push(`parameter "${name}" of prefab "${prefab.id}" ${problem}`);
    values.set(name, value);
  }
  if (!(SCENE_YAWS as readonly number[]).includes(placement.yaw)) {
    problems.push(`yaw ${String(placement.yaw)} is not 0, 90, 180 or 270`);
  }
  if (problems.length > 0) return { problems };
  const prefixed = (local: string) => `${placement.id}-${local}`;
  const spawns = prefab.spawns.map((template) =>
    place(substitute(template, values) as Json, prefixed(template.local), placement, (message) =>
      problems.push(message),
    ),
  );
  const bindings = Object.fromEntries(prefab.spawns.map((s) => [s.local, prefixed(s.local)]));
  const observed = new Set(prefab.outputs.flatMap((o) => (o.node === undefined ? [] : [o.node])));
  const graph =
    prefab.graph === undefined
      ? undefined
      : {
          id: placement.id,
          name: `${prefab.name} (${placement.id})`,
          notes: prefab.description,
          nodes: (substitute(prefab.graph.nodes, values) as Json[]).map((node) =>
            observed.has(node.id as string) ? { ...node, observed: true } : node,
          ),
          wires: substitute(prefab.graph.wires, values),
        };
  if (problems.length > 0) return { problems };
  return { instance: { spawns, ...(graph !== undefined && { graph }), bindings } };
}

/** The spawn fields (components) a prefab's spawns use, sorted; position, turn and tags excluded. */
export function prefabComponents(prefab: PrefabEntry): string[] {
  const plain = new Set(['at', 'yaw', 'tags', 'prop', 'interact', 'properties']);
  return [
    ...new Set(
      prefab.spawns.flatMap((spawn) =>
        Object.keys(spawn).filter((key) => key !== 'local' && !plain.has(key)),
      ),
    ),
  ].sort();
}

/** The prefab the entry `file` names, when `entries` has it. */
function prefabsOf(entries: readonly LoadedEntry[]): Map<string, PrefabEntry> {
  return new Map(
    entries.flatMap((e) =>
      e.type === 'prefab' ? [[e.value.id, e.value as PrefabEntry] as const] : [],
    ),
  );
}

const at = (...path: (string | number)[]) => path.map((p) => `/${String(p)}`).join('');

/**
 * Expands the prefab instances of every scene in `loaded`: the scene is replaced by the scene its
 * instances expand to (parsed again, so every scene rule applies to the whole), and each instance's
 * signal graph is added as a `signal-graph` entry of the same file. Problems go to `issues`.
 */
export function expandScenePrefabs(
  loaded: readonly LoadedEntry[],
  issues: ContentIssue[],
): readonly LoadedEntry[] {
  const prefabs = prefabsOf(loaded);
  const added: LoadedEntry[] = [];
  const result = loaded.map((entry): LoadedEntry => {
    if (entry.type !== 'scene') return entry;
    const scene = entry.value as { prefabs?: readonly { id: string; prefab: ContentRef }[] };
    if ((scene.prefabs ?? []).length === 0) return entry;
    const json = JSON.parse(JSON.stringify(entry.value)) as Json;
    const instances = json.prefabs as (PrefabPlacement & { prefab: string })[];
    delete json.prefabs;
    // A parsed scene always has both lists (they default to empty).
    const spawns = [...(json.spawns as Json[])];
    const signals = [...(json.signals as Json[])];
    const graphs: LoadedEntry[] = [];
    const before = issues.length;
    instances.forEach((placement, index) => {
      const pointer = at('prefabs', index);
      const prefab = prefabs.get(placement.prefab);
      const problem = (message: string) => {
        issues.push({
          file: entry.file,
          pointer,
          message: `scene:${entry.value.id} prefab instance "${placement.id}": ${message}`,
        });
      };
      if (prefab === undefined) {
        problem(`there is no prefab "${placement.prefab}"`);
        return;
      }
      const expanded = instantiate(prefab, placement);
      if ('problems' in expanded) {
        expanded.problems.forEach(problem);
        return;
      }
      spawns.push(...expanded.instance.spawns);
      if (expanded.instance.graph !== undefined) {
        const parsed = signalGraphSchema.safeParse(expanded.instance.graph);
        if (!parsed.success) {
          for (const issue of parsed.error.issues) {
            problem(`its signal graph is invalid: ${issue.message} (at ${issue.path.join('.')})`);
          }
          return;
        }
        graphs.push({ type: 'signal-graph', file: entry.file, value: parsed.data });
        signals.push({ graph: placement.id, bindings: expanded.instance.bindings });
      }
    });
    if (issues.length > before) return entry;
    json.spawns = spawns;
    json.signals = signals;
    const parsed = sceneSchema.safeParse(json);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        issues.push({
          file: entry.file,
          pointer: at(...issue.path.map(String)),
          message: `${issue.message} (in the scene with its prefabs expanded)`,
        });
      }
      return entry;
    }
    added.push(...graphs);
    return { type: 'scene', file: entry.file, value: parsed.data };
  });
  return [...result, ...added];
}

/** Every ContentRef inside `value`. */
function refsIn(value: unknown, found: string[] = []): string[] {
  if (value instanceof ContentRef) found.push(String(value));
  else if (typeof value === 'object' && value !== null) {
    for (const child of Object.values(value)) refsIn(child, found);
  }
  return found;
}

/**
 * The prefab check (mw-e15.4 AC-1): each prefab, with its defaults (or examples), expands to spawns
 * that pass the scene-spawn schema, so it uses only existing components, and to a signal graph that
 * passes the graph schema, and every content id they name exists.
 */
export const checkPrefabs: ContentCheck = (entries) => {
  const issues: ContentIssue[] = [];
  const known = new Set(entries.map((e) => `${e.type}:${e.value.id}`));
  for (const { type, file, value } of entries) {
    if (type !== 'prefab') continue;
    const prefab = value as PrefabEntry;
    const fail = (pointer: string, message: string) => {
      issues.push({ file, pointer, message: `prefab:${prefab.id} ${message}` });
    };
    // The schema makes every parameter carry a default or an example.
    const params = Object.fromEntries(
      Object.entries(prefab.parameters).map(([name, p]) => [
        name,
        (p.default ?? p.example) as number,
      ]),
    );
    const expanded = instantiate(prefab, { id: 'probe', at: [0, 0, 0], yaw: 0, params });
    if ('problems' in expanded) {
      for (const problem of expanded.problems) fail('/parameters', problem);
      continue;
    }
    expanded.instance.spawns.forEach((spawn, index) => {
      const parsed = sceneSpawnSchema.safeParse(spawn);
      if (!parsed.success) {
        for (const issue of parsed.error.issues) {
          fail(
            at('spawns', index, ...issue.path.map(String)),
            `spawn "${String(spawn.id)}": ${issue.message}`,
          );
        }
        return;
      }
      for (const ref of refsIn(parsed.data)) {
        if (!known.has(ref))
          fail(at('spawns', index), `spawn "${String(spawn.id)}" references missing ${ref}`);
      }
    });
    if (expanded.instance.graph !== undefined) {
      const parsed = signalGraphSchema.safeParse(expanded.instance.graph);
      if (!parsed.success) {
        for (const issue of parsed.error.issues) {
          fail(at('graph', ...issue.path.map(String)), `signal graph: ${issue.message}`);
        }
      }
    }
  }
  return issues;
};
