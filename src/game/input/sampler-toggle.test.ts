// Hold-or-toggle input (mw-e31.3): a toggled action latches on a press and lets go on the next one,
// so the sim only ever sees held or not held.
import { describe, expect, it } from 'vitest';
import type { PadSnapshot } from './gamepad';
import { DEFAULT_PAD_BINDINGS } from './bindings';
import { ActionSampler } from './sampler';

const tap = (sampler: ActionSampler, code: string): void => {
  sampler.down(code);
  sampler.up(code);
};
const state = (held: boolean, pressed = false, released = false) => ({ pressed, held, released });

describe('ActionSampler hold-or-toggle (mw-e31.3)', () => {
  it('AC-1: crouch in toggle mode stays active after one press and release, until pressed again', () => {
    const sampler = new ActionSampler({ toggled: ['crouch'] });
    tap(sampler, 'KeyC');
    expect(sampler.sample().crouch).toEqual(state(true, true));
    expect(sampler.sample().crouch).toEqual(state(true));
    expect(sampler.sample().crouch).toEqual(state(true));
    tap(sampler, 'KeyC');
    expect(sampler.sample().crouch).toEqual(state(false, false, true));
    expect(sampler.sample().crouch).toEqual(state(false));
  });

  it('the key being held does not repeat the flip, and its release does nothing', () => {
    const sampler = new ActionSampler({ toggled: ['sprint'] });
    sampler.down('ShiftLeft');
    sampler.down('ShiftLeft');
    expect(sampler.sample().sprint.held).toBe(true);
    expect(sampler.sample().sprint.held).toBe(true);
    sampler.up('ShiftLeft');
    expect(sampler.sample().sprint.held).toBe(true);
  });

  it('actions not in toggle mode keep holding', () => {
    const sampler = new ActionSampler({ toggled: ['sprint'] });
    sampler.down('KeyC');
    expect(sampler.sample().crouch.held).toBe(true);
    sampler.up('KeyC');
    expect(sampler.sample().crouch).toEqual(state(false, false, true));
  });

  it('two presses inside one tick flip twice and cancel out', () => {
    const sampler = new ActionSampler({ toggled: ['crouch'] });
    tap(sampler, 'KeyC');
    tap(sampler, 'KeyC');
    expect(sampler.sample().crouch).toEqual(state(false, true, true));
  });

  it('a second key on the same toggled action flips the same latch', () => {
    const sampler = new ActionSampler({ toggled: ['crouch'] });
    sampler.setBindings({ ...sampler.bindings, crouch: ['KeyC', 'KeyV'] });
    tap(sampler, 'KeyC');
    expect(sampler.sample().crouch.held).toBe(true);
    tap(sampler, 'KeyV');
    expect(sampler.sample().crouch.held).toBe(false);
  });

  it('block toggles on the right mouse button, so a click while blocked still reaches attack', () => {
    const sampler = new ActionSampler({ toggled: ['secondaryAttack'] });
    tap(sampler, 'Mouse2');
    sampler.sample();
    sampler.down('Mouse0');
    const frame = sampler.sample();
    expect(frame.secondaryAttack.held).toBe(true);
    expect(frame.primaryAttack.pressed).toBe(true);
  });

  it('AC-2: releaseToggles (a menu or dialogue opening) lets the block go and it does not resume', () => {
    const sampler = new ActionSampler({ toggled: ['secondaryAttack'] });
    tap(sampler, 'Mouse2');
    expect(sampler.sample().secondaryAttack.held).toBe(true);
    sampler.releaseToggles();
    expect(sampler.sample().secondaryAttack).toEqual(state(false, false, true));
    expect(sampler.sample().secondaryAttack).toEqual(state(false));
    expect(sampler.sample().secondaryAttack).toEqual(state(false));
  });

  it('releaseToggles leaves held keys and held actions alone', () => {
    const sampler = new ActionSampler({ toggled: ['crouch'] });
    sampler.down('KeyW');
    tap(sampler, 'KeyC');
    sampler.sample();
    sampler.releaseToggles();
    const frame = sampler.sample();
    expect(frame.crouch.released).toBe(true);
    expect(frame.move).toEqual({ x: 0, y: 1 });
    expect(sampler.sample().move).toEqual({ x: 0, y: 1 });
  });

  it('releaseToggles with nothing latched changes nothing', () => {
    const sampler = new ActionSampler({ toggled: ['crouch'] });
    sampler.releaseToggles();
    expect(sampler.sample().crouch).toEqual(state(false));
  });

  it('releaseAll (focus or pointer lock lost) lets go of toggles and keys', () => {
    const sampler = new ActionSampler({ toggled: ['crouch', 'sprint'] });
    sampler.down('KeyW');
    tap(sampler, 'KeyC');
    tap(sampler, 'ShiftLeft');
    const on = sampler.sample();
    expect(on.crouch.held && on.sprint.held).toBe(true);
    sampler.releaseAll();
    const off = sampler.sample();
    expect(off.crouch.released).toBe(true);
    expect(off.sprint.released).toBe(true);
    expect(off.move).toEqual({ x: 0, y: 0 });
    expect(sampler.sample().crouch.held).toBe(false);
  });

  it('AC-3: switching hold to toggle mid-hold releases the action and the held key stays ignored', () => {
    const sampler = new ActionSampler();
    sampler.down('KeyC');
    expect(sampler.sample().crouch.held).toBe(true);
    sampler.setToggled(['crouch']);
    expect(sampler.sample().crouch).toEqual(state(false, false, true));
    expect(sampler.sample().crouch).toEqual(state(false));
    sampler.up('KeyC');
    expect(sampler.sample().crouch.held).toBe(false);
    tap(sampler, 'KeyC');
    expect(sampler.sample().crouch.held).toBe(true);
  });

  it('AC-3: switching toggle to hold while latched releases it', () => {
    const sampler = new ActionSampler({ toggled: ['crouch'] });
    tap(sampler, 'KeyC');
    expect(sampler.sample().crouch.held).toBe(true);
    sampler.setToggled([]);
    expect(sampler.sample().crouch).toEqual(state(false, false, true));
    expect(sampler.sample().crouch.held).toBe(false);
    sampler.down('KeyC');
    expect(sampler.sample().crouch.held).toBe(true);
    sampler.up('KeyC');
    expect(sampler.sample().crouch.held).toBe(false);
  });

  it('AC-3: switching toggle to hold with the key still down ignores it until it comes up', () => {
    const sampler = new ActionSampler({ toggled: ['crouch'] });
    sampler.down('KeyC');
    sampler.sample();
    sampler.setToggled([]);
    expect(sampler.sample().crouch.held).toBe(false);
    sampler.up('KeyC');
    expect(sampler.sample().crouch.held).toBe(false);
    expect(sampler.toggled.size).toBe(0);
  });

  it('setToggled leaves untouched actions alone', () => {
    const sampler = new ActionSampler({ toggled: ['crouch'] });
    tap(sampler, 'KeyC');
    sampler.sample();
    sampler.setToggled(['crouch', 'sprint']);
    expect(sampler.sample().crouch.held).toBe(true);
    expect([...sampler.toggled]).toEqual(['crouch', 'sprint']);
  });

  it('aim only latches while toggleApplies says so, and a latch lets go when it stops', () => {
    let bowOut = false;
    const sampler = new ActionSampler({
      toggled: ['primaryAttack'],
      toggleApplies: (action) => action !== 'primaryAttack' || bowOut,
    });
    tap(sampler, 'Mouse0');
    expect(sampler.sample().primaryAttack.held).toBe(false);
    bowOut = true;
    tap(sampler, 'Mouse0');
    expect(sampler.sample().primaryAttack).toEqual(state(true, true));
    tap(sampler, 'Mouse0');
    expect(sampler.sample().primaryAttack.released).toBe(true);
    tap(sampler, 'Mouse0');
    expect(sampler.sample().primaryAttack.held).toBe(true);
    bowOut = false;
    expect(sampler.sample().primaryAttack).toEqual(state(false, false, true));
    expect(sampler.sample().primaryAttack.held).toBe(false);
  });

  it('toggle works for pad block, while the pad keeps its own crouch and sprint latches', () => {
    const sampler = new ActionSampler({ toggled: ['secondaryAttack', 'crouch', 'sprint'] });
    const pad = (...buttons: string[]): PadSnapshot => ({
      buttons: new Set(buttons) as PadSnapshot['buttons'],
      left: { x: 0, y: 0 },
      right: { x: 0, y: 0 },
    });
    sampler.gamepad(pad('PadLT'));
    expect(sampler.sample().secondaryAttack.held).toBe(true);
    sampler.gamepad(pad());
    expect(sampler.sample().secondaryAttack.held).toBe(true);
    sampler.gamepad(pad('PadLT'));
    expect(sampler.sample().secondaryAttack.released).toBe(true);
    sampler.gamepad(pad());
    expect(sampler.sample().secondaryAttack.held).toBe(false);
    // Pad crouch click latches once (the pad's stance toggle), the second click stands up again.
    const [crouchButton] = DEFAULT_PAD_BINDINGS.crouch;
    if (crouchButton === undefined) throw new Error('no pad crouch');
    sampler.gamepad(pad(crouchButton));
    expect(sampler.sample().crouch.held).toBe(true);
    sampler.gamepad(pad());
    expect(sampler.sample().crouch.held).toBe(true);
    sampler.gamepad(pad(crouchButton));
    expect(sampler.sample().crouch.held).toBe(false);
  });

  it('a toggled action held by a pad passthrough stays held when its latch is flipped off', () => {
    const sampler = new ActionSampler({ toggled: ['crouch'] });
    tap(sampler, 'KeyC');
    sampler.sample();
    const [crouchButton] = DEFAULT_PAD_BINDINGS.crouch;
    if (crouchButton === undefined) throw new Error('no pad crouch');
    sampler.gamepad({
      buttons: new Set([crouchButton]) as PadSnapshot['buttons'],
      left: { x: 0, y: 0 },
      right: { x: 0, y: 0 },
    });
    expect(sampler.sample().crouch.held).toBe(true);
    tap(sampler, 'KeyC');
    expect(sampler.sample().crouch.held).toBe(true);
    sampler.releaseToggles();
    expect(sampler.sample().crouch.held).toBe(true);
  });

  it('losing pad focus releases a toggled pad block', async () => {
    const { attachGamepadInput } = await import('./gamepad-dom');
    const { fakePad } = await import('./fake-gamepad');
    let focused = true;
    const sampler = new ActionSampler({ toggled: ['secondaryAttack'] });
    attachGamepadInput(sampler, {
      navigator: { getGamepads: () => [fakePad({ pressed: ['PadLT'] })] },
      hasFocus: () => focused,
    });
    expect(sampler.sample().secondaryAttack.held).toBe(true);
    focused = false;
    expect(sampler.sample().secondaryAttack.held).toBe(false);
  });

  it('latching an action a pad passthrough already holds adds no second press edge', () => {
    const sampler = new ActionSampler({ toggled: ['crouch'] });
    const [crouchButton] = DEFAULT_PAD_BINDINGS.crouch;
    if (crouchButton === undefined) throw new Error('no pad crouch');
    sampler.gamepad({
      buttons: new Set([crouchButton]) as PadSnapshot['buttons'],
      left: { x: 0, y: 0 },
      right: { x: 0, y: 0 },
    });
    expect(sampler.sample().crouch).toEqual(state(true, true));
    tap(sampler, 'KeyC');
    expect(sampler.sample().crouch).toEqual(state(true));
    sampler.releaseToggles();
    expect(sampler.sample().crouch).toEqual(state(true));
  });

  it('a key unbound while held does not break a mode change', () => {
    const sampler = new ActionSampler();
    sampler.down('KeyC');
    sampler.sample();
    sampler.setBindings({ ...sampler.bindings, crouch: [] });
    sampler.setToggled(['crouch']);
    expect(sampler.sample().crouch.held).toBe(false);
  });
});
