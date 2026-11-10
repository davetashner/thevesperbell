// UI component gallery page (mw-e00.23): mounts a UiRoot, opens the gallery screen and exposes a few
// hooks on window.__ui for the Playwright helpers (e2e/helpers/ui.ts). Query parameters:
//   ?scale=2       sets --ui-text-scale
//   ?hudbench=30   updates the vitals HUD every tick for N seconds and reports per-frame UI cost
// Screens: `gallery` (opened at load), `options` (the settings menu, mw-e31.1, on localStorage) and
// `inventory` (the inventory screen, mw-e17.10, over a demo pack; a chosen action is echoed on its
// status line), `container` and `container-empty` (the container window, mw-e18.4, over a demo chest;
// a take is echoed on its status line, Take All on #app[data-container-took]). `__ui.pickups()` shows
// demo pickup toasts, a discovery among them.
import { createSettingsStore, OPTIONS_SCREEN, openOptionsMenu } from '@game/settings/index';
import {
  browserGeometry,
  CONTAINER_SCREEN,
  findClippedText,
  focusables,
  INVENTORY_SCREEN,
  openGallery,
  openContainerWindow,
  openInventory,
  PickupToasts,
  reducedMotion,
  setDyslexiaFont,
  setTextBackdrop,
  setTextScale,
  UiRoot,
  type ContainerWindowModel,
  type Gallery,
  type InventoryItemModel,
  type InventoryModel,
  type VitalsViewModel,
} from '@ui/index';

const found = document.querySelector<HTMLElement>('#app');
if (!found) throw new Error('#app missing');
const app: HTMLElement = found;

const ui = new UiRoot(app);
const params = new URLSearchParams(location.search);
const scale = params.get('scale');
if (scale !== null) setTextScale(ui.element, Number(scale));
const matchMedia = window.matchMedia.bind(window);
const input = ui.attachInput({ window, navigator, now: () => performance.now() });

let gallery: Gallery = openGallery(ui, {
  reducedMotion: () => reducedMotion(ui.element, matchMedia),
});

const settings = createSettingsStore({ storage: () => window.localStorage });
// The accessibility settings drive the root live, as in the game (src/main.ts); ?scale= wins at load.
if (scale === null) setTextScale(ui.element, settings.get('accessibility.textScale'));
settings.on('accessibility.textScale', (value) => setTextScale(ui.element, value));
setDyslexiaFont(ui.element, settings.get('accessibility.dyslexiaFont'));
settings.on('accessibility.dyslexiaFont', (on) => {
  setDyslexiaFont(ui.element, on);
});
setTextBackdrop(ui.element, settings.get('accessibility.textBackground'));
settings.on('accessibility.textBackground', (value) => setTextBackdrop(ui.element, value));

const demoItem = (id: number, item: Omit<InventoryItemModel, 'id'>): InventoryItemModel => ({
  id,
  ...item,
});

/** A demo pack: every tab, a stolen item, a long name, a quick slot and an equipped weapon. */
const DEMO_PACK: InventoryModel = {
  gold: 1234,
  items: [
    demoItem(9, {
      name: 'Healing draught',
      description: 'Red, faintly fizzy and tasting of copper pennies.',
      category: 'Consumable',
      icon: 'consumable',
      tabs: ['consumables'],
      count: 3,
      value: 15,
      stolen: false,
      verbs: ['Restore health (30)'],
      quickSlot: 1,
      actions: ['use', 'assign', 'unassign', 'drop', 'throw'],
    }),
    demoItem(8, {
      name: 'Exceedingly ornate ceremonial lantern of the harbour guild',
      description: 'It is very shiny and somebody will definitely miss it.',
      category: 'Artifact',
      icon: 'artifact',
      tabs: ['quest'],
      count: 1,
      value: 300,
      stolen: true,
      owner: 'the Harbour Guild',
      verbs: ['Light the way'],
      actions: ['drop', 'throw'],
    }),
    demoItem(7, {
      name: 'Arming sword',
      description: 'A plain, honest blade.',
      category: 'Weapon',
      icon: 'weapon',
      tabs: ['arms'],
      count: 1,
      value: 40,
      stolen: false,
      verbs: ['Wield in one hand'],
      equipped: 'Main hand',
      actions: ['unequip', 'drop', 'throw'],
    }),
    demoItem(6, {
      name: 'Lockpicks',
      description: 'Legally, a set of very small dental instruments.',
      category: 'Tool',
      icon: 'tool',
      tabs: ['tools'],
      count: 1,
      value: 20,
      stolen: false,
      verbs: ['Pick Locks while carried'],
      actions: ['drop', 'throw'],
    }),
    demoItem(5, {
      name: 'A Primer of Small Fires',
      description: 'Chapter one: do not.',
      category: 'Book',
      icon: 'book',
      tabs: ['books'],
      count: 1,
      value: 25,
      stolen: false,
      verbs: ['Read', 'Learn Ember'],
      actions: ['drop', 'throw'],
    }),
    demoItem(4, {
      name: 'Rusted gallery key',
      description: '',
      category: 'Key',
      icon: 'key',
      tabs: ['keys', 'quest'],
      count: 1,
      value: 0,
      stolen: false,
      verbs: ['Unlock: Slice exit lock'],
      notes: ['Can’t be dropped.'],
      actions: [],
    }),
    demoItem(3, {
      name: 'Oil flask',
      description: 'Anything nearby becomes keen to catch fire.',
      category: 'Consumable',
      icon: 'consumable',
      tabs: ['consumables'],
      count: 2,
      value: 10,
      stolen: false,
      verbs: ['Throw (flammable, liquid)'],
      actions: ['use', 'assign', 'drop', 'throw'],
    }),
  ],
  quickSlots: [
    { label: '', count: 0 },
    { label: 'Healing draught', count: 3 },
    { label: '', count: 0 },
    { label: '', count: 0 },
  ],
};

/** A demo chest: gold, a long name, a stack and an artifact. */
const DEMO_CHEST: ContainerWindowModel = {
  title: 'Supply chest',
  gold: 37,
  items: [
    { id: 1, name: 'Healing draught', icon: 'consumable', count: 1 },
    { id: 2, name: 'Standard arrow', icon: 'ammo', count: 12 },
    {
      id: 3,
      name: 'Exceedingly ornate ceremonial lantern of the harbour guild',
      icon: 'artifact',
      count: 1,
    },
  ],
};

const CONTAINER_EMPTY_SCREEN = 'container-empty';
const SCREENS = [
  'gallery',
  OPTIONS_SCREEN,
  INVENTORY_SCREEN,
  CONTAINER_SCREEN,
  CONTAINER_EMPTY_SCREEN,
];

/** Opens a screen by id, closing everything else first (the Playwright `openScreen` helper). */
function openScreen(id: string): void {
  if (!SCREENS.includes(id)) throw new Error(`unknown screen ${id}`);
  ui.clear();
  if (id === CONTAINER_SCREEN || id === CONTAINER_EMPTY_SCREEN) {
    const window = openContainerWindow(ui, {
      model: id === CONTAINER_SCREEN ? DEMO_CHEST : { title: 'Barrel', gold: 0, items: [] },
      onTake: (item) => {
        window.say(`take ${String(item)}`);
      },
      onTakeGold: () => {
        window.say('take gold');
      },
      onTakeAll: () => {
        app.dataset['containerTook'] = 'all';
      },
    });
    return;
  }
  if (id === OPTIONS_SCREEN) {
    openOptionsMenu(ui, settings);
    return;
  }
  if (id === INVENTORY_SCREEN) {
    const inventory = openInventory(ui, {
      model: DEMO_PACK,
      onAction: (request) => {
        inventory.say(`${request.action} ${String(request.itemId)}`);
      },
    });
    return;
  }
  gallery = openGallery(ui, { reducedMotion: () => reducedMotion(ui.element, matchMedia) });
}

/** `screen/component#n`: the component (n-th `[data-ui-component]` of its screen) holding `el`. */
function componentKey(el: Element): string | null {
  const component = el.closest<HTMLElement>('[data-ui-component]');
  const screen = el.closest<HTMLElement>('[data-screen]');
  if (!component || !screen) return null;
  const index = [...screen.querySelectorAll('[data-ui-component]')].indexOf(component);
  return `${screen.dataset['screen'] ?? '?'}/${component.dataset['uiComponent'] ?? '?'}#${String(index)}`;
}

/** The focused element's component key. */
function describeFocus(): string | null {
  const el = document.activeElement;
  return el instanceof HTMLElement ? componentKey(el) : null;
}

/** Keys of every component in the top screen that can take focus. */
function interactiveComponents(): string[] {
  const top = ui.top;
  if (!top) return [];
  return [...top.element.querySelectorAll<HTMLElement>('[data-ui-component]')]
    .filter((el) => el.tabIndex >= 0 || focusables(el).length > 0)
    .map((el) => componentKey(el) ?? '?');
}

// Every frame: read the pad, advance the demo HUD.
let hudBench: { until: number; samples: number[] } | undefined;
// Demo pickup toasts (mw-e18.4) on the HUD, expired on the frame clock.
const pickups = new PickupToasts();
ui.hud.append(pickups.element);
const benchSeconds = Number(params.get('hudbench') ?? '0');
function frame(now: number): void {
  input.poll();
  pickups.frame(now);
  if (hudBench) {
    // AC-8: health, stamina and 4 quick slots all change every tick.
    const t = Math.floor(now / (1000 / 60));
    const model: VitalsViewModel = {
      health: { value: 50 + (t % 50), max: 100 },
      stamina: { value: 100 - (t % 100), max: 100 },
      slots: [0, 1, 2, 3].map((i) => ({
        label: `Slot ${String(i + 1)}`,
        glyph: String(i + 1),
        count: (t + i) % 20,
        cooldown: ((t + 7 * i) % 60) / 60,
      })),
    };
    const start = performance.now();
    gallery.vitals.update(model, now);
    hudBench.samples.push(performance.now() - start);
    if (now >= hudBench.until) {
      const sorted = [...hudBench.samples].sort((a, b) => a - b);
      const at = (q: number): number =>
        sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0;
      app.dataset['hudBench'] = JSON.stringify({
        count: sorted.length,
        p50: at(0.5),
        p95: at(0.95),
        max: sorted.at(-1) ?? 0,
      });
      hudBench = undefined;
    }
  } else {
    gallery.vitals.update(gallery.model(), now);
  }
  requestAnimationFrame(frame);
}
if (benchSeconds > 0) hudBench = { until: performance.now() + benchSeconds * 1000, samples: [] };
requestAnimationFrame(frame);

Object.assign(window, {
  __ui: {
    openScreen,
    poll: () => {
      input.poll();
    },
    focus: describeFocus,
    focusInTop: () => {
      const top = ui.top;
      return top?.element.contains(document.activeElement) ?? false;
    },
    topScreen: () => ui.top?.id ?? null,
    components: interactiveComponents,
    clippedText: () => findClippedText(ui.element, browserGeometry(window)),
    setTextScale: (value: number) => setTextScale(ui.element, value),
    values: () => gallery.values,
    pickups: () => {
      const now = performance.now();
      pickups.push({ key: 'gold', name: 'Gold', icon: 'currency', count: 37, gold: true }, now);
      pickups.push({ key: 'arrow', name: 'Standard arrow', icon: 'ammo', count: 12 }, now);
      pickups.push(
        {
          key: 'charm',
          name: 'Lodestone charm',
          icon: 'artifact',
          count: 1,
          discovery: 'It points north, mostly. On Tuesdays it points at whoever owes you money.',
        },
        now,
      );
    },
  },
});
app.dataset['ready'] = 'true';
