import { describe, expect, it } from 'vitest';
import { ContentLoadError, loadContent } from '../loader.ts';
import { contentTypes } from '../registry.ts';
import { describeContent } from '../testing.ts';
import { cueEventSpec, cuePlaceholders } from '../cue-events.ts';
import { loadGameContent } from '../game-content.ts';
import { hasString } from '../strings.ts';
import { cueRuleSchema, cueSheetSchema, type CueSheetDefInput } from './cue-sheet.ts';

const sheet = (rules: CueSheetDefInput['rules']): CueSheetDefInput => ({
  id: 'test',
  notes: 'Test sheet.',
  rules,
});

const problems = (value: unknown) =>
  (cueSheetSchema.safeParse(value).error?.issues ?? []).map(
    (i) => `${i.path.join('.')}: ${i.message}`,
  );

describeContent('cue-sheet', 'every rule uses its event’s facts and anchors', (entry) => {
  for (const rule of entry.rules) {
    const spec = cueEventSpec(rule.event);
    for (const name of cuePlaceholders(rule.cue)) expect(spec.facts[name]).toBe('string');
    for (const key of Object.keys(rule.match)) expect(spec.facts[key]).toBeDefined();
  }
});

describe('cue sheet schema', () => {
  it('fills rule defaults', () => {
    expect(cueRuleSchema.parse({ event: 'Died', cue: 'sfx-combat-death' })).toEqual({
      event: 'Died',
      match: {},
      layer: 'main',
      cue: 'sfx-combat-death',
      pitchJitter: 0,
      volumeJitterDb: 0,
      volumeDb: 0,
      cooldownMs: 0,
      gameplayCritical: false,
    });
    expect(
      cueRuleSchema.parse({
        event: 'DamageApplied',
        cue: 'sfx-impact-{target}',
        volumeBy: { fact: 'total', min: 0, max: 40 },
      }).volumeBy,
    ).toEqual({ fact: 'total', min: 0, max: 40, floorDb: -12 });
  });

  it('AC-5: a sheet referencing an unknown sim event fails at load with the rule index', () => {
    let error: unknown;
    try {
      loadContent(contentTypes, [
        {
          path: 'data/cue-sheet/test.json',
          text: JSON.stringify(
            sheet([
              { event: 'Died', cue: 'sfx-combat-death' },
              { event: 'DamageApplied', cue: 'sfx-impact-{target}' },
              { event: 'Explosion' as 'Died', cue: 'sfx-boom' },
            ]),
          ),
        },
      ]);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(ContentLoadError);
    const issues = (error as ContentLoadError).issues;
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      file: 'data/cue-sheet/test.json',
      pointer: '/rules/2/event',
    });
    expect(issues[0]?.message).toMatch(/^unknown sim event "Explosion"/);
  });

  it('accepts whole-fact and templated cue ids, rejects other shapes', () => {
    expect(problems(sheet([{ event: 'TelegraphStarted', cue: '{telegraphSound}' }]))).toEqual([]);
    expect(problems(sheet([{ event: 'Died', cue: 'boom' }]))).toEqual([
      'rules.0.cue: must be an audio cue id, optionally with {fact} segments, e.g. "sfx-impact-{target}"',
    ]);
  });

  it('accepts a caption that is in the string table and rejects an unknown or malformed one', () => {
    const rule = (caption: string): CueSheetDefInput['rules'] => [
      { event: 'Died', cue: 'sfx-death', caption },
    ];
    expect(problems(sheet(rule('caption.breaking')))).toEqual([]);
    expect(problems(sheet(rule('caption.nope')))).toEqual([
      'rules.0.caption: caption "caption.nope" has no entry in the string table (src/content/strings.ts)',
    ]);
    expect(problems(sheet(rule('Not A Key')))).toHaveLength(2);
  });

  it('flags the initial captioned cues in the shipped sheets (mw-e28.14)', () => {
    const flagged = loadGameContent()
      .all('cue-sheet')
      .flatMap((s) => s.rules)
      .filter((r) => r.caption !== undefined)
      .map((r) => `${r.event}:${String(r.caption)}`);
    expect([...new Set(flagged)].sort()).toEqual([
      'LocomotionEvents:caption.footsteps',
      'TelegraphStarted:caption.telegraph',
      'TelegraphStarted:caption.telegraph-unblockable',
      'aiAlertStateChanged:caption.alert-bark',
      'arrowImpact:caption.noise-rattle',
      'breakableBroken:caption.breaking',
      'doorStateChanged:caption.door-close',
      'doorStateChanged:caption.door-open',
    ]);
  });

  it('mw-e31.5 AC-4: every gameplay-critical rule has a caption key that exists in the string table', () => {
    const rules = loadGameContent()
      .all('cue-sheet')
      .flatMap((s) => s.rules);
    const critical = rules.filter((r) => r.gameplayCritical);
    expect(critical.length).toBeGreaterThan(0);
    for (const rule of critical) {
      expect(rule.caption, `${rule.event} ${rule.cue}`).toBeDefined();
      expect(hasString(String(rule.caption))).toBe(true);
    }
    // Every captioned shipped rule is flagged, so the flag cannot drift from the captions.
    expect(rules.filter((r) => r.caption !== undefined && !r.gameplayCritical)).toEqual([]);
  });

  it('mw-e31.5 AC-4: rejects a gameplay-critical rule without a caption', () => {
    expect(problems(sheet([{ event: 'Died', cue: 'sfx-death', gameplayCritical: true }]))).toEqual([
      'rules.0.caption: a gameplayCritical rule needs a caption (a localisation key in the string table)',
    ]);
  });

  it('checks placeholders, anchors and volumeBy against the event', () => {
    expect(
      problems(
        sheet([
          {
            event: 'DamageApplied',
            cue: 'sfx-impact-{total}-{nope}',
            at: 'killer',
            volumeBy: { fact: 'died', min: 0, max: 1 },
          },
        ]),
      ),
    ).toEqual([
      'rules.0.cue: {total} must be a string fact of DamageApplied',
      'rules.0.cue: {nope} must be a string fact of DamageApplied',
      'rules.0.at: DamageApplied has no anchor "killer"; it has: target, instigator, source',
      'rules.0.volumeBy.fact: "died" must be a number fact of DamageApplied',
    ]);
    expect(
      problems(
        sheet([
          {
            event: 'DamageApplied',
            cue: 'sfx-hit',
            at: 'instigator',
            volumeBy: { fact: 'total', min: 5, max: 5 },
          },
        ]),
      ),
    ).toEqual(['rules.0.volumeBy.max: max must be greater than min']);
  });

  it('rejects a rule that duplicates an earlier one’s event, layer and match', () => {
    expect(
      problems(
        sheet([
          { event: 'DamageApplied', match: { weapon: 'metal', target: 'bone' }, cue: 'sfx-a' },
          { event: 'DamageApplied', match: { target: 'bone', weapon: 'metal' }, cue: 'sfx-b' },
          {
            event: 'DamageApplied',
            match: { target: 'bone', weapon: 'metal' },
            layer: 'x',
            cue: 'sfx-c',
          },
          { event: 'DamageApplied', match: { target: 'bone' }, cue: 'sfx-d' },
        ]),
      ),
    ).toEqual([
      'rules.1: rule 1 has the same event, layer and match as rule 0, so it can never win',
    ]);
  });

  it('needs at least one rule', () => {
    expect(problems(sheet([]))).toEqual(['rules: Too small: expected array to have >=1 items']);
  });
});
