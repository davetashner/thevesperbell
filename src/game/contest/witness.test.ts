// The perception adapter for contests (mw-opf6 AC-2): a watcher has seen the player when its own
// senses reported the player as a seen target within the window; nothing else counts.
import { describe, expect, it } from 'vitest';
import {
  entitySource,
  perceived,
  soundSource,
  World,
  type EntityId,
  type Percept,
} from '@sim/index';
import { PerceptionWitness, WITNESS_WINDOW_TICKS } from './witness';

const player = 1 as EntityId;
const nell = 2 as EntityId;
const spot = { x: 0, y: 0, z: 0 };

const seen = (kind: Percept['kind'], source: Percept['source']): Percept => ({
  source,
  kind,
  sense: 'sight',
  position: spot,
  strength: 1,
  certainty: 1,
});

function setup(withPlayer = true) {
  const world = new World<never>({ seed: 1 });
  const witness = new PerceptionWitness(world, {
    player: () => (withPlayer ? player : undefined),
    resolve: (creature) => (creature === 'npc-nell' ? nell : undefined),
  });
  const report = (agent: EntityId, tick: number, percepts: Percept[]): void => {
    world.events.emit(perceived, { tick, agent, seconds: 0.2, percepts });
    world.events.flush();
  };
  return { witness, report };
}

describe('PerceptionWitness', () => {
  it('AC-2: a watcher who saw the player a moment ago perceives the event', () => {
    const { witness, report } = setup();
    report(nell, 100, [seen('seen-target', entitySource(player))]);
    expect(witness.perceives('npc-nell', { name: 'spell.cast', tick: 100 })).toBe(true);
    expect(
      witness.perceives('npc-nell', { name: 'spell.cast', tick: 100 + WITNESS_WINDOW_TICKS }),
    ).toBe(true);
  });

  it('AC-2: a sighting older than the window does not count', () => {
    const { witness, report } = setup();
    report(nell, 100, [seen('seen-target', entitySource(player))]);
    expect(witness.perceives('npc-nell', { name: 'x', tick: 100 + WITNESS_WINDOW_TICKS + 1 })).toBe(
      false,
    );
  });

  it('AC-2: a watcher who never saw the player, saw something else or is not in the scene does not', () => {
    const { witness, report } = setup();
    expect(witness.perceives('npc-nell', { name: 'x', tick: 5 })).toBe(false);
    report(nell, 5, []);
    report(nell, 5, [seen('seen-target', entitySource(9))]);
    report(nell, 5, [seen('heard-noise', soundSource('cast'))]);
    report(nell, 5, [seen('seen-anomaly', entitySource(player))]);
    expect(witness.perceives('npc-nell', { name: 'x', tick: 5 })).toBe(false);
    expect(witness.perceives('npc-oona', { name: 'x', tick: 5 })).toBe(false);
  });

  it('without a player nothing is seen, and a disposed witness stops listening', () => {
    const none = setup(false);
    none.report(nell, 5, [seen('seen-target', entitySource(player))]);
    expect(none.witness.perceives('npc-nell', { name: 'x', tick: 5 })).toBe(false);
    const live = setup();
    live.witness.dispose();
    live.report(nell, 5, [seen('seen-target', entitySource(player))]);
    expect(live.witness.perceives('npc-nell', { name: 'x', tick: 5 })).toBe(false);
  });
});
