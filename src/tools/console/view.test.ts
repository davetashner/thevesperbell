// @vitest-environment happy-dom
import { UiRoot } from '@ui/index';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { ConsoleHistory } from './history';
import { CommandRegistry } from './registry';
import {
  CONSOLE_MODULE_MARKER,
  CONSOLE_SCREEN_ID,
  CONSOLE_TOGGLE_KEY,
  LOG_LIMIT,
  mountConsoleView,
} from './view';

function setup() {
  document.body.innerHTML = '';
  const container = document.createElement('main');
  document.body.append(container);
  const ui = new UiRoot(container, { unstyled: true });
  const uiInput = ui.attachInput({ window, now: () => 0 });
  const registry = new CommandRegistry({});
  registry.registerCommand({
    name: 'spawn',
    summary: '',
    usage: '<id>',
    args: z.tuple([z.string()]),
    run: ([id]) => `spawned ${id}`,
  });
  registry.registerCommand({
    name: 'seed',
    summary: '',
    usage: '',
    args: z.tuple([]),
    run: () => 'seed 1',
  });
  const onToggle = vi.fn();
  const view = mountConsoleView({
    dom: { document, keys: window, screens: ui },
    commands: registry,
    history: new ConsoleHistory(),
    onToggle,
  });
  const panel = () => document.querySelector<HTMLElement>('[data-testid="debug-console"]');
  const input = () =>
    document.querySelector<HTMLInputElement>('[data-testid="debug-console-input"]') ??
    document.createElement('input');
  const log = () =>
    [...document.querySelectorAll('[data-testid="debug-console-log"] > div')].map(
      (line) => line.textContent,
    );
  /** A key pressed where the focus is (the console input while it is open), or on the window. */
  const press = (code: string, target: EventTarget = input(), repeat = false): KeyboardEvent => {
    const down = new KeyboardEvent('keydown', { code, repeat, bubbles: true, cancelable: true });
    target.dispatchEvent(down);
    target.dispatchEvent(new KeyboardEvent('keyup', { code, bubbles: true, cancelable: true }));
    return down;
  };
  return { ui, uiInput, view, onToggle, panel, input, log, press };
}

describe('console view on the UI screen stack', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('is not on screen until opened', () => {
    const s = setup();
    expect(s.panel()).toBeNull();
    expect(s.view.isOpen).toBe(false);
    expect(s.ui.capturesInput).toBe(false);
  });

  it('AC-4: backtick pushes a capturing, non-pausing screen with the input focused; typed keys reach neither the game nor the UI; Esc and backtick close it', () => {
    const s = setup();
    const gameKeys: string[] = [];
    window.addEventListener('keydown', (e) => gameKeys.push(e.code));
    const open = s.press(CONSOLE_TOGGLE_KEY, window);
    expect(open.defaultPrevented).toBe(true);
    expect(s.view.isOpen).toBe(true);
    expect(s.ui.top?.id).toBe(CONSOLE_SCREEN_ID);
    expect(s.ui.capturesInput).toBe(true);
    expect(s.ui.pausesSim).toBe(false);
    expect(s.panel()?.dataset['module']).toBe(CONSOLE_MODULE_MARKER);
    expect(document.activeElement).toBe(s.input());
    expect(s.onToggle).toHaveBeenLastCalledWith(true);

    gameKeys.length = 0;
    for (const code of ['KeyW', 'KeyA', 'Space', 'ArrowLeft', 'KeyD']) s.press(code);
    s.input().dispatchEvent(new KeyboardEvent('keypress', { code: 'KeyW', bubbles: true }));
    expect(gameKeys).toEqual([]);
    expect(document.activeElement).toBe(s.input()); // arrows did not move UI focus

    expect(s.press('Escape').defaultPrevented).toBe(true);
    expect(s.view.isOpen).toBe(false);
    expect(s.panel()).toBeNull();
    expect(s.ui.capturesInput).toBe(false);
    expect(s.onToggle).toHaveBeenLastCalledWith(false);

    s.press(CONSOLE_TOGGLE_KEY, window);
    s.press(CONSOLE_TOGGLE_KEY);
    expect(s.view.isOpen).toBe(false);
    expect(gameKeys).toEqual([CONSOLE_TOGGLE_KEY]); // only the opening press, on the window
  });

  it('backtick on the window also closes it, and closing through the UI stack is noticed', () => {
    const s = setup();
    s.view.open();
    s.view.open(); // already open: one screen only
    expect(s.ui.screens).toHaveLength(1);
    s.press(CONSOLE_TOGGLE_KEY, window);
    expect(s.view.isOpen).toBe(false);
    s.view.open();
    s.ui.clear();
    expect(s.view.isOpen).toBe(false);
    expect(s.onToggle).toHaveBeenLastCalledWith(false);
  });

  it('ignores auto-repeat of the toggle key and other window keys', () => {
    const s = setup();
    s.press(CONSOLE_TOGGLE_KEY, window, true);
    s.press('KeyW', window);
    expect(s.view.isOpen).toBe(false);
    s.view.close();
    expect(s.onToggle).not.toHaveBeenCalled();
  });

  it('prints what a slow command reports once it finishes (mw-e27.6)', async () => {
    const s = setup();
    const bad = Promise.resolve({ ok: false, lines: ['too late'] });
    const good = Promise.resolve({ ok: true, lines: ['all done'] });
    const view = mountConsoleView({
      dom: { document, keys: window, screens: s.ui },
      commands: {
        execute: (line) => ({ ok: true, lines: ['working'], later: line === 'bad' ? bad : good }),
        complete: (line) => ({ line, options: [] }),
      },
      history: new ConsoleHistory(),
    });
    view.open();
    view.submit('bad');
    view.submit('good');
    await Promise.all([bad, good]);
    expect(s.log()).toEqual(['> bad', 'working', '> good', 'working', 'too late', 'all done']);
  });

  it('Enter runs the line, echoes it and prints the result; errors in the warning colour', () => {
    const s = setup();
    s.view.open();
    s.input().value = 'spawn crate';
    s.press('Enter');
    expect(s.input().value).toBe('');
    s.input().value = 'nope';
    s.press('Enter');
    expect(s.log()).toEqual([
      '> spawn crate',
      'spawned crate',
      '> nope',
      'unknown command "nope"; did you mean: seed, spawn?',
      'type help for the list of commands',
    ]);
    const lines = document.querySelectorAll('[data-testid="debug-console-log"] > div');
    expect(lines[1]?.getAttribute('style')).toContain('--ui-color-text)');
    expect(lines[3]?.getAttribute('style')).toContain('--ui-color-warning');
  });

  it('AC-6: sp + Tab completes to spawn; an ambiguous prefix lists the options', () => {
    const s = setup();
    s.view.open();
    s.input().value = 'sp';
    expect(s.press('Tab').defaultPrevented).toBe(true);
    expect(s.input().value).toBe('spawn ');
    expect(document.activeElement).toBe(s.input());
    s.input().value = 's';
    s.press('Tab');
    expect(s.input().value).toBe('s');
    expect(s.log()).toEqual(['seed  spawn']);
  });

  it('Up and Down walk the history', () => {
    const s = setup();
    s.view.submit('seed');
    s.view.submit('spawn crate');
    s.view.open();
    s.input().value = 'draft';
    s.press('ArrowUp');
    expect(s.input().value).toBe('spawn crate');
    s.press('ArrowUp');
    expect(s.input().value).toBe('seed');
    s.press('ArrowDown');
    expect(s.input().value).toBe('spawn crate');
    s.press('ArrowDown');
    expect(s.input().value).toBe('');
  });

  it('Up with no history keeps what is typed', () => {
    const s = setup();
    s.view.open();
    s.input().value = 'kept';
    s.press('ArrowUp');
    expect(s.input().value).toBe('kept');
  });

  it(`keeps at most ${String(LOG_LIMIT)} log lines`, () => {
    const s = setup();
    for (let i = 0; i < LOG_LIMIT; i++) s.view.submit('seed');
    s.view.open();
    expect(s.log()).toHaveLength(LOG_LIMIT);
    expect(s.log().at(-1)).toBe('seed 1');
  });

  it('detach closes it and removes its listeners', () => {
    const s = setup();
    s.view.open();
    const input = s.input();
    s.view.detach();
    expect(s.panel()).toBeNull();
    s.press(CONSOLE_TOGGLE_KEY, window);
    expect(s.view.isOpen).toBe(false);
    input.value = 'seed';
    s.press('Enter', input);
    expect(input.value).toBe('seed');
  });
});
