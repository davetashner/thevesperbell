import { describe, expect, it } from 'vitest';
import { gameContentSources, loadGameContent } from '../game-content.ts';
import { ContentLoadError, loadContent, type ContentSource } from '../loader.ts';
import { contentChecks, contentTypes } from '../registry.ts';
import { serializeContent } from '../schema.ts';
import { describeContent } from '../testing.ts';
import {
  CAPABILITY_ID_PATTERN,
  capabilityKeys,
  capabilitySchema,
  climbDifficultyGrants,
  type CapabilityGroupInput,
} from './capability.ts';

const group = (id: string, ids: readonly string[]): CapabilityGroupInput => ({
  id,
  name: 'Test',
  notes: 'Test.',
  capabilities: ids.map((cap) => ({ id: cap, name: cap, description: 'Test.' })),
});

const problems = (value: unknown) =>
  (capabilitySchema.safeParse(value).error?.issues ?? []).map(
    (i) => `${i.path.join('.')}: ${i.message}`,
  );

function loadIssues(extra: readonly ContentSource[]): string[] {
  try {
    loadContent(contentTypes, [...gameContentSources(), ...extra], contentChecks);
  } catch (error) {
    if (!(error instanceof ContentLoadError)) throw error;
    return error.issues.map((i) => `${i.file}#${i.pointer}: ${i.message}`);
  }
  return [];
}

describe('capability schema (mw-e15.1)', () => {
  it('accepts every capability family', () => {
    const ids = ['verb.climb.ledge', 'spell.ember', 'arrow.rope', 'tool.lockpick'];
    const all = [...ids, 'trick.shadow-step', 'technique.shield-charge', 'sense.detect-magic'];
    expect(problems(group('test', all))).toEqual([]);
  });

  it('rejects malformed ids and ids declared twice in a file', () => {
    expect(problems(group('test', ['frost', 'spell.frost', 'spell.frost', 'Spell.x']))).toEqual([
      'capabilities.0.id: must be a capability id, e.g. "spell.mage-hand"',
      'capabilities.3.id: must be a capability id, e.g. "spell.mage-hand"',
      'capabilities.2.id: "spell.frost" is declared twice in this file',
    ]);
  });

  it('rejects an id declared in two files, naming the first', () => {
    const extra = {
      path: 'src/content/data/capability/zz-test.json',
      text: JSON.stringify(group('zz-test', ['spell.mage-hand'])),
    };
    expect(loadIssues([extra])).toEqual([
      'src/content/data/capability/zz-test.json#/capabilities/0/id: capability "spell.mage-hand" is already declared in src/content/data/capability/spells.json',
    ]);
  });
});

describe('capability definitions (mw-e19.2)', () => {
  const one = (fields: Record<string, unknown>) => ({
    id: 'test',
    name: 'Test',
    notes: 'Test.',
    capabilities: [{ id: 'spell.ember', name: 'Ember', description: 'Ignite.', ...fields }],
  });

  it('takes localisation keys, an icon, a class affinity and the cross-class and supporting flags', () => {
    const full = {
      nameKey: 'capability.spell.ember.name',
      descKey: 'capability.spell.ember.desc',
      icon: 'spell-ember',
      classAffinity: 'sorcerer',
      crossClass: true,
      supporting: false,
    };
    expect(problems(one(full))).toEqual([]);
    expect(problems(one({}))).toEqual([]);
  });

  it('rejects a cross-class flag without a class, a bad key, an unknown class and stray fields', () => {
    expect(problems(one({ crossClass: true }))).toEqual([
      'capabilities.0.crossClass: crossClass needs a classAffinity: a capability without one is already for any class',
    ]);
    expect(problems(one({ nameKey: 'Ember Name' }))).toEqual([
      'capabilities.0.nameKey: must be a localisation key, e.g. "capability.spell.ember.name"',
    ]);
    expect(problems(one({ classAffinity: 'bard' }))).toHaveLength(1);
    expect(problems(one({ xp: 100 }))).toHaveLength(1);
  });

  it('defaults the localisation keys from the id', () => {
    const def = { id: 'spell.ember', name: 'Ember', description: 'Ignite.' };
    expect(capabilityKeys(def)).toEqual({
      nameKey: 'capability.spell.ember.name',
      descKey: 'capability.spell.ember.desc',
    });
    expect(capabilityKeys({ ...def, nameKey: 'a.b', descKey: 'c.d' })).toEqual({
      nameKey: 'a.b',
      descKey: 'c.d',
    });
  });

  it('AC-4: the capability data files declare unique ids that match the id pattern', () => {
    const content = loadContent(contentTypes, gameContentSources(), contentChecks);
    const ids = content
      .all('capability')
      .flatMap((group) => group.capabilities.map(({ id }) => id));
    expect(ids.length).toBeGreaterThan(0);
    expect(new Set(ids).size).toBe(ids.length);
    expect(CAPABILITY_ID_PATTERN.source).toBe(
      '^(verb|spell|arrow|tool|trick|technique|sense)\\.[a-z0-9.-]+$',
    );
    for (const id of ids) expect(id, id).toMatch(CAPABILITY_ID_PATTERN);
  });
});

describe('the shipped capabilities', () => {
  describeContent('capability', 'parses and round-trips', (entry) => {
    expect(capabilitySchema.parse(JSON.parse(serializeContent(entry)))).toEqual(entry);
  });
});

describe('climb difficulty grants (mw-e10.9)', () => {
  it('AC-1/AC-2: the thief’s rough-stone verb reaches difficulty 3 and nothing else grants one', () => {
    const grants = climbDifficultyGrants(loadGameContent().all('capability'));
    expect(Object.fromEntries(grants)).toEqual({ 'verb.climb.rough': 3 });
  });

  it('collects the grants of every group and takes none from capabilities without one', () => {
    const grants = climbDifficultyGrants([
      { capabilities: [{ id: 'verb.climb.ledge' }, { id: 'tool.grip', climbDifficulty: 2 }] },
      { capabilities: [{ id: 'verb.climb.sheer', climbDifficulty: 3 }] },
    ]);
    expect([...grants]).toEqual([
      ['tool.grip', 2],
      ['verb.climb.sheer', 3],
    ]);
  });

  it('a grant is a whole difficulty from 1 to 3', () => {
    const def = (climbDifficulty: number) => ({
      ...group('test', ['verb.climb.x']),
      capabilities: [{ id: 'verb.climb.x', name: 'x', description: 'x', climbDifficulty }],
    });
    expect(problems(def(3))).toEqual([]);
    expect(problems(def(0))).toHaveLength(1);
    expect(problems(def(4))).toHaveLength(1);
    expect(problems(def(1.5))).toHaveLength(1);
  });
});
