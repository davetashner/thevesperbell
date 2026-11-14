import { describe, expect, it } from 'vitest';
import { DEATH_DISSOLVE_DELAY_SECONDS } from '@render/magic-materials/rules';
import { CorpseDissolves, DissolveTimeline } from './magic-materials.ts';

describe('dissolve timing', () => {
  it('a timeline runs each dissolve once and forgets it when it is over', () => {
    const timeline = new DissolveTimeline<string>();
    const seen: [string, number, boolean][] = [];
    timeline.begin('a', { delay: 0, duration: 1 });
    timeline.begin('a', { delay: 0, duration: 99 }); // already running: ignored
    timeline.begin('b', { delay: 0.5, duration: 1 });
    expect(timeline.size).toBe(2);
    expect(timeline.has('a')).toBe(true);
    timeline.update(0.5, (k, p, f) => seen.push([k, p, f]));
    expect(seen).toEqual([
      ['a', 0.5, false],
      ['b', 0, false],
    ]);
    seen.length = 0;
    timeline.update(0.5, (k, p, f) => seen.push([k, p, f]));
    expect(seen[0]).toEqual(['a', 1, true]);
    expect(timeline.has('a')).toBe(false);
    timeline.cancel('b');
    expect(timeline.size).toBe(0);
    timeline.update(-1, () => {
      throw new Error('nothing runs');
    });
  });
});

describe('corpse dissolves', () => {
  function rig() {
    const log: string[] = [];
    const corpses = new CorpseDissolves<string, { id: string; progress: number }>({
      apply: (key) => {
        log.push(`apply ${key}`);
        return { id: key, progress: -1 };
      },
      progress: (handle, p) => {
        handle.progress = p;
      },
      remove: (key, handle) => {
        log.push(`remove ${key} at ${handle.progress.toFixed(2)}`);
      },
    });
    return { corpses, log };
  }

  it('AC-3: after a death the body is made dissolvable, dissolves over 1.2 s, then is removed', () => {
    const { corpses, log } = rig();
    corpses.died('skeleton');
    corpses.died('skeleton'); // a second Died changes nothing
    expect(corpses.dying('skeleton')).toBe(true);
    expect(corpses.size).toBe(1);
    corpses.update(0.5);
    expect(log).toEqual(['apply skeleton']);
    // Collapse delay over, dissolve about to begin: still there.
    corpses.update(DEATH_DISSOLVE_DELAY_SECONDS - 0.5);
    expect(log).toEqual(['apply skeleton']);
    // 1.19 s into the dissolve: not yet removed.
    corpses.update(1.19);
    expect(log).toEqual(['apply skeleton']);
    corpses.update(0.02);
    expect(log).toEqual(['apply skeleton', 'remove skeleton at 1.00']);
    expect(corpses.dying('skeleton')).toBe(false);
    expect(corpses.size).toBe(0);
  });

  it('each corpse runs its own clock', () => {
    const { corpses, log } = rig();
    corpses.died('a');
    corpses.update(1);
    corpses.died('b');
    corpses.update(DEATH_DISSOLVE_DELAY_SECONDS + 1.2 - 1 + 0.01);
    expect(log).toContain('remove a at 1.00');
    expect(log.some((line) => line.startsWith('remove b'))).toBe(false);
    expect(corpses.size).toBe(1);
  });
});
