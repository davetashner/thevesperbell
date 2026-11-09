// Comparing two world states (mw-e27.6): the facts and the per-level deltas of a save, a snapshot
// or the running world. Pure data in, pure data and text out, so the console and the tests share
// it. Output is grouped as facts first, then one block per level whose deltas differ.

import { samePlain, type EntityDelta, type FactSnapshot, type LevelDeltas } from '@sim/index';

/** What `state.diff` compares: set facts and every level's deltas. */
export interface StateView {
  readonly facts: FactSnapshot;
  readonly levels: readonly LevelDeltas[];
}

export type FactValueOrNone = boolean | number | string | undefined;

export interface FactDiff {
  readonly key: string;
  /** Undefined: the fact is not set in A. */
  readonly a: FactValueOrNone;
  /** Undefined: the fact is not set in B. */
  readonly b: FactValueOrNone;
}

export type Presence = 'added' | 'removed' | 'changed';

/** One entity or spawned record that differs, with what differs as text. */
export interface ItemChange {
  readonly id: string;
  readonly change: Presence;
  readonly text: string;
}

export interface LevelDiff {
  readonly level: string;
  readonly entities: readonly ItemChange[];
  readonly spawned: readonly ItemChange[];
}

export interface StateDiff {
  readonly facts: readonly FactDiff[];
  readonly levels: readonly LevelDiff[];
}

/** Code-unit order, like the stores keep their keys. */
const byText = (a: string, b: string): number => Number(a > b) - Number(a < b);

function diffFacts(a: FactSnapshot, b: FactSnapshot): FactDiff[] {
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort(byText);
  const changes: FactDiff[] = [];
  for (const key of keys) {
    if (a[key] !== b[key]) changes.push({ key, a: a[key], b: b[key] });
  }
  return changes;
}

/** How `a` and `b` (keyed by `id`) differ, in id order, described by `lone` and `both`. */
function diffById<T extends { readonly id: string }>(
  a: readonly T[],
  b: readonly T[],
  lone: (item: T) => string,
  both: (before: T, after: T) => string,
): ItemChange[] {
  const left = new Map(a.map((item) => [item.id, item]));
  const right = new Map(b.map((item) => [item.id, item]));
  const out: ItemChange[] = [];
  for (const [id, before] of left) {
    const after = right.get(id);
    if (after === undefined) out.push({ id, change: 'removed', text: lone(before) });
    else if (!samePlain(before, after))
      out.push({ id, change: 'changed', text: both(before, after) });
  }
  for (const [id, after] of right) {
    if (!left.has(id)) out.push({ id, change: 'added', text: lone(after) });
  }
  out.sort((x, y) => byText(x.id, y.id));
  return out;
}

function diffLevel(
  level: string,
  a: LevelDeltas | undefined,
  b: LevelDeltas | undefined,
): LevelDiff {
  const entities = diffById(a?.entities ?? [], b?.entities ?? [], describeDelta, changedAspects);
  const spawned = diffById(
    a?.spawned ?? [],
    b?.spawned ?? [],
    ({ kind }) => `spawned ${kind}`,
    ({ kind }) => `spawned ${kind}, its data differs`,
  );
  return { level, entities, spawned };
}

/** Everything that differs between `a` and `b`; a level one side never visited counts as empty. */
export function diffStates(a: StateView, b: StateView): StateDiff {
  const left = new Map(a.levels.map((deltas) => [deltas.level, deltas]));
  const right = new Map(b.levels.map((deltas) => [deltas.level, deltas]));
  const levels: LevelDiff[] = [];
  for (const level of [...new Set([...left.keys(), ...right.keys()])].sort(byText)) {
    const diff = diffLevel(level, left.get(level), right.get(level));
    if (diff.entities.length > 0 || diff.spawned.length > 0) levels.push(diff);
  }
  return { facts: diffFacts(a.facts, b.facts), levels };
}

const show = (value: FactValueOrNone): string =>
  value === undefined ? '(unset)' : JSON.stringify(value);

const aspectText = (value: unknown): string =>
  value === undefined ? '(none)' : JSON.stringify(value);

/** A delta in one line: "destroyed", or its aspects (`container, door`). */
export function describeDelta(delta: EntityDelta): string {
  if (delta.destroyed === true) return 'destroyed';
  return (
    Object.keys(delta.aspects ?? {})
      .sort(byText)
      .join(', ') || 'no changes'
  );
}

/** The aspects whose recorded delta differs between two versions of an entity's delta. */
function changedAspects(a: EntityDelta, b: EntityDelta): string {
  if ((a.destroyed === true) !== (b.destroyed === true)) {
    return `${describeDelta(a)} -> ${describeDelta(b)}`;
  }
  const left = a.aspects ?? {};
  const right = b.aspects ?? {};
  const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort(byText);
  return keys
    .filter((key) => !samePlain(left[key], right[key]))
    .map((key) => `${key} ${aspectText(left[key])} -> ${aspectText(right[key])}`)
    .join('; ');
}

const MARK: Record<Presence, string> = { added: '+', removed: '-', changed: '~' };

/** The diff as console lines: `facts` then one block per level, or "no differences". */
export function formatDiff(diff: StateDiff, labels: { a: string; b: string }): string[] {
  if (diff.facts.length === 0 && diff.levels.length === 0) {
    return [`${labels.a} and ${labels.b} hold the same facts and level deltas`];
  }
  const lines = [`- only in ${labels.a}, + only in ${labels.b}, ~ differs`];
  if (diff.facts.length > 0) {
    lines.push(`facts (${String(diff.facts.length)}):`);
    for (const { key, a, b } of diff.facts) {
      lines.push(`  ${key}: ${show(a)} -> ${show(b)}`);
    }
  }
  for (const { level, entities, spawned } of diff.levels) {
    lines.push(`level ${level}:`);
    for (const { id, change, text } of [...entities, ...spawned]) {
      lines.push(`  ${MARK[change]} ${id}: ${text}`);
    }
  }
  return lines;
}
