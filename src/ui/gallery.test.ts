// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { ToastHost } from '@ui/components/overlays';
import { GALLERY_SCREEN, openGallery } from '@ui/gallery';
import { UiRoot } from '@ui/screens';
import { find } from '@ui/testing/layout';

let ui: UiRoot;
beforeEach(() => {
  document.body.innerHTML = '';
  ui = new UiRoot(document.body);
});

const byText = (text: string): HTMLElement => {
  const found = [...document.querySelectorAll<HTMLElement>('button')].find(
    (b) => b.textContent === text,
  );
  if (!found) throw new Error(`no button ${text}`);
  return found;
};

describe('component gallery', () => {
  it('shows every kit component and focuses the first button', () => {
    const gallery = openGallery(ui);
    expect(ui.top?.id).toBe(GALLERY_SCREEN);
    const kinds = new Set(
      [...gallery.screen.element.querySelectorAll<HTMLElement>('[data-ui-component]')].map(
        (el) => el.dataset['uiComponent'],
      ),
    );
    for (const kind of ['button', 'toggle', 'slider', 'select', 'tabs', 'list', 'grid', 'glyph']) {
      expect(kinds, kind).toContain(kind);
    }
    expect(ui.hud.querySelector('[data-testid="vitals-hud"]')).not.toBeNull();
    expect(document.activeElement?.textContent).toBe('Primary');
    expect(document.querySelector('[role="tooltip"]')).not.toBeNull();
  });

  it('reports control values and drives the demo HUD', async () => {
    const gallery = openGallery(ui, { reducedMotion: () => true });
    ui.intent('confirm', 'keyboard');
    ui.intent('confirm', 'keyboard');
    expect(gallery.values['primary']).toBe(2);
    byText('Show toast').click();
    expect(gallery.toasts.element.children).toHaveLength(1);
    byText('Damage').click();
    byText('Damage').click();
    byText('Heal').click();
    expect(gallery.model().health.value).toBe(75);
    for (let i = 0; i < 5; i++) byText('Damage').click();
    expect(gallery.model().health.value).toBe(0);
    for (let i = 0; i < 5; i++) byText('Heal').click();
    expect(gallery.model().health.value).toBe(100);
    gallery.vitals.update(gallery.model(), 0);
    byText('Hover or focus me').click();
    expect(gallery.values['tooltipButton']).toBe(true);

    find('[role="switch"]').click();
    expect(gallery.values['toggle']).toBe(false);
    const slider = document.querySelector<HTMLElement>('[role="slider"]');
    slider?.focus();
    ui.intent('right', 'keyboard');
    expect(gallery.values['slider']).toBe(60);
    find('[role="spinbutton"]').click();
    expect(gallery.values['select']).toBe('hard');
    find('[data-tab="notes"]').click();
    expect(gallery.values['tabs']).toBe('notes');
    find('[aria-label="Inventory items"] [data-index="1"]').click();
    expect(gallery.values['list']).toBe('Item 2');
    find('[aria-label="Spell grid"] [data-index="5"]').click();
    expect(gallery.values['grid']).toBe('Spell 6');

    byText('Open confirm dialog').click();
    expect(ui.top?.id).toBe('confirm');
    byText('Burn it').click();
    await Promise.resolve();
    expect(gallery.values['confirm']).toBe(true);
  });

  it('back does not close it; closing removes its HUD pieces but not a shared toast host', () => {
    const shared = new ToastHost();
    ui.hud.append(shared.element);
    const gallery = openGallery(ui, { toasts: shared });
    ui.intent('back', 'gamepad');
    expect(ui.top?.id).toBe(GALLERY_SCREEN);
    gallery.screen.close();
    expect(ui.hud.querySelector('[data-testid="vitals-hud"]')).toBeNull();
    expect(shared.element.isConnected).toBe(true);
    const own = openGallery(ui);
    own.screen.close();
    expect(own.toasts.element.isConnected).toBe(false);
  });
});

describe('indicator bars (mw-e31.8)', () => {
  it('AC-1: the gallery shows every bar kind, each in its own data-kind', () => {
    const gallery = openGallery(ui);
    const kinds = [
      ...gallery.screen.element.querySelectorAll<HTMLElement>(
        '[data-testid="indicator-bars"] .vb-meter',
      ),
    ].map((el) => el.dataset['kind']);
    expect(kinds).toEqual(['health', 'stamina', 'mana', 'breath', 'poise']);
  });
});
