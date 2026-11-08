// The sim events presentation cue sheets may react to (mw-e28.3), with the vocabulary each one
// offers a rule: its anchors (where a cue plays: an entity to follow or a fixed position; the first
// is the default) and its facts (what a rule may match on, interpolate into a cue id or scale volume
// by). Audio cue sheets (types/cue-sheet.ts) and VFX cue sheets (e29) validate against this one
// table, so a typo in an event or fact name fails at content load, naming the rule. Content may import
// the sim only as types, so the table is written out here; src/game/cues/events.ts binds each name to
// the sim's EventType and is typed against this table, and its tests check the two agree.

import { z } from 'zod';

/**
 * How a fact can be used. `string`: matched by equality and interpolated into cue ids; `list`: a
 * set of strings, matched by membership (e.g. damage tags); `boolean`: matched by equality;
 * `number`: not matchable, only scales volume (`volumeBy`).
 */
export const CUE_FACT_KINDS = ['string', 'list', 'boolean', 'number'] as const;
export type CueFactKind = (typeof CUE_FACT_KINDS)[number];

/**
 * Directions an event reading may carry, for VFX rules to orient an effect along (`orientTo`, e29.3):
 * `hitNormal` points out of the struck surface (back towards whatever hit it), `attackerForward` is
 * the way the blow, the attacker or the projectile was travelling.
 */
export const CUE_DIRECTIONS = ['hitNormal', 'attackerForward'] as const;
export type CueDirection = (typeof CUE_DIRECTIONS)[number];

/** What one event offers cue rules. */
export interface CueEventSpec {
  /** Anchor names (at least one); the first is the default. */
  readonly anchors: readonly [string, ...string[]];
  /** Fact name → kind. A fact may be absent from a given event (then a rule needing it skips). */
  readonly facts: Readonly<Record<string, CueFactKind>>;
  /** Directions its readings may carry (none when absent). */
  readonly directions?: readonly CueDirection[];
}

const BOTH_DIRECTIONS = ['hitNormal', 'attackerForward'] as const;

/** Facts derived from the struck entity (`target`) and the hitting one (`weapon`). */
const HIT_FACTS = {
  /** Impact class of the weapon's material (its `impactSound` without `sfx-impact-`), e.g. "metal". */
  weapon: 'string',
  weaponMaterial: 'string',
  /** Impact class of the target's material, e.g. "bone". */
  target: 'string',
  targetMaterial: 'string',
} as const;

/** Facts of a changed value: `on` for a boolean, `to` for an id or enum, `value` for a number. */
const VALUE_FACTS = { key: 'string', on: 'boolean', to: 'string', value: 'number' } as const;

/**
 * Every sim event a cue sheet can name, keyed by the sim event name. The facts are documented in
 * docs/content/cue-sheet-schema.md via the `event` field's description.
 */
export const CUE_EVENTS = {
  DamageApplied: {
    anchors: ['target', 'instigator', 'source'],
    /** From the hit's travel direction (or the instigator's facing when the packet has none). */
    directions: BOTH_DIRECTIONS,
    facts: {
      ...HIT_FACTS,
      /** The damage type that dealt the most, e.g. "slash" (the attacker side of the impact matrix). */
      damageType: 'string',
      /**
       * How the hit met the target (mw-e28.4): "blocked" (a raised shield took it), "parried" (a
       * parry deflected it, mw-e04.12), "immune" (only damage types the target ignores) or "hit" (a
       * clean hit), so block, parry, glance and impact rules never compete on specificity.
       */
      contact: 'string',
      /** Shield id of a blocked hit's blocker, e.g. "wood-shield". */
      shield: 'string',
      /** Hurtbox region struck, e.g. "head". */
      region: 'string',
      /**
       * The struck creature's `audio.hurt` cue (mw-e28.8), only for a clean hit that left it alive:
       * a rule plays it with `cue: "{creatureHurt}"`.
       */
      creatureHurt: 'string',
      tags: 'list',
      immune: 'boolean',
      died: 'boolean',
      poiseBroken: 'boolean',
      total: 'number',
      poiseDamage: 'number',
    },
  },
  PoiseBroken: {
    anchors: ['target', 'instigator', 'source'],
    /** `creaturePoiseBreak` is the creature's `audio.poiseBreak` cue (mw-e28.8). */
    facts: { target: 'string', targetMaterial: 'string', creaturePoiseBreak: 'string' },
  },
  Died: {
    anchors: ['target', 'killer', 'source'],
    /** `creatureDeath` is the creature's `audio.death` cue (mw-e28.8). */
    facts: {
      target: 'string',
      targetMaterial: 'string',
      tags: 'list',
      creatureDeath: 'string',
    },
  },
  aiAlertStateChanged: {
    anchors: ['entity'],
    /**
     * A creature's alert state changed (mw-e11.7): `from` and `to` are alert states ("unaware",
     * "suspicious", "investigating", "searching", "alerted", "combat"), `cause` why; `bark` is its
     * `audio.alertBark` cue (mw-e28.8): a rule plays it with `cue: "{bark}"`.
     */
    facts: { from: 'string', to: 'string', cause: 'string', bark: 'string' },
  },
  HitParried: {
    /** `entity` is the parrier (mw-e04.12), `attacker` whose swing it deflected. */
    anchors: ['entity', 'attacker', 'source'],
    /** From the attacker's facing: the flash faces back along the deflected swing. */
    directions: BOTH_DIRECTIONS,
    facts: { shield: 'string' },
  },
  GuardBroken: {
    /** `entity` is the blocker whose guard broke. */
    anchors: ['entity', 'instigator', 'source'],
    facts: { shield: 'string' },
  },
  DodgedHit: {
    /** `target` is the dodger (the swing whiffed through its i-frames), `attacker` who swung. */
    anchors: ['target', 'attacker'],
    facts: { hitbox: 'string', region: 'string' },
  },
  ActionPhaseChanged: {
    anchors: ['entity'],
    /**
     * `phase` is startup, active or recovery; `sound` is the move's own presentation audio cue
     * (its `presentation.audioCue`): a rule plays it with `cue: "{sound}"`, e.g. the swing whoosh.
     */
    facts: { move: 'string', phase: 'string', sound: 'string' },
  },
  LocomotionEvents: {
    anchors: ['entity'],
    facts: {
      /** footstep, land, jumpStart, mantleStart or ledgeGrab. */
      kind: 'string',
      /** left or right (footsteps). */
      foot: 'string',
      /** walk, run, sprint or crouch (footsteps). */
      gait: 'string',
      /**
       * Footstep surface under the character (audio bible §7.3), from the ground collider's material
       * (its `footstepSurface`); unknown surfaces read "stone" (footsteps and landings). A footstep
       * taken wading reads the surface of the material water (water-shallow, mw-e02.14).
       */
      surface: 'string',
      /** Armour weight class of the character's armour layer, e.g. "plate", when it wears one. */
      armor: 'string',
      /** A creature's own `audio.footsteps` cue (mw-e28.8), on its footsteps: layered over the surface's. */
      creatureSteps: 'string',
      /** "light" or "heavy" (landings; heavy from the default hard-landing impact speed). */
      landing: 'string',
      /** Downward speed at touchdown, m/s (landings): scale volume by it. */
      impactSpeed: 'number',
    },
  },
  WaterEntered: {
    anchors: ['entity'],
    /** Downward speed on entering the water, m/s (mw-e02.14): scale the splash by it. */
    facts: { speed: 'number' },
  },
  TelegraphStarted: {
    anchors: ['attacker'],
    /**
     * A creature move's windup reads (mw-e04.20). `telegraph` is the attack's own telegraph cue id;
     * `telegraphSound` is the sound it plays: the move's declared telegraph audio cue, else
     * the attacker creature's `audio.telegraph` (`audio.unblockableTelegraph` for an unblockable move
     * or grab, mw-e28.8), else `sfx-telegraph-{telegraph}` (a rule plays it with `cue: "{telegraphSound}"`); `telegraphVfx`
     * is the move's declared telegraph VFX cue, absent when it declares none; `unblockable` marks an
     * unblockable move or a grab, `parryable` a move a parry deflects.
     */
    facts: {
      attack: 'string',
      move: 'string',
      telegraph: 'string',
      telegraphSound: 'string',
      telegraphVfx: 'string',
      parryable: 'boolean',
      unblockable: 'boolean',
    },
  },
  AttackHit: {
    anchors: ['target', 'attacker', 'source'],
    /** From the attacker's facing. */
    directions: BOTH_DIRECTIONS,
    facts: { ...HIT_FACTS, attack: 'string', total: 'number' },
  },
  AttackProjectileLaunched: {
    anchors: ['origin', 'attacker', 'projectile'],
    facts: { attack: 'string' },
  },
  AttackEnded: {
    anchors: ['attacker'],
    facts: { attack: 'string', reason: 'string' },
  },
  ActionRejected: {
    anchors: ['entity'],
    facts: { action: 'string', reason: 'string' },
  },
  StaminaExhausted: { anchors: ['entity'], facts: {} },
  StaminaRecovered: { anchors: ['entity'], facts: {} },
  fireIgnited: { anchors: ['entity'], facts: { material: 'string' } },
  fireExtinguished: { anchors: ['entity'], facts: { material: 'string', cause: 'string' } },
  fireBurntOut: {
    anchors: ['entity'],
    facts: { material: 'string', becomes: 'string', destroyed: 'boolean' },
  },
  stimulusResolved: {
    anchors: ['at', 'source'],
    facts: { element: 'string', shape: 'string', amount: 'number', hits: 'number' },
  },
  propertyChanged: {
    anchors: ['entity', 'source'],
    facts: { ...VALUE_FACTS, material: 'string' },
  },
  factChanged: { anchors: ['source'], facts: VALUE_FACTS },
  signalReceived: {
    anchors: ['entity'],
    /** `key` is the fact key or, for an `audio-cue` receiver, the cue id. */
    facts: { graph: 'string', node: 'string', receiver: 'string', key: 'string', value: 'boolean' },
  },
  volumeEntered: { anchors: ['entity'], facts: { graph: 'string', node: 'string' } },
  volumeExited: { anchors: ['entity'], facts: { graph: 'string', node: 'string' } },
  physicsImpact: {
    /** `entity` is the physics object, `other` what it hit (none for unbound geometry), `at` where. */
    anchors: ['entity', 'other', 'at'],
    /** Out of what it hit, back towards the object. */
    directions: ['hitNormal'],
    facts: {
      /** Impact class of the physics object's material (its `impactSound` without `sfx-impact-`). */
      entity: 'string',
      entityMaterial: 'string',
      /** Impact class of what it hit: another object, a wall or floor (the default material if unbound). */
      other: 'string',
      otherMaterial: 'string',
      /** Kinetic energy of the closing motion, J: scale volume by it. */
      energy: 'number',
      impulse: 'number',
      /** Closing speed, m/s. */
      speed: 'number',
    },
  },
  ArrowFired: {
    /** `arrow` is the loosed arrow (following it; its launch point as the fallback). */
    anchors: ['arrow', 'shooter', 'origin'],
    /** `attackerForward` is the launch direction. */
    directions: ['attackerForward'],
    facts: {
      /** Arrow content id, e.g. "standard". */
      arrow: 'string',
      /** The arrow's own flight trail VFX cue (its `cues.trailVfx`): VFX sheets play `{trail}`. */
      trail: 'string',
      /** The arrow's own flight sound (its `cues.flightSfx`), when it has one. */
      flight: 'string',
      /** Launch speed, m/s: scale volume by it. */
      speed: 'number',
    },
  },
  arrowImpact: {
    /** `entity` is the arrow, `other` what it hit (none for unbound geometry), `at` the contact. */
    anchors: ['entity', 'other', 'at'],
    /** The surface normal at the contact. */
    directions: ['hitNormal'],
    facts: {
      arrow: 'string',
      /** What the impact did to the arrow: stick, ricochet, drop or shatter. */
      outcome: 'string',
      /**
       * Impact class of the surface it hit (its material's `impactSound` without `sfx-impact-`), e.g.
       * "stone"; named `other` as in physicsImpact, so templates expand over the impact classes.
       */
      other: 'string',
      /** Material id of the surface it hit. */
      otherMaterial: 'string',
      /** Surface hardness of what it hit: soft, medium or hard. */
      hardness: 'string',
      /** It struck a creature's hurtbox (the hit's DamageApplied plays the flesh). */
      creature: 'boolean',
      /** Hurtbox region struck, e.g. "head" (creature hits). */
      region: 'string',
      /** The arrow's own impact sound (its `cues.impactSfx`, e.g. a water splash): play `{sound}`. */
      sound: 'string',
      /** The arrow's own impact VFX cue (its `cues.impactVfx`), for VFX sheets. */
      vfx: 'string',
      /** Kinetic energy at impact, J: scale volume by it. */
      energy: 'number',
      /** Speed at impact, m/s. */
      speed: 'number',
      /** Momentum the arrow lost, N·s. */
      impulse: 'number',
    },
  },
  breakableBroken: {
    /** `entity` is what broke (gone after the tick; its centre is the fallback), `at` its centre. */
    anchors: ['entity', 'at', 'source'],
    facts: {
      /** Impact class of its material (its `impactSound` without `sfx-impact-`), e.g. "stone". */
      entity: 'string',
      /** Material id of what broke. */
      material: 'string',
      /** Breakable profile id, e.g. "old-wall". */
      profile: 'string',
      /** Why it broke: "impact" (one blow over its fragile threshold) or "structure" (hp worn out). */
      cause: 'string',
      /** Kind of hit that broke it: blunt, slash, pierce, force or collision. */
      by: 'string',
      /** Break loudness 1 m away, dB: scale volume by it. */
      loudness: 'number',
    },
  },
  doorStateChanged: {
    /** `entity` is the door (its closed leaf's centre as the fallback), `source` who moved it. */
    anchors: ['entity', 'at', 'source'],
    facts: {
      /** Impact class of the door's material, e.g. "wood" or "metal". */
      entity: 'string',
      entityMaterial: 'string',
      /** hinged, sliding, portcullis or trapdoor. */
      kind: 'string',
      /** The state it left and the one it entered: closed, opening, open, closing, blocked, broken. */
      from: 'string',
      to: 'string',
    },
  },
  doorBlocked: {
    /** `entity` is the door, `by` what it met, `at` the centre of what it met. */
    anchors: ['at', 'entity', 'by'],
    facts: {
      entity: 'string',
      entityMaterial: 'string',
      kind: 'string',
      /** It was closing with a crush and dealt it. */
      crushed: 'boolean',
    },
  },
  lockUnlocked: {
    /** `entity` is the door the lock is on, `source` who opened it. */
    anchors: ['entity', 'source'],
    facts: {
      /** The lock id. */
      lock: 'string',
      /** key, pick or magic. */
      by: 'string',
      /** The key item that opened it (by key). */
      key: 'string',
    },
  },
  lockRefused: {
    anchors: ['entity', 'source'],
    /** `reason`: no-key, sealed, unpickable, pick-failed or locked. */
    facts: { lock: 'string', reason: 'string' },
  },
  switchUsed: {
    /** `entity` is the switch, `source` who used it. */
    anchors: ['entity', 'source'],
    facts: {
      /** Impact class of the switch's material, e.g. "metal". */
      entity: 'string',
      entityMaterial: 'string',
      /** lever, button, crank or wheel. */
      kind: 'string',
      /** Its position now (0 is off; a button is back at 0). */
      position: 'number',
    },
  },
  mechanismJammed: {
    /** `entity` is the door or switch that would not move. */
    anchors: ['entity', 'source'],
    facts: { entity: 'string', entityMaterial: 'string', frozen: 'boolean' },
  },
} as const satisfies Record<string, CueEventSpec>;

/** A sim event name a cue sheet may use. */
export type CueEventName = keyof typeof CUE_EVENTS;

/** Every cue event name, in table order. */
export const CUE_EVENT_NAMES = Object.keys(CUE_EVENTS) as [CueEventName, ...CueEventName[]];

/** The spec of a cue event. */
export function cueEventSpec(name: CueEventName): CueEventSpec {
  return CUE_EVENTS[name];
}

/** Directions an event's readings may carry. */
export function cueDirections(name: CueEventName): readonly CueDirection[] {
  return cueEventSpec(name).directions ?? [];
}

/** Rule-level fields every cue sheet shares (audio and VFX). */
export const cueRuleBaseFields = {
  event: z
    .enum(CUE_EVENT_NAMES, {
      error: (issue) =>
        `unknown sim event "${String(issue.input)}"; cue sheets can use: ${CUE_EVENT_NAMES.join(', ')}`,
    })
    .describe(
      'The sim event that triggers the rule (see src/content/cue-events.ts for its facts).',
    ),
  match: z
    .record(z.string(), z.union([z.string(), z.boolean()]))
    .default({})
    .describe(
      'Facts the event must have: a string fact equals the value, a list fact contains it, a boolean fact equals it. The most specific matching rule (most keys) wins.',
    ),
  layer: z
    .string()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'must be lowercase kebab-case')
    .default('main')
    .describe(
      'Rules compete per layer: one event plays at most one rule per layer (e.g. "impact" and "accent").',
    ),
};

/** The rule fields `checkCueRule` validates. */
export interface CueRuleShape {
  readonly event: CueEventName;
  readonly match: Readonly<Record<string, string | boolean>>;
}

/**
 * Adds an issue for every match key the event doesn't offer or whose value doesn't fit the fact's
 * kind. Use in a rule schema's superRefine; paths are relative to the rule.
 */
export function checkCueRule(rule: CueRuleShape, ctx: z.RefinementCtx): void {
  const facts = cueEventSpec(rule.event).facts;
  for (const [key, value] of Object.entries(rule.match)) {
    const kind = facts[key];
    if (kind === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['match', key],
        message: `${rule.event} has no fact "${key}"; it has: ${Object.keys(facts).join(', ') || 'none'}`,
      });
    } else if (kind === 'number') {
      ctx.addIssue({
        code: 'custom',
        path: ['match', key],
        message: `"${key}" is a number fact: scale by it with volumeBy, don't match it`,
      });
    } else if ((kind === 'boolean') !== (typeof value === 'boolean')) {
      ctx.addIssue({
        code: 'custom',
        path: ['match', key],
        message: `"${key}" is a ${kind} fact, so its match value must be a ${kind === 'boolean' ? 'boolean' : 'string'}`,
      });
    }
  }
}

/** `{fact}` placeholders in a cue template (exported for the game layer's interpolation). */
export const CUE_PLACEHOLDER = /\{([a-zA-Z]+)\}/g;

/** Names of the `{fact}` placeholders in a cue template, in order. */
export function cuePlaceholders(template: string): string[] {
  return [...template.matchAll(CUE_PLACEHOLDER)].map((m) => String(m[1]));
}
