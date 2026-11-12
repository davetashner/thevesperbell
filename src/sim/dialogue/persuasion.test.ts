import { describe, expect, it } from 'vitest';
import type { DialogueDef } from '../../content/types/dialogue';
import { World } from '../core/world';
import { MemoryLogicHost } from '../logic';
import {
  createPersuasion,
  difficultyLabel,
  evaluateCheck,
  validatePersuasionRules,
  type PersuasionRules,
} from './persuasion';
import {
  DialogueCheckResolved,
  DialogueRuntime,
  type CheckBreakdown,
  type CheckRequest,
} from './runtime';

const RULES: PersuasionRules = {
  base: 2,
  bandModifiers: { hostile: -6, cold: -3, neutral: 0, friendly: 3, devoted: 6 },
  labels: { easyFrom: 5, fairFrom: 0, hardFrom: -4 },
  modifiers: [
    {
      approaches: ['deceive'],
      when: { kind: 'playerClass', class: 'thief' },
      bonus: 3,
      label: 'A practised liar',
    },
    {
      when: { kind: 'hasCapability', capability: 'charm.voice' },
      bonus: 1,
      label: 'Silver tongue',
    },
  ],
  personality: [
    { approaches: ['intimidate'], trait: 'bravery', atMost: 0.3, bonus: 3, label: 'Easily cowed' },
    { trait: 'greed', atLeast: 0.6, atMost: 0.9, bonus: 2, label: 'Fond of a deal' },
  ],
};

const modifier = (label: string, bonus: number, when: object) => ({ when, bonus, label });

function checkDialogue(extra: object = {}, speakers: unknown[] = [{ id: 'oswin', name: 'Oswin' }]) {
  return {
    id: 'd',
    speakers,
    entries: [{ id: 'default', node: 'ask' }],
    nodes: [
      {
        id: 'ask',
        kind: 'choice',
        options: [
          {
            id: 'try',
            text: 'Try',
            showWhenLocked: false,
            once: false,
            next: 'chk',
          },
          { id: 'plain', text: 'Plain', showWhenLocked: false, once: false, end: true },
        ],
      },
      {
        id: 'chk',
        kind: 'check',
        approach: 'persuade',
        difficulty: 10,
        modifiers: [],
        success: 'won',
        failure: 'lost',
        ...extra,
      },
      { id: 'won', kind: 'line', speaker: 'player', text: 'won', end: true },
      { id: 'lost', kind: 'line', speaker: 'player', text: 'lost', end: true },
    ],
  } as unknown as DialogueDef;
}

function setup(
  dialogue: DialogueDef,
  init: ConstructorParameters<typeof MemoryLogicHost>[0] = {},
  personality?: (npc: string) => Record<string, number> | undefined,
) {
  const world = new World<never>({ seed: 1, hz: 60 });
  const host = new MemoryLogicHost(init);
  const persuasion = createPersuasion({
    rules: RULES,
    ...(personality !== undefined && { personality }),
  });
  const runtime = new DialogueRuntime({
    world,
    host,
    dialogues: (id) => (id === dialogue.id ? dialogue : undefined),
    checks: persuasion.resolve,
    preview: persuasion.preview,
  });
  const resolved: unknown[] = [];
  world.events.on(DialogueCheckResolved, (e) => resolved.push(e));
  return { world, host, runtime, resolved, persuasion };
}

/** Walks to the check and returns the breakdown the runtime published. */
function run(dialogue: DialogueDef, init?: ConstructorParameters<typeof MemoryLogicHost>[0]) {
  const { runtime, world, resolved, host } = setup(dialogue, init);
  runtime.start('d', 'npc-oswin');
  const result = runtime.choose(0);
  world.events.flush();
  return { result, resolved, host, runtime };
}

describe('persuasion checks', () => {
  it('e22.7 AC-1: score 12 against difficulty 10 takes the success branch and lists every modifier', () => {
    // base 2 + neutral 0 + node modifiers 4 + 6 = 12
    const dialogue = checkDialogue({
      modifiers: [
        modifier('You look the part', 4, { kind: 'gold', op: 'gte', value: 0 }),
        modifier('Carries the tally', 6, { kind: 'hasItem', item: 'tally', count: 1 }),
      ],
    });
    const { result, resolved } = run(dialogue, { items: { tally: 1 } });
    expect(result).toMatchObject({ ok: true, view: { kind: 'line', node: 'won' } });
    const breakdown = (resolved[0] as { breakdown: CheckBreakdown }).breakdown;
    expect(breakdown).toMatchObject({
      approach: 'persuade',
      difficulty: 10,
      score: 12,
      margin: 2,
      label: 'fair',
      success: true,
    });
    expect(breakdown.modifiers).toEqual([
      { source: 'base', label: 'base', value: 2 },
      { source: 'disposition', label: 'neutral', value: 0 },
      { source: 'node', label: 'You look the part', value: 4 },
      { source: 'node', label: 'Carries the tally', value: 6 },
    ]);
    expect(resolved[0]).toMatchObject({ node: 'chk', success: true, npc: 'npc-oswin' });
  });

  it('e22.7 AC-1: score just under the difficulty fails', () => {
    const { result } = run(
      checkDialogue({
        modifiers: [modifier('Bit of charm', 7, { kind: 'gold', op: 'gte', value: 0 })],
      }),
    );
    expect(result).toMatchObject({ view: { node: 'lost' } }); // 2 + 7 = 9 < 10
  });

  it('e22.7 AC-2: the same state resolved twice gives the same outcome and breakdown', () => {
    const dialogue = checkDialogue({
      modifiers: [modifier('Bit of charm', 8, { kind: 'gold', op: 'gte', value: 0 })],
    });
    const a = run(dialogue);
    const b = run(dialogue);
    expect(a.resolved).toEqual(b.resolved);
    expect(a.result).toEqual(b.result);
    const { runtime, persuasion } = setup(dialogue);
    runtime.start('d', 'npc-oswin');
    const request = (): CheckRequest => ({
      dialogue: 'd',
      npc: 'npc-oswin',
      target: 'npc-oswin',
      node: dialogue.nodes[1] as never,
      context: new MemoryLogicHost({}),
    });
    expect(persuasion.preview(request())).toEqual(persuasion.preview(request()));
  });

  it('e22.7 AC-3: a failed intimidate applies disposition(-15) and emit(alert) and enters the fail node', () => {
    const dialogue = checkDialogue({
      approach: 'intimidate',
      difficulty: 30,
      failureEffects: [
        { kind: 'disposition', npc: 'npc-oswin', delta: -15 },
        { kind: 'emit', event: 'alert', data: {} },
      ],
    });
    const { result, host } = run(dialogue, { dispositions: { 'npc-oswin': 0 } });
    expect(result).toMatchObject({ view: { node: 'lost' } });
    expect(host.disposition('npc-oswin')).toBe(-15);
    expect(host.emitted.map((e) => e.event)).toEqual(['alert']);
  });

  it('e22.7 AC-3: a successful check applies the success effects, not the failure ones', () => {
    const dialogue = checkDialogue({
      difficulty: 1,
      successEffects: [{ kind: 'giveItem', item: 'prize', count: 1 }],
      failureEffects: [{ kind: 'giveItem', item: 'pity', count: 1 }],
    });
    const { host } = run(dialogue);
    expect([host.itemCount('prize'), host.itemCount('pity')]).toEqual([1, 0]);
  });

  it('e22.7 AC-5: labels map from score minus difficulty by the data thresholds', () => {
    const l = RULES.labels;
    expect([10, 5, 4, 0, -1, -4, -5].map((margin) => difficultyLabel(margin, l))).toEqual([
      'easy',
      'easy',
      'fair',
      'fair',
      'hard',
      'hard',
      'impossible',
    ]);
    expect(difficultyLabel(2, { easyFrom: 2, fairFrom: 1, hardFrom: 0 })).toBe('easy');
  });

  it('e22.7 AC-5: the option leading to a check carries the label, score and modifiers for the UI', () => {
    const dialogue = checkDialogue({
      difficulty: 1,
      modifiers: [modifier('You look the part', 4, { kind: 'gold', op: 'gte', value: 0 })],
    });
    const { runtime } = setup(dialogue);
    const [withCheck, plain] =
      runtime.start('d', 'npc-oswin').kind === 'choice' ? runtime.choices() : [];
    expect(withCheck?.check).toMatchObject({ label: 'easy', score: 6, margin: 5, success: true });
    expect(withCheck?.check?.modifiers).toHaveLength(3);
    expect(plain?.check).toBeUndefined();
  });

  it('e22.7: no preview wired means no odds on choices', () => {
    const world = new World<never>({ seed: 1, hz: 60 });
    const dialogue = checkDialogue();
    const runtime = new DialogueRuntime({
      world,
      host: new MemoryLogicHost({}),
      dialogues: () => dialogue,
    });
    runtime.start('d', 'n');
    expect(runtime.choices()[0]?.check).toBeUndefined();
  });

  it('e22.7: the disposition band, class, capability and personality modifiers all count', () => {
    const dialogue = checkDialogue({ approach: 'deceive', difficulty: 1 });
    const { runtime, world, resolved } = setup(
      dialogue,
      {
        dispositions: { 'npc-oswin': 60 },
        playerClass: 'thief',
        capabilities: ['charm.voice'],
      },
      () => ({ greed: 0.7, bravery: 0.9 }),
    );
    runtime.start('d', 'npc-oswin');
    runtime.choose(0);
    world.events.flush();
    const breakdown = (resolved[0] as { breakdown: CheckBreakdown }).breakdown;
    // base 2, friendly +3, thief deceive +3, silver tongue +1, greed in 0.6..0.9 +2 (bravery too high).
    expect(breakdown.modifiers.map((m) => [m.source, m.value])).toEqual([
      ['base', 2],
      ['disposition', 3],
      ['rule', 3],
      ['rule', 1],
      ['personality', 2],
    ]);
    expect(breakdown.modifiers[1]?.label).toBe('friendly');
    expect(breakdown.score).toBe(11);
  });

  it('e22.7: rules for other approaches, other classes and other personalities stay out', () => {
    const dialogue = checkDialogue({
      approach: 'intimidate',
      modifiers: [modifier('Not held', 9, { kind: 'hasItem', item: 'tally', count: 1 })],
    });
    const request = {
      dialogue: 'd',
      npc: 'n',
      target: 'n',
      node: dialogue.nodes[1] as never,
      context: new MemoryLogicHost({ playerClass: 'thief' }),
    } satisfies CheckRequest;
    // thief bonus is for deceive only; no personality lookup at all
    expect(evaluateCheck(request, RULES).modifiers).toHaveLength(2);
    // a lookup that knows nothing of the NPC, or a coward below greed's band
    expect(evaluateCheck(request, RULES, () => undefined).modifiers).toHaveLength(2);
    const cowardly = evaluateCheck(request, RULES, () => ({ bravery: 0.1, greed: 0.95 }));
    expect(cowardly.modifiers.map((m) => m.label)).toEqual(['base', 'neutral', 'Easily cowed']);
    const fiery = evaluateCheck(request, RULES, () => ({ bravery: 0.5, greed: 0.5 }));
    expect(fiery.modifiers).toHaveLength(2);
  });

  it('e22.7: a named target speaker supplies the NPC whose disposition counts', () => {
    const dialogue = checkDialogue({ target: 'oswin', difficulty: 1 }, [
      { id: 'oswin', npc: { type: 'creature', id: 'npc-other' } },
    ]);
    const { runtime, world, resolved } = setup(dialogue, {
      dispositions: { 'npc-other': 80, 'npc-oswin': -80 },
    });
    runtime.start('d', 'npc-oswin');
    runtime.choose(0);
    world.events.flush();
    const breakdown = (resolved[0] as { breakdown: CheckBreakdown }).breakdown;
    expect(breakdown.target).toBe('npc-other');
    expect(breakdown.modifiers[1]).toMatchObject({ label: 'devoted', value: 6 });
  });

  it('e22.7: a speaker without an NPC falls back to the NPC being talked to', () => {
    const dialogue = checkDialogue({ target: 'oswin', difficulty: 1 });
    const { runtime, world, resolved } = setup(dialogue, { dispositions: { 'npc-oswin': -80 } });
    runtime.start('d', 'npc-oswin');
    runtime.choose(0);
    world.events.flush();
    expect((resolved[0] as { breakdown: CheckBreakdown }).breakdown.target).toBe('npc-oswin');
  });

  it('e22.7: a plain boolean resolver publishes the event without a breakdown', () => {
    const world = new World<never>({ seed: 1, hz: 60 });
    const dialogue = checkDialogue();
    const runtime = new DialogueRuntime({
      world,
      host: new MemoryLogicHost({}),
      dialogues: () => dialogue,
      checks: () => true,
    });
    const seen: unknown[] = [];
    world.events.on(DialogueCheckResolved, (e) => seen.push(e));
    runtime.start('d', 'n');
    runtime.choose(0);
    world.events.flush();
    expect(seen).toEqual([{ tick: 0, dialogue: 'd', npc: 'n', node: 'chk', success: true }]);
  });

  it('e22.7: validatePersuasionRules reports bad conditions with pointers', () => {
    expect(validatePersuasionRules(RULES)).toEqual([]);
    const bad = {
      modifiers: [
        ...RULES.modifiers,
        { when: { kind: 'nonsense' }, bonus: 1, label: 'x' },
        { when: { kind: 'hasItem', item: 'ghost' }, bonus: 1, label: 'y' },
      ],
    };
    const issues = validatePersuasionRules(bad, (ref) =>
      ref.id === 'ghost' ? `unknown ${ref.type} "ghost"` : undefined,
    );
    expect(issues.map((i) => i.pointer)).toEqual(['/modifiers/2/when', '/modifiers/3/when']);
  });
});
