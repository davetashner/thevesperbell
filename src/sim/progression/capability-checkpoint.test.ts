import { describe, expect, it } from 'vitest';
import { World } from '../core/world';
import {
  addCapabilities,
  capabilitiesOf,
  CapabilityRegistry,
  capabilityGained,
} from './capabilities';
import { capabilityCheckpoint } from './capability-checkpoint';

function setup() {
  const world = new World<never>({ seed: 1, hz: 60 });
  const actor = world.spawn();
  addCapabilities(world, actor);
  world.step();
  return { world, actor, registry: new CapabilityRegistry(['a', 'b']) };
}

describe('capabilityCheckpoint (mw-e23.11)', () => {
  it('rollback takes back grants made after it opened', () => {
    const { world, actor, registry } = setup();
    registry.grant(world, actor, 'a', 'learned');
    const checkpoint = capabilityCheckpoint(world, actor);
    registry.grant(world, actor, 'b', 'learned');
    checkpoint.rollback();
    expect(capabilitiesOf(world, actor)).toEqual(['a']);
  });

  it('commit keeps them', () => {
    const { world, actor, registry } = setup();
    const checkpoint = capabilityCheckpoint(world, actor);
    registry.grant(world, actor, 'b', 'learned');
    checkpoint.commit();
    expect(capabilitiesOf(world, actor)).toEqual(['b']);
  });

  it('an actor with no capability set has nothing to restore', () => {
    const world = new World<never>({ seed: 1, hz: 60 });
    const actor = world.spawn();
    expect(() => {
      capabilityCheckpoint(world, actor).rollback();
    }).not.toThrow();
  });
});

describe('capabilityCheckpoint events (mw-e22.16)', () => {
  const heard = (world: World<never>) => {
    const log: string[] = [];
    world.events.on(capabilityGained, (e) => log.push(e.capability));
    return log;
  };

  it('holds gained events until commit, in order', () => {
    const { world, actor, registry } = setup();
    const log = heard(world);
    const checkpoint = capabilityCheckpoint(world, actor);
    registry.grant(world, actor, 'a', 'learned');
    registry.grant(world, actor, 'b', 'learned');
    world.events.flush();
    expect(log).toEqual([]);
    checkpoint.commit();
    world.events.flush();
    expect(log).toEqual(['a', 'b']);
  });

  it('drops them on rollback and folds nested commits into the parent', () => {
    const { world, actor, registry } = setup();
    const log = heard(world);
    const outer = capabilityCheckpoint(world, actor);
    const inner = capabilityCheckpoint(world, actor);
    registry.grant(world, actor, 'a', 'learned');
    inner.commit();
    outer.rollback();
    world.events.flush();
    expect(log).toEqual([]);
  });

  it('emits at once outside a checkpoint', () => {
    const { world, actor, registry } = setup();
    const log = heard(world);
    registry.grant(world, actor, 'a', 'learned');
    world.events.flush();
    expect(log).toEqual(['a']);
  });
});
