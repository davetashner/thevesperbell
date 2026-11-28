// @vitest-environment happy-dom
// The rest window (mw-e27.13): durations, other systems' actions, disabled reasons, status line,
// closing and pausing.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { openRestWindow, REST_SCREEN, type RestWindowModel } from '@ui/rest-window';
import { UiRoot } from '@ui/screens';
import { find, rectFromData } from '@ui/testing/layout';

let ui: UiRoot;

beforeEach(() => {
  document.body.innerHTML = '';
  ui = new UiRoot(document.body, { unstyled: true, focus: { rectOf: rectFromData } });
});

const MODEL: RestWindowModel = {
  title: 'Campfire',
  durations: [
    { id: 'dawn', label: 'Until dawn' },
    { id: 'hours-2', label: '2 hours' },
  ],
  actions: [{ id: 'assemble', label: 'Assemble arrows', reason: 'No bow' }],
};

function open(model: RestWindowModel = MODEL) {
  const onRest = vi.fn<(id: string) => void>();
  const onAction = vi.fn<(id: string) => void>();
  const onClose = vi.fn<() => void>();
  const window = openRestWindow(ui, { model, onRest, onAction, onClose });
  return { window, onRest, onAction, onClose };
}

describe('rest window (mw-e27.13)', () => {
  it('AC-4: lists the durations and the actions, pauses the sim, and disables an action with its reason', () => {
    open();
    expect(ui.top?.id).toBe(REST_SCREEN);
    expect(ui.pausesSim).toBe(true);
    expect(find('h1').textContent).toBe('Campfire');
    expect(
      [...document.querySelectorAll('[data-testid="rest-durations"] button')].map(
        (b) => b.textContent,
      ),
    ).toEqual(['Until dawn', '2 hours']);
    const action = find('[data-action="action:assemble"]') as HTMLButtonElement;
    expect(action.disabled).toBe(true);
    expect(action.title).toBe('No bow');
    expect(find('[data-testid="rest-actions"]').hidden).toBe(false);
  });

  it('choosing a duration or an action reports it; Leave and Esc close the window', () => {
    const t = open({ ...MODEL, actions: [{ id: 'assemble', label: 'Assemble arrows' }] });
    (find('[data-action="rest:hours-2"]') as HTMLButtonElement).click();
    expect(t.onRest).toHaveBeenCalledWith('hours-2');
    (find('[data-action="action:assemble"]') as HTMLButtonElement).click();
    expect(t.onAction).toHaveBeenCalledWith('assemble');
    (find('[data-action="leave"]') as HTMLButtonElement).click();
    expect(t.onClose).toHaveBeenCalledTimes(1);
    expect(ui.top).toBeUndefined();
    const again = open();
    ui.intent('back', 'keyboard');
    expect(again.onClose).toHaveBeenCalledTimes(1);
  });

  it('the first duration that can be chosen is focused first, and a menu with no actions hides them', () => {
    open({
      title: 'Shrine',
      durations: [
        { id: 'hours-1', label: '1 hour', reason: 'Not now' },
        { id: 'dawn', label: 'Until dawn' },
      ],
      actions: [],
    });
    expect(find('[data-action="rest:hours-1"]').dataset['autofocus']).toBeUndefined();
    expect(find('[data-action="rest:dawn"]').dataset['autofocus']).toBe('');
    expect(find('[data-testid="rest-actions"]').hidden).toBe(true);
  });

  it('say shows the status line and render redraws the title and lists; close closes', () => {
    const t = open();
    t.window.say('You wake at 06:00.');
    expect(find('[data-testid="rest-status"]').textContent).toBe('You wake at 06:00.');
    t.window.render({
      title: 'Inn bed',
      durations: [{ id: 'dawn', label: 'Until dawn' }],
      actions: [],
    });
    expect(find('h1').textContent).toBe('Inn bed');
    expect(document.querySelectorAll('[data-testid="rest-durations"] button')).toHaveLength(1);
    t.window.close();
    expect(t.onClose).toHaveBeenCalledTimes(1);
  });

  it('a window with no close callback closes quietly', () => {
    const window = openRestWindow(ui, { model: MODEL, onRest: vi.fn(), onAction: vi.fn() });
    window.close();
    expect(ui.top).toBeUndefined();
  });
});
