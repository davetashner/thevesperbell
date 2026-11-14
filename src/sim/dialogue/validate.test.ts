import { describe, expect, it } from 'vitest';
import type { DialogueDef } from '../../content/types/dialogue';
import { MemoryLogicHost, evaluateLogic, validateLogicCondition } from '../logic';
import {
  DIALOGUE_SERVICE,
  dialogueLogicRegistry,
  type DialogueVisits,
} from '../logic/dialogue-kinds';
import { refCheckerFor, validateDialogueLogic } from './validate';

/** A dialogue with a condition or effect of every position the validator walks. */
function dialogue(patch: { when?: unknown; effect?: unknown } = {}): DialogueDef {
  const when = patch.when ?? { kind: 'gold', op: 'gte', value: 1 };
  const effects = [patch.effect ?? { kind: 'gold', delta: 1 }];
  return {
    id: 'test',
    speakers: [],
    entries: [
      { id: 'a', when, node: 'c' },
      { id: 'b', node: 'c' },
    ],
    nodes: [
      {
        id: 'c',
        kind: 'choice',
        options: [
          { id: 'o', text: 'O', when, effects, showWhenLocked: false, once: false, end: true },
        ],
      },
      { id: 'br', kind: 'branch', routes: [{ when, next: 'c' }], else: 'c' },
      {
        id: 'ck',
        kind: 'check',
        approach: 'persuade',
        difficulty: 1,
        modifiers: [{ when, bonus: 1, label: 'L' }],
        success: 'c',
        failure: 'c',
        successEffects: effects,
        failureEffects: effects,
      },
      { id: 'fx', kind: 'effect', effects, end: true },
      { id: 'ln', kind: 'line', speaker: 'player', text: 'T', end: true },
      { id: 'jp', kind: 'jump', dialogue: 'other' as never },
      { id: 'en', kind: 'end' },
    ],
  } as unknown as DialogueDef;
}

const pointers = (d: DialogueDef, refs?: Parameters<typeof validateDialogueLogic>[1]) =>
  validateDialogueLogic(d, refs).map((i) => i.pointer);

describe('dialogue logic validation', () => {
  it('passes a dialogue whose logic is all valid', () => {
    expect(validateDialogueLogic(dialogue())).toEqual([]);
  });

  it('finds an unknown condition kind in every position, with its pointer', () => {
    expect(pointers(dialogue({ when: { kind: 'moonPhase' } }))).toEqual([
      '/entries/0/when',
      '/nodes/0/options/0/when',
      '/nodes/1/routes/0/when',
      '/nodes/2/modifiers/0/when',
    ]);
    expect(validateDialogueLogic(dialogue({ when: { kind: 'moonPhase' } }))[0]?.message).toMatch(
      /unknown condition kind "moonPhase"/,
    );
  });

  it('finds bad effects in every position, with nested paths', () => {
    expect(pointers(dialogue({ effect: { kind: 'giveItem', item: 'Bad Id' } }))).toEqual([
      '/nodes/0/options/0/effects/0/item',
      '/nodes/2/successEffects/0/item',
      '/nodes/2/failureEffects/0/item',
      '/nodes/3/effects/0/item',
    ]);
    const nested = dialogue({
      when: { kind: 'all', of: [{ kind: 'gold', op: 'gte', value: 1 }, { kind: 'x' }] },
    });
    expect(pointers(nested)[0]).toBe('/entries/0/when/of/1');
  });

  it('accepts the dialogue extension kind and rejects it with bad fields', () => {
    const visited = { kind: 'dialogue.visitedCount', id: 'welcome', op: 'gte', value: 1 };
    expect(validateDialogueLogic(dialogue({ when: visited }))).toEqual([]);
    expect(pointers(dialogue({ when: { ...visited, op: 'many' } }))[0]).toBe('/entries/0/when/op');
  });

  it('checks references through a checker; unlisted types pass', () => {
    const refs = refCheckerFor({ item: (id) => id === 'key-a' });
    const item = (id: string) => dialogue({ effect: { kind: 'giveItem', item: id } });
    expect(pointers(item('key-a'), refs)).toEqual([]);
    expect(pointers(item('key-b'), refs)[0]).toBe('/nodes/0/options/0/effects/0');
    expect(validateDialogueLogic(item('key-b'), refs)[0]?.message).toBe(
      'effect "giveItem": unknown item "key-b"',
    );
    expect(pointers(dialogue({ effect: { kind: 'startQuest', quest: 'q' } }), refs)).toEqual([]);
  });

  it('checks the dialogue a visitedCount names', () => {
    const refs = refCheckerFor({ dialogue: (id) => id === 'known' });
    const visited = (dialogueId: string) => ({
      kind: 'dialogue.visitedCount',
      id: 'n',
      dialogue: dialogueId,
      op: 'eq',
      value: 0,
    });
    expect(pointers(dialogue({ when: visited('known') }), refs)).toEqual([]);
    expect(pointers(dialogue({ when: visited('other') }), refs)[0]).toBe('/entries/0/when');
  });
});

describe('dialogue logic validation: absent logic', () => {
  it('skips options without effects and checks without effects or modifiers', () => {
    const d = dialogue() as unknown as {
      nodes: {
        options?: { effects?: unknown }[];
        successEffects?: unknown;
        failureEffects?: unknown;
      }[];
    };
    delete d.nodes[0]?.options?.[0]?.effects;
    delete d.nodes[2]?.successEffects;
    delete d.nodes[2]?.failureEffects;
    expect(validateDialogueLogic(d as never)).toEqual([]);
  });
});

describe('dialogue.visitedCount', () => {
  const registry = dialogueLogicRegistry();
  const condition = (data: unknown) => {
    const result = validateLogicCondition(data, { registry });
    if (!result.ok) throw new Error(JSON.stringify(result.issues));
    return result.value;
  };

  it('is registered once, lazily, and not in the default registry', () => {
    expect(dialogueLogicRegistry()).toBe(registry);
    expect(registry.conditionNames()).toContain('dialogue.visitedCount');
    expect(
      validateLogicCondition({ kind: 'dialogue.visitedCount', id: 'a', op: 'eq', value: 0 }).ok,
    ).toBe(false);
  });

  it('compares the runtime-reported visit count; nothing is visited without a runtime', () => {
    const visits: DialogueVisits = {
      visitCount: (id, dialogue) =>
        id === 'welcome' && dialogue === undefined ? 2 : id === 'x' && dialogue === 'other' ? 5 : 0,
    };
    const host = new MemoryLogicHost({ services: { [DIALOGUE_SERVICE]: visits } });
    const bare = new MemoryLogicHost();
    const visited = condition({
      kind: 'dialogue.visitedCount',
      id: 'welcome',
      op: 'gte',
      value: 2,
    });
    expect(evaluateLogic(visited, host, registry)).toBe(true);
    expect(evaluateLogic(visited, bare, registry)).toBe(false);
    const other = condition({
      kind: 'dialogue.visitedCount',
      id: 'x',
      dialogue: 'other',
      op: 'eq',
      value: 5,
    });
    expect(evaluateLogic(other, host, registry)).toBe(true);
    const never = condition({ kind: 'dialogue.visitedCount', id: 'welcome', op: 'eq', value: 0 });
    expect(evaluateLogic(never, bare, registry)).toBe(true);
    expect(evaluateLogic(never, host, registry)).toBe(false);
  });
});
