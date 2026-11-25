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
    root.append(warning, canvas);
    resetRoot(root);
    expect(Object.keys(root.dataset).sort()).toEqual(['layers', 'saveStore']);
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
