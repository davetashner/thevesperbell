// The sim's typed event bus (mw-e00.15). Emitting only queues; nothing is delivered until the world
// flushes the bus at a phase boundary (after each system). Delivery is one FIFO queue: an event
// emitted by a handler goes to the back, so it is delivered after the current event and after
// everything already queued. A runaway chain of handlers (A emits B emits A…) trips a cycle guard
// instead of hanging the tick.

/** A typed event channel. Create one with `defineEvent`; the type parameter is the payload type. */
export interface EventType<T> {
  readonly name: string;
  /** Phantom marker so payload types don't collapse structurally; never read at runtime. */
  readonly __payload?: (payload: T) => void;
}

export type EventHandler<T> = (payload: T) => void;

/** Defines an event type. Payloads should be plain data. */
export function defineEvent<T>(name: string): EventType<T> {
  if (name === '') throw new RangeError('event name must not be empty');
  return { name };
}

/** Thrown when one flush delivers more events than the bus allows (a likely emit cycle). */
export class EventCycleError extends Error {
  override readonly name = 'EventCycleError';
}

/** Default cycle guard: the most events one flush may deliver. */
export const DEFAULT_MAX_EVENTS_PER_FLUSH = 10_000;

interface Queued {
  readonly type: EventType<unknown>;
  readonly payload: unknown;
}

/** An open hold over some event types (see `EventBus.hold`). */
export interface EventHold {
  /** Releases the held events, in order, to the enclosing hold or the queue. */
  commit(): void;
  /** Drops the held events. */
  rollback(): void;
}

interface HoldFrame {
  readonly types: ReadonlySet<EventType<unknown>>;
  readonly held: Queued[];
}

export class EventBus {
  private readonly holds: HoldFrame[] = [];
  /** Per type; the list is replaced, never mutated, so a flush in progress iterates a snapshot. */
  private readonly channels = new Map<EventType<unknown>, { handlers: EventHandler<unknown>[] }>();
  private queue: Queued[] = [];
  private flushing = false;

  constructor(readonly maxEventsPerFlush: number = DEFAULT_MAX_EVENTS_PER_FLUSH) {
    if (!Number.isSafeInteger(maxEventsPerFlush) || maxEventsPerFlush < 1) {
      throw new RangeError(
        `maxEventsPerFlush must be a positive integer, got ${String(maxEventsPerFlush)}`,
      );
    }
  }

  /** Subscribes; handlers of one type run in subscription order. Returns an unsubscribe function. */
  on<T>(type: EventType<T>, handler: EventHandler<T>): () => void {
    // Stored type-erased; emit() pairs each payload with its own EventType, so T always matches.
    const erasedType = type as EventType<unknown>;
    const erased = handler as EventHandler<unknown>;
    let channel = this.channels.get(erasedType);
    if (channel === undefined) {
      channel = { handlers: [] };
      this.channels.set(erasedType, channel);
    }
    const subscribed = channel;
    subscribed.handlers = [...subscribed.handlers, erased];
    return () => {
      subscribed.handlers = subscribed.handlers.filter((h) => h !== erased);
    };
  }

  /** Queues an event for the next flush. */
  emit<T>(type: EventType<T>, payload: T): void {
    this.route({ type: type as EventType<unknown>, payload }, this.holds.length);
  }

  /** Sends `entry` to the innermost hold below `above` that holds its type, else to the queue. */
  private route(entry: Queued, above: number): void {
    const hold = this.holds.slice(0, above).findLast((frame) => frame.types.has(entry.type));
    if (hold !== undefined) {
      hold.held.push(entry);
      return;
    }
    this.queue.push(entry);
  }

  /**
   * Holds events of `types` instead of queueing them, for a transaction that may roll back
   * (mw-e22.16). `commit` releases them in order, to the enclosing hold of their type if there is
   * one (so a nested commit folds into its parent) or else to the queue; `rollback` drops them.
   * Holds of different types may settle in any order; each settles exactly once. Other event types
   * are untouched.
   */
  hold(types: readonly EventType<never>[]): EventHold {
    const frame: HoldFrame = { types: new Set(types as readonly EventType<unknown>[]), held: [] };
    this.holds.push(frame);
    const settle = (): number => {
      const index = this.holds.indexOf(frame);
      if (index < 0) throw new Error('event hold settled twice');
      this.holds.splice(index, 1);
      return index;
    };
    return {
      commit: () => {
        const index = settle();
        for (const entry of frame.held) this.route(entry, index);
      },
      rollback: () => {
        settle();
      },
    };
  }

  /** Events waiting for the next flush. */
  get pending(): number {
    return this.queue.length;
  }

  /**
   * Delivers every queued event, including ones emitted by handlers during this flush, in FIFO order.
   * Throws EventCycleError once more than `maxEventsPerFlush` events would be delivered. The queue is
   * empty afterwards even if a handler throws. A flush called from inside a handler is a no-op: the
   * outer flush is already delivering the queue.
   */
  flush(): void {
    if (this.flushing) return;
    this.flushing = true;
    try {
      let delivered = 0;
      // Array iteration sees elements pushed during the loop, which is what makes this one FIFO.
      for (const { type, payload } of this.queue) {
        if (delivered === this.maxEventsPerFlush) {
          throw new EventCycleError(
            `event flush exceeded ${String(this.maxEventsPerFlush)} events (next: "${type.name}"); likely an emit cycle`,
          );
        }
        delivered++;
        const channel = this.channels.get(type);
        if (channel !== undefined) for (const handler of channel.handlers) handler(payload);
      }
    } finally {
      this.queue = [];
      this.flushing = false;
    }
  }

  /** Drops queued events without delivering them (used when restoring a snapshot). */
  clear(): void {
    this.queue = [];
  }
}
