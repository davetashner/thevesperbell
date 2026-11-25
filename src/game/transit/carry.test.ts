import {
  addInventory,
  EQUIPMENT_SLOTS,
  HealthComponent,
  EquipmentComponent,
  QuickSlotsComponent,
  areaTransition,
  InventoryComponent,
  inventoryOf,
  DEFAULT_CLOCK_CONFIG,
  gameClockOf,
  installGameClock,
  PlayerClassComponent,
  registerPersistence,
  World,
} from '@sim/index';
import { describe, expect, it, vi } from 'vitest';
import { createGameSaveRegistry } from '../save/sections';
import { applyCarriedPlayer, applyCarriedWorld, captureCarry, carriedClassId } from './carry';
import { TransitionController } from './controller';

const registry = createGameSaveRegistry();
const newWorld = () => registerPersistence(new World<never>({ seed: 1 }));

describe('transit carry (mw-e01.11)', () => {
  it('lifts the player’s pack onto another entity and drops items the build no longer defines', () => {
    const from = newWorld();
    const old = from.spawn();
    addInventory(from, old, 40);
    from.set(old, InventoryComponent, {
      ...(inventoryOf(from, old) ?? { gold: 0, nextInstanceId: 1, items: [] }),
      gold: 40,
      nextInstanceId: 3,
      items: [
        { instanceId: 1, defId: 'bread', count: 2, flags: {} },
        { instanceId: 2, defId: 'gone-item', count: 1, flags: {} },
      ],
    });
    from.register(EquipmentComponent, QuickSlotsComponent, HealthComponent);
    from.add(old, EquipmentComponent, {
      classId: 'knight',
      slots: Object.fromEntries(EQUIPMENT_SLOTS.map((slot) => [slot, null])),
    } as never);
    from.add(old, QuickSlotsComponent, { slots: [null], busyUntil: 0 });
    from.register(PlayerClassComponent);
    from.add(old, PlayerClassComponent, { classId: 'knight' });
    const carry = captureCarry(from, old, registry);
    expect(carry.player.equipment).toBeDefined();
    expect(carry.player.quickSlots).toBeDefined();
    expect(carriedClassId(carry)).toBe('knight');
    expect(carriedClassId({ ...carry, player: { components: {} } })).toBeUndefined();

    const to = newWorld();
    to.spawn();
    const fresh = to.spawn();
    addInventory(to, fresh);
    const warn = vi.fn();
    applyCarriedPlayer(to, fresh, carry, { registry, knownItem: (id) => id !== 'gone-item', warn });
    // Equipment and quick slots go back too (no item check: the slots here hold nothing).
    const again = to.spawn();
    applyCarriedPlayer(to, again, carry, { registry });
    expect(to.get(again, QuickSlotsComponent)).toEqual({ slots: [null], busyUntil: 0 });
    expect(inventoryOf(to, fresh)?.gold).toBe(40);
    expect(inventoryOf(to, fresh)?.items.map((i) => i.defId)).toEqual(['bread']);
    expect(to.get(fresh, PlayerClassComponent)).toEqual({ classId: 'knight' });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('gone-item'));
  });

  it('applies the carried facts, and drops a damaged section with a warning', () => {
    const from = newWorld();
    const player = from.spawn();
    const carry = captureCarry(from, player, registry);
    const warn = vi.fn();
    const to = newWorld();
    applyCarriedWorld(
      to,
      { ...carry, sections: { 'world-facts': { facts: 7 }, merchants: 5 } },
      {
        registry,
        warn,
      },
    );
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('"world-facts"'));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('"merchants"'));
    // No warn function: damaged data is dropped quietly.
    applyCarriedWorld(to, { ...carry, sections: { merchants: 5 } }, { registry });
    applyCarriedPlayer(to, to.spawn(), carry, { registry });
    const withItem = {
      ...carry,
      player: {
        components: {},
        inventory: {
          gold: 0,
          nextInstanceId: 2,
          items: [{ instanceId: 1, defId: 'x', count: 1, flags: {} }],
        },
      },
    };
    applyCarriedPlayer(to, to.spawn(), withItem, { registry, knownItem: () => false });
  });

  it('stays in the area, warning, when the carry cannot be made', () => {
    const world = newWorld();
    const player = world.spawn();
    const warn = vi.fn();
    const navigate = vi.fn();
    const broken = {
      get sections(): never {
        throw new Error('boom');
      },
    } as unknown as typeof registry;
    const controller = new TransitionController({
      world,
      player,
      registry: broken,
      areaName: () => 'B',
      session: { getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() },
      now: () => 0,
      navigate,
      search: () => '',
      overlayParent: {} as HTMLElement,
      warn,
    });
    world.events.emit(areaTransition, {
      tick: 0,
      from: 'a',
      transition: 't',
      scene: 'b',
      spawn: 's',
      follow: false,
      entity: player,
    });
    world.step();
    controller.afterStep();
    expect(controller.leaving).toBe(false);
    expect(navigate).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('boom'));
    // Idle afterStep with nothing pending.
    controller.afterStep();
  });

  describe('a leg that takes game time (mw-e25.14)', () => {
    const cross = (world: World<never>, player: number, advanceMinutes?: number) => {
      const stored = new Map<string, string>();
      const controller = new TransitionController({
        world,
        player,
        registry,
        areaName: () => 'Kestrel Lock',
        session: {
          getItem: (key) => stored.get(key) ?? null,
          setItem: (key, value) => void stored.set(key, value),
          removeItem: (key) => void stored.delete(key),
        },
        now: () => 0,
        navigate: vi.fn(),
        search: () => '',
        overlayParent: {} as HTMLElement,
      });
      world.events.emit(areaTransition, {
        tick: 0,
        from: 'under-the-bridge',
        transition: 'towpath-down',
        scene: 'kestrel-lock',
        spawn: 'arrive-from-upriver',
        follow: false,
        ...(advanceMinutes !== undefined && { advanceMinutes }),
        entity: player,
      });
      world.step();
      controller.afterStep();
      return { controller, stored };
    };

    it('AC-1: crossing a towpath transition advances the clock by exactly 6 hours via advanceTime', () => {
      const world = newWorld();
      const player = world.spawn();
      const clock = installGameClock(world, DEFAULT_CLOCK_CONFIG);
      const before = clock.total();
      const { controller, stored } = cross(world, player, 360);
      expect(controller.leaving).toBe(true);
      // One world step ran in the helper: at most a few ticks on top of the 360 minutes.
      expect(clock.total() - before).toBe(360);
      // The carry was made after the jump, so the facts that cross already say how late it is.
      const carried = JSON.parse([...stored.values()][0] ?? '{}') as {
        carry: { sections: Record<string, unknown> };
      };
      expect(JSON.stringify(carried.carry.sections)).toContain('time.minute');
    });

    it('a transition with no advance leaves the clock alone, and a world with no clock still crosses', () => {
      const world = newWorld();
      const player = world.spawn();
      const clock = installGameClock(world, DEFAULT_CLOCK_CONFIG);
      const before = clock.total();
      cross(world, player);
      expect(clock.total()).toBe(before);
      expect(gameClockOf(world)).toBe(clock);
      const bare = newWorld();
      const walker = bare.spawn();
      expect(cross(bare, walker, 360).controller.leaving).toBe(true);
    });
  });
});
