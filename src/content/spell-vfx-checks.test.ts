import { describe, expect, it } from 'vitest';
import { gameContentSources } from './game-content.ts';
import { ContentLoadError, loadContent, type ContentSource } from './loader.ts';
import { contentChecks, contentTypes } from './registry.ts';

const spellText = (vfx: unknown) =>
  JSON.stringify({
    id: 'fixture-vfx-spell',
    name: 'Fixture Vfx',
    school: 'arcane',
    tier: 1,
    next: [],
    cost: { mana: 10 },
    castTime: 0.5,
    cooldown: 4,
    delivery: { kind: 'self' },
    effects: [{ op: 'noise', phase: 'release', loudness: 10 }],
    tags: ['defence'],
    vfxCue: 'vfx-spell-arcane-fixture-ward',
    sfxCue: 'sfx-spell-arcane-fixture-ward-cast',
    flags: { tooUseful: false, castWhileMoving: true },
    vfx,
  });

function issues(vfx: unknown): string[] {
  const extra: ContentSource = {
    path: 'src/content/data/spell/fixture-vfx-spell.json',
    text: spellText(vfx),
  };
  try {
    loadContent(contentTypes, [...gameContentSources(), extra], contentChecks);
  } catch (error) {
    if (!(error instanceof ContentLoadError)) throw error;
    return error.issues.map((i) => `${i.file}#${i.pointer}: ${i.message}`);
  }
  return [];
}

describe('spell VFX block validation (mw-e29.10)', () => {
  it('AC-1: a block that names templates only validates', () => {
    expect(
      issues({
        castWindup: { template: 'svt-windup-gather' },
        projectile: { template: 'svt-projectile-bolt', tint: '#FF7A1A', scale: 1.5 },
        area: { template: 'svt-area-rune-ring' },
      }),
    ).toEqual([]);
  });

  it('a slot may be left out: a spell with no vfx block at all still loads', () => {
    expect(issues(undefined)).toEqual([]);
  });

  it('AC-1: a template that fills another slot fails, naming spell, slot and template', () => {
    expect(issues({ beam: { template: 'svt-area-rune-ring' } })).toEqual([
      expect.stringContaining(
        'spell:fixture-vfx-spell puts template "svt-area-rune-ring" (a area template) in its beam slot',
      ),
    ]);
  });

  it('an unknown template or a bad tint fails the load', () => {
    expect(issues({ impact: { template: 'svt-nope' } }).join('\n')).toContain('svt-nope');
    expect(issues({ impact: { template: 'svt-impact-burst', tint: 'red' } }).join('\n')).toContain(
      'colour',
    );
  });
});
