/* eslint-disable @typescript-eslint/unbound-method -- the scope saves and restores the page's own functions */
// The page-level side effects of one area session (mw-ju8.28), so an area crossing can swap the
// scene in place instead of reloading the page.
//
// A session registers listeners on the window and document, timers and animation frames across a
// couple of hundred call sites. Rather than make each hand back a disposer, the scope notices them as
// they are made (while it is the active scope) and `dispose()` takes every one down again, then runs
// the explicit disposers the session registered for the heavier things (renderer, physics, audio).

/** The parts of the page a scope watches; the browser's own, or a fake in a test. */
export interface ScopeHost {
  readonly targets: EventTarget[];
  readonly timers: {
    setTimeout: typeof setTimeout;
    clearTimeout: typeof clearTimeout;
    setInterval: typeof setInterval;
    clearInterval: typeof clearInterval;
    requestAnimationFrame: typeof requestAnimationFrame;
    cancelAnimationFrame: typeof cancelAnimationFrame;
  };
}

interface Listener {
  readonly target: EventTarget;
  readonly type: string;
  readonly listener: EventListenerOrEventListenerObject;
  readonly options: boolean | AddEventListenerOptions | undefined;
}

export class PageScope {
  private readonly listeners: Listener[] = [];
  private readonly timeouts = new Set<ReturnType<typeof setTimeout>>();
  private readonly intervals = new Set<ReturnType<typeof setInterval>>();
  private readonly frames = new Set<number>();
  private readonly disposers: (() => void)[] = [];
  private restore: (() => void) | undefined;
  private done = false;
  private original: ScopeHost['timers'] | undefined;

  constructor(private readonly host: ScopeHost) {}

  /** Whether the session has ended. */
  get disposed(): boolean {
    return this.done;
  }

  /** Starts noticing what the session registers. */
  begin(): void {
    if (this.restore !== undefined || this.done) return;
    const { host } = this;
    const names = [
      'setTimeout',
      'clearTimeout',
      'setInterval',
      'clearInterval',
      'requestAnimationFrame',
      'cancelAnimationFrame',
    ] as const;
    const original = {
      timers: Object.fromEntries(names.map((name) => [name, host.timers[name]])) as {
        -readonly [K in (typeof names)[number]]: ScopeHost['timers'][K];
      },
    };
    // The saved functions are called as methods of the host (a bare call is an illegal invocation).
    const bound = Object.fromEntries(
      names.map((name) => [
        name,
        (original.timers[name] as (...a: unknown[]) => unknown).bind(host.timers),
      ]),
    ) as unknown as ScopeHost['timers'];
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const scope = this;
    // Whichever object defines `addEventListener` for a target (the page's window and document
    // inherit it from EventTarget.prototype), patched once for all the targets that share it.
    const owners = new Map<object, EventTarget['addEventListener']>();
    for (const target of host.targets) {
      let owner: object | null = target;
      while (owner !== null && !Object.hasOwn(owner, 'addEventListener')) {
        owner = Object.getPrototypeOf(owner) as object | null;
      }
      if (owner !== null && !owners.has(owner)) {
        owners.set(owner, (owner as EventTarget).addEventListener);
      }
    }
    for (const [owner, add] of owners) {
      (owner as EventTarget).addEventListener = function (
        this: EventTarget,
        type: string,
        listener: EventListenerOrEventListenerObject | null,
        options?: boolean | AddEventListenerOptions,
      ): void {
        add.call(this, type, listener, options);
        if (listener !== null && host.targets.includes(this)) {
          scope.listeners.push({ target: this, type, listener, options });
        }
      };
    }
    const timers = host.timers;
    timers.setTimeout = ((handler: TimerHandler, ms?: number, ...args: unknown[]) => {
      const id: ReturnType<typeof setTimeout> = (
        bound.setTimeout as unknown as (...a: unknown[]) => ReturnType<typeof setTimeout>
      )(
        (...rest: unknown[]) => {
          this.timeouts.delete(id);
          if (typeof handler === 'function') (handler as (...a: unknown[]) => void)(...rest);
        },
        ms,
        ...args,
      );
      this.timeouts.add(id);
      return id;
    }) as unknown as typeof setTimeout;
    timers.setInterval = ((handler: TimerHandler, ms?: number, ...args: unknown[]) => {
      const id = (
        bound.setInterval as unknown as (...a: unknown[]) => ReturnType<typeof setInterval>
      )(handler, ms, ...args);
      this.intervals.add(id);
      return id;
    }) as unknown as typeof setInterval;
    timers.requestAnimationFrame = (callback: FrameRequestCallback) => {
      const id = bound.requestAnimationFrame((time) => {
        this.frames.delete(id);
        callback(time);
      });
      this.frames.add(id);
      return id;
    };
    this.restore = () => {
      for (const [owner, add] of owners) (owner as EventTarget).addEventListener = add;
      Object.assign(timers, original.timers);
    };
    this.original = bound;
  }

  /**
   * Also takes down the listeners the session adds to `target` (a canvas that outlives the session).
   * Its `addEventListener` must come from the same prototype as a watched target's, as an element's does.
   */
  watch(target: EventTarget): void {
    if (!this.host.targets.includes(target)) this.host.targets.push(target);
  }

  /** Runs `dispose` when the scope ends (last registered, first run). */
  onDispose(dispose: () => void): void {
    this.disposers.push(dispose);
  }

  /** Ends the session's page-level effects: its disposers, listeners, timers and frames. */
  dispose(): void {
    if (this.done) return;
    this.done = true;
    for (const dispose of this.disposers.reverse()) {
      try {
        dispose();
      } catch (error) {
        console.warn(`area session disposer failed: ${String(error)}`);
      }
    }
    this.restore?.();
    this.restore = undefined;
    const clear = this.original ?? this.host.timers;
    for (const { target, type, listener, options } of this.listeners) {
      target.removeEventListener(type, listener, options);
    }
    for (const id of this.timeouts) clear.clearTimeout(id);
    for (const id of this.intervals) clear.clearInterval(id);
    for (const id of this.frames) clear.cancelAnimationFrame(id);
    this.listeners.length = 0;
    this.timeouts.clear();
    this.intervals.clear();
    this.frames.clear();
  }
}

/** The scope host for a browser page. */
export function browserScopeHost(): ScopeHost {
  return {
    targets: [globalThis.window, globalThis.document],
    timers: globalThis,
  };
}

/** The attributes on #app that outlive an area swap: the page's, not the area's. */
const PAGE_ATTRIBUTES: ReadonlySet<string> = new Set([
  'data-layers',
  'data-settings-store',
  'data-save-store',
]);

const KEPT_CHILDREN: ReadonlySet<string> = new Set(['save-warning', 'game-canvas']);

/** Empties the root of one area's DOM and readouts, keeping the page's own (the storage warning). */
export function resetRoot(root: HTMLElement): void {
  for (const child of [...root.children]) {
    // The save warning is the page's; the canvas outlives the area (pointer lock lives on it).
    const kept = child instanceof HTMLElement && KEPT_CHILDREN.has(child.dataset['testid'] ?? '');
    if (!kept) child.remove();
  }
  for (const attribute of [...root.attributes]) {
    const name = attribute.name;
    if (name.startsWith('data-') && !PAGE_ATTRIBUTES.has(name)) root.removeAttribute(name);
  }
}
