// Spell light and noise (mw-e06.14): what a cast gives away. A glowing spell reveals you, a
// Thunderclap wakes the dungeon. Both feed the sim's existing channels, never a spell-specific
// path (ADR-0007): light goes to the light field as a `light` stimulus re-issued every tick the
// light shines, noise goes out as the shared `noiseEmitted` event that sound propagation (e09) and
// creature hearing (e11) consume.
//
// Light (`light` op): intensity (light units; a torch is 100), radius, duration and what it
// follows. `point` stays where the effect landed, `caster` follows the caster (chest height),
// `delivery` follows the projectile or beam in flight and, once the delivery ends, stays at the
// last place it was for the rest of its duration (a flash of one tick when the duration is 0).
// Instant deliveries have no flight, so a `delivery` light there is a point light at the hit.
// Duration 0 is a flash: one tick. The ledger of live lights (`magic.lights`) is world state, so
// snapshots and replays keep it; `spellLightSystem` applies the stimuli, so install it before
// `stimulusSystem` (and after the projectile system, so it reads this tick's position).
//
// Noise (`noise` op): loudness is the NoiseEvent scale, dB at 1 m from the source. The op carries a
// phase: `windup` (the caster muttering the words), `release` (the cast), `impact` (where it
// lands). Impact noise sounds where the effect lands; release noise at the caster when the cast
// starts; windup noise is `emitSpellNoise(…, 'windup', …)` for the cast-phase system (mw-e06.4)
// to call when a wind-up begins. A phase with no noise op sounds at its school's default
// loudness instead of silence (`SCHOOL_NOISE_DB`; windup is quieter), except the impact of a
// self-delivered spell, which is the release. An op with loudness 0 is silent on purpose.

import type { SpellEntry, SpellSchool } from '@content/index';
import type { EntityId } from '../core/component';
import { defineComponent } from '../core/component';
import type { System, World } from '../core/world';
import { noiseEmitted } from '../noise/events';
import { placementOf } from '../stimulus/placement';
import type { Vec3 } from '../stimulus/shapes';
import { applyStimulus } from '../stimulus/stimulus';
import { SpellDeliveryComponent } from './components';
import { SpellCast, SpellHit } from './events';
import type { SpellPipeline } from './pipeline';
import { SpellProjectileComponent } from './projectile';

type Effect = SpellEntry['effects'][number];
export type SpellLightOp = Extract<Effect, { op: 'light' }>;
export type SpellNoiseOp = Extract<Effect, { op: 'noise' }>;
/** A cast phase a spell can sound in. */
export type NoisePhase = SpellNoiseOp['phase'];

/** Default loudness, dB at 1 m, of a school's release and impact when a spell says nothing. */
export const SCHOOL_NOISE_DB: Readonly<Record<SpellSchool, number>> = Object.freeze({
  fire: 65,
  frost: 50,
  storm: 80,
  arcane: 55,
  illusion: 40,
  alteration: 55,
  conjuration: 60,
  necromancy: 45,
  nature: 45,
  light: 40,
  shadow: 30,
  gravity: 60,
  time: 40,
  somnomancy: 35,
});

/** How much quieter than the release a spell's wind-up is by default, dB. */
export const WINDUP_QUIETER_DB = 20;

/** Height above a caster's placement a caster-attached light shines from, metres. */
export const CASTER_LIGHT_HEIGHT = 1;

/** Loudness of `phase` for `spell`, dB: its noise op for that phase, else the school default. */
export function spellNoiseDb(spell: SpellEntry, phase: NoisePhase): number {
  const op = spell.effects.find(
    (effect): effect is SpellNoiseOp => effect.op === 'noise' && effect.phase === phase,
  );
  if (op !== undefined) return op.loudness;
  const base = SCHOOL_NOISE_DB[spell.school];
  return phase === 'windup' ? Math.max(0, base - WINDUP_QUIETER_DB) : base;
}

/** Emits the NoiseEvent for one phase of a cast (the loudness comes from `spellNoiseDb`). */
export function emitSpellNoise(
  world: World<never>,
  spell: SpellEntry,
  phase: NoisePhase,
  position: Vec3,
  caster: EntityId,
  delivery: EntityId | null = null,
): void {
  const loudness = spellNoiseDb(spell, phase);
  if (loudness <= 0) return;
  world.events.emit(noiseEmitted, {
    tick: world.tick,
    position: { x: position.x, y: position.y, z: position.z },
    loudness,
    kind: 'spell',
    entity: delivery,
    source: caster,
    tags: ['magic', spell.school],
  });
}

/** One light a spell is shining. */
export interface SpellLight {
  readonly caster: EntityId;
  /** The delivery it follows, or null when it follows the caster or stays put. */
  readonly delivery: EntityId | null;
  /** Follows the caster while it is alive. */
  readonly followsCaster: boolean;
  /** Where it shines now, metres. */
  readonly position: Vec3;
  readonly intensity: number;
  readonly radius: number;
  /** First tick it is gone, or null while it lasts as long as its delivery. */
  readonly expiresTick: number | null;
}

/** Every light spells are shining, in creation order (`magic.lights`, on one ledger entity). */
export interface SpellLightLedger {
  readonly entries: readonly SpellLight[];
}
export const SpellLightLedgerComponent = defineComponent<SpellLightLedger>('magic.lights');

function ledgerOf(world: World<never>): readonly [EntityId, SpellLightLedger] {
  let found: readonly [EntityId, SpellLightLedger] | undefined;
  world.query(SpellLightLedgerComponent).forEach((id, ledger) => {
    found ??= [id, ledger];
  });
  if (found === undefined) throw new Error('spell emission is not installed in this world');
  return found;
}

/** The lights spells are shining right now. */
export function spellLights(world: World<never>): readonly SpellLight[] {
  return ledgerOf(world)[1].entries;
}

function addLight(world: World<never>, light: SpellLight): void {
  const [id, ledger] = ledgerOf(world);
  world.set(id, SpellLightLedgerComponent, { entries: [...ledger.entries, light] });
}

const durationTicks = (world: World<never>, seconds: number): number =>
  Math.max(1, Math.round(seconds * world.clock.hz));

/** Where a delivery is: its placement, or the position its projectile flies at. */
function deliveryPosition(world: World<never>, delivery: EntityId): Vec3 | undefined {
  const at =
    placementOf(world, delivery) ?? world.get(delivery, SpellProjectileComponent)?.position;
  return at === undefined ? undefined : { x: at.x, y: at.y, z: at.z };
}

function casterPosition(world: World<never>, caster: EntityId): Vec3 | undefined {
  const at = placementOf(world, caster);
  return at === undefined ? undefined : { x: at.x, y: at.y + CASTER_LIGHT_HEIGHT, z: at.z };
}

/**
 * Wires spell light and noise into a world that has `installSpells`: registers the `light` and
 * `noise` ops on `pipeline`, the light ledger, the cast and hit subscribers, and the system that
 * keeps the lights shining. Install it with the other spell systems, before `stimulusSystem`.
 * Call once at setup, outside a step.
 */
export function installSpellEmission<TInput>(world: World<TInput>, pipeline: SpellPipeline): void {
  const w: World<never> = world;
  world.register(SpellLightLedgerComponent);
  world.add(world.spawn(), SpellLightLedgerComponent, { entries: [] });

  pipeline.ops
    .register('light', (ctx, op) => {
      const detail = { intensity: op.intensity, radius: op.radius, attach: op.attach };
      // A caster light follows from SpellCast, and so does a delivery light on a delivery still in
      // flight; everything else shines where the effect landed.
      if (op.attach === 'caster') return detail;
      if (
        op.attach === 'delivery' &&
        spellLights(ctx.world).some((light) => light.delivery === ctx.delivery)
      ) {
        return detail;
      }
      addLight(ctx.world, {
        caster: ctx.caster,
        delivery: null,
        followsCaster: false,
        position: ctx.point,
        intensity: op.intensity,
        radius: op.radius,
        expiresTick: ctx.world.tick + durationTicks(ctx.world, op.duration),
      });
      return detail;
    })
    // The sound itself comes from the SpellCast and SpellHit subscribers below (they also cover the
    // default loudness); the op only reports that an impact sound was set.
    .register('noise', (_ctx, op) =>
      op.phase === 'impact' ? { loudness: op.loudness } : undefined,
    );

  // Release: the lights that follow the caster or a delivery in flight start, and the cast sounds.
  world.events.on(SpellCast, (cast) => {
    const spell = pipeline.spells(cast.spell);
    if (spell === undefined) return;
    const inFlight = w.isAlive(cast.delivery) && w.has(cast.delivery, SpellDeliveryComponent);
    for (const op of spell.effects) {
      if (op.op !== 'light') continue;
      if (op.attach === 'point') continue;
      const onDelivery = op.attach === 'delivery';
      if (onDelivery && !inFlight) continue;
      const position = onDelivery
        ? deliveryPosition(w, cast.delivery)
        : casterPosition(w, cast.caster);
      if (position === undefined) continue;
      addLight(w, {
        caster: cast.caster,
        delivery: onDelivery ? cast.delivery : null,
        followsCaster: !onDelivery,
        position,
        intensity: op.intensity,
        radius: op.radius,
        expiresTick:
          op.duration > 0 || !onDelivery ? cast.tick + durationTicks(w, op.duration) : null,
      });
    }
    const at = placementOf(w, cast.caster);
    if (at !== undefined) emitSpellNoise(w, spell, 'release', at, cast.caster, cast.delivery);
  });

  // Impact: where it lands, at the spell's impact loudness (a self spell's only sound is its release).
  world.events.on(SpellHit, (hit) => {
    const spell = pipeline.spells(hit.spell);
    if (spell === undefined) return;
    const set = spell.effects.some((e) => e.op === 'noise' && e.phase === 'impact');
    if (!set && spell.delivery.kind === 'self') return;
    emitSpellNoise(w, spell, 'impact', hit.point, hit.caster, hit.delivery);
  });

  const system: System<TInput> = {
    name: 'spell-lights',
    run: ({ tick }) => {
      const [id, ledger] = ledgerOf(w);
      if (ledger.entries.length === 0) return;
      const kept: SpellLight[] = [];
      for (const light of ledger.entries) {
        let next = light;
        if (light.followsCaster) {
          const at = casterPosition(w, light.caster);
          if (at !== undefined) next = { ...next, position: at };
        }
        if (light.delivery !== null) {
          const at = w.isAlive(light.delivery) ? deliveryPosition(w, light.delivery) : undefined;
          if (at !== undefined) {
            next = { ...next, position: at };
          } else {
            // The delivery ended: the light stays where it was, for a tick if it had no duration.
            next = { ...next, delivery: null, expiresTick: light.expiresTick ?? tick + 1 };
          }
        }
        if (next.expiresTick !== null && tick >= next.expiresTick) continue;
        kept.push(next);
        applyStimulus(w, {
          shape: { kind: 'sphere', center: next.position, radius: next.radius },
          element: 'light',
          intensity: next.intensity,
          duration: 0,
          falloff: 'linear',
          source: next.caster,
        });
      }
      w.set(id, SpellLightLedgerComponent, { entries: kept });
    },
  };
  world.addSystem(system);
}
