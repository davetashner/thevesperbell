import { describe, expect, it } from 'vitest';
import { describeContent, markExercised } from './testing.ts';

const seen: string[] = [];

describeContent('testprop', 'visits every entry once', (entry) => {
  seen.push(entry.id);
});

describe('content test harness', () => {
  it('describeContent generated one named test per entry, credited on the test meta', () => {
    expect(seen).toEqual([
      'anvil',
      'barrel',
      'barrel-breakable',
      'barrel-oil',
      'barrel-weathered',
      'bottle',
      'bridge-plank',
      'cargo-crate',
      'cask-cradle',
      'chandelier',
      'clay-pot',
      'companion-hutch',
      'crate',
      'deck-grating',
      'hawser-coil',
      'keg',
      'lens-stand',
      'lever',
      'limp-body',
      'mirror-stand',
      'pin-rail',
      'plank',
      'rope-coil',
      'statue',
      'stone-block',
      'tiller',
    ]);
  });

  it('markExercised appends type:id to the test meta', ({ task }) => {
    markExercised(task, 'testprop', 'crate');
    markExercised(task, 'testprop', 'plank');
    expect(task.meta.contentEntries).toEqual(['testprop:crate', 'testprop:plank']);
  });
});
