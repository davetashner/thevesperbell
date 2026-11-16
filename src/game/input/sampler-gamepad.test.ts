import { describe, expect, it } from 'vitest';
import { IDLE_ACTION_FRAME } from '@sim/index';
import { DEFAULT_BINDINGS, DEFAULT_PAD_BINDINGS, rebind } from './bindings';
import { fakePad, type FakePadOptions } from './fake-gamepad';
import { DEFAULT_GAMEPAD_SETTINGS, IDLE_PAD, magnitude, readPad } from './gamepad';
import { ActionSampler } from './sampler';

const button = (pressed: boolean, held: boolean, released: boolean) => ({
  pressed,
  held,
  released,
});
const UP = button(false, false, false);

const pad = (options: FakePadOptions = {}) => readPad(fakePad(options));

describe('ActionSampler with a gamepad (mw-e02.9)', () => {
  it('pad buttons press, hold and release actions through the default Xbox layout', () => {
    const sampler = new ActionSampler();
    sampler.gamepad(pad({ pressed: ['PadA', 'PadRB'] }));
    const first = sampler.sample();
    expect(first.jump).toEqual(button(true, true, false));
    expect(first.primaryAttack).toEqual(button(true, true, false));
    sampler.gamepad(pad({ pressed: ['PadA'] }));
    const second = sampler.sample();
    expect(second.jump).toEqual(button(false, true, false));
    expect(second.primaryAttack).toEqual(button(false, false, true));
    expect(sampler.isBound('PadMenu')).toBe(true);
  });

  it('AC-1: LT plus a D-pad direction presses its quick slot; LT keeps blocking and the D-pad does not cast', () => {
    const sampler = new ActionSampler();
    sampler.gamepad(pad({ pressed: ['PadLT'] }));
    expect(sampler.sample().secondaryAttack.held).toBe(true);
    const directions = [
      ['PadUp', 'quickSlot1', 'cast'],
      ['PadRight', 'quickSlot2', 'ability2'],
      ['PadDown', 'quickSlot3', 'cancelCast'],
      ['PadLeft', 'quickSlot4', 'ability4'],
    ] as const;
    for (const [dpad, slot, plain] of directions) {
      sampler.gamepad(pad({ pressed: ['PadLT', dpad] }));
      const down = sampler.sample();
      expect(down[slot]).toEqual(button(true, true, false));
      expect(down[plain]).toEqual(UP);
      expect(down.secondaryAttack).toEqual(button(false, true, false));
      sampler.gamepad(pad({ pressed: ['PadLT'] }));
      expect(sampler.sample()[slot]).toEqual(button(false, false, true));
    }
  });

  it('the D-pad alone still casts and uses no quick slot', () => {
    const sampler = new ActionSampler();
    sampler.gamepad(pad({ pressed: ['PadUp'] }));
    const frame = sampler.sample();
    expect(frame.cast.pressed).toBe(true);
    expect(frame.quickSlot1).toEqual(UP);
  });

  it('keyboard focus loss does not drop a held pad chord, and a rebound chord lets go', () => {
    const sampler = new ActionSampler();
    sampler.gamepad(pad({ pressed: ['PadLT', 'PadUp'] }));
    sampler.sample();
    sampler.releaseAll();
    sampler.gamepad(pad({ pressed: ['PadLT', 'PadUp'] }));
    expect(sampler.sample().quickSlot1.held).toBe(true);
    const moved = rebind(sampler.padBindings, 'quickSlot1', 'PadLT+PadRS');
    if (!moved.ok) throw new Error('conflict');
    sampler.setPadBindings(moved.bindings);
    sampler.gamepad(pad({ pressed: ['PadLT', 'PadUp'] }));
    const frame = sampler.sample();
    expect(frame.quickSlot1.held).toBe(false);
    expect(frame.cast.held).toBe(true);
  });

  it('mw-e04.39 maps the shoulder combat cluster and R3 crouch', () => {
    const sampler = new ActionSampler();
    sampler.gamepad(pad({ pressed: ['PadRB', 'PadLB', 'PadLT', 'PadRT', 'PadRS'] }));
    const frame = sampler.sample();
    expect(frame.primaryAttack.held).toBe(true); // R1: right hand
    expect(frame.ability1.held).toBe(true); // R2: strong attack
    expect(frame.ability3.held).toBe(true); // L1: left hand
    expect(frame.secondaryAttack.held).toBe(true); // L2: hold shield
    expect(frame.crouch.held).toBe(true); // R3
  });

  it('mw-e02.36 toggles R3 crouch and exits it on R3, jump, sprint or disconnect', () => {
    const sampler = new ActionSampler();
    const click = (code: 'PadRS' | 'PadA' | 'PadLS', left: readonly [number, number] = [0, 0]) => {
      sampler.gamepad(pad({ pressed: [code], left }));
      const down = sampler.sample();
      sampler.gamepad(pad({ left }));
      const released = sampler.sample();
      return { down, released };
    };

    const entered = click('PadRS');
    expect(entered.down.crouch).toEqual(button(true, true, false));
    expect(entered.released.crouch).toEqual(button(false, true, false));
    const left = click('PadRS');
    expect(left.down.crouch).toEqual(button(false, false, true));

    click('PadRS');
    expect(click('PadA').down.crouch).toEqual(button(false, false, true));
    click('PadRS');
    expect(click('PadLS', [0, 1]).down.crouch).toEqual(button(false, false, true));

    click('PadRS');
    sampler.gamepad(undefined);
    expect(sampler.sample().crouch).toEqual(button(false, false, true));
  });

  it('mw-e02.36 a pad with no crouch binding never crouches, and disconnecting it is clean', () => {
    const sampler = new ActionSampler({ padBindings: { ...DEFAULT_PAD_BINDINGS, crouch: [] } });
    sampler.gamepad(pad({ pressed: ['PadRS'] }));
    expect(sampler.sample().crouch).toEqual(UP);
    sampler.gamepad(undefined);
    expect(sampler.sample().crouch).toEqual(UP);
  });

  it('the left stick moves with the rescaled deadzone; the right stick is lookStick, raw', () => {
    const sampler = new ActionSampler();
    sampler.gamepad(pad({ left: [0, 0.575], right: [0.1, -0.5] }));
    const frame = sampler.sample();
    expect(frame.move.x).toBe(0);
    expect(frame.move.y).toBeCloseTo(0.5, 2);
    // Look keeps its raw (quantised) deflection: the sim applies the look deadzone and curve.
    expect(frame.lookStick).toEqual({ x: 0.1, y: -0.5 });
    expect(frame.look).toEqual({ x: 0, y: 0 });
    sampler.gamepad(pad({ left: [0.1, 0] }));
    expect(sampler.sample().move).toEqual({ x: 0, y: 0 });
  });

  it('AC-3: keyboard and pad in one tick: the larger move wins, length ≤ 1, buttons OR together', () => {
    const sampler = new ActionSampler();
    sampler.down('KeyW');
    sampler.down('KeyD');
    sampler.down('Space');
    sampler.gamepad(pad({ left: [0, -0.4], pressed: ['PadA'] }));
    const keysWin = sampler.sample();
    expect(keysWin.move.x).toBeCloseTo(Math.SQRT1_2, 12);
    expect(keysWin.move.y).toBeCloseTo(Math.SQRT1_2, 12);
    expect(magnitude(keysWin.move)).toBeLessThanOrEqual(1);
    expect(keysWin.jump).toEqual(button(true, true, false));
    // Full stick back beats the (length 1) keys only if longer, and never adds to them.
    sampler.gamepad(pad({ left: [-1, 0], pressed: ['PadA'] }));
    expect(magnitude(sampler.sample().move)).toBeLessThanOrEqual(1);
    sampler.up('KeyW');
    sampler.up('KeyD');
    sampler.gamepad(pad({ left: [-1, 0], pressed: ['PadA'] }));
    const padWins = sampler.sample();
    expect(padWins.move).toEqual({ x: -1, y: 0 });
    // Jump stays held while either Space or A is down.
    expect(padWins.jump).toEqual(button(false, true, false));
    sampler.up('Space');
    sampler.gamepad(pad({ left: [-1, 0], pressed: ['PadA'] }));
    expect(sampler.sample().jump).toEqual(button(false, true, false));
    sampler.gamepad(pad());
    expect(sampler.sample().jump).toEqual(button(false, false, true));
  });

  it('AC-4: a disconnect mid-sprint releases every pad-held action and taps pause on the next frame', () => {
    const sampler = new ActionSampler();
    sampler.gamepad(pad({ left: [0, 1], pressed: ['PadLS', 'PadLT'] }));
    const sprinting = sampler.sample();
    expect(sprinting.sprint).toEqual(button(true, true, false));
    expect(sprinting.secondaryAttack.held).toBe(true);
    expect(sprinting.move).toEqual({ x: 0, y: 1 });
    sampler.gamepad(undefined);
    const gone = sampler.sample();
    expect(gone.sprint).toEqual(button(false, false, true));
    expect(gone.secondaryAttack).toEqual(button(false, false, true));
    expect(gone.move).toEqual({ x: 0, y: 0 });
    expect(gone.lookStick).toEqual({ x: 0, y: 0 });
    expect(gone.pause).toEqual(button(true, false, true));
    // Once: the frame after is idle.
    expect(sampler.sample()).toEqual(IDLE_ACTION_FRAME);
  });

  it('AC-4: a disconnect keeps keyboard-held actions and skips the pause when the settings say so', () => {
    const sampler = new ActionSampler({
      gamepad: { ...DEFAULT_GAMEPAD_SETTINGS, pauseOnDisconnect: false },
    });
    sampler.down('KeyW');
    sampler.gamepad(pad({ pressed: ['PadA'] }));
    sampler.sample();
    sampler.gamepad(undefined);
    const gone = sampler.sample();
    expect(gone.jump).toEqual(button(false, false, true));
    expect(gone.pause).toEqual(UP);
    expect(gone.move).toEqual({ x: 0, y: 1 });
    // No pad before, none now: not a disconnect.
    sampler.gamepad(undefined);
    expect(sampler.sample().pause).toEqual(UP);
  });

  it('sprint toggles on a stick click and lets go when the stick returns to centre', () => {
    const sampler = new ActionSampler();
    sampler.gamepad(pad({ left: [0, 1], pressed: ['PadLS'] }));
    expect(sampler.sample().sprint).toEqual(button(true, true, false));
    // The click is over, sprint stays on while moving.
    sampler.gamepad(pad({ left: [0, 1] }));
    expect(sampler.sample().sprint).toEqual(button(false, true, false));
    sampler.gamepad(pad({ left: [0.5, 0.5] }));
    expect(sampler.sample().sprint.held).toBe(true);
    // Stick back to centre: sprint ends.
    sampler.gamepad(pad());
    expect(sampler.sample().sprint).toEqual(button(false, false, true));
    // A click turns it on, a second click off.
    sampler.gamepad(pad({ left: [0, 1], pressed: ['PadLS'] }));
    expect(sampler.sample().sprint.held).toBe(true);
    sampler.gamepad(pad({ left: [0, 1] }));
    sampler.sample();
    sampler.gamepad(pad({ left: [0, 1], pressed: ['PadLS'] }));
    expect(sampler.sample().sprint).toEqual(button(false, false, true));
    // Clicked standing still, it waits for the stick.
    sampler.gamepad(pad());
    sampler.sample();
    sampler.gamepad(pad({ pressed: ['PadLS'] }));
    sampler.sample();
    sampler.gamepad(pad({ left: [0, 1] }));
    expect(sampler.sample().sprint.held).toBe(true);
  });

  it('with sprint toggle off, the sprint button is held like a key', () => {
    const sampler = new ActionSampler({
      gamepad: { ...DEFAULT_GAMEPAD_SETTINGS, sprintToggle: false },
    });
    sampler.gamepad(pad({ left: [0, 1], pressed: ['PadLS'] }));
    expect(sampler.sample().sprint.held).toBe(true);
    sampler.gamepad(pad({ left: [0, 1] }));
    expect(sampler.sample().sprint).toEqual(button(false, false, true));
  });

  it('sprint toggle does nothing when sprint has no pad binding', () => {
    const unbound = { ...DEFAULT_PAD_BINDINGS, sprint: [] };
    const sampler = new ActionSampler({ padBindings: unbound });
    sampler.gamepad(pad({ left: [0, 1], pressed: ['PadLS'] }));
    expect(sampler.sample().sprint).toEqual(UP);
  });

  it('pad bindings remap like keys: after rebinding Jump to Y, Y jumps and A does not', () => {
    const result = rebind(DEFAULT_PAD_BINDINGS, 'jump', 'PadY');
    expect(result.ok).toBe(false); // Y is lock-on by default: a conflict, as on the keyboard
    const freed = rebind({ ...DEFAULT_PAD_BINDINGS, lockOn: [] }, 'jump', 'PadY');
    if (!freed.ok) throw new Error('conflict');
    const sampler = new ActionSampler();
    sampler.setPadBindings(freed.bindings);
    expect(sampler.padBindings).toBe(freed.bindings);
    sampler.gamepad(pad({ pressed: ['PadA'] }));
    expect(sampler.sample().jump).toEqual(UP);
    sampler.gamepad(pad({ pressed: ['PadY'] }));
    expect(sampler.sample().jump).toEqual(button(true, true, false));
    // Keyboard bindings are untouched and still OR in.
    expect(sampler.bindings).toBe(DEFAULT_BINDINGS);
  });

  it('releaseAll (keyboard focus lost) leaves pad buttons to the pad', () => {
    const sampler = new ActionSampler();
    sampler.down('Space');
    sampler.gamepad(pad({ pressed: ['PadX'] }));
    sampler.sample();
    sampler.releaseAll();
    sampler.gamepad(pad({ pressed: ['PadX'] }));
    const frame = sampler.sample();
    expect(frame.jump).toEqual(button(false, false, true));
    expect(frame.interact).toEqual(button(false, true, false));
    sampler.gamepad(IDLE_PAD);
    expect(sampler.sample().interact.released).toBe(true);
  });

  it('pollers run once at the start of every sample, until removed', () => {
    const sampler = new ActionSampler();
    let polls = 0;
    const remove = sampler.addPoller(() => {
      polls += 1;
      sampler.gamepad(pad({ pressed: ['PadA'] }));
    });
    expect(sampler.sample().jump.pressed).toBe(true);
    sampler.sample();
    expect(polls).toBe(2);
    remove();
    sampler.sample();
    expect(polls).toBe(2);
  });

  it('AC-5: tracks the device used last: keys or mouse, or pad buttons or sticks past the deadzone', () => {
    const sampler = new ActionSampler();
    expect(sampler.lastDevice).toBe('keyboardMouse');
    sampler.gamepad(pad({ left: [0.1, 0] })); // resting drift is not use
    sampler.sample();
    expect(sampler.lastDevice).toBe('keyboardMouse');
    sampler.gamepad(pad({ pressed: ['PadA'] }));
    sampler.sample();
    expect(sampler.lastDevice).toBe('gamepad');
    sampler.gamepad(pad({ pressed: ['PadA'] })); // held, not newly pressed: still the pad
    sampler.look(3, 0);
    sampler.sample();
    expect(sampler.lastDevice).toBe('keyboardMouse');
    sampler.gamepad(pad({ right: [0.9, 0] }));
    sampler.sample();
    expect(sampler.lastDevice).toBe('gamepad');
    sampler.down('KeyE');
    sampler.gamepad(IDLE_PAD);
    sampler.sample();
    expect(sampler.lastDevice).toBe('keyboardMouse');
    sampler.gamepad(pad({ left: [0, -0.9] }));
    sampler.sample();
    expect(sampler.lastDevice).toBe('gamepad');
  });
});
