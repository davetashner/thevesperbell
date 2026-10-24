// Ember through the game's own wiring (mw-e06.15): installGamePhysics with the spell pipeline before
// the stimulus system and the fire rules after it, Rapier physics, a prop crate from content, the
// controller's cast command. The e2e (e2e/spell-cast.spec.ts) does the same in a browser.
import * as RAPIER from '@dimforge/rapier3d-deterministic';
import { describe, expect, it } from 'vitest';
import { loadGameContent, materialPresets } from '@content/index';
import {
  actionButton,
  actionFrame,
  actionVector,
  addPropPhysics,
  DAMAGE_COMPONENTS,
  DamageModel,
  fireIgnited,
  HIT_VOLUME_COMPONENTS,
  learnSpellCommand,
  placeEntity,
  RapierCollisionWorld,
  RapierPhysics,
  readProperty,
  SpellHit,
  World,
  type ActionFrame,
  type EntityId,
} from '@sim/index';
import { installGameFire } from '../fire';
import { installGamePhysics, propBodies } from '../physics-objects';
import { installGameMagic, givePlayerMana } from './install';
import { SpellCaster, type SpellCommand } from './caster';

type Input = ActionFrame | SpellCommand | ReturnType<typeof learnSpellCommand>;

describe('Ember in the game world (mw-e06.15)', () => {
  it('a cast at a crate on the floor sets it alight', () => {
    const content = loadGameContent();
    const physics = new RapierPhysics(RAPIER);
    const world = new World<Input>({ seed: 3, physics });
    world.register(...DAMAGE_COMPONENTS, ...HIT_VOLUME_COMPONENTS);
    const collision = new RapierCollisionWorld(physics);
    installGamePhysics(world, {
      beforeStimuli: (sim) => {
        installGameMagic(sim, {
          spells: content.all('spell'),
          damage: new DamageModel(),
          collision,
          invulnerable: () => false,
        });
      },
      afterStimuli: (sim) => {
        installGameFire(sim, content);
      },
    });
    physics.add({ kind: 'box', min: { x: -20, y: -1, z: -20 }, max: { x: 20, y: 0, z: 20 } });
    const sim = world as unknown as World<never>;
    const crate = sim.spawn();
    const props = propBodies(content);
    const body = props('crate');
    if (body === undefined) throw new Error('no crate body');
    addPropPhysics(
      sim,
      crate,
      body,
      materialPresets(content.all('material')),
      {
        x: 0,
        y: 0,
        z: -4,
      },
      undefined,
      { temperature: 20 },
    );
    const player = world.spawn();
    placeEntity(world, player, { x: 0, y: 0, z: 0 }, 0.4);
    givePlayerMana(world, player, 20);
    world.step([]);
    const pipelineSpells = (id: string) => content.all('spell').find((s) => s.id === id);
    const caster = new SpellCaster({ world, caster: player, spells: pipelineSpells, collision });
    world.step([learnSpellCommand(player, 'ember')]);
    const hits: (EntityId | null)[] = [];
    world.events.on(SpellHit, (hit) => hits.push(hit.target));
    const lit: EntityId[] = [];
    world.events.on(fireIgnited, (e) => lit.push(e.entity));
    // A camera 3 m behind the player level with the crate's middle, looking straight ahead.
    const ray = () => ({ origin: { x: 0, y: 0.35, z: 3 }, direction: { x: 0, y: 0, z: -1 } });
    const press = actionFrame({
      move: actionVector(0, 0),
      look: actionVector(0, 0),
      buttons: (a) => actionButton(a === 'cast', a === 'cast', false),
    });
    const idle = actionFrame({
      move: actionVector(0, 0),
      look: actionVector(0, 0),
      buttons: () => actionButton(false, false, false),
    });
    world.step([press, ...caster.commands(press, ray)]);
    for (let i = 0; i < 200 && lit.length === 0; i++) world.step([idle]);
    expect(hits).toContain(crate);
    expect(readProperty(sim, crate, 'burning')).toBe(true);
    expect(lit).toContain(crate);
  });
});
