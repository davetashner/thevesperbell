// @vitest-environment happy-dom
// The spell hotbar and wheel in the game (mw-e06.16), against the real installed magic: slot keys,
// previous/next, the casting controller's use of the selected slot, the hotbar models (cooldown,
// mana, channel) and the hold-to-open wheel.
import { describe, expect, it } from 'vitest';
import type { SpellEntry } from '@content/index';
import {
  actionButton,
  actionFrame,
  actionVector,
  DamageModel,
  hotbarOf,
  installStimuli,
  learnSpell,
  learnSpellCommand,
  manaOf,
  placeEntity,
  registerWorldProperties,
  SpellHotbarComponent,
  SpellSelected,
  stimulusSystem,
  World,
  type ActionFrame,
  type ButtonAction,
  type CollisionWorld,
  type SpellSelectedInfo,
} from '@sim/index';
import { makeSpell } from '@sim/magic/testing';
import { SpellHotbar, SpellWheel } from '@ui/index';
import type { AimRay } from './aim';
import { SpellCaster, type SpellCommand } from './caster';
import {
  affordable,
  attachSpellBar,
  SpellWheelControl,
  spellSlotModels,
  WHEEL_MOUSE_RADIUS,
  WHEEL_TIME_SCALE,
  wheelModel,
} from './hotbar';
import { debugSpellLearner, givePlayerMagic, installGameMagic } from './install';
import { loadSpellFixtureContent } from '@content/test-fixtures';

type Input = ActionFrame | SpellCommand | ReturnType<typeof learnSpellCommand>;

const nothing: CollisionWorld = {
  sweepCapsule: () => undefined,
  overlapCapsule: () => false,
  bodyVelocity: () => ({ x: 0, y: 0, z: 0 }),
  raycast: () => undefined,
};

interface Held {
  pressed?: ButtonAction[];
  held?: ButtonAction[];
  released?: ButtonAction[];
  look?: [number, number];
  stick?: [number, number];
}
const frameOf = ({
  pressed = [],
  held = [],
  released = [],
  look = [0, 0],
  stick = [0, 0],
}: Held = {}) =>
  actionFrame({
    move: actionVector(0, 0),
    look: actionVector(...look),
    lookStick: actionVector(...stick),
    buttons: (a) =>
      actionButton(
        pressed.includes(a),
        held.includes(a) || pressed.includes(a),
        released.includes(a),
      ),
  });

const IDS = ['t-a', 't-b', 't-c'];
const SPELLS = {
  alpha: makeSpell('t-a', { name: 'Alpha', cost: { mana: 10 }, cooldown: 1.5 }),
  beta: makeSpell('t-b', { name: 'Beta', cost: { mana: 30 } }),
  over: makeSpell('t-over', {
    name: 'Reckless',
    cost: { mana: 500 },
    flags: { tooUseful: false, castWhileMoving: false, allowOvercast: true },
  }),
};
const GAMMA = makeSpell('t-c', {
  name: 'Gamma',
  cost: { mana: 5 },
  channel: { interval: 0.25, manaPerSecond: 2, maxDuration: 6 },
});
const spells: SpellEntry[] = [SPELLS.alpha, SPELLS.beta, GAMMA, SPELLS.over];

function game(mana = 100, extra: readonly SpellEntry[] = [], canCast?: () => boolean) {
  const content = loadSpellFixtureContent();
  const world = new World<Input>({ seed: 5 });
  installStimuli(registerWorldProperties(world));
  const magic = installGameMagic(world, {
    spells: [...spells, ...extra],
    damage: new DamageModel(),
    collision: nothing,
    invulnerable: () => false,
    learn: debugSpellLearner(content),
  });
  world.addSystem(stimulusSystem());
  const player = world.spawn();
  placeEntity(world, player, { x: 0, y: 0, z: 0 }, 0.4);
  givePlayerMagic(world, player, mana);
  const caster = new SpellCaster({
    world,
    caster: player,
    spells: magic.spells,
    collision: nothing,
    ...(canCast !== undefined && { canCast }),
  });
  const ray = (): AimRay => ({ origin: { x: 0, y: 2, z: 3 }, direction: { x: 0, y: 0, z: -1 } });
  const selected: SpellSelectedInfo[] = [];
  world.events.on(SpellSelected, (e) => selected.push(e));
  const step = (f: ActionFrame): readonly SpellCommand[] => {
    const commands = caster.commands(f, ray);
    world.step([f, ...commands]);
    return commands;
  };
  const learn = (...ids: string[]): void => {
    world.step(ids.map((id) => learnSpellCommand(player, id)));
    world.step([]);
  };
  return { world, magic, player, caster, step, learn, selected };
}

describe('hotbar keys and the cast button (mw-e06.16)', () => {
  it('AC-1: with spells in slots 1-3, key 2 selects slot 2 and a SpellSelected event fires', () => {
    const { world, player, caster, step, learn, selected } = game();
    learn(...IDS);
    expect(hotbarOf(world, player)?.slots.slice(0, 3)).toEqual(IDS);
    expect(caster.selected).toBe('t-a'); // the first learned spell is selected
    const sent = step(frameOf({ pressed: ['spellSlot2'] }));
    expect(sent).toEqual([{ type: 'select-spell-slot', caster: player, slot: 1 }]);
    expect(caster.selected).toBe('t-b');
    expect(hotbarOf(world, player)?.selected).toBe(1);
    expect(selected.map((e) => [e.slot, e.spell])).toEqual([
      [0, 't-a'],
      [1, 't-b'],
    ]);
  });

  it('AC-4: a key for an empty slot (or the selected slot) selects nothing and sends nothing', () => {
    const { world, player, caster, step, learn, selected } = game();
    expect(step(frameOf({ pressed: ['spellSlot1'] }))).toEqual([]); // no hotbar yet
    expect(step(frameOf({ pressed: ['spellNext'] }))).toEqual([]);
    expect(caster.slotCommands(0)).toEqual([]);
    learn('t-a');
    expect(step(frameOf({ pressed: ['spellSlot5'] }))).toEqual([]);
    expect(step(frameOf({ pressed: ['spellSlot1'] }))).toEqual([]); // already selected
    expect(step(frameOf({ pressed: ['spellNext'] }))).toEqual([]); // nowhere else to go
    expect(step(frameOf({ pressed: ['spellPrev'] }))).toEqual([]);
    expect(caster.selected).toBe('t-a');
    expect(hotbarOf(world, player)?.selected).toBe(0);
    expect(selected).toHaveLength(1);
  });

  it('a cast pressed in the same frame as a slot key casts the newly selected spell', () => {
    const { player, step, learn, world } = game();
    learn(...IDS);
    const sent = step(frameOf({ pressed: ['spellSlot2', 'cast'] }));
    expect(sent.map((c) => c.type)).toEqual(['select-spell-slot', 'cast']);
    expect(sent[1]).toMatchObject({ type: 'cast', caster: player, spell: 't-b' });
    expect(manaOf(world, player)?.current).toBeLessThan(100);
  });

  it('previous and next step through the filled slots, wrapping', () => {
    const { world, player, caster, step, learn } = game();
    learn(...IDS);
    step(frameOf({ pressed: ['spellNext'] }));
    expect(caster.selected).toBe('t-b');
    step(frameOf({ pressed: ['spellNext'] }));
    step(frameOf({ pressed: ['spellNext'] }));
    expect(caster.selected).toBe('t-a'); // past the last filled slot, back to the first
    step(frameOf({ pressed: ['spellPrev'] }));
    expect(caster.selected).toBe('t-c');
    expect(hotbarOf(world, player)?.selected).toBe(2);
  });

  it.each(['spellNext', 'spellPrev'] as const)(
    'with nothing selected, %s lands on a filled slot',
    (action) => {
      const { world, player, caster, step, learn } = game();
      learn('t-a', 't-b');
      world.step([{ type: 'assign-spell-slot', caster: player, slot: 0, spell: null } as never]);
      expect(hotbarOf(world, player)?.selected).toBeNull();
      step(frameOf({ pressed: [action] }));
      expect(caster.selected).toBe('t-b');
      expect(hotbarOf(world, player)?.selected).toBe(1);
    },
  );

  it('a dead caster sends no slot commands', () => {
    let alive = true;
    const { caster, learn } = game(10, [], () => alive);
    learn('t-a', 't-b');
    expect(caster.slotCommands(1)).toHaveLength(1);
    expect(caster.slotCommands(0)).toEqual([]); // selected already
    expect(caster.slotCommands(6)).toEqual([]); // empty
    alive = false;
    expect(caster.slotCommands(1)).toEqual([]);
  });

  it('select(id) puts a spell off the bar in the first empty slot, or the selected one when full', () => {
    const ids = Array.from({ length: 8 }, (_, i) => `t-x${String(i)}`);
    const { world, player, caster, learn } = game(
      100,
      ids.map((id) => makeSpell(id)),
    );
    expect(caster.select('t-a')).toBe(false); // not learned
    learn(...ids, 't-a');
    expect(hotbarOf(world, player)?.slots).toEqual(ids);
    expect(caster.select('t-x3')).toBe(true); // already on the bar
    expect(hotbarOf(world, player)?.selected).toBe(3);
    world.set(player, SpellHotbarComponent, { slots: ids, selected: null });
    expect(caster.select('t-a')).toBe(true); // full, nothing selected: replaces slot 1
    expect(hotbarOf(world, player)?.slots[0]).toBe('t-a');
    expect(caster.select('t-x3')).toBe(true);
    expect(caster.select('t-x0')).toBe(true); // full: replaces the selected slot
    expect(caster.selected).toBe('t-x0');
    expect(hotbarOf(world, player)?.slots[3]).toBe('t-x0');
  });

  it('select(id) for a spell learned without the hotbar sees it takes the first slot', () => {
    const { world, player, caster } = game();
    learnSpell(world, player, 't-b');
    expect(hotbarOf(world, player)).toBeUndefined();
    expect(caster.selected).toBe('t-b');
    expect(caster.select('t-b')).toBe(true);
    expect(hotbarOf(world, player)).toMatchObject({
      slots: ['t-b', null, null, null, null, null, null, null],
      selected: 0,
    });
    learnSpell(world, player, 't-c'); // learned outside the hotbar's reach: first empty slot
    expect(caster.select('t-c')).toBe(true);
    expect(hotbarOf(world, player)?.slots[1]).toBe('t-c');
  });
});

describe('hotbar models', () => {
  it('AC-2: a spell on cooldown shows the seconds left and is unavailable', () => {
    const { world, player, magic, step, learn } = game();
    learn('t-a');
    step(frameOf({ pressed: ['cast'] }));
    const [slot] = spellSlotModels(world, player, magic.spells);
    expect(slot).toMatchObject({ name: 'Alpha', cost: 10, cooldownTotal: 1.5, selected: true });
    expect(slot?.cooldown).toBeGreaterThan(1.4);
    expect(slot?.cooldown).toBeLessThanOrEqual(1.5);
    const bar = new SpellHotbar();
    bar.update(spellSlotModels(world, player, magic.spells));
    const first = bar.element.querySelector<HTMLElement>('.vb-spell-slot');
    expect(first?.dataset['state']).toBe('cooldown');
    expect(first?.querySelector('.vb-spell-slot-timer')?.textContent).toMatch(/^1\.[45]$/);
    for (let i = 0; i < 100; i++) world.step([]); // 1.67 s at 60 Hz
    expect(spellSlotModels(world, player, magic.spells)[0]?.cooldown).toBe(0);
  });

  it('AC-3: a spell costing more than the mana left shows unaffordable; over-casting may not', () => {
    const { world, player, magic, learn } = game(20);
    learn('t-a', 't-b', 't-over');
    const models = spellSlotModels(world, player, magic.spells);
    expect(models.map((m) => m.affordable)).toEqual([
      true,
      false,
      true,
      true,
      true,
      true,
      true,
      true,
    ]);
    const bar = new SpellHotbar();
    bar.update(models);
    const states = [...bar.element.querySelectorAll<HTMLElement>('.vb-spell-slot')].map(
      (e) => e.dataset['state'],
    );
    expect(states.slice(0, 4)).toEqual(['ready', 'unaffordable', 'ready', 'empty']);
    expect(affordable(SPELLS.beta, 20)).toBe(false);
    expect(affordable(SPELLS.over, 20)).toBe(true);
    expect(affordable(SPELLS.beta, 30)).toBe(true);
  });

  it('marks the channelled spell while it channels, and nothing on an empty bar', () => {
    const { world, player, magic, step, learn } = game();
    expect(spellSlotModels(world, player, magic.spells).every((m) => m.name === '')).toBe(true);
    learn('t-c');
    step(frameOf({ pressed: ['cast'], held: ['cast'] }));
    step(frameOf({ held: ['cast'] }));
    expect(spellSlotModels(world, player, magic.spells)[0]?.channelling).toBe(true);
    step(frameOf({ released: ['cast'] }));
    step(frameOf());
    expect(spellSlotModels(world, player, magic.spells)[0]?.channelling).toBe(false);
  });

  it('a slot whose spell the content no longer has shows empty', () => {
    const { world, player, learn } = game();
    learn('t-a');
    expect(spellSlotModels(world, player, () => undefined)[0]?.name).toBe('');
  });
});

describe('the quick-select wheel', () => {
  it('opens while held, points with the mouse, and a release selects the pointed slot', () => {
    const control = new SpellWheelControl();
    expect(control.open).toBe(false);
    control.shape(frameOf({ pressed: ['spellWheel'] }));
    expect(control.open).toBe(true);
    expect(control.highlight).toBeNull();
    const right = frameOf({ held: ['spellWheel'], look: [WHEEL_MOUSE_RADIUS, 0] });
    const shaped = control.shape(right);
    expect(shaped.look).toEqual({ x: 0, y: 0 }); // the view does not turn
    expect(control.highlight).toBe(2); // right of centre = slot 3
    const up = control.shape(
      frameOf({ held: ['spellWheel'], look: [-WHEEL_MOUSE_RADIUS, WHEEL_MOUSE_RADIUS * 2] }),
    );
    expect(up.look).toEqual({ x: 0, y: 0 });
    expect(control.highlight).toBe(0); // a flick up (y up) and back left
    control.shape(frameOf({ released: ['spellWheel'] }));
    expect(control.open).toBe(false);
    expect(control.takePicks()).toEqual([0]);
    expect(control.takePicks()).toEqual([]);
  });

  it('points with the right stick, and a release at the centre picks nothing', () => {
    const control = new SpellWheelControl();
    control.shape(frameOf({ pressed: ['spellWheel'], stick: [0, -1] }));
    expect(control.highlight).toBe(4); // stick down = bottom slot
    control.shape(frameOf({ held: ['spellWheel'], stick: [-1, 0] }));
    expect(control.highlight).toBe(6);
    control.shape(frameOf({ held: ['spellWheel'] }));
    control.shape(frameOf({ released: ['spellWheel'], look: [0, 0] }));
    expect(control.takePicks()).toEqual([6]);
    control.shape(frameOf({ pressed: ['spellWheel'] }));
    control.shape(frameOf({ released: ['spellWheel'] }));
    expect(control.takePicks()).toEqual([]);
  });

  it('frames pass through untouched while it is closed, and close() abandons it', () => {
    const control = new SpellWheelControl();
    const idle = frameOf({ look: [5, 5] });
    expect(control.shape(idle)).toBe(idle);
    control.shape(frameOf({ pressed: ['spellWheel'] }));
    control.close();
    expect(control.open).toBe(false);
    expect(control.highlight).toBeNull();
  });

  it('a wheel dropped from the held state (focus lost) closes too', () => {
    const control = new SpellWheelControl();
    control.shape(frameOf({ pressed: ['spellWheel'], look: [0, WHEEL_MOUSE_RADIUS] }));
    expect(control.highlight).toBe(0);
    control.shape(frameOf());
    expect(control.open).toBe(false);
    expect(control.takePicks()).toEqual([0]);
  });

  it('wheelModel is closed when closed, and marks ready, selected and highlighted slots', () => {
    expect(wheelModel([], false, null).open).toBe(false);
    const slots = [
      {
        name: 'A',
        cost: 1,
        cooldown: 0,
        cooldownTotal: 0,
        affordable: true,
        selected: true,
        channelling: false,
      },
      {
        name: 'B',
        cost: 1,
        cooldown: 2,
        cooldownTotal: 3,
        affordable: true,
        selected: false,
        channelling: false,
      },
      {
        name: '',
        cost: 0,
        cooldown: 0,
        cooldownTotal: 0,
        affordable: true,
        selected: false,
        channelling: false,
      },
    ];
    const model = wheelModel(slots, true, 1);
    expect(model.selected).toBe(0);
    expect(model.highlight).toBe(1);
    expect(model.slots.map((s) => s.ready)).toEqual([true, false, true]);
    expect(wheelModel(slots.slice(1), true, null).selected).toBeNull();
  });
});

describe('attachSpellBar', () => {
  it('AC-6: opening the wheel slows the sim to 0.25 (when the option is on) until it closes', () => {
    const { world, player, magic, learn } = game();
    const hotbar = new SpellHotbar();
    const wheel = new SpellWheel();
    const control = new SpellWheelControl();
    let scale = 1;
    let slows = true;
    let paused = false;
    const bar = attachSpellBar({
      world,
      player,
      spells: magic.spells,
      hotbar,
      wheel,
      control,
      slowsTime: () => slows,
      timeScale: () => scale,
      setTimeScale: (s) => (scale = s),
      paused: () => paused,
    });
    scale = 0.5; // a speed set from the console
    bar.frame();
    expect(scale).toBe(0.5); // untouched while the wheel is shut
    expect(hotbar.element.hidden).toBe(true); // nothing learned yet
    expect(wheel.element.hidden).toBe(true);
    learn('t-a', 't-b');
    bar.frame();
    expect(hotbar.element.hidden).toBe(false);
    control.shape(frameOf({ pressed: ['spellWheel'] }));
    bar.frame();
    expect(scale).toBe(WHEEL_TIME_SCALE);
    expect(wheel.element.hidden).toBe(false);
    expect(wheel.element.querySelectorAll('.vb-spell-wheel-slot')).toHaveLength(8);
    slows = false;
    bar.frame();
    expect(scale).toBe(0.5);
    slows = true;
    bar.frame();
    expect(scale).toBe(WHEEL_TIME_SCALE);
    control.shape(frameOf({ released: ['spellWheel'] }));
    bar.frame();
    expect(scale).toBe(0.5); // given back
    expect(wheel.element.hidden).toBe(true);
    control.shape(frameOf({ pressed: ['spellWheel'] }));
    bar.frame();
    expect(scale).toBe(WHEEL_TIME_SCALE);
    paused = true; // a menu opened
    bar.frame();
    expect(control.open).toBe(false);
    expect(scale).toBe(0.5);
  });
});
