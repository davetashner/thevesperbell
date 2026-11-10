// The content loader (mw-e00.18). Content is data, not code (constitution §10): each content type is
// a zod schema in a registry, and each entry is one JSON file at `<root>/<type>/<anything>.json`.
// Loading is a pure function of (registry, files): it parses and validates every file, checks ids are
// unique per type and that every `ref()` points at an entry that exists, and reports every problem
// found in one run (file + JSON pointer + message) instead of stopping at the first. The result is a
// deeply frozen, id-indexed catalogue whose iteration order (by id) never depends on file order.
// Reading the files is someone else's job: Vite's import.meta.glob in the app (game-content.ts), the
// file system in Node tools (fs-sources.ts), plain objects in tests.

import type { z } from 'zod';
import { canonicalJson, fnv1a64 } from './hash.ts';
import { expandScenePrefabs } from './prefabs.ts';
import { ContentRef } from './schema.ts';

/** A registry: content type name → schema of one entry. Every schema's output has a string `id`. */
export type ContentSchemas = Readonly<Record<string, z.ZodType<{ readonly id: string }>>>;

/** Recursively readonly view of loaded content (the catalogue is deeply frozen at runtime). */
export type Frozen<T> = T extends ContentRef
  ? T
  : T extends readonly unknown[]
    ? { readonly [K in keyof T]: Frozen<T[K]> } // keeps tuples tuples
    : T extends object
      ? { readonly [K in keyof T]: Frozen<T[K]> }
      : T;

/** Type of a loaded entry of content type `K`. */
export type EntryOf<R extends ContentSchemas, K extends keyof R> = Frozen<z.output<R[K]>>;

/** One content file: `path` ends in `<type>/<file>.json`; `text` is its raw JSON. */
export interface ContentSource {
  readonly path: string;
  readonly text: string;
}

/** One problem found while loading. `pointer` is an RFC 6901 JSON pointer into the file. */
export interface ContentIssue {
  readonly file: string;
  readonly pointer: string;
  readonly message: string;
}

/** Thrown by `loadContent` with every problem it found. */
export class ContentLoadError extends Error {
  override readonly name = 'ContentLoadError';
  readonly issues: readonly ContentIssue[];

  constructor(issues: readonly ContentIssue[]) {
    super(
      [
        `Content failed to load (${String(issues.length)} problem(s)):`,
        ...issues.map((i) => `  ${i.file}#${i.pointer}: ${i.message}`),
      ].join('\n'),
    );
    this.issues = issues;
  }
}

/** The loaded, validated, deeply frozen content. */
export interface Catalogue<R extends ContentSchemas> {
  /** Fingerprint of all content (see hash.ts); equal content gives an equal hash. */
  readonly hash: string;
  /** Every entry of `type`, sorted by id. */
  all<K extends keyof R & string>(type: K): readonly EntryOf<R, K>[];
  /** Whether `type` has an entry `id`. */
  has(type: keyof R & string, id: string): boolean;
  /** The entry `id` of `type`; throws a RangeError if there is none. */
  get<K extends keyof R & string>(type: K, id: string): EntryOf<R, K>;
  /** The entry a `ref()` points at (always present: the loader checked it). */
  resolve<K extends keyof R & string>(target: ContentRef<K>): EntryOf<R, K>;
}

/** A parsed entry, as whole-content checks see it. */
export interface LoadedEntry {
  readonly type: string;
  /** The file it came from. */
  readonly file: string;
  readonly value: { readonly id: string };
}

/**
 * A check across entries that no single schema can make (e.g. every fact a signal graph names is
 * declared in the fact registry, src/content/fact-checks.ts). It sees every entry in path order and
 * returns its problems.
 */
export type ContentCheck = (entries: readonly LoadedEntry[]) => readonly ContentIssue[];

/** Escapes one JSON pointer segment (RFC 6901). */
const segment = (key: PropertyKey): string =>
  String(key).replaceAll('~', '~0').replaceAll('/', '~1');

/** JSON pointer for a zod issue path, e.g. `['moves', 0, 'name']` → `/moves/0/name`. */
export const jsonPointer = (path: readonly PropertyKey[]): string =>
  path.map((key) => `/${segment(key)}`).join('');

/** Dotted path for a zod issue path, e.g. `['moves', 0, 'name']` → `moves[0].name`. */
export const dottedPath = (path: readonly PropertyKey[]): string =>
  path
    .map((key, i) =>
      typeof key === 'number' ? `[${String(key)}]` : `${i > 0 ? '.' : ''}${String(key)}`,
    )
    .join('');

/** Calls `visit` for every ContentRef inside `value`, with its JSON pointer. */
function findRefs(value: unknown, pointer: string, visit: (r: ContentRef, at: string) => void) {
  if (value instanceof ContentRef) {
    visit(value as ContentRef, pointer);
  } else if (typeof value === 'object' && value !== null) {
    for (const [key, child] of Object.entries(value)) {
      findRefs(child, `${pointer}/${segment(key)}`, visit);
    }
  }
}

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

/** `$schema` only points editors at the generated JSON Schema; it isn't part of the entry. */
export function withoutSchemaKey(json: unknown): unknown {
  if (typeof json !== 'object' || json === null || Array.isArray(json)) return json;
  return Object.fromEntries(Object.entries(json).filter(([key]) => key !== '$schema'));
}

/** Parses and validates one file; problems go to `issues`. */
function loadFile(schemas: ContentSchemas, source: ContentSource, issues: ContentIssue[]) {
  const file = source.path;
  const type = source.path.split('/').at(-2) ?? '';
  const schema = Object.hasOwn(schemas, type) ? schemas[type] : undefined;
  if (schema === undefined) {
    const known = Object.keys(schemas).join(', ');
    issues.push({
      file,
      pointer: '',
      message: `unknown content type "${type}" (folder name); known types: ${known}`,
    });
    return undefined;
  }
  let json: unknown;
  try {
    json = JSON.parse(source.text);
  } catch (error) {
    issues.push({ file, pointer: '', message: `invalid JSON: ${(error as Error).message}` });
    return undefined;
  }
  const result = schema.safeParse(withoutSchemaKey(json));
  if (!result.success) {
    for (const issue of result.error.issues) {
      const at = issue.path.length > 0 ? ` (at ${dottedPath(issue.path)})` : '';
      issues.push({ file, pointer: jsonPointer(issue.path), message: `${issue.message}${at}` });
    }
    return undefined;
  }
  return { type, file, value: result.data };
}

/**
 * Loads and validates content. Throws a `ContentLoadError` listing every problem: schema errors,
 * unknown type folders, invalid JSON, ids used twice within a type, references to missing entries
 * and, once all of those pass (so a broken file never shows up as a missing target), the problems
 * `checks` find.
 */
export function loadContent<R extends ContentSchemas>(
  schemas: R,
  sources: readonly ContentSource[],
  checks: readonly ContentCheck[] = [],
): Catalogue<R> {
  const issues: ContentIssue[] = [];
  const sorted = [...sources].sort((a, b) => (a.path < b.path ? -1 : 1));
  const parsed = sorted.flatMap((source) => loadFile(schemas, source, issues) ?? []);
  // Puzzle prefab instances become plain spawns and signal graphs before anything else looks at
  // the scenes (mw-e15.4); a registry without prefabs passes through untouched.
  const loaded = parsed.some((e) => e.type === 'prefab')
    ? expandScenePrefabs(parsed, issues)
    : parsed;

  // The first file (in path order) to define each `type:id`; later ones are duplicates.
  const firstFile = new Map<string, string>();
  for (const entry of loaded) {
    const key = `${entry.type}:${entry.value.id}`;
    const first = firstFile.get(key);
    if (first === undefined) {
      firstFile.set(key, entry.file);
    } else {
      issues.push({
        file: entry.file,
        pointer: '/id',
        message: `duplicate id ${key}: already defined in ${first}`,
      });
    }
  }

  for (const entry of loaded) {
    findRefs(entry.value, '', (target, pointer) => {
      if (!firstFile.has(String(target))) {
        issues.push({
          file: entry.file,
          pointer,
          message: `${entry.type}:${entry.value.id} references missing ${String(target)}`,
        });
      }
    });
  }

  if (issues.length === 0) issues.push(...checks.flatMap((check) => check(loaded)));
  if (issues.length > 0) throw new ContentLoadError(issues);
  return buildCatalogue(schemas, loaded);
}

function buildCatalogue<R extends ContentSchemas>(schemas: R, loaded: readonly LoadedEntry[]) {
  const index = new Map<string, unknown>();
  const lists = new Map<string, readonly unknown[]>();
  const hashed: string[] = [];
  for (const type of Object.keys(schemas).sort()) {
    const entries = loaded
      .filter((e) => e.type === type)
      .map((e) => deepFreeze(e.value))
      .sort((a, b) => (a.id < b.id ? -1 : 1));
    for (const entry of entries) index.set(`${type}:${entry.id}`, entry);
    lists.set(type, Object.freeze(entries));
    hashed.push(`${JSON.stringify(type)}:${canonicalJson(entries)}`);
  }

  const get = (type: string, id: string): never => {
    const entry = index.get(`${type}:${id}`);
    if (entry === undefined) throw new RangeError(`no ${type} entry "${id}"`);
    return entry as never;
  };
  const catalogue: Catalogue<R> = {
    hash: fnv1a64(`{${hashed.join(',')}}`),
    // `?? []` only matters to untyped callers asking for a type that isn't registered.
    all: (type) => (lists.get(type) ?? []) as never,
    has: (type, id) => index.has(`${type}:${id}`),
    get,
    resolve: (target) => get(target.type, target.id),
  };
  return Object.freeze(catalogue);
}
