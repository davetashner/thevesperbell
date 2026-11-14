// mw-e23.11 AC (integration): a fixture quest is started by an effect through the game's logic host,
// saved mid-objective with the game's real save registry, loaded into a fresh game built the way the
// game boots (production fact policy, runtime installed before the load) and resolved there.
import { loadQuestFixtureContent } from '@content/test-fixtures';
import { installFactRegistry } from '@game/facts';
import { installGameLogic, questsOf } from '@game/logic/index';
import { createGameSaveRegistry } from '@game/save/sections';
import {
  addCapabilities,
  addInventory,
  applyLogicEffects,
  CapabilityRegistry,
  compileDispositionRules,
  DispositionChanged,
  Dispositions,
  hashWorld,
  installFactions,
  InventoryRules,
  World,
} from '@sim/index';
import { buildFactionTable } from '@sim/factions/table';
import { describe, expect, it } from 'vitest';

const build = { gameVersion: '0.1.0', buildSha: 'deadbee', contentHash: 'c0ffee' };
const options = { build, wallClockSavedAt: 1_790_000_000_000 };
const content = loadQuestFixtureContent();
const inventory = new InventoryRules(content.all('item'));
const capabilities = new CapabilityRegistry([]);
const QUEST = 'the-captain-below';

/** A game as `startWorld` builds it: facts, the player, then the logic host and quests. */
function boot(dev: boolean) {
  const world = installFactions(new World<never>({ seed: 4 }));
  installFactRegistry(world.facts, content, dev);
  const player = world.spawn();
  addInventory(world, player, 0);
  addCapabilities(world, player);
  const npc = world.spawn();
  world.step();
  const dispositions = new Dispositions(world, {
    factions: buildFactionTable([]),
    rules: compileDispositionRules([]),
  });
  const logic = installGameLogic(world, {
    world,
    player: () => player,
    inventory,
    capabilities,
    quests: questsOf(content),
    disposition: { dispositions, resolve: (name) => (name === 'npc-juniper' ? npc : undefined) },
  });
  if (logic.quests === undefined) throw new Error('no quests installed');
  return { world, logic, runtime: logic.quests, dispositions, npc };
}

describe('quests in the game (mw-e23.11)', () => {
  it('AC: an effect starts a quest, a save mid-objective reloads in a fresh game and it resolves', () => {
    const a = boot(true);
    expect(a.runtime.questState(QUEST)).toBe('unstarted');
    expect(applyLogicEffects([{ kind: 'startQuest', quest: QUEST }], a.logic.host)).toMatchObject({
      ok: true,
    });
    a.world.step();
    expect(a.runtime.questState(QUEST)).toBe('active');
    expect(a.runtime.objectiveState(QUEST, 'reach-the-adit')).toBe('active');

    const bytes = createGameSaveRegistry().write(a.world, options);
    // The production build ignores undeclared facts on load: the quest keys had to be declared.
    const b = boot(false);
    expect(b.runtime.questState(QUEST)).toBe('unstarted');
    const result = createGameSaveRegistry().read(b.world, bytes);
    expect(result).toMatchObject({ ok: true, warnings: [] });
    expect(hashWorld(b.world)).toBe(hashWorld(a.world));
    expect(b.runtime.questState(QUEST)).toBe('active');
    expect(b.runtime.objectiveState(QUEST, 'reach-the-adit')).toBe('active');

    b.world.facts.set('fixture-below.captain-home', true);
    b.world.step();
    expect(b.runtime.questState(QUEST)).toBe('resolved');
    expect(b.runtime.resolution(QUEST)).toBe('carried-home');
    expect(b.world.facts.get(`quest.${QUEST}.state`)).toBe('resolved');
  });

  it('a load re-evaluates a quest whose condition the save already met', () => {
    const a = boot(true);
    // The fact is set but no tick ran: the save holds the fact and not the quest's start.
    a.world.facts.set('fixture-boots.noticed', true);
    expect(a.runtime.questState('the-captains-boots')).toBe('unstarted');
    const bytes = createGameSaveRegistry().write(a.world, options);
    const b = boot(true);
    expect(createGameSaveRegistry().read(b.world, bytes)).toMatchObject({ ok: true });
    expect(b.runtime.questState('the-captains-boots')).toBe('active');
  });

  it('a resolution applies its effects through the game host, including dispositions', () => {
    const a = boot(true);
    const heard: number[] = [];
    a.world.events.on(DispositionChanged, ({ after }) => heard.push(after));
    a.world.facts.set('fixture-boots.noticed', true);
    a.world.facts.set('fixture-boots.night-followed', true);
    a.world.step();
    a.world.facts.set('fixture-boots.tea-given', true);
    a.world.step();
    expect(a.runtime.resolution('the-captains-boots')).toBe('wakeful-tea');
    expect(a.dispositions.get(a.npc)).toBe(5);
    expect(heard).toEqual([5]);
  });
});
