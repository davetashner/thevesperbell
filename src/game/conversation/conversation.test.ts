// Talking to NPCs in the world (mw-e22.9), against a real world: creatures with a dialogue, the
// Interact verb's event, the dialogue runtime on a memory host, the AI that pauses a talker and the
// events that interrupt a conversation.

import type { BehaviourDef, Frozen } from '@content/index';
import type { DialogueDef } from '@content/types/dialogue';
import {
  AlertStateChanged,
  beginConversing,
  BrainComponent,
  CombatFacingComponent,
  compileBehaviours,
  CreatureComponent,
  DamageApplied,
  DialogueRuntime,
  giveBrain,
  installAi,
  InteractableComponent,
  interacted,
  isConversing,
  MemoryLogicHost,
  PlacementComponent,
  placeEntity,
  registerCreatureComponents,
  writeBlackboard,
  World,
  type DamageResult,
  type EntityId,
} from '@sim/index';
import { describe, expect, it } from 'vitest';
import {
  boxModel,
  CONVERSATION_TEXT,
  dialogueVeto,
  Conversations,
  NPC_HEAD_M,
  TALK_RANGE_M,
  type ConversationOptions,
} from './conversation';

const line = (id: string, next?: string) => ({
  id,
  kind: 'line',
  speaker: 'npc',
  text: `says ${id}`,
  ...(next === undefined ? { end: true } : { next }),
});
const option = (id: string, extra: object = {}) => ({
  id,
  text: id,
  showWhenLocked: false,
  once: false,
  end: true,
  ...extra,
});

/** A line, then a menu of two options that go on and a leaver. */
const chat = {
  id: 'chat',
  speakers: [{ id: 'npc', name: 'Villager' }],
  entries: [{ id: 'default', node: 'hello' }],
  nodes: [
    line('hello', 'menu'),
    {
      id: 'menu',
      kind: 'choice',
      options: [
        option('who', { end: undefined, next: 'who-line' }),
        option('news', { end: undefined, next: 'who-line' }),
        option('locked', { when: { kind: 'gold', op: 'gte', value: 99 }, showWhenLocked: true }),
        option('leave'),
      ],
    },
    line('who-line', 'menu'),
  ],
} as unknown as DialogueDef;

/** An entry that never holds: starting it finds nothing to say. */
const silent = {
  id: 'silent',
  speakers: [{ id: 'npc', name: 'Mute' }],
  entries: [{ id: 'never', when: { kind: 'gold', op: 'gte', value: 99 }, node: 'hello' }],
  nodes: [line('hello')],
} as unknown as DialogueDef;

const idle = {
  id: 'idle',
  schemaVersion: 1,
  tuning: {},
  thinkHz: 10,
  inertia: 0.1,
  initial: 'unaware',
  states: {
    unaware: { transitions: [], timeoutFrom: 'entered', postAlert: false, activities: ['wait'] },
  },
  activities: {
    wait: {
      weight: 1,
      interruptible: true,
      retryAfterS: 1,
      considerations: [],
      steps: [{ do: 'wait', seconds: 100 }],
    },
  },
} as unknown as Frozen<BehaviourDef>;

const DIALOGUES = new Map([chat, silent].map((d) => [d.id, d]));
const DIALOGUE_OF: Record<string, string> = { villager: 'chat', mute: 'silent' };

function setup(options: Partial<ConversationOptions> = {}) {
  const world = new World<never>({ seed: 1 });
  registerCreatureComponents(world);
  world.register(InteractableComponent);
  installAi(world, { behaviours: compileBehaviours([idle]) });
  const player = world.spawn();
  placeEntity(world, player, { x: 0, y: 0, z: 0 }, 0.4);
  const creature = (id: string, at = { x: 0, y: 0, z: 2 }): EntityId => {
    const entity = world.spawn();
    placeEntity(world, entity, at, 0.4);
    world.add(
      entity,
      CombatFacingComponent,
      Object.freeze({ facing: Object.freeze({ x: 0, y: 0, z: 1 }) }),
    );
    world.add(entity, CreatureComponent, {
      origin: { creature: id, at, facing: { x: 0, y: 0, z: 1 } },
      behaviour: 'idle',
      tuning: {},
      needs: {},
    });
    giveBrain(world, entity, { behaviour: 'idle' });
    return entity;
  };
  const host = new MemoryLogicHost({});
  const runtime = new DialogueRuntime({ world, host, dialogues: (id) => DIALOGUES.get(id) });
  const published: string[] = [];
  const shown: unknown[] = [];
  const conversations = new Conversations({
    world,
    player,
    runtime,
    dialogueOf: (id) => DIALOGUE_OF[id],
    publish: (_key, value) => published.push(value),
    show: (model) => shown.push(model),
    ...options,
  });
  const villager = creature('villager');
  const step = (): void => {
    world.step();
    conversations.afterStep();
  };
  /** The player talks to `target`, seen after the step. */
  const talk = (target: EntityId): void => {
    world.events.emit(interacted, { actor: player, target, verb: 'talk', affordance: 0 });
    step();
  };
  const move = (x: number, z: number): void => {
    const at = world.get(player, PlacementComponent);
    if (at === undefined) throw new Error('no player placement');
    world.set(player, PlacementComponent, { ...at, x, z });
  };
  return {
    world,
    player,
    creature,
    villager,
    runtime,
    conversations,
    published,
    shown,
    step,
    talk,
    move,
  };
}

const alertOf = (world: World<never>, entity: EntityId, to: 'alerted' | 'combat' | 'unaware') => {
  world.events.emit(AlertStateChanged, {
    tick: world.tick,
    entity,
    from: 'unaware',
    to,
    cause: 'x',
  });
  world.events.flush();
};

describe('talking to an NPC', () => {
  it('makes a creature with a dialogue talkable, and only that one', () => {
    const { world, villager, creature, step } = setup();
    const stranger = creature('stranger');
    step();
    expect(world.has(villager, InteractableComponent)).toBe(true);
    expect(world.has(stranger, InteractableComponent)).toBe(false);
  });

  it('AC-1: interacting starts the dialogue and puts the NPC in conversation, facing the player', () => {
    const { world, player, villager, conversations, talk, runtime } = setup();
    world.set(villager, CombatFacingComponent, { facing: { x: 1, y: 0, z: 0 } });
    expect(conversations.active).toBe(false);
    talk(villager);
    expect(conversations.active).toBe(true);
    expect(conversations.partner).toBe(villager);
    expect(runtime.view).toMatchObject({ kind: 'line', npc: 'villager', text: 'says hello' });
    expect(isConversing(world, villager)).toBe(true);
    expect(world.get(villager, CombatFacingComponent)?.facing).toEqual({ x: 0, y: 0, z: -1 });
    expect(conversations.readout()).toMatchObject({
      open: true,
      npc: 'villager',
      kind: 'line',
      speaker: 'npc',
      text: 'says hello',
      conversing: true,
    });
    expect(player).toBeGreaterThanOrEqual(0);
  });

  it('ignores another actor, another verb, a target with no dialogue and a second talk', () => {
    const { world, villager, creature, conversations, step, player } = setup();
    const stranger = creature('stranger');
    world.events.emit(interacted, { actor: 999, target: villager, verb: 'talk', affordance: 0 });
    world.events.emit(interacted, { actor: player, target: villager, verb: 'use', affordance: 0 });
    world.events.emit(interacted, { actor: player, target: stranger, verb: 'talk', affordance: 0 });
    world.events.emit(interacted, { actor: player, target: player, verb: 'talk', affordance: 0 });
    step();
    expect(conversations.active).toBe(false);
    world.events.emit(interacted, { actor: player, target: villager, verb: 'talk', affordance: 0 });
    step();
    expect(conversations.active).toBe(true);
    world.events.emit(interacted, { actor: player, target: villager, verb: 'talk', affordance: 0 });
    step();
    expect(conversations.partner).toBe(villager);
  });

  it('AC-5 (sim half): lines and options run the dialogue; ending it returns the NPC to its routine', () => {
    const { world, villager, conversations, talk, runtime } = setup();
    talk(villager);
    expect(conversations.advance()).toBe(true);
    expect(runtime.view).toMatchObject({ kind: 'choice' });
    expect(conversations.advance()).toBe(false); // a choice is not continued
    expect(conversations.choose(9)).toBe(false);
    expect(conversations.choose(2)).toBe(false); // locked
    expect(conversations.choose(0)).toBe(true);
    expect(conversations.advance()).toBe(true);
    expect(conversations.choose(1)).toBe(true);
    conversations.advance();
    expect(isConversing(world, villager)).toBe(true);
    expect(conversations.choose(3)).toBe(true); // leave
    expect(conversations.active).toBe(false);
    expect(isConversing(world, villager)).toBe(false);
    expect(conversations.readout()).toMatchObject({
      open: false,
      npc: null,
      last: { npc: 'villager', reason: 'completed' },
    });
    expect(conversations.choose(0)).toBe(false);
    expect(conversations.advance()).toBe(false);
    expect(conversations.end('x')).toBe(false);
  });

  it('with no entry that holds there is nothing to say and the NPC is left alone', () => {
    const { world, creature, conversations, talk } = setup();
    const mute = creature('mute', { x: 1, y: 0, z: 1 });
    talk(mute);
    expect(conversations.active).toBe(false);
    expect(isConversing(world, mute)).toBe(false);
    expect(conversations.readout().last).toEqual({
      npc: 'mute',
      reason: 'aborted',
      cause: 'no-entry',
    });
  });

  it('publishes the readout when it changes and shows the box', () => {
    const { villager, conversations, talk, published, shown, step } = setup();
    expect(published).toEqual([]);
    talk(villager);
    expect(published).toHaveLength(1);
    expect(JSON.parse(published[0] ?? '')).toMatchObject({ open: true, kind: 'line' });
    step();
    expect(published).toHaveLength(1);
    conversations.advance();
    expect(shown.at(-1)).toMatchObject({
      speaker: '',
      hint: CONVERSATION_TEXT.choice,
      choices: [
        { text: '1. who' },
        { text: '2. news' },
        { text: '3. locked', locked: true },
        { text: '4. leave' },
      ],
    });
  });
});

describe('a world without the Interact verb or creatures', () => {
  it('has nothing to make talkable and nothing to break', () => {
    const world = new World<never>({ seed: 1 });
    const player = world.spawn();
    const runtime = new DialogueRuntime({
      world,
      host: new MemoryLogicHost({}),
      dialogues: () => undefined,
    });
    const bare = new Conversations({ world, player, runtime, dialogueOf: () => undefined });
    bare.afterStep();
    expect(bare.active).toBe(false);
    const noVerb = new World<never>({ seed: 1 });
    registerCreatureComponents(noVerb);
    const other = new Conversations({
      world: noVerb,
      player: noVerb.spawn(),
      runtime,
      dialogueOf: () => 'chat',
    });
    other.afterStep();
    expect(other.active).toBe(false);
  });
});

describe('speaker names', () => {
  it('the readout names the speaker as the game says', () => {
    const { villager, conversations, talk } = setup({
      speakerName: (dialogue, speaker) => `${speaker} of ${dialogue}`,
    });
    talk(villager);
    expect(conversations.readout().speaker).toBe('npc of chat');
  });
});

describe('keys', () => {
  it('take nothing without a conversation', () => {
    const { conversations } = setup();
    expect(conversations.keydown({ code: 'Enter' })).toBe(false);
    expect(conversations.keydown({ code: 'Digit1' })).toBe(false);
  });

  it('Enter or E continues, digits choose, repeats and strangers are handled', () => {
    const { villager, conversations, talk, runtime } = setup();
    talk(villager);
    expect(conversations.keydown({ code: 'KeyW' })).toBe(false);
    expect(conversations.keydown({ code: 'Digit1' })).toBe(true); // a line: ignored, still taken
    expect(runtime.view?.kind).toBe('line');
    expect(conversations.keydown({ code: 'Enter', repeat: true })).toBe(true);
    expect(runtime.view?.kind).toBe('line');
    expect(conversations.keydown({ code: 'KeyE' })).toBe(true);
    expect(runtime.view?.kind).toBe('choice');
    expect(conversations.keydown({ code: 'Numpad1' })).toBe(true);
    expect(runtime.view).toMatchObject({ kind: 'line', text: 'says who-line' });
    expect(conversations.keydown({ code: 'NumpadEnter' })).toBe(true);
    expect(conversations.keydown({ code: 'Digit4' })).toBe(true);
    expect(conversations.active).toBe(false);
  });
});

describe('interruptions', () => {
  it('AC-3: walking further than 6 m ends the conversation, walked-away', () => {
    const { world, villager, conversations, talk, move, step } = setup();
    talk(villager);
    move(0, 2 + TALK_RANGE_M - 0.1);
    step();
    expect(conversations.active).toBe(true);
    move(0, 2 + TALK_RANGE_M + 0.1);
    step();
    expect(conversations.active).toBe(false);
    expect(isConversing(world, villager)).toBe(false);
    expect(conversations.readout().last).toEqual({
      npc: 'villager',
      reason: 'aborted',
      cause: 'walked-away',
    });
  });

  it('AC-3: the range is the option, when given', () => {
    const { villager, conversations, talk, move, step } = setup({ maxDistance: 3 });
    talk(villager);
    move(0, 0.5);
    step();
    expect(conversations.active).toBe(true);
    move(0, -2);
    step();
    expect(conversations.active).toBe(false);
  });

  it('AC-2: another creature turning Alerted or Combat toward the player ends it within the tick, and the NPC resumes', () => {
    for (const to of ['alerted', 'combat'] as const) {
      const { world, creature, villager, conversations, talk, step } = setup();
      const wolf = creature('wolf', { x: 8, y: 0, z: 0 });
      talk(villager);
      alertOf(world, wolf, to);
      step();
      expect(conversations.active).toBe(false);
      expect(isConversing(world, villager)).toBe(false);
      expect(conversations.readout().last).toEqual({
        npc: 'villager',
        reason: 'aborted',
        cause: 'combat',
      });
      // Back under AI control: it thinks again and takes up its routine.
      for (let i = 0; i < 12; i++) step();
      expect(world.get(villager, BrainComponent)?.activity).toBe('wait');
    }
  });

  it('a creature targeting the player ends it; one fighting someone else, calm states and the NPC itself do not', () => {
    const { world, player, creature, villager, conversations, talk, step } = setup();
    const wolf = creature('wolf', { x: 8, y: 0, z: 0 });
    const other = creature('other', { x: -8, y: 0, z: 0 });
    talk(villager);
    alertOf(world, wolf, 'unaware');
    alertOf(world, villager, 'alerted');
    writeBlackboard(world, wolf, { target: other });
    alertOf(world, wolf, 'combat');
    step();
    expect(conversations.active).toBe(true);
    writeBlackboard(world, wolf, { target: player });
    alertOf(world, wolf, 'combat');
    step();
    expect(conversations.active).toBe(false);
    alertOf(world, wolf, 'combat'); // nobody is talking: nothing to end
    step();
  });

  it('a blow on the NPC or the player ends it, one on anybody else does not', () => {
    const { world, player, creature, villager, conversations, talk, step } = setup();
    const wolf = creature('wolf', { x: 8, y: 0, z: 0 });
    const hit = (target: EntityId): void => {
      world.events.emit(DamageApplied, { tick: world.tick, target } as unknown as DamageResult);
      world.events.flush();
    };
    talk(villager);
    hit(wolf);
    step();
    expect(conversations.active).toBe(true);
    hit(villager);
    step();
    expect(conversations.active).toBe(false);
    talk(villager);
    hit(player);
    step();
    expect(conversations.active).toBe(false);
    hit(villager); // nobody is talking
    step();
  });

  it('the NPC going away ends it (gone), as does losing the NPC’s place', () => {
    const { world, villager, conversations, talk, step } = setup();
    talk(villager);
    world.destroy(villager);
    step();
    expect(conversations.active).toBe(false);
    expect(conversations.readout().last).toMatchObject({ cause: 'gone' });
    expect(conversations.focusPoint()).toBeUndefined();
  });

  it('a conversation the runtime lost (a restore) is closed and the NPC released', () => {
    const { world, villager, runtime, conversations, talk, step } = setup();
    talk(villager);
    runtime.abort('restore');
    step();
    expect(conversations.active).toBe(false);
    expect(isConversing(world, villager)).toBe(false);
    expect(conversations.readout().last).toMatchObject({ cause: 'restored' });
  });

  it('releases a conversing NPC nobody is talking to (an orphan after a load)', () => {
    const { world, player, villager, step } = setup();
    beginConversing(world, villager, player);
    expect(isConversing(world, villager)).toBe(true);
    step();
    expect(isConversing(world, villager)).toBe(false);
  });
});

describe('the safety veto', () => {
  it('objects while a conversation runs, and not before, after or without a controller', () => {
    const { villager, conversations, talk } = setup();
    const veto = dialogueVeto(() => conversations);
    expect(veto()).toBeNull();
    talk(villager);
    expect(veto()).toBe('you are in conversation');
    conversations.end('x');
    expect(veto()).toBeNull();
    expect(dialogueVeto(() => undefined)()).toBeNull();
  });
});

describe('framing and the box', () => {
  it('looks at the NPC’s head while talking, and nowhere otherwise', () => {
    const { villager, conversations, talk } = setup();
    expect(conversations.focusPoint()).toBeUndefined();
    talk(villager);
    expect(conversations.focusPoint()).toEqual({ x: 0, y: NPC_HEAD_M, z: 2 });
  });

  it('boxModel is null with no conversation, and numbers the options', () => {
    expect(
      boxModel({
        open: false,
        npc: null,
        kind: null,
        speaker: '',
        text: '',
        choices: [],
        conversing: false,
      }),
    ).toBeNull();
    expect(
      boxModel({
        open: true,
        npc: 'a',
        kind: 'line',
        speaker: 'A',
        text: 'Hi',
        choices: [],
        conversing: true,
      }),
    ).toEqual({ speaker: 'A', text: 'Hi', choices: [], hint: CONVERSATION_TEXT.line });
  });

  it('dispose stops listening and ends a conversation', () => {
    const { world, player, villager, conversations, talk, step } = setup();
    talk(villager);
    conversations.dispose();
    expect(conversations.active).toBe(false);
    expect(isConversing(world, villager)).toBe(false);
    world.events.emit(interacted, { actor: player, target: villager, verb: 'talk', affordance: 0 });
    step();
    expect(conversations.active).toBe(false);
  });
});
