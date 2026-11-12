// The game's `LogicHost` (mw-e23.11): what dialogue effects, shop conditions and quests run their
// condition and effect batches against, built from the real systems: world facts, the player's pack
// and gold (src/sim/inventory), capabilities, class, the game clock and, once the game has an NPC
// registry, dispositions. One host, one `checkpoint()` composed of every part (`composeCheckpoints`),
// so a batch that gives an item, learns a capability and sets a fact is all or nothing.
//
// Fact writes are buffered while a checkpoint is open and written to the store, as one transaction,
// when the outermost one commits: reads in the batch see them, a rollback just drops them, and
// listeners (the quest runtime among them) never hear of a batch that failed. Items, gold and
// capabilities are written at once and restored on rollback (`inventoryCheckpoint`,
// `capabilityCheckpoint`).
//
// The quest conditions and effects here are inert (`unstarted`, refused): the quest runtime wraps
// this host and serves them (see `installGameLogic`).

import {
  capabilityCheckpoint,
  type CapabilityRegistry,
  composeCheckpoints,
  defineEvent,
  type Dispositions,
  dispositionLogicHost,
  type EntityId,
  type FactReader,
  type FactValue,
  gameClockOf,
  classOf,
  hasCapability,
  inventoryCheckpoint,
  inventoryOf,
  type InventoryRules,
  type LogicCheckpoint,
  type LogicFailure,
  type LogicHost,
  type LogicScalar,
  type World,
} from '@sim/index';

/** A batch's `emit` effect, published once the batch committed. */
export interface LogicEmitted {
  readonly event: string;
  readonly data: Readonly<Record<string, LogicScalar>>;
}

/** A batch's `revealRumor` effect, published once the batch committed. */
export interface RumorRevealed {
  readonly rumor: string;
}

export const logicEmitted = defineEvent<LogicEmitted>('logic.emitted');
export const rumorRevealed = defineEvent<RumorRevealed>('logic.rumorRevealed');

export interface GameLogicHostOptions {
  readonly world: World<never>;
  /** The player's entity; undefined before the player exists (reads are empty, effects refuse). */
  readonly player: () => EntityId | undefined;
  readonly inventory: InventoryRules;
  readonly capabilities: CapabilityRegistry;
  /**
   * Dispositions and the NPC registry's name lookup (mw-e22.4). Without them every NPC reads 0 and
   * refuses changes with `unknown-npc:<name>`, as the DSL documents.
   */
  readonly disposition?: {
    readonly dispositions: Dispositions;
    readonly resolve: (npc: string) => EntityId | undefined;
  };
  /** Data for extension logic kinds (their own systems). */
  readonly services?: Readonly<Record<string, unknown>>;
}

const byCodeUnit = (a: string, b: string): number => Number(a > b) - Number(a < b);

/** The host over `options`' world. Read it fresh each call: it holds no state beyond open batches. */
export function createGameLogicHost(options: GameLogicHostOptions): LogicHost {
  const { world, inventory, capabilities } = options;
  const { facts } = world;
  const NOT_NPC = {
    disposition: () => 0,
    adjustDisposition: (npc: string) => `unknown-npc:${npc}`,
  };
  const npcs =
    options.disposition === undefined
      ? undefined
      : dispositionLogicHost(options.disposition.dispositions, options.disposition.resolve);

  let overlay = new Map<string, FactValue>();
  const open: Map<string, FactValue>[] = [];

  const factReader: FactReader = {
    get: (key) => overlay.get(key) ?? facts.get(key),
    entries: (prefix = '') => {
      const merged = new Map(facts.entries(prefix));
      for (const [key, value] of overlay) if (key.startsWith(prefix)) merged.set(key, value);
      return [...merged].sort(([a], [b]) => byCodeUnit(a, b));
    },
  };

  const knownItem = (item: string): boolean => {
    try {
      inventory.def(item);
      return true;
    } catch {
      return false;
    }
  };

  const factCheckpoint = (): LogicCheckpoint => {
    const before = new Map(overlay);
    open.push(before);
    return {
      commit: () => {
        open.pop();
        if (open.length > 0) return;
        const written = overlay;
        overlay = new Map();
        facts.transaction(() => {
          for (const [key, value] of written) facts.set(key, value);
        });
      },
      rollback: () => {
        open.pop();
        overlay = before;
      },
    };
  };

  /** The player and their pack, once both exist. */
  const held = () => {
    const id = options.player();
    const state = id === undefined ? undefined : inventoryOf(world, id);
    return id === undefined || state === undefined ? undefined : { id, state };
  };
  const actor = (): EntityId | undefined => held()?.id;

  return {
    facts: factReader,
    services: options.services,
    itemCount: (item) => {
      const id = actor();
      return id === undefined || !knownItem(item) ? 0 : inventory.count(world, id, { defId: item });
    },
    hasCapability: (capability) => {
      const id = options.player();
      return id !== undefined && hasCapability(world, id, capability);
    },
    playerClass: () => {
      const id = options.player();
      return id === undefined ? undefined : classOf(world, id);
    },
    disposition: (npc) => (npcs ?? NOT_NPC).disposition(npc),
    questState: () => 'unstarted',
    objectiveState: () => 'inactive',
    gold: () => {
      return held()?.state.gold ?? 0;
    },
    minuteOfDay: () => gameClockOf(world)?.timeOfDay() ?? 0,

    checkpoint: () => {
      const id = actor();
      return composeCheckpoints(
        factCheckpoint(),
        ...(id === undefined
          ? []
          : [inventoryCheckpoint(world, id), capabilityCheckpoint(world, id)]),
        ...(options.disposition === undefined
          ? []
          : [options.disposition.dispositions.checkpoint()]),
      );
    },
    setFact: (key, value) => {
      const problem = facts.restoreProblem(key, value);
      if (problem !== undefined) {
        return problem === 'undeclared' ? `unknown-fact:${key}` : `invalid-fact:${key}`;
      }
      if (open.length === 0) facts.set(key, value);
      else overlay.set(key, value);
      return undefined;
    },
    giveItem: (item, count) => {
      const id = actor();
      if (id === undefined) return 'no-player';
      if (!knownItem(item)) return `unknown-item:${item}`;
      const result = inventory.add(world, id, item, count);
      return result.ok ? undefined : `${result.reason}:${item}`;
    },
    takeItem: (item, count) => {
      const id = actor();
      if (id === undefined) return 'no-player';
      if (!knownItem(item)) return `unknown-item:${item}`;
      // Effects may take quest items (ADR-0003): handing one in is what they are for.
      const result = inventory.remove(world, id, { defId: item, count, force: true });
      return result.ok ? undefined : `missing-item:${item}`;
    },
    adjustGold: (delta) => {
      const id = actor();
      if (id === undefined) return 'no-player';
      if (delta > 0) inventory.addGold(world, id, delta);
      else if (delta < 0 && !inventory.spendGold(world, id, -delta)) return 'insufficient-gold';
      return undefined;
    },
    adjustDisposition: (npc, delta) => (npcs ?? NOT_NPC).adjustDisposition(npc, delta),
    startQuest: (quest) => `no-quests:${quest}`,
    completeObjective: (quest) => `no-quests:${quest}`,
    resolveQuest: (quest) => `no-quests:${quest}`,
    failQuest: (quest) => `no-quests:${quest}`,
    learnCapability: (capability): LogicFailure | undefined => {
      const id = options.player();
      if (id === undefined) return 'no-player';
      if (!capabilities.isDefined(capability)) return `unknown-capability:${capability}`;
      try {
        capabilities.grant(world, id, capability, 'learned');
      } catch {
        return `cannot-learn:${capability}`;
      }
      return undefined;
    },
    emit: (event, data) => {
      world.events.emit(logicEmitted, { event, data });
    },
    revealRumor: (rumor) => {
      world.events.emit(rumorRevealed, { rumor });
    },
  };
}
