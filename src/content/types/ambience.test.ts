import { describe, expect, it } from 'vitest';
import { serializeContent } from '../schema.ts';
import { loadGameContent } from '../game-content.ts';
import { describeContent } from '../testing.ts';
import { AMBIENCE_CROSSFADE_S, ambienceSchema, type AmbienceDefInput } from './ambience.ts';
import { sceneSchema } from './scene.ts';

const oneShot = {
  cue: 'amb-drip',
  minIntervalS: 4,
  maxIntervalS: 9,
  minRadius: 10,
  maxRadius: 25,
};
const valid = {
  id: 'test-zone',
  notes: 'A zone for tests.',
  bed: { cue: 'amb-test' },
  oneShots: [oneShot],
} satisfies AmbienceDefInput;

const problems = (value: unknown) =>
  (ambienceSchema.safeParse(value).error?.issues ?? []).map(
    (i) => `${i.path.join('.')}: ${i.message}`,
  );

describe('ambience schema (mw-e28.13)', () => {
  it('accepts a zone and defaults trims and height', () => {
    const zone = ambienceSchema.parse(valid);
    expect(zone.bed?.gainDb).toBe(0);
    expect(zone.oneShots[0]).toMatchObject({ height: 0, gainDb: 0 });
    expect(ambienceSchema.parse({ id: 'quiet', notes: 'n' }).oneShots).toEqual([]);
    expect(AMBIENCE_CROSSFADE_S).toBe(2);
  });

  it('rejects intervals and radii the wrong way round, and unknown fields', () => {
    const bad = (patch: object) => ({ ...valid, oneShots: [{ ...oneShot, ...patch }] });
    expect(problems(bad({ minIntervalS: 10 }))).toEqual([
      'oneShots.0.maxIntervalS: maxIntervalS must not be below minIntervalS',
    ]);
    expect(problems(bad({ minRadius: 25 }))).toEqual([
      'oneShots.0.maxRadius: maxRadius must be above minRadius',
    ]);
    expect(problems(bad({ minIntervalS: 0 }))).not.toEqual([]);
    expect(problems({ ...valid, extra: 1 })).not.toEqual([]);
  });

  it('a scene must place a zone over a region it has', () => {
    const base = {
      id: 'test-scene',
      name: 'Test',
      camera: { position: [0, 1, 0], target: [0, 0, 0] },
      placements: [{ piece: 'floor', at: [0, 0, 0] }],
    };
    const scene = (ambience: unknown[]) =>
      sceneSchema.safeParse({
        ...base,
        regions: [{ id: 'cave', min: [0, 0, 0], max: [1, 1, 1] }],
        ambience,
      });
    expect(scene([{ zone: 'a', region: 'cave' }, { zone: 'b' }]).success).toBe(true);
    const failed = scene([{ zone: 'a', region: 'nowhere' }]);
    expect(failed.error?.issues[0]?.message).toMatch(/names region "nowhere"/);
  });

  it('the slice places the slice-gallery zone over the whole scene', () => {
    const scene = loadGameContent().get('scene', 'slice');
    expect(scene.ambience.map((a) => [a.zone.id, a.region])).toEqual([
      ['slice-gallery', undefined],
    ]);
  });
});

describeContent('ambience', 'is valid and round-trips', (zone) => {
  expect(ambienceSchema.parse(JSON.parse(serializeContent(zone)))).toEqual(zone);
});
