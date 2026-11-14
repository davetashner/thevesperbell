// @vitest-environment happy-dom
// The slice-complete card over a running game (mw-e01.18): the real frame loop, UI root, UI ↔ game
// bridge and the real autosave scheduler on a fake clock, wired as src/main.ts wires them.
import { World } from '@sim/index';
import { describe, expect, it, vi } from 'vitest';
import { createGameLoop, FakeFrames } from '@game/loop/index';
import { AutosaveScheduler } from '@game/save/autosave/index';
import type { SaveSlots } from '@game/save/slots/index';
import { createUiGameBridge, SliceCompleteController } from '@game/ui/index';
import { SLICE_COMPLETE_TEXT, UiRoot } from '@ui/index';

const FRAME_MS = 1000 / 60;
const FACT = 'slice.complete';

interface Options {
  readonly blocked?: string;
  readonly overwrite?: () => Promise<unknown>;
}

function game(options: Options = {}) {
  const world = new World<never>({ seed: 1 });
  document.body.innerHTML = '';
  const ui = new UiRoot(document.body, { unstyled: true });
  const sampled = vi.fn(() => ['move'] as never[]);
  const bridge = createUiGameBridge<never>({ ui, sampleCommands: sampled });
  const fake = new FakeFrames();
  const returnToTitle = vi.fn();
  let blocked = options.blocked ?? null;
  const card = new SliceCompleteController({
    ui,
    world,
    fact: FACT,
    className: () => 'Knight',
    saveBlocked: () => blocked,
    returnToTitle,
  });
  const slots = {
    list: () => Promise.resolve([{ state: 'empty', slot: 'auto-1' }]),
    // The world is captured when the autosave is decided (mw-e01.21); writing it is what takes time.
    capture: () => ({
      writeTo: options.overwrite ?? (() => Promise.resolve({ summary: {}, thumbnail: {} })),
    }),
  } as unknown as SaveSlots;
  const scheduler = new AutosaveScheduler({ slots, describe: () => ({}) as never });
  scheduler.subscribe((event) => {
    card.autosave(event);
  });
  const { loop } = createGameLoop({
    world,
    sources: { now: fake.now, scheduler: fake, visibility: fake },
    sampleCommands: bridge.sampleCommands,
    simPaused: bridge.simPaused,
    draw: () => {
      bridge.frame();
      card.frame();
    },
  });
  loop.start();
  const complete = (): void => {
    world.facts.set(FACT, true);
    scheduler.request({ kind: 'quest', source: FACT });
  };
  return {
    world,
    ui,
    fake,
    card,
    sampled,
    bridge,
    scheduler,
    returnToTitle,
    complete,
    unblock: () => {
      blocked = null;
    },
  };
}

const saveLine = (): string | null =>
  document.querySelector('[data-testid="slice-complete-save"]')?.textContent ?? null;

describe('the slice-complete card over a running game (mw-e01.18)', () => {
  it('AC-1: the frame after slice.complete turns true shows the card, focuses Return to title and withholds input', () => {
    const { world, ui, fake, card, bridge, sampled, complete } = game();
    for (let i = 0; i < 5; i++) fake.frame(FRAME_MS);
    expect(card.shown).toBe(false);
    expect(bridge.sampleCommands(world.tick)).toEqual(['move']);

    complete();
    fake.frame(FRAME_MS);
    expect(card.shown).toBe(true);
    const button = document.querySelector<HTMLElement>('[data-testid="slice-complete-return"]');
    expect(document.activeElement).toBe(button);
    expect(ui.capturesInput).toBe(true);
    // The sampler still runs but its commands never reach the sim: the knight no longer moves.
    sampled.mockClear();
    expect(bridge.sampleCommands(world.tick)).toEqual([]);
    expect(sampled).toHaveBeenCalled();
    // The sim keeps running (the completion autosave needs it).
    const tick = world.tick;
    fake.frame(FRAME_MS);
    expect(world.tick).toBe(tick + 1);
  });

  it('AC-2: a run from tick 0 completed at tick 9000 (60 Hz) shows 2:30', () => {
    const { world, fake, complete } = game();
    while (world.tick < 9000) fake.frame(FRAME_MS);
    expect(world.tick).toBe(9000);
    complete();
    fake.frame(FRAME_MS);
    expect(document.querySelector('[data-testid="slice-complete-time"]')?.textContent).toBe(
      'Run time: 2:30',
    );
    expect(document.querySelector('[data-testid="slice-complete-class"]')?.textContent).toBe(
      'Class: Knight',
    );
  });

  it('shows the card once, and a fact already true when the game loads shows none', () => {
    const { world, fake, complete, ui } = game();
    complete();
    fake.frame(FRAME_MS);
    complete();
    world.facts.set('other.fact', true);
    fake.frame(FRAME_MS);
    expect(document.querySelectorAll('[data-screen="slice-complete"]')).toHaveLength(1);
    expect(ui.top?.id).toBe('slice-complete');

    const loaded = game();
    loaded.world.facts.prepareRestore({ [FACT]: true })();
    loaded.fake.frame(FRAME_MS);
    expect(loaded.card.shown).toBe(false);
  });

  it('mw-e24.21: Continue closes the card, hands input back and the card does not reopen', () => {
    const { ui, fake, card, bridge, sampled, complete } = game();
    complete();
    fake.frame(FRAME_MS);
    document.querySelector<HTMLElement>('[data-testid="slice-complete-continue"]')?.click();
    fake.frame(FRAME_MS);
    expect(ui.top).toBeUndefined();
    expect(document.querySelectorAll('[data-screen="slice-complete"]')).toHaveLength(0);
    sampled.mockClear();
    expect(bridge.sampleCommands(0)).toEqual(['move']);
    expect(card.shown).toBe(true);
  });

  it('the completion autosave lands and the card says it was saved; Return to title leaves', async () => {
    const { fake, scheduler, world, returnToTitle, complete } = game();
    complete();
    fake.frame(FRAME_MS);
    expect(saveLine()).toBe(SLICE_COMPLETE_TEXT.saving);
    await scheduler.update(world);
    expect(saveLine()).toBe(SLICE_COMPLETE_TEXT.saved);
    document.querySelector<HTMLElement>('[data-testid="slice-complete-return"]')?.click();
    expect(returnToTitle).toHaveBeenCalledOnce();
  });

  it('Return to title waits for a save in flight, then leaves', async () => {
    let finish: (value: unknown) => void = () => undefined;
    const { fake, scheduler, world, returnToTitle, complete } = game({
      overwrite: () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    });
    complete();
    fake.frame(FRAME_MS);
    const writing = scheduler.update(world);
    document.querySelector<HTMLElement>('[data-testid="slice-complete-return"]')?.click();
    expect(returnToTitle).not.toHaveBeenCalled();
    await new Promise((resolve) => setTimeout(resolve, 0)); // the write has started
    finish({ summary: {}, thumbnail: {} });
    await writing;
    expect(returnToTitle).toHaveBeenCalledOnce();
  });

  it('a completion autosave that landed before the first frame opens the card already saved', async () => {
    const { fake, scheduler, world, complete } = game({ blocked: "Can't save during combat" });
    complete();
    await scheduler.update(world);
    fake.frame(FRAME_MS);
    expect(saveLine()).toBe(SLICE_COMPLETE_TEXT.saved);
  });

  it('AC-4: a vetoed completion autosave says the run was not saved, until one lands', async () => {
    const { fake, scheduler, world, complete, unblock } = game({
      blocked: "Can't save during combat",
    });
    complete();
    fake.frame(FRAME_MS);
    expect(saveLine()).toBe("This run was not saved. Can't save during combat");
    unblock();
    await scheduler.update(world);
    expect(saveLine()).toBe(SLICE_COMPLETE_TEXT.saved);
  });

  it('AC-4: a completion autosave that failed twice says the run was not saved', async () => {
    const warn = vi.fn();
    const { fake, scheduler, world, complete } = game({
      overwrite: () => Promise.reject(new Error('quota')),
    });
    complete();
    fake.frame(FRAME_MS);
    await scheduler.update(world);
    expect(saveLine()).toBe(SLICE_COMPLETE_TEXT.saving); // retrying
    for (let i = 0; i < 60; i++) fake.frame(FRAME_MS);
    await scheduler.update(world);
    expect(saveLine()).toBe(SLICE_COMPLETE_TEXT.notSaved);
    expect(warn).not.toHaveBeenCalled();
  });

  it('ignores autosaves from other sources and stops listening on stop()', () => {
    const { card, world, fake, complete } = game();
    card.autosave({
      type: 'saved',
      trigger: { kind: 'checkpoint', source: 'cp-1' },
    } as never);
    card.stop();
    complete();
    fake.frame(FRAME_MS);
    expect(card.shown).toBe(false);
    expect(world.facts.get(FACT)).toBe(true);
  });
});
