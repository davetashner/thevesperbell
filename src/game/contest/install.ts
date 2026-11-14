// Installs the contest runner on a world (mw-opf6) and feeds it the sim events contests score or
// police (src/sim/contest). Built next to the logic host, before any save loads, so a carried or
// loaded save finds the runner (the `contests` save section reads it by `contestsOf`).
//
// - The runner runs over the game's logic host (gold, dispositions, facts), the world's events and a
//   world rng stream; cheats are judged by `PerceptionWitness`.
// - Forwarded here: `spell.cast` for the player's own casts (the cheat at the arm-wrestling table).
//   The table and dice inputs (`armwrestle.push`, `dice.round-won`, `dice.loaded`) come from the
//   contest controller's play input.
// - `update()` advances the rivals and time limits; the game calls it once per sim step.

import type { GameContent } from '@content/index';
import type { ContestEntry } from '@content/types/contest';
import {
  ContestRunner,
  Rng,
  SpellCast,
  type EntityId,
  type LogicHost,
  type World,
} from '@sim/index';
import { npcResolver } from '../conversation/npcs';
import { PerceptionWitness } from './witness';

/** The content's contests, in file order. Content entries are deeply readonly; the runner never writes them. */
export function contestsIn(content: Pick<GameContent, 'all'>): readonly ContestEntry[] {
  return content.all('contest');
}

export interface InstalledContests {
  readonly runner: ContestRunner;
  /** Advances the rivals and time limits to the world's tick: once per sim step. */
  update(): void;
}

export interface ContestInstallOptions {
  readonly contests: readonly ContestEntry[];
  readonly host: LogicHost;
  /** The player's entity; undefined before there is one. */
  readonly player: () => EntityId | undefined;
  /** A creature's content id to its live entity; the world's creatures by default. */
  readonly resolve?: (creature: string) => EntityId | undefined;
}

const installed = new WeakMap<object, InstalledContests>();

/** The runner installed on `world`, if any: the save section and the contest controller read it. */
export function contestsOf(world: object): ContestRunner | undefined {
  return installed.get(world)?.runner;
}

/** Installs the runner on `world`. */
export function installContests(
  world: World<never>,
  options: ContestInstallOptions,
): InstalledContests {
  const { player } = options;
  const witness = new PerceptionWitness(world, {
    player,
    resolve: options.resolve ?? npcResolver(world),
  });
  const runner = new ContestRunner({
    contests: options.contests,
    host: options.host,
    // Not `world.random`: a world stream joins the snapshot and its hash; the runner's own stream is saved
    // with the `contests` section instead.
    rng: Rng.create(world.seed),
    events: world.events,
    perception: witness,
  });
  world.events.on(SpellCast, ({ caster, spell, tick }) => {
    if (caster === player()) runner.record({ name: 'spell.cast', data: { spell }, tick });
  });
  const result: InstalledContests = {
    runner,
    update: () => {
      runner.update(world.tick);
    },
  };
  installed.set(world, result);
  return result;
}
