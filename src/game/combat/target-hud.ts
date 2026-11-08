// The target readout and damage numbers' game glue (mw-e04.21). Reads the sim once per drawn frame
// and turns DamageApplied into HUD feedback; the widgets (src/ui/target-hud.ts) hold no rules.
//
// - Target bar: the player's lock-on target, else whoever the player hit last (for TARGET_HOLD_MS), shown
//   with its name and health. It hides when the target dies or there is none.
// - Damage numbers: a hit the player lands shows its applied total over the target ("No effect" when
//   the target is immune); a hit the player takes shows over the player. Off when `enabled()` is false.
//
// Events are queued as the sim emits them and handed to the widgets on the next drawn frame.

import {
  CreatureComponent,
  creaturesInstalled,
  DamageApplied,
  DAMAGE_TAGS,
  healthOf,
  isDead,
  PlacementComponent,
  PoiseBroken,
  poiseOf,
  type EntityId,
  type World,
} from '@sim/index';
import type {
  BossBar,
  DamageNumbers,
  HitMarkers,
  HitVariant,
  TargetBar,
  TargetModel,
} from '@ui/index';
import type { LockTarget } from '../player/testbed-player';

/** How long the bar stays on whoever the player last hit, when nothing is locked. */
export const TARGET_HOLD_MS = 5000;
/** Metres above a fighter's feet its damage numbers appear. */
export const NUMBER_HEIGHT = 1.8;
/** Metres above a fighter's feet its hit markers appear. */
export const MARKER_HEIGHT = 1.2;
/** How long the "no effect" note shows after an immune hit. */
export const NO_EFFECT_MS = 800;
/** How long the poise bar flashes after PoiseBroken. */
export const POISE_BROKEN_MS = 600;

/** A world point projected to normalised device coordinates (x right, y up, −1…1). */
export type NdcOf = (point: { x: number; y: number; z: number }) => {
  x: number;
  y: number;
  z: number;
};

/** "forgotten-miner" → "Forgotten miner". */
export function displayName(id: string): string {
  const words = id.replace(/[-_]+/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** The lock-on target while it lives: the reticle and bars drop the frame it dies (Died). */
export function liveLock(
  world: World<never>,
  lock: LockTarget | undefined,
): LockTarget | undefined {
  return lock !== undefined && !isDead(world, lock.entity) ? lock : undefined;
}

/** How a landed hit reads: deflected (parried or blocked), headshot, weak point, else normal. */
export function hitVariant(hit: {
  readonly tags: readonly string[];
  readonly packet: { readonly region?: string };
}): HitVariant {
  if (hit.tags.includes(DAMAGE_TAGS.parried) || hit.tags.includes(DAMAGE_TAGS.blocked)) {
    return 'deflected';
  }
  const region = hit.packet.region;
  if (region === 'head') return 'headshot';
  if (region === 'weakpoint' || hit.tags.includes(DAMAGE_TAGS.weakpoint)) return 'weakpoint';
  return 'normal';
}

/** What a bar shows beyond name and health: its poise and the note flags. */
export interface BarExtras {
  readonly poiseSeen?: boolean;
  readonly poiseBroken?: boolean;
  readonly noEffect?: boolean;
}

/** The bar model for `target`, or null when it has no health or is dead. */
export function targetModel(
  world: World<never>,
  target: EntityId,
  extras: BarExtras = {},
): TargetModel | null {
  const health = healthOf(world, target);
  if (health === undefined || health.current <= 0) return null;
  const creature = creaturesInstalled(world) ? world.get(target, CreatureComponent) : undefined;
  const poise = extras.poiseSeen === true ? poiseOf(world, target) : undefined;
  return {
    name: creature === undefined ? 'Training dummy' : displayName(creature.origin.creature),
    health: { value: health.current, max: health.max },
    ...(poise !== undefined && { poise: { value: poise.current, max: poise.max } }),
    ...(extras.poiseBroken === true && { poiseBroken: true }),
    ...(extras.noEffect === true && { noEffect: true }),
  };
}

/** The text a hit shows: its whole-number total, "No effect" when immune, null for no damage. */
export function damageText(total: number, immune: boolean): string | null {
  if (immune) return 'No effect';
  const rounded = Math.round(total);
  return rounded > 0 ? String(rounded) : null;
}

export interface TargetHudGlueOptions {
  readonly world: World<never>;
  readonly player: EntityId;
  readonly bar: TargetBar;
  readonly boss: BossBar;
  readonly markers: HitMarkers;
  readonly numbers: DamageNumbers;
  /** Whether the creature with this content id is flagged boss. */
  readonly isBoss: (creature: string) => boolean;
  /** The player's lock-on target now, if any. */
  readonly lock: () => LockTarget | undefined;
  /** Projects a world point through the drawn camera. */
  readonly project: NdcOf;
  /** The HUD layer's size, CSS pixels. */
  readonly size: () => { readonly width: number; readonly height: number };
  /** Whether damage numbers are on (the Gameplay setting). */
  readonly numbersEnabled: () => boolean;
}

export interface TargetHudGlue {
  /** Call once per drawn frame, after the sim stepped, with the frame's time. */
  frame(nowMs: number): void;
  /** Stops listening to the sim. */
  dispose(): void;
}

interface Pending {
  readonly entity: EntityId;
  readonly text: string;
  readonly kind: 'dealt' | 'taken';
}

interface PendingMarker {
  readonly entity: EntityId;
  readonly variant: HitVariant;
}

/** Wires the target bar, boss bar, hit markers and damage numbers to the player's sim state. */
export function attachTargetHud(options: TargetHudGlueOptions): TargetHudGlue {
  const { world, player, bar, boss, markers, numbers, isBoss, lock, project, size } = options;
  const pending: Pending[] = [];
  const pendingMarkers: PendingMarker[] = [];
  let lastHit: EntityId | undefined;
  let lastHitMs = -Infinity;
  let lastHitQueued = false;
  // Poise shows once its target has taken poise damage; it flashes after PoiseBroken, and "No effect"
  // shows after an immune hit, each for a fixed time stamped on the first frame that sees the event.
  const poiseSeen = new Set<EntityId>();
  const brokenUntil = new Map<EntityId, number>();
  const noEffectUntil = new Map<EntityId, number>();
  const brokenQueued = new Set<EntityId>();
  const noEffectQueued = new Set<EntityId>();
  let engagedBoss: EntityId | undefined;

  const bossOf = (entity: EntityId): boolean => {
    const creature = creaturesInstalled(world) ? world.get(entity, CreatureComponent) : undefined;
    return creature !== undefined && isBoss(creature.origin.creature);
  };

  const offPoise = world.events.on(PoiseBroken, (e) => {
    brokenQueued.add(e.target);
  });
  const offDamage = world.events.on(DamageApplied, (hit) => {
    if (hit.poiseDamage > 0) poiseSeen.add(hit.target);
    if (hit.immune) noEffectQueued.add(hit.target);
    const dealt = hit.packet.instigator === player && hit.target !== player;
    const taken = hit.target === player;
    if (!dealt && !taken) return;
    if (dealt) {
      lastHitQueued = true;
      lastHit = hit.target;
      if (!hit.immune) pendingMarkers.push({ entity: hit.target, variant: hitVariant(hit) });
      if (bossOf(hit.target)) engagedBoss = hit.target;
    } else if (hit.packet.instigator !== null && bossOf(hit.packet.instigator)) {
      engagedBoss = hit.packet.instigator;
    }
    const text = damageText(hit.total, hit.immune);
    if (text !== null) {
      pending.push({ entity: hit.target, text, kind: dealt ? 'dealt' : 'taken' });
    }
  });

  const anchor = (entity: EntityId, metres: number): { x: number; y: number } | undefined => {
    const at = world.get(entity, PlacementComponent);
    if (at === undefined) return undefined;
    const ndc = project({ x: at.x, y: at.y + metres, z: at.z });
    if (!(Math.abs(ndc.z) <= 1)) return undefined;
    const { width, height } = size();
    return { x: ((ndc.x + 1) / 2) * width, y: ((1 - ndc.y) / 2) * height };
  };

  const modelOf = (entity: EntityId, nowMs: number): TargetModel | null =>
    targetModel(world, entity, {
      poiseSeen: poiseSeen.has(entity),
      poiseBroken: nowMs < (brokenUntil.get(entity) ?? -Infinity),
      noEffect: nowMs < (noEffectUntil.get(entity) ?? -Infinity),
    });

  return {
    frame(nowMs) {
      if (lastHitQueued) {
        lastHitMs = nowMs;
        lastHitQueued = false;
      }
      for (const e of brokenQueued) brokenUntil.set(e, nowMs + POISE_BROKEN_MS);
      brokenQueued.clear();
      for (const e of noEffectQueued) noEffectUntil.set(e, nowMs + NO_EFFECT_MS);
      noEffectQueued.clear();
      const enabled = options.numbersEnabled();
      for (const n of pending.splice(0)) {
        const at = enabled ? anchor(n.entity, NUMBER_HEIGHT) : undefined;
        if (at !== undefined) numbers.spawn(n.text, n.kind, at.x, at.y, nowMs);
      }
      for (const m of pendingMarkers.splice(0)) {
        const at = anchor(m.entity, MARKER_HEIGHT);
        if (at !== undefined) markers.spawn(m.variant, at.x, at.y, nowMs);
      }
      const locked = liveLock(world, lock())?.entity;
      if (locked !== undefined && bossOf(locked)) engagedBoss = locked;
      if (engagedBoss !== undefined && isDead(world, engagedBoss)) engagedBoss = undefined;
      const held = nowMs - lastHitMs < TARGET_HOLD_MS ? lastHit : undefined;
      const target = locked ?? held;
      // A boss gets the docked bar, not the top one.
      const showBoss = engagedBoss;
      const topTarget = target !== undefined && target === showBoss ? undefined : target;
      boss.update(showBoss === undefined ? null : modelOf(showBoss, nowMs), nowMs);
      bar.update(topTarget === undefined ? null : modelOf(topTarget, nowMs), nowMs);
      markers.update(nowMs);
      numbers.update(nowMs);
    },
    dispose() {
      offDamage();
      offPoise();
    },
  };
}
