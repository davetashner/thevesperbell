import type { DialogueDef } from '@content/types/dialogue';
import type { QuestDef } from '@content/types/quest';
import { loadQuestFixtureContent } from '@content/test-fixtures';
import {
  addCapabilities,
  addInventory,
  CapabilityRegistry,
  CreatureComponent,
  CreatureOutcome,
  DialogueRuntime,
  Died,
  DispositionBandChanged,
  InventoryRules,
  inventoryOf,
  volumeEntered,
  World,
  type EntityId,
} from '@sim/index';
import { describe, expect, it } from 'vitest';
import { installFactRegistry } from '../facts';
import { bindQuestObjectives } from './bindings';
import { installGameLogic } from './install';

const content = loadQuestFixtureContent();
const inventory = new InventoryRules(content.all('item'));
const capabilities = new CapabilityRegistry(['spell.ember']);

const ref = (id: string) => ({ id });
const objective = (id: string, kind: string, params: Record<string, unknown>) => ({
  id,
  kind,
  text: id,
  optional: false,
  hidden: false,
  params,
});

/** One active quest whose objectives are `objectives`; nothing resolves it. */
function questOf(objectives: unknown[]): QuestDef {
  return {
    id: 'bindings',
    title: 'Bindings',
    summary: 'S',
    givers: [],
    stages: [],
    objectives,
    failures: [],
    resolutions: [
      {
        id: 'never',
        approach: 'other',
        priority: 0,
        journal: 'Never.',
        when: { kind: 'fact', fact: 'never.happens' },
      },
    ],
  } as unknown as QuestDef;
}

function boot(objectives: unknown[]) {
  const world = new World<never>({ seed: 4 });
  installFactRegistry(world.facts, content, true);
  const player = world.spawn();
  addInventory(world, player, 0);
  addCapabilities(world, player);
  world.register(CreatureComponent);
  world.step();
  const logic = installGameLogic(world, {
    world,
    player: () => player,
    inventory,
    capabilities,
    quests: [questOf(objectives)],
  });
  logic.quests?.startQuest('bindings');
  world.step();
  const state = (id: string): string => logic.host.objectiveState('bindings', id);
  /** Delivers queued events, then runs the quest system. */
  const settle = (): void => {
    world.events.flush();
    world.step();
  };
  const creature = (id: string): EntityId => {
    const entity = world.spawn();
    world.add(entity, CreatureComponent, {
      origin: { creature: id, at: { x: 0, y: 0, z: 0 }, facing: { x: 0, y: 0, z: 1 } },
      behaviour: 'idle',
      tuning: {},
      needs: {},
    });
    return entity;
  };
  return { world, player, logic, state, settle, creature };
}

const removed = objective('gone', 'entityState', {
  creature: ref('goblin-chief'),
  state: 'removed',
});

describe('entityState bindings', () => {
  it('AC-1: removed completes when the chief is killed', () => {
    const t = boot([removed]);
    const chief = t.creature('goblin-chief');
    expect(t.state('gone')).toBe('active');
    t.world.events.emit(Died, { tick: 0, target: chief, killer: null, source: null, tags: [] });
    t.settle();
    expect(t.state('gone')).toBe('complete');
  });

  it('AC-1: removed completes when the chief is befriended into leaving', () => {
    const t = boot([removed]);
    t.world.events.emit(CreatureOutcome, {
      creature: 'goblin-chief',
      state: 'befriended',
      gone: true,
    });
    t.settle();
    expect(t.state('gone')).toBe('complete');
  });

  it('AC-1: removed completes when the chief flees permanently, and when it is subdued', () => {
    const fled = boot([removed]);
    fled.world.events.emit(CreatureOutcome, {
      creature: 'goblin-chief',
      state: 'fled',
      gone: true,
    });
    fled.settle();
    expect(fled.state('gone')).toBe('complete');
    const asleep = boot([removed]);
    asleep.world.events.emit(CreatureOutcome, {
      creature: 'goblin-chief',
      state: 'subdued',
      gone: true,
    });
    asleep.settle();
    expect(asleep.state('gone')).toBe('complete');
  });

  it('a specific state waits for that state: dead ignores a flee, a flee that returns is not removal', () => {
    const t = boot([
      objective('dead', 'entityState', { creature: ref('goblin-chief'), state: 'dead' }),
      removed,
      objective('fled', 'entityState', { creature: ref('goblin-chief'), state: 'fled' }),
    ]);
    t.world.events.emit(CreatureOutcome, { creature: 'goblin-chief', state: 'fled', gone: false });
    t.settle();
    expect([t.state('dead'), t.state('gone'), t.state('fled')]).toEqual([
      'active',
      'active',
      'complete',
    ]);
    t.world.events.emit(CreatureOutcome, { creature: 'other', state: 'fled', gone: true });
    t.settle();
    expect(t.state('dead')).toBe('active');
  });

  it('befriended completes when the creature warms to friendly, not before', () => {
    const t = boot([
      objective('friend', 'entityState', { creature: ref('goblin-chief'), state: 'befriended' }),
    ]);
    const chief = t.creature('goblin-chief');
    const change = (bandBefore: string, bandAfter: string) => {
      t.world.events.emit(DispositionBandChanged, {
        tick: 0,
        entity: chief,
        before: 0,
        after: 0,
        delta: 0,
        cause: 'test',
        stanceBefore: 'neutral',
        stanceAfter: 'neutral',
        bandBefore,
        bandAfter,
      } as never);
    };
    change('hostile', 'cold');
    t.settle();
    expect(t.state('friend')).toBe('active');
    change('neutral', 'friendly');
    t.settle();
    expect(t.state('friend')).toBe('complete');
  });

  it('an entity that is not a creature (or the world has no creatures) completes nothing', () => {
    const t = boot([removed]);
    t.world.events.emit(Died, { tick: 0, target: t.player, killer: null, source: null, tags: [] });
    t.world.events.emit(DispositionBandChanged, {
      tick: 0,
      entity: t.player,
      bandBefore: 'cold',
      bandAfter: 'devoted',
    } as never);
    t.settle();
    expect(t.state('gone')).toBe('active');
  });
});

describe('enterArea binding', () => {
  const crossing = (entity: EntityId, node: string, graphId = 'mine') => ({
    graph: 1 as EntityId,
    graphId,
    node,
    entity,
    tick: 0,
  });

  it('AC-3: the player entering the trigger volume completes the objective', () => {
    const t = boot([objective('mine', 'enterArea', { area: 'mine-entrance' })]);
    t.world.events.emit(volumeEntered, crossing(t.creature('wolf'), 'mine-entrance'));
    t.settle();
    expect(t.state('mine')).toBe('active'); // someone else walked in
    t.world.events.emit(volumeEntered, crossing(t.player, 'elsewhere'));
    t.settle();
    expect(t.state('mine')).toBe('active');
    t.world.events.emit(volumeEntered, crossing(t.player, 'mine-entrance'));
    t.settle();
    expect(t.state('mine')).toBe('complete');
  });

  it('an area id may also name the whole graph', () => {
    const t = boot([objective('mine', 'enterArea', { area: 'mine' })]);
    t.world.events.emit(volumeEntered, crossing(t.player, 'any-node', 'mine'));
    t.settle();
    expect(t.state('mine')).toBe('complete');
  });
});

describe('dialogue, capability and event bindings', () => {
  const talk: DialogueDef = {
    id: 'mirela-talk',
    speakers: [{ id: 'npc', name: 'Mirela' }],
    entries: [{ id: 'default', node: 'hello' }],
    nodes: [
      { id: 'hello', kind: 'line', speaker: 'npc', text: 'Hello.', next: 'ask' },
      {
        id: 'ask',
        kind: 'choice',
        options: [
          {
            id: 'hand-over',
            text: 'Here is your ring.',
            showWhenLocked: true,
            once: false,
            when: { kind: 'hasItem', item: 'bellwort-root', count: 1 },
            effects: [{ kind: 'deliverItem', item: 'bellwort-root', npc: 'mirela', count: 1 }],
            end: true,
          },
          {
            id: 'shout',
            text: 'Fire!',
            showWhenLocked: false,
            once: false,
            effects: [{ kind: 'emit', event: 'alarm', data: {} }],
            end: true,
          },
        ],
      },
    ],
  } as unknown as DialogueDef;

  function talking() {
    const t = boot([
      objective('hear', 'talkTo', { npc: ref('mirela') }),
      objective('ask', 'dialogueNode', { dialogue: 'mirela-talk', node: 'ask' }),
      objective('lore', 'learnCapability', { capability: 'spell.ember' }),
      objective('alarm', 'event', { event: 'alarm' }),
      objective('ring', 'deliverItem', {
        item: ref('bellwort-root'),
        npc: ref('mirela'),
        count: 1,
      }),
    ]);
    const dialogue = new DialogueRuntime({
      world: t.world,
      host: t.logic.host,
      dialogues: (id) => (id === 'mirela-talk' ? talk : undefined),
    });
    return { ...t, dialogue };
  }

  it('talkTo and dialogueNode complete from the conversation; other nodes and options do not', () => {
    const t = talking();
    t.dialogue.start('mirela-talk', 'other-npc');
    t.dialogue.advance();
    t.settle();
    expect(t.state('hear')).toBe('active');
    expect(t.state('ask')).toBe('complete');
    t.dialogue.choose(1); // leave through the "shout" option: an option visit is not a node visit
    t.settle();
    t.dialogue.start('mirela-talk', 'mirela');
    t.settle();
    expect(t.state('hear')).toBe('complete');
  });

  it('event completes on the emit effect of a committed batch', () => {
    const t = talking();
    t.dialogue.start('mirela-talk', 'mirela');
    t.dialogue.advance();
    t.dialogue.choose(1);
    t.settle();
    expect(t.state('alarm')).toBe('complete');
  });

  it('learnCapability completes when the capability is gained', () => {
    const t = talking();
    capabilities.grant(t.world, t.player, 'spell.ember', 'learned');
    t.settle();
    expect(t.state('lore')).toBe('complete');
  });

  it('AC-4: without the ring the delivery option is unavailable; with it, handing it over completes the objective', () => {
    const t = talking();
    t.dialogue.start('mirela-talk', 'mirela');
    const view = t.dialogue.advance();
    expect(view).toMatchObject({ kind: 'choice' });
    const options = (view as unknown as { choices: { id: string; locked: boolean }[] }).choices;
    expect(options.find((c) => c.id === 'hand-over')).toMatchObject({ locked: true });
    expect(t.dialogue.choose(0)).toMatchObject({ ok: false });
    t.settle();
    expect(t.state('ring')).toBe('active');
    expect(inventoryOf(t.world, t.player)?.items).toHaveLength(0);

    inventory.add(t.world, t.player, 'bellwort-root', 1);
    const open = (t.dialogue.start('mirela-talk', 'mirela'), t.dialogue.advance());
    const unlocked = (open as unknown as { choices: { id: string; locked: boolean }[] }).choices;
    expect(unlocked.find((c) => c.id === 'hand-over')).toMatchObject({ locked: false });
    expect(t.dialogue.choose(0)).toMatchObject({ ok: true });
    t.settle();
    expect(t.state('ring')).toBe('complete');
    expect(inventoryOf(t.world, t.player)?.items).toHaveLength(0);
  });

  it('a delivery to another NPC, or of another item, or too few, does not complete it', () => {
    const t = boot([
      objective('ring', 'deliverItem', {
        item: ref('bellwort-root'),
        npc: ref('mirela'),
        count: 2,
      }),
    ]);
    const give = (data: Record<string, string | number>) => {
      t.logic.host.emit('item-delivered', data);
      t.settle();
    };
    give({ item: 'bellwort-root', npc: 'mirela', count: 1 });
    give({ item: 'bellwort-root', npc: 'mortimer', count: 2 });
    give({ item: 'key-a', npc: 'mirela', count: 2 });
    expect(t.state('ring')).toBe('active');
    give({ item: 'bellwort-root', npc: 'mirela', count: 2 });
    expect(t.state('ring')).toBe('complete');
  });
});

describe('bindQuestObjectives', () => {
  it('returns the function that unsubscribes every binding; a world without creatures completes nothing on death', () => {
    const world = new World<never>({ seed: 4 });
    installFactRegistry(world.facts, content, true);
    const player = world.spawn();
    addInventory(world, player, 0);
    addCapabilities(world, player);
    world.step();
    const logic = installGameLogic(world, {
      world,
      player: () => player,
      inventory,
      capabilities,
      quests: [questOf([removed])],
    });
    logic.quests?.startQuest('bindings');
    world.step();
    world.events.emit(Died, { tick: 0, target: player, killer: null, source: null, tags: [] });
    world.events.flush();
    world.step();
    expect(logic.host.objectiveState('bindings', 'gone')).toBe('active');
    const stop = bindQuestObjectives(world, logic.quests as never, { player: () => player });
    stop();
    world.events.emit(CreatureOutcome, { creature: 'goblin-chief', state: 'dead', gone: true });
    world.events.flush();
    world.step();
    // Only the binding installed with the logic is left, and it still hears the outcome.
    expect(logic.host.objectiveState('bindings', 'gone')).toBe('complete');
  });
});

describe('events before the objective is active (mw-e23.12)', () => {
  const crossing = (entity: EntityId) => ({
    graph: 1 as EntityId,
    graphId: 'mine',
    node: 'mine-entrance',
    entity,
    tick: 0,
  });
  const talk: DialogueDef = {
    id: 'mirela-talk',
    speakers: [{ id: 'npc', name: 'Mirela' }],
    entries: [{ id: 'default', node: 'hello' }],
    nodes: [{ id: 'hello', kind: 'line', speaker: 'npc', text: 'Hello.', end: true }],
  } as unknown as DialogueDef;

  /** One objective per event-bound kind, all of stage `late`; the quest starts in `early`. */
  function staged() {
    const late = (id: string, kind: string, params: Record<string, unknown>) => ({
      ...objective(id, kind, params),
      stage: 'late',
    });
    const def = {
      ...questOf([
        late('chief', 'entityState', { creature: ref('goblin-chief'), state: 'removed' }),
        late('area', 'enterArea', { area: 'mine-entrance' }),
        late('talk', 'talkTo', { npc: ref('mirela') }),
        late('node', 'dialogueNode', { dialogue: 'mirela-talk', node: 'hello' }),
        late('cap', 'learnCapability', { capability: 'spell.ember' }),
        late('ev', 'event', { event: 'alarm' }),
        late('give', 'deliverItem', { item: ref('bellwort-root'), npc: ref('mirela'), count: 1 }),
      ]),
      stages: [
        {
          id: 'early',
          transitions: [{ when: { kind: 'fact', fact: 'stage.go' }, stage: 'late' }],
        },
        { id: 'late', transitions: [] },
      ],
    } as unknown as QuestDef;
    return { def };
  }

  function start(def: QuestDef) {
    const world = new World<never>({ seed: 4 });
    installFactRegistry(world.facts, content, true);
    world.facts.declare('stage.go', { type: 'bool', default: false });
    const player = world.spawn();
    addInventory(world, player, 0);
    addCapabilities(world, player);
    world.register(CreatureComponent);
    world.step();
    const logic = installGameLogic(world, {
      world,
      player: () => player,
      inventory,
      capabilities,
      quests: [def],
    });
    logic.quests?.startQuest('bindings');
    const settle = (): void => {
      world.events.flush();
      world.step();
    };
    settle();
    return { world, player, logic, settle };
  }

  function happenAll(t: ReturnType<typeof start>) {
    const chief = t.world.spawn();
    t.world.add(chief, CreatureComponent, {
      origin: { creature: 'goblin-chief', at: { x: 0, y: 0, z: 0 }, facing: { x: 0, y: 0, z: 1 } },
      behaviour: 'idle',
      tuning: {},
      needs: {},
    });
    t.world.events.emit(Died, { tick: 0, target: chief, killer: null, source: null, tags: [] });
    t.world.events.emit(volumeEntered, crossing(t.player));
    const dialogue = new DialogueRuntime({
      world: t.world,
      host: t.logic.host,
      dialogues: (id) => (id === 'mirela-talk' ? talk : undefined),
    });
    dialogue.start('mirela-talk', 'mirela');
    dialogue.advance();
    capabilities.grant(t.world, t.player, 'spell.ember', 'learned');
    t.logic.host.emit('alarm', {});
    t.logic.host.emit('item-delivered', { item: 'bellwort-root', npc: 'mirela', count: 1 });
    t.settle();
  }

  const ids = ['chief', 'area', 'talk', 'node', 'cap', 'ev', 'give'];

  it('AC-1: every event-bound kind that happened in an earlier stage completes on activation', () => {
    const t = start(staged().def);
    happenAll(t);
    for (const id of ids) expect(t.logic.host.objectiveState('bindings', id)).toBe('inactive');
    t.world.facts.set('stage.go', true);
    t.settle();
    t.settle();
    for (const id of ids) expect(t.logic.host.objectiveState('bindings', id)).toBe('complete');
  });

  it('AC-2: the remembered events are saved, and complete after a load', () => {
    const def = staged().def;
    const a = start(def);
    happenAll(a);
    const saved = a.world.facts.snapshot();
    const b = start(def);
    b.world.facts.prepareRestore(saved)();
    b.logic.quests?.refresh();
    b.world.facts.set('stage.go', true);
    b.settle();
    b.settle();
    for (const id of ids) expect(b.logic.host.objectiveState('bindings', id)).toBe('complete');
  });

  it('AC-3: a game where nothing happened saves no remembered events', () => {
    const t = start(staged().def);
    expect(Object.keys(t.world.facts.snapshot()).filter((k) => k.includes('.seen.'))).toEqual([]);
  });
});
