import { describe, expect, it } from 'vitest';
import { cueDirections, cueEventSpec, cuePlaceholders } from '../cue-events.ts';
import { loadGameContent } from '../game-content.ts';
import { describeContent } from '../testing.ts';
import {
  vfxCueRuleSchema,
  vfxCueSheetSchema,
  vfxCueSheetWarnings,
  type VfxCueSheetDefInput,
} from './vfx-cue-sheet.ts';

const sheet = (rules: VfxCueSheetDefInput['rules']): VfxCueSheetDefInput => ({
  id: 'test',
  notes: 'Test sheet.',
  rules,
});

const problems = (value: unknown) =>
  (vfxCueSheetSchema.safeParse(value).error?.issues ?? []).map(
    (i) => `${i.path.join('.')}: ${i.message}`,
  );

describeContent(
  'vfx-cue-sheet',
  'every rule uses its event’s facts, anchors and directions',
  (entry) => {
    for (const rule of entry.rules) {
      const spec = cueEventSpec(rule.event);
      for (const name of cuePlaceholders(rule.effect)) expect(spec.facts[name]).toBe('string');
      for (const key of Object.keys(rule.match)) expect(spec.facts[key]).toBeDefined();
      if (rule.orientTo !== undefined) expect(cueDirections(rule.event)).toContain(rule.orientTo);
    }
  },
);

describe('VFX cue sheet schema (mw-e29.3)', () => {
  it('fills rule defaults and the scaleBy floor', () => {
    expect(vfxCueRuleSchema.parse({ event: 'Died', effect: 'vfx-impact-dust' })).toEqual({
      event: 'Died',
      match: {},
      layer: 'main',
      effect: 'vfx-impact-dust',
      attach: true,
      stopOn: [],
      cooldownMs: 0,
    });
    expect(
      vfxCueRuleSchema.parse({
        event: 'DamageApplied',
        effect: 'vfx-impact-{target}',
        orientTo: 'hitNormal',
        scaleBy: { fact: 'total', min: 0, max: 40 },
      }).scaleBy,
    ).toEqual({ fact: 'total', min: 0, max: 40, floor: 0.25 });
  });

  it('rejects facts, anchors, directions and scales the event does not offer, and bad effect ids', () => {
    expect(
      problems(
        sheet([
          { event: 'DamageApplied', effect: 'vfx-impact-{total}', at: 'nowhere' },
          { event: 'breakableBroken', effect: 'vfx-break', orientTo: 'hitNormal' },
          { event: 'ArrowFired', effect: 'vfx-x', orientTo: 'hitNormal' },
          { event: 'physicsImpact', effect: 'vfx-x', scaleBy: { fact: 'entity', min: 0, max: 1 } },
          { event: 'physicsImpact', effect: 'vfx-y', scaleBy: { fact: 'energy', min: 2, max: 1 } },
          { event: 'Died', effect: 'sfx-boom' },
          { event: 'Died', effect: 'vfx-x', stopOn: ['Explosion' as 'Died'], match: { x: 'y' } },
        ]),
      ),
    ).toEqual([
      'rules.0.effect: {total} must be a string fact of DamageApplied',
      'rules.0.at: DamageApplied has no anchor "nowhere"; it has: target, instigator, source',
      'rules.1.orientTo: breakableBroken carries no "hitNormal"; it has: none',
      'rules.2.orientTo: ArrowFired carries no "hitNormal"; it has: attackerForward',
      'rules.3.scaleBy.fact: "entity" must be a number fact of physicsImpact',
      'rules.4.scaleBy.max: max must be greater than min',
      'rules.5.effect: must be a VFX effect id, optionally with {fact} segments, e.g. "vfx-impact-{target}"',
      'rules.6.stopOn.0: unknown sim event "Explosion"',
    ]);
    // The match check is the shared cue rule check.
    expect(problems(sheet([{ event: 'Died', effect: 'vfx-x', match: { x: 'y' } }]))).toEqual([
      'rules.0.match.x: Died has no fact "x"; it has: target, targetMaterial, tags, creatureDeath',
    ]);
  });

  it('flags a rule that can never win (same event, layer and match as an earlier one)', () => {
    expect(
      problems(
        sheet([
          { event: 'Died', effect: 'vfx-a', match: { target: 'bone', tags: 'x' } },
          { event: 'Died', effect: 'vfx-b' },
          { event: 'Died', effect: 'vfx-c', match: { tags: 'x', target: 'bone' } },
        ]),
      ),
    ).toEqual([
      'rules.2: rule 2 has the same event, layer and match as rule 0, so it can never win',
    ]);
  });

  it('AC-4: a rule naming an unknown effect id warns (a placeholder is allowed) with its rule index', () => {
    const sheets = [
      vfxCueSheetSchema.parse(
        sheet([
          { event: 'Died', effect: 'vfx-impact-dust' },
          { event: 'Died', layer: 'b', effect: 'vfx-not-yet' },
          { event: 'arrowImpact', effect: '{vfx}' },
        ]),
      ),
    ];
    expect(vfxCueSheetWarnings(sheets, new Set(['vfx-impact-dust']))).toEqual([
      'vfx-cue-sheet "test" rule 1: effect "vfx-not-yet" is not a vfx-effect yet (placeholder: a dev marker shows where it would play)',
    ]);
  });

  it('AC-4: the shipped sheets name only effects that exist (templates resolve when they spawn)', () => {
    const content = loadGameContent();
    const effects = new Set(content.all('vfx-effect').map((effect) => effect.id));
    expect(vfxCueSheetWarnings(content.all('vfx-cue-sheet'), effects)).toEqual([]);
  });
});
