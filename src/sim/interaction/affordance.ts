// Interaction affordances (mw-e02.5): what an actor can do to a world object with the one Interact
// verb. An object declares its affordances as data on an `Interactable` component (a lever: pull; a
// locked door: unlock with a key, or pick lock for a thief), and world properties add the generic
// ones (anything `liftable` can be picked up, a `container` searched, a `hideable` hidden in, a
// `pushable` pushed), so a new crate or barrel is interactable without a line of code. An
// affordance may be gated: every requirement must hold (a capability the actor has, from its class or
// skills, or an item it carries). A gated affordance the actor can't use is still offered, greyed
// with its reason ("Locked — needs Iron Key"), to hint at another route.
//
// Nothing here knows what an affordance does. The interaction system emits `interacted` and the
// owning system (doors, containers, carrying, hiding) acts on it, through properties and the stimulus
// API like every other rule, never by pairing object types.

import type { WorldPropertyKey } from '../properties/spec';

/** Every interaction verb, in the order prompts list them. */
export const AFFORDANCE_VERBS = [
  'use',
  'open',
  'close',
  'pull',
  'press',
  'pick-up',
  'read',
  'search',
  'hide',
  'climb',
  'talk',
  'push',
  'release',
  'rotate',
  'unlock',
  'pick-lock',
  'light',
  'extinguish',
] as const;

export type AffordanceVerb = (typeof AFFORDANCE_VERBS)[number];

/** The prompt text of each verb, unless an affordance names its own. */
export const AFFORDANCE_LABELS: Readonly<Record<AffordanceVerb, string>> = Object.freeze({
  use: 'Use',
  open: 'Open',
  close: 'Close',
  pull: 'Pull',
  press: 'Press',
  'pick-up': 'Pick up',
  read: 'Read',
  search: 'Search',
  hide: 'Hide',
  climb: 'Climb',
  talk: 'Talk',
  push: 'Push',
  release: 'Release',
  rotate: 'Rotate',
  unlock: 'Unlock',
  'pick-lock': 'Pick lock',
  light: 'Light',
  extinguish: 'Extinguish',
});

/** A condition on the actor: a capability it has (class, skill) or an item it carries (ids). */
export type AffordanceRequirement = { readonly capability: string } | { readonly item: string };

/** One affordance as data declares it; see `normalizeAffordance` for the defaults. */
export interface AffordanceSpec {
  readonly verb: AffordanceVerb;
  /** Prompt text; defaults to the verb's label. */
  readonly label?: string | undefined;
  /** Seconds Interact must be held to complete it (≥ 0); 0 or omitted fires on press. */
  readonly hold?: number | undefined;
  /** Every one must hold for the actor to use it; omitted or empty = always available. */
  readonly requires?: readonly AffordanceRequirement[] | undefined;
  /** Shown while unavailable; defaults to what the first unmet requirement needs. */
  readonly reason?: string | undefined;
}

/** An affordance with every default filled in (plain data, snapshot-safe). */
export interface Affordance {
  readonly verb: AffordanceVerb;
  readonly label: string;
  readonly hold: number;
  readonly requires: readonly AffordanceRequirement[];
  /** Empty: derive it from the unmet requirement. */
  readonly reason: string;
}

/** Longest hold an affordance may ask for, seconds. */
export const MAX_HOLD_SECONDS = 10;

/**
 * A validated, frozen copy of `spec` with the defaults filled in. Throws a RangeError for an unknown
 * verb, a hold outside 0…MAX_HOLD_SECONDS, or a requirement that is not exactly one non-empty
 * capability or item id.
 */
export function normalizeAffordance(spec: AffordanceSpec): Affordance {
  const { verb } = spec;
  if (!(AFFORDANCE_VERBS as readonly string[]).includes(verb)) {
    throw new RangeError(`unknown affordance verb "${verb}"`);
  }
  const hold = spec.hold ?? 0;
  if (!Number.isFinite(hold) || hold < 0 || hold > MAX_HOLD_SECONDS) {
    throw new RangeError(`hold must be 0…${String(MAX_HOLD_SECONDS)} s, got ${String(hold)}`);
  }
  const requires = (spec.requires ?? []).map((requirement) => {
    const keys = Object.keys(requirement);
    const id = Object.values(requirement)[0] as unknown;
    const kind = keys[0];
    if (keys.length !== 1 || (kind !== 'capability' && kind !== 'item')) {
      throw new RangeError('a requirement is exactly one of { capability } or { item }');
    }
    if (typeof id !== 'string' || id === '') {
      throw new RangeError(`a ${kind} requirement needs a non-empty id`);
    }
    return Object.freeze(kind === 'capability' ? { capability: id } : { item: id });
  });
  return Object.freeze({
    verb,
    label: spec.label ?? AFFORDANCE_LABELS[verb],
    hold,
    requires: Object.freeze(requires),
    reason: spec.reason ?? '',
  });
}

/**
 * Affordances every object gets from its world properties (a flag property set to true), in this
 * order after the ones it declares. A declared affordance with the same verb replaces the derived
 * one, so data can gate or relabel it.
 */
export const PROPERTY_AFFORDANCES: readonly (readonly [WorldPropertyKey, Affordance])[] =
  Object.freeze(
    (
      [
        ['liftable', 'pick-up'],
        ['container', 'search'],
        ['hideable', 'hide'],
        ['pushable', 'push'],
      ] as const
    ).map(([key, verb]) => Object.freeze([key, normalizeAffordance({ verb })] as const)),
  );

/** An interactable as data declares it (scene spawns, later props and creatures). */
export interface InteractableSpec {
  readonly affordances: readonly AffordanceSpec[];
  /** Reach, metres (> 0); defaults to the focus settings' range (2.5 m). */
  readonly range?: number | undefined;
  /** Focus point relative to the entity's origin, metres; defaults to 1 m up. */
  readonly anchor?: readonly [number, number, number] | undefined;
  /** Bounding radius around the focus point, metres (≥ 0); defaults to 0. */
  readonly radius?: number | undefined;
}

/** What an actor brings to an interaction: its capabilities and the items it carries (ids). */
export interface InteractorKit {
  readonly capabilities: readonly string[];
  readonly items: readonly string[];
}

/** Whether `kit` meets `requirement`. */
export function meets(kit: InteractorKit, requirement: AffordanceRequirement): boolean {
  return 'capability' in requirement
    ? kit.capabilities.includes(requirement.capability)
    : kit.items.includes(requirement.item);
}

/** "iron-key" → "Iron key": an id readable enough for a default reason. */
function readable(id: string): string {
  const words = id.replaceAll('-', ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * Why `kit` can't use `affordance`, or undefined when it can. The affordance's own reason when it
 * has one, else "Needs <first unmet requirement>".
 */
export function unavailableReason(kit: InteractorKit, affordance: Affordance): string | undefined {
  const unmet = affordance.requires.find((requirement) => !meets(kit, requirement));
  if (unmet === undefined) return undefined;
  if (affordance.reason !== '') return affordance.reason;
  return `Needs ${readable('capability' in unmet ? unmet.capability : unmet.item)}`;
}
