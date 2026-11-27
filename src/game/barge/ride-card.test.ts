// @vitest-environment happy-dom
// The barge ride card (mw-e25.15): a fare leaves `barge.ride`; the arrival plays the narration-barge
// pages and resets it. Real narration content, the UI root and the glue.
import { loadGameContent } from '@content/index';
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
});
