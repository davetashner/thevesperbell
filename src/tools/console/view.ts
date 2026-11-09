// The debug console overlay (mw-e33.1): a log and a one-line input, opened as a screen on the UI
// layer's stack (mw-e00.23). Backtick opens and closes it. The screen captures input and leaves the
// sim running: the UI bridge withholds the player's action frames and releases pointer lock while it
// is open, and key events typed into the console stop at its input, so neither the player, the fly
// camera nor the UI's own navigation sees them. Enter runs the line, Tab completes, Up/Down walk the
// history, Esc (or backtick, or B on a pad through the UI stack) closes it.
//
// Styled with the kit's panel and colour tokens; only the layout (a strip along the bottom, a
// monospace face) is the console's own.

import type { ScreenOptions } from '@ui/index';
import type { ConsoleHistory } from './history';
import type { Completion, ConsoleResult } from './registry';

/** The key that toggles the console. */
export const CONSOLE_TOGGLE_KEY = 'Backquote';

/** The console's screen id on the UI stack (`data-screen`). */
export const CONSOLE_SCREEN_ID = 'debug-console';

/** Log lines kept on screen. */
export const LOG_LIMIT = 200;

/** A marker string only this module contains (the e2e checks the main bundle lacks it). */
export const CONSOLE_MODULE_MARKER = 'vesper-debug-console-module';

type Listener = (event: Event) => void;

/** The part of the UI screen stack the console uses (UiRoot). */
export interface ConsoleScreens {
  push(options: ScreenOptions): { close(): void };
}

/** Where the console lives. */
export interface ConsoleDom {
  readonly document: Pick<Document, 'createElement'>;
  /** Receives global key events (the window): the toggle key. */
  readonly keys: {
    addEventListener(type: string, listener: Listener): void;
    removeEventListener(type: string, listener: Listener): void;
  };
  readonly screens: ConsoleScreens;
}

export interface ConsoleViewOptions {
  readonly dom: ConsoleDom;
  readonly commands: {
    execute(line: string): ConsoleResult;
    complete(line: string): Completion;
  };
  readonly history: ConsoleHistory;
  /** Called after the console opens or closes. */
  readonly onToggle?: (open: boolean) => void;
}

export interface ConsoleView {
  readonly isOpen: boolean;
  open(): void;
  close(): void;
  /** Runs a line as if typed and submitted. */
  submit(line: string): ConsoleResult;
  /** Closes the console and removes its listeners. */
  detach(): void;
}

const PANEL_STYLE = [
  'align-self:flex-end',
  'width:100%',
  'max-width:none',
  'max-height:40vh',
  'display:flex',
  'flex-direction:column',
  'gap:var(--ui-space-2)',
  'padding:var(--ui-space-2) var(--ui-space-3)',
  'border-radius:0',
  'font-family:ui-monospace,SFMono-Regular,Menlo,monospace',
].join(';');
const LOG_STYLE = 'overflow-y:auto;white-space:pre-wrap;flex:1';
const INPUT_STYLE = [
  'font:inherit',
  'color:var(--ui-color-text)',
  'background:var(--ui-color-panel-raised)',
  'border:1px solid var(--ui-color-border)',
  'padding:var(--ui-space-1) var(--ui-space-2)',
].join(';');
const TONES = {
  input: 'var(--ui-color-text-muted)',
  ok: 'var(--ui-color-text)',
  error: 'var(--ui-color-warning)',
  hint: 'var(--ui-color-accent)',
} as const;

interface KeyEventLike {
  readonly code: string;
  readonly repeat: boolean;
  preventDefault(): void;
  stopPropagation(): void;
}

/** Builds the console (closed); backtick on `dom.keys` pushes it onto `dom.screens`. */
export function mountConsoleView(options: ConsoleViewOptions): ConsoleView {
  const { dom, commands, history } = options;
  const { document } = dom;
  const panel = document.createElement('div');
  panel.className = 'vb-panel';
  panel.dataset['testid'] = 'debug-console';
  panel.dataset['module'] = CONSOLE_MODULE_MARKER;
  panel.setAttribute('style', PANEL_STYLE);
  const log = document.createElement('div');
  log.setAttribute('role', 'log');
  log.dataset['testid'] = 'debug-console-log';
  log.setAttribute('style', LOG_STYLE);
  const input = document.createElement('input');
  input.dataset['testid'] = 'debug-console-input';
  input.dataset['autofocus'] = '';
  input.setAttribute('aria-label', 'Console command');
  input.setAttribute('autocomplete', 'off');
  input.setAttribute('spellcheck', 'false');
  input.setAttribute('style', INPUT_STYLE);
  panel.append(log, input);

  const shown: HTMLElement[] = [];
  const print = (lines: readonly string[], tone: keyof typeof TONES): void => {
    for (const text of lines) {
      const line = document.createElement('div');
      line.textContent = text;
      line.setAttribute('style', `color:${TONES[tone]}`);
      log.append(line);
      shown.push(line);
    }
    for (const old of shown.splice(0, shown.length - LOG_LIMIT)) old.remove();
    log.scrollTop = log.scrollHeight;
  };

  let screen: { close(): void } | undefined;
  const open = (): void => {
    if (screen !== undefined) return;
    screen = dom.screens.push({
      id: CONSOLE_SCREEN_ID,
      label: 'Debug console',
      content: panel,
      capturesInput: true,
      pausesSim: false,
      // However it closes (Esc here, B on a pad, the stack cleared), the console knows.
      onClose: () => {
        screen = undefined;
        options.onToggle?.(false);
      },
    });
    options.onToggle?.(true);
  };
  const close = (): void => {
    screen?.close();
  };

  const submit = (line: string): ConsoleResult => {
    history.add(line);
    print([`> ${line}`], 'input');
    const result = commands.execute(line);
    print(result.lines, result.ok ? 'ok' : 'error');
    void result.later?.then((done) => {
      print(done.lines, done.ok ? 'ok' : 'error');
    });
    return result;
  };

  const onInputKey = (event: Event): void => {
    const key = event as unknown as KeyEventLike;
    key.stopPropagation(); // the game and the UI's navigation never see keys typed here
    if (event.type !== 'keydown') return;
    switch (key.code) {
      case CONSOLE_TOGGLE_KEY:
      case 'Escape':
        key.preventDefault();
        close();
        return;
      case 'Enter':
        key.preventDefault();
        submit(input.value);
        input.value = '';
        return;
      case 'Tab': {
        key.preventDefault();
        const completion = commands.complete(input.value);
        input.value = completion.line;
        if (completion.options.length > 0) print([completion.options.join('  ')], 'hint');
        return;
      }
      case 'ArrowUp':
        key.preventDefault();
        input.value = history.previous() ?? input.value;
        return;
      case 'ArrowDown':
        key.preventDefault();
        input.value = history.next();
        return;
    }
  };

  const onWindowKey = (event: Event): void => {
    const key = event as unknown as KeyEventLike;
    if (key.code !== CONSOLE_TOGGLE_KEY) return;
    key.preventDefault();
    if (key.repeat) return;
    if (screen === undefined) open();
    else close();
  };

  const inputEvents = ['keydown', 'keyup', 'keypress'] as const;
  for (const type of inputEvents) input.addEventListener(type, onInputKey);
  dom.keys.addEventListener('keydown', onWindowKey);

  return {
    get isOpen() {
      return screen !== undefined;
    },
    open,
    close,
    submit,
    detach: () => {
      close();
      for (const type of inputEvents) input.removeEventListener(type, onInputKey);
      dom.keys.removeEventListener('keydown', onWindowKey);
    },
  };
}
