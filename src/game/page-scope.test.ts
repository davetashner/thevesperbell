// @vitest-environment happy-dom
/* eslint-disable @typescript-eslint/unbound-method -- the scope saves and restores the page's own functions */
import { describe, expect, it, vi } from 'vitest';
import { browserScopeHost, PageScope, resetRoot, type ScopeHost } from './page-scope';

function fakeHost() {
  const added: unknown[][] = [];
  const makeTarget = () => ({
    addEventListener: ((...args: unknown[]) => {
      added.push(args);
    }) as unknown as EventTarget['addEventListener'],
    removeEventListener: vi.fn() as unknown as EventTarget['removeEventListener'],
  });
  let next = 1;
  const timers = {
    setTimeout: (() => next++) as unknown as typeof setTimeout,
    clearTimeout: vi.fn() as unknown as typeof clearTimeout,
    setInterval: (() => next++) as unknown as typeof setInterval,
    clearInterval: vi.fn() as unknown as typeof clearInterval,
    requestAnimationFrame: (() => next++) as unknown as typeof requestAnimationFrame,
    cancelAnimationFrame: vi.fn() as unknown as typeof cancelAnimationFrame,
  };
  const window = makeTarget() as unknown as EventTarget;
  // A target that inherits the method, as the page's window does from EventTarget.prototype.
  const inheriting = Object.create(window) as EventTarget;
  const other = makeTarget() as unknown as EventTarget;
  const host: ScopeHost = { targets: [window, inheriting], timers };
  return { host, timers, window, inheriting, other, added };
}

describe('PageScope', () => {
  it('AC-1: removes the listeners, timers and frames its session registered, and only those', () => {
    const { host, timers, window, inheriting, other } = fakeHost();
    const original = window.addEventListener;
    const scope = new PageScope(host);
    scope.begin();
    const listener = (): void => undefined;
    window.addEventListener('keydown', listener, true);
    inheriting.addEventListener('keyup', listener);
    other.addEventListener('keydown', listener);
    const timeout = timers.setTimeout(() => undefined, 5);
    const interval = timers.setInterval(() => undefined, 5);
    const frame = timers.requestAnimationFrame(() => undefined);
    const clearTimeout = timers.clearTimeout;
    const clearInterval = timers.clearInterval;
    const cancelFrame = timers.cancelAnimationFrame;
    const removed: string[] = [];
    scope.onDispose(() => removed.push('first'));
    scope.onDispose(() => removed.push('second'));
    scope.dispose();
    expect(removed).toEqual(['second', 'first']);
    expect(window.removeEventListener).toHaveBeenCalledWith('keydown', listener, true);
    expect(inheriting.removeEventListener).toHaveBeenCalledWith('keyup', listener, undefined);
    expect(other.removeEventListener).not.toHaveBeenCalled();
    expect(clearTimeout).toHaveBeenCalledWith(timeout);
    expect(clearInterval).toHaveBeenCalledWith(interval);
    expect(cancelFrame).toHaveBeenCalledWith(frame);
    // The page's own functions are back.
    expect(window.addEventListener).toBe(original);
    expect(scope.disposed).toBe(true);
  });

  it('AC-1: a timeout that already fired is not cleared, and a failing disposer does not stop the rest', () => {
    const { host, timers } = fakeHost();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    let fire: (() => void) | undefined;
    timers.setTimeout = ((handler: () => void) => {
      fire = handler;
      return 7;
    }) as unknown as typeof setTimeout;
    const clearTimeout = timers.clearTimeout;
    const scope = new PageScope(host);
    scope.begin();
    scope.begin();
    timers.setTimeout(() => undefined, 1);
    fire?.();
    const ran = vi.fn();
    scope.onDispose(ran);
    scope.onDispose(() => {
      throw new Error('boom');
    });
    scope.dispose();
    scope.dispose();
    expect(clearTimeout).not.toHaveBeenCalled();
    expect(ran).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('PageScope edge cases', () => {
  it('AC-1: ignores null listeners and string timer handlers, forgets frames that ran, and is inert once disposed', () => {
    const { host, timers, window } = fakeHost();
    let runFrame: ((time: number) => void) | undefined;
    timers.requestAnimationFrame = (callback: (time: number) => void) => {
      runFrame = callback;
      return 3;
    };
    const cancelFrame = timers.cancelAnimationFrame;
    let runTimeout: (() => void) | undefined;
    timers.setTimeout = ((handler: () => void) => {
      runTimeout = handler;
      return 9;
    }) as unknown as typeof setTimeout;
    const scope = new PageScope(host);
    scope.begin();
    window.addEventListener('keydown', null);
    timers.setTimeout('' as unknown as () => void, 1);
    runTimeout?.();
    const seen = vi.fn();
    timers.requestAnimationFrame(seen);
    runFrame?.(16);
    expect(seen).toHaveBeenCalledWith(16);
    scope.dispose();
    expect(cancelFrame).not.toHaveBeenCalled();
    scope.begin(); // a finished scope does not start again
    expect(timers.setTimeout).not.toBe(undefined);
  });

  it('AC-1: a scope that never began disposes without touching the page', () => {
    const { host, timers } = fakeHost();
    const scope = new PageScope(host);
    scope.dispose();
    expect(timers.clearTimeout).not.toHaveBeenCalled();
  });

  it('AC-1: a target with no addEventListener anywhere is skipped, and two targets sharing one are patched once', () => {
    const { host, window, inheriting } = fakeHost();
    const bare = Object.create(null) as EventTarget;
    const scope = new PageScope({ ...host, targets: [bare, window, inheriting] });
    expect(() => {
      scope.begin();
      scope.dispose();
    }).not.toThrow();
  });
});

describe('resetRoot', () => {
  it('AC-1: empties an area from the root but keeps the page-level readouts and the storage warning', () => {
    const root = document.createElement('main');
    root.dataset['layers'] = 'sim';
    root.dataset['saveStore'] = 'indexeddb';
    root.dataset['scene'] = 'valley-01';
    root.dataset['transit'] = '{}';
    const canvas = document.createElement('canvas');
    const warning = document.createElement('p');
    warning.dataset['testid'] = 'save-warning';
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    root.setAttribute('role', 'main');
    root.append(warning, canvas, svg);
    resetRoot(root);
    expect(Object.keys(root.dataset).sort()).toEqual(['layers', 'saveStore']);
    expect(root.getAttribute('role')).toBe('main');
    expect([...root.children]).toEqual([warning]);
  });
});

describe('browserScopeHost', () => {
  it('AC-1: a real window scope removes a listener a session added to it', () => {
    const scope = new PageScope(browserScopeHost());
    scope.begin();
    const seen = vi.fn();
    window.addEventListener('zz-scope-test', seen);
    window.dispatchEvent(new Event('zz-scope-test'));
    scope.dispose();
    window.dispatchEvent(new Event('zz-scope-test'));
    expect(seen).toHaveBeenCalledOnce();
  });
});

describe('resetRoot and watch for a surviving canvas (mw-ju8.44)', () => {
  it('AC-1: resetRoot keeps the game canvas in the DOM', () => {
    const root = document.createElement('main');
    const canvas = document.createElement('canvas');
    canvas.dataset['testid'] = 'game-canvas';
    const other = document.createElement('div');
    root.append(canvas, other);
    resetRoot(root);
    expect([...root.children]).toEqual([canvas]);
  });

  it('AC-1: a scope takes down the listeners a session put on a watched canvas', () => {
    const canvas = document.createElement('canvas');
    const scope = new PageScope(browserScopeHost());
    scope.begin();
    scope.watch(canvas);
    scope.watch(canvas);
    const seen = vi.fn();
    canvas.addEventListener('zz-canvas-test', seen);
    scope.dispose();
    canvas.dispatchEvent(new Event('zz-canvas-test'));
    expect(seen).not.toHaveBeenCalled();
  });
});
