import { describe, expect, it } from 'vitest';
import type { MixController, SnapshotName } from '@audio/index';
import type { AlertState } from '@content/index';
import { AlertStateChanged, Died, HitParried, registerWorldProperties, World } from '@sim/index';
import { bindMix, snapshotForAlert } from './mix-bindings.ts';

function setup() {
  const world = registerWorldProperties(new World({ seed: 1 }));
  const log: string[] = [];
  let snapshot: SnapshotName = 'explore';
  const mix = {
    get snapshot() {
      return snapshot;
    },
    setSnapshot: (name: SnapshotName) => {
      snapshot = name;
      log.push(`snapshot:${name}`);
    },
    duck: (name: string, now: number) => log.push(`duck:${name}@${String(now)}`),
  } as unknown as MixController;
  let time = 5;
  const bindings = bindMix({ world, mix, now: () => time });
  const alert = (entity: number, to: AlertState): void => {
    world.events.emit(AlertStateChanged, { tick: 0, entity, from: 'unaware', to, cause: 'test' });
    world.step();
  };
  return {
    world,
    mix,
    log,
    bindings,
    alert,
    setTime: (t: number) => {
      time = t;
    },
  };
}

describe('mix bindings', () => {
  it('maps the highest alert state to a snapshot', () => {
    expect(snapshotForAlert(undefined)).toBe('explore');
    expect(snapshotForAlert('unaware')).toBe('explore');
    expect(snapshotForAlert('suspicious')).toBe('stealth');
    expect(snapshotForAlert('alerted')).toBe('stealth');
    expect(snapshotForAlert('combat')).toBe('combat');
  });

  it('AC-1: the first creature entering combat moves explore to combat; the highest state wins', () => {
    const { mix, alert } = setup();
    alert(1, 'suspicious');
    expect(mix.snapshot).toBe('stealth');
    alert(2, 'combat');
    expect(mix.snapshot).toBe('combat');
    alert(3, 'suspicious'); // calmer than the fight: no change
    expect(mix.snapshot).toBe('combat');
    alert(3, 'unaware');
    alert(2, 'searching');
    expect(mix.snapshot).toBe('stealth');
    alert(1, 'unaware');
    alert(2, 'unaware');
    expect(mix.snapshot).toBe('explore');
  });

  it('a creature that dies stops counting', () => {
    const { world, mix, alert } = setup();
    alert(3, 'combat');
    world.events.emit(Died, { tick: 0, target: 3, killer: null, source: null, tags: [] });
    world.step();
    expect(mix.snapshot).toBe('explore');
    world.events.emit(Died, { tick: 0, target: 9, killer: null, source: null, tags: [] });
    world.step(); // not tracked: no change
  });

  it('the pause snapshot wins while open and the alert snapshot returns on close', () => {
    const { mix, alert, bindings } = setup();
    alert(1, 'combat');
    bindings.setPaused(true);
    expect(mix.snapshot).toBe('paused');
    alert(1, 'unaware');
    expect(mix.snapshot).toBe('paused');
    bindings.setPaused(false);
    expect(mix.snapshot).toBe('explore');
  });

  it('a parry ducks, and dispose stops listening', () => {
    const { world, log, bindings, setTime } = setup();
    setTime(1234);
    world.events.emit(HitParried, {
      tick: 1,
      entity: 1,
      attacker: 2,
      source: null,
      parriedTicks: 9,
    });
    world.step();
    expect(log).toContain('duck:parry@1234');
    bindings.dispose();
    const before = log.length;
    world.events.emit(HitParried, {
      tick: 2,
      entity: 1,
      attacker: 2,
      source: null,
      parriedTicks: 9,
    });
    world.step();
    expect(log).toHaveLength(before);
  });
});
