// Load-time spell status check (mw-e06.25): a spell's `status` op names a status content entry
// (mw-e06.9), but the schema can only see an id. After every file has parsed, each status op must
// name a defined status, so a typo ("rotted") fails the load naming the spell and the status
// instead of applying nothing in play.

import type { ContentCheck, ContentIssue } from './loader.ts';
import type { SpellDefinition } from './types/spell.ts';

/** Fails each spell `status` op whose status is not a loaded status entry. */
export const checkSpellStatuses: ContentCheck = (entries) => {
  const statuses = new Set<string>();
  for (const { type, value } of entries) if (type === 'status') statuses.add(value.id);
  const issues: ContentIssue[] = [];
  for (const { type, file, value } of entries) {
    if (type !== 'spell') continue;
    const spell = value as SpellDefinition;
    spell.effects.forEach((effect, i) => {
      if (effect.op !== 'status' || statuses.has(effect.status)) return;
      issues.push({
        file,
        pointer: `/effects/${String(i)}/status`,
        message: `spell:${spell.id} applies status "${effect.status}", which is not a defined status (add src/content/data/status/${effect.status}.json)`,
      });
    });
  }
  return issues;
};
