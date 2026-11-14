// World facts survive a real save and load (mw-e27.1): the world section (v2) carries the snapshot's
// `facts` record; a v1 save, which had none, migrates unchanged; a bad fact never reaches the world.
import { FactTypeError, hashWorld, World, type WorldSnapshot } from '@sim/index';
import { describe, expect, it } from 'vitest';
import {
  decodeSave,
  encodeSave,
  SaveApplyError,
  SaveRegistry,
  SaveSectionInvalidError,
  WORLD_SECTION_ID,
  WORLD_SECTION_VERSION,
} from './index';

const build = { gameVersion: '0.1.0', buildSha: 'deadbee', contentHash: 'c0ffee' };
const options = { build, wallClockSavedAt: 1_790_000_000_000 };

/** A copy of a save with its world section's data and version replaced. */
function rewrite(bytes: Uint8Array, version: number, edit: (data: WorldSnapshot) => unknown) {
  const decoded = decodeSave(bytes);
  if (!decoded.ok) throw decoded.error;
  const { envelope } = decoded;
  const data = edit(envelope.sections[WORLD_SECTION_ID]?.data as WorldSnapshot);
  return encodeSave({
    ...envelope,
    sections: { ...envelope.sections, [WORLD_SECTION_ID]: { version, data } },
  });
}

describe('facts in saves', () => {
  it('a save restores every fact and the state hash', () => {
    const registry = new SaveRegistry();
    const saved = new World({ seed: 4 });
    saved.facts.set('entity:mine/chest-3.looted', true);
    saved.facts.set('quest.missing-miller.stage', 3);
    saved.facts.set('miller.helped-by', 'player');
    saved.step();
    const bytes = registry.write(saved, options);

    const loaded = new World({ seed: 1 });
    loaded.facts.set('stale.fact', 1);
    expect(registry.read(loaded, bytes)).toMatchObject({ ok: true });
    expect(loaded.facts.snapshot()).toEqual(saved.facts.snapshot());
    expect(hashWorld(loaded)).toBe(hashWorld(saved));
  });

  it('a world without facts saves no facts field; a v1 save migrates to v2 unchanged', () => {
    expect(WORLD_SECTION_VERSION).toBe(6);
    const registry = new SaveRegistry();
    const bytes = registry.write(new World({ seed: 4 }), options);
    const decoded = decodeSave(bytes);
    expect(decoded.ok && decoded.envelope.sections[WORLD_SECTION_ID]?.data).not.toHaveProperty(
      'facts',
    );
    const v1 = rewrite(bytes, 1, (data) => data);
    const target = new World({ seed: 8 });
    target.facts.set('a.b', true);
    expect(registry.read(target, v1)).toMatchObject({ ok: true });
    expect(target.facts.size).toBe(0);
    expect(target.seed).toBe(4);
  });

  it('rejects non-primitive facts by schema and wrongly typed facts on apply', () => {
    const registry = new SaveRegistry();
    const bytes = registry.write(new World({ seed: 4 }), options);
    const target = new World({ seed: 9 });
    target.facts.declare('gate.open', { type: 'bool' });
    target.facts.set('gate.open', true);
    const bad = registry.read(
      target,
      rewrite(bytes, 2, (d) => ({ ...d, facts: { 'a.b': [1] } })),
    );
    expect(!bad.ok && bad.error).toBeInstanceOf(SaveSectionInvalidError);
    const wrong = registry.read(
      target,
      rewrite(bytes, 2, (d) => ({ ...d, facts: { 'gate.open': 1 } })),
    );
    expect(!wrong.ok && wrong.error).toBeInstanceOf(SaveApplyError);
    expect(!wrong.ok && (wrong.error as SaveApplyError).cause).toBeInstanceOf(FactTypeError);
    expect(target.facts.snapshot()).toEqual({ 'gate.open': true });
    expect(target.seed).toBe(9);
  });
});
