// The Wendmouth dock props (owner-approved models, 2026-11-15) on real content: every model the
// renderer names is shipped and credited, every harbour prop has a model, and the harbour scene uses
// them the way their looks promise (style bible §7): the chests' lock plates match their lock tiers,
// the oil barrel burns, the light barrel breaks, the hoist's crate hangs from a rope an arrow can cut,
// and the solid deck fittings stand on colliders, so nothing that looks solid can be walked through.

import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadGameContent } from '@content/index';
import { layoutScene } from '@sim/index';
import {
  CONTAINER_MODELS,
  modelUrl,
  PROP_MODELS,
  SHIP_LANTERN,
  SHIP_LANTERN_TAG,
} from '../../src/render/props/dock-props';

const content = loadGameContent();
const scene = content.get('scene', 'wendmouth-harbour');
const credits = readFileSync('assets/CREDITS.md', 'utf8');
const models = [
  ...Object.values(PROP_MODELS),
  ...Object.values(CONTAINER_MODELS),
  SHIP_LANTERN,
].map((m) => m.model);

describe('Wendmouth dock props', () => {
  it('every model the renderer names has a runtime file, a CREDITS row and a prompt file', () => {
    expect(models.length).toBe(16);
    for (const id of models) {
      expect(existsSync(`public${modelUrl(id)}`), `${id} runtime file`).toBe(true);
      expect(credits, `${id} CREDITS row`).toContain(`| ${id} | model |`);
      expect(existsSync(`assets/prompts/model/${id}.md`), `${id} prompt file`).toBe(true);
    }
  });

  it('every harbour prop has a model; a movable one has a body, a fixed one has a height and no body', () => {
    const harbourProps = content.all('testprop').filter((p) => p.tags.includes('harbour'));
    expect(harbourProps.map((p) => p.id).sort()).toEqual(Object.keys(PROP_MODELS).sort());
    for (const prop of harbourProps) {
      const dock = PROP_MODELS[prop.id];
      expect(dock, prop.id).toBeDefined();
      if (prop.body === undefined)
        expect(dock?.height, `${prop.id} fixed height`).toBeGreaterThan(0);
      else expect(dock?.height, `${prop.id} rides its body`).toBeUndefined();
    }
  });

  it('every dock spawn in the harbour resolves to a model', () => {
    const dock = scene.spawns.filter(
      (s) =>
        s.tags.includes('dock-prop') ||
        s.tags.includes(SHIP_LANTERN_TAG) ||
        Object.keys(CONTAINER_MODELS).some((t) => s.tags.includes(t)),
    );
    expect(dock.length).toBeGreaterThanOrEqual(25);
    for (const s of dock) {
      const resolved =
        (s.prop !== undefined && PROP_MODELS[s.prop.id] !== undefined) ||
        (s.tags.includes(SHIP_LANTERN_TAG) && s.lightSource !== undefined) ||
        (s.container !== undefined &&
          Object.keys(CONTAINER_MODELS).some((t) => s.tags.includes(t)));
      expect(resolved, s.id).toBe(true);
    }
  });

  it('the chests’ plates match their locks: iron sea chest tier 1, brass ditty box 2, black-steel strongbox 3', () => {
    const tierOf = (id: string): number | undefined => {
      const lock = scene.spawns.find((s) => s.id === id)?.container?.lock;
      return lock === undefined ? undefined : content.get('lock', lock.id).tier;
    };
    expect(tierOf('tern-crew-chest')).toBe(1);
    expect(tierOf('ann-ditty-box')).toBe(2);
    expect(tierOf('undertow-strongbox')).toBe(3);
    // Opening the crew's and Mags's chests is theft; the smugglers' strongbox is fair game.
    expect(scene.spawns.find((s) => s.id === 'tern-crew-chest')?.owner).toBe('npc-hesketh');
    expect(scene.spawns.find((s) => s.id === 'ann-ditty-box')?.owner).toBe('npc-mags');
  });

  it('the oil barrel burns, the light barrel breaks into planks, and the hoist crate hangs from a cuttable rope', () => {
    expect(content.get('testprop', 'barrel-oil').flammable).toBe(true);
    const light = content.get('testprop', 'barrel-breakable');
    expect(light.tags).toContain('breakable');
    expect(scene.spawns.find((s) => s.id === 'wharf-light-barrel')?.breakable).toBeDefined();
    const crate = scene.spawns.find((s) => s.id === 'tern-hoist-crate');
    const rope = scene.spawns.find((s) => s.id === crate?.suspendedFrom);
    expect(rope?.rope).toBeDefined();
    expect(rope?.tags).toContain('archer-route');
  });

  it('the solid deck fittings (hutch, tiller) stand on blocking colliders', () => {
    const layout = layoutScene(scene, (id) => content.get('kit', id));
    for (const id of ['tern-companion-hutch', 'tern-tiller']) {
      const spawn = scene.spawns.find((s) => s.id === id);
      expect(spawn, id).toBeDefined();
      const [x, y, z] = spawn?.at ?? [0, 0, 0];
      const reach = id === 'tern-tiller' ? 1 : 0.1; // the tiller's post is 0.5 m aft of its middle
      const collider = layout.parts.find(
        (p) =>
          p.purpose === 'blocking' &&
          Math.abs(p.min.y - y) < 0.01 &&
          p.max.y > y + 0.8 &&
          x >= p.min.x - reach &&
          x <= p.max.x + reach &&
          z >= p.min.z - reach &&
          z <= p.max.z + reach,
      );
      expect(collider, `${id} collider`).toBeDefined();
    }
  });
});
