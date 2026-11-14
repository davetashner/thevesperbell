import { describe, expect, it } from 'vitest';
import type { DialogueDef } from '../../content/types/dialogue';
import { World } from '../core/world';
import { MemoryLogicHost } from '../logic';
import { conditionGates, deriveOptionTags } from './tags';
import { DialogueRuntime } from './runtime';
import { dialogueWarnings } from './validate';

const SOURCES = {
  classTag: (id: string) => (id === 'thief' ? 'thief-tag' : undefined),
  itemIcon: (id: string) => (id === 'signet-ring' ? 'icon-item-signet-ring-01' : undefined),
};

function choiceDialogue(...options: object[]): DialogueDef {
  return {
    id: 'd',
    speakers: [],
    entries: [{ id: 'default', node: 'ask' }],
    nodes: [
      {
        id: 'ask',
        kind: 'choice',
        options: [
          { id: 'any', text: 'Anything', showWhenLocked: false, once: false, end: true },
          ...options.map((o, i) => ({
            id: `o${String(i)}`,
            text: 'O',
            showWhenLocked: false,
            once: false,
            end: true,
            ...o,
          })),
        ],
      },
    ],
  } as unknown as DialogueDef;
}

function listFor(dialogue: DialogueDef, init: ConstructorParameters<typeof MemoryLogicHost>[0]) {
  const runtime = new DialogueRuntime({
    world: new World<never>({ seed: 1, hz: 60 }),
    host: new MemoryLogicHost(init),
    dialogues: () => dialogue,
    tags: SOURCES,
  });
  runtime.start('d', 'n');
  return runtime.choices();
}

const thief = { kind: 'playerClass', class: 'thief' };
const knight = { kind: 'playerClass', class: 'knight' };

describe('option tags', () => {
  it('e22.6 AC-1: a thief option is available to a thief with the class tag and hidden from a knight', () => {
    const dialogue = choiceDialogue({ when: thief });
    const asThief = listFor(dialogue, { playerClass: 'thief' });
    expect(asThief.map((c) => [c.id, c.locked])).toEqual([
      ['any', false],
      ['o0', false],
    ]);
    expect(asThief[1]?.tags).toEqual([
      { kind: 'class', id: 'thief', tag: 'thief-tag', labelKey: 'dialogue.tag.class.thief' },
    ]);
    expect(listFor(dialogue, { playerClass: 'knight' }).map((c) => c.id)).toEqual(['any']);
  });

  it('e22.6 AC-2: a capability option with showWhenLocked appears locked with the capability tag', () => {
    const dialogue = choiceDialogue({
      when: { kind: 'hasCapability', capability: 'sense.detect-magic' },
      showWhenLocked: true,
    });
    const listed = listFor(dialogue, {});
    expect(listed[1]).toMatchObject({ locked: true, id: 'o0' });
    expect(listed[1]?.tags).toEqual([
      {
        kind: 'capability',
        id: 'sense.detect-magic',
        tag: 'sense.detect-magic',
        labelKey: 'dialogue.tag.capability.sense.detect-magic',
      },
    ]);
    expect(listed[1]?.reasonParts).toBeDefined();
    const unlocked = listFor(dialogue, { capabilities: ['sense.detect-magic'] });
    expect(unlocked[1]?.locked).toBe(false);
  });

  it('e22.6 AC-3: an item option holding the item carries the item tag with its icon id', () => {
    const dialogue = choiceDialogue({ when: { kind: 'hasItem', item: 'signet-ring', count: 1 } });
    const listed = listFor(dialogue, { items: { 'signet-ring': 1 } });
    expect(listed[1]?.locked).toBe(false);
    expect(listed[1]?.tags).toEqual([
      {
        kind: 'item',
        id: 'signet-ring',
        tag: 'signet-ring',
        labelKey: 'dialogue.tag.item.signet-ring',
        icon: 'icon-item-signet-ring-01',
      },
    ]);
  });

  it('e22.6: an item with no known icon, and a class with no known tag, still tag by id', () => {
    const tags = deriveOptionTags({
      kind: 'all',
      of: [
        { kind: 'hasItem', item: 'mystery', count: 1 },
        { kind: 'playerClass', class: 'archer' },
      ],
    });
    expect(tags).toEqual([
      { kind: 'item', id: 'mystery', tag: 'mystery', labelKey: 'dialogue.tag.item.mystery' },
      { kind: 'class', id: 'archer', tag: 'archer', labelKey: 'dialogue.tag.class.archer' },
    ]);
  });

  it('e22.6: tags come through all and any, once each, and never from under not', () => {
    const condition = {
      kind: 'any',
      of: [
        thief,
        { kind: 'all', of: [thief, { kind: 'gold', op: 'gte', value: 1 }] },
        { kind: 'not', condition: knight },
      ],
    };
    expect(conditionGates(condition)).toEqual([{ kind: 'class', id: 'thief' }]);
    expect(conditionGates(undefined)).toEqual([]);
    expect(deriveOptionTags(undefined)).toEqual([]);
  });

  it('e22.6: options with no gate carry no tags', () => {
    expect(listFor(choiceDialogue(), {})[0]?.tags).toEqual([]);
  });
});

describe('dialogue warnings', () => {
  it('e22.6 AC-4: class options for only one class warn, and a warning is not a logic error', () => {
    const dialogue = choiceDialogue({ when: thief }, { when: { kind: 'all', of: [thief] } });
    const warnings = dialogueWarnings(dialogue);
    expect(warnings.map((w) => [w.code, w.pointer])).toEqual([
      ['class-options-narrow', '/nodes/0/options/1/when'],
    ]);
    expect(warnings[0]?.message).toContain('only one class (thief)');
  });

  it('e22.6 AC-4: two classes, or none, or non-choice nodes give no warning', () => {
    expect(dialogueWarnings(choiceDialogue({ when: thief }, { when: knight }))).toEqual([]);
    expect(
      dialogueWarnings(choiceDialogue({ when: { kind: 'hasItem', item: 'x', count: 1 } })),
    ).toEqual([]);
    const lineOnly = {
      id: 'l',
      speakers: [],
      entries: [{ id: 'd', node: 'a' }],
      nodes: [{ id: 'a', kind: 'end' }],
    } as unknown as DialogueDef;
    expect(dialogueWarnings(lineOnly)).toEqual([]);
  });
});
