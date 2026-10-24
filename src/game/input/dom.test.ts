import { describe, expect, it, vi } from 'vitest';
import { IDLE_ACTION_FRAME } from '@sim/index';
import { attachDomInput } from './dom';
import { ActionSampler } from './sampler';

/** A fake browser: real EventTargets standing in for window and document, and a lockable canvas. */
function fakeBrowser() {
  const window = new EventTarget();
  const doc: EventTarget & { pointerLockElement: unknown } = Object.assign(new EventTarget(), {
    pointerLockElement: null,
  });
  const element = {
    requestPointerLock: vi.fn(() => {
      doc.pointerLockElement = element;
      doc.dispatchEvent(new Event('pointerlockchange'));
    }),
  };
  const sampler = new ActionSampler();
  const input = attachDomInput(sampler, { window, document: doc, element });

  const dispatch = (type: string, fields: Record<string, unknown>) => {
    const event = Object.assign(new Event(type, { cancelable: true }), fields);
    window.dispatchEvent(event);
    return event;
  };
  return {
    window,
    doc,
    element,
    sampler,
    input,
    key: (type: 'keydown' | 'keyup', code: string, repeat = false) =>
      dispatch(type, { code, repeat }),
    mouse: (type: 'mousedown' | 'mouseup', button: number) => dispatch(type, { button }),
    move: (movementX: number, movementY: number) => dispatch('mousemove', { movementX, movementY }),
    /** Right-click menu: true when the adapter suppressed it. */
    dispatchContextMenu: () => dispatch('contextmenu', {}).defaultPrevented,
    loseLock: () => {
      doc.pointerLockElement = null;
      doc.dispatchEvent(new Event('pointerlockchange'));
    },
  };
}

describe('attachDomInput', () => {
  it('ignores input until the pointer is locked to the element', () => {
    const b = fakeBrowser();
    expect(b.input.locked).toBe(false);
    b.key('keydown', 'KeyW');
    b.mouse('mousedown', 0);
    b.move(5, 5);
    expect(b.dispatchContextMenu()).toBe(false);
    expect(b.sampler.sample()).toEqual(IDLE_ACTION_FRAME);
  });

  it('feeds keys, mouse buttons and movement to the sampler while locked', () => {
    const b = fakeBrowser();
    b.input.requestPointerLock();
    expect(b.element.requestPointerLock).toHaveBeenCalledTimes(1);
    expect(b.input.locked).toBe(true);
    b.input.requestPointerLock();
    expect(b.element.requestPointerLock).toHaveBeenCalledTimes(1);

    const space = b.key('keydown', 'Space');
    expect(space.defaultPrevented).toBe(true);
    expect(b.key('keydown', 'KeyJ').defaultPrevented).toBe(false);
    b.key('keydown', 'KeyW');
    b.mouse('mousedown', 2);
    b.move(4, 3);
    const frame = b.sampler.sample();
    expect(frame.jump.pressed).toBe(true);
    expect(frame.move).toEqual({ x: 0, y: 1 });
    expect(frame.secondaryAttack.pressed).toBe(true);
    expect(frame.look).toEqual({ x: 4, y: -3 });
    expect(b.dispatchContextMenu()).toBe(true);

    b.key('keydown', 'Space', true);
    b.key('keyup', 'Space');
    b.mouse('mouseup', 2);
    const next = b.sampler.sample();
    expect(next.jump.released).toBe(true);
    expect(next.secondaryAttack.released).toBe(true);
  });

  it('AC-5: losing pointer lock releases every held action and zeroes look on the next frame', () => {
    const b = fakeBrowser();
    b.input.requestPointerLock();
    b.key('keydown', 'KeyW');
    b.key('keydown', 'ShiftLeft');
    b.mouse('mousedown', 0);
    b.sampler.sample();
    b.move(12, -7);
    b.loseLock();
    expect(b.input.locked).toBe(false);
    // Key-ups after the lock is gone never arrive at the game; nothing may stay stuck.
    b.move(3, 3);
    const frame = b.sampler.sample();
    expect(frame.move).toEqual({ x: 0, y: 0 });
    expect(frame.look).toEqual({ x: 0, y: 0 });
    expect(frame.sprint).toEqual({ pressed: false, held: false, released: true });
    expect(frame.primaryAttack).toEqual({ pressed: false, held: false, released: true });
    expect(b.sampler.sample()).toEqual(IDLE_ACTION_FRAME);
  });

  it('AC-5: window blur releases every held action and zeroes look on the next frame', () => {
    const b = fakeBrowser();
    b.input.requestPointerLock();
    b.key('keydown', 'KeyD');
    b.key('keydown', 'Space');
    b.sampler.sample();
    b.move(9, 9);
    b.window.dispatchEvent(new Event('blur'));
    const frame = b.sampler.sample();
    expect(frame.move).toEqual({ x: 0, y: 0 });
    expect(frame.look).toEqual({ x: 0, y: 0 });
    expect(frame.jump).toEqual({ pressed: false, held: false, released: true });
  });

  it('a lock taken by another element does not count as locked', () => {
    const b = fakeBrowser();
    b.doc.pointerLockElement = {};
    b.doc.dispatchEvent(new Event('pointerlockchange'));
    expect(b.input.locked).toBe(false);
  });

  it('swallows a rejected pointer-lock request', async () => {
    const window = new EventTarget();
    const doc = Object.assign(new EventTarget(), { pointerLockElement: null });
    const element = { requestPointerLock: vi.fn(() => Promise.reject(new Error('denied'))) };
    const input = attachDomInput(new ActionSampler(), { window, document: doc, element });
    input.requestPointerLock();
    await Promise.resolve();
    expect(element.requestPointerLock).toHaveBeenCalled();
    expect(input.locked).toBe(false);
  });

  it('detach removes the listeners and releases held input', () => {
    const b = fakeBrowser();
    b.input.requestPointerLock();
    b.key('keydown', 'Space');
    b.sampler.sample();
    b.input.detach();
    expect(b.input.locked).toBe(false);
    b.key('keydown', 'KeyW');
    expect(b.sampler.sample().jump.released).toBe(true);
    expect(b.sampler.sample()).toEqual(IDLE_ACTION_FRAME);
  });
});
