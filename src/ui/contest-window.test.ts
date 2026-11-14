// @vitest-environment happy-dom
// The contest entry window and the in-play panel (mw-opf6 AC-4).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CONTEST_SCREEN,
  ContestHud,
  oddsText,
  openContestWindow,
  type ContestWindowModel,
} from '@ui/contest-window';
import { UiRoot } from '@ui/screens';
import { rectFromData } from '@ui/testing/layout';

function el(selector: string): HTMLElement {
  const found = document.querySelector<HTMLElement>(selector);
  if (found === null) throw new Error(`no element ${selector}`);
  return found;
}

let ui: UiRoot;

beforeEach(() => {
  document.body.innerHTML = '';
  ui = new UiRoot(document.body, { unstyled: true, focus: { rectOf: rectFromData } });
});

const MODEL: ContestWindowModel = {
  name: 'Arm-wrestling at the Drowned Gull',
  rules: 'Against Big Oona. First to 5.',
  fee: 2,
  crowns: 30,
  bet: { book: 'Nell', numerator: 2, denominator: 1, minStake: 1, maxStake: 3 },
  offer: { book: 'Nell', payout: 15 },
};

const click = (selector: string): void => {
  el(selector).click();
};
const pressed = (choice: string): string | null =>
  document.querySelector(`[data-choice=${choice}]`)?.getAttribute('aria-pressed') ?? null;

describe('the contest entry window', () => {
  it('AC-4: shows the rules, the fee against the purse, the odds and the offer; it pauses the sim', () => {
    openContestWindow(ui, { model: MODEL, onStart: () => undefined });
    expect(ui.top?.id).toBe(CONTEST_SCREEN);
    expect(ui.pausesSim).toBe(true);
    const text = document.querySelector('[data-testid=contest-window]')?.textContent ?? '';
    expect(text).toContain('Arm-wrestling at the Drowned Gull');
    expect(text).toContain('Entry fee: 2. Your crowns: 30.');
    expect(text).toContain('Nell pays 2:1 on you');
    expect(text).toContain('Nell offers 15 crowns to throw the match');
    expect(oddsText({ numerator: 3, denominator: 2 })).toBe('3:2');
  });

  it('AC-4: no bet is the default; picking a bet or the offer marks it and reports it on Enter', () => {
    const onStart = vi.fn<(choice: unknown) => string | undefined>(() => undefined);
    const window = openContestWindow(ui, { model: MODEL, onStart });
    expect(window.choice()).toEqual({ kind: 'none' });
    expect(pressed('none')).toBe('true');
    click('[data-choice=throw]');
    expect(pressed('throw')).toBe('true');
    expect(pressed('none')).toBe('false');
    expect(window.choice()).toEqual({ kind: 'throw' });
    click('[data-choice=onPlayer]');
    expect(window.choice()).toEqual({ kind: 'onPlayer', stake: 1 });
    click('[data-action=enter]');
    expect(onStart).toHaveBeenCalledWith({ kind: 'onPlayer', stake: 1 });
    expect(ui.top).toBeUndefined();
  });

  it('AC-4: the stake steps within the book limits and selects the bet', () => {
    const window = openContestWindow(ui, { model: MODEL, onStart: () => undefined });
    click('[data-step=fewer]');
    expect(document.querySelector('[data-testid=contest-stake]')?.textContent).toBe('Stake: 1');
    click('[data-step=more]');
    click('[data-step=more]');
    click('[data-step=more]');
    expect(window.choice()).toEqual({ kind: 'onPlayer', stake: 3 });
    expect(document.querySelector('[data-step=more]')?.getAttribute('aria-label')).toBe(
      'Raise the stake',
    );
  });

  it('AC-4: a refusal stays on the window and says why; choosing again clears it', () => {
    const closed = vi.fn();
    openContestWindow(ui, { model: MODEL, onStart: () => 'No.', onClose: closed });
    click('[data-action=enter]');
    expect(ui.top?.id).toBe(CONTEST_SCREEN);
    expect(document.querySelector('[data-testid=contest-status]')?.textContent).toBe('No.');
    click('[data-choice=none]');
    expect(document.querySelector('[data-testid=contest-status]')?.textContent).toBe('');
    click('[data-action=leave]');
    expect(ui.top).toBeUndefined();
    expect(closed).toHaveBeenCalled();
  });

  it('a contest without a book offers no bets, and closing is idempotent', () => {
    const plain: ContestWindowModel = {
      name: MODEL.name,
      rules: MODEL.rules,
      fee: MODEL.fee,
      crowns: MODEL.crowns,
    };
    const window = openContestWindow(ui, { model: plain, onStart: () => undefined });
    expect(document.querySelector('[data-choice=onPlayer]')).toBeNull();
    expect(document.querySelector('[data-choice=throw]')).toBeNull();
    window.close();
    expect(ui.top).toBeUndefined();
  });
});

describe('the contest panel', () => {
  it('AC-4: shows standings (with the target), the meter, the keys and the message; hides again', () => {
    const hud = new ContestHud();
    document.body.append(hud.element);
    expect(hud.visible).toBe(false);
    hud.show({
      title: 'Arm-wrestling',
      rows: [
        { name: 'You', score: 2, you: true },
        { name: 'Big Oona', score: 3, you: false },
      ],
      target: 5,
      meter: { label: 'Grip', value: 0.5 },
      hints: ['F: push', 'N: walk away'],
      message: 'You gain ground.',
    });
    expect(hud.visible).toBe(true);
    const rows = [...document.querySelectorAll('.vb-contest-hud-row')].map((r) => r.textContent);
    expect(rows).toEqual(['You: 2 of 5', 'Big Oona: 3 of 5']);
    expect((el('[data-testid=contest-meter]') as HTMLProgressElement).value).toBe(0.5);
    expect(document.querySelector('[data-testid=contest-hints]')?.textContent).toBe(
      'F: push   N: walk away',
    );
    hud.show({
      title: 'Dice',
      rows: [{ name: 'You', score: 1, you: true }],
      hints: [],
      message: '',
    });
    expect(document.querySelector('.vb-contest-hud-row')?.textContent).toBe('You: 1');
    expect(el('[data-testid=contest-meter]').hidden).toBe(true);
    hud.hide();
    expect(hud.visible).toBe(false);
  });
});
