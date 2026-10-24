// Spell cooldowns (mw-e06.4): a per-caster ledger of the tick each spell is ready again, and the
// pipeline gate that refuses a recast until then. Following ADR-0007 the whole feature is a
// component, a gate and a helper; the pipeline core knows nothing about cooldowns. A cooldown starts
// when the spell releases (spend), never when it is merely begun or interrupted, and is measured in
// whole ticks (`round(seconds × hz)`: 5 s at 60 Hz is exactly 300 ticks, ready on the 300th).
// Free (scroll) casts never reach the gate, so they neither check nor start a cooldown.

import { defineComponent, type EntityId } from '../core/component';
import type { World } from '../core/world';
import type { CastGate, GateContext } from './pipeline';

/** Reason the gate refuses a recast. */
export const ON_COOLDOWN = 'cooldown';

/** One spell's cooldown on one caster: the first tick it can be cast again. */
export interface CooldownEntry {
  readonly caster: EntityId;
  readonly spell: string;
  readonly readyTick: number;
}

/**
 * Every cooldown running, on one ledger entity (`magic.cooldowns`; structural component changes are
 * deferred inside a tick, so state that changes mid-tick lives in one pre-made component that is
 * replaced, like the status ledger). Finished entries are dropped when the ledger changes.
 */
export interface Cooldowns {
  readonly entries: readonly CooldownEntry[];
}
export const CooldownsComponent = defineComponent<Cooldowns>('magic.cooldowns');

/** The ledger's entity and value; throws when the cast phase is not installed. */
export function cooldownLedger(world: World<never>): readonly [EntityId, Cooldowns] {
  const found: (readonly [EntityId, Cooldowns])[] = [];
  world.query(CooldownsComponent).forEach((id, ledger) => found.push([id, ledger]));
  const first = found[0];
  if (first === undefined) throw new Error('casting is not installed in this world');
  return first;
}

/** Ticks until `spell` can be cast by `caster` again (0 when ready). */
export function cooldownRemaining(world: World<never>, caster: EntityId, spell: string): number {
  const entry = cooldownLedger(world)[1].entries.find(
    (e) => e.caster === caster && e.spell === spell,
  );
  return entry === undefined ? 0 : Math.max(0, entry.readyTick - world.tick);
}

/** Starts (or restarts) `spell`'s cooldown on `caster`: ready again at `readyTick`. */
export function setCooldown(
  world: World<never>,
  caster: EntityId,
  spell: string,
  readyTick: number,
): void {
  const [id, ledger] = cooldownLedger(world);
  const live = ledger.entries.filter(
    (e) => e.readyTick > world.tick && !(e.caster === caster && e.spell === spell),
  );
  world.set(id, CooldownsComponent, {
    entries: Object.freeze([...live, { caster, spell, readyTick }]),
  });
}

/** Ticks in `seconds` of sim time (at least 1 for a positive duration). */
export function secondsToTicks(world: World<never>, seconds: number): number {
  return seconds === 0 ? 0 : Math.max(1, Math.round(seconds * world.clock.hz));
}

/** The cooldown gate for the spell pipeline: check refuses "cooldown", spend starts the cooldown. */
export function cooldownGate(): CastGate {
  return {
    name: 'cooldown',
    check: ({ world, request }: GateContext) =>
      cooldownRemaining(world, request.caster, request.spell) > 0 ? ON_COOLDOWN : undefined,
    spend: ({ world, request, spell }: GateContext) => {
      if (spell.cooldown === 0) return;
      setCooldown(
        world,
        request.caster,
        spell.id,
        world.tick + secondsToTicks(world, spell.cooldown),
      );
    },
  };
}
