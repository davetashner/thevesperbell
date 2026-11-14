// The contest runner (mw-e40.5): data-defined contests (src/content/types/contest.ts) played from
// sim events. Everything is deterministic: time is the `tick` the caller passes, randomness is the
// seeded `contest` stream, and nothing reads a clock.
//
//   enter(id, tick)          checks the entry condition and fee, then starts: emits contest.started
//   bet(id, bet)             stakes on the player or agrees to throw the match, until anyone scores
//   record(event)            reports a sim event: scoring rules award points, cheat rules fire
//   update(tick)             rivals with a `pace` score; a time limit ends the contest
//   forfeit(id)              walk away: a graceful loss
//
// Scoring. A rule matches an event by name and the data fields it requires, and awards points to the
// event's `actor` (`player` by default, or a participant id). Placement is by score, then by who
// reached it first (the tick the score last changed); a tie that remains goes to the rival listed
// first, then the player, so the player never wins a dead heat by default.
//
// Cheating. A cheat rule matches an event the player causes, and the creatures in `observedBy` may
// notice it: the first one for which `perception.perceives(watcher, event)` holds catches it, and
// contest.cheatDetected fires. A caught cheat applies its `detected.effects` and, by default,
// disqualifies the player, ending the contest. A cheat nobody perceived costs its `undetected`
// effects when the contest ends. There is no free cheat.
//
// Betting. `onPlayer` stakes gold on the player at fixed odds: a win returns the stake and the
// winnings, anything else loses it. `throwMatch` is the book paying the player to lose: a clean loss
// (lost, or forfeit) applies the `payout` effects; a win or a disqualification applies the `grudge`
// effects instead (the player took the bribe and did not deliver).
//
// Every outcome is one atomic effect batch: outcome effects, uncaught-cheat costs and the bet
// settlement apply together or not at all, and a refusal is reported on contest.ended.

import type { ContestEntry as ContestDef } from '../../content/types/contest';
import type { EventType } from '../core/events';
import { evaluateLogic, applyLogicEffects, logicRegistry } from '../logic';
import type { LogicHost, LogicNode, LogicRegistry, LogicScalar } from '../logic';
import { Rng, type RngState } from '../rng';
import {
  ContestCheatDetected,
  ContestEnded,
  ContestStarted,
  type ContestOutcome,
  type ContestStanding,
} from './events';

/** The player's id in standings and as an event `actor`. */
export const CONTEST_PLAYER = 'player';

/** A sim event as reported to the runner. */
export interface ContestEvent {
  readonly name: string;
  readonly data?: Readonly<Record<string, LogicScalar>>;
  /** Who caused it: `player` (default) or a participant id. */
  readonly actor?: string;
  readonly tick: number;
}

/** Whether a creature noticed an event: the game answers from the perception system. */
export interface ContestPerception {
  perceives(watcher: string, event: ContestEvent): boolean;
}

/** Where contest events are published: `World.events`. */
export interface ContestEventSink {
  emit<T>(type: EventType<T>, payload: T): void;
}

export interface ContestRunnerOptions {
  readonly contests: readonly ContestDef[];
  /** Gold, facts, items and events: the game's logic host. */
  readonly host: LogicHost;
  /** The world's rng; the runner draws from its `contest` stream. */
  readonly rng: Rng;
  readonly events?: ContestEventSink;
  /** Without it nobody ever perceives a cheat. */
  readonly perception?: ContestPerception;
  readonly registry?: LogicRegistry;
}

/** A bet to place: a stake on the player, or an agreement to throw the match. */
export type ContestBet =
  { readonly kind: 'onPlayer'; readonly stake: number } | { readonly kind: 'throw' };

/** A placed bet with what it settles into, fixed when it was placed. */
interface PlacedBet {
  /** Effects when the player wins. */
  readonly onWin: readonly LogicNode[];
  /** Effects on a clean loss (lost, or forfeit). */
  readonly onLoss: readonly LogicNode[];
  /** Effects when disqualified. */
  readonly onDisqualified: readonly LogicNode[];
}

export type ContestAnswer = { readonly ok: true } | { readonly ok: false; readonly reason: string };

interface Score {
  readonly id: string;
  score: number;
  reachedAt: number | null;
}

/** A rival's score, and when it next scores on its own pace. */
interface RivalScore extends Score {
  readonly pace: {
    readonly everyTicks: number;
    readonly points: number;
    readonly spread: number;
  } | null;
  next: number;
}

interface ActiveState {
  readonly startedAt: number;
  readonly player: Score;
  readonly rivals: readonly RivalScore[];
  /** Cheats the player committed, and whether one was caught. */
  readonly cheats: Record<string, { caught: boolean }>;
  bet: PlacedBet | undefined;
  /** Anyone has scored: betting is closed. */
  scored: boolean;
}

/** Plain data for a save: contests in progress, finished results and the rng stream. */
export interface ContestSnapshot {
  readonly active: Readonly<Record<string, ActiveState>>;
  readonly results: Readonly<Record<string, ContestOutcome>>;
  readonly rng: RngState;
}

/** Thrown for an id no contest has: a caller bug, not a game state. */
export class ContestError extends Error {
  override readonly name = 'ContestError';
}

const matches = (
  rule: { readonly event: string; readonly where: Readonly<Record<string, LogicScalar>> },
  event: ContestEvent,
): boolean =>
  rule.event === event.name &&
  Object.entries(rule.where).every(([field, value]) => event.data?.[field] === value);

export class ContestRunner {
  private readonly defs = new Map<string, ContestDef>();
  private readonly active = new Map<string, ActiveState>();
  private readonly results = new Map<string, ContestOutcome>();
  private readonly host: LogicHost;
  private readonly events: ContestEventSink | undefined;
  private readonly perception: ContestPerception | undefined;
  private readonly registry: LogicRegistry;
  private rng: Rng;

  constructor(options: ContestRunnerOptions) {
    for (const def of options.contests) this.defs.set(def.id, def);
    this.host = options.host;
    this.events = options.events;
    this.perception = options.perception;
    this.registry = options.registry ?? logicRegistry;
    this.rng = options.rng.stream('contest');
  }

  private def(id: string): ContestDef {
    const def = this.defs.get(id);
    if (def === undefined) throw new ContestError(`no contest "${id}"`);
    return def;
  }

  private state(id: string): ActiveState | undefined {
    this.def(id);
    return this.active.get(id);
  }

  /** The contest is running. */
  isActive(id: string): boolean {
    return this.state(id) !== undefined;
  }

  /** How the player's last run of the contest ended, if it has. */
  result(id: string): ContestOutcome | undefined {
    this.def(id);
    return this.results.get(id);
  }

  /** Current standings, best first; empty when the contest is not running. */
  standings(id: string): readonly ContestStanding[] {
    const state = this.state(id);
    return state === undefined ? [] : this.rank(state, false);
  }

  /** Whether the player could enter now, and why not. */
  canEnter(id: string): ContestAnswer {
    const def = this.def(id);
    if (this.active.has(id)) return { ok: false, reason: 'already-active' };
    if (def.entry.when !== undefined && !evaluateLogic(def.entry.when, this.host, this.registry))
      return { ok: false, reason: 'not-eligible' };
    if (this.host.gold() < def.entry.fee) return { ok: false, reason: 'cannot-afford' };
    return { ok: true };
  }

  /** Pays the fee, applies the entry effects and starts the contest. */
  enter(id: string, tick: number): ContestAnswer {
    const def = this.def(id);
    const can = this.canEnter(id);
    if (!can.ok) return can;
    const nodes: LogicNode[] = [
      ...(def.entry.fee > 0 ? [{ kind: 'gold', delta: -def.entry.fee }] : []),
      ...(def.entry.effects ?? []),
    ];
    const applied = applyLogicEffects(nodes, this.host, this.registry);
    if (!applied.ok) return { ok: false, reason: `${applied.kind}:${applied.reason}` };
    const rivals = def.participants.map((rival) => ({
      id: rival.id,
      score: 0,
      reachedAt: null,
      pace: rival.pace ?? null,
      next: tick + (rival.pace?.everyTicks ?? 0),
    }));
    this.active.set(id, {
      startedAt: tick,
      player: { id: CONTEST_PLAYER, score: 0, reachedAt: null },
      rivals,
      cheats: {},
      bet: undefined,
      scored: false,
    });
    this.events?.emit(ContestStarted, {
      contest: id,
      participants: def.participants.map((p) => p.id),
    });
    return { ok: true };
  }

  /** Places a bet with the contest's book; open until anyone scores. */
  bet(id: string, bet: ContestBet): ContestAnswer {
    const book = this.def(id).betting;
    const state = this.active.get(id);
    if (state === undefined) return { ok: false, reason: 'not-active' };
    if (state.scored) return { ok: false, reason: 'betting-closed' };
    if (state.bet !== undefined) return { ok: false, reason: 'already-bet' };
    if (bet.kind === 'throw') {
      const offer = book?.throwMatch;
      if (offer === undefined) return { ok: false, reason: 'no-such-bet' };
      state.bet = { onWin: offer.grudge, onLoss: offer.payout, onDisqualified: offer.grudge };
      return { ok: true };
    }
    const offer = book?.onPlayer;
    if (offer === undefined) return { ok: false, reason: 'no-such-bet' };
    if (!Number.isInteger(bet.stake) || bet.stake < offer.minStake || bet.stake > offer.maxStake)
      return { ok: false, reason: 'bad-stake' };
    if (this.host.gold() < bet.stake) return { ok: false, reason: 'cannot-afford' };
    const paid = this.apply([{ kind: 'gold', delta: -bet.stake }]);
    if (paid !== undefined) return { ok: false, reason: paid };
    const winnings = Math.floor((bet.stake * offer.odds.numerator) / offer.odds.denominator);
    state.bet = {
      onWin: [{ kind: 'gold', delta: bet.stake + winnings }],
      onLoss: [],
      onDisqualified: [],
    };
    return { ok: true };
  }

  /** Reports a sim event to every running contest. */
  record(event: ContestEvent): void {
    const actor = event.actor ?? CONTEST_PLAYER;
    for (const [id, state] of [...this.active]) {
      const def = this.def(id);
      for (const rule of def.scoring) {
        if (matches(rule, event)) this.award(state, actor, rule.points, event.tick);
      }
      if (actor === CONTEST_PLAYER && this.cheat(def, state, event)) continue;
      this.checkFinish(def, state);
    }
  }

  /** Advances rivals' paced scoring and time limits to `tick`. */
  update(tick: number): void {
    for (const [id, state] of [...this.active]) {
      const def = this.def(id);
      const running = (): boolean => this.active.get(id) === state;
      for (const rival of state.rivals) {
        const pace = rival.pace;
        while (pace !== null && running() && rival.next <= tick) {
          const extra = pace.spread > 0 ? this.rng.int(0, pace.spread) : 0;
          this.award(state, rival.id, pace.points + extra, rival.next);
          rival.next += pace.everyTicks;
          this.checkFinish(def, state);
        }
      }
      const limit = def.finish.afterTicks;
      if (running() && limit !== undefined && tick - state.startedAt >= limit)
        this.end(def, state, 'finished');
    }
  }

  /** The player gives up: a graceful loss. */
  forfeit(id: string): ContestAnswer {
    const state = this.state(id);
    if (state === undefined) return { ok: false, reason: 'not-active' };
    this.end(this.def(id), state, 'forfeit');
    return { ok: true };
  }

  /** Plain data for a save. */
  serialize(): ContestSnapshot {
    return {
      active: JSON.parse(
        JSON.stringify(Object.fromEntries(this.active)),
      ) as ContestSnapshot['active'],
      results: Object.fromEntries(this.results),
      rng: this.rng.serialize(),
    };
  }

  /** Resumes from `serialize()` output. */
  restore(snapshot: ContestSnapshot): void {
    this.active.clear();
    this.results.clear();
    for (const [id, state] of Object.entries(snapshot.active)) {
      this.def(id);
      this.active.set(id, JSON.parse(JSON.stringify(state)) as ActiveState);
    }
    for (const [id, outcome] of Object.entries(snapshot.results)) this.results.set(id, outcome);
    this.rng = Rng.restore(snapshot.rng);
  }

  private award(state: ActiveState, actor: string, points: number, tick: number): void {
    const entry =
      actor === CONTEST_PLAYER ? state.player : state.rivals.find((r) => r.id === actor);
    if (entry === undefined) return; // not in this contest
    entry.score += points;
    entry.reachedAt = tick;
    state.scored = true;
  }

  /** Handles cheat rules for a player event; true when the contest ended on it. */
  private cheat(def: ContestDef, state: ActiveState, event: ContestEvent): boolean {
    for (const rule of def.cheats) {
      if (!matches(rule, event)) continue;
      if (rule.when !== undefined && !evaluateLogic(rule.when, this.host, this.registry)) continue;
      if (rule.bonusPoints > 0) this.award(state, CONTEST_PLAYER, rule.bonusPoints, event.tick);
      const watcher = rule.observedBy
        .map((creature) => creature.id)
        .find((creature) => this.perception?.perceives(creature, event) === true);
      const record = (state.cheats[rule.id] ??= { caught: false });
      if (watcher === undefined) continue;
      record.caught = true;
      this.events?.emit(ContestCheatDetected, {
        contest: def.id,
        cheat: rule.id,
        watcher,
        disqualified: rule.detected.disqualify,
      });
      const caughtEffects = rule.detected.effects ?? [];
      if (rule.detected.disqualify) {
        this.end(def, state, 'disqualified', caughtEffects);
        return true;
      }
      this.apply(caughtEffects);
    }
    return false;
  }

  private checkFinish(def: ContestDef, state: ActiveState): void {
    const target = def.finish.firstTo;
    if (target !== undefined && [state.player, ...state.rivals].some((s) => s.score >= target))
      this.end(def, state, 'finished');
  }

  private apply(nodes: readonly LogicNode[]): string | undefined {
    const applied = applyLogicEffects(nodes, this.host, this.registry);
    return applied.ok ? undefined : `${applied.kind}:${applied.reason}`;
  }

  /** Standings, best first; a player who is out places below every rival. */
  private rank(state: ActiveState, playerOut: boolean): ContestStanding[] {
    const standing = (row: Score): ContestStanding => ({
      id: row.id,
      score: row.score,
      reachedAt: row.reachedAt,
    });
    const rows = [...state.rivals, state.player].map((row, index) => ({
      index,
      standing: standing(row),
    }));
    const never = Number.MAX_SAFE_INTEGER;
    const before = (a: (typeof rows)[number], b: (typeof rows)[number]): number =>
      b.standing.score - a.standing.score ||
      (a.standing.reachedAt ?? never) - (b.standing.reachedAt ?? never) ||
      a.index - b.index;
    const rivals = rows.slice(0, -1);
    const ranked = playerOut ? [...rivals.sort(before), ...rows.slice(-1)] : rows.sort(before);
    return ranked.map((row) => row.standing);
  }

  private end(
    def: ContestDef,
    state: ActiveState,
    cause: 'finished' | 'forfeit' | 'disqualified',
    caughtEffects: readonly LogicNode[] = [],
  ): void {
    const standings = this.rank(state, cause !== 'finished');
    const placement = standings.findIndex((s) => s.id === CONTEST_PLAYER) + 1;
    const outcome: ContestOutcome =
      cause === 'finished' ? (placement <= def.win.placement ? 'won' : 'lost') : cause;
    const effects = {
      won: def.win.effects,
      lost: def.lose.effects,
      forfeit: def.lose.effects,
      disqualified: def.disqualified?.effects ?? [],
    }[outcome];
    const bet = {
      won: state.bet?.onWin,
      lost: state.bet?.onLoss,
      forfeit: state.bet?.onLoss,
      disqualified: state.bet?.onDisqualified,
    }[outcome];
    const nodes: LogicNode[] = [
      ...caughtEffects,
      ...effects,
      ...def.cheats.flatMap((cheat) =>
        state.cheats[cheat.id]?.caught === false ? cheat.undetected.effects : [],
      ),
      ...(bet ?? []),
    ];
    this.active.delete(def.id);
    this.results.set(def.id, outcome);
    const refused = this.apply(nodes);
    this.events?.emit(ContestEnded, {
      contest: def.id,
      outcome,
      placement,
      score: state.player.score,
      standings,
      ...(refused === undefined ? {} : { refused }),
    });
  }
}
