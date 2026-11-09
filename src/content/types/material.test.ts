import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { loadGameContent } from '../game-content.ts';
import { ContentLoadError, loadContent, type ContentIssue } from '../loader.ts';
import { contentTypes } from '../registry.ts';
import { contentId, serializeContent } from '../schema.ts';
import { describeContent } from '../testing.ts';
import { worldPropertiesSchema } from '../world-properties.ts';
import {
  BURNT_DESTROYED,
  burntMaterials,
  materialLoudness,
  IMPACT_SOUND_PATTERN,
  materialPresets,
  materialSchema,
  type MaterialDefInput,
} from './material.ts';

/** Every material the bead asks for, plus the default id and the canon glenstone. */
const REQUIRED_MATERIALS = [
  'bone',
  'charred',
  'cloth',
  'copper',
  'dry-wood',
  'earth',
  'flesh',
  'generic',
  'glass',
  'glenstone',
  'ice',
  'iron',
  'ivy',
  'oil',
  'paper',
  'rope',
  'stone',
  'straw',
  'water',
  'wood',
];

/** The properties every preset must declare (mw-e03.31). */
const SURFACE = { surfaceHardness: 'medium', softAnchor: false } as const;

const base = {
  id: 'fixture',
  name: 'Fixture',
  notes: 'Test material.',
  footstepLoudness: 0,
  impactSound: 'sfx-impact-wood',
  properties: SURFACE,
} satisfies MaterialDefInput;

/** Messages (with their paths) for a preset with `properties`, or [] when it is valid. */
function problems(properties: Record<string, unknown>, burnt?: string): string[] {
  const extra = burnt === undefined ? {} : { burnt };
  const result = materialSchema.safeParse({
    ...base,
    ...extra,
    properties: { ...SURFACE, ...properties },
  });
  return result.success ? [] : result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
}

describeContent('material', 'AC-1: passes the schema and consistency checks', (entry) => {
  // The loader already validated it; a round trip through the data-file form must too.
  const again = materialSchema.parse(JSON.parse(serializeContent(entry)));
  expect(again).toEqual(entry);
  expect(entry.impactSound).toMatch(IMPACT_SOUND_PATTERN);
  expect(entry.notes.length).toBeGreaterThan(40); // a real explanation of the numbers
  const { flammable, ignitionPoint, fuel } = entry.properties;
  expect(
    flammable === true
      ? [ignitionPoint !== undefined, (fuel ?? 0) > 0, entry.burnt !== undefined]
      : [true, true, entry.burnt === undefined],
  ).toEqual([true, true, true]);
});

describe('material presets', () => {
  it('AC-1: every required material exists', () => {
    const ids = loadGameContent()
      .all('material')
      .map((m) => m.id);
    expect(ids).toEqual(REQUIRED_MATERIALS);
  });

  it('AC-1: flammable without an ignitionPoint or fuel is rejected', () => {
    expect(problems({ flammable: true }, 'destroyed')).toEqual([
      'properties.ignitionPoint: a flammable material needs an ignitionPoint',
      'properties.fuel: a flammable material needs fuel > 0',
    ]);
    expect(problems({ flammable: true, ignitionPoint: 300, fuel: 0 }, 'destroyed')).toEqual([
      'properties.fuel: a flammable material needs fuel > 0',
    ]);
    expect(problems({ flammable: true, ignitionPoint: 300, fuel: 60 }, 'destroyed')).toEqual([]);
  });

  it('mw-e03.5: a flammable material says what it burns to; nothing else may', () => {
    const fuelled = { flammable: true, ignitionPoint: 300, fuel: 60 };
    expect(problems(fuelled)).toEqual(['burnt: a flammable material needs a burnt state']);
    expect(problems({}, 'destroyed')).toEqual([
      'burnt: only a flammable material has a burnt state',
    ]);
    expect(problems(fuelled, 'Ash')).toEqual([expect.stringContaining('burnt')]);
    expect(problems(fuelled, 'charred')).toEqual([]);
  });

  it('mw-e03.5: a burnt state naming a missing material fails with the file and pointer', () => {
    const sources = [
      {
        path: 'data/material/wood.json',
        text: JSON.stringify({
          ...base,
          id: 'wood',
          burnt: 'ash',
          properties: { ...SURFACE, flammable: true, ignitionPoint: 300, fuel: 60 },
        }),
      },
    ];
    let issues: readonly ContentIssue[] = [];
    try {
      loadContent(contentTypes, sources);
    } catch (error) {
      issues = (error as ContentLoadError).issues;
    }
    expect(issues).toEqual([
      {
        file: 'data/material/wood.json',
        pointer: '/burnt',
        message: 'material:wood references missing material:ash',
      },
    ]);
  });

  it('mw-e03.25: materialLoudness maps each material to its surface loudness offset', () => {
    const loud = materialLoudness(loadGameContent().all('material'));
    expect(loud.get('stone')).toBe(0);
    expect(loud.get('glass')).toBe(12);
    expect(loud.get('cloth')).toBe(-8);
    expect(loud.size).toBe(loadGameContent().all('material').length);
  });

  it('mw-e03.5: burntMaterials maps flammable materials to what they become (null = burns away)', () => {
    const burnt = burntMaterials(loadGameContent().all('material'));
    expect(Object.fromEntries(burnt)).toEqual({
      cloth: null,
      'dry-wood': 'charred',
      ivy: null,
      oil: null,
      paper: null,
      rope: null,
      straw: null,
      wood: 'charred',
    });
    expect(BURNT_DESTROYED).toBe('destroyed');
  });

  it('AC-1: ignitionPoint or fuel on a non-flammable material is rejected', () => {
    const message =
      'properties.flammable: ignitionPoint and fuel only apply to a flammable material';
    expect(problems({ ignitionPoint: 300 })).toEqual([message]);
    expect(problems({ flammable: false, fuel: 10 })).toEqual([message]);
  });

  it('AC-1: transparent and opaque together are rejected', () => {
    expect(problems({ transparent: true, opaque: true })).toEqual([
      'properties.opaque: a material cannot be both transparent and opaque',
    ]);
    expect(problems({ transparent: true, opaque: false })).toEqual([]);
  });

  it('AC-1: frozen needs a temperature at or below its freezePoint', () => {
    const message =
      'properties.temperature: a frozen material needs a temperature at or below its freezePoint';
    expect(problems({ frozen: true })).toEqual([message]);
    expect(problems({ frozen: true, temperature: -5 })).toEqual([message]);
    expect(problems({ frozen: true, freezePoint: 0 })).toEqual([message]);
    expect(problems({ frozen: true, temperature: 5, freezePoint: 0 })).toEqual([message]);
    expect(problems({ frozen: true, temperature: 0, freezePoint: 0 })).toEqual([]);
  });

  it('AC-1: object-level and live-state properties are not preset fields', () => {
    const objectLevel = [
      'material',
      'owner',
      'burning',
      'charge',
      'hidden',
      'trapped',
      'trap',
      'suspended',
      'support',
      'waterSurface',
      'container',
      'remains',
      'chargeActivated',
      'lightActivated',
      'shootable',
      'extinguishable',
      'bashable',
      'unstable',
      'noiseMultiplier',
    ];
    for (const key of objectLevel) {
      expect(problems({ [key]: key === 'burning' ? true : 'x' })).toEqual([
        expect.stringContaining(`"${key}"`),
      ]);
    }
  });

  it('AC-6: every preset declares surfaceHardness and softAnchor (wood and earth anchor rope arrows)', () => {
    const materials = loadGameContent().all('material');
    const undeclared = materials.filter(
      (m) =>
        !Object.hasOwn(m.properties, 'surfaceHardness') ||
        !Object.hasOwn(m.properties, 'softAnchor'),
    );
    expect(undeclared).toEqual([]);
    const anchors = Object.fromEntries(
      ['wood', 'earth', 'stone', 'iron', 'glass'].map((id) => [
        id,
        materials.find((m) => m.id === id)?.properties.softAnchor,
      ]),
    );
    expect(anchors).toEqual({ wood: true, earth: true, stone: false, iron: false, glass: false });
    const withoutSurface = materialSchema.safeParse({ ...base, properties: {} });
    expect(withoutSurface.error?.issues.map((i) => i.path.join('.')).sort()).toEqual([
      'properties.softAnchor',
      'properties.surfaceHardness',
    ]);
  });

  it('AC-1: footstep loudness and impact sound are range- and format-checked', () => {
    expect(materialSchema.safeParse({ ...base, footstepLoudness: 21 }).success).toBe(false);
    expect(materialSchema.safeParse({ ...base, footstepLoudness: -20 }).success).toBe(true);
    expect(materialSchema.safeParse({ ...base, impactSound: 'wood' }).success).toBe(false);
  });

  it('mw-e28.6: a material may name its footstep surface, one of the audio bible §7.3 ids', () => {
    expect(materialSchema.safeParse({ ...base, footstepSurface: 'wood-hollow' }).success).toBe(
      true,
    );
    expect(materialSchema.safeParse({ ...base, footstepSurface: 'marble' }).success).toBe(false);
    expect(materialSchema.parse(base).footstepSurface).toBeUndefined();
  });

  it('AC-3: an object referencing an unknown material fails naming the id and file', () => {
    const schemas = {
      ...contentTypes,
      thing: z.strictObject({ id: contentId, properties: worldPropertiesSchema }),
    };
    const sources = [
      { path: 'data/material/wood.json', text: JSON.stringify({ ...base, id: 'wood' }) },
      {
        path: 'data/thing/crate.json',
        text: JSON.stringify({ id: 'crate', properties: { material: 'woood' } }),
      },
    ];
    let issues: readonly ContentIssue[] = [];
    try {
      loadContent(schemas, sources);
    } catch (error) {
      issues = (error as ContentLoadError).issues;
    }
    expect(issues).toEqual([
      {
        file: 'data/thing/crate.json',
        pointer: '/properties/material',
        message: 'thing:crate references missing material:woood',
      },
    ]);
  });

  it('materialPresets maps each id to its property values', () => {
    const content = loadGameContent();
    const presets = materialPresets(content.all('material'));
    expect([...presets.keys()]).toEqual(REQUIRED_MATERIALS);
    expect(presets.get('wood')).toBe(content.get('material', 'wood').properties);
    expect(presets.get('generic')).toEqual(SURFACE);
  });
});
