// The creature attack executor (mw-e12.5). Given compiled attack data (RuntimeAttack: a move plus the
// attack's own numbers, src/content/types/attack.ts), it answers "may this attacker start this attack
// now?" deterministically, runs a started attack through its windup, active and recovery ticks, fires
// the telegraph, and turns overlaps of the live hit volume into damage packets for the damage model —
// one packet per packet definition per target, so every creature hit composes through the same
// resistances, guards and modifiers as the knight's. Choosing which attack to use is AI's job (e11);
// the parry and block rules act on those packets in the damage model's guard stage (e04.6, e04.12).
//
// Timing: attack tick k (1-based) is the executor's k-th run after `startAttack` and plays the move's
// tick k − 1, so a 12/4/10 attack is active on attack ticks 13–16 and completes on tick 26. Hits:
// the move's hit volume (at its rest pose — socket tracks, e04.2, will animate it) is placed at the
// attacker's placement facing the committed aim, and tested against every living entity with a
// placement and health (its bounding sphere is the hurtbox until e04.2 adds regions). Each target is
// hit at most once per attack. Projectiles fly straight at their speed, sweep a capsule each tick and
// hit the first target along the path (level geometry does not stop them yet).
//
// I-frames (mw-e04.28): a target the `invulnerable` rule (`invulnerabilityRule`: dodge and wake-up
// i-frames, the same rule the hit-volume system asks) names on the tick it is struck gets DodgedHit
// instead of damage. A dodged melee target counts as hit for the attack, so the swing cannot catch it
// later in its window; a projectile flies on through it as if it missed (DodgedHit once per target)
// and may still hit whoever is behind. On the executor's own counter (attacks off the move system,
// below), DodgedHit names the attack as the hitbox and the bounding sphere as hurtbox `body` (torso,
// ×1).
// Run the action timeline before the executor so the rule reads this tick's move.
//
// A poise break (PoiseBroken) or death of the attacker breaks its attack off; hyperarmor is the poise
// rules' business, so a hit that did not break poise never reaches here.
//
// The move system (mw-e04.20). A melee or area attack of an attacker with an action timeline and
// hitboxes (a spawned creature in a world with knight combat) is not run by the executor's own
// counter: it is performed on the attacker's action timeline, exactly as the combat sandbox's attacker
// dummy performs its swing, so it shares every rule of the player's moves — the melee strikes open its
// hit volume on the hit-volume system (regions, i-frames, allies), its packet is tagged parryable /
// unblockable from the move, a parry in the window interrupts it and leaves the creature Parried
// (PARRIED_TICKS) with the parry's hit-stop, a shield blocks it, hit reactions interrupt and lock it,
// and hit-stop freezes it. `startAttack` turns the attacker to its aim and requests the move;
// the executor follows the timeline each tick: TelegraphStarted on each move's telegraphTick (counted
// in the move's own ticks, so hit-stop delays it), the chain's next move requested once the running
// one opens its cancel window into an attack (or reaches its last tick), the attack's extra packets
// applied after each struck target's own packet (MoveStruck; a parried swing has ended by then), and
// AttackEnded: `parried` as soon as a parry deflects it (HitParried), else once no move of it runs —
// `staggered` when a hit reaction locked it, `cancelled` when something else took the timeline,
// else `completed`. Run the
// executor after the action timeline and the hit-volume system, and install it after the melee
// strikes. Projectile, grab and special attacks, and attackers without a timeline, keep the executor's
// own counter. A projectile hits where its target's hurtboxes are (the hit-volume system's segment
// query), not at its feet, so a creature's arrow at chest height strikes a standing knight.

import type { RuntimeAttack, RuntimeMove, TargetStance } from '@content/index';
import type { EntityId } from '../../core/component';
import type { System, World } from '../../core/world';
import { hypot } from '../../math';
import { PlacementComponent } from '../../stimulus/placement';
import { shapeFalloff, type Vec3 } from '../../stimulus/shapes';
import { HealthComponent } from '../damage/components';
import { Died, PoiseBroken, type DamageResult } from '../damage/events';
import type { DamageModel } from '../damage/model';
import { DAMAGE_TAGS } from '../damage/packet';
import { HitboxComponent, HurtboxComponent } from '../hits/components';
import { DodgedHit } from '../hits/events';
import {
  hurtboxTargets,
  noAllies,
  noInvulnerability,
  type AllyRule,
  segmentHurtboxHits,
  type InvulnerabilityRule,
} from '../hits/system';

import { CombatFacingComponent, facingOf, giveFacing } from '../melee/components';
import { MoveStruck, type MoveStrike } from '../melee/events';
import { HitParried } from '../parry/events';
import { ActionTimelineComponent, type ActionTimeline } from '../timeline/components';
import { interruptAction, requestMove } from '../timeline/timeline';
import {
  AttackerComponent,
  ProjectileComponent,
  type ActiveAttack,
  type Attacker,
  type Projectile,
  type TimelineRun,
} from './components';
import {
  AttackActive,
  AttackEnded,
  AttackHit,
  AttackProjectileLaunched,
  AttackStub,
  TelegraphStarted,
  type AttackEndReason,
} from './events';
import { horizontalAim, pointToWorld, rotateToWorld, shapeToWorld, type HitShape } from './frame';

/** Compiled attacks by id (`compileAttacks`); the executor looks started attacks up here. */
export type AttackLookup = ReadonlyMap<string, RuntimeAttack>;

/** What the executor needs: the attack table and the damage model hits resolve through. */
export interface AttackExecutorOptions {
  readonly attacks: AttackLookup;
  readonly damage: DamageModel;
  /**
   * Who is invulnerable this tick: a hit on them is DodgedHit, not damage. Defaults to nobody;
   * `invulnerabilityRule(moves)` gives dodge and wake-up i-frames (run the timeline first).
   */
  readonly invulnerable?: InvulnerabilityRule;
  /**
   * Who counts as the attacker's ally: its swings and projectiles pass through them without a hit
   * (the Forgotten do not cut each other down; mw-qfx). Defaults to nobody. World damage (fire,
   * falling objects) never goes through this rule.
   */
  readonly isAlly?: AllyRule;
}

/** A phase of an attack. */
export type AttackPhase = 'windup' | 'active' | 'recovery';

/** The phase attack tick `attackTick` (1-based) of `attack` is in, or null past its last tick. */
export function attackPhase(attack: RuntimeAttack, attackTick: number): AttackPhase | null {
  const { startup, active, totalTicks } = attack.move;
  if (attackTick <= startup) return 'windup';
  if (attackTick <= startup + active) return 'active';
  return attackTick <= totalTicks ? 'recovery' : null;
}

/** What a precondition check knows about the target (reported by the caller, e.g. AI). */
export interface AttackContext {
  /** Distance from attacker to target, centre to centre, metres. */
  readonly distance: number;
  /** What the target is doing; undefined when unknown (fails any stance precondition). */
  readonly targetStance?: TargetStance;
}

/** Why an attack may not start now. */
export type AttackRefusal =
  'busy' | 'cooldown' | 'too-close' | 'too-far' | 'target-stance' | 'health';

/** The answer of `canStartAttack`. */
export type AttackCheck =
  { readonly ok: true } | { readonly ok: false; readonly reason: AttackRefusal };

const OK: AttackCheck = Object.freeze({ ok: true });

function attackerOf(world: World<never>, entity: EntityId): Attacker {
  const attacker = world.get(entity, AttackerComponent);
  if (attacker === undefined) throw new Error(`entity ${String(entity)} is not an attacker`);
  return attacker;
}

/** Every move `attack` performs, in order (its move, then the chain it continues into). */
export function attackChain(attack: RuntimeAttack): readonly RuntimeMove[] {
  return attack.chain ?? [attack.move];
}

/** `entity`'s action timeline, or undefined when it has none (or the world has no timelines). */
function timelineOf(world: World<never>, entity: EntityId): ActionTimeline | undefined {
  return world.isRegistered(ActionTimelineComponent)
    ? world.get(entity, ActionTimelineComponent)
    : undefined;
}

/**
 * Whether `entity` performs `attack` on its action timeline (the move system, see the file header):
 * a melee or area attack, and `entity` has an action timeline and hitboxes.
 */
export function attacksOnTimeline(
  world: World<never>,
  entity: EntityId,
  attack: RuntimeAttack,
): boolean {
  if (attack.kind !== 'melee' && attack.kind !== 'area') return false;
  if (timelineOf(world, entity) === undefined) return false;
  return world.isRegistered(HitboxComponent) && world.has(entity, HitboxComponent);
}

/** Whether `entity`'s action timeline is busy: a move running or requested, or a lock (a reaction). */
function timelineBusy(world: World<never>, entity: EntityId): boolean {
  const timeline = timelineOf(world, entity);
  if (timeline === undefined) return false;
  return timeline.current !== null || timeline.buffer !== null || timeline.lockTicks > 0;
}

/**
 * Whether `entity` may start `attack` now, checked in a fixed order: busy (an attack in progress, or
 * its action timeline running, requesting or locked — a stagger or a Parried stun), cooldown, range
 * (too-close/too-far), target stance, own health band (current / max health; an entity without
 * health counts as full). Range and stance are skipped when the context leaves out the distance
 * (`canUseMove`'s range-free question). Pure: the same world state and context always give the
 * same answer. Throws when `entity` is not an attacker.
 */
export function canStartAttack(
  world: World<never>,
  entity: EntityId,
  attack: RuntimeAttack,
  context: Partial<AttackContext>,
): AttackCheck {
  const attacker = attackerOf(world, entity);
  const refuse = (reason: AttackRefusal): AttackCheck => ({ ok: false, reason });
  if (attacker.current !== null || timelineBusy(world, entity)) return refuse('busy');
  if (world.tick < (attacker.readyAt[attack.id] ?? 0)) return refuse('cooldown');
  const { distance } = context;
  if (distance !== undefined) {
    if (distance < attack.rangeMin) return refuse('too-close');
    if (distance > attack.rangeMax) return refuse('too-far');
    const stances = attack.targetStances;
    if (stances !== null && !stances.some((stance) => stance === context.targetStance)) {
      return refuse('target-stance');
    }
  }
  const health = world.get(entity, HealthComponent);
  const fraction = health === undefined ? 1 : health.current / health.max;
  if (fraction < attack.healthMin || fraction > attack.healthMax) return refuse('health');
  return OK;
}

/** Turns `entity` (its combat facing and hurtboxes, where it has them) to face `aim`. */
function face(world: World<never>, entity: EntityId, aim: Vec3): void {
  if (world.isRegistered(CombatFacingComponent)) giveFacing(world, entity, aim);
  const hurtboxes = world.isRegistered(HurtboxComponent)
    ? world.get(entity, HurtboxComponent)
    : undefined;
  if (hurtboxes !== undefined) {
    world.set(
      entity,
      HurtboxComponent,
      Object.freeze({ ...hurtboxes, facing: facingOf(world, entity) }),
    );
  }
}

const NOT_STARTED: TimelineRun = Object.freeze({
  move: null,
  startedAt: null,
  telegraphed: false,
  followUp: false,
});

/**
 * Starts `attack` for `entity`, facing `aim` (its horizontal direction is used), and puts the attack
 * on cooldown from this tick. On the move system (`attacksOnTimeline`) it turns the attacker to `aim`
 * and requests the attack's move on its action timeline, which starts it on its next run.
 * Preconditions are the caller's to check (`canStartAttack`); this only throws — when `entity` is
 * not an attacker or is busy, or `aim` has no horizontal direction.
 */
export function startAttack(
  world: World<never>,
  entity: EntityId,
  attack: RuntimeAttack,
  aim: Vec3,
): void {
  const attacker = attackerOf(world, entity);
  if (attacker.current !== null) {
    throw new Error(`entity ${String(entity)} is already attacking (${attacker.current.attack})`);
  }
  const tick = world.tick;
  const onTimeline = attacksOnTimeline(world, entity, attack);
  const current: ActiveAttack = Object.freeze({
    attack: attack.id,
    elapsed: 0,
    startedAt: tick,
    aim: horizontalAim(aim),
    hit: Object.freeze([]),
    ...(onTimeline && { timeline: NOT_STARTED }),
  });
  const readyAt = Object.freeze({
    ...attacker.readyAt,
    [attack.id]: tick + world.clock.ticksFor(attack.cooldownMs),
  });
  world.set(entity, AttackerComponent, Object.freeze({ ...attacker, current, readyAt }));
  if (onTimeline) {
    face(world, entity, current.aim);
    requestMove(world, entity, attack.move.id);
  }
}

function end(
  world: World<never>,
  entity: EntityId,
  attacker: Attacker,
  current: ActiveAttack,
  reason: AttackEndReason,
): void {
  world.set(entity, AttackerComponent, Object.freeze({ ...attacker, current: null }));
  world.events.emit(AttackEnded, {
    tick: world.tick,
    attacker: entity,
    attack: current.attack,
    reason,
    elapsed: current.elapsed,
  });
}

/**
 * Breaks off `entity`'s attack in progress (no further telegraph, hit volume or damage) and emits
 * AttackEnded with `reason`. On the move system its running (or requested) move is interrupted too,
 * keeping any lock the timeline already has (a hit reaction's). Returns whether there was one; an
 * idle entity or a non-attacker is a no-op. The cooldown stays spent.
 */
export function cancelAttack(
  world: World<never>,
  entity: EntityId,
  reason: Exclude<AttackEndReason, 'completed'> = 'cancelled',
): boolean {
  const attacker = world.get(entity, AttackerComponent);
  if (attacker === undefined) return false;
  const { current } = attacker;
  if (current === null) return false;
  end(world, entity, attacker, current, reason);
  const timeline = current.timeline === undefined ? undefined : timelineOf(world, entity);
  if (timeline !== undefined && (timeline.current !== null || timeline.buffer !== null)) {
    interruptAction(world, entity, timeline.lockTicks);
  }
  return true;
}

function lookup(attacks: AttackLookup, id: string): RuntimeAttack {
  const attack = attacks.get(id);
  if (attack === undefined) throw new Error(`attack "${id}" is not in the executor's table`);
  return attack;
}

/** Emits DodgedHit for `target`, struck by `attack` on its `activeTick`-th active tick. */
function dodged(
  world: World<never>,
  hit: { attacker: EntityId; attack: RuntimeAttack; target: EntityId; aim: Vec3 },
  activeTick: number,
): void {
  world.events.emit(DodgedHit, {
    tick: world.tick,
    attacker: hit.attacker,
    hitbox: hit.attack.id,
    activeTick,
    target: hit.target,
    hurtbox: 'body',
    region: 'torso',
    multiplier: 1,
    armored: false,
    direction: hit.aim,
  });
}

/** Applies every packet of `attack` to `target`; emits AttackHit. */
function strike(
  world: World<never>,
  options: AttackExecutorOptions,
  hit: { attacker: EntityId; source: EntityId; attack: RuntimeAttack; target: EntityId; aim: Vec3 },
): void {
  const { attacker, source, attack, target, aim } = hit;
  const results: DamageResult[] = [];
  for (const packet of attack.packets) {
    const result = options.damage.apply(world, target, {
      instigator: attacker,
      source,
      amounts: packet.amounts,
      poiseDamage: packet.poiseDamage,
      staminaDamage: packet.staminaDamage,
      impulse: rotateToWorld(packet.impulse, aim),
      impactForce: packet.impactForce,
      direction: aim,
      tags: packet.tags,
    });
    if (result !== undefined) results.push(result);
  }
  world.events.emit(AttackHit, {
    tick: world.tick,
    attacker,
    attack: attack.id,
    target,
    source,
    results: Object.freeze(results),
  });
}

/** Living hurtboxes (placement + health > 0) other than `exclude`, in ascending id order. */
function hurtboxes(
  world: World<never>,
  exclude: EntityId,
): { readonly entity: EntityId; readonly at: Vec3 & { readonly radius: number } }[] {
  const out: { entity: EntityId; at: Vec3 & { radius: number } }[] = [];
  world.query(PlacementComponent, HealthComponent).forEach((entity, at, health) => {
    if (entity !== exclude && health.current > 0) out.push({ entity, at });
  });
  return out;
}

function runActive(
  world: World<never>,
  options: AttackExecutorOptions,
  entity: EntityId,
  attack: RuntimeAttack,
  current: ActiveAttack,
  attackTick: number,
): ActiveAttack {
  const base = { tick: world.tick, attacker: entity, attack: attack.id };
  const first = attackTick === attack.move.startup + 1;
  const placement = world.get(entity, PlacementComponent);
  if (attack.kind === 'grab' || attack.kind === 'special') {
    if (first) world.events.emit(AttackStub, { ...base, kind: attack.kind });
    return current;
  }
  if (placement === undefined) return current;
  if (attack.projectile !== null) {
    if (!first) return current;
    const origin = pointToWorld(attack.projectile.origin, placement, current.aim);
    const projectile = world.spawn();
    world.add(projectile, ProjectileComponent, {
      attacker: entity,
      attack: attack.id,
      position: origin,
      direction: current.aim,
      travelled: 0,
    });
    world.events.emit(AttackProjectileLaunched, {
      ...base,
      projectile,
      origin,
      direction: current.aim,
    });
    return current;
  }
  const shape = shapeToWorld(attack.hitbox.shape, placement, current.aim);
  world.events.emit(AttackActive, { ...base, attackTick, shape });
  const isAlly = options.isAlly ?? noAllies;
  const targets = hurtboxes(world, entity).filter(
    ({ entity: target, at }) =>
      !current.hit.includes(target) &&
      !isAlly(world, entity, target) &&
      shapeFalloff(shape, 'none', at, at.radius) !== undefined,
  );
  const invulnerable = options.invulnerable ?? noInvulnerability;
  for (const { entity: target } of targets) {
    const hit = { attacker: entity, source: entity, attack, target, aim: current.aim };
    if (invulnerable(world, target)) dodged(world, hit, attackTick - attack.move.startup);
    else strike(world, options, hit);
  }
  if (targets.length === 0) return current;
  const hit = [...current.hit, ...targets.map((t) => t.entity)].sort((a, b) => a - b);
  return { ...current, hit: Object.freeze(hit) };
}

/** Emits TelegraphStarted for `move` of `attack`. */
function telegraph(
  world: World<never>,
  entity: EntityId,
  attack: RuntimeAttack,
  move: RuntimeMove,
) {
  const cues = move.presentation.telegraph;
  world.events.emit(TelegraphStarted, {
    tick: world.tick,
    attacker: entity,
    attack: attack.id,
    move: move.id,
    cue: attack.telegraph,
    audioCue: cues?.audioCue ?? null,
    vfxCue: cues?.vfxCue ?? null,
    parryable: move.parryable,
    unblockable: move.unblockable || attack.kind === 'grab',
  });
}

/** Whether the move tick `tick` of `move` is the moment to request the chain's next move. */
const followUpDue = (move: RuntimeMove, tick: number): boolean =>
  tick >= move.totalTicks - 1 ||
  move.cancelWindows.some((w) => w.into === 'attack' && tick >= w.from && tick <= w.to);

/** Why a move-system attack whose moves no longer run ended (a parry ends it at once, HitParried). */
function endReason(current: ActiveAttack, timeline: ActionTimeline | undefined): AttackEndReason {
  if (timeline === undefined) return 'cancelled';
  if (timeline.lockTicks > 0) return 'staggered';
  if (timeline.current !== null || current.timeline?.startedAt === null) return 'cancelled';
  return 'completed';
}

/** One tick of a move-system attack (see the file header). */
function runOnTimeline(
  world: World<never>,
  entity: EntityId,
  attacker: Attacker,
  current: ActiveAttack & { readonly timeline: TimelineRun },
  attack: RuntimeAttack,
): void {
  const timeline = timelineOf(world, entity);
  const running = timeline?.current ?? null;
  const chain = attackChain(attack);
  const index =
    running === null || running.startedAt < current.startedAt
      ? -1
      : chain.findIndex((m) => m.id === running.move);
  const store = (run: TimelineRun) => {
    const next = Object.freeze({ ...current, elapsed: current.elapsed + 1, timeline: run });
    world.set(entity, AttackerComponent, Object.freeze({ ...attacker, current: next }));
  };
  const move = chain[index];
  if (running !== null && move !== undefined) {
    let run = current.timeline;
    if (run.startedAt !== running.startedAt) {
      run = { move: move.id, startedAt: running.startedAt, telegraphed: false, followUp: false };
    }
    if (!run.telegraphed && running.tick >= move.telegraphTick) {
      telegraph(world, entity, attack, move);
      run = { ...run, telegraphed: true };
    }
    if (!run.followUp && index + 1 < chain.length && followUpDue(move, running.tick)) {
      requestMove(world, entity, attack.move.id);
      run = { ...run, followUp: true };
    }
    store(Object.freeze(run));
    return;
  }
  // None of its moves runs: it is about to (its request is buffered), or it is over.
  const waiting = current.timeline.startedAt === null || current.timeline.followUp;
  if (waiting && timeline?.buffer?.move === attack.move.id) {
    store(current.timeline);
    return;
  }
  end(world, entity, attacker, current, endReason(current, timeline));
}

/** The attack's extra packets for one struck target of a move-system attack, and AttackHit. */
function strikeExtras(
  world: World<never>,
  options: AttackExecutorOptions,
  strike: MoveStrike,
): void {
  const attacker = world.get(strike.attacker, AttackerComponent);
  const current = attacker?.current ?? null;
  if (attacker === undefined || current?.timeline === undefined) return;
  const attack = lookup(options.attacks, current.attack);
  const move = attackChain(attack).find((m) => m.id === strike.move);
  if (move === undefined) return;
  const { result, target } = strike;
  const results: DamageResult[] = result === null ? [] : [result];
  if (result !== null && !result.tags.includes(DAMAGE_TAGS.parried)) {
    const { packet } = result;
    const aim = current.aim;
    for (const extra of attack.packets.slice(1)) {
      const applied = options.damage.apply(world, target, {
        instigator: strike.attacker,
        source: strike.attacker,
        amounts: extra.amounts,
        poiseDamage: extra.poiseDamage,
        staminaDamage: extra.staminaDamage,
        impulse: rotateToWorld(extra.impulse, aim),
        impactForce: extra.impactForce,
        direction: aim,
        ...(packet.region !== undefined && { region: packet.region }),
        regionMultiplier: packet.regionMultiplier,
        tags: [...extra.tags, ...(move.unblockable ? [DAMAGE_TAGS.unblockable] : [])],
      });
      if (applied !== undefined) results.push(applied);
    }
  }
  if (!current.hit.includes(target)) {
    const hit = Object.freeze([...current.hit, target].sort((a, b) => a - b));
    const next = Object.freeze({ ...current, hit });
    world.set(strike.attacker, AttackerComponent, Object.freeze({ ...attacker, current: next }));
  }
  world.events.emit(AttackHit, {
    tick: world.tick,
    attacker: strike.attacker,
    attack: attack.id,
    target,
    source: strike.attacker,
    results: Object.freeze(results),
  });
}

/**
 * Runs every attack in progress one tick: telegraph on the move's telegraphTick, the hit volume (or
 * projectile launch, or grab/special stub) on active ticks, and AttackEnded once recovery is over.
 * A move-system attack is followed on its action timeline instead (see the file header).
 */
export function attackSystem<TInput>(options: AttackExecutorOptions): System<TInput> {
  return {
    name: 'attacks',
    run: ({ world }) => {
      const w: World<never> = world;
      w.query(AttackerComponent).forEach((entity, attacker) => {
        const { current } = attacker;
        if (current === null) return;
        const attack = lookup(options.attacks, current.attack);
        if (current.timeline !== undefined) {
          runOnTimeline(w, entity, attacker, { ...current, timeline: current.timeline }, attack);
          return;
        }
        const attackTick = current.elapsed + 1;
        if (attackTick - 1 === attack.move.telegraphTick) telegraph(w, entity, attack, attack.move);
        let next: ActiveAttack = { ...current, elapsed: attackTick };
        if (attackPhase(attack, attackTick) === 'active') {
          next = runActive(w, options, entity, attack, next, attackTick);
        }
        const frozen = Object.freeze(next);
        const updated: Attacker = Object.freeze({ ...attacker, current: frozen });
        w.set(entity, AttackerComponent, updated);
        if (attackTick >= attack.move.totalTicks) end(w, entity, updated, frozen, 'completed');
      });
    },
  };
}

/**
 * The living hurtboxes the swept capsule `from`→`to` touches, other than `exclude` and those in
 * `skip`, nearest along the path first (ties in ascending id order). An entity with hurtboxes
 * (every spawned creature and the knight) is touched where its hurtboxes are, so a shot at chest
 * height hits a standing knight (mw-ju8.19); any other living placed entity is its bounding sphere.
 */
function allAlong(
  world: World<never>,
  exclude: EntityId,
  skip: readonly EntityId[],
  path: { from: Vec3; to: Vec3; direction: Vec3; radius: number },
): EntityId[] {
  const sweep: HitShape = { kind: 'capsule', from: path.from, to: path.to, radius: path.radius };
  const found: { entity: EntityId; along: number }[] = [];
  const boxed = world.isRegistered(HurtboxComponent);
  if (boxed) {
    const reach = hypot(path.to.x - path.from.x, path.to.y - path.from.y, path.to.z - path.from.z);
    const hits = segmentHurtboxHits(
      hurtboxTargets(world),
      { from: path.from, to: path.to, radius: path.radius },
      (entity) => entity === exclude || skip.includes(entity),
    );
    for (const { entity, fraction } of hits) found.push({ entity, along: fraction * reach });
  }
  for (const { entity, at } of hurtboxes(world, exclude)) {
    if (skip.includes(entity)) continue;
    if (boxed && world.has(entity, HurtboxComponent)) continue;
    if (shapeFalloff(sweep, 'none', at, at.radius) === undefined) continue;
    const d = path.direction;
    const along =
      (at.x - path.from.x) * d.x + (at.y - path.from.y) * d.y + (at.z - path.from.z) * d.z;
    found.push({ entity, along });
  }
  // A stable sort: equal distances keep the query's ascending id order.
  return found.sort((a, b) => a.along - b.along).map((f) => f.entity);
}

/**
 * Moves every projectile one tick (speed / hz metres, never past its max range), hits the first
 * living hurtbox along the way with the attack's packets, and removes projectiles that hit or reached
 * their range. An invulnerable hurtbox along the way gets DodgedHit (once) and is flown through.
 */
export function projectileSystem<TInput>(options: AttackExecutorOptions): System<TInput> {
  return {
    name: 'attack-projectiles',
    run: ({ world, clock }) => {
      const w: World<never> = world;
      const invulnerable = options.invulnerable ?? noInvulnerability;
      const isAlly = options.isAlly ?? noAllies;
      w.query(ProjectileComponent).forEach((entity, projectile) => {
        const attack = lookup(options.attacks, projectile.attack);
        const flight = attack.projectile;
        if (flight === null) throw new Error(`attack "${attack.id}" is not a projectile attack`);
        const step = Math.min(flight.speed / clock.hz, flight.maxRange - projectile.travelled);
        const { position: from, direction } = projectile;
        const to = {
          x: from.x + direction.x * step,
          y: from.y + direction.y * step,
          z: from.z + direction.z * step,
        };
        const passed = projectile.dodged ?? [];
        const along = allAlong(w, projectile.attacker, passed, {
          from,
          to,
          direction,
          radius: flight.radius,
        });
        const dodgedNow: EntityId[] = [];
        for (const target of along) {
          if (isAlly(w, projectile.attacker, target)) continue;
          const hit = {
            attacker: projectile.attacker,
            source: entity,
            attack,
            target,
            aim: direction,
          };
          if (invulnerable(w, target)) {
            dodged(w, hit, 1);
            dodgedNow.push(target);
            continue;
          }
          strike(w, options, hit);
          w.destroy(entity);
          return;
        }
        const travelled = projectile.travelled + step;
        if (travelled >= flight.maxRange) {
          w.destroy(entity);
          return;
        }
        const moved: Projectile = {
          ...projectile,
          position: to,
          travelled,
          ...(dodgedNow.length > 0 && {
            dodged: Object.freeze([...passed, ...dodgedNow].sort((a, b) => a - b)),
          }),
        };
        w.set(entity, ProjectileComponent, Object.freeze(moved));
      });
    },
  };
}

/**
 * Wires the executor into `world`: the attack and projectile systems (appended in that order), the
 * interrupts — a PoiseBroken on an attacker cancels its attack as `staggered`, a Died as `died` —
 * and, for move-system attacks, the extra packets after each MoveStruck. Register ATTACK_COMPONENTS
 * and the damage components first (and install it after the melee strikes, see the file header).
 * Returns a function that removes the subscriptions (the systems stay, as systems always do).
 */
export function installAttacks<TInput>(
  world: World<TInput>,
  options: AttackExecutorOptions,
): () => void {
  world.addSystem(attackSystem(options)).addSystem(projectileSystem(options));
  const w: World<never> = world;
  const offs = [
    world.events.on(PoiseBroken, ({ target }) => cancelAttack(w, target, 'staggered')),
    world.events.on(Died, ({ target }) => cancelAttack(w, target, 'died')),
    world.events.on(MoveStruck, (strike) => {
      strikeExtras(w, options, strike);
    }),
    world.events.on(HitParried, ({ attacker }) => {
      if (attacker === null) return;
      const state = w.get(attacker, AttackerComponent);
      const current = state?.current ?? null;
      // The parry has interrupted its move already; only a move-system attack can be parried.
      if (state !== undefined && current?.timeline !== undefined) {
        end(w, attacker, state, current, 'parried');
      }
    }),
  ];
  return () => {
    for (const off of offs) off();
  };
}
