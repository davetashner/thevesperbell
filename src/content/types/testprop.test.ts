import { describe, expect, it } from 'vitest';
import { loadGameContent } from '../game-content.ts';
import { describeContent } from '../testing.ts';
import { testPropSchema } from './testprop.ts';

describeContent('testprop', 'AC-6: validates and is deeply frozen', (entry, content) => {
  expect(Object.isFrozen(entry)).toBe(true);
  expect(Object.isFrozen(entry.tags)).toBe(true);
  expect(entry.mass).toBeGreaterThan(0);
  if (entry.breaksInto !== undefined) {
    expect(Object.isFrozen(entry.breaksInto)).toBe(true);
    expect(content.resolve(entry.breaksInto).mass).toBeLessThan(entry.mass);
  }
  if (entry.body !== undefined) {
    expect(Object.isFrozen(entry.body.size)).toBe(true);
    expect(content.resolve(entry.body.material).id).toBe(entry.body.material.id);
  }
});

describe('testprop content', () => {
  it('AC-6: the example has two entries, one breaking into the other', () => {
    const content = loadGameContent();
    expect(Object.isFrozen(content)).toBe(true);
    expect(content.all('testprop').map((p) => p.id)).toEqual([
      'barrel',
      'bottle',
      'clay-pot',
      'crate',
      'lever',
      'plank',
    ]);
    expect(content.get('testprop', 'crate').breaksInto?.toString()).toBe('testprop:plank');
    expect(content.get('testprop', 'plank').tags).toEqual([]);
  });

  it('mw-e03.39: a body needs a positive box size and a known material', () => {
    const content = loadGameContent();
    expect(content.get('testprop', 'crate').body?.material.id).toBe('wood');
    const crate = { id: 'crate', name: 'Crate', mass: 1, flammable: false };
    const body = (value: unknown) => testPropSchema.safeParse({ ...crate, body: value }).success;
    expect(body({ size: [1, 1, 1], material: 'wood' })).toBe(true);
    expect(body({ size: [1, 0, 1], material: 'wood' })).toBe(false);
    expect(body({ size: [1, 1, 1] })).toBe(false);
    expect(body({ size: [1, 1, 1], material: 'wood', mass: 3 })).toBe(false);
  });
});
