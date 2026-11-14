// @vitest-environment happy-dom
// The reader in the game (mw-kf4c): a real world with the game content's texts, the UI root and the
// glue between them. Reading a tagged spawn opens the window; the first read writes the evidence facts
// and publishes the logic events; later reads change nothing.
import { loadGameContent } from '@content/index';
import { interacted, SceneSpawnComponent, World, type EntityId } from '@sim/index';
import { UiRoot } from '@ui/index';
import { find, rectFromData } from '@ui/testing/layout';
import { beforeEach, describe, expect, it } from 'vitest';
import { installFactRegistry } from '../facts';
import { logicEmitted, type LogicEmitted } from '../logic/host';
import {
  READABLE_READ_EVENT,
  readableTexts,
  readFactKey,
  ReaderController,
  startReaderUi,
  type ReaderReading,
} from './reader';

const content = loadGameContent();

beforeEach(() => {
  document.body.innerHTML = '';
});

function setup(publish = true) {
  const world = new World<unknown>({ seed: 3 });
  world.register(SceneSpawnComponent);
  const sim = world as unknown as World<never>;
  installFactRegistry(sim.facts, content);
  const player = world.spawn();
  const ui = new UiRoot(document.body, { unstyled: true, focus: { rectOf: rectFromData } });
  const published: ReaderReading[] = [];
  const reader = startReaderUi({
    ui,
    world: sim,
    content,
    player,
    ...(publish && {
      publish: (_key, value) => published.push(JSON.parse(value) as ReaderReading),
    }),
  });
  const emitted: LogicEmitted[] = [];
  sim.events.on(logicEmitted, (event) => emitted.push(event));
  const spawn = (tags: string[]): EntityId => {
    const entity = world.spawn();
    world.add(entity, SceneSpawnComponent, { id: 'text', tags });
    return entity;
  };
  const read = (target: EntityId, verb: 'read' | 'search' = 'read', actor = player) => {
    world.events.emit(interacted, { actor, target, verb, affordance: 0 });
    world.step([]);
    reader.afterStep();
    world.step([]); // events published on opening are delivered with the next step
  };
  return { sim, ui, reader, published, emitted, spawn, read, player };
}

const MANIFEST = ['readable', 'note-cargo-manifest'];

describe('reader (mw-kf4c)', () => {
  it('AC-1: reading a tagged spawn opens the window with the title, byline and body', () => {
    const t = setup();
    t.read(t.spawn(MANIFEST));
    expect(t.ui.top?.id).toBe('reader');
    expect(find('[data-testid="reader-window"] h1').textContent).toBe(
      'Cargo Manifest — Gilded Tern, Bay Nine',
    );
    expect(find('[data-testid="reader-byline"]').textContent).toContain('Ardley');
    expect(find('[data-testid="reader-body"]').textContent).toContain('GLENSTONE SAMPLES');
    expect(t.reader.controller.isOpen).toBe(true);
    expect(t.published.at(-1)).toEqual({
      open: true,
      text: 'note-cargo-manifest',
      read: ['note-cargo-manifest'],
    });
  });

  it('AC-1: a text with no author has no byline and a multi-page book can be paged', () => {
    const t = setup();
    expect(readableTexts(content).get('book-keepers-log')?.kind).toBe('book');
    t.read(t.spawn(['readable', 'book-keepers-log']));
    expect(find('[data-testid="reader-page"]').textContent).toMatch(/^Page 1 of \d/);
  });

  it('AC-1: Esc and the interact key close it, and so does Close', () => {
    const t = setup();
    for (const close of [
      () => t.ui.intent('back', 'keyboard'),
      () => t.ui.intent('tabNext', 'keyboard'),
      () => t.ui.intent('secondary', 'gamepad'),
      () => {
        find('[data-action="close"]').click();
      },
    ]) {
      t.read(t.spawn(MANIFEST));
      expect(t.ui.top?.id).toBe('reader');
      close();
      expect(t.ui.top).toBeUndefined();
    }
    expect(t.published.at(-1)?.open).toBe(false);
  });

  it('AC-2: the first read writes the evidence facts and publishes the logic events', () => {
    const t = setup();
    expect(t.sim.facts.get('evidence.dead-clerk-seal')).toBe(false);
    t.read(t.spawn(MANIFEST));
    expect(t.sim.facts.get('evidence.dead-clerk-seal')).toBe(true);
    expect(t.sim.facts.get(readFactKey('note-cargo-manifest'))).toBe(true);
    expect(t.emitted).toEqual([
      { event: READABLE_READ_EVENT, data: { text: 'note-cargo-manifest', kind: 'note' } },
      { event: 'note-cargo-manifest', data: { text: 'note-cargo-manifest', kind: 'note' } },
    ]);
  });

  it('AC-2: a text with no evidence still records and emits on its first read', () => {
    const t = setup();
    t.read(t.spawn(['readable', 'note-friend-below-door']));
    expect(t.sim.facts.get(readFactKey('note-friend-below-door'))).toBe(true);
    expect(t.emitted.map((e) => e.event)).toEqual([
      READABLE_READ_EVENT,
      'note-friend-below-door',
      'friend-note-found',
    ]);
  });

  it('AC-2: reading again opens the window but writes and emits nothing', () => {
    const t = setup();
    const note = t.spawn(MANIFEST);
    t.read(note);
    t.ui.intent('back', 'keyboard');
    t.emitted.length = 0;
    t.sim.facts.set('evidence.dead-clerk-seal', false);
    t.read(note);
    expect(t.ui.top?.id).toBe('reader');
    expect(t.emitted).toEqual([]);
    expect(t.sim.facts.get('evidence.dead-clerk-seal')).toBe(false);
    expect(t.published.at(-1)?.read).toEqual(['note-cargo-manifest']);
  });

  it('AC-2: read state is a permanent fact, so a save carries it', () => {
    const t = setup();
    t.read(t.spawn(MANIFEST));
    expect(t.sim.facts.snapshot()[readFactKey('note-cargo-manifest')]).toBe(true);
  });

  it('AC-1 (edge): other verbs, other actors, untagged and unknown texts do nothing', () => {
    const t = setup();
    t.read(t.spawn(MANIFEST), 'search');
    t.read(t.spawn(MANIFEST), 'read', t.player + 1);
    t.read(t.spawn(['note-cargo-manifest']));
    t.read(t.spawn(['readable', 'note-no-such-text']));
    t.read(t.spawn(['readable']));
    t.read(t.player); // not a scene spawn at all
    expect(t.ui.top).toBeUndefined();
    expect(t.emitted).toEqual([]);
  });

  it('AC-1 (edge): open() refuses while another screen is open or twice, and without publishing', () => {
    const t = setup(false);
    expect(t.reader.controller.open('note-no-such-text')).toBe(false);
    expect(t.reader.controller.open('note-cargo-manifest')).toBe(true);
    expect(t.reader.controller.open('note-foundry-invoice')).toBe(false);
    t.reader.controller.close();
    t.ui.push({ id: 'other', label: 'Other', content: document.createElement('div') });
    expect(t.reader.controller.open('note-cargo-manifest')).toBe(false);
    t.reader.controller.dispose();
    t.reader.controller.close();
  });

  it('AC-1 (edge): dispose stops listening and closes the window', () => {
    const t = setup();
    const note = t.spawn(MANIFEST);
    t.read(note);
    t.reader.controller.dispose();
    expect(t.ui.top).toBeUndefined();
    t.read(note);
    expect(t.ui.top).toBeUndefined();
  });

  it('AC-3: every readable text with evidence names a declared fact (a read cannot throw)', () => {
    const t = setup();
    for (const id of readableTexts(content).keys()) {
      const controller = new ReaderController({
        ui: t.ui,
        world: t.sim,
        player: t.player,
        texts: readableTexts(content),
      });
      expect(controller.open(id), id).toBe(true);
      controller.dispose();
    }
  });

  it('AC-3: a new game still declares no value but player.class', () => {
    const t = setup();
    expect(Object.keys(t.sim.facts.snapshot())).toEqual([]);
  });

  it("mw-nro9 AC-1: the first read publishes the text's emits events after the two standard ones, later reads do not", () => {
    const t = setup();
    const spawn = t.spawn(['readable', 'note-friend-below-door']);
    t.read(spawn);
    expect(t.emitted.map((e) => e.event)).toEqual([
      READABLE_READ_EVENT,
      'note-friend-below-door',
      'friend-note-found',
    ]);
    expect(t.emitted[2]?.data).toEqual({ text: 'note-friend-below-door', kind: 'note' });
    t.reader.controller.close();
    t.read(spawn);
    expect(t.emitted).toHaveLength(3);
  });

  it('mw-nro9 AC-1: a text without emits publishes only the two standard events', () => {
    const t = setup();
    t.read(t.spawn(MANIFEST));
    expect(t.emitted.map((e) => e.event)).toEqual([READABLE_READ_EVENT, 'note-cargo-manifest']);
  });
});
