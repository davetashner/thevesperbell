// @vitest-environment happy-dom
// The barge ride card (mw-e25.15): a fare leaves `barge.ride`; the arrival plays the narration-barge
// pages and resets it. Real narration content, the UI root and the glue.
import { loadGameContent } from '@content/index';
import { NARRATIVE_CLASSES } from '@content/narrative/class-variants';
import { findSequence, type Narration } from '@content/types/narration';
import { World } from '@sim/index';
import { UiRoot } from '@ui/index';
import { find, rectFromData } from '@ui/testing/layout';
import { beforeEach, describe, expect, it } from 'vitest';
import { installFactRegistry } from '../facts';
import {
  BARGE_RIDE_FACT,
  BARGE_RIDE_SCREEN,
  BargeRideCard,
  startBargeRideUi,
  type BargeRideReading,
} from './ride-card';

const content = loadGameContent();
const narrations = content.all('narration') as readonly Narration[];

beforeEach(() => {
  document.body.innerHTML = '';
});

function setup() {
  const world = new World<never>({ seed: 5 });
  installFactRegistry(world.facts, content, true);
  const ui = new UiRoot(document.body, { unstyled: true, focus: { rectOf: rectFromData } });
  const published: BargeRideReading[] = [];
  const card = startBargeRideUi({
    ui,
    world,
    content,
    publish: (_key, value) => published.push(JSON.parse(value) as BargeRideReading),
  });
  return { world, ui, card, published };
}

const bodyText = () => find('[data-testid="epilogue-body"]').textContent;
const pages = (id: string) => findSequence(narrations, 'barge', id)?.pages.map((p) => p.text) ?? [];

describe('barge ride card (mw-e25.15)', () => {
  it('shows nothing until a ride is waiting', () => {
    const t = setup();
    t.card.afterStep();
    expect(t.ui.top).toBeUndefined();
    expect(t.published.at(-1)).toEqual({ open: false, ride: null, shown: [], ended: null });
  });

  it('plays the downriver pages in order, pausing the sim, then resets the fact', () => {
    const t = setup();
    t.world.facts.set(BARGE_RIDE_FACT, 'downriver');
    t.card.afterStep();
    const expected = pages('downriver-to-wendmouth');
    expect(t.ui.top?.id).toBe(BARGE_RIDE_SCREEN);
    expect(t.ui.pausesSim).toBe(true);
    expect(t.world.facts.get(BARGE_RIDE_FACT)).toBe('none');
    expect(find('[data-testid="epilogue-title"]').textContent).toBe('Downriver');
    const seen = [bodyText()];
    for (let i = 1; i < expected.length; i += 1) {
      t.ui.intent('tabNext', 'keyboard');
      seen.push(bodyText());
    }
    expect(seen).toEqual(expected);
    t.ui.intent('tabNext', 'keyboard');
    expect(t.ui.top).toBeUndefined();
    expect(t.card.isOpen).toBe(false);
    expect(t.published.at(-1)).toMatchObject({
      open: false,
      shown: ['downriver'],
      ended: 'finished',
    });
  });

  it('boarding at Kestrel Lock skips the page that casts off from the quay', () => {
    const t = setup();
    t.world.facts.set(BARGE_RIDE_FACT, 'lock-downriver');
    t.card.afterStep();
    expect(bodyText()).toBe(pages('downriver-to-wendmouth')[1]);
  });

  it('plays the upriver pages, and Esc skips the card but ends the ride', () => {
    const t = setup();
    t.world.facts.set(BARGE_RIDE_FACT, 'upriver');
    t.card.afterStep();
    expect(bodyText()).toBe(pages('upriver-to-briar-glen')[0]);
    t.ui.intent('back', 'keyboard');
    expect(t.published.at(-1)).toMatchObject({ shown: ['upriver'], ended: 'skipped' });
    t.card.afterStep();
    expect(t.ui.top).toBeUndefined();
  });

  it('waits while another screen is open, and an unknown ride shows nothing', () => {
    const t = setup();
    t.world.facts.set(BARGE_RIDE_FACT, 'downriver');
    const other = t.ui.push({
      id: 'other',
      label: 'Other',
      content: document.createElement('div'),
    });
    t.card.afterStep();
    expect(t.world.facts.get(BARGE_RIDE_FACT)).toBe('downriver');
    other.close();
    t.card.afterStep();
    t.card.close();
    expect(t.ui.top).toBeUndefined();
    t.world.facts.set(BARGE_RIDE_FACT, 'none');
    t.card.afterStep();
    expect(t.ui.top).toBeUndefined();
  });

  it('a ride with no pages in the narration ends at once without opening a window', () => {
    const t = setup();
    const bare = new BargeRideCard({
      ui: t.ui,
      world: t.world,
      content: { all: () => [] } as never,
      onChange: (reading) => t.published.push(reading),
    });
    t.world.facts.set(BARGE_RIDE_FACT, 'upriver');
    bare.afterStep();
    expect(t.ui.top).toBeUndefined();
    expect(t.published.at(-1)).toMatchObject({
      open: false,
      shown: ['upriver'],
      ended: 'finished',
    });
  });

  it('a ride value the card has no sequence for ends at once without a window', () => {
    const world = new World<never>({ seed: 5 });
    const ui = new UiRoot(document.body, { unstyled: true, focus: { rectOf: rectFromData } });
    const readings: BargeRideReading[] = [];
    const card = new BargeRideCard({ ui, world, content, onChange: (r) => readings.push(r) });
    world.facts.set(BARGE_RIDE_FACT, 'ferry');
    card.afterStep();
    expect(ui.top).toBeUndefined();
    expect(readings.at(-1)).toMatchObject({ open: false, shown: ['ferry'], ended: 'finished' });
  });

  it('the Kestrel Lock legs play their own sequences', () => {
    for (const [ride, sequence] of [
      ['quay-lock-downriver', 'downriver-to-kestrel-lock'],
      ['wharf-lock-upriver', 'upriver-to-kestrel-lock'],
    ] as const) {
      document.body.innerHTML = '';
      const t = setup();
      t.world.facts.set(BARGE_RIDE_FACT, ride);
      t.card.afterStep();
      expect(bodyText()).toBe(pages(sequence)[0]);
      expect(t.published.at(-1)).toMatchObject({ open: true, ride });
    }
  });

  it.each([
    ['downriver', 'downriver-to-wendmouth', 'AC-1'],
    ['lock-downriver', 'downriver-to-wendmouth', 'AC-1'],
    ['upriver', 'upriver-to-briar-glen', 'AC-1'],
    ['quay-lock-downriver', 'downriver-to-kestrel-lock', 'AC-1'],
    ['wharf-lock-upriver', 'upriver-to-kestrel-lock', 'AC-1'],
  ])('%s: each class hears its own Mags aside before the last page (mw-e39.49)', (ride, id) => {
    const sequence = findSequence(narrations, 'barge', id);
    const skip = ride === 'lock-downriver' ? 1 : 0;
    for (const playerClass of NARRATIVE_CLASSES) {
      document.body.innerHTML = '';
      const t = setup();
      t.world.facts.set('player.class', playerClass);
      t.world.facts.set(BARGE_RIDE_FACT, ride);
      t.card.afterStep();
      const plain = (sequence?.pages ?? []).slice(skip).map((p) => p.text);
      const aside = sequence?.variants?.[playerClass]?.map((p) => p.text) ?? [];
      expect(aside).toHaveLength(1);
      const expected = [...plain.slice(0, -1), ...aside, ...plain.slice(-1)];
      const seen = [bodyText()];
      for (let i = 1; i < expected.length; i += 1) {
        t.ui.intent('tabNext', 'keyboard');
        seen.push(bodyText());
      }
      expect(seen).toEqual(expected);
    }
  });

  it("every class has an aside on every ride, in Mags's voice", () => {
    for (const id of [
      'downriver-to-wendmouth',
      'upriver-to-briar-glen',
      'downriver-to-kestrel-lock',
      'upriver-to-kestrel-lock',
    ]) {
      for (const playerClass of NARRATIVE_CLASSES) {
        const text = findSequence(narrations, 'barge', id)?.variants?.[playerClass]?.[0]?.text;
        expect(text, `${id} ${playerClass}`).toMatch(/Mags/);
        expect(text, `${id} ${playerClass}`).toMatch(/love/);
      }
    }
  });

  it('a player with no class, or a sequence with no aside for the class, plays the plain pages', () => {
    const plain = pages('downriver-to-wendmouth');
    const first = setup();
    first.world.facts.set(BARGE_RIDE_FACT, 'downriver');
    first.card.afterStep();
    const seen = [bodyText()];
    for (let i = 1; i < plain.length; i += 1) {
      first.ui.intent('tabNext', 'keyboard');
      seen.push(bodyText());
    }
    expect(seen).toEqual(plain);
    document.body.innerHTML = '';
    const t = setup();
    const bare: Narration = {
      id: 'narration-barge',
      kind: 'barge',
      notes: 'N.',
      sequences: [{ id: 'downriver-to-wendmouth', pages: [{ text: 'One.' }, { text: 'Two.' }] }],
    };
    const card = new BargeRideCard({
      ui: t.ui,
      world: t.world,
      content: { all: () => [bare] } as never,
    });
    t.world.facts.set('player.class', 'knight');
    t.world.facts.set(BARGE_RIDE_FACT, 'downriver');
    card.afterStep();
    expect(bodyText()).toBe('One.');
    t.ui.intent('tabNext', 'keyboard');
    expect(bodyText()).toBe('Two.');
  });
});
