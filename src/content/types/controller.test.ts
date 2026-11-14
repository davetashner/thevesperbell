import { describe, expect, it } from 'vitest';
import { gameContentSources, loadGameContent } from '../game-content.ts';
import { contentJsonSchema } from '../json-schema.ts';
import { ContentLoadError, loadContent } from '../loader.ts';
import { contentTypes } from '../registry.ts';
import { serializeContent } from '../schema.ts';
import { describeContent } from '../testing.ts';
import {
  MAX_COYOTE_MS,
  MAX_JUMP_BUFFER_MS,
  MOVEMENT_STANCES,
  PLAYER_CLASSES,
  STEALTH_GAITS,
  PLAYER_CONTROLLER_ID,
  controllerOverrideSchema,
  controllerSchema,
  controllerTuningFor,
  controllerTuningSchema,
  mergeControllerTuning,
  tuningOf,
  type ControllerDefInput,
} from './controller.ts';

const valid = {
  id: 'test',
  name: 'Test',
  notes: 'Test profile.',
  capsule: { radius: 0.35, height: 1.8, crouchHeight: 1.0 },
  speeds: { run: 5, sprint: 7.5, crouch: 2.2 },
  accelTime: 0.15,
  decelTime: 0.1,
  airControl: 0.3,
  gravity: 25,
  maxFallSpeed: 40,
  jumpApex: 1.2,
  coyoteMs: 120,
  jumpBufferMs: 150,
  stepHeight: 0.35,
  slopeLimit: 45,
  launch: { airControl: 0.1, recoveryMs: 250, mass: 90 },
} satisfies ControllerDefInput;

const problems = (value: unknown) =>
  (controllerSchema.safeParse(value).error?.issues ?? []).map(
    (i) => `${i.path.join('.')}: ${i.message}`,
  );

describe('controller schema', () => {
  it('accepts the mw-e02.2 starting numbers; the tuning schema is the same without id fields', () => {
    expect(controllerSchema.parse(valid)).toEqual(valid);
    const entryFields = new Set(['id', 'name', 'notes']);
    const tuning = Object.fromEntries(Object.entries(valid).filter(([k]) => !entryFields.has(k)));
    expect(controllerTuningSchema.parse(tuning)).toEqual(tuning);
  });

  it('caps coyote time at 120 ms and the jump buffer at 150 ms, in whole ms', () => {
    expect(MAX_COYOTE_MS).toBe(120);
    expect(MAX_JUMP_BUFFER_MS).toBe(150);
    expect(problems({ ...valid, coyoteMs: 121, jumpBufferMs: 150.5 })).toEqual([
      'coyoteMs: Too big: expected number to be <=120',
      'jumpBufferMs: Invalid input: expected int, received number',
    ]);
  });

  it('rejects out-of-range values with the field path', () => {
    expect(problems({ ...valid, gravity: -9.8, slopeLimit: 90, airControl: 1.5 })).toEqual([
      'airControl: Too big: expected number to be <=1',
      'gravity: Too small: expected number to be >0',
      'slopeLimit: Too big: expected number to be <90',
    ]);
  });

  it('rejects inconsistent capsule, speeds and step height, naming each field', () => {
    expect(
      problems({
        ...valid,
        capsule: { radius: 0.5, height: 0.9, crouchHeight: 0.95 },
        speeds: { run: 5, sprint: 4, crouch: 6 },
        stepHeight: 0.95,
      }),
    ).toEqual([
      'capsule.height: capsule.height (0.9 m) must be at least 2 × radius',
      'capsule.crouchHeight: capsule.crouchHeight (0.95 m) must be between 2 × radius and height',
      'speeds.sprint: speeds.sprint must not be lower than speeds.run',
      'speeds.crouch: speeds.crouch must not be higher than speeds.run',
      'stepHeight: stepHeight must be lower than capsule.crouchHeight',
    ]);
    expect(
      problems({ ...valid, capsule: { radius: 0.35, height: 1.8, crouchHeight: 0.5 } }),
    ).toEqual([
      'capsule.crouchHeight: capsule.crouchHeight (0.5 m) must be between 2 × radius and height',
    ]);
  });

  it('mw-e02.6: takes optional gait thresholds, landing and footstep spacing; run above walk', () => {
    const gait = {
      walkFrom: 0.2,
      runFrom: 2.5,
      landingMs: 150,
      hardLanding: 6,
      footstep: { walk: 0.7, run: 1, sprint: 1.25, crouch: 0.5 },
    };
    expect(controllerSchema.parse({ ...valid, gait }).gait).toEqual(gait);
    expect(problems({ ...valid, gait: { ...gait, runFrom: 0.2 } })).toEqual([
      'gait.runFrom: gait.runFrom must be higher than gait.walkFrom',
    ]);
    expect(problems({ ...valid, gait: { ...gait, landingMs: 1.5 } })).toEqual([
      'gait.landingMs: Invalid input: expected int, received number',
    ]);
  });

  it('AC-4: the shipped stance profile table defines every stance × gait, normalised to 0–1', () => {
    const { stealth } = controllerTuningFor(
      loadGameContent().get('controller', PLAYER_CONTROLLER_ID),
    );
    if (stealth === undefined) throw new Error('the player profile states its stealth block');
    const cells = MOVEMENT_STANCES.flatMap((stance) =>
      STEALTH_GAITS.map((gait) => ({ stance, gait, ...stealth.profiles[stance][gait] })),
    );
    expect(cells).toHaveLength(MOVEMENT_STANCES.length * STEALTH_GAITS.length);
    for (const { noise, visibility } of cells) {
      expect(noise).toBeGreaterThanOrEqual(0);
      expect(noise).toBeLessThanOrEqual(1);
      expect(visibility).toBeGreaterThanOrEqual(0);
      expect(visibility).toBeLessThanOrEqual(1);
    }
    // The bead's default noise multipliers.
    const noise = (stance: 'standing' | 'crouched', gait: (typeof STEALTH_GAITS)[number]) =>
      stealth.profiles[stance][gait].noise;
    expect([
      noise('standing', 'sprint'),
      noise('standing', 'run'),
      noise('standing', 'walk'),
    ]).toEqual([1, 0.6, 0.3]);
    expect([noise('crouched', 'walk'), noise('standing', 'slowWalk')]).toEqual([0.15, 0.08]);
    expect([noise('standing', 'still'), noise('crouched', 'still')]).toEqual([0, 0]);
  });

  it('AC-4: a stance profile table missing a stance × gait combination fails validation', () => {
    const row = {
      still: { noise: 0, visibility: 0.8 },
      slowWalk: { noise: 0.08, visibility: 0.85 },
      walk: { noise: 0.3, visibility: 0.9 },
      run: { noise: 0.6, visibility: 1 },
      sprint: { noise: 1, visibility: 1 },
    };
    const stealth = {
      slowWalk: { speed: 1.2, deflection: 0.3 },
      profiles: { standing: row, crouched: row },
    };
    expect(controllerSchema.parse({ ...valid, stealth }).stealth).toEqual(stealth);
    const noRun: Partial<typeof row> = { ...row };
    delete noRun.run;
    expect(
      problems({ ...valid, stealth: { ...stealth, profiles: { standing: row, crouched: noRun } } }),
    ).toEqual([
      'stealth.profiles.crouched.run: Invalid input: expected object, received undefined',
    ]);
    expect(problems({ ...valid, stealth: { ...stealth, profiles: { standing: row } } })).toEqual([
      'stealth.profiles.crouched: Invalid input: expected object, received undefined',
    ]);
    expect(
      problems({
        ...valid,
        stealth: {
          ...stealth,
          profiles: { standing: { ...row, run: { noise: 1.2 } }, crouched: row },
        },
      }),
    ).toEqual([
      'stealth.profiles.standing.run.noise: Too big: expected number to be <=1',
      'stealth.profiles.standing.run.visibility: Invalid input: expected number, received undefined',
    ]);
    expect(
      problems({ ...valid, stealth: { ...stealth, slowWalk: { speed: 2.5, deflection: 0.3 } } }),
    ).toEqual([
      'stealth.slowWalk.speed: stealth.slowWalk.speed must not be higher than speeds.crouch',
    ]);
    // A class may change single cells; the rest come from the base.
    const def = controllerSchema.parse({
      ...valid,
      stealth,
      classes: { thief: { stealth: { profiles: { crouched: { walk: { noise: 0.1 } } } } } },
    });
    const thief = controllerTuningFor(def, 'thief').stealth;
    expect(thief?.profiles.crouched.walk).toEqual({ noise: 0.1, visibility: 0.9 });
    expect(thief?.profiles.standing).toEqual(row);
  });

  it('mw-e02.11: stealth.surfaces holds the wet and frozen footstep modifiers, merged per class', () => {
    const row = {
      still: { noise: 0, visibility: 0.8 },
      slowWalk: { noise: 0.08, visibility: 0.85 },
      walk: { noise: 0.3, visibility: 0.9 },
      run: { noise: 0.6, visibility: 1 },
      sprint: { noise: 1, visibility: 1 },
    };
    const surfaces = { wetFrom: 0.5, wetDb: 3, frozenDb: 2 };
    const stealth = {
      slowWalk: { speed: 1.2, deflection: 0.3 },
      profiles: { standing: row, crouched: row },
      surfaces,
    };
    expect(controllerSchema.parse({ ...valid, stealth }).stealth?.surfaces).toEqual(surfaces);
    expect(
      problems({ ...valid, stealth: { ...stealth, surfaces: { ...surfaces, wetFrom: 2 } } }),
    ).toEqual(['stealth.surfaces.wetFrom: Too big: expected number to be <=1']);
    const def = controllerSchema.parse({
      ...valid,
      stealth,
      classes: { thief: { stealth: { surfaces: { wetDb: 1 } } } },
    });
    expect(controllerTuningFor(def, 'thief').stealth?.surfaces).toEqual({ ...surfaces, wetDb: 1 });
  });

  it('mw-e02.12: takes optional ledge tuning; heights ordered from auto-mantle to hang reach', () => {
    const ledge = {
      autoMantleHeight: 1,
      mantleHeight: 1.6,
      hangReach: 2.2,
      hangDepth: 2,
      reach: 1,
      grabReach: 0.3,
      maxTopSlope: 20,
      autoMantleMs: 400,
      mantleMs: 600,
      pullUpMs: 700,
      grabMs: 250,
      lowerMs: 500,
      shimmySpeed: 1,
      shimmyGap: 0.3,
      slipGraceMs: 1000,
      jumpBack: { away: 4, up: 6 },
    };
    expect(controllerSchema.parse({ ...valid, ledge }).ledge).toEqual(ledge);
    expect(
      problems({
        ...valid,
        ledge: { ...ledge, autoMantleHeight: 0.3, mantleHeight: 0.2, hangReach: 0.1, hangDepth: 1 },
      }),
    ).toEqual([
      'ledge.autoMantleHeight: ledge.autoMantleHeight must be higher than stepHeight',
      'ledge.mantleHeight: ledge.mantleHeight must not be lower than autoMantleHeight',
      'ledge.hangReach: ledge.hangReach must not be lower than mantleHeight',
      'ledge.hangDepth: ledge.hangDepth must not be higher than hangReach',
    ]);
    expect(problems({ ...valid, ledge: { ...ledge, mantleMs: 0.5 } })).toEqual([
      'ledge.mantleMs: Invalid input: expected int, received number',
    ]);
  });
});

/** A numeric JSON Schema node, with the path that reaches it. */
interface NumberField {
  readonly path: string;
  readonly node: Readonly<Record<string, unknown>>;
}

/** Every number and integer field of a JSON Schema, with its dotted path (`*` for a map's values). */
function numberFields(node: unknown, path: readonly string[] = []): NumberField[] {
  if (typeof node !== 'object' || node === null) return [];
  const n = node as Readonly<Record<string, unknown>>;
  if (n['type'] === 'number' || n['type'] === 'integer') return [{ path: path.join('.'), node: n }];
  const properties = (n['properties'] ?? {}) as Readonly<Record<string, unknown>>;
  return [
    ...Object.entries(properties).flatMap(([key, child]) => numberFields(child, [...path, key])),
    ...numberFields(n['additionalProperties'], [...path, '*']),
  ];
}

/** How a description declares its unit: `…, m.`, `…, m/s;`, `…, whole ms (≤ 120)`, `…, 0–1;`… */
const UNIT = /[,:;] (?:whole ms|m\/s²|m\/s|m|s|kg|degrees|dB|0–1|stamina\/s|points)(?=[.;:,) ]|$)/;

describe('controller data (mw-e02.3)', () => {
  const fields = numberFields(contentJsonSchema(controllerSchema));

  it('AC-1: every numeric field declares its unit and its range', () => {
    expect(fields.length).toBeGreaterThan(100); // base fields and the class overrides' copies
    const missing = fields.flatMap(({ path, node }) => {
      const low = node['minimum'] ?? node['exclusiveMinimum'];
      const high = node['maximum'] ?? node['exclusiveMaximum'];
      const description = typeof node['description'] === 'string' ? node['description'] : '';
      return [
        ...(UNIT.test(description) ? [] : [`${path}: no unit in "${description}"`]),
        ...(typeof low === 'number' && typeof high === 'number' ? [] : [`${path}: no range`]),
      ];
    });
    expect(missing).toEqual([]);
  });

  it('AC-1: the default player file passes, with every class merged over it', () => {
    const content = loadGameContent();
    const player = content.get('controller', PLAYER_CONTROLLER_ID);
    expect(controllerTuningSchema.parse(controllerTuningFor(player))).toEqual(tuningOf(player));
    for (const playerClass of PLAYER_CLASSES) {
      expect(() =>
        controllerTuningSchema.parse(controllerTuningFor(player, playerClass)),
      ).not.toThrow();
    }
  });

  it('AC-2: a class override that sets only crouchSpeed takes every other value from the base', () => {
    const def = controllerSchema.parse({
      ...valid,
      gait: {
        walkFrom: 0.2,
        runFrom: 2.5,
        landingMs: 150,
        hardLanding: 6,
        footstep: { walk: 0.7, run: 1, sprint: 1.25, crouch: 0.5 },
      },
      classes: { thief: { speeds: { crouch: 2.6 } } },
    });
    const thief = controllerTuningFor(def, 'thief');
    const base = controllerTuningFor(def);
    expect(thief).toEqual({ ...base, speeds: { ...base.speeds, crouch: 2.6 } });
    expect(thief.speeds.run).toBe(5);
    expect(thief.speeds.sprint).toBe(7.5);
    // Classes without an override, and no class, move on the base profile alone.
    expect(controllerTuningFor(def, 'knight')).toEqual(base);
    expect(Object.keys(thief)).not.toContain('classes');
    expect(Object.isFrozen(thief.speeds)).toBe(true);
    // Nested objects merge field by field; lists are replaced whole.
    expect(
      mergeControllerTuning(base, { gait: { footstep: { crouch: 0.4 } }, launch: { mass: 70 } }),
    ).toEqual({
      ...base,
      gait: { ...base.gait, footstep: { ...base.gait?.footstep, crouch: 0.4 } },
      launch: { ...base.launch, mass: 70 },
    });
  });

  it('AC-2: an override names only tuning fields, each within its own bounds', () => {
    expect(controllerOverrideSchema.parse({ speeds: { crouch: 2.6 } })).toEqual({
      speeds: { crouch: 2.6 },
    });
    expect(controllerOverrideSchema.safeParse({ speeds: { crawl: 1 } }).success).toBe(false);
    expect(controllerOverrideSchema.safeParse({ speeds: { crouch: -1 } }).success).toBe(false);
    expect(problems({ ...valid, classes: { bard: {} } })).toHaveLength(1);
    // A section the base leaves to the sim's defaults must then be given whole.
    expect(problems({ ...valid, classes: { thief: { gait: { walkFrom: 0.3 } } } })).toContain(
      'classes.thief.gait.runFrom: with the thief override: Invalid input: expected number, received undefined',
    );
  });

  it('AC-3: negative gravity fails the load with the field path in the error', () => {
    const player = gameContentSources().find((s) => s.path.endsWith('controller/player.json'));
    if (player === undefined) throw new Error('no player controller file');
    const json = JSON.parse(player.text) as Record<string, unknown>;
    const load = (value: unknown) => () =>
      loadContent(contentTypes, [{ path: player.path, text: JSON.stringify(value) }]);
    expect(load({ ...json, gravity: -9.8 })).toThrow(ContentLoadError);
    expect(load({ ...json, gravity: -9.8 })).toThrow(
      /controller\/player\.json#\/gravity: Too small: expected number to be >0/,
    );
    // In a class override, the error names the class and the field.
    expect(load({ ...json, classes: { thief: { gravity: -9.8 } } })).toThrow(
      /#\/classes\/thief\/gravity: Too small: expected number to be >0/,
    );
    // An override within bounds that breaks the merged profile names the class and the field.
    expect(problems({ ...valid, classes: { thief: { speeds: { crouch: 6 } } } })).toEqual([
      'classes.thief.speeds.crouch: with the thief override: speeds.crouch must not be higher than speeds.run',
    ]);
  });
});

describeContent(
  'controller',
  'AC-1: is valid and round-trips; the player profile exists',
  (entry, content) => {
    expect(controllerSchema.parse(JSON.parse(serializeContent(entry)))).toEqual(entry);
    expect(content.has('controller', PLAYER_CONTROLLER_ID)).toBe(true);
  },
);
