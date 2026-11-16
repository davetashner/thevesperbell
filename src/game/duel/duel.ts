// The duel in the running game (mw-e39.35, mw-e40.11): the glue between a dialogue's duel request,
// the sim's first-blood duel engine (src/sim/duel) and the facts the dialogue reads back.
//
// - Starting. A dialogue `emit` of a duel event (DUELS: `tereza.duel-start` for Tereza Maelo) asks for
//   a bout. The conversation is still open when it is emitted, so the request waits until no screen is
//   open and the duellist is no longer in conversation, then `start`s the duel against the player and
//   a toast says it has begun. A duellist who is not in the world (another scene) just lets the
//   request lapse.
// - Ending. When the first hit lands the sim emits `DuelEnded`; this writes `<prefix>.fought = true`
//   and `<prefix>.victor = "player"` or the duellist's short name (`tereza`), the facts her `duel-won`
//   and `duel-lost` dialogue entries read, and a toast says whose blood was first. Talking to her
//   again plays the verdict, writes the result and opens (or withholds) the under-the-counter stock.
//   An abandoned duel writes nothing.
// - `afterStep` runs once per sim step: it starts a waiting duel and gives the engine its update.

import {
  DuelEnded,
  isConversing,
  type EntityId,
  type FirstBloodDuels,
  type LogicHost,
  type World,
} from '@sim/index';
import type { UiRoot } from '@ui/index';
import { logicEmitted } from '../logic/host';
import { npcResolver } from '../conversation/npcs';

/** The behaviour a duellist fights with (content `behaviour`, swapped in by the sim's duel engine). */
export const DUEL_BEHAVIOUR = 'duellist';

/** One duel a dialogue can ask for. */
export interface DuelSpec {
  /** The duellist's creature id. */
  readonly npc: string;
  /** The facts the dialogue reads: `<factPrefix>.fought` and `<factPrefix>.victor`. */
  readonly factPrefix: string;
  /** What `<factPrefix>.victor` reads when the duellist lands the first hit. */
  readonly victorName: string;
  /** The toast when the player lands the first hit, and when the duellist does. */
  readonly won: string;
  readonly lost: string;
  /** The toast when the duel begins. */
  readonly begun: string;
}

/** Dialogue `emit` events that ask for a duel. */
export const DUELS: Readonly<Record<string, DuelSpec>> = Object.freeze({
  'tereza.duel-start': {
    npc: 'npc-tereza',
    factPrefix: 'tereza.duel',
    victorName: 'tereza',
    begun: 'First blood: the first clean hit wins. Nobody will be killed.',
    won: 'First blood: yours. Speak to Tereza.',
    lost: 'First blood: hers. Speak to Tereza.',
  },
});

export interface DuelUiOptions {
  readonly ui: UiRoot;
  readonly world: World<never>;
  readonly player: EntityId;
  readonly duels: FirstBloodDuels;
  /** The facts the dialogue reads. */
  readonly host: Pick<LogicHost, 'setFact'>;
  readonly toast: (text: string) => void;
}

/** The duel screens in a running game. */
export interface DuelUi {
  /** Call after every sim step. */
  afterStep(): void;
}

/** Wires dialogue duel requests to the duel engine and its result to facts. */
export function startDuelUi(options: DuelUiOptions): DuelUi {
  const { ui, world, player, duels, host, toast } = options;
  let requested: DuelSpec | undefined;
  let fighting: DuelSpec | undefined;
  world.events.on(logicEmitted, ({ event }) => {
    const spec = DUELS[event];
    if (spec !== undefined) requested = spec;
  });
  world.events.on(DuelEnded, ({ victor }) => {
    const spec = fighting;
    fighting = undefined;
    if (spec === undefined || victor === 'none') return;
    host.setFact(`${spec.factPrefix}.fought`, true);
    host.setFact(`${spec.factPrefix}.victor`, victor === 'player' ? 'player' : spec.victorName);
    toast(victor === 'player' ? spec.won : spec.lost);
  });
  return {
    afterStep: () => {
      duels.update();
      const spec = requested;
      if (spec === undefined || ui.top !== undefined) return;
      const duellist = npcResolver(world)(spec.npc);
      if (duellist !== undefined && isConversing(world, duellist)) return;
      requested = undefined;
      if (duellist !== undefined && duels.start(player, duellist)) {
        fighting = spec;
        toast(spec.begun);
      }
    },
  };
}
