// Load-time spell VFX check (mw-e29.10): the schema sees a template id in each slot of a spell's `vfx`
// block, but only after every file has parsed can it tell that the template fills THAT slot (a ring
// template named as a beam would silently draw nothing in play).

import type { ContentCheck, ContentIssue } from './loader.ts';
import type { SpellDefinition } from './types/spell.ts';
import { SPELL_VFX_SLOTS } from './types/spell-vfx.ts';
import type { SpellVfxTemplateDef } from './types/spell-vfx.ts';

/** Fails each spell `vfx` slot whose template fills a different slot. */
export const checkSpellVfx: ContentCheck = (entries) => {
  const templates = new Map<string, SpellVfxTemplateDef>();
  for (const { type, value } of entries) {
    if (type === 'spell-vfx-template') templates.set(value.id, value as SpellVfxTemplateDef);
  }
  const issues: ContentIssue[] = [];
  for (const { type, file, value } of entries) {
    if (type !== 'spell') continue;
    const spell = value as SpellDefinition;
    for (const slot of SPELL_VFX_SLOTS) {
      const use = spell.vfx?.[slot];
      const template = use && templates.get(use.template.id);
      if (!use || !template || template.slot === slot) continue; // missing targets are the loader's
      issues.push({
        file,
        pointer: `/vfx/${slot}/template`,
        message: `spell:${spell.id} puts template "${template.id}" (a ${template.slot} template) in its ${slot} slot`,
      });
    }
  }
  return issues;
};
