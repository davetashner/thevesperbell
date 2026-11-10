// Difficulty multipliers survive a real save and load (mw-e31.14 AC-4): the world section carries the
// snapshot's sparse `difficulty` overrides, and a bad value never reaches the world.
import { DifficultyConfigError, hashWorld, World, type WorldSnapshot } from '@sim/index';
import { describe, expect, it } from 'vitest';
import {
  decodeSave,
  encodeSave,
  SaveApplyError,
  SaveRegistry,
  SaveSectionInvalidError,
  WORLD_SECTION_ID,
  type SaveEnvelope,
} from './index';

const build = { gameVersion: '0.1.0', buildSha: 'deadbee', contentHash: 'c0ffee' };
const options = { build, wallClockSavedAt: 1_790_000_000_000 };

/** A copy of a save whose world section's difficulty is replaced. */
function withDifficulty(bytes: Uint8Array, difficulty: unknown): Uint8Array {
  const decoded = decodeSave(bytes);
  if (!decoded.ok) throw decoded.error;
  const envelope: SaveEnvelope = decoded.envelope;
  const record = envelope.sections[WORLD_SECTION_ID];
  const data = { ...(record?.data as WorldSnapshot), difficulty };
  return encodeSave({
    ...envelope,
    sections: { ...envelope.sections, [WORLD_SECTION_ID]: { version: 1, data } },
  });
}

describe('difficulty in saves', () => {
  it('AC-4: a save made with detectionSpeed 0.5 loads into a sim that reads 0.5', () => {
    const registry = new SaveRegistry();
    const saved = new World({ seed: 4, difficulty: { detectionSpeed: 0.5 } });
    saved.step();
    const bytes = registry.write(saved, options);

    const loaded = new World({ seed: 1 });
    expect(registry.read(loaded, bytes)).toMatchObject({ ok: true });
    expect(loaded.difficulty.detectionSpeed).toBe(0.5);
    expect(hashWorld(loaded)).toBe(hashWorld(saved));
    let seen = 0;
    loaded.addSystem({ name: 'probe', run: (ctx) => (seen = ctx.difficulty.detectionSpeed) });
    loaded.step();
    expect(seen).toBe(0.5);
  });

  it('a neutral world saves no difficulty field; loading it resets a tuned world to neutral', () => {
    const registry = new SaveRegistry();
    const bytes = registry.write(new World({ seed: 4 }), options);
    const decoded = decodeSave(bytes);
    expect(decoded.ok && decoded.envelope.sections[WORLD_SECTION_ID]?.data).not.toHaveProperty(
      'difficulty',
    );
    const tuned = new World({ seed: 4, difficulty: { damageTaken: 2 } });
    expect(registry.read(tuned, bytes)).toMatchObject({ ok: true });
    expect(tuned.difficulty.damageTaken).toBe(1);
  });

  it('rejects unknown multipliers and non-numbers by schema, out-of-range values on apply', () => {
    const registry = new SaveRegistry();
    const bytes = registry.write(new World({ seed: 4 }), options);
    const target = new World({ seed: 9, difficulty: { fallDamage: 0 } });
    for (const bad of [{ bogus: 1 }, { damageTaken: '2' }]) {
      const result = registry.read(target, withDifficulty(bytes, bad));
      expect(result).toMatchObject({ ok: false });
      expect(!result.ok && result.error).toBeInstanceOf(SaveSectionInvalidError);
    }
    const result = registry.read(target, withDifficulty(bytes, { parryWindow: 10 }));
    expect(!result.ok && result.error).toBeInstanceOf(SaveApplyError);
    expect(!result.ok && (result.error as SaveApplyError).cause).toBeInstanceOf(
      DifficultyConfigError,
    );
    expect(target.seed).toBe(9);
    expect(target.difficulty.fallDamage).toBe(0);
  });

  it('mw-e31.10: a v5 save, from before the search-duration multiplier, loads with it neutral', () => {
    const registry = new SaveRegistry();
    const bytes = registry.write(new World({ seed: 4 }), options);
    const decoded = decodeSave(bytes);
    if (!decoded.ok) throw decoded.error;
    const record = decoded.envelope.sections[WORLD_SECTION_ID];
    const data = { ...(record?.data as WorldSnapshot), difficulty: { damageTaken: 0.5 } };
    const v5 = encodeSave({
      ...decoded.envelope,
      sections: { ...decoded.envelope.sections, [WORLD_SECTION_ID]: { version: 5, data } },
    });
    const loaded = new World({ seed: 1 });
    expect(registry.read(loaded, v5)).toMatchObject({ ok: true });
    expect(loaded.difficulty).toMatchObject({ damageTaken: 0.5, searchDuration: 1 });
  });
});
