import { describe, expect, it } from 'vitest';
import { World } from '../core/world';
import { addCapabilities, CapabilityRegistry, capabilitiesOf } from './capabilities';
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
