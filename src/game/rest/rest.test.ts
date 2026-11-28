// @vitest-environment happy-dom
// Resting in the game (mw-e27.13): a real world with the game content's rest point kinds, the UI root
// and the glue between them. The rules themselves are src/sim/rest/rules.test.ts; the browser run is
// e2e/rest.spec.ts.
import { loadGameContent } from '@content/index';
import { markExercised } from '@content/testing';
import {
  actionButton,
  actionFrame,
  actionVector,
  addInteractable,
  addInteractor,
  CharacterController,
  DAMAGE_COMPONENTS,
  giveCombatant,
  HealthComponent,
  initialCharacterState,
  installGameClock,
  installInteraction,
  InteractableComponent,
  interactableOf,
  interactionPrompt,
  interacted,
  makeRestPoint,
  PlacementComponent,
  PlayerLook,
  registerWorldProperties,
  setProperty,
  totalMinutes,
  World,
  addProperties,
  REST_INTERRUPT_PREFIX,
  DEFAULT_CLOCK_CONFIG,
  type ActionFrame,
  type EntityId,
} from '@sim/index';
import { UiRoot } from '@ui/index';
import { find, rectFromData } from '@ui/testing/layout';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  durationId,
  durationLabel,
  outcomeText,
  restKindSpecs,
  startRestUi,
  type RestReading,
} from './rest';

const content = loadGameContent();
const IDLE = actionFrame({
  move: actionVector(0, 0),
  look: actionVector(0, 0),
  buttons: () => actionButton(false, false, false),
});

beforeEach(() => {
  document.body.innerHTML = '';
});

function setup(
  options: { gameClock?: boolean; publish?: boolean; safety?: () => string | null } = {},
) {
  const { gameClock = true, publish = true } = options;
  const world = registerWorldProperties(new World<ActionFrame>({ seed: 3 }));
  world.register(CharacterController, PlayerLook, PlacementComponent, ...DAMAGE_COMPONENTS);
  installInteraction(world, {});
  const sim = world as unknown as World<never>;
  const clock = gameClock ? installGameClock(sim, DEFAULT_CLOCK_CONFIG) : undefined;
  clock?.setTime({ day: 1, minute: 22 * 60 });
  const player = world.spawn();
  world.add(player, CharacterController, initialCharacterState({ x: 0, y: 0, z: 0 }));
  world.add(player, PlayerLook, { yaw: 0, pitch: 0 });
  addInteractor(sim, player, {});
  giveCombatant(sim, player, { health: 100 });
  sim.set(player, HealthComponent, { max: 100, current: 20 });
  const point = world.spawn();
  addProperties(sim, point, { flammable: true, burning: true, fuel: 100, temperature: 300 });
  addInteractable(
    sim,
    point,
    {
      affordances: [{ verb: 'rest', label: 'Rest by the fire' }],
      range: 2.8,
    },
    { x: 0, y: 1, z: -1.5 },
  );
  makeRestPoint(sim, point, 'campfire', 'camp-1');
  world.step([IDLE]);
  const ui = new UiRoot(document.body, { unstyled: true, focus: { rectOf: rectFromData } });
  const published: Record<string, unknown[]> = { restUi: [], clock: [] };
  const toasts: string[] = [];
  const rest = startRestUi({
    ui,
    world: sim,
    content,
    player,
    ...(options.safety !== undefined && { safety: options.safety }),
    toast: (text) => toasts.push(text),
    ...(publish && {
      publish: (key: 'restUi' | 'clock', value: string) => published[key]?.push(JSON.parse(value)),
    }),
  });
  const step = (): void => {
    world.step([IDLE]);
    rest.afterStep();
  };
  /** The player uses the rest verb on `target`. */
  const useRest = (target: EntityId = point): void => {
    world.events.emit(interacted, { actor: player, target, verb: 'rest', affordance: 0 });
    step();
  };
  const press = (action: string): void => {
    (find(`[data-action="${action}"]`) as HTMLButtonElement).click();
  };
  const readings = (): RestReading[] => published['restUi'] as RestReading[];
  return {
    world,
    sim,
    clock,
    player,
    point,
    ui,
    rest,
    step,
    useRest,
    press,
    toasts,
    published,
    readings,
  };
}

describe('resting in the game (mw-e27.13)', () => {
  it('AC-7: using a burning campfire opens the rest menu; resting 8 h passes the time, heals fully and closes it', ({
    task,
  }) => {
    markExercised(task, 'rest-point', 'campfire');
    const t = setup();
    t.useRest();
    expect(t.ui.top?.id).toBe('rest');
    expect(find('[data-testid="rest-window"] h1').textContent).toBe('Campfire');
    expect(
      [...document.querySelectorAll('[data-testid="rest-durations"] button')].map(
        (b) => b.textContent,
      ),
    ).toEqual(['Until dawn', 'Until dusk', '2 hours', '8 hours']);
    expect(t.readings().at(-1)).toMatchObject({ open: true, point: 'camp-1', kind: 'campfire' });
    const before = t.clock?.total() ?? 0;
    t.press('rest:hours-8');
    expect((t.clock?.total() ?? 0) - before).toBe(8 * 60);
    expect(t.sim.get(t.player, HealthComponent)?.current).toBe(100);
    expect(t.ui.top).toBeUndefined();
    expect(t.toasts).toEqual(['You rest for 8 h and wake at Day 2, 06:00.']);
    expect(t.readings().at(-1)).toMatchObject({
      open: false,
      last: { ok: true, hours: 8, interrupted: null },
    });
  });

  it('AC-1: the prompt greys the rest verb with the reason while the fire is out, and offers it once it burns', () => {
    const t = setup();
    setProperty(t.sim, t.point, 'burning', false);
    t.step();
    expect(interactionPrompt(t.sim, t.player)).toMatchObject({
      verb: 'rest',
      available: false,
      reason: 'The fire is out',
    });
    setProperty(t.sim, t.point, 'burning', true);
    t.step();
    expect(interactionPrompt(t.sim, t.player)).toMatchObject({ verb: 'rest', available: true });
    // Other verbs are not the rest rules' business.
    t.sim.set(
      t.point,
      InteractableComponent,
      interactableOf({ affordances: [{ verb: 'pull' }], range: 2.8 }),
    );
    t.step();
    expect(interactionPrompt(t.sim, t.player)).toMatchObject({ verb: 'pull', available: true });
  });

  it('AC-2: an objecting autosave veto greys the verb and every duration, with its reason', () => {
    let veto: string | null = 'Enemies are hunting you';
    const t = setup({ safety: () => veto });
    t.step();
    expect(interactionPrompt(t.sim, t.player)).toMatchObject({
      available: false,
      reason: 'Enemies are hunting you',
    });
    veto = null;
    t.step();
    t.useRest();
    veto = 'Enemies are hunting you';
    // Something turned up while the menu was open: the rest is refused, nothing moves, it stays open.
    const before = t.clock?.total() ?? 0;
    t.press('rest:dawn');
    expect(t.clock?.total()).toBe(before);
    expect(t.ui.top?.id).toBe('rest');
    expect(find('[data-testid="rest-status"]').textContent).toBe('Enemies are hunting you');
    expect(t.readings().at(-1)).toMatchObject({
      open: true,
      last: { ok: false, detail: 'Enemies are hunting you' },
    });
    expect(t.toasts).toEqual([]);
  });

  it('AC-2: with a veto in force the menu opens with its durations disabled', () => {
    const t = setup({ safety: () => 'Not now' });
    expect(t.rest.controller.open(t.point)).toBe(true);
    const buttons = [...document.querySelectorAll<HTMLButtonElement>('[data-action^="rest:"]')];
    expect(buttons).toHaveLength(4);
    expect(buttons.every((b) => b.disabled && b.title === 'Not now')).toBe(true);
  });

  it('AC-4: actions other systems register are listed on the menu; unavailable ones say why; invoking runs them', () => {
    const t = setup();
    const done: string[] = [];
    t.rest.rules.registerAction({
      id: 'assemble',
      label: 'Assemble arrows',
      priority: 2,
      perform: () => done.push('assemble'),
    });
    t.rest.rules.registerAction({
      id: 'recharge',
      label: 'Recharge artifacts',
      priority: 1,
      unavailable: () => 'Nothing to recharge',
      perform: () => done.push('recharge'),
    });
    t.useRest();
    expect(
      [...document.querySelectorAll<HTMLButtonElement>('[data-testid="rest-actions"] button')].map(
        (b) => [b.textContent, b.disabled],
      ),
    ).toEqual([
      ['Recharge artifacts', true],
      ['Assemble arrows', false],
    ]);
    t.press('action:assemble');
    expect(done).toEqual(['assemble']);
    expect(find('[data-testid="rest-status"]').textContent).toBe('');
    // The action vanished (its system unregistered): the menu says so.
    t.rest.rules.leave(t.player);
    t.press('action:assemble');
    expect(find('[data-testid="rest-status"]').textContent).toBe('Only at a rest point');
  });

  it('AC-5: an interrupt scheduled during the rest wakes the player with its message and reports it', () => {
    const t = setup();
    t.clock?.schedule.at(totalMinutes({ day: 2, minute: 120 }), `${REST_INTERRUPT_PREFIX}wolves`, {
      message: 'Wolves!',
    });
    t.useRest();
    t.press('rest:hours-8');
    expect(t.toasts).toEqual(['Wolves! (Day 2, 02:00)']);
    expect(t.readings().at(-1)).toMatchObject({
      last: { ok: true, hours: 4, interrupted: `${REST_INTERRUPT_PREFIX}wolves` },
    });
    expect(t.sim.get(t.player, HealthComponent)?.current).toBe(70);
  });

  it('the menu opens once, not over another screen, and not for something that is not a rest point', () => {
    const t = setup();
    const stone = t.world.spawn();
    expect(t.rest.controller.open(stone)).toBe(false);
    expect(t.rest.controller.open(t.point)).toBe(true);
    expect(t.rest.controller.isOpen).toBe(true);
    expect(t.rest.controller.open(t.point)).toBe(false);
    t.rest.controller.close();
    expect(t.rest.controller.isOpen).toBe(false);
    t.ui.push({ id: 'other', label: 'Other', content: document.createElement('div') });
    t.useRest();
    expect(t.ui.top?.id).toBe('other');
    // Other players' interactions and other verbs do nothing.
    const other = t.world.spawn();
    t.world.events.emit(interacted, { actor: other, target: t.point, verb: 'rest', affordance: 0 });
    t.world.events.emit(interacted, {
      actor: t.player,
      target: t.point,
      verb: 'light',
      affordance: 0,
    });
    t.step();
    expect(t.ui.top?.id).toBe('other');
    t.rest.controller.dispose();
    t.rest.controller.dispose();
  });

  it('the HUD shows the game clock and publishes it when it changes; without a game clock it stays empty', () => {
    const t = setup();
    expect(find('[data-testid="clock-hud"]').textContent).toBe('Day 1 · 22:00');
    expect(find('[data-testid="clock-hud"]').dataset['phase']).toBe('night');
    t.clock?.advanceTime(8 * 60, 'test');
    t.step();
    t.step();
    expect(find('[data-testid="clock-hud"]').textContent).toBe('Day 2 · 06:00');
    expect(t.published['clock']).toEqual([
      { day: 1, minute: 1320, phase: 'night', text: 'Day 1 · 22:00' },
      { day: 2, minute: 360, phase: 'dawn', text: 'Day 2 · 06:00' },
    ]);
    document.body.innerHTML = '';
    const bare = setup({ gameClock: false, publish: false });
    expect(find('[data-testid="clock-hud"]').textContent).toBe('');
    bare.step();
  });

  it('names the durations and the outcomes in words', () => {
    expect(durationId({ kind: 'dawn' })).toBe('dawn');
    expect(durationId({ kind: 'hours', hours: 2 })).toBe('hours-2');
    expect(durationLabel({ kind: 'dusk' })).toBe('Until dusk');
    expect(durationLabel({ kind: 'hours', hours: 1 })).toBe('1 hour');
    expect(outcomeText({ ok: false, reason: 'no-fire', detail: 'The fire is out' })).toBe(
      'The fire is out',
    );
    expect(restKindSpecs(content).map((k) => k.id)).toEqual(['campfire', 'inn', 'shrine']);
  });
});
