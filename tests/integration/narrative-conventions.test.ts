// mw-e39.3: the narrative content conventions (docs/narrative/content-conventions.md) against the
// validators that exist today. The worked examples are fixtures (never shipped: real content is
// E39's), so they validate without becoming game canon. AC-2 runs each example through the content
// loader and the dialogue and quest validators; AC-4 shows an unknown class fails naming file and field.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { factIndex, lookupFact } from '@content/fact-checks';
import { NARRATIVE_CLASSES } from '@content/narrative/class-variants';
import {
  dialogueFixtureSources,
  loadDialogueFixtureContent,
  loadQuestFixtureContent,
} from '@content/test-fixtures';
import type { GameContent } from '@content/registry';
import { refCheckerFor } from '@sim/dialogue/index';
import { validateQuestLogic } from '@sim/quest/index';
import { contentReferences, validateDialogues } from '../../src/tools/dialogue/validate';

const EXAMPLE_DIALOGUE = 'src/content/fixtures/dialogue/dialogue/ottilie-bridge-talk.json';
const DIALOGUE_ID = /^[a-z]+(?:-[a-z]+)*$/;
const QUEST_ID = /^quest-[a-z0-9]+(?:-[a-z0-9]+)*$/;
const FACT_KEY = /^(?:fixture-)?[a-z0-9]+(?:-[a-z0-9]+)*\.[a-z0-9]+(?:-[a-z0-9]+)*$/;

const exampleText = (): string => {
  const source = dialogueFixtureSources().find((s) => s.path === EXAMPLE_DIALOGUE);
  if (source === undefined) throw new Error('the conventions example dialogue is missing');
  return source.text;
};

const dialogueIssues = (path: string, text: string, content: GameContent) =>
  validateDialogues([{ path, text }], {
    maxTextLength: 240,
    references: contentReferences(content),
  });

describe('narrative conventions: worked examples', () => {
  const content = loadDialogueFixtureContent();

  it('AC-2: the example dialogue validates with zero errors and zero warnings', () => {
    const report = dialogueIssues(EXAMPLE_DIALOGUE, exampleText(), content);
    expect(report.dialogues).toBe(1);
    expect(report.errors).toEqual([]);
    expect(report.warnings).toEqual([]);
  });

  it('AC-2: the example quest loads, its facts are registered and its logic validates', () => {
    const quests = loadQuestFixtureContent();
    const quest = quests.get('quest', 'quest-empty-barge');
    const facts = factIndex(quests.all('fact'));
    const references = refCheckerFor({
      npc: (id) => quests.has('creature', id),
      fact: (key) => lookupFact(facts, key) !== undefined,
    });
    expect(validateQuestLogic(quest as never, references)).toEqual([]);
    expect(quest.givers.map((g) => g.id)).toEqual(['npc-ottilie']);
  });

  it('follows the id conventions: unprefixed dialogue ids, quest-<slug>, <subject>.<state> facts', () => {
    const dialogue = content.get('dialogue', 'ottilie-bridge-talk');
    expect(dialogue.id).toMatch(DIALOGUE_ID);
    expect(dialogue.speakers.every((s) => s.npc?.id.startsWith('npc-') ?? true)).toBe(true);
    const quests = loadQuestFixtureContent();
    expect(quests.get('quest', 'quest-empty-barge').id).toMatch(QUEST_ID);
    const group = quests.all('fact').find((g) => g.id === 'narrative-example');
    expect(group?.facts.map((f) => f.key)).toSatisfy((keys: string[]) =>
      keys.every((key) => FACT_KEY.test(key)),
    );
  });

  it('class variants: entry, node and option ids that name a class are gated on that class', () => {
    const dialogue = content.get('dialogue', 'ottilie-bridge-talk');
    const gatedOn = (when: unknown): string | undefined =>
      (when as { kind?: string; class?: string } | undefined)?.kind === 'playerClass'
        ? (when as { class: string }).class
        : undefined;
    const suffix = (id: string): string | undefined =>
      NARRATIVE_CLASSES.find((c) => id.endsWith(`-${c}`));
    for (const entry of dialogue.entries) {
      expect(gatedOn(entry.when), entry.id).toBe(suffix(entry.id) ?? gatedOn(entry.when));
    }
    const options = dialogue.nodes.flatMap((n) => (n.kind === 'choice' ? n.options : []));
    for (const option of options) {
      const named = suffix(option.id);
      if (named !== undefined) expect(gatedOn(option.when), option.id).toBe(named);
    }
    // Every class has a greeting entry, and its node is named for it.
    for (const c of NARRATIVE_CLASSES) {
      const entry = dialogue.entries.find((e) => gatedOn(e.when) === c);
      expect(entry?.node, c).toBe(`greet-${c}`);
    }
  });

  it('the conventions doc names every worked example and every class', () => {
    const doc = readFileSync('docs/narrative/content-conventions.md', 'utf8');
    expect(doc).toContain('ottilie-bridge-talk');
    expect(doc).toContain('quest-empty-barge');
    for (const c of NARRATIVE_CLASSES) expect(doc).toContain(c);
  });
});

describe('narrative conventions: class values', () => {
  const content = loadDialogueFixtureContent();

  it('AC-4: a dialogue condition tagged with an unknown class fails, naming the file and field', () => {
    const broken = exampleText().replace('"class": "knight"', '"class": "paladin"');
    expect(broken).not.toBe(exampleText());
    const { errors } = dialogueIssues(EXAMPLE_DIALOGUE, broken, content);
    expect(errors.length).toBeGreaterThan(0);
    const [issue] = errors;
    expect(issue?.file).toBe(EXAMPLE_DIALOGUE);
    expect(issue?.message).toMatch(/unknown class "paladin"/);
    expect(issue?.pointer).toBe('/entries/1/when');
    expect(issue?.line).toBeGreaterThan(1);
  });

  it('AC-4: a misspelt class in an option condition fails the same way', () => {
    const broken = exampleText().replace('"class": "archer"', '"class": "Archer"');
    const { errors } = dialogueIssues(EXAMPLE_DIALOGUE, broken, content);
    expect(errors.map((e) => e.message).join('\n')).toMatch(/playerClass/);
  });
});
