import { describe, expect, it } from 'vitest';
import { DEFAULT_MAX_EVENTS_PER_FLUSH, defineEvent, EventBus, EventCycleError } from './events';

const Noise = defineEvent<{ loudness: number }>('Noise');
const Alarm = defineEvent<string>('Alarm');

describe('EventBus', () => {
  it('queues on emit and delivers only when flushed, in emission order', () => {
    const bus = new EventBus();
    const seen: string[] = [];
    bus.on(Alarm, (who) => seen.push(who));
    bus.emit(Alarm, 'a');
    bus.emit(Alarm, 'b');
    expect(seen).toEqual([]);
    expect(bus.pending).toBe(2);
    bus.flush();
    expect(seen).toEqual(['a', 'b']);
    expect(bus.pending).toBe(0);
  });

  it('AC-4: an event emitted by a handler is delivered after the current event, FIFO', () => {
    const bus = new EventBus();
    const log: string[] = [];
    bus.on(Noise, ({ loudness }) => {
      log.push(`noise:${String(loudness)}`);
      bus.emit(Alarm, `from-${String(loudness)}`);
    });
    bus.on(Noise, ({ loudness }) => log.push(`noise-second-handler:${String(loudness)}`));
    bus.on(Alarm, (who) => log.push(`alarm:${who}`));
    bus.emit(Noise, { loudness: 1 });
    bus.emit(Noise, { loudness: 2 });
    bus.flush();
    expect(log).toEqual([
      'noise:1',
      'noise-second-handler:1',
      'noise:2',
      'noise-second-handler:2',
      'alarm:from-1',
      'alarm:from-2',
    ]);
  });

  it('AC-4: a cycle guard throws after 10,000 events in one flush', () => {
    const bus = new EventBus();
    expect(bus.maxEventsPerFlush).toBe(10_000);
    expect(DEFAULT_MAX_EVENTS_PER_FLUSH).toBe(10_000);
    let delivered = 0;
    bus.on(Noise, (n) => {
      delivered++;
      bus.emit(Noise, n); // endless ping
    });
    bus.emit(Noise, { loudness: 1 });
    expect(() => {
      bus.flush();
    }).toThrow(EventCycleError);
    expect(delivered).toBe(10_000);
    // The runaway queue is dropped; the bus stays usable.
    expect(bus.pending).toBe(0);
    const ok: string[] = [];
    bus.on(Alarm, (a) => ok.push(a));
    bus.emit(Alarm, 'after');
    bus.flush();
    expect(ok).toEqual(['after']);
  });

  it('AC-4: exactly the limit is allowed; one more throws with the next event named', () => {
    const bus = new EventBus(3);
    for (let i = 0; i < 3; i++) bus.emit(Alarm, 'x');
    expect(() => {
      bus.flush();
    }).not.toThrow();
    for (let i = 0; i < 4; i++) bus.emit(Alarm, 'x');
    expect(() => {
      bus.flush();
    }).toThrow(/exceeded 3 events \(next: "Alarm"\)/);
  });

  it('delivers events that have no handlers without error', () => {
    const bus = new EventBus();
    bus.emit(Alarm, 'nobody listens');
    bus.flush();
    expect(bus.pending).toBe(0);
  });

  it('unsubscribes; changes made during a flush apply from the next event', () => {
    const bus = new EventBus();
    const log: string[] = [];
    const offB = bus.on(Alarm, (a) => log.push(`B:${a}`));
    // B runs before A, so A unsubscribing B takes effect from the next event.
    bus.on(Alarm, (a) => {
      log.push(`A:${a}`);
      offB();
    });
    bus.emit(Alarm, '1');
    bus.emit(Alarm, '2');
    bus.flush();
    expect(log).toEqual(['B:1', 'A:1', 'A:2']);
  });

  it('a handler subscribed mid-flush sees later events but not the current one', () => {
    const bus = new EventBus();
    const log: string[] = [];
    let subscribed = false;
    bus.on(Alarm, (a) => {
      log.push(`first:${a}`);
      if (!subscribed) {
        subscribed = true;
        bus.on(Alarm, (b) => log.push(`late:${b}`));
      }
    });
    bus.emit(Alarm, '1');
    bus.emit(Alarm, '2');
    bus.flush();
    expect(log).toEqual(['first:1', 'first:2', 'late:2']);
  });

  it('treats a flush from inside a handler as a no-op (the outer flush delivers)', () => {
    const bus = new EventBus();
    const log: string[] = [];
    bus.on(Noise, () => {
      bus.emit(Alarm, 'nested');
      bus.flush();
      log.push('after inner flush');
    });
    bus.on(Alarm, (a) => log.push(a));
    bus.emit(Noise, { loudness: 1 });
    bus.flush();
    expect(log).toEqual(['after inner flush', 'nested']);
  });

  it('empties the queue when a handler throws', () => {
    const bus = new EventBus();
    bus.on(Alarm, () => {
      throw new Error('boom');
    });
    bus.emit(Alarm, 'a');
    bus.emit(Alarm, 'b');
    expect(() => {
      bus.flush();
    }).toThrow('boom');
    expect(bus.pending).toBe(0);
  });

  it('clear() drops queued events', () => {
    const bus = new EventBus();
    const log: string[] = [];
    bus.on(Alarm, (a) => log.push(a));
    bus.emit(Alarm, 'a');
    bus.clear();
    bus.flush();
    expect(log).toEqual([]);
  });

  it.each([0, -1, 1.5, Number.NaN])('rejects maxEventsPerFlush %s', (n) => {
    expect(() => new EventBus(n)).toThrow(RangeError);
  });

  it('rejects an empty event name', () => {
    expect(() => defineEvent('')).toThrow(RangeError);
  });
});

describe('EventBus.hold (mw-e22.16)', () => {
  const A = defineEvent<number>('hold.a');
  const B = defineEvent<number>('hold.b');

  it('holds only its types, releases in order on commit, drops on rollback', () => {
    const bus = new EventBus();
    const seen: string[] = [];
    bus.on(A, (n) => seen.push(`a${String(n)}`));
    bus.on(B, (n) => seen.push(`b${String(n)}`));
    const kept = bus.hold([A]);
    bus.emit(A, 1);
    bus.emit(B, 1);
    bus.emit(A, 2);
    kept.commit();
    const dropped = bus.hold([A]);
    bus.emit(A, 3);
    dropped.rollback();
    bus.flush();
    expect(seen).toEqual(['b1', 'a1', 'a2']);
  });

  it('settles in any order but only once', () => {
    const bus = new EventBus();
    const outer = bus.hold([A]);
    const inner = bus.hold([A]);
    outer.commit();
    expect(() => {
      outer.commit();
    }).toThrow('settled twice');
    inner.rollback();
  });
});
