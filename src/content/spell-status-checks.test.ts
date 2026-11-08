import { describe, expect, it } from 'vitest';
import { gameContentSources } from './game-content.ts';
import { ContentLoadError, loadContent, type ContentSource } from './loader.ts';
import { contentChecks, contentTypes } from './registry.ts';

const spellText = (status: string) =>
  JSON.stringify({
    id: 'fixture-bad-status',
    name: 'Bad Status',
    school: 'arcane',
    tier: 1,
    next: [],
    cost: { mana: 10 },
    castTime: 0.5,
    cooldown: 4,
    delivery: { kind: 'self' },
    effects: [{ op: 'status', status, duration: 5, stacks: 1 }],
    tags: ['defence'],
    vfxCue: 'vfx-spell-arcane-fixture-ward',
    sfxCue: 'sfx-spell-arcane-fixture-ward-cast',
    flags: { tooUseful: false, castWhileMoving: true },
  });

function issues(extra: readonly ContentSource[]): string[] {
  try {
    loadContent(contentTypes, [...gameContentSources(), ...extra], contentChecks);
  } catch (error) {
    if (!(error instanceof ContentLoadError)) throw error;
    return error.issues.map((i) => `${i.file}#${i.pointer}: ${i.message}`);
  }
  return [];
}
const file = (status: string): ContentSource => ({
  path: 'src/content/data/spell/fixture-bad-status.json',
  text: spellText(status),
});

describe('spell status validation (mw-e06.25)', () => {
  it('AC-1: a spell whose status op names an undefined status fails, naming spell and status', () => {
    const found = issues([file('rotted')]).filter((m) => m.includes('not a defined status'));
    expect(found).toEqual([
      expect.stringContaining('spell:fixture-bad-status applies status "rotted"'),
    ]);
  });

  it('a spell naming a defined status loads without a status problem', () => {
    expect(issues([file('rooted')]).filter((m) => m.includes('defined status'))).toEqual([]);
  });
});
