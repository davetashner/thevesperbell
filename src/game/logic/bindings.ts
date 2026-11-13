// Binds quest objective kinds to world events (mw-e23.3). A quest objective is satisfied by any
// means that produces its event: the guard killed by a sword, put to sleep or dropped through a
// trapdoor all end the creature, and the objective asks about the end, not the method.
//
// The runtime already completes `fact` objectives from facts and `haveItem` objectives from the
// inventory (it re-evaluates when `notifyItem` fires). This file covers the kinds that are one-shot
// happenings, by reporting each happening to `QuestRuntime.observe`, which is idempotent:
//   enterArea        the player enters a trigger volume whose node id (or graph id) is the area
//   talkTo           a dialogue with the NPC starts
//   dialogueNode     the node of the dialogue is visited
//   learnCapability  the capability is gained
//   event            a batch's `emit` effect publishes the named event
//   deliverItem      a `deliverItem` effect hands the NPC the item (`ITEM_DELIVERED_EVENT`)
//   entityState      the creature dies (`Died`), is befriended (disposition band), or an emitter
//                    publishes `CreatureOutcome`; `removed` completes on any outcome that leaves
//                    it gone, so stealth, diplomacy and magic count as much as a sword
// An objective that is not active yet when its event happens remembers it in a saved fact
// (`QuestRuntime.observe`, mw-e23.12) and completes when it becomes active, as facts and items do.

import type { QuestObjective } from '@content/types/quest';
import {
  CreatureComponent,
  CreatureOutcome,
  capabilityGained,
  DialogueNodeVisited,
  DialogueStarted,
  DispositionBandChanged,
  Died,
  ITEM_DELIVERED_EVENT,
  NPC_BANDS,
  volumeEntered,
  type EntityId,
  type QuestRuntime,
  type World,
} from '@sim/index';
import { logicEmitted } from './host';

export interface QuestBindingOptions {
  /** The player's entity: only the player enters areas. */
  readonly player: () => EntityId | undefined;
}

type EntityStateName = Extract<QuestObjective, { kind: 'entityState' }>['params']['state'];

const FRIENDLY = NPC_BANDS.indexOf('friendly');

/** Reports the happening to the runtime: active objectives complete, later ones remember it. */
function complete(runtime: QuestRuntime, matches: (objective: QuestObjective) => boolean): void {
  runtime.observe(matches);
}

/** Subscribes the objective bindings on `world`; returns the function that unsubscribes them. */
export function bindQuestObjectives(
  world: World<never>,
  runtime: QuestRuntime,
  options: QuestBindingOptions,
): () => void {
  const reached = (creature: string, states: readonly EntityStateName[]): void => {
    complete(
      runtime,
      (o) =>
        o.kind === 'entityState' &&
        o.params.creature.id === creature &&
        states.includes(o.params.state),
    );
  };
  const creatureOf = (entity: EntityId): string | undefined =>
    world.isRegistered(CreatureComponent)
      ? world.get(entity, CreatureComponent)?.origin.creature
      : undefined;
  const off = [
    world.events.on(volumeEntered, ({ graphId, node, entity }) => {
      if (entity !== options.player()) return;
      complete(
        runtime,
        (o) => o.kind === 'enterArea' && (o.params.area === node || o.params.area === graphId),
      );
    }),
    world.events.on(DialogueStarted, ({ npc }) => {
      complete(runtime, (o) => o.kind === 'talkTo' && o.params.npc.id === npc);
    }),
    world.events.on(DialogueNodeVisited, ({ dialogue, id, what }) => {
      if (what !== 'node') return;
      complete(
        runtime,
        (o) => o.kind === 'dialogueNode' && o.params.dialogue === dialogue && o.params.node === id,
      );
    }),
    world.events.on(capabilityGained, ({ capability }) => {
      complete(runtime, (o) => o.kind === 'learnCapability' && o.params.capability === capability);
    }),
    world.events.on(logicEmitted, ({ event, data }) => {
      if (event === ITEM_DELIVERED_EVENT) {
        const count = Number(data['count']);
        complete(
          runtime,
          (o) =>
            o.kind === 'deliverItem' &&
            o.params.item.id === data['item'] &&
            o.params.npc.id === data['npc'] &&
            count >= o.params.count,
        );
      }
      complete(runtime, (o) => o.kind === 'event' && o.params.event === event);
    }),
    world.events.on(Died, ({ target }) => {
      const creature = creatureOf(target);
      if (creature !== undefined) reached(creature, ['dead', 'removed']);
    }),
    world.events.on(DispositionBandChanged, ({ entity, bandBefore, bandAfter }) => {
      const creature = creatureOf(entity);
      if (creature === undefined) return;
      if (NPC_BANDS.indexOf(bandBefore) < FRIENDLY && NPC_BANDS.indexOf(bandAfter) >= FRIENDLY) {
        reached(creature, ['befriended']);
      }
    }),
    world.events.on(CreatureOutcome, ({ creature, state, gone }) => {
      reached(creature, gone ? [state, 'removed'] : [state]);
    }),
  ];
  return () => {
    for (const stop of off) stop();
  };
}
