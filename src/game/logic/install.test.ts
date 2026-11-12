import type { QuestDef } from '@content/types/quest';
import { loadQuestFixtureContent } from '@content/test-fixtures';
import {
  addCapabilities,
  addInventory,
  applyLogicEffects,
  CapabilityRegistry,
  hashWorld,
  inventoryOf,
  InventoryRules,
  questRuntimeOf,
  World,
} from '@sim/index';
import { describe, expect, it } from 'vitest';
import { installFactRegistry } from '../facts';
import { gameLogicOf, installGameLogic, questsOf } from './install';

const content = loadQuestFixtureContent();
const inventory = new InventoryRules(content.all('item'));
const capabilities = new CapabilityRegistry(['spell.ember']);

function boot(quests = questsOf(content)) {
  const world = new World<never>({ seed: 9 });
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
    quests,
  });
  return { world, player, logic };
}

describe('installGameLogic (mw-e23.11)', () => {
  it('without quests: no runtime, no declared fact, and the world hashes as it did', () => {
    const plain = new World<never>({ seed: 9 });
    installFactRegistry(plain.facts, content, true);
    const player = plain.spawn();
    addInventory(plain, player, 0);
    addCapabilities(plain, player);
    plain.step();
    const { world, logic } = boot([]);
    expect(logic.quests).toBeUndefined();
    expect(gameLogicOf(world)).toBe(logic);
    expect(gameLogicOf(plain)).toBeUndefined();
    expect(questRuntimeOf(world)).toBeUndefined();
    expect(world.facts.isDeclared('quest.the-captain-below.state')).toBe(false);
    world.step();
    plain.step();
    expect(hashWorld(world)).toBe(hashWorld(plain));
    expect(logic.host.questState('the-captain-below')).toBe('unstarted');
  });

  it('with quests: the runtime is installed and its host serves quest effects', () => {
    const { world, logic } = boot();
    expect(questRuntimeOf(world)).toBe(logic.quests);
    expect(gameLogicOf(world)).toBe(logic);
    expect(logic.quests?.ids()).toContain('the-captain-below');
    const result = applyLogicEffects(
      [{ kind: 'startQuest', quest: 'the-captain-below' }],
      logic.host,
    );
    expect(result).toMatchObject({ ok: true });
    expect(logic.host.questState('the-captain-below')).toBe('active');
    expect(world.facts.get('quest.the-captain-below.state')).toBe('active');
  });

  it('item and capability changes re-evaluate the quests that read them', () => {
    const quest = {
      id: 'item-quest',
      title: 'Items',
      summary: 'Gather.',
      givers: [],
      stages: [],
      objectives: [],
      failures: [],
      startWhen: { kind: 'hasItem', item: 'bellwort-root', count: 2 },
      resolutions: [
        {
          id: 'learned',
          approach: 'other',
          priority: 0,
          journal: 'Learned.',
          when: { kind: 'hasCapability', capability: 'spell.ember' },
        },
      ],
    } as unknown as QuestDef;
    const { world, player, logic } = boot([quest]);
    const state = (): string => logic.host.questState('item-quest');
    expect(state()).toBe('unstarted');
    inventory.add(world, player, 'bellwort-root', 1);
    world.step();
    expect(state()).toBe('unstarted');
    inventory.add(world, player, 'bellwort-root', 1);
    world.step();
    expect(state()).toBe('active');
    inventory.remove(world, player, { defId: 'bellwort-root', count: 2 });
    world.step();
    expect(inventoryOf(world, player)?.items).toHaveLength(0);
    capabilities.grant(world, player, 'spell.ember', 'learned');
    world.step();
    expect(state()).toBe('resolved');
    capabilities.revoke(world, player, 'spell.ember', 'learned');
    world.step();
    expect(state()).toBe('resolved');
  });

  it('a capability learned by an effect resolves the quest in the same step', () => {
    const quest = {
      id: 'ember-quest',
      title: 'Ember',
      summary: 'Learn.',
      givers: [],
      stages: [],
      objectives: [],
      failures: [],
      resolutions: [
        {
          id: 'learned',
          approach: 'other',
          priority: 0,
          journal: 'Learned.',
          when: { kind: 'hasCapability', capability: 'spell.ember' },
        },
      ],
    } as unknown as QuestDef;
    const { world, logic } = boot([quest]);
    applyLogicEffects(
      [
        { kind: 'startQuest', quest: 'ember-quest' },
        { kind: 'learnCapability', capability: 'spell.ember' },
      ],
      logic.host,
    );
    world.step();
    expect(logic.host.questState('ember-quest')).toBe('resolved');
  });

  it('refuses a second runtime on a world', () => {
    const { world, player } = boot();
    expect(() =>
      installGameLogic(world, {
        world,
        player: () => player,
        inventory,
        capabilities,
        quests: questsOf(content),
      }),
    ).toThrow(RangeError);
  });
});
