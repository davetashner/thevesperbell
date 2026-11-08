// Sim event bindings for cue sheets (mw-e28.3): each cue event name in src/content/cue-events.ts
// bound to the sim's EventType and a reader that turns a payload into the anchors and facts the table
// promises. The map is typed against the content table, so adding an event there without binding it
// here fails typecheck; events.test.ts checks every reader only produces declared facts of the
// declared kind. Readers only read: payloads and, through `CueLookups`, an entity's material.

import type { CreatureAudio, CueDirection, CueEventName } from '@content/index';
import {
  ActionPhaseChanged,
  AlertStateChanged,
  ActionRejected,
  AttackEnded,
  AttackHit,
  AttackProjectileLaunched,
  ArrowFired,
  arrowImpact,
  breakableBroken,
  DAMAGE_TAGS,
  DamageApplied,
  DEFAULT_GAIT_TUNING,
  Died,
  DodgedHit,
  doorBlocked,
  doorStateChanged,
  factChanged,
  fireBurntOut,
  fireExtinguished,
  fireIgnited,
  GuardBroken,
  HitParried,
  LocomotionEvents,
  lockRefused,
  lockUnlocked,
  mechanismJammed,
  physicsImpact,
  PoiseBroken,
  propertyChanged,
  signalReceived,
  StaminaExhausted,
  StaminaRecovered,
  stimulusResolved,
  switchUsed,
  TelegraphStarted,
  volumeEntered,
  volumeExited,
  WaterEntered,
  type DamageAmounts,
  type DamageResult,
  type EntityId,
  type EventType,
  type LocomotionEvent,
  type StimulusShape,
  type TelegraphInfo,
  type Vec3,
} from '@sim/index';
import type { CueFacts, CueFactValue } from './matcher.ts';

/** Where a cue plays: an entity to follow, a fixed position, or both (position is the fallback). */
export interface CueAnchor {
  readonly entity?: EntityId;
  readonly position?: Vec3;
}

/** Directions of one event occurrence; an unknown one is undefined or missing. */
export type CueDirections = Readonly<Partial<Record<CueDirection, Vec3 | undefined>>>;

/** What a binding reads from one event occurrence. */
export interface CueReading {
  readonly anchors: Readonly<Record<string, CueAnchor | undefined>>;
  readonly facts: CueFacts;
  /** Unit directions VFX rules may orient to (only those the event's spec declares). */
  readonly directions?: CueDirections;
}

/** World lookups a reader may use (read-only). */
export interface CueLookups {
  /** Material id of an entity, if it has one. */
  readonly materialOf: (entity: EntityId) => string | undefined;
  /** Impact class of a material (its impactSound without `sfx-impact-`), e.g. iron → "metal". */
  readonly impactClassOf: (material: string) => string | undefined;
  /** Shield id an entity holds (a blocker), e.g. "wood-shield". */
  readonly shieldOf?: (entity: EntityId) => string | undefined;
  /** A move's own presentation audio cue (`presentation.audioCue`), e.g. its swing whoosh. */
  readonly moveSoundOf?: (move: string) => string | undefined;
  /** Footstep surface under a character (audio bible §7.3), already resolved to one with a set. */
  readonly surfaceUnder?: (entity: EntityId) => string | undefined;
  /** Footstep surface of a material a character stands in (water → water-shallow), with a set. */
  readonly surfaceOfMaterial?: (material: string) => string | undefined;
  /** Armour weight class of a character's armour layer, e.g. "plate". */
  readonly armorOf?: (entity: EntityId) => string | undefined;
  /** An arrow's own presentation cues (its content `cues`: trail, flight and impact). */
  readonly arrowCuesOf?: (arrow: string) => ArrowCues | undefined;
  /** A creature's audio slots (content `audio`, mw-e28.8); absent for anything that is no creature. */
  readonly creatureAudioOf?: (entity: EntityId) => CreatureAudio | undefined;
  /** The horizontal way an entity faces (its combat facing), for directions a payload lacks. */
  readonly facingOf?: (entity: EntityId) => Vec3 | undefined;
}

/** An arrow's own cue ids (the arrow content's `cues`). */
export interface ArrowCues {
  readonly trailVfx: string;
  readonly impactVfx?: string | undefined;
  readonly flightSfx?: string | undefined;
  readonly impactSfx?: string | undefined;
}

/** A cue event bound to the sim. */
export interface CueEventBinding {
  readonly type: EventType<unknown>;
  read(payload: unknown, lookups: CueLookups): CueReading;
}

/** Type-erases a binding; `read` only ever receives payloads of `type` (the bridge pairs them). */
function bind<T>(
  type: EventType<T>,
  read: (payload: T, lookups: CueLookups) => CueReading,
): CueEventBinding {
  return { type: type as EventType<unknown>, read };
}

const at = (entity: EntityId | null): CueAnchor | undefined =>
  entity === null ? undefined : { entity };

/** `<prefix>` (impact class) and `<prefix>Material` facts of a known material id. */
function classFacts(
  prefix: string,
  material: string,
  { impactClassOf }: CueLookups,
): Record<string, string> {
  return { [prefix]: impactClassOf(material) ?? material, [`${prefix}Material`]: material };
}

/** `<prefix>` (impact class) and `<prefix>Material` facts of an entity. */
function materialFacts(
  prefix: string,
  entity: EntityId | null,
  lookups: CueLookups,
): Record<string, string | undefined> {
  const material = entity === null ? undefined : lookups.materialOf(entity);
  return material === undefined ? {} : classFacts(prefix, material, lookups);
}

/** The damage type that dealt the most (canonical order breaks ties). */
function dominantType(amounts: DamageAmounts): string | undefined {
  let best: string | undefined;
  let most = 0;
  for (const [type, amount] of Object.entries(amounts)) {
    if (amount > most) {
      best = type;
      most = amount;
    }
  }
  return best;
}

/** `on` / `to` / `value` facts of a changed value, by its type. */
function valueFacts(value: unknown): Record<string, CueFactValue> {
  if (typeof value === 'boolean') return { on: value };
  if (typeof value === 'string') return { to: value };
  if (typeof value === 'number') return { value };
  return {};
}

/** A representative point of a stimulus shape (a contact shape anchors to its target). */
function shapeAnchor(shape: StimulusShape): CueAnchor {
  switch (shape.kind) {
    case 'point':
      return { position: shape.at };
    case 'sphere':
    case 'box':
      return { position: shape.center };
    case 'cone':
      return { position: shape.apex };
    case 'capsule':
      return { position: shape.from };
    case 'contact':
      return { entity: shape.target };
  }
}

/** How a hit met its target: a raised shield, a parry, only ignored damage types, or cleanly. */
function contactOf(e: DamageResult): string {
  if (e.tags.includes(DAMAGE_TAGS.blocked)) return 'blocked';
  if (e.tags.includes(DAMAGE_TAGS.parried)) return 'parried';
  return e.immune ? 'immune' : 'hit';
}

/** The surface under a footstep or landing: the material it was taken in (wading), else the ground's. */
function stepSurface(e: LocomotionEvent, look: CueLookups): string | undefined {
  const material = e.kind === 'footstep' ? e.material : undefined;
  return (
    (material === undefined ? undefined : look.surfaceOfMaterial?.(material)) ??
    look.surfaceUnder?.(e.entity)
  );
}

/** Landings at or above the default hard-landing speed are heavy. */
const landingWeight = (impactSpeed: number): string =>
  impactSpeed >= DEFAULT_GAIT_TUNING.hardLanding ? 'heavy' : 'light';

/** `v` scaled to unit length, or undefined for a zero vector. */
function unit(v: Vec3 | undefined): Vec3 | undefined {
  if (v === undefined) return undefined;
  const length = Math.hypot(v.x, v.y, v.z);
  return length === 0 ? undefined : { x: v.x / length, y: v.y / length, z: v.z / length };
}

const negate = (v: Vec3 | undefined): Vec3 | undefined =>
  v === undefined ? undefined : { x: 0 - v.x, y: 0 - v.y, z: 0 - v.z }; // 0 - 0 is +0, not -0

/** A blow travelling along `forward`: the hit normal points back against it. */
function blowDirections(forward: Vec3 | undefined): CueDirections {
  const along = unit(forward);
  return along === undefined ? {} : { attackerForward: along, hitNormal: negate(along) };
}

/** An entity's facing through the lookups, if both exist. */
const facing = (look: CueLookups, entity: EntityId | null): Vec3 | undefined =>
  entity === null ? undefined : look.facingOf?.(entity);

/**
 * The sound a creature telegraph plays (mw-e04.20): its move's declared telegraph audio cue, else
 * the attack's telegraph cue as `sfx-telegraph-<cue>`.
 */
export const telegraphSound = (e: TelegraphInfo, audio?: CreatureAudio): string =>
  e.audioCue ??
  (e.unblockable ? audio?.unblockableTelegraph : audio?.telegraph) ??
  `sfx-telegraph-${e.cue}`;

const entityOnly = (payload: { entity: EntityId }): CueReading => ({
  anchors: { entity: { entity: payload.entity } },
  facts: {},
});

/** Every cue event, bound. Keys equal the sim event names (checked by events.test.ts). */
export const CUE_EVENT_BINDINGS: Readonly<Record<CueEventName, CueEventBinding>> = {
  DamageApplied: bind(DamageApplied, (e, look) => {
    const hitter = e.packet.source ?? e.packet.instigator;
    return {
      anchors: {
        target: { entity: e.target },
        instigator: at(e.packet.instigator),
        source: at(e.packet.source),
      },
      facts: {
        ...materialFacts('target', e.target, look),
        ...materialFacts('weapon', hitter, look),
        damageType: dominantType(e.amounts),
        contact: contactOf(e),
        shield: e.tags.includes(DAMAGE_TAGS.blocked) ? look.shieldOf?.(e.target) : undefined,
        region: e.packet.region,
        creatureHurt: e.died || e.immune ? undefined : look.creatureAudioOf?.(e.target)?.hurt,
        tags: e.tags,
        immune: e.immune,
        died: e.died,
        poiseBroken: e.poiseBroken,
        total: e.total,
        poiseDamage: e.poiseDamage,
      },
      directions: blowDirections(e.packet.direction ?? facing(look, e.packet.instigator)),
    };
  }),
  PoiseBroken: bind(PoiseBroken, (e, look) => ({
    anchors: { target: { entity: e.target }, instigator: at(e.instigator), source: at(e.source) },
    facts: {
      ...materialFacts('target', e.target, look),
      creaturePoiseBreak: look.creatureAudioOf?.(e.target)?.poiseBreak,
    },
  })),
  Died: bind(Died, (e, look) => ({
    anchors: { target: { entity: e.target }, killer: at(e.killer), source: at(e.source) },
    facts: {
      ...materialFacts('target', e.target, look),
      tags: e.tags,
      creatureDeath: look.creatureAudioOf?.(e.target)?.death,
    },
  })),
  aiAlertStateChanged: bind(AlertStateChanged, (e, look) => ({
    anchors: { entity: { entity: e.entity } },
    facts: {
      from: e.from,
      to: e.to,
      cause: e.cause,
      bark: look.creatureAudioOf?.(e.entity)?.alertBark,
    },
  })),
  HitParried: bind(HitParried, (e, look) => ({
    anchors: { entity: { entity: e.entity }, attacker: at(e.attacker), source: at(e.source) },
    facts: { shield: look.shieldOf?.(e.entity) },
    directions: blowDirections(facing(look, e.attacker)),
  })),
  GuardBroken: bind(GuardBroken, (e, look) => ({
    anchors: { entity: { entity: e.entity }, instigator: at(e.instigator), source: at(e.source) },
    facts: { shield: look.shieldOf?.(e.entity) },
  })),
  DodgedHit: bind(DodgedHit, (e) => ({
    anchors: { target: { entity: e.target }, attacker: { entity: e.attacker } },
    facts: { hitbox: e.hitbox, region: e.region },
  })),
  ActionPhaseChanged: bind(ActionPhaseChanged, (e, look) => ({
    anchors: { entity: { entity: e.entity } },
    facts: { move: e.move, phase: e.phase, sound: look.moveSoundOf?.(e.move) },
  })),
  LocomotionEvents: bind(LocomotionEvents, (e, look) => {
    const grounded = e.kind === 'footstep' || e.kind === 'land';
    return {
      anchors: { entity: { entity: e.entity } },
      facts: {
        kind: e.kind,
        ...(e.kind === 'footstep' && { foot: e.foot, gait: e.gait }),
        ...(e.kind === 'land' && {
          impactSpeed: e.impactSpeed,
          landing: landingWeight(e.impactSpeed),
        }),
        surface: grounded ? stepSurface(e, look) : undefined,
        creatureSteps:
          e.kind === 'footstep' ? look.creatureAudioOf?.(e.entity)?.footsteps : undefined,
        armor: look.armorOf?.(e.entity),
      },
    };
  }),
  WaterEntered: bind(WaterEntered, (e) => ({
    anchors: { entity: { entity: e.entity } },
    facts: { speed: e.speed },
  })),
  TelegraphStarted: bind(TelegraphStarted, (e, look) => ({
    anchors: { attacker: { entity: e.attacker } },
    facts: {
      attack: e.attack,
      move: e.move,
      telegraph: e.cue,
      telegraphSound: telegraphSound(e, look.creatureAudioOf?.(e.attacker)),
      telegraphVfx: e.vfxCue ?? undefined,
      parryable: e.parryable,
      unblockable: e.unblockable,
    },
  })),
  AttackHit: bind(AttackHit, (e, look) => ({
    anchors: {
      target: { entity: e.target },
      attacker: { entity: e.attacker },
      source: { entity: e.source },
    },
    facts: {
      ...materialFacts('target', e.target, look),
      ...materialFacts('weapon', e.source, look),
      attack: e.attack,
      total: e.results.reduce((sum, r) => sum + r.total, 0),
    },
    directions: blowDirections(facing(look, e.attacker)),
  })),
  AttackProjectileLaunched: bind(AttackProjectileLaunched, (e) => ({
    anchors: {
      origin: { position: e.origin },
      attacker: { entity: e.attacker },
      projectile: { entity: e.projectile, position: e.origin },
    },
    facts: { attack: e.attack },
  })),
  AttackEnded: bind(AttackEnded, (e) => ({
    anchors: { attacker: { entity: e.attacker } },
    facts: { attack: e.attack, reason: e.reason },
  })),
  ActionRejected: bind(ActionRejected, (e) => ({
    anchors: { entity: { entity: e.entity } },
    facts: { action: e.action, reason: e.reason },
  })),
  StaminaExhausted: bind(StaminaExhausted, entityOnly),
  StaminaRecovered: bind(StaminaRecovered, entityOnly),
  fireIgnited: bind(fireIgnited, (e, look) => ({
    anchors: { entity: { entity: e.entity } },
    facts: { material: look.materialOf(e.entity) },
  })),
  fireExtinguished: bind(fireExtinguished, (e, look) => ({
    anchors: { entity: { entity: e.entity } },
    facts: { material: look.materialOf(e.entity), cause: e.cause },
  })),
  fireBurntOut: bind(fireBurntOut, (e, look) => ({
    anchors: { entity: { entity: e.entity } },
    facts: {
      material: look.materialOf(e.entity),
      becomes: e.becomes ?? undefined,
      destroyed: e.becomes === null,
    },
  })),
  stimulusResolved: bind(stimulusResolved, (e) => ({
    anchors: { at: shapeAnchor(e.stimulus.shape), source: at(e.stimulus.source) },
    facts: {
      element: e.stimulus.element,
      shape: e.stimulus.shape.kind,
      amount: e.amount,
      hits: e.hits.length,
    },
  })),
  propertyChanged: bind(propertyChanged, (e, look) => ({
    anchors: { entity: { entity: e.entity }, source: at(e.source) },
    facts: { key: e.key, ...valueFacts(e.new), material: look.materialOf(e.entity) },
  })),
  factChanged: bind(factChanged, (e) => ({
    anchors: { source: at(e.source) },
    facts: { key: e.key, ...valueFacts(e.new) },
  })),
  signalReceived: bind(signalReceived, (e) => ({
    anchors: { entity: at(e.entity) },
    facts: {
      graph: e.graphId,
      node: e.node,
      receiver: e.receiver,
      key: e.key ?? undefined,
      value: e.value,
    },
  })),
  volumeEntered: bind(volumeEntered, (e) => ({
    anchors: { entity: { entity: e.entity } },
    facts: { graph: e.graphId, node: e.node },
  })),
  volumeExited: bind(volumeExited, (e) => ({
    anchors: { entity: { entity: e.entity } },
    facts: { graph: e.graphId, node: e.node },
  })),
  // The payload names both materials (unbound geometry reads the default), so no lookup is needed.
  physicsImpact: bind(physicsImpact, (e, look) => ({
    anchors: {
      entity: { entity: e.entity, position: e.position },
      other: at(e.other),
      at: { position: e.position },
    },
    facts: {
      ...classFacts('entity', e.materials[0], look),
      ...classFacts('other', e.materials[1], look),
      energy: e.energy,
      impulse: e.impulse,
      speed: e.speed,
    },
    // The payload's normal points from the object towards what it hit; the surface faces back.
    directions: { hitNormal: negate(unit(e.normal)) },
  })),
  ArrowFired: bind(ArrowFired, (e, look) => {
    const cues = look.arrowCuesOf?.(e.arrow);
    return {
      anchors: {
        arrow: { entity: e.entity, position: e.origin },
        shooter: at(e.shooter),
        origin: { position: e.origin },
      },
      facts: {
        arrow: e.arrow,
        trail: cues?.trailVfx,
        flight: cues?.flightSfx,
        speed: Math.hypot(e.velocity.x, e.velocity.y, e.velocity.z),
      },
      directions: { attackerForward: unit(e.velocity) },
    };
  }),
  // Like physicsImpact, the payload names the struck material (unbound geometry reads the default).
  arrowImpact: bind(arrowImpact, (e, look) => {
    const cues = look.arrowCuesOf?.(e.arrow);
    return {
      anchors: {
        entity: { entity: e.entity, position: e.position },
        other: at(e.other),
        at: { position: e.position },
      },
      facts: {
        arrow: e.arrow,
        outcome: e.outcome,
        ...classFacts('other', e.material, look),
        hardness: e.hardness,
        creature: e.hurtbox !== undefined,
        region: e.region,
        sound: cues?.impactSfx,
        vfx: cues?.impactVfx,
        energy: e.energy,
        speed: e.speed,
        impulse: e.impulse,
      },
      directions: { hitNormal: unit(e.normal) },
    };
  }),
  breakableBroken: bind(breakableBroken, (e, look) => ({
    anchors: {
      entity: { entity: e.entity, position: e.position },
      at: { position: e.position },
      source: at(e.source),
    },
    facts: {
      entity: look.impactClassOf(e.material) ?? e.material,
      material: e.material,
      profile: e.profile,
      cause: e.cause,
      by: e.by,
      loudness: e.loudness,
    },
  })),
  doorStateChanged: bind(doorStateChanged, (e, look) => ({
    anchors: {
      entity: { entity: e.entity, position: e.position },
      at: { position: e.position },
      source: at(e.source),
    },
    facts: { ...materialFacts('entity', e.entity, look), kind: e.kind, from: e.from, to: e.to },
  })),
  doorBlocked: bind(doorBlocked, (e, look) => ({
    anchors: { at: { position: e.position }, entity: { entity: e.entity }, by: { entity: e.by } },
    facts: { ...materialFacts('entity', e.entity, look), kind: e.kind, crushed: e.crushed },
  })),
  lockUnlocked: bind(lockUnlocked, (e) => ({
    anchors: { entity: { entity: e.entity }, source: at(e.source) },
    facts: { lock: e.lock, by: e.by, key: e.key ?? undefined },
  })),
  lockRefused: bind(lockRefused, (e) => ({
    anchors: { entity: { entity: e.entity }, source: at(e.source) },
    facts: { lock: e.lock, reason: e.reason },
  })),
  switchUsed: bind(switchUsed, (e, look) => ({
    anchors: { entity: { entity: e.entity }, source: at(e.source) },
    facts: { ...materialFacts('entity', e.entity, look), kind: e.kind, position: e.position },
  })),
  mechanismJammed: bind(mechanismJammed, (e, look) => ({
    anchors: { entity: { entity: e.entity }, source: at(e.source) },
    facts: { ...materialFacts('entity', e.entity, look), frozen: e.frozen },
  })),
};
