// Projectile spells against real content and the replay harness (mw-e06.6). src/sim tests cannot load
// content at runtime, so the data-file path (a projectile spell JSON through the real schema, with its
// defaults) and the determinism replay live here.
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { contentChecks, contentTypes, gameContentSources, loadContent } from '@content/index';
import type { SpellEntry } from '@content/index';
import { fixtureContentSources, spellFixtureSources } from '@content/test-fixtures';
import {
  addProperties,
  box,
  DAMAGE_COMPONENTS,
  FakeCollisionWorld,
  giveCombatant,
  giveHurtboxes,
  HIT_VOLUME_COMPONENTS,
  installSpellProjectiles,
  installSpells,
  installStimuli,
  learnSpell,
  placeEntity,
  playReplay,
  readProperty,
  recordScenario,
  registerWorldProperties,
  stimulusResolved,
  stimulusSystem,
  World,
  type CastCommand,
  type EntityId,
  type ReplayScenario,
} from '@sim/index';

const NEW_FILE = 'src/content/fixtures/spells/spell/trail-bolt.json';

function spellFile(
  id: string,
  delivery: object,
  effects: object[],
): { path: string; text: string } {
  return {
    path: NEW_FILE.replace('trail-bolt', id),
    text: JSON.stringify({
      id,
      name: id,
      school: 'fire',
      tier: 1,
      cost: { mana: 5 },
      castTime: 0,
      delivery,
      effects,
      vfxCue: 'vfx-spell-fire-test',
      sfxCue: 'sfx-spell-fire-test-cast',
    }),
  };
}

function loadSpells(files: readonly { path: string; text: string }[]): SpellEntry[] {
  const content = loadContent(
    contentTypes,
    [...gameContentSources(), ...fixtureContentSources(), ...spellFixtureSources(), ...files],
    contentChecks,
  );
  return files.map((file) => {
    const id = /([^/]+)\.json$/.exec(file.path)?.[1] ?? '';
    const spell = content.all('spell').find((s) => s.id === id);
    if (spell === undefined) throw new Error(`${id} did not load`);
    return spell;
  });
}

function world(spells: readonly SpellEntry[], seed = 9) {
  const byId = new Map(spells.map((s) => [s.id, s]));
  const w = installStimuli(registerWorldProperties(new World<CastCommand>({ seed })));
  w.register(...DAMAGE_COMPONENTS, ...HIT_VOLUME_COMPONENTS);
  const pipeline = installSpells(w, { spells: (id) => byId.get(id) });
  installSpellProjectiles(w, pipeline, {
    collision: new FakeCollisionWorld([
      box({ x: 14, y: -50, z: -50 }, { x: 14.1, y: 50, z: 50 }),
      box({ x: -14, y: -50, z: -50 }, { x: -13.9, y: 50, z: 50 }),
    ]),
    muzzleHeight: 0,
  });
  w.addSystem(stimulusSystem());
  const spawn = (
    x: number,
    z: number,
    props: Parameters<typeof addProperties>[2] = {},
  ): EntityId => {
    const entity = w.spawn();
    placeEntity(w, entity, { x, y: 0, z }, 0.5);
    giveCombatant(w, entity, { health: 100 });
    giveHurtboxes(w, entity, {
      boxes: [
        {
          id: 'body',
          socket: 'root',
          region: 'torso',
          armored: false,
          multiplier: 1,
          shape: { kind: 'sphere', center: { x: 0, y: 0, z: 0 }, radius: 0.5 },
        },
      ],
    });
    addProperties(w, entity, { temperature: 20, ...props });
    return entity;
  };
  return { w, pipeline, spawn };
}

describe('projectile spell from a data file (mw-e06.6)', () => {
  it('AC-5: a projectile with a heat trail passing within 0.5 m of a flammable object heats it per the stimulus rules', () => {
    const [spell] = loadSpells([
      spellFile(
        'trail-bolt',
        {
          kind: 'projectile',
          speed: 20,
          maxRange: 30,
          radius: 0.2,
          trail: { element: 'heat', intensity: 900, radius: 0.5 },
        },
        [{ op: 'stimulus', element: 'cold', intensity: 1, radius: 0.1 }],
      ),
    ]);
    expect(spell?.delivery).toMatchObject({
      kind: 'projectile',
      lifetime: 10,
      pierce: 0,
      bounce: 0,
    });
    const { w, pipeline, spawn } = world(spell ? [spell] : []);
    const caster = spawn(0, 0);
    const brush = spawn(10, 0.4, { flammable: true });
    const farBrush = spawn(10, 4, { flammable: true });
    const heated: EntityId[] = [];
    w.events.on(stimulusResolved, (e) => {
      if (e.stimulus.element === 'heat') e.hits.forEach((h) => heated.push(h.entity));
    });
    pipeline.cast(w, { caster, spell: 'trail-bolt', source: 'free', aim: { x: 1, y: 0, z: 0 } });
    for (let i = 0; i < 120; i++) w.step();
    expect(heated).toContain(brush);
    expect(heated).not.toContain(farBrush);
    expect(readProperty(w, brush, 'temperature')).toBeGreaterThan(20);
    expect(readProperty(w, farBrush, 'temperature')).toBe(20);
  });

  it('rejects out-of-range projectile parameters at load time', () => {
    const bad = spellFile(
      'bad-bolt',
      { kind: 'projectile', speed: 5, maxRange: 5, radius: 0.1, bounce: 99 },
      [{ op: 'status', status: 'x', duration: 1 }],
    );
    expect(() => loadSpells([bad])).toThrow(/bounce/);
  });
});

describe('projectile spells replay deterministically (mw-e06.6)', () => {
  const SPELLS = loadSpells([
    spellFile(
      'rep-ricochet',
      {
        kind: 'projectile',
        speed: 30,
        maxRange: 120,
        radius: 0.15,
        bounce: 2,
        pierce: 1,
        impactRadius: 2,
        trail: { element: 'heat', intensity: 50, radius: 0.5 },
      },
      [
        { op: 'status', status: 'marked', duration: 2 },
        { op: 'stimulus', element: 'heat', intensity: 40, radius: 1 },
      ],
    ),
    spellFile(
      'rep-lob',
      { kind: 'projectile', speed: 18, maxRange: 80, radius: 0.2, gravity: 9.8, lifetime: 2 },
      [{ op: 'stimulus', element: 'cold', intensity: 20, radius: 1 }],
    ),
  ]);
  const command = z.object({
    type: z.literal('cast'),
    caster: z.number().int(),
    spell: z.string(),
    target: z.number().int().optional(),
    aim: z.object({ x: z.number(), y: z.number(), z: z.number() }).optional(),
  });
  const scenario: ReplayScenario<CastCommand> = {
    name: 'spell-projectile-test',
    usesContent: false,
    command: command as z.ZodType<CastCommand>,
    create: ({ seed }) => {
      const { w, spawn } = world(SPELLS, seed);
      const casters = [spawn(0, 0), spawn(0, 3), spawn(0, -3)];
      spawn(6, 0.3, { flammable: true });
      spawn(9, -0.2);
      spawn(-8, 3);
      for (const c of casters) for (const s of SPELLS) learnSpell(w, c, s.id);
      return w;
    },
    drive: () => [],
  };
  // Entities: 1 stimulus queue, 2 status ledger, then casters at 3, 4, 5.
  const script = (tick: number): readonly CastCommand[] =>
    tick % 15 === 0 && tick < 300
      ? [
          {
            type: 'cast',
            caster: 3 + ((tick / 15) % 3),
            spell: tick % 30 === 0 ? 'rep-ricochet' : 'rep-lob',
            aim: {
              x: tick % 45 === 0 ? -1 : 1,
              y: 0.1 * ((tick / 15) % 4),
              z: ((tick / 15) % 5) * 0.2,
            },
          },
        ]
      : [];

  it('20 recorded projectile casts replay twice to identical final and checkpoint hashes', () => {
    const replay = recordScenario(scenario, {
      seed: 4,
      ticks: 600,
      buildSha: 'test',
      contentHash: 'none',
      checkpointInterval: 25,
      inputs: script,
    });
    const first = playReplay(replay, scenario);
    const second = playReplay(replay, scenario);
    expect(first.status).toBe('passed');
    expect(second.status).toBe('passed');
    if (first.status !== 'passed' || second.status !== 'passed') return;
    expect(first.finalHash).toBe(second.finalHash);
    expect(first.finalHash).toBe(replay.finalHash);
    expect(first.checkpoints).toBeGreaterThan(20);
  });
});
