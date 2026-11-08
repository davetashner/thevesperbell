import { describe, expect, it } from 'vitest';
import { gameContentSources } from './game-content.ts';
import { ContentLoadError, loadContent, type ContentSource } from './loader.ts';
import { contentChecks, contentTypes } from './registry.ts';

const creatureText = (regions: unknown) =>
  JSON.stringify({
    id: 'fixture-core-beast',
    family: 'animal',
    stats: { health: 100, poise: 10, mass: 100, size: 'large' },
    senses: { base: 'undead' },
    locomotion: { base: 'goblin' },
    audio: {
      idleLoop: 'sfx-beast-idle',
      footsteps: 'sfx-beast-step',
      alertBark: 'sfx-beast-bark-alert',
      telegraph: 'sfx-beast-telegraph',
      hurt: 'sfx-beast-hurt',
      poiseBreak: 'sfx-beast-stagger',
      death: 'sfx-beast-death',
    },
    regions,
  });

function issues(regions: unknown): string[] {
  const extra: ContentSource = {
    path: 'src/content/data/creature/fixture-core-beast.json',
    text: creatureText(regions),
  };
  try {
    loadContent(contentTypes, [...gameContentSources(), extra], contentChecks);
  } catch (error) {
    if (!(error instanceof ContentLoadError)) throw error;
    return error.issues.map((i) => `${i.file}#${i.pointer}: ${i.message}`);
  }
  return [];
}

const weakpoint = { id: 'core', region: 'weakpoint', multiplier: 3 };

describe('weak point validation (mw-e05.6)', () => {
  it('AC-5: a weakpoint region with no enabledIn fails, naming creature and region', () => {
    expect(issues([weakpoint])).toEqual([
      expect.stringContaining('creature:fixture-core-beast weakpoint "core" must declare'),
    ]);
    expect(issues([{ ...weakpoint, enabledIn: [] }])).toHaveLength(1);
  });

  it('AC-5: a weakpoint that declares its enabling states loads', () => {
    expect(issues([{ ...weakpoint, enabledIn: ['roaring'], underlying: 'torso' }])).toEqual([]);
  });

  it('non-weakpoint regions need no enabledIn; armour values are allowed', () => {
    expect(
      issues([
        { id: 'helm', region: 'head' },
        { id: 'plate', region: 'torso', armor: 30 },
      ]),
    ).toEqual([]);
  });

  it('a duplicate region id fails', () => {
    expect(
      issues([
        { id: 'helm', region: 'head' },
        { id: 'helm', region: 'limb' },
      ]),
    ).toEqual([expect.stringContaining('declares region "helm" twice')]);
  });

  it('shipped creatures all pass (none declares an unconditioned weakpoint yet)', () => {
    expect(issues([])).toEqual([]);
  });
});
