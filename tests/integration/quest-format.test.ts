// mw-e23.1: the quest format against the real game content. The fixture quests load with the game
// (structure, NPC, item and successor-quest references) and every condition, effect and objective
// they hold is valid logic DSL whose item, NPC, fact and quest references resolve. Quests shipped
// under src/content/data/quest (written under E39) get the same validation.
import { describe, expect, it } from 'vitest';
import { factIndex, lookupFact } from '@content/fact-checks';
import { gameContentSources } from '@content/game-content';
import { loadGameContent } from '@content/index';
import { loadContent } from '@content/loader';
import { contentChecks, contentTypes, type GameContent } from '@content/registry';
import {
  FIXTURE_QUEST_IDS,
  loadQuestFixtureContent,
  questFixtureSources,
} from '@content/test-fixtures';
import { questSchema } from '@content/types/quest';
import { validateQuestLogic } from '@sim/quest/index';
import type { LogicRefChecker } from '@sim/logic/index';

/** Reference checker over the content: ids the quest names must exist. */
function referencesIn(content: GameContent): LogicRefChecker {
  const facts = factIndex(content.all('fact'));
  const capabilities = new Set(
    content.all('capability').flatMap((group) => group.capabilities.map(({ id }) => id)),
  );
  const objectives = new Set(
    content.all('quest').flatMap((q) => q.objectives.map((o) => `${q.id}/${o.id}`)),
  );
  const known: Record<string, (id: string) => boolean> = {
    item: (id) => content.has('item', id),
    npc: (id) => content.has('creature', id),
    class: (id) => content.has('class', id),
    quest: (id) => content.has('quest', id),
    objective: (id) => objectives.has(id),
    capability: (id) => capabilities.has(id),
    fact: (key) => lookupFact(facts, key) !== undefined,
  };
  return (ref) =>
    known[ref.type]?.(ref.id) === false ? `unknown ${ref.type} "${ref.id}"` : undefined;
}

describe('quest format fixtures', () => {
  const content = loadQuestFixtureContent();

  it('AC-1: the fixture quests load and their logic validates with resolved references', () => {
    const quests = content.all('quest');
    expect(quests.map((q) => q.id)).toEqual([...FIXTURE_QUEST_IDS]);
    for (const quest of quests) {
      expect(validateQuestLogic(quest as never, referencesIn(content)), quest.id).toEqual([]);
    }
  });

  it('the fixtures exercise stages, resolutions of several approaches and every continuation', () => {
    const quests = content.all('quest');
    const approaches = new Set(quests.flatMap((q) => q.resolutions.map((r) => r.approach)));
    expect(approaches).toEqual(new Set(['other', 'diplomacy', 'trickery', 'stealth']));
    const continuations = quests.flatMap((q) => q.failures.map((f) => f.continuation.kind));
    expect(new Set(continuations)).toEqual(new Set(['startQuest', 'setStage', 'resolve']));
    expect(quests.some((q) => q.stages.length > 0)).toBe(true);
    expect(quests.some((q) => q.objectives.some((o) => o.hidden))).toBe(true);
    expect(quests.some((q) => q.objectives.some((o) => o.optional))).toBe(true);
    expect(quests.filter((q) => q.startWhen === undefined).length).toBeGreaterThan(0);
    expect(quests.filter((q) => q.startWhen !== undefined).length).toBeGreaterThan(0);
  });

  it('a successor quest a failure names must exist', () => {
    const sources = questFixtureSources().map((source) =>
      source.path.endsWith('the-captains-boots.json')
        ? { ...source, text: source.text.replace('"the-captain-below"', '"no-such-quest"') }
        : source,
    );
    expect(() =>
      loadContent(contentTypes, [...gameContentSources(), ...sources], contentChecks),
    ).toThrow(/no-such-quest/);
  });

  it('a reference to unknown content is reported with its pointer', () => {
    const [quest] = content.all('quest').filter((q) => q.id === 'the-captains-boots');
    const broken = questSchema.parse(
      JSON.parse(JSON.stringify(quest).replace('fixture-boots.tea-given', 'fixture-boots.no-such')),
    );
    const issues = validateQuestLogic(broken, referencesIn(content));
    expect(issues[0]?.message).toBe('condition "fact": unknown fact "fixture-boots.no-such"');
    expect(issues[0]?.pointer).toMatch(/^\/resolutions\/\d+\/when$/);
  });
});

describe('game quests', () => {
  it('every shipped quest has valid logic with resolved references', () => {
    const content = loadGameContent();
    for (const quest of content.all('quest')) {
      expect(validateQuestLogic(quest as never, referencesIn(content)), quest.id).toEqual([]);
    }
  });
});
