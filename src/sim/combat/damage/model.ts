// The damage model's resolution pipeline (mw-e04.1). One hit resolves through fixed stages, in order:
//
//   attacker  – difficulty `damageDealt` when the player hits someone, then attacker modifiers
//               (thief backstab ×N, spell amplifiers, counter-hits)
//   region    – the struck hurtbox's multiplier (packet.regionMultiplier), the head / weak point
//               tags and double poise on a weak point, armour (an arrow whose penetration is below
//               the armour value is deflected for 0; a blunt one deals half), a head hit on an
//               unaware humanoid staggering it (mw-e05.6); then region modifiers
//   defender  – the target's resistance multipliers, then defender modifiers
//   guard     – block and parry rules (e04.6, e04.12); nothing built in
//   armor     – the target's flat armor absorption per type, then armor modifiers
//   then difficulty `damageTaken` when the player is hit, and finally health clamps at 0 (at
//   UNDYING_FLOOR for an undying combatant, which therefore never dies).
//
// Within a stage the built-in step runs first, then registered modifiers by registration id, so the
// order is a pure function of setup and never of hit order or iteration luck. Other rules extend the
// pipeline by registering modifiers on a DamageModel instead of editing this file. After every step
// the working hit is re-validated: amounts are clamped at 0 and rounded to hundredths, so one sloppy
// modifier can neither heal a target nor leak float noise into health.
//
// A DamageModel is code, not state: create it at world setup and register the same modifiers in the
// same order on every run (as with systems), and replays reproduce every hit.

import type { EntityId } from '../../core/component';
import type { World } from '../../core/world';
import { BrainComponent } from '../../ai/components';
import type { DifficultyConfig } from '../../difficulty';
import { RegionStateComponent } from '../hits/components';
import {
  HealthComponent,
  PlayerCombatantComponent,
  PoiseComponent,
  poiseAfterHit,
  ResistancesComponent,
  UNDYING_FLOOR,
  UndyingComponent,
  type Resistances,
} from './components';
import {
  DamageApplied,
  Deflected,
  Died,
  HitMarker,
  PoiseBroken,
  type DamageResult,
  type HitMarkerVariant,
} from './events';
import {
  createDamagePacket,
  DAMAGE_TAGS,
  normalizeTags,
  totalDamage,
  type DamagePacket,
  type DamagePacketInput,
} from './packet';
import {
  DAMAGE_TYPES,
  fromUnits,
  isDamageType,
  nonNegativeProblem,
  roundPoints,
  scaleUnits,
  toUnits,
  type DamageAmounts,
  type DamageType,
} from './types';

/** Pipeline stages in resolution order. */
export const DAMAGE_STAGES = ['attacker', 'region', 'defender', 'guard', 'armor'] as const;

/** A pipeline stage. */
export type DamageStage = (typeof DAMAGE_STAGES)[number];

/** The hit as it moves through the pipeline; modifiers return a changed copy. */
export interface DamageHit {
  /** Points per damage type (0 allowed). */
  readonly amounts: DamageAmounts;
  readonly poiseDamage: number;
  readonly staminaDamage: number;
  readonly tags: readonly string[];
}

/** What a modifier can read about the hit it is changing. */
export interface DamageContext {
  readonly world: World<never>;
  readonly target: EntityId;
  /** The packet as built by its source (unchanged by earlier steps). */
  readonly packet: DamagePacket;
  readonly stage: DamageStage;
  readonly tick: number;
  readonly difficulty: DifficultyConfig;
}

/** A rule that changes hits at one stage (see the file header). */
export interface DamageModifier {
  /** Shown in errors and `DamageModel.modifiers()`. */
  readonly name: string;
  readonly stage: DamageStage;
  /** The changed hit, or undefined to leave it as it is (e.g. when the modifier does not apply). */
  apply(hit: DamageHit, ctx: DamageContext): DamageHit | undefined;
}

/** A registered modifier's place in the pipeline. */
export interface ModifierEntry {
  readonly id: number;
  readonly name: string;
  readonly stage: DamageStage;
}

type Step = (hit: DamageHit, ctx: DamageContext, resistances: Resistances | undefined) => DamageHit;

/** Maps every amount through `f` (on whole hundredths), keeping the rest of the hit. */
function mapUnits(hit: DamageHit, f: (units: number, type: DamageType) => number): DamageHit {
  const amounts: Partial<Record<DamageType, number>> = {};
  for (const type of DAMAGE_TYPES) {
    const points = hit.amounts[type];
    if (points !== undefined) amounts[type] = fromUnits(Math.max(0, f(toUnits(points), type)));
  }
  return { ...hit, amounts };
}

/**
 * `amounts` with every type (or only `types`) multiplied by `factor` (≥ 0), rounded to hundredths.
 * A helper for modifiers, e.g. a backstab's `scaleDamage(hit.amounts, 3)`.
 */
export function scaleDamage(
  amounts: DamageAmounts,
  factor: number,
  types: readonly DamageType[] = DAMAGE_TYPES,
): DamageAmounts {
  const problem = nonNegativeProblem('damage factor', factor);
  if (problem !== undefined) throw new RangeError(problem);
  return mapUnits({ amounts, poiseDamage: 0, staminaDamage: 0, tags: [] }, (units, type) =>
    types.includes(type) ? scaleUnits(units, factor) : units,
  ).amounts;
}

/**
 * `amounts` less a flat `points` (≥ 0) taken from the total, spread over the types in proportion to
 * their share (largest remainder, ties to the earlier type), never below 0. A helper for modifiers,
 * e.g. a ward that absorbs 10 points of any damage.
 */
export function reduceDamage(amounts: DamageAmounts, points: number): DamageAmounts {
  const problem = nonNegativeProblem('damage reduction', points);
  if (problem !== undefined) throw new RangeError(problem);
  const parts: {
    type: DamageType;
    order: number;
    units: number;
    cut: number;
    remainder: number;
  }[] = [];
  for (const type of DAMAGE_TYPES) {
    const value = amounts[type];
    if (value !== undefined) {
      parts.push({ type, order: parts.length, units: toUnits(value), cut: 0, remainder: 0 });
    }
  }
  const total = parts.reduce((sum, part) => sum + part.units, 0);
  const cut = Math.min(total, toUnits(points));
  if (cut === 0) return amounts;
  let left = cut;
  for (const part of parts) {
    part.cut = Math.floor((part.units * cut) / total);
    part.remainder = (part.units * cut) % total;
    left -= part.cut;
  }
  parts.sort((a, b) => b.remainder - a.remainder || a.order - b.order);
  for (const part of parts.slice(0, left)) part.cut += 1;
  const out: Partial<Record<DamageType, number>> = {};
  for (const type of DAMAGE_TYPES) {
    const part = parts.find((p) => p.type === type);
    if (part !== undefined) out[type] = fromUnits(part.units - part.cut);
  }
  return out;
}

const isPlayer = (world: World<never>, entity: EntityId | null): boolean =>
  entity !== null && world.has(entity, PlayerCombatantComponent);

/** Poise damage a weak point deals relative to the hit's own (mw-e05.6). */
const WEAKPOINT_POISE_FACTOR = 2;
/** Share of its damage a blunt arrow deals to an armoured region (mw-e05.6). */
const BLUNT_ARMOR_FACTOR = 0.5;

/** Whether `target` is an unaware humanoid: the brain's alert state is read, never changed (mw-e11.7). */
function isUnawareHumanoid(world: World<never>, target: EntityId): boolean {
  if (!world.isRegistered(RegionStateComponent) || !world.isRegistered(BrainComponent))
    return false;
  return (
    world.get(target, RegionStateComponent)?.humanoid === true &&
    world.get(target, BrainComponent)?.state === 'unaware'
  );
}

/** The region stage's built-in step (see the file header). */
const regionStep: Step = (hit, { world, packet, target }) => {
  let out = mapUnits(hit, (units) => scaleUnits(units, packet.regionMultiplier));
  const tags = new Set(out.tags);
  const { region, armor = 0, penetration } = packet;
  if (region === 'head') tags.add(DAMAGE_TAGS.headshot);
  if (region === 'weakpoint') {
    tags.add(DAMAGE_TAGS.weakpoint);
    out = { ...out, poiseDamage: roundPoints(out.poiseDamage * WEAKPOINT_POISE_FACTOR) };
  }
  let deflected = false;
  if (armor > 0) {
    if (tags.has(DAMAGE_TAGS.blunt)) {
      out = mapUnits(out, (units) => scaleUnits(units, BLUNT_ARMOR_FACTOR));
    } else if (penetration !== undefined && penetration < armor) {
      deflected = true;
      tags.add(DAMAGE_TAGS.deflected);
      out = { ...mapUnits(out, () => 0), poiseDamage: 0, staminaDamage: 0 };
    }
  }
  if (region === 'head' && !deflected && isUnawareHumanoid(world, target)) {
    tags.add(DAMAGE_TAGS.staggering);
  }
  return { ...out, tags: normalizeTags([...tags]) };
};

/** Built-in steps, run first within their stage. */
const BUILT_IN: Readonly<Partial<Record<DamageStage, Step>>> = {
  attacker: (hit, { world, packet, target, difficulty }) => {
    const { instigator } = packet;
    if (instigator === target || !isPlayer(world, instigator)) return hit;
    return mapUnits(hit, (units) => scaleUnits(units, difficulty.damageDealt));
  },
  region: regionStep,
  defender: (hit, _ctx, resistances) =>
    mapUnits(hit, (units, type) => scaleUnits(units, resistances?.multipliers[type] ?? 1)),
  armor: (hit, _ctx, resistances) =>
    mapUnits(hit, (units, type) => units - toUnits(resistances?.armor[type] ?? 0)),
};

function checked(what: string, value: number): number {
  const problem = nonNegativeProblem(what, Math.max(0, value));
  if (problem !== undefined) throw new RangeError(problem);
  return roundPoints(Math.max(0, value));
}

/** A modifier's output, validated: clamped at 0, rounded to hundredths, tags normalized. */
function normalizeHit(name: string, hit: DamageHit): DamageHit {
  const amounts: Partial<Record<DamageType, number>> = {};
  for (const key of Object.keys(hit.amounts)) {
    if (!isDamageType(key)) {
      throw new RangeError(`damage modifier "${name}": unknown damage type "${key}"`);
    }
  }
  for (const type of DAMAGE_TYPES) {
    const value = hit.amounts[type];
    if (value !== undefined) amounts[type] = checked(`damage modifier "${name}": ${type}`, value);
  }
  return {
    amounts: Object.freeze(amounts),
    poiseDamage: checked(`damage modifier "${name}": poiseDamage`, hit.poiseDamage),
    staminaDamage: checked(`damage modifier "${name}": staminaDamage`, hit.staminaDamage),
    tags: normalizeTags(hit.tags),
  };
}

/** Whether every type the packet deals is one the target is immune to. */
function isImmune(packet: DamagePacket, resistances: Resistances | undefined): boolean {
  const dealt = DAMAGE_TYPES.filter((type) => packet.amounts[type] !== undefined);
  return dealt.length > 0 && dealt.every((type) => resistances?.multipliers[type] === 0);
}

/**
 * How a landed hit reads on the hit marker: deflected (armour, a parry or a block), headshot, weak
 * point, else normal. The HUD and the HitMarker event share this one rule (mw-e05.6).
 */
export function hitMarkerVariant(tags: readonly string[], region?: string): HitMarkerVariant {
  if (
    tags.includes(DAMAGE_TAGS.deflected) ||
    tags.includes(DAMAGE_TAGS.parried) ||
    tags.includes(DAMAGE_TAGS.blocked)
  ) {
    return 'deflected';
  }
  if (region === 'head') return 'headshot';
  if (region === 'weakpoint' || tags.includes(DAMAGE_TAGS.weakpoint)) return 'weakpoint';
  return 'normal';
}

/** A damage model: the modifier registry plus `apply`, which resolves hits (see the file header). */
export class DamageModel {
  private registered: (ModifierEntry & { readonly modifier: DamageModifier })[] = [];
  private nextId = 1;

  /**
   * Adds `modifier` to its stage and returns its registration id (ids ascend, so later registrations
   * run later within a stage). Throws a RangeError for an unknown stage or an empty name.
   */
  register(modifier: DamageModifier): number {
    if (!(DAMAGE_STAGES as readonly string[]).includes(modifier.stage)) {
      throw new RangeError(`unknown damage stage "${modifier.stage}"`);
    }
    if (modifier.name === '') throw new RangeError('damage modifier name must not be empty');
    const id = this.nextId++;
    this.registered = [
      ...this.registered,
      { id, name: modifier.name, stage: modifier.stage, modifier },
    ];
    return id;
  }

  /** Removes a registered modifier; returns whether it was registered. */
  unregister(id: number): boolean {
    const before = this.registered.length;
    this.registered = this.registered.filter((entry) => entry.id !== id);
    return this.registered.length < before;
  }

  /** Registered modifiers in pipeline order: by stage, then registration id. */
  modifiers(): readonly ModifierEntry[] {
    return DAMAGE_STAGES.flatMap((stage) =>
      this.registered
        .filter((entry) => entry.stage === stage)
        .map(({ id, name }) => ({ id, name, stage })),
    );
  }

  /**
   * Resolves `input` against `target` and applies it: health drops (clamped at 0), poise takes the
   * poise damage, and DamageApplied — then PoiseBroken or Died — is emitted. Returns the result, or
   * undefined when the hit is ignored because `target` has no health or is already dead. Throws a
   * RangeError for an invalid packet or a modifier returning an invalid hit.
   */
  apply(world: World<never>, target: EntityId, input: DamagePacketInput): DamageResult | undefined {
    const packet = createDamagePacket(input);
    const health = world.get(target, HealthComponent);
    if (health === undefined || health.current === 0) return undefined;
    const resistances = world.get(target, ResistancesComponent);
    const tick = world.tick;
    const base = { world, target, packet, tick, difficulty: world.difficulty };
    let hit: DamageHit = {
      amounts: packet.amounts,
      poiseDamage: packet.poiseDamage,
      staminaDamage: packet.staminaDamage,
      tags: packet.tags,
    };
    for (const stage of DAMAGE_STAGES) {
      const ctx: DamageContext = { ...base, stage };
      const builtIn = BUILT_IN[stage];
      if (builtIn !== undefined) hit = builtIn(hit, ctx, resistances);
      for (const { stage: at, name, modifier } of this.registered) {
        if (at === stage) hit = normalizeHit(name, modifier.apply(hit, ctx) ?? hit);
      }
    }
    if (isPlayer(world, target)) {
      const { damageTaken, fallDamage } = world.difficulty;
      hit = mapUnits(hit, (units) => scaleUnits(units, damageTaken));
      // The environmental-damage assist (falls, crushes, hazards; mw-e04.34): 0 turns them off.
      if (hit.tags.includes(DAMAGE_TAGS.environment)) {
        hit = mapUnits(hit, (units) => scaleUnits(units, fallDamage));
      }
    }

    const total = totalDamage(hit.amounts);
    const undying = world.isRegistered(UndyingComponent) && world.has(target, UndyingComponent);
    const floor = undying ? Math.min(toUnits(UNDYING_FLOOR), toUnits(health.current)) : 0;
    const healthAfter = fromUnits(Math.max(floor, toUnits(health.current) - toUnits(total)));
    world.set(target, HealthComponent, Object.freeze({ ...health, current: healthAfter }));
    const died = healthAfter === 0;

    let poiseBroken = false;
    const poise = world.get(target, PoiseComponent);
    if (!died && poise !== undefined && hit.poiseDamage > 0) {
      const next = poiseAfterHit(poise, hit.poiseDamage, tick);
      world.set(target, PoiseComponent, next.poise);
      poiseBroken = next.broken;
    }

    const result: DamageResult = Object.freeze({
      tick,
      target,
      packet,
      amounts: Object.freeze(hit.amounts),
      total,
      immune: isImmune(packet, resistances),
      poiseDamage: hit.poiseDamage,
      staminaDamage: hit.staminaDamage,
      tags: hit.tags,
      healthBefore: health.current,
      healthAfter,
      poiseBroken,
      died,
    });
    const { instigator, source } = packet;
    world.events.emit(DamageApplied, result);
    if (hit.tags.includes(DAMAGE_TAGS.deflected)) {
      world.events.emit(Deflected, {
        tick,
        target,
        instigator,
        source,
        region: packet.region,
        armor: packet.armor ?? 0,
        penetration: packet.penetration ?? 0,
      });
    }
    if (!result.immune) {
      const variant: HitMarkerVariant = hitMarkerVariant(hit.tags, packet.region);
      world.events.emit(HitMarker, { tick, target, instigator, variant });
    }
    if (poiseBroken) world.events.emit(PoiseBroken, { tick, target, instigator, source });
    if (died) {
      world.events.emit(Died, { tick, target, killer: instigator, source, tags: hit.tags });
    }
    return result;
  }
}
