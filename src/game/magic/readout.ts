// What the e2e (and a curious console user) can read about the player's casting from
// #app[data-spells] (mw-e06.15): the selected and learned spells, mana, how many casts started, what
// they hit (with whether the target is burning now), and how casts were refused. Plain JSON,
// rounded; nothing here feeds back into the sim.

import {
  hotbarOf,
  ManaComponent,
  SPELL_HOTBAR_SLOTS,
  manaOf,
  readProperty,
  CastStarted,
  SpellCast,
  SpellFizzled,
  SpellHit,
  type EntityId,
  type World,
} from '@sim/index';
import type { AimResult } from './aim';
import type { SpellCaster } from './caster';

export interface SpellHitReadout {
  readonly spell: string;
  readonly entity: number | null;
  /** The scene spawn the target came from (a crate's `loose-crate`), when it has one. */
  readonly spawn: string | null;
  /** The target is on fire right now (read live, each time the readout is taken). */
  readonly burning: boolean;
}

export interface SpellReadout {
  readonly selected: string | null;
  readonly learned: readonly string[];
  readonly mana: number | null;
  /** Wind-ups and channels that began (CastStarted) for the player: input-to-cast-start's end. */
  readonly started: number;
  /** Casts that released (SpellCast) for the player. */
  readonly casts: number;
  readonly hits: readonly SpellHitReadout[];
  /** Reasons the sim refused the player's casts, latest last. */
  readonly fizzles: readonly string[];
  /** Casts the controller itself would not send (invalid aim), and the latest reason. */
  readonly refusals: number;
  readonly lastRefusal: string | null;
  /** The hotbar: a spell id (or null) per slot, and the selected slot. */
  readonly hotbar: readonly (string | null)[];
  readonly slot: number | null;
  /** The quick-select wheel, and the sim speed the game runs at. */
  readonly wheel: { readonly open: boolean; readonly highlight: number | null };
  readonly timeScale: number;
  readonly aim: {
    readonly valid: boolean;
    readonly clamped: boolean;
    readonly mode: string;
  } | null;
}

export interface SpellReadoutOptions {
  readonly world: World<never>;
  readonly player: EntityId;
  readonly caster: SpellCaster;
  /** The aim the reticle shows now. */
  readonly aim: () => AimResult | undefined;
  /** The scene spawn id of an entity. */
  readonly spawnOf: (entity: EntityId) => string | null;
  /** The quick-select wheel's state and the loop's time scale. */
  readonly wheel?: () => { readonly open: boolean; readonly highlight: number | null };
  readonly timeScale?: () => number;
}

const MAX_KEPT = 8;

/** Starts collecting; `read()` gives the readout now, `dispose()` stops listening. */
export function attachSpellReadout(options: SpellReadoutOptions): {
  read(): SpellReadout;
  dispose(): void;
} {
  const { world, player, caster, spawnOf } = options;
  let casts = 0;
  let started = 0;
  const hits: { spell: string; entity: EntityId | null }[] = [];
  const fizzles: string[] = [];
  const offs = [
    world.events.on(CastStarted, (cast) => {
      if (cast.caster === player) started += 1;
    }),
    world.events.on(SpellCast, (cast) => {
      if (cast.caster === player) casts += 1;
    }),
    world.events.on(SpellHit, (hit) => {
      if (hit.caster !== player) return;
      hits.push({ spell: hit.spell, entity: hit.target });
      if (hits.length > MAX_KEPT) hits.shift();
    }),
    world.events.on(SpellFizzled, (fizzle) => {
      if (fizzle.caster !== player) return;
      fizzles.push(fizzle.reason);
      if (fizzles.length > MAX_KEPT) fizzles.shift();
    }),
  ];
  return {
    read() {
      const pool = world.isRegistered(ManaComponent) ? manaOf(world, player) : undefined;
      const aim = options.aim();
      return {
        selected: caster.selected ?? null,
        learned: caster.learned(),
        mana: pool === undefined ? null : Math.round(pool.current * 100) / 100,
        started,
        casts,
        hits: hits.map(({ spell, entity }) => ({
          spell,
          entity,
          spawn: entity === null ? null : spawnOf(entity),
          burning:
            entity !== null && world.isAlive(entity) && readProperty(world, entity, 'burning'),
        })),
        fizzles: [...fizzles],
        refusals: caster.refusals,
        lastRefusal: caster.lastRefusal ?? null,
        hotbar:
          hotbarOf(world, player)?.slots ?? Array.from({ length: SPELL_HOTBAR_SLOTS }, () => null),
        slot: hotbarOf(world, player)?.selected ?? null,
        wheel: options.wheel?.() ?? { open: false, highlight: null },
        timeScale: options.timeScale?.() ?? 1,
        aim: aim === undefined ? null : { valid: aim.valid, clamped: aim.clamped, mode: aim.mode },
      };
    },
    dispose() {
      for (const off of offs) off();
    },
  };
}
