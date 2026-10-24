import { describe, expect, expectTypeOf, it } from 'vitest';
import { readContentSources } from '../fs-sources.ts';
import { loadGameContent } from '../game-content.ts';
import { ContentLoadError, loadContent, type ContentSource } from '../loader.ts';
import { ContentRef } from '../schema.ts';
import {
  FIXTURE_SPELL_IDS,
  loadSpellFixtureContent,
  SPELL_FIXTURE_ROOT,
  spellFixtureSources,
} from '../test-fixtures.ts';
import { describeContent } from '../testing.ts';
import ward from '../fixtures/spells/spell/fixture-ward.json';
import {
  SPELL_DELIVERIES,
  SPELL_EFFECT_OPS,
  SPELL_SCHEMA_VERSION,
  spellSchema,
  type SpellDefinition,
  type SpellDefinitionInput,
  type SpellEntry,
} from './spell.ts';

const content = loadSpellFixtureContent();
const fixtures = FIXTURE_SPELL_IDS.map((id) => content.get('spell', id));

/** A minimal valid spell: a self-cast status. */
const minimal = {
  id: 'test-spell',
  name: 'Test Spell',
  school: 'arcane',
  tier: 1,
  cost: { mana: 5 },
  castTime: 0,
  delivery: { kind: 'self' },
  effects: [{ op: 'status', status: 'warded', duration: 3 }],
  vfxCue: 'vfx-spell-arcane-test',
  sfxCue: 'sfx-spell-arcane-test-cast',
} satisfies SpellDefinitionInput;

const issues = (value: unknown) =>
  (spellSchema.safeParse(value).error?.issues ?? []).map(
    (i) => `${i.path.join('.')}: ${i.message}`,
  );
const withEffect = (effect: unknown) => ({ ...minimal, effects: [effect] });

/** Loads spell files (no refs to other types) through the real loader. */
const load = (files: Record<string, unknown>) =>
  loadContent(
    { spell: spellSchema },
    Object.entries(files).map(([path, json]): ContentSource => ({
      path,
      text: JSON.stringify(json),
    })),
  );
const loadError = (files: Record<string, unknown>): ContentLoadError => {
  try {
    load(files);
  } catch (error) {
    return error as ContentLoadError;
  }
  throw new Error('expected the spells to fail to load');
};

describe('spell fixtures (mw-e06.1)', () => {
  it('AC-1: every fixture spell file parses into a typed SpellDefinition with no errors', () => {
    for (const source of spellFixtureSources()) {
      const parsed = spellSchema.safeParse(JSON.parse(source.text));
      expect(parsed.error?.issues ?? [], source.path).toEqual([]);
    }
    expect(fixtures.map((s) => s.id)).toEqual([...FIXTURE_SPELL_IDS]);
    const bolt = content.get('spell', 'fixture-bolt');
    expectTypeOf(bolt).toEqualTypeOf<SpellEntry>();
    expect(bolt).toMatchObject({
      schemaVersion: SPELL_SCHEMA_VERSION,
      school: 'fire',
      cost: { mana: 15 },
      delivery: { kind: 'projectile', speed: 25 },
    });
    expect(bolt.next).toEqual([new ContentRef('spell', 'fixture-fire-wall')]);
    expect(bolt.effects.map((e) => e.op)).toEqual(['damage', 'stimulus', 'light', 'noise']);
  });

  it('reads the fixture files from their own root, one per fixture id', () => {
    const paths = spellFixtureSources()
      .map((s) => s.path)
      .sort();
    expect(paths).toEqual(FIXTURE_SPELL_IDS.map((id) => `${SPELL_FIXTURE_ROOT}/spell/${id}.json`));
    expect(readContentSources(SPELL_FIXTURE_ROOT).map((s) => s.path)).toEqual(paths);
  });

  it('together cover every delivery kind and every effect op', () => {
    expect(new Set(fixtures.map((s) => s.delivery.kind))).toEqual(new Set(SPELL_DELIVERIES));
    expect(new Set(fixtures.flatMap((s) => s.effects.map((e) => e.op)))).toEqual(
      new Set(SPELL_EFFECT_OPS),
    );
  });
});

describe('spell schema (mw-e06.1)', () => {
  it('fills defaults for optional fields', () => {
    const spell: SpellDefinition = spellSchema.parse(minimal);
    expect(spell).toMatchObject({
      schemaVersion: SPELL_SCHEMA_VERSION,
      next: [],
      cooldown: 0,
      tags: [],
      flags: { tooUseful: false, castWhileMoving: false },
      effects: [{ op: 'status', status: 'warded', duration: 3, stacks: 1 }],
    });
    expect(spell.channel).toBeUndefined();
    expect(spell.bookId).toBeUndefined();
    expect(spellSchema.parse({ ...minimal, delivery: { kind: 'touch' } }).delivery).toEqual({
      kind: 'touch',
      reach: 1.5,
    });
  });

  it('AC-2: an unknown effect op fails naming the file and the JSON path effects[0].op', () => {
    const file = 'content/spell/bad.json';
    const error = loadError({ [file]: withEffect({ op: 'teleportEverything' }) });
    expect(error.issues.map(({ file, pointer }) => ({ file, pointer }))).toEqual([
      { file, pointer: '/effects/0/op' },
    ]);
    expect(error.issues[0]?.message).toMatch(
      /^unknown effect op "teleportEverything"; known: damage, stimulus, .*noise \(at effects\[0\]\.op\)$/,
    );
    expect(error.message).toContain(`${file}#/effects/0/op`);
  });

  it('AC-2: a missing op or delivery kind is named too; a non-object effect keeps zod’s message', () => {
    expect(issues(withEffect({ status: 'warded' }))).toEqual([
      expect.stringMatching(/^effects\.0\.op: missing effect op; known: damage/),
    ]);
    expect(issues({ ...minimal, delivery: { kind: 'nope' } })).toEqual([
      'delivery.kind: unknown delivery kind "nope"; known: self, touch, projectile, aoe, beam, summonPoint',
    ]);
    expect(issues(withEffect('status'))).toEqual([
      'effects.0: Invalid input: expected object, received string',
    ]);
    expect(issues({ ...minimal, effects: [] })).toEqual([
      expect.stringMatching(/^effects: Too small/),
    ]);
  });

  it('AC-3: a negative mana cost or cast time fails with a range error', () => {
    const result = spellSchema.safeParse({ ...minimal, cost: { mana: -1 }, castTime: -0.5 });
    expect(result.error?.issues.map((i) => [i.path.join('.'), i.code])).toEqual([
      ['cost.mana', 'too_small'],
      ['castTime', 'too_small'],
    ]);
    expect(issues({ ...minimal, cooldown: -1 })).toEqual([
      expect.stringMatching(/^cooldown: Too small: expected number to be >=0/),
    ]);
    expect(issues({ ...minimal, tier: 6 })).toEqual([expect.stringMatching(/^tier: Too big/)]);
  });

  it('AC-4: two spell files with the same id fail to load with a duplicate-id error listing both', () => {
    const error = loadError({
      'content/spell/a.json': ward,
      'content/spell/b.json': ward,
    });
    expect(error.issues).toEqual([
      {
        file: 'content/spell/b.json',
        pointer: '/id',
        message: 'duplicate id spell:fixture-ward: already defined in content/spell/a.json',
      },
    ]);
  });

  it('AC-5: a missing vfxCue or sfxCue fails: placeholders must still be named', () => {
    const noVfx: Partial<SpellDefinitionInput> = { ...minimal };
    const noSfx: Partial<SpellDefinitionInput> = { ...minimal };
    delete noVfx.vfxCue;
    delete noSfx.sfxCue;
    expect(issues(noVfx)).toEqual([
      'vfxCue: required: name a cue (a placeholder is fine), e.g. "vfx-spell-fire-ember"',
    ]);
    expect(issues(noSfx)).toEqual([
      'sfxCue: required: name a cue (a placeholder is fine), e.g. "sfx-spell-fire-ember-cast"',
    ]);
    expect(issues({ ...minimal, vfxCue: '' })).toEqual([
      'vfxCue: must be a cue id, e.g. "vfx-spell-fire-ember"',
    ]);
    expect(issues({ ...minimal, sfxCue: 'vfx-spell-arcane-test' })).toEqual([
      'sfxCue: must be a cue id, e.g. "sfx-spell-fire-ember-cast"',
    ]);
    expect(issues({ ...minimal, vfxCue: 7 })).toEqual([
      'vfxCue: Invalid input: expected string, received number',
    ]);
  });

  it('rejects a follow-on that is itself or listed twice, and a repeated tag', () => {
    expect(issues({ ...minimal, next: ['test-spell', 'other', 'other'] })).toEqual([
      'next.0: spell "test-spell": cannot lead to itself',
      'next: spell "test-spell": lists a follow-on spell twice',
    ]);
    expect(issues({ ...minimal, tags: ['fire', 'fire'] })).toEqual([
      'tags: spell "test-spell": lists a tag twice',
    ]);
  });

  it('checks channel timing and aoe aim range', () => {
    const channel = { interval: 2, manaPerSecond: 1, maxDuration: 1 };
    expect(issues({ ...minimal, channel })).toEqual([
      'channel.interval: spell "test-spell": channel interval is longer than its maxDuration',
    ]);
    expect(issues({ ...minimal, channel: { ...channel, maxDuration: 2 } })).toEqual([]);
    const aoe = { kind: 'aoe', shape: { kind: 'sphere', radius: 3 } };
    expect(issues({ ...minimal, delivery: { ...aoe, range: 10 } })).toEqual([
      'delivery.range: spell "test-spell": a caster-centred area has no aim range (use origin "aim")',
    ]);
    expect(issues({ ...minimal, delivery: { ...aoe, origin: 'aim', range: 10 } })).toEqual([]);
    expect(
      issues({ ...minimal, delivery: { ...aoe, shape: { kind: 'cone', length: 5, angle: 190 } } }),
    ).toEqual([expect.stringMatching(/^delivery\.shape\.angle: Too big/)]);
  });

  it('requires a gas id exactly for gas stimuli and gas volumes', () => {
    const shape = { kind: 'sphere', radius: 2 };
    const volume = { op: 'spawnVolume', shape, intensity: 1, duration: 5 };
    expect(issues(withEffect({ op: 'stimulus', element: 'gas', intensity: 1, radius: 1 }))).toEqual(
      ['effects.0.gas: spell "test-spell": a gas stimulus needs a gas type id'],
    );
    expect(issues(withEffect({ ...volume, element: 'heat', gas: 'smoke' }))).toEqual([
      'effects.0.gas: spell "test-spell": only gas stimuli name a gas (element is "heat")',
    ]);
    expect(issues(withEffect({ ...volume, element: 'gas', gas: 'smoke' }))).toEqual([]);
    expect(issues(withEffect({ op: 'stimulus', element: 'lava', intensity: 1 }))).toEqual([
      expect.stringMatching(/^effects\.0\.element: Invalid option/),
    ]);
  });

  it('AC-4 (mw-e06.5): a stimulus needs a radius, a ray or contact, else it fails validation', () => {
    const base = { op: 'stimulus', element: 'heat', intensity: 100 };
    const failure =
      'effects.0.radius: spell "test-spell": stimulus needs point radius, ray or volume (set a radius above 0, a ray, or contact)';
    expect(issues(withEffect(base))).toEqual([failure]);
    expect(issues(withEffect({ ...base, radius: 0 }))).toEqual([failure]);
    expect(issues(withEffect({ ...base, radius: 1.5 }))).toEqual([]);
    expect(issues(withEffect({ ...base, ray: {} }))).toEqual([]);
    expect(issues(withEffect({ ...base, ray: { width: 0.5 } }))).toEqual([]);
    expect(issues(withEffect({ ...base, contact: true }))).toEqual([]);
    const bolt = {
      kind: 'projectile',
      speed: 20,
      maxRange: 30,
      radius: 0.2,
      onExpire: [base],
    };
    expect(issues({ ...minimal, delivery: bolt })).toEqual([
      failure
        .replace('effects.0', 'delivery.onExpire.0')
        .replace('spell "test-spell": ', 'spell "test-spell": '),
    ]);
  });

  it('a summon consumes a canonical world property, naming the canonical key for another spelling', () => {
    const summon = (property: string) =>
      withEffect({
        op: 'summon',
        creature: 'fixture-guard',
        duration: 10,
        consumes: { property, radius: 3 },
      });
    expect(issues(summon('remains'))).toEqual([]);
    expect(issues(summon('Remains'))).toEqual([
      'effects.0.consumes.property: "Remains" is not a world property; use the canonical key "remains"',
    ]);
    expect(issues(summon('soft_anchor'))).toEqual([
      'effects.0.consumes.property: "soft_anchor" is not a world property; use the canonical key "softAnchor"',
    ]);
    expect(issues(summon('bones'))).toEqual([
      'effects.0.consumes.property: unknown world property "bones"',
    ]);
  });

  it('rejects unknown fields on the spell and inside an op', () => {
    expect(issues({ ...minimal, manaCost: 5 })).toEqual([
      expect.stringMatching(/^: Unrecognized key: "manaCost"/),
    ]);
    expect(issues(withEffect({ op: 'noise', phase: 'impact', loudness: 5, volume: 3 }))).toEqual([
      expect.stringMatching(/^effects\.0: Unrecognized key: "volume"/),
    ]);
  });
});

// Every shipped spell (mw-e08) gets these per-entry checks and content-coverage credit. The game ships
// no spells yet, and Vitest rejects an empty suite, so the per-entry suite starts with the first one.
if (loadGameContent().all('spell').length > 0) {
  describeContent(
    'spell',
    'AC-5: names its VFX and SFX cues and at least one effect op',
    (spell) => {
      expect(spell.vfxCue).toMatch(/^vfx-/);
      expect(spell.sfxCue).toMatch(/^sfx-/);
      expect(spell.effects.length).toBeGreaterThan(0);
    },
  );
}
