// mw-e27.8 AC-3: a variant group with no default warns, listing the uncovered case; the conditions of
// gated spawns are checked against the fact registry; gates on spawns the game cannot add or remove
// live are rejected.
import { describe, expect, it } from 'vitest';
import { gameContentSources, loadGameContent } from './game-content.ts';
import { ContentLoadError, loadContent, type ContentSource } from './loader.ts';
import { contentChecks, contentTypes } from './registry.ts';
import { variantWarnings } from './variant-checks.ts';

type Json = Record<string, unknown>;

const ROOM = 'scene/variant-room.json';

/** Every problem loading the game content with `edit` applied to the variant room. */
function issuesWith(edit: (scene: Json) => void): string[] {
  const sources: ContentSource[] = gameContentSources().map((source) => {
    if (!source.path.endsWith(ROOM)) return source;
    const json = JSON.parse(source.text) as Json;
    edit(json);
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

const spawnOf = (scene: Json, id: string): Json =>
  (scene['spawns'] as Json[]).find((s) => s['id'] === id) ?? expect.fail(id);

describe('variant validation (mw-e27.8)', () => {
  it('the variant room loads clean and its miller group has a default', () => {
    const content = loadGameContent();
    expect(variantWarnings(content.all('scene'))).toEqual([]);
    expect(issuesWith(() => undefined)).toEqual([]);
  });

  it('AC-3: a group with no default warns, listing the uncovered case', () => {
    const content = loadGameContent();
    const room = structuredClone(content.get('scene', 'variant-room')) as Json;
    const missing = spawnOf(room, 'miller-missing');
    missing['variant'] = { group: 'miller', when: { fact: 'variants.miller.fled' } };
    const warnings = variantWarnings([room as never]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain(
      'scene:variant-room variant group "miller" has no default variant',
    );
    expect(warnings[0]).toContain('{"fact":"variants.miller.rescued"}');
    expect(warnings[0]).toContain('{"fact":"variants.miller.fled"}');
    expect(warnings[0]).toContain('uncovered: not any of');
  });

  it('checks the conditions of spawnIf, despawnIf and variant.when against the fact registry', () => {
    const issues = issuesWith((scene) => {
      spawnOf(scene, 'boards')['spawnIf'] = { fact: 'variants.typo' };
      spawnOf(scene, 'boards')['despawnIf'] = { fact: 'variants.also-typo' };
      spawnOf(scene, 'miller-rescued')['variant'] = {
        group: 'miller',
        when: { fact: 'variants.third-typo' },
      };
    });
    expect(issues).toHaveLength(3);
    expect(issues.join('\n')).toContain('/spawns/1/spawnIf/fact');
    expect(issues.join('\n')).toContain('/spawns/1/despawnIf/fact');
    expect(issues.join('\n')).toContain('/spawns/2/variant/when/fact');
  });

  it('rejects a gate on a spawn that is only set up when the scene loads, naming the feature', () => {
    const issues = issuesWith((scene) => {
      spawnOf(scene, 'boards')['bulky'] = 'limp-body';
    });
    expect(issues.join('\n')).toMatch(/spawn "boards" has a spawn\/despawn gate but also bulky/);
  });

  it('an ungated spawn may have any feature', () => {
    expect(
      issuesWith((scene) => {
        spawnOf(scene, 'player-start')['recovery'] = [0, 0, 0];
      }).join('\n'),
    ).not.toContain('gate');
  });
});
