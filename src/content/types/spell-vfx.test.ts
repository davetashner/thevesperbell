import { describe, expect, it } from 'vitest';
import { markExercised } from '../testing.ts';
import { loadGameContent } from '../game-content.ts';
import { SPELL_VFX_SLOTS, spellVfxBlockSchema, spellVfxTemplateSchema } from './spell-vfx.ts';

const content = loadGameContent();

describe('spell VFX templates (mw-e29.10)', () => {
  for (const template of content.all('spell-vfx-template')) {
    it(`AC-1: ${template.id} fills a standard slot and names only loaded effects [spell-vfx-template:${template.id}]`, ({
      task,
    }) => {
      markExercised(task, 'spell-vfx-template', template.id);
      expect(SPELL_VFX_SLOTS).toContain(template.slot);
      const effects = JSON.stringify(template).match(/vfx-[a-z0-9-]+/g) ?? [];
      for (const id of effects) {
        markExercised(task, 'vfx-effect', id);
        expect(content.get('vfx-effect', id).id).toBe(id);
      }
    });
  }

  it('every standard slot has a template', () => {
    const slots = new Set(content.all('spell-vfx-template').map((t) => t.slot));
    expect([...slots].sort()).toEqual([...SPELL_VFX_SLOTS].sort());
  });

  it('a pulse above the photosensitivity limit is rejected', () => {
    const base = {
      id: 'svt-test',
      slot: 'area',
      notes: 'x',
      ring: { growSeconds: 0.5, pulseHz: 5 },
    };
    expect(spellVfxTemplateSchema.safeParse(base).success).toBe(false);
    expect(
      spellVfxTemplateSchema.safeParse({ ...base, ring: { growSeconds: 0.5, pulseHz: 2 } }).success,
    ).toBe(true);
  });

  it('an unknown slot names the known ones', () => {
    const result = spellVfxTemplateSchema.safeParse({ id: 'svt-x', slot: 'aura', notes: 'x' });
    expect(JSON.stringify(result.error?.issues)).toContain('castWindup');
  });

  it('a block takes only the standard slots', () => {
    expect(spellVfxBlockSchema.safeParse({ aura: { template: 'svt-x' } }).success).toBe(false);
    expect(spellVfxBlockSchema.safeParse({}).success).toBe(true);
  });
});
