// First-blood duels (mw-e39.35, mw-e40.11): a bout between the player and one duellist that ends at
// the first hit either side lands, and that nobody can die in.
//
// - Starting. `start` swaps the duellist's brain for the duel behaviour (the fighting profile:
//   content `behaviour`), keeping its personality and gaits, and remembers the brain it had. The
//   duellist then fights as any creature does: it attacks through the attack executor and the move
//   system, so its swings are telegraphed, parryable and dodgeable.
// - The hit. A damage modifier at the last stage of the pipeline zeroes every hit that passes
//   between the two while the duel is on and tags it `duel` (a blow in a duel is no assault: the
//   disposition rules ignore it), so a first hit costs nobody health (no death, no further damage). The first `DamageApplied` between them ends the duel: the victor is whoever struck.
//   A swing already in flight when the duel ends stays harmless for DUEL_GRACE_S more seconds.
// - Ending. The duellist gets its old brain back (it yields and goes back to its counter) and
//   `DuelEnded` is emitted with the victor: `player`, `duellist`, or `none` when the duel was
//   abandoned (`abandon`, or the duellist is gone). Writing facts is the game's job (src/game/duel).
//
// Pure sim: no clock, no randomness; one duel at a time.

import type { EntityId } from '../core/component';
import { defineEvent } from '../core/events';
import type { World } from '../core/world';
import { brainOf, giveBrain } from '../ai/runtime';
import { DamageApplied } from '../combat/damage/events';
import { HealthComponent } from '../combat/damage/components';
import { scaleDamage, type DamageModel } from '../combat/damage/model';
import { DAMAGE_TAGS } from '../combat/damage/packet';

/** How long, seconds, hits between the pair stay harmless after the duel ends (a swing in flight). */
export const DUEL_GRACE_S = 2.5;

/** Who won a duel: the player, the duellist, or nobody (abandoned). */
export type DuelVictor = 'player' | 'duellist' | 'none';

/** Payload of DuelEnded. */
export interface DuelEndedInfo {
  readonly tick: number;
  readonly player: EntityId;
  readonly duellist: EntityId;
  readonly victor: DuelVictor;
}

/** A duel ended (the first hit landed, or it was abandoned). */
export const DuelEnded = defineEvent<DuelEndedInfo>('duel.ended');

/** The pair in a duel. */
export interface DuelPair {
  readonly player: EntityId;
  readonly duellist: EntityId;
}

interface Running extends DuelPair {
  /** The brain to give back. */
  readonly behaviour: string;
  readonly traits: Readonly<Record<string, number>>;
  readonly gaits: { sneak: number; walk: number; run: number };
}

/** The duel engine of one world. Build it once, after the damage model. */
export class FirstBloodDuels {
  readonly #world: World<never>;
  readonly #behaviour: string;
  #running: Running | undefined;
  #quiet: { pair: DuelPair; until: number } | undefined;

  /**
   * `behaviour` is the id of the duel behaviour the duellist fights with (it must be compiled into
   * the world's AI). Registers its damage modifier on `damage`.
   */
  constructor(world: World<never>, damage: DamageModel, behaviour: string) {
    this.#world = world;
    this.#behaviour = behaviour;
    damage.register({
      name: 'first-blood-duel',
      stage: 'armor',
      apply: (hit, ctx) =>
        this.#between(ctx.target, ctx.packet.instigator, ctx.tick)
          ? {
              ...hit,
              amounts: scaleDamage(hit.amounts, 0),
              staminaDamage: 0,
              tags: [...hit.tags, DAMAGE_TAGS.duel],
            }
          : undefined,
    });
    world.events.on(DamageApplied, ({ target, packet }) => {
      const running = this.#running;
      if (running === undefined || !this.#pairHit(running, target, packet.instigator)) return;
      this.#end(target === running.duellist ? 'player' : 'duellist', running);
    });
  }

  /** The duel in progress, if any. */
  get active(): DuelPair | undefined {
    const running = this.#running;
    return running === undefined
      ? undefined
      : { player: running.player, duellist: running.duellist };
  }

  /**
   * Begins a duel. Returns false (and changes nothing) when one is on already or the duellist has
   * no brain or is dead.
   */
  start(player: EntityId, duellist: EntityId): boolean {
    if (this.#running !== undefined) return false;
    const brain = brainOf(this.#world, duellist);
    const health = this.#world.get(duellist, HealthComponent);
    if (brain === undefined || (health !== undefined && health.current <= 0)) return false;
    this.#running = {
      player,
      duellist,
      behaviour: brain.behaviour,
      traits: { ...brain.traits },
      gaits: { ...brain.gaits },
    };
    giveBrain(this.#world, duellist, {
      behaviour: this.#behaviour,
      traits: brain.traits,
      gaits: brain.gaits,
    });
    return true;
  }

  /** Ends the duel without a victor. Returns whether one was on. */
  abandon(): boolean {
    const running = this.#running;
    if (running === undefined) return false;
    this.#end('none', running);
    return true;
  }

  /** Call once per step: a duel whose duellist is gone is abandoned. */
  update(): void {
    const running = this.#running;
    if (running !== undefined && this.#world.get(running.duellist, HealthComponent) === undefined) {
      this.#end('none', running);
    }
  }

  #pairHit(pair: DuelPair, target: EntityId, instigator: EntityId | null): boolean {
    return (
      (target === pair.duellist && instigator === pair.player) ||
      (target === pair.player && instigator === pair.duellist)
    );
  }

  /** Whether a hit from `instigator` on `target` is between the pair of a live or just-ended duel. */
  #between(target: EntityId, instigator: EntityId | null, tick: number): boolean {
    const running = this.#running;
    if (running !== undefined) return this.#pairHit(running, target, instigator);
    const quiet = this.#quiet;
    return (
      quiet !== undefined && tick < quiet.until && this.#pairHit(quiet.pair, target, instigator)
    );
  }

  /** Ends the running duel (callers check there is one). */
  #end(victor: DuelVictor, running: Running): void {
    this.#running = undefined;
    const pair = { player: running.player, duellist: running.duellist };
    const hz = this.#world.clock.hz;
    this.#quiet = { pair, until: this.#world.tick + Math.round(DUEL_GRACE_S * hz) };
    if (brainOf(this.#world, running.duellist) !== undefined) {
      giveBrain(this.#world, running.duellist, {
        behaviour: running.behaviour,
        traits: running.traits,
        gaits: running.gaits,
      });
    }
    this.#world.events.emit(DuelEnded, { tick: this.#world.tick, ...pair, victor });
  }
}
