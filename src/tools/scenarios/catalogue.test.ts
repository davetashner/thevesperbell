import { describe, expect, it } from 'vitest';
import { renderCatalogue } from './catalogue';
import { loadScenarios } from './files';
import type { Scenario } from './schema';

describe('emergence catalogue doc (mw-e03.27)', () => {
  const [first] = loadScenarios();
  if (first === undefined) throw new Error('no scenarios');

  const scenario: Scenario = {
    ...first,
    id: 'all-kinds',
    title: 'Every kind of input',
    setup: { props: 'a plate', properties: [{ target: 'crate-a', property: 'fuel', value: 3 }] },
    inputs: [
      { tick: 1, stimulus: { element: 'heat', at: 'crate-a', radius: 1, intensity: 500 } },
      { tick: 2, blast: { at: [1, 2, 3], radius: 2, intensity: 90 } },
      { tick: 3, set: { target: 'crate-a', property: 'hp', value: 5 } },
    ],
    outcomes: [
      {
        tick: 9,
        target: { spawn: 'crate-a' },
        reading: 'alive',
        op: 'eq',
        value: false,
        sees: 'It is gone.',
      },
      {
        tick: 9,
        target: { tag: 'ident', which: 'all' },
        reading: 'burning',
        op: 'ne',
        value: true,
        sees: 'Calm.',
      },
    ],
    ticks: 10,
  };

  it('describes the setup, each kind of input and each kind of target', () => {
    const doc = renderCatalogue([scenario]);
    expect(doc).toContain('1 scenarios.');
    expect(doc).toContain('## Every kind of input');
    expect(doc).toContain('- before the first tick: fuel of crate-a is 3');
    expect(doc).toContain('tick 1: heat stimulus of 500 at crate-a (radius 1 m)');
    expect(doc).toContain('tick 2: force blast of 90 at (1, 2, 3) (radius 2 m)');
    expect(doc).toContain('tick 3: set hp of crate-a to 5');
    expect(doc).toContain('tick 9: It is gone. (`alive` of crate-a eq false)');
    expect(doc).toContain('all of the `ident` spawns ne true');
  });

  it('lists every scenario in the index', () => {
    const doc = renderCatalogue(loadScenarios());
    for (const s of loadScenarios()) expect(doc).toContain(`(#${s.id})`);
  });
});
