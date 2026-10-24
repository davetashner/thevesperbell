import { describe, expect, it } from 'vitest';
import {
  actionsByCode,
  BINDABLE_ACTIONS,
  BINDINGS_DATA_VERSION,
  contextOf,
  DEFAULT_BINDINGS,
  DEFAULT_PAD_BINDINGS,
  deserializeBindings,
  findConflicts,
  MAX_SLOTS,
  mouseCode,
  rebind,
  serializeBindings,
  unbind,
  type BindableAction,
  type Bindings,
} from './bindings';

function rebound(
  bindings: Bindings,
  action: BindableAction,
  code: string,
  slot?: number,
): Bindings {
  const result = rebind(bindings, action, code, slot);
  if (!result.ok) throw new Error(`unexpected conflict on ${result.conflict.code}`);
  return result.bindings;
}

describe('default bindings', () => {
  it('bind every action, within the slot limit, with no conflicts', () => {
    for (const action of BINDABLE_ACTIONS) {
      expect(DEFAULT_BINDINGS[action].length).toBeGreaterThan(0);
      expect(DEFAULT_BINDINGS[action].length).toBeLessThanOrEqual(MAX_SLOTS);
    }
    expect(findConflicts(DEFAULT_BINDINGS)).toEqual([]);
    expect(DEFAULT_BINDINGS.moveForward).toContain('KeyW');
    expect(DEFAULT_BINDINGS.jump).toEqual(['Space']);
    expect(DEFAULT_BINDINGS.primaryAttack).toEqual(['Mouse0']);
    expect(DEFAULT_BINDINGS.dodge).toEqual(['KeyR']);
    expect(Object.isFrozen(DEFAULT_BINDINGS)).toBe(true);
    expect(Object.isFrozen(DEFAULT_BINDINGS.jump)).toBe(true);
  });

  it('name mouse buttons Mouse<n>', () => {
    expect(mouseCode(2)).toBe('Mouse2');
  });

  it('give move directions the move context and pause the global one', () => {
    expect(contextOf('moveLeft')).toBe('gameplay');
    expect(contextOf('jump')).toBe('gameplay');
    expect(contextOf('pause')).toBe('global');
  });
});

describe('rebind', () => {
  it('AC-2: rebinding Jump to F replaces Space in the primary slot', () => {
    const result = rebind(DEFAULT_BINDINGS, 'jump', 'KeyF');
    expect(result).toEqual({ ok: true, bindings: expect.any(Object) as unknown });
    const bindings = rebound(DEFAULT_BINDINGS, 'jump', 'KeyF');
    expect(bindings.jump).toEqual(['KeyF']);
    expect(actionsByCode(bindings).get('Space')).toBeUndefined();
    expect(actionsByCode(bindings).get('KeyF')).toEqual(['jump']);
    expect(DEFAULT_BINDINGS.jump).toEqual(['Space']);
  });

  it('AC-3: a code already bound in the same context returns a conflict listing both actions and changes nothing', () => {
    const before = serializeBindings(DEFAULT_BINDINGS);
    const result = rebind(DEFAULT_BINDINGS, 'jump', 'KeyE');
    expect(result).toEqual({
      ok: false,
      conflict: { code: 'KeyE', actions: ['jump', 'interact'] },
    });
    expect(serializeBindings(DEFAULT_BINDINGS)).toEqual(before);
  });

  it('AC-3: global actions (pause) conflict with gameplay bindings', () => {
    expect(rebind(DEFAULT_BINDINGS, 'jump', 'Escape')).toEqual({
      ok: false,
      conflict: { code: 'Escape', actions: ['jump', 'pause'] },
    });
    expect(rebind(DEFAULT_BINDINGS, 'pause', 'KeyW')).toEqual({
      ok: false,
      conflict: { code: 'KeyW', actions: ['pause', 'moveForward'] },
    });
  });

  it('fills the secondary slot, appends past the end, and moves a code within one action', () => {
    let bindings = rebound(DEFAULT_BINDINGS, 'jump', 'KeyF', 1);
    expect(bindings.jump).toEqual(['Space', 'KeyF']);
    bindings = rebound(bindings, 'jump', 'KeyF', 0);
    expect(bindings.jump).toEqual(['KeyF']);
    bindings = rebound(bindings, 'jump', 'KeyH', 1);
    expect(bindings.jump).toEqual(['KeyF', 'KeyH']);
    bindings = rebound(bindings, 'jump', 'KeyJ', 1);
    expect(bindings.jump).toEqual(['KeyF', 'KeyJ']);
  });

  it('rejects bad slots and empty codes', () => {
    expect(() => rebind(DEFAULT_BINDINGS, 'jump', 'KeyF', MAX_SLOTS)).toThrow(RangeError);
    expect(() => rebind(DEFAULT_BINDINGS, 'jump', 'KeyF', -1)).toThrow(RangeError);
    expect(() => rebind(DEFAULT_BINDINGS, 'jump', 'KeyF', 0.5)).toThrow(RangeError);
    expect(() => rebind(DEFAULT_BINDINGS, 'jump', '')).toThrow(RangeError);
  });
});

describe('unbind', () => {
  it('removes a slot and ignores empty ones', () => {
    const bindings = unbind(DEFAULT_BINDINGS, 'pause', 0);
    expect(bindings.pause).toEqual(['KeyP']);
    expect(unbind(bindings, 'jump', 1)).toBe(bindings);
    expect(unbind(bindings, 'jump', -1)).toBe(bindings);
  });
});

describe('findConflicts', () => {
  it('reports every shared code once', () => {
    const clash = { ...DEFAULT_BINDINGS, jump: ['KeyE'], crouch: ['KeyE'] };
    expect(findConflicts(clash)).toEqual([
      { code: 'KeyE', actions: ['jump', 'crouch'] },
      { code: 'KeyE', actions: ['jump', 'interact'] },
      { code: 'KeyE', actions: ['crouch', 'interact'] },
    ]);
  });
});

describe('actionsByCode', () => {
  it('lists every action on a shared code', () => {
    const clash = { ...DEFAULT_BINDINGS, jump: ['KeyE'] };
    expect(actionsByCode(clash).get('KeyE')).toEqual(['jump', 'interact']);
  });
});

describe('serialise / deserialise (the settings-store seam, mw-e02.22)', () => {
  it('round-trips custom bindings through JSON', () => {
    const custom = rebound(DEFAULT_BINDINGS, 'jump', 'KeyF');
    const data = JSON.parse(JSON.stringify(serializeBindings(custom))) as unknown;
    const { bindings, issues } = deserializeBindings(data);
    expect(issues).toEqual([]);
    expect(bindings).toEqual(custom);
    expect(Object.isFrozen(bindings)).toBe(true);
  });

  it('falls back to the defaults for data that is not version-1 or version-2 bindings', () => {
    for (const data of [null, 'x', [], { version: 3, actions: {} }, { version: 1 }]) {
      const { bindings, gamepad, issues } = deserializeBindings(data);
      expect(bindings).toBe(DEFAULT_BINDINGS);
      expect(gamepad).toBe(DEFAULT_PAD_BINDINGS);
      expect(issues).toHaveLength(1);
    }
  });

  it('keeps defaults for missing or malformed entries and ignores unknown actions', () => {
    const { bindings, issues } = deserializeBindings({
      version: BINDINGS_DATA_VERSION,
      actions: {
        jump: ['KeyF'],
        sprint: 'ShiftLeft',
        crouch: ['KeyC', 'KeyC'],
        interact: ['KeyE', 'KeyR', 'KeyT'],
        lockOn: [''],
        dance: ['KeyZ'],
      },
      gamepad: serializeBindings(DEFAULT_BINDINGS).gamepad,
    });
    expect(bindings.jump).toEqual(['KeyF']);
    expect(bindings.sprint).toEqual(DEFAULT_BINDINGS.sprint);
    expect(bindings.crouch).toEqual(DEFAULT_BINDINGS.crouch);
    expect(bindings.interact).toEqual(DEFAULT_BINDINGS.interact);
    expect(bindings.lockOn).toEqual(DEFAULT_BINDINGS.lockOn);
    expect(bindings.moveForward).toEqual(DEFAULT_BINDINGS.moveForward);
    expect(issues).toEqual([
      'sprint: invalid codes; using defaults',
      'crouch: invalid codes; using defaults',
      'interact: invalid codes; using defaults',
      'lockOn: invalid codes; using defaults',
      'dance: unknown action ignored',
    ]);
  });

  it('refuses a conflicting set whole and uses the defaults', () => {
    const { bindings, issues } = deserializeBindings({
      version: 1,
      actions: { jump: ['KeyE'] },
    });
    expect(bindings).toBe(DEFAULT_BINDINGS);
    expect(issues).toEqual(['conflicting bindings KeyE (jump, interact); using defaults']);
  });
});

describe('gamepad bindings (mw-e02.9)', () => {
  it('the default Xbox layout binds every button action but cycle target, slow walk (a light stick), drop and throw (on the inventory screen, mw-e17.10), with no conflicts', () => {
    expect(findConflicts(DEFAULT_PAD_BINDINGS)).toEqual([]);
    expect(DEFAULT_PAD_BINDINGS.jump).toEqual(['PadA']);
    expect(DEFAULT_PAD_BINDINGS.crouch).toEqual(['PadRS']);
    expect(DEFAULT_PAD_BINDINGS.dodge).toEqual(['PadB']);
    expect(DEFAULT_PAD_BINDINGS.ability3).toEqual(['PadLB']);
    expect(DEFAULT_PAD_BINDINGS.interact).toEqual(['PadX']);
    expect(DEFAULT_PAD_BINDINGS.primaryAttack).toEqual(['PadRB']);
    expect(DEFAULT_PAD_BINDINGS.secondaryAttack).toEqual(['PadLT']);
    expect(DEFAULT_PAD_BINDINGS.sprint).toEqual(['PadLS']);
    expect(DEFAULT_PAD_BINDINGS.lockOn).toEqual(['PadY']);
    expect(DEFAULT_PAD_BINDINGS.pause).toEqual(['PadMenu']);
    expect(DEFAULT_PAD_BINDINGS.inventory).toEqual(['PadView']);
    expect(DEFAULT_PAD_BINDINGS.ability1).toEqual(['PadRT']);
    const unbound = BINDABLE_ACTIONS.filter((action) => DEFAULT_PAD_BINDINGS[action].length === 0);
    expect(unbound).toEqual([
      'moveForward',
      'moveBack',
      'moveLeft',
      'moveRight',
      'slowWalk',
      'cycleTarget',
      ...Array.from({ length: 8 }, (_, i) => `spellSlot${String(i + 1)}`),
      'spellPrev',
      'spellNext',
      'drop',
      'throw',
    ]);
    for (const action of BINDABLE_ACTIONS) {
      expect(DEFAULT_PAD_BINDINGS[action].length).toBeLessThanOrEqual(MAX_SLOTS);
    }
  });

  it('rebinding a pad button follows the keyboard conflict rules', () => {
    const taken = rebind(DEFAULT_PAD_BINDINGS, 'jump', 'PadB');
    expect(taken).toEqual({ ok: false, conflict: { code: 'PadB', actions: ['jump', 'dodge'] } });
    const global = rebind(DEFAULT_PAD_BINDINGS, 'jump', 'PadMenu');
    expect(global.ok).toBe(false);
    // Guide is the spell wheel's button (mw-e06.16), so it has to be let go of first.
    expect(rebind(DEFAULT_PAD_BINDINGS, 'cycleTarget', 'PadGuide').ok).toBe(false);
    const cycle = rebound(unbind(DEFAULT_PAD_BINDINGS, 'spellWheel'), 'cycleTarget', 'PadGuide');
    expect(cycle.cycleTarget).toEqual(['PadGuide']);
  });

  it('round-trips both devices through JSON (version 2)', () => {
    const keys = rebound(DEFAULT_BINDINGS, 'jump', 'KeyF');
    const pad = rebound(unbind(DEFAULT_PAD_BINDINGS, 'lockOn'), 'jump', 'PadY', 1);
    const data = JSON.parse(JSON.stringify(serializeBindings(keys, pad))) as unknown;
    expect(data).toMatchObject({ version: BINDINGS_DATA_VERSION });
    const { bindings, gamepad, issues } = deserializeBindings(data);
    expect(issues).toEqual([]);
    expect(bindings).toEqual(keys);
    expect(gamepad).toEqual(pad);
    expect(gamepad.jump).toEqual(['PadA', 'PadY']);
    expect(serializeBindings(keys).gamepad).toEqual(
      serializeBindings(keys, DEFAULT_PAD_BINDINGS).gamepad,
    );
  });

  it('version 1 data (from before gamepads) reads with the default pad layout', () => {
    const v1 = { version: 1, actions: { jump: ['KeyF'] }, gamepad: { jump: ['PadB'] } };
    const { bindings, gamepad, issues } = deserializeBindings(v1);
    expect(issues).toEqual([]);
    expect(bindings.jump).toEqual(['KeyF']);
    expect(gamepad).toBe(DEFAULT_PAD_BINDINGS);
  });

  it('keeps each device to its own codes, and falls back per device', () => {
    const { bindings, gamepad, issues } = deserializeBindings({
      version: 2,
      actions: { jump: ['PadA'] },
      gamepad: { jump: ['Space'], crouch: ['PadY'], wave: ['PadB'] },
    });
    expect(bindings.jump).toEqual(DEFAULT_BINDINGS.jump);
    expect(gamepad).toBe(DEFAULT_PAD_BINDINGS);
    expect(issues).toEqual([
      'jump: invalid codes; using defaults',
      'gamepad jump: invalid codes; using defaults',
      'gamepad wave: unknown action ignored',
      'gamepad conflicting bindings PadY (crouch, lockOn); using defaults',
    ]);
    const missing = deserializeBindings({ version: 2, actions: {} });
    expect(missing.bindings).toEqual(DEFAULT_BINDINGS);
    expect(missing.gamepad).toBe(DEFAULT_PAD_BINDINGS);
    expect(missing.issues).toEqual(['gamepad: missing; using defaults']);
  });
});
