// mw-e09.5: how far footsteps carry to the creatures of every shipped scene, by gait, through the
// scene's real sound graph (walls and doors included). Measured from each creature's spawn point in
// 72 directions: open air must match 20·log10 falloff to the creature's threshold exactly, and the
// slice's walls must cut it. The shipped numbers (starting knight in Medium armour, stone): the
// undead (45 dB) never hear a sneak or a walk, hear a run within 4 m and a sprint within 13 m;
// townsfolk and watchmen (30 dB) would hear a walk within 4 m, a run within 23 m and a sprint to 25 m (friends of the player ignore it: see footstep-stealth.test.ts).
import { loadGameContent } from '@content/game-content';
import { compileCreatures, materialPresets, STEALTH_ID } from '@content/index';
import { startMechanisms } from '@game/mechanisms/index';
import { LightSourceComponent } from '../../src/sim/light/components';
import {
  equipmentDb,
  INTERACTION_COMPONENTS,
  InMemoryColliderSink,
  loadScene,
  propagateNoise,
  registerCreatureComponents,
  registerSceneComponents,
  registerWorldProperties,
  installStimuli,
  soundGraphFromScene,
  stimulusSystem,
  World,
  worldPortalGain,
  type KitLookup,
} from '@sim/index';
import { describe, expect, it } from 'vitest';

const content = loadGameContent();
const stealth = content.get('stealth', STEALTH_ID);
const creatures = compileCreatures(content.all('creature'), content);
const kit: KitLookup = (id) => (content.has('kit', id) ? content.get('kit', id) : undefined);
const SCENES = [
  'slice',
  'skeleton-pen',
  'valley-01',
  'valley-02',
  'valley-03',
  'briar-glen-lane',
  'bridgeward-college',
  'marsh-store',
  'under-the-bridge',
  'sleeping-ox',
];
const KNIGHT_DB = equipmentDb(1.3);
const GAITS = {
  sneak: stealth.noise.footsteps.gaitDb.sneak,
  walk: stealth.noise.footsteps.gaitDb.walk,
  run: stealth.noise.footsteps.gaitDb.run,
  sprint: stealth.noise.footsteps.gaitDb.sprint,
} as const;

describe('footstep reach on shipped scenes (mw-e09.5)', () => {
  it('a skeleton never hears a walking or sneaking knight; a run carries 4 m, a sprint 13 m; walls shorten it', () => {
    const rows: string[] = [];
    const walled: string[] = [];
    for (const id of SCENES) {
      const world = installStimuli(
        registerWorldProperties(registerSceneComponents(new World<never>({ seed: 9 }))),
      );
      world.register(...INTERACTION_COMPONENTS);
      registerCreatureComponents(world);
      world.addSystem(stimulusSystem());
      world.register(LightSourceComponent);
      const colliders = new InMemoryColliderSink();
      const scene = content.get('scene', id);
      const loaded = loadScene(world, scene, kit, colliders);
      if (scene.acoustics !== undefined)
        startMechanisms(world, loaded, {
          content,
          materials: materialPresets(content.all('material')),
          colliders,
          occluders: new InMemoryColliderSink(),
        });
      const graph = soundGraphFromScene(scene, loaded);
      const gain = worldPortalGain(world, stealth.noise, (p) => content.get('door', p).material.id);
      for (const spawn of loaded.layout.spawns) {
        if (spawn.creature === undefined) continue;
        const hearing = creatures.get(spawn.creature)?.senses.hearing;
        if (hearing === undefined) continue;
        for (const [gait, db] of Object.entries(GAITS)) {
          const loudness = db + KNIGHT_DB;
          let min = Infinity;
          let max = 0;
          for (let a = 0; a < 72; a++) {
            const angle = (a / 72) * 2 * Math.PI;
            // The creature's ears are the listener; the knight walks out from it along the ray.
            let reach = 0;
            for (let d = 0.5; d <= hearing.range; d += 0.5) {
              const at = {
                x: spawn.position.x + Math.cos(angle) * d,
                y: spawn.position.y,
                z: spawn.position.z + Math.sin(angle) * d,
              };
              const heard = propagateNoise(graph, at, loudness, {
                tuning: stealth.noise,
                portalGain: gain,
              }).hear(spawn.position);
              if (heard !== null && heard.level >= hearing.thresholdDb) reach = d;
            }
            min = Math.min(min, reach);
            max = Math.max(max, reach);
          }
          // Open air: it carries to where 20·log10(d) drops it to the threshold, within the range.
          const open = Math.min(hearing.range, 10 ** ((loudness - hearing.thresholdDb) / 20));
          const expected = loudness < hearing.thresholdDb ? 0 : Math.floor(open * 2) / 2;
          expect(max, `${id} ${spawn.id} ${gait}`).toBeGreaterThanOrEqual(expected - 0.5);
          expect(max, `${id} ${spawn.id} ${gait}`).toBeLessThanOrEqual(expected + 0.5);
          if (scene.acoustics === undefined) expect(min).toBe(max);
          else if (gait === 'sprint') walled.push(`${String(min)}<${String(max)}`);
          rows.push(
            `${id}|${spawn.id}|${spawn.creature}|${gait}|${loudness.toFixed(1)}|${String(min)}|${String(max)}`,
          );
        }
      }
    }
    expect(rows.length).toBeGreaterThan(0);
    // The slice's walls shorten how far a sprint carries to its skeleton in some directions.
    expect(walled.length).toBeGreaterThan(0);
    for (const range of walled) {
      const [low, high] = range.split('<').map(Number);
      expect(low).toBeLessThan(high ?? 0);
    }
  });
});
