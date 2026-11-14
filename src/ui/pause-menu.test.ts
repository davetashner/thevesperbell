// @vitest-environment happy-dom
// The pause menu (mw-e01.3): its options, where focus starts, Save disabled with its reason, and that
// every option is reachable from a gamepad's d-pad. The game side (opening, Save's veto, quitting) is
// src/game/ui/pause.test.ts; AC-3 runs end to end in e2e/pause.spec.ts.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { openPauseMenu, PAUSE_MENU_TEXT, PAUSE_SCREEN, type PauseAction } from '@ui/pause-menu';
import { UiRoot } from '@ui/screens';
import { place, rectFromData } from '@ui/testing/layout';

let ui: UiRoot;

beforeEach(() => {
  document.body.innerHTML = '';
  ui = new UiRoot(document.body, { unstyled: true, focus: { rectOf: rectFromData } });
});

const active = (): HTMLElement => document.activeElement as HTMLElement;

const description = (el: Element): string =>
  (el.getAttribute('aria-describedby') ?? '')
    .split(' ')
    .map((id) => document.getElementById(id)?.textContent ?? '')
    .join(' ')
    .trim();

/** Lays the options out as the stylesheet does: one column, top to bottom. */
function layOut(): void {
  [...document.querySelectorAll<HTMLElement>('[data-action]')].forEach((el, i) => {
    place(el, 0, 100 + i * 60, 300, 50);
  });
}

/** A standard-mapping pad whose buttons the test presses. */
function virtualPad() {
  const buttons = Array.from({ length: 17 }, () => ({ pressed: false }));
  const pad = { connected: true, mapping: 'standard', buttons, axes: [0, 0, 0, 0] };
  let time = 0;
  const input = ui.attachInput({
    window: new EventTarget(),
    navigator: { getGamepads: () => [pad] },
    now: () => time,
  });
  return {
    press(index: number): void {
      buttons[index] = { pressed: true };
      input.poll();
      buttons[index] = { pressed: false };
      time += 16;
      input.poll();
    },
  };
}

describe('pause menu', () => {
  it('offers Resume, Settings, Save, Load and Quit to Title, pausing the sim with Resume focused', () => {
    const menu = openPauseMenu(ui, { onChoose: vi.fn() });
    expect(menu.screen.id).toBe(PAUSE_SCREEN);
    expect(ui.pausesSim && ui.capturesInput).toBe(true);
    expect(menu.screen.element.getAttribute('aria-label')).toBe(PAUSE_MENU_TEXT.title);
    expect([...document.querySelectorAll('button')].map((b) => b.textContent)).toEqual([
      'Resume',
      'Journal',
      'Settings',
      'Save',
      'Load',
      'Quit to Title',
    ]);
    expect(active()).toBe(menu.buttons.resume);
    expect(menu.buttons.save.hasAttribute('aria-disabled')).toBe(false);
    expect(document.querySelector('[data-testid="pause-save-reason"]')).toBeNull();
  });

  it('reports each option; Resume closes the menu first', () => {
    const chosen: PauseAction[] = [];
    const onClose = vi.fn();
    const menu = openPauseMenu(ui, { onChoose: (action) => chosen.push(action), onClose });
    for (const action of ['journal', 'settings', 'save', 'load', 'quit'] as const)
      menu.buttons[action].click();
    expect(chosen).toEqual(['journal', 'settings', 'save', 'load', 'quit']);
    expect(ui.top).toBe(menu.screen);
    menu.buttons.resume.click();
    expect(chosen.at(-1)).toBe('resume');
    expect(ui.top).toBeUndefined();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('AC-2: Save is disabled with its reason, still focusable, and pressing it does nothing', () => {
    const onChoose = vi.fn();
    const menu = openPauseMenu(ui, { saveBlocked: "Can't save during combat", onChoose });
    const save = menu.buttons.save;
    expect(save.getAttribute('aria-disabled')).toBe('true');
    expect(save.disabled).toBe(false);
    expect(save.dataset['reason']).toBe("Can't save during combat");
    expect(description(save)).toBe("Can't save during combat");
    expect(document.querySelector('[data-testid="pause-save-reason"]')?.textContent).toBe(
      "Can't save during combat",
    );
    save.click();
    expect(onChoose).not.toHaveBeenCalled();
    // Resume still works.
    menu.buttons.resume.click();
    expect(onChoose).toHaveBeenCalledWith('resume');
    expect(ui.top).toBeUndefined();
  });

  it('AC-4: opened with a gamepad, the d-pad reaches every option (Save too, when disabled)', () => {
    const menu = openPauseMenu(ui, { saveBlocked: "Can't save during combat", onChoose: vi.fn() });
    layOut();
    const pad = virtualPad();
    const visited = [active().dataset['action']];
    for (let i = 0; i < 5; i++) {
      pad.press(13); // d-pad down
      visited.push(active().dataset['action']);
    }
    expect(visited).toEqual(['resume', 'journal', 'settings', 'save', 'load', 'quit']);
    // The ring shows: focus came from the pad, so the root is in navigation modality.
    expect(ui.element.dataset['modality']).toBe('nav');
    pad.press(13); // nothing below Quit: focus stays
    expect(active()).toBe(menu.buttons.quit);
    for (let i = 0; i < 5; i++) pad.press(12); // d-pad up, back to the top
    expect(active()).toBe(menu.buttons.resume);
    pad.press(1); // B resumes
    expect(ui.top).toBeUndefined();
  });
});
