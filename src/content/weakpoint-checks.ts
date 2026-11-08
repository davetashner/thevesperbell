// Load-time weak point check (mw-e05.6): a creature region of kind `weakpoint` can be switched off by
// creature state, so it must say in which states it is on. A weakpoint with no `enabledIn` would be
// always on, or never answerable to "when is this exposed?", so the load fails naming the creature
// and the region instead. Region ids must also be unique within a creature.

import type { ContentCheck, ContentIssue } from './loader.ts';
import type { CreatureDef } from './types/creature.ts';

/** Fails each creature weakpoint region that declares no enabling state, and duplicate region ids. */
export const checkWeakpoints: ContentCheck = (entries) => {
  const issues: ContentIssue[] = [];
  for (const { type, file, value } of entries) {
    if (type !== 'creature') continue;
    const creature = value as CreatureDef;
    const seen = new Set<string>();
    creature.regions.forEach((region, i) => {
      const pointer = `/regions/${String(i)}`;
      if (seen.has(region.id)) {
        issues.push({
          file,
          pointer: `${pointer}/id`,
          message: `creature:${creature.id} declares region "${region.id}" twice`,
        });
      }
      seen.add(region.id);
      if (region.region === 'weakpoint' && (region.enabledIn?.length ?? 0) === 0) {
        issues.push({
          file,
          pointer: `${pointer}/enabledIn`,
          message: `creature:${creature.id} weakpoint "${region.id}" must declare the state(s) it is enabled in (enabledIn, e.g. ["roaring"])`,
        });
      }
    });
  }
  return issues;
};
