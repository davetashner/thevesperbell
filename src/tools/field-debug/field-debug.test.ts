// @vitest-environment happy-dom
import {
  addProperties,
  addSignalGraph,
  elementFieldOf,
  installElementField,
  installSignals,
  installStimuli,
  LightField,
  placeEntity,
  registerWorldProperties,
  setLever,
  signalSystem,
  stimCommand,
  stimulusSystem,
  installDebugCommands,
  World,
  type SignalGraphDef,
  type StimulusResolution,
} from '@sim/index';
import { PerspectiveCamera, Scene } from 'three';
import { describe, expect, it, vi } from 'vitest';
import { panelText } from '@render/debug/field-overlay';
import type { ConsoleHost } from '../console/builtins';
import { createGameHost } from '../console/host';
import { CommandRegistry } from '../console/registry';
import { registerFieldDebugCommands } from './commands';
import { FieldDebug, LIGHT_REFRESH_TICKS } from './controller';
import {
  fieldLayerView,
  FIELD_LAYERS,
  FIELD_RANGE,
  formatValue,
  inspectRows,
  LIGHT_RADIUS,
  lightLayerView,
  MAX_FIELD_CELLS,
  pickables,
  pickEntity,
  scaled,
  stimulusLine,
  stimulusLines,
  wireLines,
} from './model';
import { startFieldDebug } from './start';

const ORIGIN = { x: 0, y: 0, z: 0 };

/** Steps `world` with `commands` as inputs (a World<never> takes none by type; commands are JSON). */
function stepWith(world: World<never>, commands: readonly unknown[]): void {
  world.step(commands as never[]);
}

function makeWorld() {
  const world = installSignals(
    installElementField(installStimuli(registerWorldProperties(new World<never>({ seed: 4 })))),
  );
  installDebugCommands(world, { spawners: new Map() });
  world.addSystem(stimulusSystem());
  world.addSystem(signalSystem());
  return world;
}

describe('field layer view (mw-e03.29)', () => {
  it('lists the cells a heat stimulus warmed, nearest first, tinted hot', () => {
    const world = makeWorld();
    stepWith(world, [stimCommand('heat', ORIGIN, 2, 500)]);
    const view = fieldLayerView(elementFieldOf(world), 'temperature', ORIGIN);
    expect(view.layer).toBe('temperature');
    expect(view.cells.length).toBeGreaterThan(1);
    expect(view.peak).toBeGreaterThan(1);
    expect(view.truncated).toBe(false);
    expect(view.cells.every((cell) => cell.value > 0)).toBe(true);
    const distances = view.cells.map((cell) => Math.hypot(cell.x, cell.y, cell.z));
    expect([...distances].sort((a, b) => a - b)).toEqual(distances);
    // Hot is red-dominant.
    expect(((view.cells[0]?.colour ?? 0) >> 16) & 255).toBeGreaterThan(0x80);
  });

  it('tints cold blue, and skips cells beyond the range or below the floor', () => {
    const world = makeWorld();
    stepWith(world, [stimCommand('cold', ORIGIN, 2, 500)]);
    const field = elementFieldOf(world);
    const cold = fieldLayerView(field, 'temperature', ORIGIN);
    expect(cold.cells.every((cell) => cell.value < 0)).toBe(true);
    expect((cold.cells[0]?.colour ?? 0) & 255).toBeGreaterThan(0x80);
    const far = { x: FIELD_RANGE + 50, y: 0, z: 0 };
    expect(fieldLayerView(field, 'temperature', far).cells).toEqual([]);
    expect(fieldLayerView(field, 'moisture', ORIGIN).cells).toEqual([]);
  });

  it('draws moisture, charge and the thickest gas of each cell', () => {
    const world = makeWorld();
    stepWith(world, [stimCommand('water', ORIGIN, 2, 3), stimCommand('charge', ORIGIN, 2, 400)]);
    const field = elementFieldOf(world);
    field.addAt('gas:smoke', ORIGIN, 0.2);
    field.addAt('gas:steam', ORIGIN, 0.6);
    field.addAt('gas:steam', { x: 1, y: 0, z: 0 }, 0.4);
    field.addAt('gas:smoke', { x: 1, y: 0, z: 0 }, 0.1);
    expect(fieldLayerView(field, 'moisture', ORIGIN).cells.length).toBeGreaterThan(0);
    expect(fieldLayerView(field, 'charge', ORIGIN).cells.length).toBeGreaterThan(0);
    const gas = fieldLayerView(field, 'gas', ORIGIN);
    field.addAt('gas:smoke', { x: 2, y: 0, z: 0 }, 0.5);
    field.addAt('gas:steam', { x: 2, y: 0, z: 0 }, 0.1);
    const both = fieldLayerView(field, 'gas', ORIGIN);
    expect(gas.cells.map((cell) => Math.round(cell.value * 10) / 10)).toEqual([0.6, 0.4]);
    expect(both.cells.map((cell) => Math.round(cell.value * 10) / 10)).toEqual([0.6, 0.4, 0.5]);
  });

  it('keeps the nearest MAX_FIELD_CELLS and says so', () => {
    const world = makeWorld();
    const field = elementFieldOf(world);
    for (let x = 0; x < 20; x++) {
      for (let y = 0; y < 20; y++) {
        for (let z = 0; z < 6; z++) {
          field.addAt('moisture', { x: x * 0.5 - 5, y: y * 0.5, z: z * 0.5 }, 0.5);
        }
      }
    }
    const view = fieldLayerView(field, 'moisture', ORIGIN);
    expect(view.cells).toHaveLength(MAX_FIELD_CELLS);
    expect(view.truncated).toBe(true);
  });

  it('colours scale with strength', () => {
    expect(scaled(0xff0000, 0)).toBeLessThan(scaled(0xff0000, 1));
    expect(scaled(0xff0000, 5)).toBe(0xff0000);
    expect(scaled(0xff0000, -1)).toBe(scaled(0xff0000, 0));
  });
});

describe('light layer view', () => {
  it('samples a metre grid centred under the point and brightens with the level', () => {
    const levelAt = vi.fn((p: { x: number }) => (p.x > 0 ? 1 : 0));
    const view = lightLayerView({ levelAt }, { x: 0.2, y: 2, z: 0.2 });
    const side = 2 * LIGHT_RADIUS + 1;
    expect(view.cells).toHaveLength(side * side);
    expect(levelAt).toHaveBeenCalledTimes(side * side);
    expect(view.peak).toBe(1);
    expect(view.cells[0]?.y).toBeCloseTo(2.1);
    const dark = view.cells.find((cell) => cell.value === 0);
    const lit = view.cells.find((cell) => cell.value === 1);
    expect(dark?.colour).toBeLessThan(lit?.colour ?? 0);
    expect(view.layer).toBe('light');
  });
});

describe('inspector, timeline, wires and picking', () => {
  it('lists the properties an entity holds and formats records and numbers', () => {
    const world = makeWorld();
    const crate = world.spawn();
    addProperties(world, crate, {
      wetness: 0.12345,
      flammable: true,
      lightEmitter: { intensity: 80, radius: 6 },
    });
    world.step();
    expect(inspectRows(world, crate)).toEqual([
      { key: 'flammable', value: 'true' },
      { key: 'lightEmitter', value: '{"intensity":80,"radius":6}' },
      { key: 'wetness', value: '0.123' },
    ]);
    expect(inspectRows(world, 999)).toBeUndefined();
    expect(formatValue('x')).toBe('x');
  });

  it('prints stimulus resolutions newest first, with and without a centre', () => {
    const base = {
      tick: 3,
      amount: 12.5,
      hits: [{ entity: 1, falloff: 1, amount: 1 }],
    };
    const sphere = {
      ...base,
      stimulus: {
        element: 'heat',
        shape: { kind: 'sphere', center: { x: 1, y: 0.5, z: 2 }, radius: 2 },
      },
    } as unknown as StimulusResolution;
    const contact = {
      ...base,
      tick: 4,
      stimulus: { element: 'slash', shape: { kind: 'contact', entity: 2 } },
    } as unknown as StimulusResolution;
    expect(stimulusLine(sphere)).toBe('t3 heat 12.5 sphere @1,0.5,2 -> 1 hit');
    expect(stimulusLine(contact)).toBe('t4 slash 12.5 contact -> 1 hit');
    expect(stimulusLines([sphere, contact], 1)).toEqual([stimulusLine(contact)]);
    expect(stimulusLines([sphere, contact])).toEqual([stimulusLine(contact), stimulusLine(sphere)]);
  });

  it('lists live wires of each signal graph', () => {
    const world = makeWorld();
    expect(wireLines(world)).toEqual([]);
    const def: SignalGraphDef = {
      id: 'vault',
      nodes: [
        { id: 'a', kind: 'lever' },
        { id: 'inv', kind: 'not' },
      ] as SignalGraphDef['nodes'],
      wires: [{ from: 'a', to: 'inv' }],
    };
    const graph = addSignalGraph(world, def);
    world.step();
    expect(wireLines(world)[0]).toMatch(/^#\d+ vault: 1 wires, 1\/2 on \(inv\.out\)$/);
    setLever(world, graph, 'a', true);
    world.step();
    expect(wireLines(world)[0]).toMatch(/1\/2 on \(a\.out\)$/);
    const bare = new World<never>({ seed: 1 });
    expect(wireLines(bare)).toEqual([]);
  });

  it('picks the nearest placed entity with properties along a ray', () => {
    const world = makeWorld();
    const near = world.spawn();
    const far = world.spawn();
    const bare = world.spawn();
    for (const [e, z] of [
      [near, -3],
      [far, -8],
      [bare, -1],
    ] as const)
      placeEntity(world, e, { x: 0, y: 1, z }, 0.3);
    addProperties(world, near, { wetness: 0 });
    addProperties(world, far, { wetness: 0 });
    world.step();
    const list = pickables(world);
    expect(list.map((p) => p.entity)).toEqual([near, far]);
    const ray = { origin: { x: 0, y: 1, z: 0 }, direction: { x: 0, y: 0, z: -1 } };
    expect(pickEntity(ray, list)).toBe(near);
    expect(pickEntity({ ...ray, direction: { x: 0, y: 0, z: 1 } }, list)).toBeUndefined();
    expect(pickEntity({ ...ray, direction: { x: 1, y: 0, z: 0 } }, list)).toBeUndefined();
    expect(pickEntity(ray, [])).toBeUndefined();
    expect(pickEntity(ray, [{ entity: 7, x: 5, y: 1, z: -3, radius: 0.3 }])).toBeUndefined();
    expect(pickables(new World<never>({ seed: 1 }))).toEqual([]);
  });
});

function session() {
  const world = makeWorld();
  const submitted: unknown[] = [];
  const registry = new CommandRegistry<ConsoleHost>({
    ...createGameHost({
      world,
      submit: (c) => submitted.push(c),
      player: () => undefined,
      spawnables: [],
      bookmarks: () => new Map(),
      scenes: [],
      loadScene: () => undefined,
      loop: { timeScale: 1 },
    }),
    cursorPoint: () => ({ x: 1, y: 0.5, z: -2 }),
  });
  const debug = new FieldDebug({
    world,
    light: new LightField(),
    viewer: () => ORIGIN,
  });
  const pick = vi.spyOn(debug, 'pick');
  registerFieldDebugCommands(registry, {
    debug,
    crosshair: () => ({ origin: { x: 0, y: 1, z: 0 }, direction: { x: 0, y: 0, z: -1 } }),
    isAlive: (e) => world.isAlive(e),
  });
  return { world, registry, debug, submitted, pick };
}

describe('field debug controller', () => {
  it('is off by default: no frame, nothing listening', () => {
    const { debug, world } = session();
    expect(debug.enabled).toBe(false);
    expect(debug.frame()).toBeUndefined();
    const listeners = world.events;
    expect(listeners).toBeDefined();
    debug.dispose();
  });

  it('shows a layer, with a legend and the stimuli it saw since it came on', () => {
    const { debug, world } = session();
    debug.layer = 'temperature';
    expect(debug.frame()?.view?.cells).toEqual([]);
    stepWith(world, [stimCommand('heat', ORIGIN, 2, 500)]);
    const frame = debug.frame();
    expect(frame?.view?.cells.length).toBeGreaterThan(0);
    expect(frame?.panel.sections[0]?.heading).toBe('layer: temperature');
    expect(frame?.panel.sections[0]?.lines[0]).toMatch(/\d+ cells, peak/);
    const stimuli = frame?.panel.sections.find((s) => s.heading.startsWith('stimuli'));
    expect(stimuli?.lines[0]).toContain('heat');
    debug.layer = undefined;
    expect(debug.frame()).toBeUndefined();
    stepWith(world, [stimCommand('heat', ORIGIN, 2, 500)]);
    debug.layer = 'moisture';
    expect(debug.frame()?.panel.sections[1]?.lines).toEqual([]);
    debug.dispose();
    expect(debug.enabled).toBe(false);
  });

  it('says in the legend when only the nearest cells are shown', () => {
    const { debug, world } = session();
    const field = elementFieldOf(world);
    for (let x = 0; x < 20; x++) {
      for (let y = 0; y < 20; y++) {
        for (let z = 0; z < 6; z++)
          field.addAt('moisture', { x: x * 0.5, y: y * 0.5, z: z * 0.5 }, 0.5);
      }
    }
    debug.layer = 'moisture';
    expect(debug.frame()?.panel.sections[0]?.lines[0]).toContain('(nearest shown)');
  });

  it('says so when a scene has no element field or no light', () => {
    const bare = new World<never>({ seed: 1 });
    const debug = new FieldDebug({ world: bare, viewer: () => ORIGIN });
    debug.layer = 'gas';
    expect(debug.frame()?.panel.sections[0]?.lines).toEqual(['no element field in this scene']);
    debug.layer = 'light';
    expect(debug.frame()?.view).toBeUndefined();
    expect(debug.frame()?.panel.sections[0]?.lines).toEqual(['no light field in this scene']);
  });

  it('caches the light grid until the cursor moves a metre or LIGHT_REFRESH_TICKS pass', () => {
    const world = makeWorld();
    const levelAt = vi.fn(() => 0.5);
    let cursor = { x: 0.5, y: 0, z: 0.5 };
    const debug = new FieldDebug({
      world,
      light: { levelAt },
      viewer: () => ORIGIN,
      cursorPoint: () => cursor,
    });
    debug.layer = 'light';
    debug.frame();
    const once = levelAt.mock.calls.length;
    debug.frame();
    expect(levelAt.mock.calls.length).toBe(once);
    cursor = { x: 5.5, y: 0, z: 0.5 };
    debug.frame();
    expect(levelAt.mock.calls.length).toBe(2 * once);
    for (let i = 0; i < LIGHT_REFRESH_TICKS; i++) world.step();
    debug.frame();
    expect(levelAt.mock.calls.length).toBe(3 * once);
    // No cursor: under the viewer.
    const viewerOnly = new FieldDebug({ world, light: { levelAt }, viewer: () => ORIGIN });
    viewerOnly.layer = 'light';
    expect(viewerOnly.frame()?.view?.layer).toBe('light');
  });

  it('inspects an entity and lists its properties, gone once it is destroyed', () => {
    const { debug, world } = session();
    const crate = world.spawn();
    const empty = world.spawn();
    addProperties(world, crate, { wetness: 0.5 });
    world.step();
    debug.selected = crate;
    expect(debug.frame()?.panel.sections[0]?.lines).toEqual([
      'wetness = 0.5',
      'edit: inspect set <key> <value>',
    ]);
    debug.selected = empty;
    expect(debug.frame()?.panel.sections[0]?.lines).toEqual(['no world properties']);
    world.destroy(crate);
    world.step();
    debug.selected = crate;
    expect(debug.frame()?.panel.sections[0]?.lines).toEqual(['gone']);
  });

  it('shows signal wires and picks under a ray', () => {
    const { debug, world } = session();
    const crate = world.spawn();
    addProperties(world, crate, { wetness: 0.5 });
    placeEntity(world, crate, { x: 0, y: 1, z: -3 }, 0.3);
    addSignalGraph(world, {
      id: 'g',
      nodes: [{ id: 'a', kind: 'lever' }],
      wires: [],
    } as unknown as SignalGraphDef);
    world.step();
    const ray = { origin: { x: 0, y: 1, z: 0 }, direction: { x: 0, y: 0, z: -1 } };
    expect(debug.pick({ ...ray, direction: { x: 0, y: 0, z: 1 } })).toBeUndefined();
    expect(debug.selected).toBeUndefined();
    expect(debug.pick(ray)).toBe(crate);
    expect(debug.selected).toBe(crate);
    expect(debug.frame()?.panel.sections.some((s) => s.heading === 'signal wires')).toBe(true);
  });
});

describe('field debug console commands', () => {
  it('fields shows a layer or off, and rejects unknown layers with a hint', () => {
    const { registry, debug } = session();
    expect(registry.execute('fields').lines).toEqual(['fields off · inspecting none']);
    for (const layer of FIELD_LAYERS) {
      expect(registry.execute(`fields ${layer}`).lines).toEqual([
        `fields ${layer} · inspecting none`,
      ]);
      expect(debug.layer).toBe(layer);
    }
    registry.execute('fields off');
    expect(debug.layer).toBeUndefined();
    const bad = registry.execute('fields temprature');
    expect(bad.ok).toBe(false);
    expect(bad.lines[0]).toContain('layers: temperature, moisture, gas, charge, light, off');
    expect(registry.execute('fields zzzzzzzzzzzz').lines[0]).toContain(
      'unknown layer "zzzzzzzzzzzz"',
    );
  });

  it('inspect selects by id or crosshair, clears, and edits through a sim command', () => {
    const { registry, debug, world, submitted, pick } = session();
    const crate = world.spawn();
    addProperties(world, crate, { wetness: 0 });
    placeEntity(world, crate, { x: 0, y: 1, z: -3 }, 0.3);
    world.step();
    expect(registry.execute('inspect').ok).toBe(true);
    expect(pick).toHaveBeenCalledOnce();
    expect(debug.selected).toBe(crate);
    registry.execute('inspect none');
    expect(debug.selected).toBeUndefined();
    expect(registry.execute(`inspect ${String(crate)}`).lines).toEqual([
      `fields off · inspecting #${String(crate)}`,
    ]);
    expect(registry.execute('inspect 9999').lines).toEqual(['no entity 9999']);
    expect(registry.execute('inspect x').ok).toBe(false);
    expect(registry.execute(`inspect ${String(crate)} 3`).ok).toBe(false);
    expect(registry.execute('inspect set wetness 1').lines).toEqual([
      `entity ${String(crate)}: wetness = 1`,
    ]);
    expect(submitted).toEqual([
      { kind: 'sim.debug', op: 'property', target: crate, key: 'wetness', value: 1 },
    ]);
    expect(registry.execute('inspect set wetness').ok).toBe(false);
    expect(registry.execute('inspect set wetness 5').lines[0]).toContain('wetness');
    expect(registry.execute('inspect set nonsense 5').ok).toBe(false);
    registry.execute('inspect none');
    expect(registry.execute('inspect set wetness 1').lines).toEqual([
      'nothing inspected: inspect <id> first',
    ]);
    // Nothing under the crosshair.
    world.destroy(crate);
    world.step();
    expect(registry.execute('inspect').lines).toEqual([
      'no entity with properties under the crosshair',
    ]);
  });

  it('stim submits a stimulus command at the cursor and validates it', () => {
    const { registry, submitted } = session();
    expect(registry.execute('stim heat 500').lines[0]).toContain('heat 500 radius 2 m at 1 0.5 -2');
    expect(registry.execute('stim water 1 3').ok).toBe(true);
    expect(submitted).toEqual([
      stimCommand('heat', { x: 1, y: 0.5, z: -2 }, 2, 500),
      stimCommand('water', { x: 1, y: 0.5, z: -2 }, 3, 1),
    ]);
    expect(registry.execute('stim force 5').ok).toBe(false);
    expect(registry.execute('stim heat 5 99').ok).toBe(false);
    expect(registry.execute('stim heat').ok).toBe(false);
    expect(registry.complete('stim ').options).toContain('heat');
  });

  it('stim falls back to the spawn point when nothing is under the cursor', () => {
    const world = makeWorld();
    const submitted: unknown[] = [];
    const host = createGameHost({
      world,
      submit: (c) => submitted.push(c),
      player: () => undefined,
      spawnables: [],
      bookmarks: () => new Map(),
      scenes: [],
      loadScene: () => undefined,
      loop: { timeScale: 1 },
    });
    const registry = new CommandRegistry<ConsoleHost>(host);
    registerFieldDebugCommands(registry, {
      debug: new FieldDebug({ world, viewer: () => ORIGIN }),
      crosshair: () => undefined,
      isAlive: () => true,
    });
    expect(registry.execute('stim cold 5').ok).toBe(true);
    expect(registry.execute('inspect').ok).toBe(false);
    expect(submitted).toHaveLength(1);
    expect(registry.complete('inspect ').options).toEqual(['none', 'set']);
    expect(registry.complete('inspect set ').options).toContain('wetness');
    expect(registry.complete('inspect set wetness ').options).toEqual([]);
    expect(registry.complete('fields ').options).toContain('light');
    expect(registry.complete('fields light ').options).toEqual([]);
    expect(registry.complete('stim heat ').options).toEqual([]);
  });
});

describe('field debug start', () => {
  function setup() {
    const world = makeWorld();
    const registry = new CommandRegistry<ConsoleHost>(
      createGameHost({
        world,
        submit: () => undefined,
        player: () => undefined,
        spawnables: [],
        bookmarks: () => new Map(),
        scenes: [],
        loadScene: () => undefined,
        loop: { timeScale: 1 },
      }),
    );
    const root = document.createElement('div');
    document.body.append(root);
    const scene = new Scene();
    const camera = new PerspectiveCamera(60, 4 / 3, 0.1, 200);
    camera.position.set(0, 1.2, 0);
    const publish = vi.fn();
    const session = startFieldDebug({
      world,
      registry,
      scene,
      camera,
      root,
      light: { levelAt: () => 0.5 },
      cursorPoint: () => ({ x: 0, y: 0, z: -4 }),
      publish,
    });
    return { world, registry, root, scene, session, publish };
  }

  const readout = (publish: ReturnType<typeof vi.fn>): Record<string, unknown> =>
    JSON.parse(String(publish.mock.lastCall?.[0])) as Record<string, unknown>;

  it('adds a hidden overlay; `fields temperature` draws the heated cells and the panel', () => {
    const s = setup();
    expect(s.scene.children).toContain(s.session.overlay.object);
    s.session.frame();
    expect(readout(s.publish)).toEqual({ selected: null, cells: 0, layer: null });
    const panel = s.root.querySelector<HTMLElement>('[data-testid="field-debug-panel"]');
    expect(panel?.style.display).toBe('none');
    s.registry.execute('fields temperature');
    stepWith(s.world, [stimCommand('heat', { x: 0, y: 0.5, z: -4 }, 2, 500)]);
    s.session.frame();
    expect(readout(s.publish)).toMatchObject({ layer: 'temperature', selected: null });
    expect(Number(readout(s.publish)['cells'])).toBeGreaterThan(0);
    expect(panel?.style.display).toBe('block');
    expect(panel?.textContent).toContain('layer: temperature');
    expect(panel?.textContent).toContain('heat');
    expect(s.session.overlay.object.visible).toBe(true);
    const calls = s.publish.mock.calls.length;
    s.session.frame();
    expect(s.publish.mock.calls.length).toBe(calls);
    s.registry.execute('fields light');
    s.session.frame();
    expect(readout(s.publish)).toMatchObject({ layer: 'light', cells: 225 });
    // The console's crosshair and liveness checks run through the page's camera and world.
    expect(s.registry.execute('inspect').ok).toBe(false);
    expect(s.registry.execute('inspect 9999').ok).toBe(false);
    s.registry.execute('fields off');
    s.session.frame();
    expect(readout(s.publish)).toEqual({ selected: null, cells: 0, layer: null });
    expect(s.session.overlay.object.visible).toBe(false);
    s.session.dispose();
    expect(root(s)).toBeNull();
  });

  it('panelText joins title, headings and lines', () => {
    expect(panelText({ title: 't', sections: [{ heading: 'h', lines: ['a', 'b'] }] })).toBe(
      't\n-- h\na\nb',
    );
  });
});

function root(s: { root: HTMLElement }): Element | null {
  return s.root.querySelector('[data-testid="field-debug-panel"]');
}
