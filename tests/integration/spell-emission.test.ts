// Spell light and noise against real content and the sim's hearing (mw-e06.14). src/sim tests cannot
// load content at runtime, so the data-file path (defaults through the real schema) and the check
// that a creature's ears and the light field both perceive a cast live here.
import { describe, expect, it } from 'vitest';
import { contentChecks, contentTypes, gameContentSources, loadContent } from '@content/index';
import type { SpellEntry } from '@content/index';
import { fixtureContentSources, spellFixtureSources } from '@content/test-fixtures';
import {
  buildSoundGraph,
  installLightField,
  installNoisePropagation,
  installSpellEmission,
  installSpells,
  installStimuli,
  learnSpell,
  LightField,
  lightFieldSystem,
  NoiseListenerComponent,
  noiseHeard,
  placeEntity,
  registerWorldProperties,
  spellNoiseDb,
  SCHOOL_NOISE_DB,
  stimulusSystem,
  World,
  type CastCommand,
  type NoiseHeard,
} from '@sim/index';

const FILE = 'src/content/fixtures/spells/spell/quiet-glow.json';

function loadSpell(effects: object[]): SpellEntry {
  const text = JSON.stringify({
    id: 'quiet-glow',
    name: 'Quiet Glow',
    school: 'light',
    tier: 1,
    cost: { mana: 5 },
    castTime: 0,
    delivery: { kind: 'self' },
    effects,
    vfxCue: 'vfx-spell-light-glow',
    sfxCue: 'sfx-spell-light-glow-cast',
  });
  const content = loadContent(
    contentTypes,
    [
      ...gameContentSources(),
      ...fixtureContentSources(),
      ...spellFixtureSources(),
      { path: FILE, text },
    ],
    contentChecks,
  );
  const spell = content.all('spell').find((s) => s.id === 'quiet-glow');
  if (spell === undefined) throw new Error('quiet-glow did not load');
  return spell;
}

describe('spell light and noise from a data file (mw-e06.14)', () => {
  it('AC-5: a spell file with no noise op validates and sounds at its school default, not silence', () => {
    const spell = loadSpell([{ op: 'status', status: 'glowing', duration: 5 }]);
    expect(spell.effects.some((e) => e.op === 'noise')).toBe(false);
    expect(spellNoiseDb(spell, 'release')).toBe(SCHOOL_NOISE_DB.light);
    expect(spellNoiseDb(spell, 'release')).toBeGreaterThan(0);
  });

  it('a light op takes its attach and duration defaults, and a noise op accepts dB including 0', () => {
    const spell = loadSpell([
      { op: 'light', intensity: 80, radius: 6 },
      { op: 'noise', phase: 'release', loudness: 0 },
    ]);
    expect(spell.effects[0]).toMatchObject({ attach: 'delivery', duration: 0 });
    expect(spellNoiseDb(spell, 'release')).toBe(0);
  });

  it('a cast is lit in the light field and heard by a listener across the room, with the noise attributed to the caster', () => {
    const spell = loadSpell([
      { op: 'light', intensity: 100, radius: 6, duration: 2, attach: 'caster' },
      { op: 'noise', phase: 'release', loudness: 80 },
    ]);
    const world = installStimuli(registerWorldProperties(new World<CastCommand>({ seed: 4 })));
    const field = new LightField();
    installLightField(world, field);
    const pipeline = installSpells(world, {
      spells: (id) => (id === spell.id ? spell : undefined),
    });
    installSpellEmission(world, pipeline);
    world.addSystem(stimulusSystem());
    world.addSystem(lightFieldSystem(field));
    installNoisePropagation(world, {
      graph: buildSoundGraph({
        rooms: [{ id: 'hall', min: { x: -20, y: 0, z: -20 }, max: { x: 20, y: 4, z: 20 } }],
        portals: [],
      }),
    });
    const caster = world.spawn();
    placeEntity(world, caster, { x: 0, y: 0, z: 0 }, 0.5);
    learnSpell(world, caster, spell.id);
    const guard = world.spawn();
    placeEntity(world, guard, { x: 10, y: 1, z: 0 }, 0.4);
    world.add(guard, NoiseListenerComponent, { thresholdDb: 0, range: 40 });
    const heard: NoiseHeard[] = [];
    world.events.on(noiseHeard, (e) => heard.push(e));

    expect(field.levelAt({ x: 0, y: 1, z: 1 })).toBe(0);
    world.step([{ type: 'cast', caster, spell: spell.id }]);
    expect(field.levelAt({ x: 0, y: 1, z: 1 })).toBeGreaterThan(0.5);
    expect(heard).toHaveLength(1);
    expect(heard[0]?.noise).toMatchObject({ kind: 'spell', loudness: 80, source: caster });
    expect(heard[0]?.level).toBeCloseTo(60, 0);
  });
});
