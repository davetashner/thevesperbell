// Tests for the creature audio load-time checks (mw-e28.8).

import { describe, expect, it } from 'vitest';
import { checkCreatureAudio, CREATURE_AUDIO_MIN_LEAD_TICKS } from './creature-audio-checks.ts';
import { loadGameContent } from './game-content.ts';
import type { LoadedEntry } from './loader.ts';
import { CREATURE_AUDIO_SLOTS } from './types/creature-audio.ts';

const AUDIO = {
  idleLoop: 'sfx-t-idle',
  footsteps: 'sfx-t-step',
  alertBark: 'sfx-t-bark',
  telegraph: 'sfx-t-tele',
  hurt: 'sfx-t-hurt',
  poiseBreak: 'sfx-t-stagger',
  death: 'sfx-t-death',
};

const entry = (type: string, value: object): LoadedEntry =>
  ({ type, file: `data/${type}/${(value as { id: string }).id}.json`, value }) as LoadedEntry;

const creature = (extra: object = {}, attacks: string[] = []) =>
  entry('creature', {
    id: 'skeleton',
    audio: AUDIO,
    attacks: attacks.map((id) => ({ id })),
    ...extra,
  });
const move = (id: string, startup: number, extra: object = {}) =>
  entry('move', { id, frames: { startup }, telegraphTick: 0, flags: {}, ...extra });
const attack = (id: string, moveId: string, extra: object = {}) =>
  entry('attack', { id, move: { id: moveId }, kind: 'melee', ...extra });

const messages = (entries: LoadedEntry[]) =>
  checkCreatureAudio(entries).map((i) => `${i.file}#${i.pointer}: ${i.message}`);

describe('creature audio checks (mw-e28.8)', () => {
  it('AC-1: a creature with every slot is clean', () => {
    expect(messages([creature()])).toEqual([]);
  });

  it('AC-1: a creature with no audio block, or missing slots, is named with each slot', () => {
    expect(messages([creature({ audio: undefined })])).toEqual([
      `data/creature/skeleton.json#/audio: creature "skeleton": no audio block; declare ${CREATURE_AUDIO_SLOTS.join(', ')}`,
    ]);
    const partial = { ...AUDIO, hurt: undefined, death: undefined };
    expect(messages([creature({ audio: partial })])).toEqual([
      'data/creature/skeleton.json#/audio/hurt: creature "skeleton": audio slot "hurt" is missing',
      'data/creature/skeleton.json#/audio/death: creature "skeleton": audio slot "death" is missing',
    ]);
  });

  it('AC-1: every shipped creature declares every slot (the game content loads)', () => {
    const creatures = loadGameContent().all('creature');
    expect(creatures.length).toBeGreaterThan(0);
    for (const c of creatures) {
      for (const slot of CREATURE_AUDIO_SLOTS)
        expect(c.audio?.[slot], `${c.id}.${slot}`).toBeDefined();
    }
  });

  it('AC-2: a move whose telegraph leads its first active tick by less than 15 ticks is flagged', () => {
    expect(CREATURE_AUDIO_MIN_LEAD_TICKS).toBe(15);
    const list = [creature({}, ['jab']), attack('jab', 'quick')];
    expect(messages([...list, move('quick', 14)])).toEqual([
      'data/creature/skeleton.json#/attacks/0: creature "skeleton": attack "jab" move "quick" ' +
        'telegraphs 14 ticks before its first active tick; the telegraph cue needs at least 15 (250 ms)',
    ]);
    expect(messages([...list, move('quick', 15)])).toEqual([]);
    // The lead counts from the telegraph tick, so a late telegraph shortens it.
    expect(messages([...list, move('quick', 20, { telegraphTick: 6 })])).toHaveLength(1);
  });

  it('AC-2: every move of a chain is checked; attacks of other creatures and unknown refs are not', () => {
    const entries = [
      creature({}, ['combo', 'ghost']),
      attack('combo', 'one'),
      move('one', 20, { chainNext: { id: 'two' } }),
      move('two', 8),
      move('loop', 8, { chainNext: { id: 'loop' } }),
      attack('other', 'loop'),
    ];
    expect(messages(entries)).toEqual([expect.stringContaining('move "two" telegraphs 8 ticks')]);
  });

  it('an unblockable move or grab needs a distinct unblockable telegraph', () => {
    const unblockable = [
      creature({}, ['slam']),
      attack('slam', 'slam'),
      move('slam', 30, { flags: { unblockable: true } }),
    ];
    expect(messages(unblockable)).toEqual([
      'data/creature/skeleton.json#/audio/unblockableTelegraph: creature "skeleton": has an ' +
        'unblockable move or grab, so it must declare audio.unblockableTelegraph',
    ]);
    const same = creature({ audio: { ...AUDIO, unblockableTelegraph: AUDIO.telegraph } }, ['slam']);
    expect(messages([same, ...unblockable.slice(1)])).toEqual([
      expect.stringContaining('unblockableTelegraph "sfx-t-tele" must differ'),
    ]);
    const good = creature({ audio: { ...AUDIO, unblockableTelegraph: 'sfx-t-heavy' } }, ['slam']);
    expect(messages([good, ...unblockable.slice(1)])).toEqual([]);
    const grab = [
      creature({}, ['seize']),
      attack('seize', 'swing', { kind: 'grab' }),
      move('swing', 30),
    ];
    expect(messages(grab)).toEqual([
      expect.stringContaining('must declare audio.unblockableTelegraph'),
    ]);
    // A creature with no audio block gets only the missing-block issue.
    expect(
      messages([creature({ audio: undefined }, ['slam']), ...unblockable.slice(1)]),
    ).toHaveLength(1);
  });
});
