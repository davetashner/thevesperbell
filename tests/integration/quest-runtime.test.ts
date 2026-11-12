// mw-e23.2 AC-5 (integration): a fixture quest mid-objective goes through the real save format and
// loads identically into a fresh world, and evaluation carries on from where it was. The quest
// state is world facts, so the world-facts section carries it (no section of its own); the runtime
// declares its facts before the load, as a build with the strict fact policy needs.
import { describe, expect, it } from 'vitest';
import { loadQuestFixtureContent } from '@content/test-fixtures';
import { createGameSaveRegistry } from '@game/save/sections';
import { declareFacts, hashWorld, QuestRuntime, World } from '@sim/index';
import { MemoryLogicHost } from '@sim/logic/index';

const build = { gameVersion: '0.1.0', buildSha: 'deadbee', contentHash: 'c0ffee' };
const options = { build, wallClockSavedAt: 1_790_000_000_000 };
const content = loadQuestFixtureContent();

/** The memory host reading the world's facts, so conditions see what the sim and the save hold. */
class WorldHost extends MemoryLogicHost {
  constructor(world: World) {
    super({ capabilities: [] });
    Object.defineProperty(this, 'facts', { value: world.facts });
  }
}

function boot(): { world: World; runtime: QuestRuntime; host: WorldHost } {
  const world = new World({ seed: 4 });
  declareFacts(world.facts, content.all('fact'), { mode: 'throw' });
  const host = new WorldHost(world);
  const runtime = new QuestRuntime({
    quests: content.all('quest') as never,
    facts: world.facts,
    host,
    events: world.events,
  });
  return { world, runtime, host };
}

describe('quest runtime with the fixture quests', () => {
  it('AC-5: a quest mid-objective saves and loads identically and evaluation continues', () => {
    const a = boot();
    a.world.facts.set('fixture-boots.noticed', true);
    a.world.step();
    a.runtime.update();
    a.world.facts.set('fixture-boots.night-followed', true);
    a.world.step();
    a.runtime.update();
    const quest = 'the-captains-boots';
    expect(a.runtime.questState(quest)).toBe('active');
    expect(a.runtime.objectiveState(quest, 'follow-captain')).toBe('complete');
    expect(a.runtime.objectiveState(quest, 'fetch-bellwort')).toBe('active');

    const bytes = createGameSaveRegistry().write(a.world, options);
    const b = boot();
    const result = createGameSaveRegistry().read(b.world, bytes);
    expect(result).toMatchObject({ ok: true, warnings: [] });
    b.runtime.refresh();
    b.runtime.settle();
    expect(hashWorld(b.world)).toBe(hashWorld(a.world));
    expect(b.runtime.questState(quest)).toBe('active');
    expect(b.runtime.objectiveState(quest, 'follow-captain')).toBe('complete');
    expect(b.runtime.objectiveState(quest, 'fetch-bellwort')).toBe('active');
    expect(b.runtime.stage(quest)).toBe('follow');

    b.world.facts.set('fixture-boots.tea-given', true);
    b.world.step();
    b.runtime.update();
    expect(b.runtime.questState(quest)).toBe('resolved');
    expect(b.runtime.resolution(quest)).toBe('wakeful-tea');
    expect(b.runtime.objectiveState(quest, 'fetch-bellwort')).toBe('skipped');
    expect(b.host.disposition('npc-juniper')).toBe(5);
  });
});
