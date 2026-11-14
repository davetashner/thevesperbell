// Who will talk (mw-e22.9): hostile NPCs refuse unless their dialogue has a parley entry.

import type { DialogueDef } from '../../content/types/dialogue';
import { describe, expect, it } from 'vitest';
import type { EntityId } from '../core/component';
import { World } from '../core/world';
import {
  addInteractable,
  InteractionFocusComponent,
  INTERACTION_COMPONENTS,
  interactionPrompt,
  InteractorComponent,
} from '../interaction/system';
import { MemoryLogicHost } from '../logic';
import { registerWorldProperties } from '../properties/components';
import { PlacementComponent } from '../stimulus/placement';
import { DialogueRuntime } from './runtime';
import { installTalkGate, talkRefusal, WONT_TALK, type TalkRules } from './talk';

const line = (id: string, next?: string) => ({
  id,
  kind: 'line',
  speaker: 'npc',
  text: id,
  ...(next === undefined ? { end: true } : { next }),
});

/** Hostile entries come first; `visited` is no parley (it reads no disposition). */
const guard = {
  id: 'guard',
  speakers: [{ id: 'npc', name: 'Guard' }],
  entries: [
    {
      id: 'parley',
      when: {
        kind: 'all',
        of: [
          { kind: 'disposition', npc: 'npc-guard', op: 'lt', value: -50 },
          { kind: 'gold', op: 'gte', value: 5 },
        ],
      },
      node: 'parley',
    },
    { id: 'default', node: 'hello' },
  ],
  nodes: [line('hello'), line('parley')],
} as unknown as DialogueDef;

const plain = {
  id: 'plain',
  speakers: [{ id: 'npc', name: 'Plain' }],
  entries: [
    { id: 'again', when: { kind: 'gold', op: 'gte', value: 0 }, node: 'hello' },
    { id: 'default', node: 'hello' },
  ],
  nodes: [line('hello')],
} as unknown as DialogueDef;

function runtimeFor(gold: number) {
  const world = new World<never>({ seed: 1 });
  const host = new MemoryLogicHost({ gold, dispositions: { 'npc-guard': -80 } });
  const map = new Map([guard, plain].map((d) => [d.id, d]));
  return new DialogueRuntime({ world, host, dialogues: (id) => map.get(id) });
}

describe('parley entries', () => {
  it('AC-4: a dialogue with a disposition entry that holds can be talked to while hostile', () => {
    expect(runtimeFor(5).canParley('guard', 'npc-guard')).toBe(true);
  });

  it('AC-4: an entry that reads a disposition but does not hold now is no parley', () => {
    expect(runtimeFor(0).canParley('guard', 'npc-guard')).toBe(false);
  });

  it('AC-4: an entry that reads no disposition is no parley, nor is an unknown dialogue', () => {
    const runtime = runtimeFor(0);
    expect(runtime.canParley('plain', 'npc-plain')).toBe(false);
    expect(runtime.canParley('missing', 'npc-plain')).toBe(false);
  });
});

describe('the talk gate', () => {
  const rules = (hostile: boolean, parley: boolean): TalkRules => ({
    talkable: (entity) => (entity === 1 ? { dialogue: 'guard', npc: 'npc-guard' } : undefined),
    hostile: () => hostile,
    canParley: () => parley,
  });

  it('AC-4: a hostile NPC with no hostile entry refuses; others, and non-NPCs, do not', () => {
    expect(talkRefusal(rules(true, false), 1)).toBe(WONT_TALK);
    expect(talkRefusal(rules(true, true), 1)).toBeUndefined();
    expect(talkRefusal(rules(false, false), 1)).toBeUndefined();
    expect(talkRefusal(rules(true, false), 2)).toBeUndefined();
  });

  it('AC-4: the Interact prompt says the NPC will not talk and offers nothing to use', () => {
    const world = registerWorldProperties(new World<never>({ seed: 1 }));
    world.register(...INTERACTION_COMPONENTS, PlacementComponent);
    installTalkGate(world, {
      talkable: () => ({ dialogue: 'guard', npc: 'npc-guard' }),
      hostile: () => true,
      canParley: () => false,
    });
    const actor: EntityId = world.spawn();
    world.add(actor, InteractorComponent, { capabilities: [], items: [] });
    const npc = world.spawn();
    addInteractable(world, npc, { affordances: [{ verb: 'talk' }] }, { x: 0, y: 0, z: 0 });
    world.add(actor, InteractionFocusComponent, { target: npc, score: 1, hold: null });
    expect(interactionPrompt(world, actor)).toMatchObject({
      verb: 'talk',
      available: false,
      reason: WONT_TALK,
    });
  });

  it('a gate is removable, and ignores other verbs', () => {
    const world = registerWorldProperties(new World<never>({ seed: 1 }));
    world.register(...INTERACTION_COMPONENTS, PlacementComponent);
    const off = installTalkGate(world, {
      talkable: () => ({ dialogue: 'guard', npc: 'npc-guard' }),
      hostile: () => true,
      canParley: () => false,
    });
    const actor = world.spawn();
    world.add(actor, InteractorComponent, { capabilities: [], items: [] });
    const npc = world.spawn();
    addInteractable(
      world,
      npc,
      { affordances: [{ verb: 'use' }, { verb: 'talk' }] },
      { x: 0, y: 0, z: 0 },
    );
    world.add(actor, InteractionFocusComponent, { target: npc, score: 1, hold: null });
    expect(interactionPrompt(world, actor)).toMatchObject({ verb: 'use', available: true });
    off();
    expect(interactionPrompt(world, actor)?.options).toMatchObject([
      { verb: 'use', available: true },
      { verb: 'talk', available: true },
    ]);
  });
});
