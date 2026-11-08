// Load-time check of quest-critical world objects (mw-e17.14, ADR-0003): a statue part or a
// counterweight is carried physically, so the player can drop, throw or lose it; the scene file must
// say where it returns to (`recovery`). A spawn flagged `questCritical` without one fails here, naming
// the scene, the spawn and the file.

import type { ContentCheck, ContentIssue } from './loader.ts';
import type { SceneDef } from './types/scene.ts';

/** The content check for scenes' quest-critical world objects. */
export const checkRecoveryAnchors: ContentCheck = (entries) => {
  const issues: ContentIssue[] = [];
  for (const { type, file, value } of entries) {
    if (type !== 'scene') continue;
    const scene = value as SceneDef;
    scene.spawns.forEach((spawn, index) => {
      if (spawn.questCritical !== true || spawn.recovery !== undefined) return;
      issues.push({
        file,
        pointer: `/spawns/${String(index)}/recovery`,
        message: `scene:${scene.id} spawn "${spawn.id}" is questCritical but declares no recovery anchor; it could be lost for good (ADR-0003)`,
      });
    });
  }
  return issues;
};
