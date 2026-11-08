import { describe, expect, it } from 'vitest';
import { AlertStateChanged, World, type EntityId } from '@sim/index';
import { AlertStingerHooks, type MusicStinger } from './stinger-hooks.ts';

describe('alert stinger hooks (mw-e28.8)', () => {
  const setup = () => {
    const world = new World({ seed: 1 });
    const hooks = new AlertStingerHooks({ world });
    const heard: MusicStinger[] = [];
    const off = hooks.on((e) => heard.push(e));
    const change = (
      entity: EntityId,
      from: 'unaware' | 'suspicious' | 'alerted' | 'combat' | 'searching',
      to: 'unaware' | 'suspicious' | 'alerted' | 'combat' | 'searching',
    ) => {
      world.events.emit(AlertStateChanged, {
        tick: world.tick,
        entity,
        from,
        to,
        cause: 'timeout',
      });
      world.step();
    };
    return { world, hooks, heard, off, change };
  };

  it('AC-3: Suspicious, Alerted and Combat each emit a MusicStinger naming the state entered', () => {
    const { world, heard, change } = setup();
    const entity = world.spawn();
    change(entity, 'unaware', 'suspicious');
    change(entity, 'suspicious', 'alerted');
    change(entity, 'alerted', 'combat');
    expect(heard.map((e) => [e.type, e.state, e.from, e.entity])).toEqual([
      ['MusicStinger', 'suspicious', 'unaware', entity],
      ['MusicStinger', 'alerted', 'suspicious', entity],
      ['MusicStinger', 'combat', 'alerted', entity],
    ]);
  });

  it('calming down or searching is no stinger', () => {
    const { world, heard, change } = setup();
    const entity = world.spawn();
    change(entity, 'combat', 'searching');
    change(entity, 'searching', 'unaware');
    expect(heard).toEqual([]);
  });

  it('unsubscribing and disposing stop the events', () => {
    const { world, hooks, heard, off, change } = setup();
    const entity = world.spawn();
    off();
    change(entity, 'unaware', 'suspicious');
    expect(heard).toEqual([]);
    const second: MusicStinger[] = [];
    hooks.on((e) => second.push(e));
    hooks.dispose();
    change(entity, 'suspicious', 'alerted');
    expect(second).toEqual([]);
  });
});
