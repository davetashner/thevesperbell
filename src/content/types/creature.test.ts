import { describe, expect, it } from 'vitest';
import { readContentSources } from '../fs-sources.ts';
import { ContentLoadError, loadContent, type ContentSource } from '../loader.ts';
import { contentTypes } from '../registry.ts';
import { ContentRef, serializeContent } from '../schema.ts';
import type { AttackDefInput } from './attack.ts';
import { loadFixtureContent } from '../test-fixtures.ts';
import type { Frozen } from '../loader.ts';
import { compileCreatures, creatureSchema, gaitSpeeds, type CreatureDefInput } from './creature.ts';
import { deriveNavAgent, resolveLocomotion, type LocomotionProfile } from './locomotion.ts';
import { resolveSenses } from './sense.ts';
import type { MoveDefInput } from './move.ts';

const sight = {
  nearRange: 8,
  farRange: 20,
  primaryHalfAngle: 35,
  peripheralHalfAngle: 60,
  verticalHalfAngle: 40,
  darkVision: 0.2,
  detectionSpeed: 1,
};

const walker = {
  agent: { radius: 0.35, height: 1.8 },
  modes: {
    walk: {
      speeds: { sneak: 1, walk: 1.5, run: 5 },
      stepHeight: 0.4,
      maxSlope: 45,
      jumpHeight: 0.6,
      maxDrop: 2.5,
      wadeDepth: 1.2,
    },
  },
};

const minimal = {
  id: 'fixture-walker',
  family: 'human',
  stats: { health: 100, poise: 40, mass: 80, size: 'medium' },
  senses: { sight },
  locomotion: walker,
} satisfies CreatureDefInput;

const chopMove = {
  id: 'chop',
  notes: 'Test move.',
  verb: 'attack',
  frames: { startup: 18, active: 4, recovery: 10 },
  damage: { amounts: { slash: 10 } },
  hitbox: {
    track: 'chop',
    shape: { kind: 'sphere', center: { x: 0, y: 1, z: 1 }, radius: 0.5 },
    reach: 'short',
    swing: 'vertical',
  },
  presentation: { anim: 'anim-chop' },
} satisfies MoveDefInput;

const chopAttack = {
  id: 'overhead-chop',
  notes: 'Test attack.',
  kind: 'melee',
  move: 'chop',
  telegraph: 'chop-windup',
  range: { min: 0, max: 2 },
} satisfies AttackDefInput;

const source = (path: string, json: unknown): ContentSource => ({
  path,
  text: JSON.stringify(json),
});

const loadIssues = (sources: readonly ContentSource[], schemas = contentTypes) => {
  try {
    loadContent(schemas, sources);
  } catch (error) {
    if (error instanceof ContentLoadError) return error;
  }
  throw new Error('expected loading to fail');
};

describe('creature schema', () => {
  it('AC-1: a file with only id, family, stats, senses and locomotion passes with every default filled', () => {
    const content = loadContent(
      contentTypes,
      readContentSources('src/content/fixtures/creature-valid'),
    );
    expect(content.get('creature', 'minimal-walker')).toEqual({
      id: 'minimal-walker',
      schemaVersion: 1,
      family: 'human',
      tags: [],
      stats: { health: 100, poise: 40, mass: 80, size: 'medium' },
      senses: { sight, hearing: { thresholdDb: 30, range: 25 } },
      locomotion: walker,
      attacks: [],
      properties: {},
      aflame: false,
      regions: [],
      resistances: {},
      poiseRegen: { delayTicks: 120, percentPerSecond: 25 },
      reactions: { knockbackImpulse: 300, knockdownImpulse: 900, launchSpeed: 2, replace: {} },
      disposition: {},
      fears: [],
      personality: {
        bravery: 0.5,
        curiosity: 0.5,
        aggression: 0.5,
        diligence: 0.5,
        sociability: 0.5,
        greed: 0.5,
      },
      needs: {},
      behaviour: { profile: 'default', tuning: {} },
      interactions: [],
      presentation: { mesh: 'placeholder-capsule', sfx: 'placeholder' },
    });
  });

  it('AC-1: defaults are fresh per entry, so freezing one entry never freezes another', () => {
    const a = creatureSchema.parse(minimal);
    const b = creatureSchema.parse({ ...minimal, id: 'other' });
    expect(a.tags).not.toBe(b.tags);
    expect(a.behaviour.tuning).not.toBe(b.behaviour.tuning);
  });

  it('AC-2: a file missing stats.health fails naming the file and stats.health', () => {
    const file = 'src/content/fixtures/creature-invalid/creature/missing-health.json';
    const error = loadIssues(readContentSources('src/content/fixtures/creature-invalid'));
    expect(error.issues).toEqual([
      {
        file,
        pointer: '/stats/health',
        message: expect.stringContaining('stats.health') as string,
      },
    ]);
    expect(error.message).toContain(file);
    expect(error.message).toContain('stats.health');
  });

  it('AC-3: every unresolved ref is listed, not just the first', () => {
    const error = loadIssues([
      source('data/creature/a.json', {
        ...minimal,
        id: 'a',
        senses: 'no-such-profile',
        attacks: ['does-not-exist', 'also-missing'],
      }),
      source('data/creature/b.json', { ...minimal, id: 'b', attacks: ['does-not-exist'] }),
    ]);
    expect(error.issues.map((i) => `${i.file}#${i.pointer}: ${i.message}`)).toEqual([
      'data/creature/a.json#/senses: creature:a references missing sense:no-such-profile',
      'data/creature/a.json#/attacks/0: creature:a references missing attack:does-not-exist',
      'data/creature/a.json#/attacks/1: creature:a references missing attack:also-missing',
      'data/creature/b.json#/attacks/0: creature:b references missing attack:does-not-exist',
    ]);
  });

  it('AC-3: refs to existing attacks and sense profiles resolve to their entries', () => {
    const content = loadContent(contentTypes, [
      source('data/move/chop.json', chopMove),
      source('data/attack/overhead-chop.json', chopAttack),
      source('data/sense/undead.json', { id: 'undead', name: 'Undead', notes: 'Test.', sight }),
      source('data/creature/a.json', {
        ...minimal,
        id: 'a',
        senses: 'undead',
        attacks: ['overhead-chop'],
      }),
    ]);
    const creature = content.get('creature', 'a');
    expect(creature.senses).toEqual(new ContentRef('sense', 'undead'));
    expect(creature.attacks.map((attack) => content.resolve(attack).move.id)).toEqual(['chop']);
  });

  it('AC-4: two files with the same id fail with a duplicate-id error naming both files', () => {
    const error = loadIssues([
      source('data/creature/walker.json', minimal),
      source('data/creature/walker-copy.json', minimal),
    ]);
    expect(error.issues).toEqual([
      {
        file: 'data/creature/walker.json',
        pointer: '/id',
        message:
          'duplicate id creature:fixture-walker: already defined in data/creature/walker-copy.json',
      },
    ]);
  });

  it('AC-5: a full creature round-trips through serialize → parse unchanged', () => {
    const full = creatureSchema.parse({
      ...minimal,
      schemaVersion: 1,
      family: 'forgotten',
      tags: ['undead', 'miner'],
      senses: 'undead',
      locomotion: { base: 'forgotten', modes: { climb: null, walk: { speeds: { run: 2 } } } },
      attacks: ['overhead-chop', 'lunging-thrust'],
      properties: { fragile: 120 },
      aflame: true,
      resistances: { blunt: 1.5, pierce: 0.5, poison: 0 },
      reactions: { knockdownImpulse: 1200, replace: { knockdown: 'knockback' } },
      faction: 'forgotten',
      disposition: { towardPlayer: 'wary' },
      fears: [{ kind: 'property', stimulus: 'burning', intensity: 30 }],
      personality: { diligence: 0.9, curiosity: 0.1 },
      needs: { sleep: { ratePerMinute: 2, threshold: 80 } },
      behaviour: { profile: 'habit-keeper', tuning: { searchSeconds: 20 } },
      interactions: ['hum-hymn'],
      loot: 'miner-scraps',
      presentation: { mesh: 'forgotten-miner', sfx: 'forgotten' },
    } satisfies CreatureDefInput);
    const text = serializeContent(full);
    expect(JSON.parse(text)).toMatchObject({
      senses: 'undead',
      locomotion: { base: 'forgotten', modes: { climb: null, walk: { speeds: { run: 2 } } } },
      attacks: ['overhead-chop', 'lunging-thrust'],
    });
    expect(creatureSchema.parse(JSON.parse(text))).toEqual(full);
  });

  it('rejects out-of-range and repeated values with their JSON paths', () => {
    const result = creatureSchema.safeParse({
      ...minimal,
      stats: { ...minimal.stats, health: 0 },
      locomotion: { base: 'goblin', agent: { radius: 0 } },
      resistances: { blunt: 3.5, holy: 1 },
      reactions: { knockbackImpulse: 0, replace: { flinch: 'wobble', none: 'flinch' } },
      fears: [{ kind: 'property', stimulus: 'burning', intensity: 101 }],
      personality: { greed: 2 },
    });
    expect(result.error?.issues.map((i) => i.path.join('.'))).toEqual([
      'stats.health',
      'locomotion.agent.radius',
      'resistances.blunt',
      'resistances', // unknown damage type "holy"
      'reactions.knockbackImpulse',
      'reactions.replace.flinch',
      'reactions.replace', // "none" is not a tier
      'fears.0.intensity',
      'personality.greed',
    ]);
  });
});

describe('compileCreatures (mw-e12.4)', () => {
  it('resolves each creature’s senses and nav agent, frozen, keyed and ordered by id', () => {
    const content = loadFixtureContent();
    const defs = content.all('creature');
    const table = compileCreatures([...defs].reverse(), content);
    expect([...table.keys()]).toEqual([...defs.map((d) => d.id)].sort());
    const hound = table.get('fixture-hound');
    const def = content.get('creature', 'fixture-hound');
    expect(hound?.def).toBe(def);
    expect(hound?.senses).toEqual(resolveSenses(def.senses, content));
    expect(hound?.nav).toEqual(deriveNavAgent(resolveLocomotion(def.locomotion, content)));
    expect(hound?.nav).toMatchObject({ radius: 0.4, height: 0.9 });
    expect(Object.isFrozen(hound)).toBe(true);
    expect(Object.isFrozen(hound?.senses)).toBe(true);
    expect(Object.isFrozen(hound?.nav)).toBe(true);
    expect(hound?.gaits).toEqual(gaitSpeeds(resolveLocomotion(def.locomotion, content)));
  });

  it('gait speeds (mw-e11.2) come from the walk mode, else the first moving mode, else are 0', () => {
    const speeds = (sneak: number) => ({ speeds: { sneak, walk: sneak * 2, run: sneak * 4 } });
    const profile = (modes: object) => ({ modes }) as unknown as Frozen<LocomotionProfile>;
    expect(gaitSpeeds(profile({ fly: speeds(2), walk: speeds(1) }))).toEqual({
      sneak: 1,
      walk: 2,
      run: 4,
    });
    expect(gaitSpeeds(profile({ swim: speeds(3), fly: speeds(2) }))).toEqual({
      sneak: 2,
      walk: 4,
      run: 8,
    });
    expect(gaitSpeeds(profile({ stationary: {} }))).toEqual({ sneak: 0, walk: 0, run: 0 });
  });
});
