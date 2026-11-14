// mw-e03.24: creatures and the player are part of the same world. The game's real content and fire
// rules (src/game/fire.ts) drive the slice's skeleton, a forgotten-miner carrying the rusted gallery
// key: it freezes, burns and shatters by the rules objects use, with no per-creature element script.
import * as RAPIER from '@dimforge/rapier3d-deterministic';
import { markExercised } from '@content/testing';
import {
  actorShattered,
  addEquipment,
  emptySlots,
  EquipmentComponent,
  applyStimulus,
  BrainComponent,
  CharacterController,
  CreatureComponent,
  DamageApplied,
  Died,
  fireIgnited,
  forEachWithProperty,
  frozenSolid,
  getProperty,
  HealthComponent,
  itemDropped,
  PlacementComponent,
  placeEntity,
  readProperty,
  thawed,
  type EntityId,
  type World,
} from '@sim/index';
import { createGameWorld } from '@tools/replay/testbed-player-scenario';
import { describe, expect, it, vi } from 'vitest';

// Whole-world runs: slow under coverage and on a loaded runner.
vi.setConfig({ testTimeout: 120_000 });

const HZ = 60;

function slice() {
  const game = createGameWorld<never>(RAPIER, {
    seed: 1,
    hz: HZ,
    scene: 'slice',
    magic: true,
  });
  const world: World<never> = game.world;
  const [skeleton] = game.sceneCreatures.entities;
  if (skeleton === undefined) throw new Error('the slice has no creature');
  world.step();
  world.step();
  return { game, world, skeleton };
}

const step = (world: World<never>, n: number) => {
  for (let i = 0; i < n; i++) world.step();
};

describe('creatures and the player in the element rules (mw-e03.24)', () => {
  it('AC-3: a skeleton hit by cold freezes solid, stops thinking, shatters and dies as usual with its key', ({
    task,
  }) => {
    markExercised(task, 'creature', 'forgotten-miner');
    const { game, world, skeleton } = slice();
    expect(readProperty(world, skeleton, 'conductive')).toBe(true); // flesh: the same rules as a prop
    const frozen: EntityId[] = [];
    const dead: EntityId[] = [];
    const shattered: EntityId[] = [];
    const dropped: string[] = [];
    world.events.on(frozenSolid, (e) => frozen.push(e.entity));
    world.events.on(Died, (e) => dead.push(e.target));
    world.events.on(actorShattered, (e) => shattered.push(e.entity));
    world.events.on(itemDropped, (e) => dropped.push(e.defId));
    applyStimulus(world, {
      shape: { kind: 'contact', target: skeleton },
      element: 'cold',
      intensity: 60,
    });
    step(world, 2);
    expect(frozen).toEqual([skeleton]);
    const thought = world.get(skeleton, BrainComponent)?.thoughtTick;
    step(world, 120);
    expect(world.get(skeleton, BrainComponent)?.thoughtTick).toBe(thought); // frozen: it does not think
    game.combat.damage.apply(world, skeleton, { amounts: { slash: 15 }, instigator: game.player });
    step(world, 3);
    expect(shattered).toEqual([skeleton]);
    expect(dead).toEqual([skeleton]); // Died fires: dissolve, loot, music
    expect(world.get(skeleton, HealthComponent)?.current).toBe(0);
    expect(dropped).toContain('rusted-gallery-key');
  });

  it('AC-3: a frozen skeleton thaws by itself after its ice and goes back to thinking', () => {
    const { world, skeleton } = slice();
    const thawedAt: EntityId[] = [];
    world.events.on(thawed, (e) => thawedAt.push(e.entity));
    applyStimulus(world, {
      shape: { kind: 'contact', target: skeleton },
      element: 'cold',
      intensity: 60,
    });
    step(world, 6 * HZ + 30);
    expect(thawedAt).toEqual([skeleton]);
    expect(readProperty(world, skeleton, 'frozen')).toBe(false);
  });

  it('AC-4: a burning creature takes one fire pulse per 250 ms however many flames reach it, and is not destroyed', () => {
    const { world, skeleton } = slice();
    const ignited: EntityId[] = [];
    world.events.on(fireIgnited, (e) => ignited.push(e.entity));
    const hitsPerTick = new Map<number, number>();
    let burned = 0;
    world.events.on(DamageApplied, (r) => {
      if (r.target !== skeleton || !r.tags.includes('environment')) return;
      hitsPerTick.set(r.tick, (hitsPerTick.get(r.tick) ?? 0) + 1);
      burned += r.total;
    });
    applyStimulus(world, {
      shape: { kind: 'contact', target: skeleton },
      element: 'heat',
      intensity: 500,
    });
    step(world, 10 * HZ);
    expect(ignited).toEqual([skeleton]);
    expect(Math.max(...hitsPerTick.values())).toBe(1);
    expect(world.isAlive(skeleton)).toBe(true);
    expect(readProperty(world, skeleton, 'burning')).toBe(false); // its 6 s ran out
    // 8 fire per second for the 6 s it burned (and a pulse of rounding), no more.
    expect(burned).toBeGreaterThanOrEqual(8 * 5.5);
    expect(burned).toBeLessThanOrEqual(8 * 6.5);
  });

  it('a wall torch does not light a creature or the player standing at it: only the torch hurts, as before', () => {
    const { game, world, skeleton } = slice();
    const torches: { at: { x: number; y: number; z: number }; radius: number }[] = [];
    forEachWithProperty(world, 'burning', (entity, on) => {
      const at = world.get(entity, PlacementComponent);
      const radius = getProperty(world, entity, 'flameRadius');
      if (on && at !== undefined && radius !== undefined && radius > 0)
        torches.push({ at, radius });
    });
    const torch = torches[0];
    if (torch === undefined) throw new Error('the slice has no open flame');
    const lit: EntityId[] = [];
    world.events.on(fireIgnited, (e) => lit.push(e.entity));
    const spot = {
      x: torch.at.x + torch.radius / 2,
      y: Math.max(0, torch.at.y - 1),
      z: torch.at.z,
    };
    for (let i = 0; i < 4 * HZ; i++) {
      placeEntity(world, skeleton, spot, 0.35);
      const character = world.get(game.player, CharacterController);
      if (character !== undefined) {
        world.set(game.player, CharacterController, { ...character, position: spot });
      }
      world.step();
    }
    expect(lit).toEqual([]);
    expect(readProperty(world, skeleton, 'temperature')).toBeLessThan(
      readProperty(world, skeleton, 'ignitionPoint'),
    );
  });

  it('creatures in idle scenes never take environmental damage or catch fire', () => {
    for (const scene of ['slice']) {
      const game = createGameWorld<never>(RAPIER, { seed: 1, hz: HZ, scene, magic: true });
      const world: World<never> = game.world;
      const harmed: string[] = [];
      world.events.on(DamageApplied, (r) => {
        if (r.tags.includes('environment')) harmed.push(`${scene}:${String(r.target)}`);
      });
      world.events.on(fireIgnited, (e) => {
        if (world.has(e.entity, CreatureComponent)) harmed.push(`${scene}:lit ${String(e.entity)}`);
      });
      step(world, 10 * HZ);
      expect(harmed).toEqual([]);
    }
  }, 120_000);

  it("AC-5: the player in the shipped iron mail conducts, in the game's content, and not without it", () => {
    const { game, world } = slice();
    const { player } = game;
    if (!world.isRegistered(EquipmentComponent)) world.register(EquipmentComponent);
    if (world.get(player, EquipmentComponent) === undefined) addEquipment(world, player, 'knight');
    world.step();
    const wear = (defId: string | null) => {
      const current = world.get(player, EquipmentComponent);
      if (current === undefined) throw new Error('no equipment');
      const body = defId === null ? null : { instanceId: 900, defId };
      world.set(player, EquipmentComponent, { ...current, slots: { ...emptySlots(), body } });
      step(world, 2);
    };
    wear(null);
    const base = readProperty(world, player, 'conductive');
    wear('mail-hauberk'); // worldProperties.material: iron
    expect(readProperty(world, player, 'conductive')).toBe(true);
    wear('leather-jerkin');
    expect(readProperty(world, player, 'conductive')).toBe(base);
  });
});
