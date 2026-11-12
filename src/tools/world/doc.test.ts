/* eslint-disable @typescript-eslint/no-non-null-assertion -- fixtures index content known to exist */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadGameContent } from '@content/index';

const doc = readFileSync('docs/design/world-map.md', 'utf8');
const [world] = loadGameContent().all('world');

describe('docs/design/world-map.md', () => {
  it('AC-3: has a diagram and lists every node, edge and loop of the data', () => {
    expect(doc).toContain('```mermaid');
    for (const { id } of world!.nodes) expect(doc, `node ${id}`).toContain(`\`${id}\``);
    for (const { id } of world!.edges) expect(doc, `edge ${id}`).toContain(`\`${id}\``);
    for (const { id, name } of world!.loops) {
      expect(doc, `loop ${id}`).toContain(`\`${id}\`: ${name}`);
    }
  });

  it('AC-3: names the barge and towpath link and one shortcut per class', () => {
    expect(doc).toContain('## The barge and towpath to Wendmouth');
    for (const edge of ['barge-quay-lock', 'barge-lock-wharf', 'towpath-lock-wharf'])
      expect(doc).toContain(edge);
    for (const row of ['knight', 'archer', 'sorcerer', 'thief'])
      expect(doc).toContain(`| ${row} |`);
  });

  it('lists every planned connection with the bead that builds it', () => {
    for (const edge of world!.edges.filter((e) => e.transitions.length === 0)) {
      expect(doc).toContain(`planned: ${edge.bead ?? ''}`);
    }
    for (const bead of ['mw-e25.22', 'mw-e25.23', 'mw-e25.24', 'mw-e25.25', 'mw-e40.26'])
      expect(doc).toContain(bead);
  });

  it('maps the built scenes to nodes', () => {
    for (const node of world!.nodes.filter((n) => n.scene !== undefined)) {
      expect(doc).toContain(`| \`${node.scene?.id ?? ''}\` | \`${node.id}\` |`);
    }
  });
});
