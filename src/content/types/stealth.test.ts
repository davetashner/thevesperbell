import { describe, expect, it } from 'vitest';
import { serializeContent } from '../schema.ts';
import { describeContent } from '../testing.ts';
import {
  MAX_NOISE_LOSS_DB,
  MAX_STEALTH_WEIGHT,
  STEALTH_ID,
  stealthSchema,
  type StealthDefInput,
} from './stealth.ts';

const valid = {
  id: 'test-stealth',
  notes: 'A table for tests.',
  visibility: {
    light: {
      curve: [
        { level: 0, term: 0 },
        { level: 1, term: 1 },
      ],
      peakWeight: 0.5,
    },
    stance: { prone: 0.25, crouched: 0.5, standing: 1 },
    motion: [
      { fromSpeed: 0, term: 0.8 },
      { fromSpeed: 2.5, term: 1 },
    ],
    profile: { cloak: 0.7, disguise: 0.8 },
    distance: [
      { metres: 0, term: 1 },
      { metres: 20, term: 0.5 },
    ],
    contrast: { backgroundThreshold: 0.7, darkTargetMax: 0.2, bonus: 0.3 },
  },
  noise: {
    audibleFloor: 10,
    doors: {
      open: 0,
      ajar: -6,
      closed: -20,
      materials: [{ material: 'iron', closed: -25 }],
    },
    partitions: {
      wall: -30,
      floor: -25,
      materials: [{ material: 'wood', floor: -15 }],
    },
    impact: { minEnergy: 1, refEnergy: 10, refDb: 60, dbPerDecade: 10, maxDb: 100 },
  },
} satisfies StealthDefInput;

type Visibility = typeof valid.visibility;
const withVisibility = (patch: Partial<Record<keyof Visibility, unknown>>) => ({
  ...valid,
  visibility: { ...valid.visibility, ...patch },
});

const problems = (value: unknown) =>
  (stealthSchema.safeParse(value).error?.issues ?? []).map(
    (i) => `${i.path.join('.')}: ${i.message}`,
  );

/** Every weight in the table, as a path and a way to set it. */
const WEIGHTS: readonly [string, (w: number) => unknown][] = [
  [
    'visibility.light.curve.1.term',
    (w) =>
      withVisibility({
        light: {
          ...valid.visibility.light,
          curve: [valid.visibility.light.curve[0], { level: 1, term: w }],
        },
      }),
  ],
  [
    'visibility.stance.prone',
    (w) => withVisibility({ stance: { ...valid.visibility.stance, prone: w } }),
  ],
  [
    'visibility.stance.crouched',
    (w) => withVisibility({ stance: { ...valid.visibility.stance, crouched: w } }),
  ],
  [
    'visibility.stance.standing',
    (w) => withVisibility({ stance: { ...valid.visibility.stance, standing: w } }),
  ],
  [
    'visibility.motion.1.term',
    (w) => withVisibility({ motion: [valid.visibility.motion[0], { fromSpeed: 2.5, term: w }] }),
  ],
  [
    'visibility.profile.cloak',
    (w) => withVisibility({ profile: { ...valid.visibility.profile, cloak: w } }),
  ],
  [
    'visibility.profile.disguise',
    (w) => withVisibility({ profile: { ...valid.visibility.profile, disguise: w } }),
  ],
  [
    'visibility.distance.0.term',
    (w) =>
      withVisibility({
        distance: [
          { metres: 0, term: w },
          { metres: 20, term: 0 },
        ],
      }),
  ],
  [
    'visibility.contrast.bonus',
    (w) => withVisibility({ contrast: { ...valid.visibility.contrast, bonus: w } }),
  ],
];

describe('stealth schema (mw-e09.2)', () => {
  it('accepts a table', () => {
    expect(stealthSchema.parse(valid)).toEqual(valid);
  });

  it('AC-7: a weight outside 0–2 fails validation, naming it; 0 and 2 pass', () => {
    for (const [path, set] of WEIGHTS) {
      expect(problems(set(0)), path).toEqual([]);
      expect(problems(set(MAX_STEALTH_WEIGHT)), path).toEqual([]);
      expect(problems(set(2.01)), path).toEqual([
        `${path}: Too big: expected number to be <=${String(MAX_STEALTH_WEIGHT)}`,
      ]);
      expect(problems(set(-0.01)), path).toEqual([`${path}: Too small: expected number to be >=0`]);
    }
  });

  it('rejects levels outside 0–1 and unknown or missing fields', () => {
    expect(
      problems(withVisibility({ light: { ...valid.visibility.light, peakWeight: 1.5 } })),
    ).toEqual(['visibility.light.peakWeight: Too big: expected number to be <=1']);
    const contrast = { ...valid.visibility.contrast, backgroundThreshold: -1 };
    expect(problems(withVisibility({ contrast }))).toHaveLength(1);
    expect(problems(withVisibility({ stance: { crouched: 0.5, standing: 1 } }))).toHaveLength(1);
    expect(problems({ ...valid, extra: 1 })).toHaveLength(1);
  });

  it('checks the curves and bands are in order and cover their range', () => {
    const light = (curve: { level: number; term: number }[]) =>
      problems(withVisibility({ light: { ...valid.visibility.light, curve } }));
    expect(
      light([
        { level: 0.1, term: 0 },
        { level: 1, term: 1 },
      ]),
    ).toEqual(['visibility.light.curve: light.curve must start at level 0 and end at level 1']);
    expect(
      light([
        { level: 0, term: 0 },
        { level: 0.9, term: 1 },
      ]),
    ).toEqual(['visibility.light.curve: light.curve must start at level 0 and end at level 1']);
    expect(
      light([
        { level: 0, term: 0 },
        { level: 0.5, term: 0.4 },
        { level: 0.5, term: 0.6 },
        { level: 1, term: 1 },
      ]),
    ).toEqual(['visibility.light.curve.2.level: light.curve levels must rise']);

    const motion = (bands: { fromSpeed: number; term: number }[]) =>
      problems(withVisibility({ motion: bands }));
    expect(motion([{ fromSpeed: 1, term: 1 }])).toEqual([
      'visibility.motion.0.fromSpeed: the first motion band must start at 0 m/s',
    ]);
    expect(
      motion([
        { fromSpeed: 0, term: 1 },
        { fromSpeed: 0, term: 1 },
      ]),
    ).toEqual(['visibility.motion.1.fromSpeed: motion bands must start at rising speeds']);

    const distance = (points: { metres: number; term: number }[]) =>
      problems(withVisibility({ distance: points }));
    expect(
      distance([
        { metres: 1, term: 1 },
        { metres: 2, term: 1 },
      ]),
    ).toEqual(['visibility.distance.0.metres: the distance curve must start at 0 m']);
    expect(
      distance([
        { metres: 0, term: 1 },
        { metres: 0, term: 1 },
      ]),
    ).toEqual(['visibility.distance.1.metres: distance points must rise']);
    expect(
      distance([
        { metres: 0, term: 0.5 },
        { metres: 10, term: 0.6 },
      ]),
    ).toEqual(['visibility.distance.1.term: distance falloff must never rise with distance']);
    // Field errors come first: order checks only run on a table whose fields are valid.
    expect(
      distance([
        { metres: -1, term: 1 },
        { metres: -2, term: 1 },
      ]),
    ).toHaveLength(2);
  });
});

type Noise = typeof valid.noise;
const withNoise = (patch: Partial<Record<keyof Noise, unknown>>) => ({
  ...valid,
  noise: { ...valid.noise, ...patch },
});

describe('stealth noise tuning (mw-e09.3)', () => {
  it('gains are dB at or below 0, down to the most a loss may take off', () => {
    const door = (closed: number) =>
      problems(withNoise({ doors: { ...valid.noise.doors, closed } }));
    expect(door(-MAX_NOISE_LOSS_DB)).toEqual([]);
    expect(door(-MAX_NOISE_LOSS_DB - 1)).toHaveLength(1);
    const wall = (w: number) =>
      problems(withNoise({ partitions: { ...valid.noise.partitions, wall: w } }));
    expect(wall(0)).toEqual([]);
    expect(wall(1)).toEqual(['noise.partitions.wall: Too big: expected number to be <=0']);
    expect(problems(withNoise({ audibleFloor: -1 }))).toHaveLength(1);
  });

  it('door gains never rise from open to ajar to closed, defaults or per material', () => {
    expect(
      problems(withNoise({ doors: { ...valid.noise.doors, open: -10, materials: [] } })),
    ).toEqual(['noise.doors: door gains must never rise from open to ajar to closed']);
    expect(problems(withNoise({ doors: { ...valid.noise.doors, closed: -3 } }))).toEqual([
      'noise.doors: door gains must never rise from open to ajar to closed',
    ]);
    const materials = [{ material: 'iron', ajar: -30 }];
    expect(problems(withNoise({ doors: { ...valid.noise.doors, materials } }))).toEqual([
      'noise.doors.materials.0: door gains must never rise from open to ajar to closed',
    ]);
  });

  it('mw-e03.25: the impact curve needs its minimum energy at or below its reference energy', () => {
    const impact = { ...valid.noise.impact, minEnergy: 20 };
    expect(problems(withNoise({ impact }))).toEqual([
      'noise.impact.minEnergy: minEnergy must not exceed refEnergy',
    ]);
    expect(problems(withNoise({ impact: { ...valid.noise.impact, minEnergy: 10 } }))).toEqual([]);
  });

  it('names a material listed twice', () => {
    const doors = { ...valid.noise.doors, materials: [{ material: 'iron' }, { material: 'iron' }] };
    expect(problems(withNoise({ doors }))).toEqual([
      'noise.doors.materials.1.material: material "iron" is listed twice',
    ]);
    const partitions = {
      ...valid.noise.partitions,
      materials: [{ material: 'wood' }, { material: 'wood', wall: -10 }],
    };
    expect(problems(withNoise({ partitions }))).toEqual([
      'noise.partitions.materials.1.material: material "wood" is listed twice',
    ]);
  });

  it('material lists default to empty', () => {
    const doors = { open: 0, ajar: -6, closed: -20 };
    const partitions = { wall: -30, floor: -25 };
    const parsed = stealthSchema.parse(withNoise({ doors, partitions }));
    expect(parsed.noise.doors.materials).toEqual([]);
    expect(parsed.noise.partitions.materials).toEqual([]);
  });
});

describeContent('stealth', 'AC-7: is valid with every weight in 0–2 and round-trips', (table) => {
  expect(stealthSchema.parse(JSON.parse(serializeContent(table)))).toEqual(table);
  const weights = [
    ...table.visibility.light.curve.map((p) => p.term),
    ...Object.values(table.visibility.stance),
    ...table.visibility.motion.map((b) => b.term),
    ...Object.values(table.visibility.profile),
    ...table.visibility.distance.map((p) => p.term),
    table.visibility.contrast.bonus,
  ];
  for (const w of weights) expect(w >= 0 && w <= MAX_STEALTH_WEIGHT).toBe(true);
});

describeContent('stealth', 'the game table is flagged placeholder tuning', (table) => {
  if (table.id !== STEALTH_ID) return;
  expect(table.notes).toMatch(/PLACEHOLDER/);
});
