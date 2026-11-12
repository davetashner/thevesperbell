// The dialogue runtime across a save (mw-e22.5 AC-6): a conversation that sets a fact and gives an
// item leaves the fact, the item and the visited state in the save, and a production-policy world
// (undeclared facts are dropped on load) keeps the visit counts because the content declares them.
import { loadGameContent } from '@content/index';
import { loadDialogueFixtureContent } from '@content/test-fixtures';
import { dialogueTextKey } from '@content/types/dialogue';
import type { DialogueDef } from '@content/types/dialogue';
import {
  addInventory,
  captureInventories,
  composeCheckpoints,
  DialogueRuntime,
  InventoryComponent,
  inventoryOf,
  InventoryRules,
  MemoryLogicHost,
  World,
  type EntityId,
  type FactValue,
  type LogicCheckpoint,
  type LogicFailure,
} from '@sim/index';
import { describe, expect, it } from 'vitest';
import { installFactRegistry } from '../facts';
import { createGameSaveRegistry } from './sections';

const content = loadGameContent();
const rules = new InventoryRules(content.all('item'));
const item = content.all('item').find((def) => def.category !== 'currency' && def.stackable);
if (item === undefined) throw new Error('expected a stackable item');
const build = { gameVersion: '0.1.0', buildSha: 'deadbee', contentHash: 'c0ffee' };
const saveOptions = { build, wallClockSavedAt: 1_790_000_000_000 };

/** Facts and the player's pack live in the world; the rest of the host is the in-memory reference. */
class WorldHost extends MemoryLogicHost {
  constructor(
    private readonly world: World<never>,
    private readonly player: EntityId,
  ) {
    super();
  }
  override readonly facts = {
    get: (key: string) => this.world.facts.get(key),
    entries: (prefix = '') => this.world.facts.entries(prefix),
  };
  override itemCount(id: string): number {
    return rules.count(this.world, this.player, { defId: id });
  }
  override setFact(key: string, value: FactValue): LogicFailure | undefined {
    this.world.facts.set(key, value);
    return undefined;
  }
  override giveItem(id: string, count: number): LogicFailure | undefined {
    const result = rules.add(this.world, this.player, id, count);
    return result.ok ? undefined : result.reason;
  }
  override checkpoint(): LogicCheckpoint {
    const pack = inventoryOf(this.world, this.player);
    const facts = this.world.facts.snapshot();
    return composeCheckpoints(
      {
        commit: () => undefined,
        rollback: () => {
          if (pack !== undefined) this.world.set(this.player, InventoryComponent, pack);
        },
      },
      {
        commit: () => undefined,
        rollback: () => {
          this.world.facts.prepareRestore(facts)();
        },
      },
    );
  }
}

const dialogue = {
  id: 'quartermaster',
  speakers: [{ id: 'q', name: 'Quartermaster' }],
  entries: [
    {
      id: 'again',
      when: { kind: 'dialogue.visitedCount', id: 'hello', op: 'gte', value: 1 },
      node: 'hello-again',
    },
    { id: 'first', node: 'hello' },
  ],
  nodes: [
    { id: 'hello', kind: 'line', speaker: 'q', text: 'Take this.', next: 'offer' },
    { id: 'hello-again', kind: 'line', speaker: 'q', text: 'You again.', end: true },
    {
      id: 'offer',
      kind: 'choice',
      options: [
        {
          id: 'accept',
          text: 'Thanks.',
          once: true,
          showWhenLocked: false,
          effects: [
            { kind: 'setFact', fact: 'horn.defeated', value: true },
            { kind: 'giveItem', item: item.id, count: 2 },
          ],
          end: true,
        },
      ],
    },
  ],
  // `jump` needs a ContentRef elsewhere; none is used here.
} as unknown as DialogueDef;

function newWorld(production: boolean): { world: World<never>; player: EntityId } {
  const world = new World<never>({ seed: 3, hz: 60 });
  installFactRegistry(world.facts, content, !production);
  const player = world.spawn();
  addInventory(world, player, 0);
  return { world, player };
}

describe('dialogue fixtures run', () => {
  it('AC-1 and AC-4 on the marsh-greeting fixture, with keys matching the content helper', () => {
    const fixtures = loadDialogueFixtureContent();
    const marsh = fixtures.all('dialogue').find((d) => d.id === 'marsh-greeting') as DialogueDef;
    const world = new World<never>({ seed: 1, hz: 60 });
    const runtime = new DialogueRuntime({
      world,
      host: new MemoryLogicHost(),
      dialogues: (id) => (id === marsh.id ? marsh : undefined),
    });
    expect(runtime.start(marsh.id, 'npc-ottilie')).toMatchObject({
      node: 'welcome',
      textKey: dialogueTextKey(marsh.id, 'welcome'),
    });
    runtime.advance();
    const menu = runtime.choices();
    expect(menu[1]?.textKey).toBe(dialogueTextKey(marsh.id, 'menu', 'news'));
    runtime.choose(1);
    runtime.advance();
    runtime.choose(1); // leave (news is gone)
    expect(runtime.start(marsh.id, 'npc-ottilie')).toMatchObject({ node: 'welcome-back' });
    runtime.advance();
    expect(runtime.choices().map((c) => c.id)).toEqual(['browse', 'leave']);
  });
});

describe('dialogue state in a save', () => {
  it('AC-6: the fact, the item and the visited state survive save and load', () => {
    const { world, player } = newWorld(true);
    const runtime = new DialogueRuntime({
      world,
      host: new WorldHost(world, player),
      dialogues: (id) => (id === dialogue.id ? dialogue : undefined),
    });
    runtime.start('quartermaster', 'npc-quartermaster');
    runtime.advance();
    expect(runtime.choose(0)).toMatchObject({ ok: true, view: { kind: 'ended' } });
    expect(world.facts.get('horn.defeated')).toBe(true);

    const bytes = createGameSaveRegistry().write(world, saveOptions);
    const loaded = newWorld(true);
    expect(createGameSaveRegistry().read(loaded.world, bytes).ok).toBe(true);

    expect(loaded.world.facts.get('horn.defeated')).toBe(true);
    expect(captureInventories(world).actors[0]?.inventory?.items).toEqual(
      captureInventories(loaded.world).actors[0]?.inventory?.items,
    );
    expect(rules.count(loaded.world, loaded.player, { defId: item.id })).toBe(2);

    const again = new DialogueRuntime({
      world: loaded.world,
      host: new WorldHost(loaded.world, loaded.player),
      dialogues: (id) => (id === dialogue.id ? dialogue : undefined),
    });
    expect(again.visitCount('npc-quartermaster', 'quartermaster', 'accept')).toBe(1);
    expect(again.start('quartermaster', 'npc-quartermaster')).toMatchObject({
      node: 'hello-again',
    });
  });
});
