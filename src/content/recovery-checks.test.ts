// mw-e17.14 AC-6: a world object flagged questCritical without a recovery anchor fails validation,
// naming the entity and the file.

import { describe, expect, it } from 'vitest';
import { gameContentSources } from './game-content.ts';
import { ContentLoadError, loadContent, type ContentSource } from './loader.ts';
import { contentChecks, contentTypes } from './registry.ts';

/** Every problem loading the game content with `edit` applied to the spawn list of scene `path`. */
function issuesWith(path: string, edit: (spawns: Record<string, unknown>[]) => void): string[] {
  const sources: ContentSource[] = gameContentSources().map((source) => {
    if (!source.path.endsWith(path)) return source;
    const json = JSON.parse(source.text) as { spawns: Record<string, unknown>[] };
    edit(json.spawns);
    return { ...source, text: JSON.stringify(json) };
  });
  try {
    loadContent(contentTypes, sources, contentChecks);
  } catch (error) {
    if (!(error instanceof ContentLoadError)) throw error;
    return error.issues.map((i) => `${i.file}#${i.pointer}: ${i.message}`);
  }
  return [];
}

describe('recovery anchors of quest-critical world objects (mw-e17.14)', () => {
  it('AC-6: a questCritical spawn without a recovery anchor fails, naming the spawn and the file', () => {
    const issues = issuesWith('scene/valley-01.json', (spawns) => {
      const first = spawns[0];
      if (first === undefined) throw new Error('no spawn');
      first['questCritical'] = true;
    });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain('valley-01.json#/spawns/0/recovery');
    expect(issues[0]).toMatch(
      /scene:valley-01 spawn "[^"]+" is questCritical but declares no recovery/,
    );
  });

  it('AC-6: the same spawn passes once it names its anchor', () => {
    const issues = issuesWith('scene/valley-01.json', (spawns) => {
      const first = spawns[0];
      if (first === undefined) throw new Error('no spawn');
      first['questCritical'] = true;
      first['recovery'] = [0, 0, 0];
    });
    expect(issues).toEqual([]);
  });
});
