import { loadQuestFixtureContent } from '@content/test-fixtures';
import {
  addCapabilities,
  addInventory,
  applyLogicEffects,
  CapabilityRegistry,
  compileDispositionRules,
  Dispositions,
  hasCapability,
  installFactions,
  installGameClock,
  InventoryRules,
  inventoryOf,
  PlayerClassComponent,
  World,
  type EntityId,
  type LogicNode,
} from '@sim/index';
import { DEFAULT_CLOCK_CONFIG } from '@sim/gametime/config';
import { buildFactionTable } from '@sim/factions/table';
import { describe, expect, it } from 'vitest';
import { installFactRegistry } from '../facts';
import { createGameLogicHost, logicEmitted, rumorRevealed } from './host';

const content = loadQuestFixtureContent();
const inventory = new InventoryRules(content.all('item'));
const capabilities = new CapabilityRegistry(['spell.ember']);

function setup(withDispositions = false) {
  const world = installFactions(new World<never>({ seed: 2 }));
  installFactRegistry(world.facts, content, true);
  installGameClock(world, DEFAULT_CLOCK_CONFIG);
  const player = world.spawn();
  addInventory(world, player, 20);
  addCapabilities(world, player);
  world.register(PlayerClassComponent);
  world.add(player, PlayerClassComponent, { classId: 'knight' });
  const npc = world.spawn();
  world.step();
  const dispositions = withDispositions
    ? new Dispositions(world, {
        factions: buildFactionTable([]),
        rules: compileDispositionRules([]),
      })
    : undefined;
  const host = createGameLogicHost({
    world,
    player: () => player,
    inventory,
    capabilities,
    ...(dispositions !== undefined && {
      disposition: { dispositions, resolve: (name) => (name === 'npc-juniper' ? npc : undefined) },
    }),
  });
  return { world, player, npc, host, dispositions };
}

const apply = (host: ReturnType<typeof setup>['host'], ...effects: LogicNode[]) =>
  applyLogicEffects(effects, host);

describe('game logic host reads (mw-e23.11)', () => {
  it('reads the pack, gold, capabilities, class and clock of the player', () => {
    const { world, player, host } = setup();
    expect(host.itemCount('bellwort-root')).toBe(0);
    inventory.add(world, player, 'bellwort-root', 3);
    expect(host.itemCount('bellwort-root')).toBe(3);
    expect(host.itemCount('no-such-item')).toBe(0);
    expect(host.gold()).toBe(20);
    expect(host.hasCapability('spell.ember')).toBe(false);
    capabilities.grant(world, player, 'spell.ember', 'learned');
    expect(host.hasCapability('spell.ember')).toBe(true);
    expect(host.playerClass()).toBe('knight');
    expect(host.minuteOfDay()).toBe(world.facts.get('clock.minute') ?? host.minuteOfDay());
    expect(host.questState('any')).toBe('unstarted');
    expect(host.objectiveState('any', 'o')).toBe('inactive');
  });

  it('reads empty before the player exists, and refuses every player effect', () => {
    const world = new World<never>({ seed: 2 });
    installFactRegistry(world.facts, content, true);
    const host = createGameLogicHost({ world, player: () => undefined, inventory, capabilities });
    expect(host.itemCount('bellwort-root')).toBe(0);
    expect(host.gold()).toBe(0);
    expect(host.hasCapability('spell.ember')).toBe(false);
    expect(host.playerClass()).toBeUndefined();
    expect(host.minuteOfDay()).toBe(0);
    expect(host.giveItem('bellwort-root', 1)).toBe('no-player');
    expect(host.takeItem('bellwort-root', 1)).toBe('no-player');
    expect(host.adjustGold(1)).toBe('no-player');
    expect(host.learnCapability('spell.ember')).toBe('no-player');
    const checkpoint = host.checkpoint();
    checkpoint.rollback();
  });

  it('a player without a pack reads as none', () => {
    const world = new World<never>({ seed: 2 });
    installFactRegistry(world.facts, content, true);
    const bare = world.spawn();
    const host = createGameLogicHost({ world, player: () => bare, inventory, capabilities });
    expect(host.gold()).toBe(0);
    expect(host.giveItem('bellwort-root', 1)).toBe('no-player');
  });

  it('reads facts through open batches, in key order', () => {
    const { world, host } = setup();
    world.facts.set('fixture-boots.noticed', true);
    const checkpoint = host.checkpoint();
    expect(host.setFact('fixture-boots.night-followed', true)).toBeUndefined();
    expect(host.facts.get('fixture-boots.night-followed')).toBe(true);
    expect(world.facts.get('fixture-boots.night-followed')).toBe(false);
    expect(host.facts.entries('fixture-boots.').map(([key]) => key)).toEqual([
      'fixture-boots.night-followed',
      'fixture-boots.noticed',
    ]);
    expect(host.facts.entries('nothing.')).toEqual([]);
    checkpoint.commit();
    expect(world.facts.get('fixture-boots.night-followed')).toBe(true);
    expect(host.facts.entries().length).toBeGreaterThan(1);
  });
});

describe('game logic host effects (mw-e23.11)', () => {
  it('gives and takes items, pays and earns gold, and learns capabilities', () => {
    const { world, player, host } = setup();
    expect(
      apply(
        host,
        { kind: 'giveItem', item: 'bellwort-root', count: 2 },
        { kind: 'gold', delta: -5 },
        { kind: 'learnCapability', capability: 'spell.ember' },
        { kind: 'gold', delta: 7 },
        { kind: 'setFact', fact: 'fixture-boots.noticed', value: true },
      ),
    ).toEqual({ ok: true, applied: 5 });
    expect(inventoryOf(world, player)?.gold).toBe(22);
    expect(host.itemCount('bellwort-root')).toBe(2);
    expect(hasCapability(world, player, 'spell.ember')).toBe(true);
    expect(world.facts.get('fixture-boots.noticed')).toBe(true);
    expect(apply(host, { kind: 'takeItem', item: 'bellwort-root', count: 2 })).toMatchObject({
      ok: true,
    });
    expect(host.itemCount('bellwort-root')).toBe(0);
    expect(host.adjustGold(0)).toBeUndefined();
  });

  it('refuses with a reason: unknown, missing, short or malformed', () => {
    const { host } = setup();
    expect(host.giveItem('no-such-item', 1)).toBe('unknown-item:no-such-item');
    expect(host.takeItem('no-such-item', 1)).toBe('unknown-item:no-such-item');
    expect(host.takeItem('bellwort-root', 1)).toBe('missing-item:bellwort-root');
    expect(host.giveItem('apple', 10_000)).toBe('stack-limit:apple');
    expect(host.adjustGold(-21)).toBe('insufficient-gold');
    expect(host.learnCapability('no.such.capability')).toBe(
      'unknown-capability:no.such.capability',
    );
    expect(host.setFact('no.such.fact', true)).toBe('unknown-fact:no.such.fact');
    expect(host.setFact('fixture-boots.noticed', 'yes')).toBe('invalid-fact:fixture-boots.noticed');
    expect(host.startQuest('q')).toBe('no-quests:q');
    expect(host.completeObjective('q', 'o')).toBe('no-quests:q');
    expect(host.resolveQuest('q', undefined)).toBe('no-quests:q');
    expect(host.failQuest('q')).toBe('no-quests:q');
  });

  it('refuses a capability the player has no set for', () => {
    const { world, host } = setup();
    const bare = world.spawn();
    addInventory(world, bare, 0);
    world.step();
    const other = createGameLogicHost({ world, player: () => bare, inventory, capabilities });
    expect(other.learnCapability('spell.ember')).toBe('cannot-learn:spell.ember');
    expect(host.learnCapability('spell.ember')).toBeUndefined();
  });

  it('a batch that refuses undoes the earlier effects: facts, pack, gold and capabilities', () => {
    const { world, player, host } = setup();
    const result = apply(
      host,
      { kind: 'giveItem', item: 'bellwort-root', count: 2 },
      { kind: 'gold', delta: -5 },
      { kind: 'learnCapability', capability: 'spell.ember' },
      { kind: 'setFact', fact: 'fixture-boots.noticed', value: true },
      { kind: 'takeItem', item: 'apple', count: 1 },
    );
    expect(result).toMatchObject({ ok: false, index: 4, reason: 'missing-item:apple' });
    expect(inventoryOf(world, player)).toMatchObject({ gold: 20, items: [] });
    expect(hasCapability(world, player, 'spell.ember')).toBe(false);
    expect(world.facts.get('fixture-boots.noticed')).toBe(false);
    expect(host.facts.get('fixture-boots.noticed')).toBe(false);
  });

  it('nested checkpoints: an inner rollback keeps the outer writes, the outer commit flushes', () => {
    const { world, host } = setup();
    const outer = host.checkpoint();
    host.setFact('fixture-boots.noticed', true);
    const inner = host.checkpoint();
    host.setFact('fixture-boots.night-followed', true);
    inner.rollback();
    expect(host.facts.get('fixture-boots.night-followed')).toBe(false);
    const inner2 = host.checkpoint();
    host.setFact('fixture-boots.tea-given', true);
    inner2.commit();
    expect(world.facts.get('fixture-boots.tea-given')).toBe(false);
    outer.commit();
    expect(world.facts.get('fixture-boots.noticed')).toBe(true);
    expect(world.facts.get('fixture-boots.tea-given')).toBe(true);
  });

  it('a fact written with no batch open is written at once', () => {
    const { world, host } = setup();
    expect(host.setFact('fixture-boots.noticed', true)).toBeUndefined();
    expect(world.facts.get('fixture-boots.noticed')).toBe(true);
  });

  it('publishes emit and rumor effects after the batch commits', () => {
    const { world, host } = setup();
    const heard: string[] = [];
    world.events.on(logicEmitted, ({ event, data }) => heard.push(`${event}:${String(data['n'])}`));
    world.events.on(rumorRevealed, ({ rumor }) => heard.push(`rumor:${rumor}`));
    host.emit('bell.rang', { n: 3 });
    host.revealRumor('captain-boots');
    world.step();
    expect(heard).toEqual(['bell.rang:3', 'rumor:captain-boots']);
  });
});

describe('game logic host dispositions (mw-e23.11)', () => {
  it('without dispositions every NPC reads 0 and refuses', () => {
    const { host } = setup();
    expect(host.disposition('npc-juniper')).toBe(0);
    expect(host.adjustDisposition('npc-juniper', 5)).toBe('unknown-npc:npc-juniper');
  });

  it('with dispositions a change applies, and a refused batch rolls it back', () => {
    const { host, npc, dispositions } = setup(true);
    const entity: EntityId = npc;
    expect(host.disposition('npc-juniper')).toBe(0);
    expect(apply(host, { kind: 'disposition', npc: 'npc-juniper', delta: 5 })).toMatchObject({
      ok: true,
    });
    expect(dispositions?.get(entity)).toBe(5);
    expect(
      apply(
        host,
        { kind: 'disposition', npc: 'npc-juniper', delta: 10 },
        { kind: 'takeItem', item: 'apple', count: 1 },
      ),
    ).toMatchObject({ ok: false });
    expect(host.disposition('npc-juniper')).toBe(5);
    expect(host.adjustDisposition('nobody', 1)).toBe('unknown-npc:nobody');
  });
});
