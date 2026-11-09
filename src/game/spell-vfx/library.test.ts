import { describe, expect, it } from 'vitest';
import { loadGameContent } from '@content/game-content';
import { markExercised } from '@content/testing';
import { SPELL_VFX_SLOTS } from '@content/index';
import { ContentRef } from '@content/schema';
import { NO_SPELL_VFX, SpellVfxLibrary } from './library.ts';

const content = loadGameContent();
const effects = content.all('vfx-effect');
const make = () => new SpellVfxLibrary(content.all('spell-vfx-template'), effects);

const EVERY_SLOT = {
  castWindup: { template: 'svt-windup-gather' },
  castRelease: { template: 'svt-release-burst' },
  projectile: { template: 'svt-projectile-bolt', tint: '#FF7A1A' },
  impact: { template: 'svt-impact-burst', scale: 2 },
  area: { template: 'svt-area-rune-ring' },
  beam: { template: 'svt-beam-stream', scale: 2 },
  sustainOnTarget: { template: 'svt-sustain-aura' },
  summon: { template: 'svt-summon-swirl' },
};

describe('spell VFX library (mw-e29.10)', () => {
  it('AC-1: a block using templates only resolves every slot to an effect the VFX layer knows', ({
    task,
  }) => {
    for (const t of content.all('spell-vfx-template'))
      markExercised(task, 'spell-vfx-template', t.id);
    const library = make();
    const resolved = library.resolve(EVERY_SLOT);
    const known = new Set([...effects, ...library.derivedEffects()].map((e) => e.id));
    for (const slot of SPELL_VFX_SLOTS) expect(resolved[slot], slot).toBeDefined();
    const played = [
      resolved.castWindup,
      resolved.castRelease,
      resolved.projectile?.head,
      resolved.projectile?.trail,
      resolved.impact,
      resolved.area?.motes,
      resolved.beam?.end,
      resolved.sustainOnTarget,
      resolved.summon,
    ];
    for (const effect of played) {
      expect(effect).toBeDefined();
      expect(known.has(effect?.effect ?? '')).toBe(true);
    }
  });

  it('a spell tint and scale override the template defaults; the template ones fill in otherwise', () => {
    const resolved = make().resolve(EVERY_SLOT);
    expect(resolved.projectile?.head.effect).toBe('vfx-spell-projectile-head~ff7a1a');
    expect(resolved.castWindup?.effect).toBe('vfx-spell-windup-motes~8b5cf6'); // template default
    expect(resolved.impact?.scale).toBe(2);
    expect(resolved.castWindup?.scale).toBe(1);
    expect(resolved.beam?.width).toBeCloseTo(1); // 0.5 m template width, scaled by 2
    expect(resolved.summon?.dissolveSeconds).toBe(1.2);
    expect(resolved.area?.growSeconds).toBe(0.5);
  });

  it('shares one derived effect between slots and spells that need the same tint', () => {
    const library = make();
    library.resolve({ impact: { template: 'svt-impact-burst', tint: '#112233' } });
    library.resolve({ impact: { template: 'svt-impact-burst', tint: '#112233', scale: 3 } });
    expect(library.derivedEffects()).toHaveLength(1);
  });

  it('a block as loaded (template refs, not plain ids) resolves the same', () => {
    const loaded = make().resolve({
      impact: { template: new ContentRef('spell-vfx-template', 'svt-impact-burst') },
    });
    expect(loaded.impact?.effect).toBe('vfx-spell-impact-burst~8b5cf6');
  });

  it('a projectile without a trail and a block of nothing resolve without error', () => {
    const library = make();
    expect(
      library.resolve({ projectile: { template: 'svt-projectile-head-only' } }).projectile?.trail,
    ).toBeUndefined();
    expect(library.resolve(undefined)).toBe(NO_SPELL_VFX);
    expect(library.resolve({})).toEqual(NO_SPELL_VFX);
  });

  it('AC-4: a missing optional slot resolves to nothing, the others still resolve', () => {
    const resolved = make().resolve({ impact: { template: 'svt-impact-burst' } });
    expect(resolved.impact).toBeDefined();
    for (const slot of SPELL_VFX_SLOTS.filter((s) => s !== 'impact')) {
      expect(resolved[slot], slot).toBeUndefined();
    }
  });

  it('a template in the wrong slot, an unknown template or an unknown effect throws naming it', () => {
    const library = make();
    expect(() => library.resolve({ beam: { template: 'svt-area-rune-ring' } })).toThrow(
      /slot beam/,
    );
    expect(() => library.resolve({ beam: { template: 'svt-nope' } })).toThrow(/svt-nope/);
    const broken = new SpellVfxLibrary(content.all('spell-vfx-template'), []);
    expect(() => broken.resolve({ impact: { template: 'svt-impact-burst' } })).toThrow(
      /unknown effect "vfx-spell-impact-burst"/,
    );
  });
});
