import { describe, expect, it } from 'vitest';
import { ContentLoadError, loadContent, type ContentSource } from '../loader.ts';
import { contentTypes } from '../registry.ts';
import { ContentRef, serializeContent } from '../schema.ts';
import { describeContent } from '../testing.ts';
import {
  factionSchema,
  PLAYER_FACTION_ID,
  UNALIGNED_FACTION,
  type FactionDefInput,
} from './faction.ts';

const wolves = {
  id: 'wolves',
  name: 'Wolves',
  notes: 'Test faction.',
} satisfies FactionDefInput;

const source = (path: string, json: unknown): ContentSource => ({
  path,
  text: JSON.stringify(json),
});

const problems = (value: unknown) =>
  (factionSchema.safeParse(value).error?.issues ?? []).map(
    (i) => `${i.path.join('.')}: ${i.message}`,
  );

describe('faction schema', () => {
  it('fills defaults: neutral to the player and others, allied with its own members', () => {
    expect(factionSchema.parse(wolves)).toEqual({
      ...wolves,
      towardPlayer: 'neutral',
      towardMembers: 'ally',
      towardOthers: 'neutral',
      dispositionSpread: 0,
      relations: [],
    });
  });

  it('AC-3: dispositionSpread is a fraction 0..1 of a member’s disposition change', () => {
    expect(factionSchema.parse({ ...wolves, dispositionSpread: 0.5 }).dispositionSpread).toBe(0.5);
    expect(problems({ ...wolves, dispositionSpread: 1.5 })).toHaveLength(1);
    expect(problems({ ...wolves, dispositionSpread: -0.1 })).toHaveLength(1);
  });

  it('AC-2: relations are one-way refs and round-trip through serialize → parse', () => {
    const def = factionSchema.parse({
      ...wolves,
      relations: [
        { faction: 'sheep', stance: 'prey' },
        { faction: 'bears', stance: 'wary', mutual: true },
      ],
    } satisfies FactionDefInput);
    expect(def.relations).toEqual([
      { faction: new ContentRef('faction', 'sheep'), stance: 'prey', mutual: false },
      { faction: new ContentRef('faction', 'bears'), stance: 'wary', mutual: true },
    ]);
    expect(factionSchema.parse(JSON.parse(serializeContent(def)))).toEqual(def);
  });

  it('AC-4: a relation to an undefined faction fails validation, naming the file and ref', () => {
    let error: unknown;
    try {
      loadContent(contentTypes, [
        source('data/faction/wolves.json', {
          ...wolves,
          relations: [{ faction: 'sheep', stance: 'prey' }],
        }),
      ]);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(ContentLoadError);
    expect((error as ContentLoadError).issues).toEqual([
      {
        file: 'data/faction/wolves.json',
        pointer: '/relations/0/faction',
        message: 'faction:wolves references missing faction:sheep',
      },
    ]);
  });

  it('AC-4: a creature naming an undefined faction fails validation', () => {
    expect(() =>
      loadContent(contentTypes, [
        source('data/creature/c.json', {
          id: 'c',
          family: 'animal',
          stats: { health: 1, poise: 0, mass: 1, size: 'tiny' },
          senses: {
            sight: {
              nearRange: 1,
              farRange: 2,
              primaryHalfAngle: 10,
              peripheralHalfAngle: 20,
              verticalHalfAngle: 10,
              darkVision: 0,
              detectionSpeed: 1,
            },
          },
          locomotion: {
            agent: { radius: 0.1, height: 0.2 },
            modes: {
              walk: {
                speeds: { sneak: 1, walk: 1, run: 1 },
                stepHeight: 0.1,
                maxSlope: 30,
                jumpHeight: 0,
                maxDrop: 1,
                wadeDepth: 0.1,
              },
            },
          },
          faction: 'sheep',
        }),
      ]),
    ).toThrow('creature:c references missing faction:sheep');
  });

  it('rejects the reserved player id, relations to itself and repeated relations', () => {
    expect(
      problems({
        ...wolves,
        id: PLAYER_FACTION_ID,
        relations: [
          { faction: 'player', stance: 'ally' },
          { faction: 'sheep', stance: 'prey' },
          { faction: 'sheep', stance: 'hostile' },
        ],
      }),
    ).toEqual([
      'id: "player" is reserved for the player',
      'relations.0.faction: a faction’s stance toward itself is `towardMembers`, not a relation',
      'relations.2.faction: "sheep" is listed twice',
    ]);
  });
});

describeContent(
  'faction',
  'is valid, and the unaligned default faction exists',
  (entry, content) => {
    expect(factionSchema.parse(JSON.parse(serializeContent(entry)))).toEqual(entry);
    expect(content.has('faction', UNALIGNED_FACTION)).toBe(true);
  },
);
