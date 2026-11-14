// The contest screens and play input (mw-opf6): the glue between the contest runner
// (src/sim/contest), content's contests and the UI (src/ui/contest-window.ts).
//
// Starting. A contest opens its entry window (fee, odds, the throw-the-match offer) when
//   - the player talks to Oona and asks for a match: her dialogue emits `armwrestle.requested`
//     (CONTEST_REQUESTS maps the request to a contest), or
//   - the player uses a scene spawn tagged `contest:<id>` (the Drowned Gull's dice table).
// A request waits until no other screen is open (the conversation closes first). Pressing Enter
// pays the fee (`enter`), places the chosen bet and starts play.
//
// Playing. The sim keeps running (rivals score on their pace) while a small panel shows the
// standings. The play input is the smallest playable one, owned here and reported to the runner:
//   - arm-wrestling (a contest scoring `armwrestle.push`): press PUSH_KEY, PRESSES_PER_PUSH times to
//     gain a push, and the runner scores it.
//   - dice (a contest scoring `dice.round-won`): press PUSH_KEY to roll against the house; a higher
//     roll wins the round (a seeded `contest-dice` stream, so a replayed seed rolls the same).
//     CHEAT_KEY slips in a loaded die (`dice.loaded`), if the contest has that cheat.
//   - LEAVE_KEY, or walking WALK_AWAY_METRES from where it began, forfeits.
// Casting is the arm-wrestling cheat; it is forwarded from the sim (install.ts), not read here.
//
// Ending. The runner applies the outcome (prize, dispositions, bet) and emits `contest.ended`; the
// panel closes and a toast says how it went. `#app[data-contest]` (JSON) is the e2e's readout.

import type { ContestEntry } from '@content/types/contest';
import {
  ContestEnded,
  interacted,
  Rng,
  SceneSpawnComponent,
  type ContestAnswer,
  type ContestRunner,
  type EntityId,
  type LogicHost,
  type Vec3,
  type World,
} from '@sim/index';
import {
  ContestHud,
  openContestWindow,
  type ContestChoice,
  type ContestHudModel,
  type ContestWindow,
  type UiRoot,
} from '@ui/index';
import { logicEmitted } from '../logic/host';

/** Prefix of the scene-spawn tag that names the contest a table starts. */
export const CONTEST_TAG = 'contest:';
/** Dialogue `emit` events that ask for a contest (the effect carries no contest id). */
export const CONTEST_REQUESTS: Readonly<Record<string, string>> = Object.freeze({
  'armwrestle.requested': 'drowned-gull-arm-wrestling',
});

/** Keys (KeyboardEvent.code) the play input reads; none is a gameplay binding. */
export const PUSH_KEY = 'KeyF';
export const CHEAT_KEY = 'KeyH';
export const LEAVE_KEY = 'KeyN';
/** PLACEHOLDER tuning: presses of PUSH_KEY that gain one push at the table. */
export const PRESSES_PER_PUSH = 4;
/** How far from where it began the player may stray before the contest is forfeited, metres. */
export const WALK_AWAY_METRES = 8;

export const CONTEST_REFUSALS: Readonly<Record<string, string>> = Object.freeze({
  'cannot-afford': 'You cannot cover the entry fee.',
  'not-eligible': 'They will not have you.',
  'already-active': 'You are already in it.',
});
const NOT_ENOUGH = 'You cannot cover the entry fee and that stake.';

/** How a contest is played. */
type Game = 'armwrestle' | 'dice' | 'none';

export interface ContestControllerOptions {
  readonly ui: UiRoot;
  readonly world: World<never>;
  readonly player: EntityId;
  readonly runner: ContestRunner;
  readonly contests: readonly ContestEntry[];
  /** Gold and facts: the same host the runner pays through. */
  readonly host: LogicHost;
  readonly toast?: (text: string) => void;
  /** Where an entity stands, for walking away. Without it walking away never forfeits. */
  readonly positionOf?: (entity: EntityId) => Vec3 | undefined;
  readonly publish?: (key: string, value: string) => void;
}

/** What the controller reads of a key event. */
export interface ContestKey {
  readonly code: string;
  readonly repeat?: boolean;
}

/** `npc-nell` → `Nell`. */
export function npcName(id: string): string {
  const base = id.replace(/^npc-/, '').replace(/-/g, ' ');
  return base.charAt(0).toUpperCase() + base.slice(1);
}

/** How a contest is played, from what it scores. */
export function gameOf(def: ContestEntry): Game {
  if (def.scoring.some((rule) => rule.event === 'armwrestle.push')) return 'armwrestle';
  if (def.scoring.some((rule) => rule.event === 'dice.round-won')) return 'dice';
  return 'none';
}

/** The crowns an effect batch pays (positive gold deltas). */
function crownsPaid(
  effects: readonly { readonly kind: string; readonly delta?: unknown }[],
): number {
  return effects.reduce(
    (sum, e) =>
      sum + (e.kind === 'gold' && typeof e.delta === 'number' && e.delta > 0 ? e.delta : 0),
    0,
  );
}

const ORDINALS = ['first', 'second', 'third', 'fourth'];

export class ContestController {
  readonly #options: ContestControllerOptions;
  readonly #defs = new Map<string, ContestEntry>();
  readonly #hud = new ContestHud();
  readonly #offs: (() => void)[] = [];
  #pending: string | undefined;
  #window: ContestWindow | undefined;
  /** The contest being played, and what the play input has built up. */
  #playing:
    | {
        readonly id: string;
        presses: number;
        message: string;
        anchor: Vec3 | undefined;
      }
    | undefined;
  #shown = '';
  #rolls = 0;
  #last: string | null = null;

  constructor(options: ContestControllerOptions) {
    this.#options = options;
    const { world, player, runner, ui } = options;
    for (const def of options.contests) this.#defs.set(def.id, def);
    ui.hud.append(this.#hud.element);
    this.#offs.push(
      world.events.on(interacted, ({ actor, target }) => {
        if (actor !== player) return;
        const tag = (world.get(target, SceneSpawnComponent)?.tags ?? []).find((t) =>
          t.startsWith(CONTEST_TAG),
        );
        if (tag !== undefined) this.#pending = tag.slice(CONTEST_TAG.length);
      }),
      world.events.on(logicEmitted, ({ event }) => {
        const id = CONTEST_REQUESTS[event];
        if (id !== undefined) this.#pending = id;
      }),
      world.events.on(ContestEnded, (ended) => {
        this.#ended(ended.contest, ended.outcome, ended.placement, ended.refused);
      }),
    );
    // A contest carried across a transition or loaded from a save carries on.
    for (const id of this.#defs.keys()) {
      if (runner.isActive(id)) this.#playing = { id, presses: 0, message: '', anchor: undefined };
    }
    this.#publish();
  }

  /** The contest being played, if any. */
  get playing(): string | undefined {
    return this.#playing?.id;
  }

  /** Whether the entry window is open. */
  get isOpen(): boolean {
    return this.#window !== undefined;
  }

  /** The entry window, if open. */
  get window(): ContestWindow | undefined {
    return this.#window;
  }

  /** Opens `id`'s entry window unless a screen is open or the player is in a contest. */
  start(id: string): boolean {
    const { ui, runner, world, host } = this.#options;
    const def = this.#defs.get(id);
    if (def === undefined || this.#window !== undefined || ui.top !== undefined) return false;
    if (this.#playing !== undefined) return false;
    const can = runner.canEnter(id);
    if (!can.ok) {
      this.#options.toast?.(CONTEST_REFUSALS[can.reason] ?? can.reason);
      return false;
    }
    const book = def.betting;
    this.#window = openContestWindow(ui, {
      model: {
        name: def.name,
        rules: this.#rules(def),
        fee: def.entry.fee,
        crowns: host.gold(),
        ...(book?.onPlayer !== undefined && {
          bet: {
            book: npcName(book.book.id),
            numerator: book.onPlayer.odds.numerator,
            denominator: book.onPlayer.odds.denominator,
            minStake: book.onPlayer.minStake,
            maxStake: book.onPlayer.maxStake,
          },
        }),
        ...(book?.throwMatch !== undefined && {
          offer: { book: npcName(book.book.id), payout: crownsPaid(book.throwMatch.payout) },
        }),
      },
      onStart: (choice) => this.#begin(def, choice, world.tick),
      onClose: () => {
        this.#window = undefined;
        this.#publish();
      },
    });
    this.#publish();
    return true;
  }

  /** Once per sim step: opens a requested contest, and keeps the panel and the walk-away check. */
  afterStep(): void {
    const pending = this.#pending;
    if (pending !== undefined && this.#options.ui.top === undefined) {
      this.#pending = undefined;
      this.start(pending);
    }
    const playing = this.#playing;
    if (playing === undefined) return;
    this.#watchDistance(playing);
    this.#refresh();
  }

  /** The play keys. Returns true when the key was taken. */
  keydown(event: ContestKey): boolean {
    const playing = this.#playing;
    if (playing === undefined || this.#options.ui.top !== undefined) return false;
    const def = this.#defs.get(playing.id);
    if (def === undefined) return false;
    if (event.code === LEAVE_KEY) {
      if (event.repeat !== true) this.#options.runner.forfeit(playing.id);
      return true;
    }
    if (event.code !== PUSH_KEY && event.code !== CHEAT_KEY) return false;
    if (event.repeat === true) return true;
    const game = gameOf(def);
    if (event.code === CHEAT_KEY) {
      if (this.#loadedDie(def)) this.#cheat(playing);
      else return false;
    } else if (game === 'armwrestle') this.#push(playing);
    else if (game === 'dice') this.#roll(playing);
    else return false;
    this.#refresh();
    return true;
  }

  close(): void {
    this.#window?.close();
  }

  dispose(): void {
    for (const off of this.#offs) off();
    this.close();
    this.#hud.element.remove();
  }

  #loadedDie(def: ContestEntry): boolean {
    return def.cheats.some((cheat) => cheat.event === 'dice.loaded');
  }

  #rules(def: ContestEntry): string {
    const rivals = def.participants.map((p) => p.name).join(', ');
    const target = def.finish.firstTo;
    const how =
      gameOf(def) === 'armwrestle'
        ? `Press ${PUSH_KEY.slice(3)} to push`
        : `Press ${PUSH_KEY.slice(3)} to roll`;
    return `Against ${rivals}. ${target === undefined ? '' : `First to ${String(target)}. `}${how}.`;
  }

  #begin(def: ContestEntry, choice: ContestChoice, tick: number): string | undefined {
    const { runner, host, positionOf, player } = this.#options;
    const stake = choice.kind === 'onPlayer' ? choice.stake : 0;
    if (host.gold() < def.entry.fee + stake) return NOT_ENOUGH;
    const entered = runner.enter(def.id, tick);
    if (!entered.ok) return CONTEST_REFUSALS[entered.reason] ?? entered.reason;
    const placed: ContestAnswer =
      choice.kind === 'none'
        ? { ok: true }
        : runner.bet(
            def.id,
            choice.kind === 'throw' ? { kind: 'throw' } : { kind: 'onPlayer', stake },
          );
    // The fee is paid and the contest is on; a bet the book would not take is only reported.
    if (!placed.ok) this.#options.toast?.(`The bet was not taken (${placed.reason}).`);
    this.#playing = {
      id: def.id,
      presses: 0,
      message: choice.kind === 'throw' ? 'The deal is struck. Do not make it look easy.' : '',
      anchor: positionOf?.(player),
    };
    this.#refresh();
    return undefined;
  }

  #push(playing: { presses: number; message: string; id: string }): void {
    playing.presses += 1;
    if (playing.presses < PRESSES_PER_PUSH) {
      playing.message = 'You strain against the grip.';
      return;
    }
    playing.presses = 0;
    playing.message = 'You gain ground.';
    this.#options.runner.record({ name: 'armwrestle.push', tick: this.#options.world.tick });
  }

  #roll(playing: { message: string }): void {
    // Its own seeded stream per roll (not a world stream, which would join the world's hash).
    const { world } = this.#options;
    const rng = Rng.create((world.seed + world.tick * 31 + this.#rolls++) >>> 0).stream(
      'contest-dice',
    );
    const mine = rng.int(1, 6);
    const theirs = rng.int(1, 6);
    const line = `You roll ${String(mine)} against ${String(theirs)}`;
    if (mine > theirs) {
      playing.message = `${line}: you take the round.`;
      this.#options.runner.record({ name: 'dice.round-won', tick: this.#options.world.tick });
    } else {
      playing.message =
        mine === theirs ? `${line}: a tie, roll again.` : `${line}: the round is theirs.`;
    }
  }

  #cheat(playing: { message: string }): void {
    playing.message = 'You slip a loaded die into the cup.';
    this.#options.runner.record({ name: 'dice.loaded', tick: this.#options.world.tick });
  }

  #watchDistance(playing: { id: string; anchor: Vec3 | undefined }): void {
    const { positionOf, player, runner } = this.#options;
    const at = positionOf?.(player);
    if (at === undefined) return;
    if (playing.anchor === undefined) {
      playing.anchor = at;
      return;
    }
    const metres = Math.hypot(at.x - playing.anchor.x, at.z - playing.anchor.z);
    if (metres > WALK_AWAY_METRES) runner.forfeit(playing.id);
  }

  #model(playing: { id: string; presses: number; message: string }): ContestHudModel | undefined {
    const def = this.#defs.get(playing.id);
    if (def === undefined) return undefined;
    const names = new Map(def.participants.map((p) => [p.id, p.name]));
    const game = gameOf(def);
    const keyName = (code: string): string => code.slice(3);
    return {
      title: def.name,
      rows: this.#options.runner.standings(playing.id).map((s) => ({
        name: s.id === 'player' ? 'You' : (names.get(s.id) ?? s.id),
        score: s.score,
        you: s.id === 'player',
      })),
      ...(def.finish.firstTo !== undefined && { target: def.finish.firstTo }),
      ...(game === 'armwrestle' && {
        meter: { label: 'Grip', value: playing.presses / PRESSES_PER_PUSH },
      }),
      hints: [
        ...(game === 'armwrestle' ? [`${keyName(PUSH_KEY)}: push`] : []),
        ...(game === 'dice' ? [`${keyName(PUSH_KEY)}: roll`] : []),
        ...(this.#loadedDie(def) ? [`${keyName(CHEAT_KEY)}: loaded die`] : []),
        `${keyName(LEAVE_KEY)}: walk away`,
      ],
      message: playing.message,
    };
  }

  #refresh(): void {
    // The runner ends a contest itself (a score, the clock, a caught cheat); `contest.ended` reaches
    // us a flush later, so the panel follows the runner.
    if (this.#playing !== undefined && !this.#options.runner.isActive(this.#playing.id))
      this.#playing = undefined;
    const playing = this.#playing;
    const model = playing === undefined ? undefined : this.#model(playing);
    if (model === undefined) {
      this.#hud.hide();
      this.#shown = '';
    } else {
      const json = JSON.stringify(model);
      if (json !== this.#shown) {
        this.#shown = json;
        this.#hud.show(model);
      }
    }
    this.#publish();
  }

  #ended(id: string, outcome: string, placement: number, refused: string | undefined): void {
    this.#last = `${id}:${outcome}`;
    if (this.#playing?.id === id) this.#playing = undefined;
    this.#refresh();
    const say: Readonly<Record<string, string>> = {
      won: 'You won the contest.',
      lost: `You lost the contest, placing ${ORDINALS[placement - 1] ?? String(placement)}.`,
      disqualified: 'You were caught cheating and are out.',
      forfeit: 'You walked away from the contest.',
    };
    this.#options.toast?.(
      `${say[outcome] ?? outcome}${refused === undefined ? '' : ` (${refused})`}`,
    );
  }

  #publish(): void {
    const playing = this.#playing;
    this.#options.publish?.(
      'contest',
      JSON.stringify({
        playing: playing?.id ?? null,
        open: this.#window !== undefined,
        last: this.#last,
      }),
    );
  }
}
