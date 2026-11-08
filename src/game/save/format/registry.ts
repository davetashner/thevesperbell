// The save section registry (mw-e30.1): the one place that turns a whole world into save bytes and
// back. The core `world` section stores the sim's WorldSnapshot (entities, clock, RNG streams and
// every component no other section claims); each system registers its own section for the state it
// owns, with its own version and migrations. Loading is all-or-nothing: every section is decoded,
// migrated and validated before the world is touched, and if applying one throws, the world is
// rolled back to exactly its prior state. Sections from a newer build that this build does not know
// are kept verbatim so re-saving never destroys them.

import {
  DIFFICULTY_KEYS,
  type ComponentType,
  type FactSnapshot,
  type World,
  type WorldSnapshot,
} from '@sim/index';
import { z } from 'zod';
import { decodeSave, encodeSave, type BuildInfo, type SaveEnvelope } from './envelope';
import { SaveApplyError, SaveCorruptError, type SaveLoadError } from './errors';
import {
  defineSaveSection,
  migrateSection,
  validateSection,
  type SaveSection,
  type SectionLoadContext,
  type SectionRecord,
} from './section';

/** Id of the built-in section holding the world snapshot. */
export const WORLD_SECTION_ID = 'world';

/**
 * Data version of the world section (the WorldSnapshot shape). v2 (mw-e27.1) adds the optional
 * `facts` record; a v1 save has no facts, so its migration is the identity. v3 (mw-e30.7) adds the
 * optional `physics` state of a world that owns physics (ADR-0001), so the game's worlds can be
 * saved; a v2 save could not hold a physics world, so its migration is the identity too. v4
 * (mw-e27.4): when a section owns facts (`ownsFacts`), the world section no longer holds them. The
 * shape is unchanged, so the migration is the identity: an older save's facts stay here and the
 * owning section reads them (`SectionLoadContext.worldFacts`); the bump keeps older builds from
 * loading a save whose facts they would not find. v5 (mw-e12.14): the same for creatures, whose
 * runtime state (creature, condition, brain and perception components) the `creatures` section now
 * holds; an older save's creatures stay here (identity migration) and that section's `missing` hook
 * upgrades them.
 */
export const WORLD_SECTION_VERSION = 5;

const worldSnapshotSchema = z.strictObject({
  seed: z.number(),
  clock: z.strictObject({ tick: z.number(), hz: z.number() }),
  difficulty: z.partialRecord(z.enum(DIFFICULTY_KEYS), z.number()).exactOptional(),
  nextEntity: z.number(),
  entities: z.array(z.number()),
  facts: z.record(z.string(), z.union([z.boolean(), z.number(), z.string()])).exactOptional(),
  components: z.record(z.string(), z.array(z.tuple([z.number(), z.unknown()]))),
  rng: z.record(z.string(), z.strictObject({ seed: z.number(), state: z.array(z.number()) })),
  // Engine-specific and opaque here; the physics port validates it on restore.
  physics: z.strictObject({ engine: z.string(), data: z.unknown() }).exactOptional(),
}) satisfies z.ZodType<WorldSnapshot>;

/** A non-fatal load finding, for logs and the load UI. */
export interface SaveWarning {
  /**
   * `unknown-section`: the save has a section this build does not register (kept for re-saving).
   * `missing-section`: a registered section is absent from the save (its state was left empty).
   * `recovered`: a section dropped a damaged part of its data and loaded the rest (mw-e27.4).
   */
  readonly kind: 'unknown-section' | 'missing-section' | 'recovered';
  readonly section: string;
  readonly message: string;
}

/** Outcome of loading a save into a world. */
export type LoadSaveResult =
  | {
      readonly ok: true;
      readonly envelope: SaveEnvelope;
      readonly warnings: readonly SaveWarning[];
      /** Sections this build does not know; pass back as `preserve` when saving again. */
      readonly unknownSections: Readonly<Record<string, SectionRecord>>;
    }
  | { readonly ok: false; readonly error: SaveLoadError };

/** Outcome of checking save bytes without loading them. */
export type CheckSaveResult =
  | { readonly ok: true; readonly envelope: SaveEnvelope }
  | { readonly ok: false; readonly error: SaveLoadError };

type PreparedSection =
  | { readonly section: SaveSection; readonly data: unknown; readonly missing?: never }
  | { readonly section: SaveSection; readonly missing: true };

type Prepared =
  | {
      readonly ok: true;
      readonly envelope: SaveEnvelope;
      readonly warnings: SaveWarning[];
      readonly unknownSections: Record<string, SectionRecord>;
      /** `missing`: the save has no record of the section and the section's `missing` hook runs. */
      readonly prepared: readonly PreparedSection[];
      readonly worldFacts: FactSnapshot | undefined;
    }
  | { readonly ok: false; readonly error: SaveLoadError };

export interface WriteSaveOptions {
  readonly build: BuildInfo;
  /** Wall-clock milliseconds since the Unix epoch; injected so saving stays pure. */
  readonly wallClockSavedAt: number;
  /** Plain, canonically encodable data for slot lists. Defaults to `{}`. */
  readonly metadata?: Readonly<Record<string, unknown>>;
  /** Unknown sections from the load this save continues (`LoadSaveResult.unknownSections`). */
  readonly preserve?: Readonly<Record<string, SectionRecord>>;
}

/** A world serialized by `SaveRegistry.capture`, waiting to be encoded into save bytes. */
export interface CapturedSave {
  /** The save bytes: the captured sections under this envelope. Never reads the world. */
  encode(options: Omit<WriteSaveOptions, 'preserve'>): Uint8Array;
}

/** How a registry treats worlds. */
export interface SaveRegistryOptions {
  /**
   * Component types a world registers only on first use (a class applied mid-game registers the
   * player's class and stats then). A save holding rows of one registers it before the world is
   * restored, so the save loads into a freshly built world that has not used it yet (mw-e01.7).
   */
  readonly onDemand?: readonly ComponentType<unknown>[];
  /**
   * Runs on the world just before a save is written, so state that must not be saved as it is (a
   * carried object, mw-e17.14) is settled first and the save and the running game agree. Must be
   * deterministic and leave the world valid.
   */
  readonly beforeWrite?: (world: World) => void;
}

/** Sections that make up a save, in apply order (the world section first). */
export class SaveRegistry {
  private readonly ordered: SaveSection[];
  private readonly ids = new Set<string>();
  /** Component name → id of the section that saves it. */
  private readonly owners = new Map<string, string>();
  /** Id of the section that saves the world's facts, if any. */
  private factsOwner: string | undefined;

  private readonly beforeWrite: ((world: World) => void) | undefined;

  constructor(options: SaveRegistryOptions = {}) {
    const onDemand = options.onDemand ?? [];
    this.beforeWrite = options.beforeWrite;
    this.ordered = [
      defineSaveSection<WorldSnapshot>({
        id: WORLD_SECTION_ID,
        version: WORLD_SECTION_VERSION,
        schema: worldSnapshotSchema,
        migrations: { 1: (data) => data, 2: (data) => data, 3: (data) => data, 4: (data) => data },
        serialize: (world) => {
          const { facts, ...snapshot } = world.snapshot();
          const components = Object.fromEntries(
            Object.entries(snapshot.components).filter(([name]) => !this.owners.has(name)),
          );
          const kept = this.factsOwner === undefined && facts !== undefined ? { facts } : {};
          return { ...snapshot, ...kept, components };
        },
        deserialize: (world, { facts, ...data }) => {
          for (const type of onDemand) {
            if (type.name in data.components && !world.isRegistered(type)) world.register(type);
          }
          world.restore(
            this.factsOwner === undefined && facts !== undefined ? { ...data, facts } : data,
          );
        },
      }),
    ];
    this.ids.add(WORLD_SECTION_ID);
  }

  /**
   * Adds a section; it is saved and applied after every section registered before it.
   * @throws RangeError for a malformed definition (see defineSaveSection); Error for a duplicate id
   *   or a component another section already claims.
   */
  register<TData>(section: SaveSection<TData>): this {
    const checked = defineSaveSection(section);
    if (this.ids.has(checked.id))
      throw new Error(`save section "${checked.id}" is already registered`);
    for (const { name } of checked.components ?? []) {
      const owner = this.owners.get(name);
      if (owner !== undefined) {
        throw new Error(`component "${name}" is already saved by section "${owner}"`);
      }
    }
    if (checked.ownsFacts === true && this.factsOwner !== undefined) {
      throw new Error(`world facts are already saved by section "${this.factsOwner}"`);
    }
    for (const { name } of checked.components ?? []) this.owners.set(name, checked.id);
    if (checked.ownsFacts === true) this.factsOwner = checked.id;
    this.ids.add(checked.id);
    this.ordered.push(checked);
    return this;
  }

  /** Every section, world first, in apply order (e.g. for schema fingerprints). */
  get sections(): readonly SaveSection[] {
    return [...this.ordered];
  }

  /**
   * Serializes the whole world into save bytes. Every section's output is validated against its own
   * schema first, so a save that this build wrote is always one it can load.
   * @throws SaveSectionInvalidError when a section serializes data its schema rejects;
   *   CanonicalEncodingError for values with no canonical form (functions, Maps, undefined…).
   */
  write(world: World, options: WriteSaveOptions): Uint8Array {
    return this.capture(world, options.preserve).encode(options);
  }

  /**
   * The first half of `write`: settles the world (`beforeWrite`) and serializes every section, now,
   * so the save holds the world as it is at this call. Everything that waits (a thumbnail, a slot
   * lookup) happens afterwards, in `encode`, without touching the world again: a save written
   * later must not change the running sim at a wall-clock moment (mw-e01.21).
   * @throws as `write`.
   */
  capture(world: World, preserve: Readonly<Record<string, SectionRecord>> = {}): CapturedSave {
    this.beforeWrite?.(world);
    const sections: Record<string, SectionRecord> = {};
    for (const [id, record] of Object.entries(preserve)) {
      if (!this.ids.has(id)) sections[id] = record;
    }
    for (const section of this.ordered) {
      const data = section.serialize(world);
      const valid = validateSection(section, data);
      if (!valid.ok) throw valid.error;
      sections[section.id] = { version: section.version, data };
    }
    const createdAtTick = world.tick;
    return {
      encode: ({ build, wallClockSavedAt, metadata }) =>
        encodeSave({
          gameVersion: build.gameVersion,
          buildSha: build.buildSha,
          contentHash: build.contentHash,
          createdAtTick,
          wallClockSavedAt,
          metadata: metadata ?? {},
          sections,
        }),
    };
  }

  /**
   * Decodes, migrates and validates save bytes without touching any world: everything a load does
   * except applying. Corruption recovery (mw-e30.8) uses it to find a save worth offering. A save
   * that passes can still fail to apply (SaveApplyError) when loaded.
   */
  check(bytes: Uint8Array): CheckSaveResult {
    const prepared = this.prepare(bytes);
    return prepared.ok ? { ok: true, envelope: prepared.envelope } : prepared;
  }

  /**
   * Loads save bytes into `world` (which must have the save's component types registered). On any
   * failure the world is left exactly as it was and a typed error is returned.
   */
  read(world: World, bytes: Uint8Array): LoadSaveResult {
    const result = this.prepare(bytes);
    if (!result.ok) return result;
    const { envelope, warnings, unknownSections, prepared } = result;
    const before = world.snapshot();
    let applying = WORLD_SECTION_ID;
    const context = (section: string): SectionLoadContext => ({
      warn: (message) => {
        warnings.push({ kind: 'recovered', section, message });
      },
      worldFacts: result.worldFacts,
    });
    try {
      for (const entry of prepared) {
        applying = entry.section.id;
        if (entry.missing === true) entry.section.missing?.(world, context(applying));
        else entry.section.deserialize(world, entry.data, context(applying));
      }
    } catch (cause) {
      world.restore(before);
      return { ok: false, error: new SaveApplyError(applying, cause) };
    }
    return { ok: true, envelope, warnings, unknownSections };
  }

  private prepare(bytes: Uint8Array): Prepared {
    const decoded = decodeSave(bytes);
    if (!decoded.ok) return decoded;
    const { envelope } = decoded;
    const warnings: SaveWarning[] = [];
    const unknownSections: Record<string, SectionRecord> = {};
    for (const [id, record] of Object.entries(envelope.sections)) {
      if (this.ids.has(id)) continue;
      unknownSections[id] = record;
      warnings.push({
        kind: 'unknown-section',
        section: id,
        message: `save section "${id}" (v${String(record.version)}) is not known to this build; it will be kept on re-save`,
      });
    }

    const prepared: PreparedSection[] = [];
    for (const section of this.ordered) {
      const record = envelope.sections[section.id];
      if (record === undefined) {
        if (section.id === WORLD_SECTION_ID) {
          return { ok: false, error: new SaveCorruptError('the world section is missing') };
        }
        if (section.missing !== undefined) {
          prepared.push({ section, missing: true });
          continue;
        }
        warnings.push({
          kind: 'missing-section',
          section: section.id,
          message: `save has no "${section.id}" section; its state starts empty`,
        });
        continue;
      }
      const migrated = migrateSection(section, record);
      if (!migrated.ok) return migrated;
      const valid = validateSection(section, migrated.data);
      if (!valid.ok) return valid;
      prepared.push({ section, data: valid.data });
    }
    const worldFacts = (prepared[0] as { data: WorldSnapshot }).data.facts;
    return { ok: true, envelope, warnings, unknownSections, prepared, worldFacts };
  }
}
