// @vitest-environment happy-dom
// The pause controller (mw-e01.3): which presses open and close the menu, that screens stack (it never
// opens over another screen, and only resumes when it is on top), the stale-press guard, the options'
// hand-offs, and Quit to Title's confirmation. The running-game ACs are pause.integration.test.ts.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PAUSE_QUIT_TEXT, PauseController, SaveProgress } from '@game/ui/index';
import { UiRoot } from '@ui/index';

let ui: UiRoot;

beforeEach(() => {
  document.body.innerHTML = '';
  ui = new UiRoot(document.body, { unstyled: true });
});

function controller(overrides: { canPause?: () => boolean; unsaved?: () => boolean } = {}) {
  const calls = {
    journal: vi.fn(),
    settings: vi.fn(),
    save: vi.fn(),
    load: vi.fn(),
    quit: vi.fn(),
    published: [] as string[],
  };
  const pause = new PauseController({
    ui,
    canPause: overrides.canPause ?? (() => true),
    saveBlocked: () => null,
    unsavedProgress: overrides.unsaved ?? (() => false),
    pauseKeys: () => ['Escape', 'KeyP'],
    openJournal: calls.journal,
    openSettings: calls.settings,
    openSave: calls.save,
    openLoad: calls.load,
    quitToTitle: calls.quit,
    publish: (state) => calls.published.push(state),
  });
  return { pause, calls };
}

const key = (code: string, more: { repeat?: boolean; defaultPrevented?: boolean } = {}) => ({
  code,
  repeat: more.repeat ?? false,
  defaultPrevented: more.defaultPrevented ?? false,
});

const confirmButton = (label: string): HTMLButtonElement => {
  const found = [...document.querySelectorAll<HTMLButtonElement>('[data-screen="confirm"] button')];
  const button = found.find((b) => b.textContent === label);
  if (button === undefined) throw new Error(`no ${label} button`);
  return button;
};

describe('PauseController', () => {
  it('a Pause key opens the menu and the same key resumes; publishes open and closed', () => {
    const { pause, calls } = controller();
    expect(calls.published).toEqual(['closed']);
    expect(pause.keydown(key('KeyP'))).toBe(true);
    expect(pause.isOpen).toBe(true);
    expect(ui.top?.id).toBe('pause');
    expect(pause.keydown(key('KeyP'))).toBe(true);
    expect(pause.isOpen).toBe(false);
    expect(calls.published).toEqual(['closed', 'open', 'closed']);
  });

  it('ignores repeats, other keys and keys the UI already used (Esc closing another screen)', () => {
    const { pause } = controller();
    expect(pause.keydown(key('Escape', { repeat: true }))).toBe(false);
    expect(pause.keydown(key('KeyW'))).toBe(false);
    expect(pause.keydown(key('Escape', { defaultPrevented: true }))).toBe(false);
    expect(pause.isOpen).toBe(false);
  });

  it('never opens over another screen, or when the game cannot pause', () => {
    let can = false;
    const { pause } = controller({ canPause: () => can });
    expect(pause.open()).toBe(false);
    can = true;
    const inventory = ui.push({
      id: 'inventory',
      label: 'Inventory',
      content: document.createElement('div'),
    });
    expect(pause.keydown(key('Escape'))).toBe(false);
    pause.pausePressed();
    pause.pointerUnlocked();
    expect(pause.isOpen).toBe(false);
    inventory.close();
    pause.pointerUnlocked();
    expect(pause.isOpen).toBe(true);
    expect(pause.open()).toBe(false); // already open
  });

  it('a screen opened over it takes the Pause key; the menu resumes only from the top', () => {
    const { pause } = controller();
    pause.pausePressed();
    const options = ui.push({
      id: 'options',
      label: 'Options',
      content: document.createElement('div'),
    });
    expect(pause.keydown(key('KeyP'))).toBe(false);
    pause.drained(true);
    pause.drained(true);
    expect(pause.isOpen).toBe(true);
    options.close();
    pause.drained(true);
    expect(pause.isOpen).toBe(false);
  });

  it('drops a Pause press recorded before it opened: the first drained frame never resumes', () => {
    const { pause } = controller();
    pause.drained(true); // closed: nothing to do
    pause.pausePressed();
    pause.drained(true); // the press that opened it, drained after the fact
    expect(pause.isOpen).toBe(true);
    pause.drained(false);
    pause.drained(true); // Menu pressed again on the pad
    expect(pause.isOpen).toBe(false);
  });

  it('hands Journal, Settings, Save and Load to the game; Resume just closes', () => {
    const { pause, calls } = controller();
    pause.open();
    const buttons = pause.menu?.buttons;
    buttons?.journal.click();
    buttons?.settings.click();
    buttons?.save.click();
    buttons?.load.click();
    expect(
      [calls.journal, calls.settings, calls.save, calls.load].map((f) => f.mock.calls.length),
    ).toEqual([1, 1, 1, 1]);
    buttons?.resume.click();
    expect(pause.isOpen).toBe(false);
    pause.close(); // closed already: no-op
  });

  it('Quit to Title with nothing unsaved leaves at once', async () => {
    const { pause, calls } = controller();
    pause.open();
    await pause.quit();
    expect(calls.quit).toHaveBeenCalledOnce();
    expect(document.querySelector('[data-screen="confirm"]')).toBeNull();
  });

  it('Quit to Title with unsaved progress asks first: Cancel stays, confirm leaves', async () => {
    const { pause, calls } = controller({ unsaved: () => true });
    pause.open();
    pause.menu?.buttons.quit.click();
    const dialog = document.querySelector('[data-screen="confirm"]');
    expect(dialog?.getAttribute('aria-label')).toBe(PAUSE_QUIT_TEXT.title);
    expect(dialog?.textContent).toContain(PAUSE_QUIT_TEXT.body);
    expect(document.activeElement?.textContent).toBe('Cancel');
    expect(ui.pausesSim).toBe(true);
    confirmButton('Cancel').click();
    await Promise.resolve();
    expect(calls.quit).not.toHaveBeenCalled();
    expect(ui.top?.id).toBe('pause');

    const quitting = pause.quit();
    confirmButton(PAUSE_QUIT_TEXT.confirm).click();
    await quitting;
    expect(calls.quit).toHaveBeenCalledOnce();
    expect(pause.isOpen).toBe(true); // the sim stays paused while the page leaves
  });
});

describe('SaveProgress', () => {
  it('is unsaved once the tick moves on from the last save or load', () => {
    let tick = 0;
    const progress = new SaveProgress(() => tick);
    expect(progress.unsaved).toBe(false);
    tick = 5;
    expect(progress.unsaved).toBe(true);
    progress.mark();
    expect(progress.unsaved).toBe(false);
    tick = 3; // a load can move the tick back
    expect(progress.unsaved).toBe(true);
  });
});
