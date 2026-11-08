// A loaded scene's mechanisms (mw-e03.18): after `loadScene` and `addScenePhysics`, every spawn with a
// `door` becomes a door of its profile (with its lock and its material's world properties), every
// spawn with a `switch` a switch, and every placed signal graph is wired to the spawns its nodes name
// (a binding name is a spawn id unless the scene renames it). Switches that start on drive their
// bound lever nodes from the start. A switch the scene gave no affordance gets its kind's (Pull lever,
// Press button, Turn crank, Turn wheel). The sim never imports content: the game passes the profiles,
// locks and graphs in as lookups.

import type { EntityId } from '../core/component';
import type { World } from '../core/world';
import type { AffordanceSpec } from '../interaction/affordance';
import { addInteractable, InteractableComponent } from '../interaction/system';
import { addMaterialProperties, type MaterialPresets } from '../properties/materials';
import type { LoadedScene } from '../scene/loader';
import { placementProperties } from '../scene/physics';
import { compileSignalGraph, type SignalGraphDef } from '../signals/graph';
import { addSignalGraph } from '../signals/runtime';
import { PlacementComponent, placeEntity } from '../stimulus/placement';
import type { DoorProfileLookup, LockLookup, SwitchKind } from './components';
import { makePlate, syncPlateNodes } from './plates';
import { makeDoor, makeSwitch, refreshAffordances, syncSwitchNodes } from './system';

/** What `addSceneMechanisms` reads: profiles, locks and graphs by id. */
export interface SceneMechanismsOptions {
  readonly doors: DoorProfileLookup;
  readonly locks: LockLookup;
  readonly graphs: (id: string) => SignalGraphDef | undefined;
  /** Door profile id → its material; with `materials`, doors get that material's properties. */
  readonly doorMaterial?: (profile: string) => string | undefined;
  readonly materials?: MaterialPresets;
}

/** What `addSceneMechanisms` made, in scene order. */
export interface SceneMechanisms {
  readonly doors: readonly EntityId[];
  readonly switches: readonly EntityId[];
  /** Pressure plates (mw-e03.19). */
  readonly plates: readonly EntityId[];
  /** The placed graphs' entities. */
  readonly graphs: readonly EntityId[];
}

/** The affordance a switch of `kind` offers when the scene gives it none. */
export const SWITCH_AFFORDANCES: Readonly<Record<SwitchKind, AffordanceSpec>> = Object.freeze({
  lever: { verb: 'pull', label: 'Pull lever' },
  button: { verb: 'press', label: 'Press button' },
  crank: { verb: 'use', label: 'Turn crank' },
  wheel: { verb: 'use', label: 'Turn wheel' },
});

function need<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new RangeError(what);
  return value;
}

/**
 * Makes `loaded`'s door and switch spawns mechanisms and places its signal graphs. Call between
 * steps, after `addScenePhysics` and after interaction is installed (so doors and switches get their
 * prompts), in a world with mechanisms installed (and signals, when the scene places graphs).
 * @throws RangeError for an unknown door profile, lock or graph, or a graph binding no spawn has.
 */
export function addSceneMechanisms<T>(
  world: World<T>,
  loaded: LoadedScene,
  options: SceneMechanismsOptions,
): SceneMechanisms {
  const sim = world as unknown as World<never>;
  const doors: EntityId[] = [];
  const switches: EntityId[] = [];
  const plates: EntityId[] = [];
  const interactive = sim.isRegistered(InteractableComponent);
  for (const { entity, spawn } of loaded.spawns) {
    const { door } = spawn;
    if (door !== undefined) {
      const profile = need(options.doors(door.profile), `unknown door profile "${door.profile}"`);
      const lock =
        door.lock === undefined
          ? undefined
          : need(options.locks(door.lock), `unknown lock "${door.lock}"`);
      const material = options.doorMaterial?.(door.profile);
      if (material !== undefined && options.materials !== undefined) {
        const own = placementProperties(spawn.properties);
        addMaterialProperties(sim, entity, options.materials, { material, ...own });
      }
      makeDoor(sim, entity, profile, {
        origin: spawn.position,
        yaw: spawn.yaw,
        ...(door.hinge !== undefined && { hinge: door.hinge }),
        ...(door.swing !== undefined && { swing: door.swing }),
        ...(door.state !== undefined && { state: door.state }),
        ...(lock !== undefined && { lock }),
        ...(door.locked !== undefined && { locked: door.locked }),
      });
      refreshAffordances(sim, entity);
      doors.push(entity);
    }
    const { plate } = spawn;
    if (plate !== undefined) {
      makePlate(sim, entity, spawn.position, {
        minWeight: plate.minWeight,
        ...(plate.maxWeight !== undefined && { maxWeight: plate.maxWeight }),
        ...(plate.hysteresis !== undefined && { hysteresis: plate.hysteresis }),
        ...(plate.mode !== undefined && { mode: plate.mode }),
        ...(plate.armSeconds !== undefined && { armSeconds: plate.armSeconds }),
        ...(plate.width !== undefined && { width: plate.width }),
        ...(plate.depth !== undefined && { depth: plate.depth }),
        ...(plate.hidden !== undefined && { hidden: plate.hidden }),
      });
      plates.push(entity);
    }
    const own = spawn.switch;
    if (own === undefined) continue;
    makeSwitch(sim, entity, own.kind, {
      ...(own.positions !== undefined && { positions: own.positions }),
      ...(own.initial !== undefined && { position: own.initial }),
    });
    if (interactive && !sim.has(entity, InteractableComponent)) {
      addInteractable(
        sim,
        entity,
        { affordances: [SWITCH_AFFORDANCES[own.kind]], radius: 0.3 },
        spawn.position,
      );
    } else if (!sim.has(entity, PlacementComponent)) {
      placeEntity(sim, entity, spawn.position);
    }
    switches.push(entity);
  }

  const bySpawn = new Map(loaded.spawns.map(({ entity, spawn }) => [spawn.id, entity]));
  const graphs = loaded.layout.signals.map((signal, index) => {
    const def = need(options.graphs(signal.graph), `unknown signal graph "${signal.graph}"`);
    const bindings: Record<string, EntityId> = {};
    for (const name of compileSignalGraph(def).bindings) {
      const id = signal.bindings[name] ?? name;
      bindings[name] = need(
        bySpawn.get(id),
        `scene "${loaded.id}" signal ${String(index)} binds "${name}" to spawn "${id}", which it does not have`,
      );
    }
    return addSignalGraph(sim, def, { bindings });
  });

  // Switches that start on hold their bound lever nodes on from the first evaluation.
  for (const entity of switches) syncSwitchNodes(sim, entity);
  for (const entity of plates) syncPlateNodes(sim, entity);
  return Object.freeze({
    doors: Object.freeze(doors),
    switches: Object.freeze(switches),
    plates: Object.freeze(plates),
    graphs: Object.freeze(graphs),
  });
}
