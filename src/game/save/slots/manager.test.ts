// SaveSlots rules (mw-e30.4): manual slot allocation and the full-slots overwrite choice (AC-1),
// metadata round trip (AC-2), confirmation-gated overwrite/delete (AC-4), rename, load, and how
// unreadable saves list. Thumbnail-failure integration (AC-3) is in manager.integration.test.ts.
import 'fake-indexeddb/auto';
import { defineComponent, World } from '@sim/index';
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { SaveCorruptError } from '../format/index';
import { createGameSaveRegistry } from '../sections';
import {
  IndexedDbSaveStore,
  MemorySaveStore,
  SAVE_DB_NAME,
  type SaveStore,
} from '../storage/index';
import { MANUAL_SLOTS, QUICKSAVE_SLOT, type SlotId } from './ids';
import { SaveSlots, type SaveSlotInput, type SlotSummary } from './manager';
import type { SlotThumbnail } from './thumbnail';

const Position = defineComponent<{ x: number }>('Position');
const build = { gameVersion: '0.2.0', buildSha: 'abc1234', contentHash: 'c0ffee' };
const input: SaveSlotInput = {
  characterName: 'Aldric',
  classId: 'knight',
  areaId: 'testbed-arena',
};
const png: SlotThumbnail = {
  mimeType: 'image/png',
  width: 256,
  height: 144,
  bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 42]),
};

function world(tick = 0, x = 1): World {
  const w = new World({ seed: 3 }).register(Position);
  w.add(w.spawn(), Position, { x });
  w.restore({ ...w.snapshot(), clock: { tick, hz: 60 } });
  return w;
}

function slots(store: SaveStore = new MemorySaveStore(), now = () => 1_790_000_000_000) {
  return new SaveSlots({ store, registry: createGameSaveRegistry(), build, now });
}

const states = (list: SlotSummary[]) => list.map((s) => `${s.slot}:${s.state}`);

describe('SaveSlots', () => {
  it('AC-1: with 10 manual slots filled, an 11th new save requires choosing an overwrite target', async () => {
    const store = new MemorySaveStore();
    const manager = slots(store);
    const saved: string[] = [];
    for (let i = 0; i < 10; i++) {
      const outcome = await manager.saveNew(world(i), input);
      saved.push(outcome.status === 'saved' ? outcome.slot : outcome.status);
    }
    expect(saved).toEqual(MANUAL_SLOTS);
    // Autosave and quicksave slots do not count towards the manual ten.
    await manager.save(QUICKSAVE_SLOT, world(), input, { overwrite: true });
    const eleventh = await manager.saveNew(world(99), input);
    expect(eleventh).toEqual({ status: 'choose-overwrite', candidates: MANUAL_SLOTS });
    expect((await store.read('manual-1', 'backup')).status).toBe('empty');

    const chosen = await manager.save('manual-4', world(99), input, { overwrite: true });
    expect(chosen.status).toBe('saved');
    expect((await store.read('manual-4', 'backup')).status).toBe('ok');
  });

  it('AC-1: a new save fills the first free manual slot', async () => {
    const manager = slots();
    await manager.saveNew(world(), input);
    await manager.saveNew(world(), input);
    await manager.delete('manual-1', { confirmed: true });
    const outcome = await manager.saveNew(world(), input);
    expect(outcome.status === 'saved' && outcome.slot).toBe('manual-1');
  });

  it('AC-2: a knight saved in testbed-arena after 3,600 ticks reads back those values and 60 s', async () => {
    const manager = slots();
    const outcome = await manager.save('manual-2', world(3_600), {
      ...input,
      label: ' Before the minotaur ',
      captureThumbnail: () => png,
    });
    const listed = (await manager.list()).find((s) => s.slot === 'manual-2');
    const expected = {
      state: 'ready',
      slot: 'manual-2',
      kind: 'manual',
      savedAt: 1_790_000_000_000,
      gameVersion: '0.2.0',
      details: {
        characterName: 'Aldric',
        classId: 'knight',
        areaId: 'testbed-arena',
        label: 'Before the minotaur',
        playtimeTicks: 3_600,
        tickRateHz: 60,
        playtimeSeconds: 60,
        thumbnail: png,
      },
    };
    expect(listed).toEqual(expected);
    expect(outcome).toEqual({
      status: 'saved',
      slot: 'manual-2',
      summary: expected,
      thumbnail: { status: 'captured' },
    });
  });

  it('capture saves the world as it was at the call, however long the thumbnail takes (mw-e01.21)', async () => {
    const store = new MemorySaveStore();
    const manager = slots(store);
    const w = world(7, 1);
    let drawn: (thumbnail: SlotThumbnail) => void = () => undefined;
    const pending = manager.capture(w, {
      ...input,
      captureThumbnail: () => new Promise<SlotThumbnail>((resolve) => (drawn = resolve)),
    });
    // The game runs on while the frame the thumbnail is taken from is drawn.
    w.restore({ ...w.snapshot(), clock: { tick: 12, hz: 60 } });
    const written = pending.writeTo('auto-2');
    drawn(png);
    expect(await written).toMatchObject({ status: 'saved', slot: 'auto-2' });
    const summary = (await manager.list(['auto-2']))[0];
    expect(summary).toMatchObject({ state: 'ready' });
    expect(summary?.state === 'ready' ? summary.details?.playtimeTicks : undefined).toBe(7);
    const loaded = world(0, 0);
    await manager.load('auto-2', loaded);
    expect(loaded.tick).toBe(7);
  });

  it('capture rejects an unknown slot and an over-long label', async () => {
    const manager = slots();
    expect(() => manager.capture(world(), { ...input, label: 'x'.repeat(500) })).toThrow(
      RangeError,
    );
    await expect(manager.capture(world(), input).writeTo('nope' as SlotId)).rejects.toThrow(
      RangeError,
    );
  });

  it('lists every slot in display order, empty or not', async () => {
    const manager = slots();
    await manager.save('auto-2', world(), input);
    const list = await manager.list();
    expect(list).toHaveLength(14);
    expect(states(list).filter((s) => !s.endsWith(':empty'))).toEqual(['auto-2:ready']);
    expect(list.map((s) => s.kind).slice(9, 14)).toEqual([
      'manual',
      'autosave',
      'autosave',
      'autosave',
      'quicksave',
    ]);
  });

  it('asks for confirmation before overwriting an occupied slot and writes nothing until given', async () => {
    const store = new MemorySaveStore();
    const manager = slots(store);
    let captures = 0;
    const capture = () => {
      captures++;
      return png;
    };
    await manager.save('manual-3', world(10), input);
    const asked = await manager.save('manual-3', world(20), {
      ...input,
      captureThumbnail: capture,
    });
    expect(asked).toEqual({ status: 'confirm-overwrite', slot: 'manual-3' });
    expect(captures).toBe(0);
    const read = await store.read('manual-3');
    expect(read.status === 'ok' && read.generation).toBe(1);
    await manager.save('manual-3', world(20), input, { overwrite: true });
    expect(await manager.load('manual-3', world())).toMatchObject({
      status: 'loaded',
      envelope: { createdAtTick: 20 },
    });
  });

  it('asks for confirmation before deleting and deletes nothing until given', async () => {
    const manager = slots();
    await manager.save('manual-1', world(), input);
    expect(await manager.delete('manual-1')).toEqual({ status: 'confirm-delete' });
    expect(await manager.delete('manual-1', { confirmed: false })).toEqual({
      status: 'confirm-delete',
    });
    expect(states(await manager.list())[0]).toBe('manual-1:ready');
  });

  it('AC-4: a confirmed deletion removes the slot and its backup blob', async () => {
    const factory = new IDBFactory();
    const store = await IndexedDbSaveStore.open(factory);
    const manager = slots(store);
    await manager.save('manual-5', world(1), input);
    await manager.save('manual-5', world(2), input, { overwrite: true });
    await manager.save('manual-6', world(3), input);
    expect((await store.read('manual-5', 'backup')).status).toBe('ok');

    expect(await manager.delete('manual-5', { confirmed: true })).toEqual({ status: 'deleted' });
    expect(await store.read('manual-5')).toEqual({ status: 'empty' });
    expect(await store.read('manual-5', 'backup')).toEqual({ status: 'empty' });
    expect(await blobKeys(factory)).toEqual([['manual-6', 1]]);
    expect(states(await manager.list()).slice(4, 6)).toEqual(['manual-5:empty', 'manual-6:ready']);
  });

  it('loads a slot into a world, reporting empty and failed loads without touching the world', async () => {
    const store = new MemorySaveStore();
    const manager = slots(store);
    await manager.save('manual-1', world(50, 7), input);
    const target = world(0, 0);
    const loaded = await manager.load('manual-1', target);
    expect(loaded).toMatchObject({ status: 'loaded', slot: 'manual-1', warnings: [] });
    expect(target.tick).toBe(50);

    const untouched = world(5, 5);
    const before = untouched.snapshot();
    expect(await manager.load('manual-2', untouched)).toEqual({
      status: 'empty',
      slot: 'manual-2',
    });
    await store.write('manual-2', new Uint8Array([1, 2, 3]));
    expect(await manager.load('manual-2', untouched)).toMatchObject({
      status: 'failed',
      slot: 'manual-2',
      error: { kind: 'corrupt' },
    });
    expect(untouched.snapshot()).toEqual(before);
  });

  it('reports a damaged store record as a failed load and an unreadable slot', async () => {
    const corrupt = new SaveCorruptError('blob missing');
    const store = new MemorySaveStore();
    const broken: SaveStore = {
      kind: 'memory',
      durable: false,
      read: (slot) =>
        slot === 'manual-1'
          ? Promise.resolve({ status: 'corrupt', error: corrupt })
          : store.read(slot),
      list: () => store.list(),
      write: (slot, bytes) => store.write(slot, bytes),
      delete: (slot) => store.delete(slot),
    };
    const manager = slots(broken);
    expect(await manager.load('manual-1', world())).toEqual({
      status: 'failed',
      slot: 'manual-1',
      error: corrupt,
    });
    expect((await manager.list())[0]).toEqual({
      state: 'unreadable',
      slot: 'manual-1',
      kind: 'manual',
      error: corrupt,
    });
    expect(await manager.rename('manual-1', 'x')).toEqual({ status: 'failed', error: corrupt });
  });

  it('lists undecodable saves as unreadable and saves without slot metadata without details', async () => {
    const store = new MemorySaveStore();
    const manager = slots(store);
    await store.write('manual-1', new Uint8Array([9, 9, 9]));
    const bare = createGameSaveRegistry().write(world(), { build, wallClockSavedAt: 5 });
    await store.write('manual-2', bare);
    const [first, second] = await manager.list();
    expect(first).toMatchObject({ state: 'unreadable', error: { kind: 'corrupt' } });
    expect(second).toEqual({
      state: 'ready',
      slot: 'manual-2',
      kind: 'manual',
      savedAt: 5,
      gameVersion: '0.2.0',
      details: undefined,
    });
  });

  it('mw-e01.9: a save with no thumbnail capture writes the world the moment it is called', async () => {
    const store = new MemorySaveStore();
    const manager = slots(store);
    const w = world(120);
    const pending = manager.overwrite('manual-1', w, input);
    // The world moves on before the save settles; what was written is the world as it was called.
    w.restore({ ...w.snapshot(), clock: { tick: 125, hz: 60 } });
    await pending;
    const target = world();
    await manager.load('manual-1', target);
    expect(target.tick).toBe(120);
  });

  it('renames a slot, changing only its label, and clears the label with a blank name', async () => {
    const store = new MemorySaveStore();
    const manager = slots(store);
    await manager.save('manual-1', world(120), { ...input, captureThumbnail: () => png });
    const renamed = await manager.rename('manual-1', '  Minotaur test ');
    expect(renamed).toMatchObject({
      status: 'renamed',
      summary: { savedAt: 1_790_000_000_000, details: { label: 'Minotaur test', thumbnail: png } },
    });
    const target = world();
    expect(await manager.load('manual-1', target)).toMatchObject({ status: 'loaded' });
    expect(target.tick).toBe(120);
    // The pre-rename copy is the backup.
    expect((await store.read('manual-1', 'backup')).status).toBe('ok');

    const cleared = await manager.rename('manual-1', ' ');
    expect(cleared.status === 'renamed' && cleared.summary.details?.label).toBeUndefined();
  });

  it('renames nothing for an empty slot and reports an undecodable save', async () => {
    const store = new MemorySaveStore();
    const manager = slots(store);
    expect(await manager.rename('manual-1', 'x')).toEqual({ status: 'empty' });
    await store.write('manual-1', new Uint8Array([1]));
    expect(await manager.rename('manual-1', 'x')).toMatchObject({
      status: 'failed',
      error: { kind: 'corrupt' },
    });
  });

  it('keeps sections unknown to this build when a save continues one', async () => {
    const manager = slots();
    const preserve = { future: { version: 2, data: { bells: 3 } } };
    await manager.save('quick', world(), { ...input, preserve }, { overwrite: true });
    expect(await manager.load('quick', world())).toMatchObject({
      status: 'loaded',
      unknownSections: preserve,
    });
  });

  it('refuses unknown slots and over-long labels', async () => {
    const manager = slots();
    const bogus = 'manual-11' as SlotId;
    await expect(manager.save(bogus, world(), input)).rejects.toThrow(
      '"manual-11" is not a save slot',
    );
    await expect(manager.load(bogus, world())).rejects.toThrow(RangeError);
    await expect(manager.delete(bogus, { confirmed: true })).rejects.toThrow(RangeError);
    await expect(manager.rename(bogus, 'x')).rejects.toThrow(RangeError);
    await expect(manager.overwrite(bogus, world(), input)).rejects.toThrow(RangeError);
    await expect(manager.list(['auto-1', bogus])).rejects.toThrow(RangeError);
    await expect(
      manager.save('manual-1', world(), { ...input, label: 'x'.repeat(41) }),
    ).rejects.toThrow(RangeError);
    await expect(manager.rename('manual-1', 'x'.repeat(41))).rejects.toThrow(RangeError);
  });

  it('overwrites an occupied slot without asking and lists just the slots asked for', async () => {
    const store = new MemorySaveStore();
    const manager = slots(store);
    await manager.overwrite('auto-2', world(10), input);
    const second = await manager.overwrite('auto-2', world(20), { ...input, label: ' Gate ' });
    expect(second.slot).toBe('auto-2');
    expect(second.summary.details?.label).toBe('Gate');
    expect((await store.read('auto-2', 'backup')).status).toBe('ok');
    expect(states(await manager.list(['auto-3', 'auto-2']))).toEqual([
      'auto-3:empty',
      'auto-2:ready',
    ]);
  });

  it('passes storage failures through, leaving the slot as it was', async () => {
    const store = new MemorySaveStore();
    const manager = slots({
      kind: 'memory',
      durable: false,
      read: (slot) => store.read(slot),
      list: () => store.list(),
      delete: (slot) => store.delete(slot),
      write: () => Promise.reject(new Error('disk full')),
    });
    await expect(manager.saveNew(world(), input)).rejects.toThrow('disk full');
    expect(await store.list()).toEqual([]);
  });
});

async function blobKeys(factory: IDBFactory): Promise<IDBValidKey[]> {
  const db = await new Promise<IDBDatabase>((resolve) => {
    const request = factory.open(SAVE_DB_NAME);
    request.onsuccess = () => {
      resolve(request.result);
    };
  });
  const keys = await new Promise<IDBValidKey[]>((resolve) => {
    const request = db.transaction('blobs').objectStore('blobs').getAllKeys();
    request.onsuccess = () => {
      resolve(request.result);
    };
  });
  db.close();
  return keys;
}
