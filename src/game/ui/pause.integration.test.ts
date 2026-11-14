// @vitest-environment happy-dom
// The pause menu over a running game (mw-e01.3): the real frame loop, UI root, UI ↔ game bridge,
// input adapter and pause controller, wired as src/main.ts wires them, on a fake clock. AC-1: Esc
// stops the sim within a frame and 10 s paused leave the state hash alone. AC-2: with a creature in
// Combat, Save is disabled with the combat veto's reason and Resume still works.
import {
  BrainComponent,
  DAMAGE_COMPONENTS,
  defineComponent,
  giveCombatant,
  hashWorld,
  World,
  type Brain,
} from '@sim/index';
import { describe, expect, it, vi } from 'vitest';
import { combatVeto, COMBAT_VETO_ID, COMBAT_VETO_REASON } from '@game/creatures/save-veto';
import { createGameLoop, FakeFrames } from '@game/loop/index';
import { SafetyVetoes } from '@game/save/autosave/index';
import { createUiGameBridge, PauseController, SaveProgress } from '@game/ui/index';
import { UiRoot } from '@ui/index';

const Counter = defineComponent<number>('Counter');
const FRAME_MS = 1000 / 60;

/** A world that changes every tick, a skeleton that can fight, and the game's pause wiring. */
function game() {
  const world = new World<never>({ seed: 1 }).register(
    Counter,
    BrainComponent,
    ...DAMAGE_COMPONENTS,
  );
  const counter = world.spawn();
  world.add(counter, Counter, 0);
  world.addSystem({
    name: 'count',
    run: ({ world: w }) => {
      w.set(counter, Counter, (w.get(counter, Counter) ?? 0) + 1);
    },
  });
  const skeleton = world.spawn();
  giveCombatant(world, skeleton, { health: 60, poise: 30 });
  world.add(skeleton, BrainComponent, { state: 'unaware' } as Brain);
  const think = (state: Brain['state']): void => {
    world.set(skeleton, BrainComponent, { state } as Brain);
  };

  document.body.innerHTML = '';
  const ui = new UiRoot(document.body, { unstyled: true });
  const keys = new EventTarget();
  ui.attachInput({ window: keys, now: () => 0 });
  const bridge = createUiGameBridge<never>({ ui, sampleCommands: () => [] });
  const fake = new FakeFrames();
  const { loop } = createGameLoop({
    world,
    sources: { now: fake.now, scheduler: fake, visibility: fake },
    sampleCommands: bridge.sampleCommands,
    simPaused: bridge.simPaused,
    draw: () => {
      bridge.frame();
    },
  });
  const safety = new SafetyVetoes();
  safety.register(COMBAT_VETO_ID, combatVeto(world));
  const progress = new SaveProgress(() => world.tick);
  const openSave = vi.fn();
  const pause = new PauseController({
    ui,
    canPause: () => true,
    saveBlocked: () => safety.active()[0]?.reason ?? null,
    unsavedProgress: () => progress.unsaved,
    pauseKeys: () => ['Escape', 'KeyP'],
    openJournal: vi.fn(),
    openSettings: vi.fn(),
    openSave,
    openLoad: vi.fn(),
    quitToTitle: vi.fn(),
  });
  // After the UI's own listener, as in src/main.ts.
  keys.addEventListener('keydown', (event) => {
    if (pause.keydown(event as KeyboardEvent)) event.preventDefault();
  });
  const press = (code: string): void => {
    keys.dispatchEvent(new KeyboardEvent('keydown', { code, cancelable: true }));
  };
  loop.start();
  return { world, ui, fake, pause, press, think, openSave };
}

describe('pausing a running game (mw-e01.3)', () => {
  it('AC-1: Esc stops the sim within one frame; the state hash is unchanged after 10 s paused', () => {
    const { world, fake, pause, press } = game();
    for (let i = 0; i < 30; i++) fake.frame(FRAME_MS);
    expect(world.tick).toBeGreaterThan(20);

    press('Escape');
    expect(pause.isOpen).toBe(true);
    const tick = world.tick;
    const hash = hashWorld(world);
    fake.frame(FRAME_MS); // the next frame already runs no step
    expect(world.tick).toBe(tick);
    for (let i = 0; i < 600; i++) fake.frame(FRAME_MS); // 10 real seconds paused
    expect(world.tick).toBe(tick);
    expect(hashWorld(world)).toBe(hash);

    // Esc again is the menu's Back: it resumes, and the paused time is not caught up.
    press('Escape');
    expect(pause.isOpen).toBe(false);
    fake.frame(FRAME_MS);
    expect(world.tick).toBe(tick + 1);
  });

  it('AC-2: with the skeleton in Combat, Save is disabled with the reason and Resume still works', () => {
    const { world, ui, fake, pause, press, think, openSave } = game();
    think('combat');
    fake.frame(FRAME_MS);
    press('Escape');
    const menu = pause.menu;
    expect(menu).toBeDefined();
    const save = menu?.buttons.save;
    expect(save?.getAttribute('aria-disabled')).toBe('true');
    expect(save?.dataset['reason']).toBe(COMBAT_VETO_REASON);
    expect(document.querySelector('[data-testid="pause-save-reason"]')?.textContent).toBe(
      "Can't save during combat",
    );
    save?.click();
    expect(openSave).not.toHaveBeenCalled();
    const tick = world.tick;
    menu?.buttons.resume.click();
    expect(pause.isOpen).toBe(false);
    expect(ui.top).toBeUndefined();
    fake.frame(FRAME_MS);
    expect(world.tick).toBe(tick + 1);

    // Out of combat, the next pause offers Save again.
    think('searching');
    press('KeyP');
    expect(pause.menu?.buttons.save.hasAttribute('aria-disabled')).toBe(false);
    pause.menu?.buttons.save.click();
    expect(openSave).toHaveBeenCalledOnce();
  });
});
