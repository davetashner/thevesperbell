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
      'bottle',
      'bridge-plank',
      'chandelier',
      'clay-pot',
      'crate',
      'lever',
      'limp-body',
      'plank',
    ]);
  });

  it('markExercised appends type:id to the test meta', ({ task }) => {
    markExercised(task, 'testprop', 'crate');
    markExercised(task, 'testprop', 'plank');
    expect(task.meta.contentEntries).toEqual(['testprop:crate', 'testprop:plank']);
  });
});
