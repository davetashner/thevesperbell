// Spell pipeline against real content (mw-e06.2): the pipeline names no spell, and a spell added as a
// data file casts with no change to src/sim. (src/sim tests cannot load content at runtime.)
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { contentChecks, contentTypes, gameContentSources, loadContent } from '@content/index';
import {
  FIXTURE_SPELL_IDS,
  fixtureContentSources,
  loadSpellFixtureContent,
  spellFixtureSources,
} from '@content/test-fixtures';
import { SpellEffectApplied, SpellPipeline, spellStatusesOf } from '@sim/index';
import { spellWorld } from '@sim/magic/testing';

describe('spell pipeline: no spell is special-cased in code', () => {
  const dir = join(process.cwd(), 'src/sim/magic');
  const sources = readdirSync(dir)
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts') && true)
    .map((f) => [f, readFileSync(join(dir, f), 'utf8')] as const);

  it('AC-6: no pipeline source names a spell id (fixture or shipped), so ops cannot branch on one', () => {
    const content = loadSpellFixtureContent();
    const ids = [...FIXTURE_SPELL_IDS, ...content.all('spell').map((s) => s.id)];
    expect(ids.length).toBeGreaterThan(6);
    for (const [file, text] of sources) {
      // Strip comments: prose may mention a spell ("Animate Bones"); code must not.
      const code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      for (const id of ids) {
        expect(code, `${file} names spell "${id}"`).not.toMatch(new RegExp(`['"\`]${id}['"\`]`));
      }
    }
  });

  it('AC-6: a spell added as a new data file casts with no change to src/sim', () => {
    const text = JSON.stringify({
      id: 'brand-new-spell',
      name: 'Brand New Spell',
      school: 'somnomancy',
      tier: 1,
      cost: { mana: 4 },
      castTime: 0,
      delivery: { kind: 'self' },
      effects: [
        { op: 'status', status: 'drowsy', duration: 3 },
        { op: 'stimulus', element: 'cold', intensity: 10, radius: 1 },
      ],
      vfxCue: 'vfx-spell-somnomancy-brand-new',
      sfxCue: 'sfx-spell-somnomancy-brand-new-cast',
    });
    const content = loadContent(
      contentTypes,
      [
        ...gameContentSources(),
        ...fixtureContentSources(),
        ...spellFixtureSources(),
        { path: 'src/content/fixtures/spells/spell/brand-new-spell.json', text },
      ],
      contentChecks,
    );
    const { world, pipeline, spawn } = spellWorld([]);
    const spells = new SpellPipeline({
      spells: (id) => content.all('spell').find((s) => s.id === id),
    });
    expect(spells.ops.names()).toEqual(pipeline.ops.names());
    const caster = spawn();
    const applied: string[] = [];
    world.events.on(SpellEffectApplied, (e) => applied.push(e.op));
    expect(spells.cast(world, { caster, spell: 'brand-new-spell', source: 'free' }).status).toBe(
      'cast',
    );
    world.step();
    expect(applied).toEqual(['status', 'stimulus']);
    expect(spellStatusesOf(world, caster)[0]?.status).toBe('drowsy');
  });
});
