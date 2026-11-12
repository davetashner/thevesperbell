// mw-e22.3: the dialogue format against the real game content. The fixture dialogues load with the
// game (structure, jump targets, speakers' NPCs), and every condition and effect they hold is valid
// logic DSL whose item, NPC, class, capability and fact references resolve in the shipped content.
// Dialogues shipped under src/content/data/dialogue (written under E39) get the same validation.
import { describe, expect, it } from 'vitest';
import { factIndex, lookupFact } from '@content/fact-checks';
import { loadDialogueFixtureContent, FIXTURE_DIALOGUE_IDS } from '@content/test-fixtures';
import { loadGameContent } from '@content/index';
import type { GameContent } from '@content/registry';
import { refCheckerFor, validateDialogueLogic } from '@sim/dialogue/index';

/** Reference checker over the content: ids the logic DSL names must exist. */
function referencesIn(content: GameContent) {
  const facts = factIndex(content.all('fact'));
  const capabilities = new Set(
    content.all('capability').flatMap((group) => group.capabilities.map(({ id }) => id)),
  );
  return refCheckerFor({
    item: (id) => content.has('item', id),
    npc: (id) => content.has('creature', id),
    class: (id) => content.has('class', id),
    dialogue: (id) => content.has('dialogue', id),
    capability: (id) => capabilities.has(id),
    fact: (key) => lookupFact(facts, key) !== undefined,
  });
}

describe('dialogue format fixtures', () => {
  const content = loadDialogueFixtureContent();

  it('AC-1: both fixture dialogues load and their logic validates with resolved references', () => {
    // The fixture content loads on top of the shipped content (src/content/data/dialogue, E39).
    const dialogues = content
      .all('dialogue')
      .filter((d) => (FIXTURE_DIALOGUE_IDS as readonly string[]).includes(d.id));
    expect(dialogues.map((d) => d.id)).toEqual([...FIXTURE_DIALOGUE_IDS]);
    for (const dialogue of dialogues) {
      expect(validateDialogueLogic(dialogue as never, referencesIn(content)), dialogue.id).toEqual(
        [],
      );
    }
  });

  it('the fixtures exercise class-gated options, a check, once options and visited counts', () => {
    const fixtures = content
      .all('dialogue')
      .filter((d) => (FIXTURE_DIALOGUE_IDS as readonly string[]).includes(d.id));
    const nodes = fixtures.flatMap((d) => d.nodes);
    expect(nodes.map((n) => n.kind)).toEqual(
      expect.arrayContaining(['line', 'choice', 'check', 'effect']),
    );
    const options = nodes.flatMap((n) => (n.kind === 'choice' ? n.options : []));
    expect(options.some((o) => o.once)).toBe(true);
    expect(options.some((o) => o.showWhenLocked)).toBe(true);
    const classes = options.flatMap((o) =>
      o.when?.kind === 'playerClass' ? [o.when['class']] : [],
    );
    expect(new Set(classes)).toEqual(new Set(['knight', 'thief', 'archer']));
    expect(JSON.stringify(fixtures)).toContain('dialogue.visitedCount');
  });

  it('a reference to unknown content is reported with its pointer', () => {
    const [dialogue] = content.all('dialogue').filter((d) => d.id === 'brand-commission');
    const broken: never = JSON.parse(
      JSON.stringify(dialogue).replace('miners-tally-stick', 'no-such-item'),
    ) as never;
    const issues = validateDialogueLogic(broken, referencesIn(content));
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0]?.message).toMatch(/unknown item "no-such-item"/);
    expect(issues[0]?.pointer).toMatch(/^\/nodes\/\d+\//);
  });
});

describe('game dialogue', () => {
  it('every shipped dialogue has valid logic with resolved references', () => {
    const content = loadGameContent();
    for (const dialogue of content.all('dialogue')) {
      expect(validateDialogueLogic(dialogue as never, referencesIn(content)), dialogue.id).toEqual(
        [],
      );
    }
  });
});
