// A loaded scene's mechanisms (mw-e03.18): after `loadScene` and `addScenePhysics`, every spawn with a
// `door` becomes a door of its profile (with its lock and its material's world properties), every
// spawn with a `switch` a switch, and every placed signal graph is wired to the spawns its nodes name
// (a binding name is a spawn id unless the scene renames it). Switches that start on drive their
// bound lever nodes from the start. A switch the scene gave no affordance gets its kind's (Pull lever,
// Press button, Turn crank, Turn wheel). The sim never imports content: the game passes the profiles,
// locks and graphs in as lookups.

import type { EntityId } from '../core/component';
import type { World } from '../core/world';
import type { StaticColliderSink } from '../physics/static-colliders';
import type { AffordanceSpec } from '../interaction/affordance';
import { addInteractable, InteractableComponent } from '../interaction/system';
import { hasProperty, readProperty } from '../properties/components';
import { addMaterialProperties, type MaterialPresets } from '../properties/materials';
import type { SceneImpactSwitchSpec } from '../scene/layout';
import type { LoadedScene } from '../scene/loader';
import { placementProperties } from '../scene/physics';
import { compileSignalGraph, type SignalGraphDef } from '../signals/graph';
import { addSignalGraph } from '../signals/runtime';
import { PlacementComponent, placeEntity } from '../stimulus/placement';
import type { DoorProfileLookup, LockLookup, SwitchKind } from './components';
import { makeLightSource } from '../light/sources';
import { makeCuttable, suspendFrom } from './ropes';
import { makeImpactSwitch, syncImpactSwitchNodes } from './impacts';
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
  /** Where ropes' colliders go (the physics port in the game); none: ropes have no body to hit. */
  readonly colliders?: StaticColliderSink;
}

/** What `addSceneMechanisms` made, in scene order. */
export interface SceneMechanisms {
  readonly doors: readonly EntityId[];
  readonly switches: readonly EntityId[];
  /** Pressure plates (mw-e03.19). */
  readonly plates: readonly EntityId[];
  /** Impact switches (mw-e03.20). */
  readonly impactSwitches: readonly EntityId[];
  /** Cuttable ropes (mw-e05.13). */
  readonly ropes: readonly EntityId[];
  /** Light sources (mw-e03.16). */
  readonly lights: readonly EntityId[];
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
  const impactSwitches: EntityId[] = [];
  const ropes: EntityId[] = [];
  const lights: EntityId[] = [];
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
    const { rope } = spawn;
    if (rope !== undefined) {
      makeCuttable(sim, entity, spawn.position, rope.length, {
        ...(rope.radius !== undefined && { radius: rope.radius }),
        ...(options.colliders !== undefined && { colliders: options.colliders }),
      });
      ropes.push(entity);
    }
    const { lightSource: light } = spawn;
    if (light !== undefined) {
      makeLightSource(sim, entity, light.variant, spawn.position, {
        unlit: light.unlit === true,
        infiniteFuel: light.infiniteFuel === true,
      });
      lights.push(entity);
    }
    const { impactSwitch: impact } = spawn;
    // A spawn with the `shootable` property is a target even when the scene says no more
    // (mw-e05.13); the property is the threshold of whichever prefab it is.
    const shootable = hasProperty(sim, entity, 'shootable');
    if (impact !== undefined || shootable) {
      const { variant = 'target', ...rest }: Partial<SceneImpactSwitchSpec> = impact ?? {};
      makeImpactSwitch(sim, entity, spawn.position, variant, {
        ...(shootable && { minImpulse: readProperty(sim, entity, 'shootable') }),
        ...(rest.minEnergy !== undefined && { minEnergy: rest.minEnergy }),
        ...(rest.damageTypes !== undefined && { damageTypes: rest.damageTypes }),
        ...(rest.elements !== undefined && { elements: rest.elements }),
        ...(rest.radius !== undefined && { radius: rest.radius }),
        ...(rest.mode !== undefined && { mode: rest.mode }),
        ...(rest.holdSeconds !== undefined && { holdSeconds: rest.holdSeconds }),
        ...(rest.loudness !== undefined && { loudness: rest.loudness }),
      });
      impactSwitches.push(entity);
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
  for (const { entity, spawn } of loaded.spawns) {
    if (spawn.suspendedFrom === undefined) continue;
    const rope = need(
      bySpawn.get(spawn.suspendedFrom),
      `spawn "${spawn.id}" hangs from "${spawn.suspendedFrom}", which the scene does not have`,
    );
    suspendFrom(sim, entity, rope);
  }
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
  for (const entity of impactSwitches) syncImpactSwitchNodes(sim, entity);
  return Object.freeze({
    doors: Object.freeze(doors),
    switches: Object.freeze(switches),
    plates: Object.freeze(plates),
    impactSwitches: Object.freeze(impactSwitches),
    ropes: Object.freeze(ropes),
    lights: Object.freeze(lights),
    graphs: Object.freeze(graphs),
  });
}
