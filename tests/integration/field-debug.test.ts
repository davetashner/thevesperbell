// @vitest-environment happy-dom
// mw-e03.29: the field debug overlay over a real sim: the console's `stim` and `inspect set` go in
// as sim commands, the overlay shows the result on the frame after the tick, and nothing it does
// writes the sim.
import {
  addProperties,
  elementFieldOf,
  getProperty,
  hashWorld,
  installDebugCommands,
  installElementField,
  installStimuli,
  propertyChanged,
  placeEntity,
  readProperty,
  registerWorldProperties,
  stimulusSystem,
  World,
  type PropertyChange,
} from '@sim/index';
import { describe, expect, it } from 'vitest';
import type { ConsoleHost } from '../../src/tools/console/builtins';
import { createGameHost } from '../../src/tools/console/host';
import { CommandRegistry } from '../../src/tools/console/registry';
import { registerFieldDebugCommands } from '../../src/tools/field-debug/commands';
import { FieldDebug } from '../../src/tools/field-debug/controller';

function setup() {
  const world = installElementField(
    installStimuli(registerWorldProperties(new World<unknown>({ seed: 11 }))),
  );
  installDebugCommands(world, { spawners: new Map() });
  world.addSystem(stimulusSystem());
  const queue: unknown[] = [];
  const registry = new CommandRegistry<ConsoleHost>({
    ...createGameHost({
      world: world,
      submit: (command) => queue.push(command),
      player: () => undefined,
      spawnables: [],
      bookmarks: () => new Map(),
      scenes: [],
      loadScene: () => undefined,
      loop: { timeScale: 1 },
    }),
    cursorPoint: () => ({ x: 0, y: 0.25, z: 0 }),
  });
  const sim = world as unknown as World<never>;
  const debug = new FieldDebug({ world: sim, viewer: () => ({ x: 0, y: 1, z: 3 }) });
  registerFieldDebugCommands(registry, {
    debug,
    crosshair: () => undefined,
    isAlive: (entity) => world.isAlive(entity),
  });
  const tick = (): void => {
    world.step(queue.splice(0));
  };
  return { world, sim, registry, debug, tick };
}

describe('field debug overlay (mw-e03.29)', () => {
  it('AC-1: with the overlay on temperature, a spawned heat stimulus shows the hot region on the next frame', () => {
    const { registry, debug, tick, sim } = setup();
    registry.execute('fields temperature');
    tick();
    expect(debug.frame()?.view?.cells).toEqual([]);
    expect(registry.execute('stim heat 500 2').ok).toBe(true);
    tick();
    const cells = debug.frame()?.view?.cells ?? [];
    expect(cells.length).toBeGreaterThan(8);
    const field = elementFieldOf(sim);
    // Every drawn cell is really warmer than ambient in the field, and the centre is the hottest.
    for (const cell of cells) {
      expect(field.readAt('temperature', cell)).toBeGreaterThan(20);
    }
    const hottest = cells.reduce((a, b) => (b.value > a.value ? b : a));
    expect(Math.hypot(hottest.x, hottest.y - 0.25, hottest.z)).toBeLessThan(0.8);
    expect(debug.frame()?.panel.sections[0]?.lines[0]).toMatch(/cells, peak/);
  });

  it('AC-2: editing wetness to 1.0 in the inspector shows in the sim next tick and fires propertyChanged', () => {
    const { world, sim, registry, debug, tick } = setup();
    const crate = world.spawn();
    addProperties(sim, crate, { wetness: 0 });
    placeEntity(sim, crate, { x: 0, y: 0, z: 0 }, 0.5);
    tick();
    const changes: PropertyChange[] = [];
    world.events.on(propertyChanged, (change) => changes.push(change));
    registry.execute(`inspect ${String(crate)}`);
    expect(debug.frame()?.panel.sections[0]?.lines).toContain('wetness = 0');
    expect(registry.execute('inspect set wetness 1.0').ok).toBe(true);
    // The command is queued, not applied: the sim has not changed yet.
    expect(getProperty(sim, crate, 'wetness')).toBe(0);
    tick();
    expect(readProperty(sim, crate, 'wetness')).toBe(1);
    expect(changes.map((c) => [c.entity, c.key, c.old, c.new])).toEqual([[crate, 'wetness', 0, 1]]);
    expect(debug.frame()?.panel.sections[0]?.lines).toContain('wetness = 1');
  });

  it('reads the sim without changing it, whatever the layer', () => {
    const a = setup();
    const b = setup();
    for (const s of [a, b]) {
      s.registry.execute('stim heat 300 2');
      s.registry.execute('stim water 1 2');
      s.tick();
    }
    for (const layer of ['temperature', 'moisture', 'gas', 'charge', 'light', 'off']) {
      a.registry.execute(`fields ${layer}`);
      a.debug.frame();
      a.registry.execute('inspect none');
    }
    a.tick();
    b.tick();
    expect(hashWorld(a.sim)).toBe(hashWorld(b.sim));
  });
});
