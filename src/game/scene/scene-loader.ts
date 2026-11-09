// Loads scenes into the sim and the renderer together (mw-e00.21). The sim side (entities, static
// colliders) is src/sim/scene; this binds render objects to the new entities through RenderSync, so
// the renderer follows the sim like every other entity: the scene's merged static geometry hangs on
// the scene root entity and every spawn gets its own object. Unloading destroys the entities, removes
// the colliders and disposes every bound object at once, leaving nothing behind in any of the three.
//
// With `physics` (mw-e03.39), the scene's movable props (content `testprop`s with a `body`) become
// sim physics objects and its level colliders belong to stone piece entities (src/sim/scene/
// physics.ts). Their render objects follow the sim pose (`physics.object`), which RenderSync
// interpolates between the last two ticks: the renderer never simulates anything.
//
// Breakables (mw-e03.11): with physics, the scene's breakable placements and spawns get their
// content profiles (src/sim/breakables/scene.ts). A breakable piece is not part of the merged static
// geometry: it gets its own object (`objects.piece`), bound to the piece's entity, so it disappears
// from the screen the frame the sim destroys it.
//
// Renderer-agnostic: `objects` builds the scene objects (src/render/greybox for Three.js) and
// `binding` says how an object follows its entity (object3DBinding for Three.js).

import { materialPresets, type GameContent } from '@content/index';
import {
  addMaterialProperties,
  addPropPhysics,
  addSceneBreakables,
  addScenePhysics,
  placeEntity,
  placementProperties,
  installObjectRecovery,
  at,
  BreakableComponent,
  loadScene,
  PhysicsObjectComponent,
  SceneTransformComponent,
  sceneEntities,
  spawnSceneSpawn,
  unloadScene,
  type EntityId,
  type KitLookup,
  type LightEnvironment,
  type LoadedScene,
  type SceneLayout,
  type ScenePart,
  type ScenePiecePlacement,
  type SceneSpawnPlacement,
  type StaticColliderSink,
  type Vec3,
  type World,
} from '@sim/index';
import { breakableProfiles, cracked } from '../breakables';
import {
  IDENTITY_ROTATION,
  type RenderSync,
  type SceneBinding,
  type SimView,
  type Transform,
} from '../loop/render-sync';
import { propBodies } from '../physics-objects';

/** The scene id loaded when the URL names none. */
export const DEFAULT_SCENE = 'testbed';

/** Builds the render objects of a scene. */
export interface SceneObjects<TObject> {
  /** Every part of the scene's static geometry (merged as the renderer sees fit), in one object. */
  staticGeometry(layout: SceneLayout): TObject;
  /** The object for one spawn (a prop, or a marker); its origin is the spawn point. */
  spawn(spawn: SceneSpawnPlacement): TObject;
  /**
   * The object for a movable prop: a `size` box centred on its origin (the body's centre). Without
   * it, movable props get `spawn`'s object (fine for headless runs).
   */
  body?(spawn: SceneSpawnPlacement, size: Vec3): TObject;
  /**
   * The object for one breakable piece (mw-e03.11): its `parts` in world space, cracked when its
   * profile telegraphs a weak spot. Breakable pieces are left out of `staticGeometry`; without this
   * they are not drawn (fine for headless runs).
   */
  piece?(piece: ScenePiecePlacement, parts: readonly ScenePart[], crack: boolean): TObject;
}

/** How a scene object reads its entity's transform. */
export type SceneTransformReader = (view: SimView, entity: EntityId) => Transform | undefined;

/** Scene physics options: see src/sim/scene/physics.ts. */
export interface SceneLoaderPhysics {
  /** Material of the level geometry; defaults to stone. */
  readonly levelMaterial?: string;
}

export interface SceneLoaderOptions<TObject, TCommand> {
  readonly world: World<TCommand>;
  readonly sync: RenderSync;
  readonly colliders: StaticColliderSink;
  readonly content: Pick<GameContent, 'all' | 'get' | 'has'>;
  readonly objects: SceneObjects<TObject>;
  /**
   * How an object follows its entity, reading its transform with `read` (`readSceneTransform`, or
   * `readPhysicsObjectTransform` for a movable prop).
   */
  readonly binding: (object: TObject, read: SceneTransformReader) => SceneBinding<TObject>;
  /**
   * Makes movable props physics objects and binds level colliders (the world needs
   * `installGamePhysics` and `colliders` must be its physics). Absent: every spawn stays put.
   */
  readonly physics?: SceneLoaderPhysics;
  /**
   * The light field (mw-e03.37): gets each loaded scene's light data, and an empty environment on
   * unload. Its static occluders are fed through `colliders` (a ColliderFanOut), not here.
   */
  readonly light?: { setEnvironment(environment: LightEnvironment): void };
}

/** Thrown when asked for a scene the content does not have; lists the ones it does. */
export class UnknownSceneError extends Error {
  override readonly name = 'UnknownSceneError';

  constructor(
    readonly requested: string,
    readonly available: readonly string[],
  ) {
    super(`unknown scene "${requested}"; available scenes: ${available.join(', ')}`);
  }
}

/** Reads a scene entity's static transform (for render bindings). */
export function readSceneTransform(view: SimView, entity: EntityId): Transform | undefined {
  return view.get(entity, SceneTransformComponent);
}

const WORLD_FRAME: Transform = Object.freeze({
  position: Object.freeze({ x: 0, y: 0, z: 0 }),
  rotation: IDENTITY_ROTATION,
});

/** Reads the world frame for an object built in world space (a breakable piece) while it lives. */
export function readWorldFrame(view: SimView, entity: EntityId): Transform | undefined {
  return view.isAlive(entity) ? WORLD_FRAME : undefined;
}

/** Reads a physics object's pose as of the last tick: the centre of its body and its rotation. */
export function readPhysicsObjectTransform(view: SimView, entity: EntityId): Transform | undefined {
  const object = view.get(entity, PhysicsObjectComponent);
  return object === undefined
    ? undefined
    : { position: object.position, rotation: object.rotation };
}

/** How far under a scene's lowest solid an object counts as lost, metres. */
const RECOVERY_DEPTH = 20;

export class SceneLoader<TObject, TCommand = unknown> {
  private loaded: LoadedScene | undefined;
  /** Spawns a fact brought in after the load (mw-e27.8), by spawn id. */
  private readonly live = new Map<string, EntityId>();
  private killY = -Infinity;
  private recoveryInstalled = false;
  private readonly kit: KitLookup;

  constructor(private readonly options: SceneLoaderOptions<TObject, TCommand>) {
    const { content } = options;
    this.kit = (id) => (content.has('kit', id) ? content.get('kit', id) : undefined);
  }

  /** The loaded scene, if any. */
  get current(): LoadedScene | undefined {
    return this.loaded;
  }

  /** Ids of every scene in the content, sorted. */
  available(): string[] {
    return this.options.content.all('scene').map((scene) => scene.id);
  }

  /**
   * Loads scene `id` (after unloading the current one) into the sim, the physics sink and the
   * renderer. Call between sim steps.
   * @throws UnknownSceneError when the content has no scene `id` (the current scene stays loaded).
   */
  load(id: string): LoadedScene {
    const { world, sync, colliders, content, objects, binding } = this.options;
    if (!content.has('scene', id)) throw new UnknownSceneError(id, this.available());
    this.unload();
    const loaded = loadScene(world, content.get('scene', id), this.kit, colliders);
    const { physics } = this.options;
    const props = propBodies(content);
    const movable = new Set(
      physics === undefined
        ? []
        : addScenePhysics(world, loaded, {
            props,
            materials: materialPresets(content.all('material')),
            ...(physics.levelMaterial !== undefined && { levelMaterial: physics.levelMaterial }),
          }).objects,
    );
    if (physics !== undefined) this.watchRecoveries(loaded);
    if (physics !== undefined && world.isRegistered(BreakableComponent)) {
      addSceneBreakables(world, loaded, breakableProfiles(content));
    }
    sync.bind(loaded.root, binding(objects.staticGeometry(loaded.layout), readSceneTransform));
    loaded.layout.pieces.forEach((piece, index) => {
      if (piece.breakable === undefined || objects.piece === undefined) return;
      const parts = loaded.layout.parts.filter((part) => part.placement === index);
      const crack = cracked(content, piece.breakable.profile);
      sync.bind(
        at(loaded.pieces, index),
        binding(objects.piece(piece, parts, crack), readWorldFrame),
      );
    });
    for (const { entity, spawn } of loaded.spawns) {
      // An item spawn becomes a world item (mw-e17.7), which brings its own body and box.
      if (spawn.item !== undefined) continue;
      const size =
        movable.has(entity) && spawn.prop !== undefined ? props(spawn.prop)?.size : undefined;
      sync.bind(
        entity,
        size === undefined
          ? binding(objects.spawn(spawn), readSceneTransform)
          : binding(
              objects.body?.(spawn, size) ?? objects.spawn(spawn),
              readPhysicsObjectTransform,
            ),
      );
    }
    this.options.light?.setEnvironment(loaded.layout.light);
    this.loaded = loaded;
    return loaded;
  }

  /**
   * Adds spawn `spawn` of the loaded scene (one its fact gate left out, mw-e27.8) to the sim and the
   * renderer the way `load` does for a prop or marker: its entity, its physics body or properties and
   * its render object. What its content adds on top (interaction, breakable, creature) is the caller's.
   * Call between sim steps.
   * @throws Error when no scene is loaded or the spawn is already there.
   */
  addSpawn(spawn: SceneSpawnPlacement): EntityId {
    const { loaded } = this;
    if (loaded === undefined) throw new Error('no scene is loaded');
    const { world, sync, objects, binding, content, physics } = this.options;
    const existing = this.entityOfSpawn(spawn.id);
    if (existing !== undefined && world.isAlive(existing)) {
      throw new Error(`spawn "${spawn.id}" is already in scene "${loaded.id}"`);
    }
    const entity = spawnSceneSpawn(world, loaded.id, spawn);
    const own = placementProperties(spawn.properties);
    const body =
      physics !== undefined && spawn.prop !== undefined
        ? propBodies(content)(spawn.prop)
        : undefined;
    const materials = materialPresets(content.all('material'));
    if (body !== undefined) {
      addPropPhysics(world, entity, body, materials, spawn.position, spawn.rotation, own);
      sync.bind(
        entity,
        binding(
          objects.body?.(spawn, body.size) ?? objects.spawn(spawn),
          readPhysicsObjectTransform,
        ),
      );
    } else {
      if (physics !== undefined && Object.keys(own).length > 0) {
        addMaterialProperties(world, entity, materials, own);
        placeEntity(world, entity, spawn.position);
      }
      sync.bind(entity, binding(objects.spawn(spawn), readSceneTransform));
    }
    this.live.set(spawn.id, entity);
    return entity;
  }

  /** Removes spawn `id` (loaded with the scene or added since): its entity and render object. */
  removeSpawn(id: string): boolean {
    const entity = this.entityOfSpawn(id);
    if (entity === undefined) return false;
    const { world, sync } = this.options;
    this.live.delete(id);
    sync.unbind(entity);
    if (world.isAlive(entity)) world.destroy(entity);
    return true;
  }

  /** The entity of spawn `id` while it exists (alive or not) in the loaded scene. */
  entityOfSpawn(id: string): EntityId | undefined {
    return this.live.get(id) ?? this.loaded?.spawns.find(({ spawn }) => spawn.id === id)?.entity;
  }

  /**
   * Quest-critical objects of `loaded` that name a recovery anchor (mw-e17.14) return to it when they
   * fall out of the scene: the kill plane is 20 m under its lowest solid. Installed on the first such
   * scene, so a world without any has no recovery rules.
   */
  private watchRecoveries(loaded: LoadedScene): void {
    if (!loaded.layout.spawns.some((spawn) => spawn.recovery !== undefined)) return;
    const lowest = Math.min(0, ...loaded.layout.parts.map((part) => part.min.y));
    this.killY = lowest - RECOVERY_DEPTH;
    if (this.recoveryInstalled) return;
    this.recoveryInstalled = true;
    installObjectRecovery(this.options.world, () => ({ killY: this.killY }));
  }

  /** Unloads the current scene, if any: entities, colliders and render objects. Call between steps. */
  unload(): void {
    const loaded = this.loaded;
    if (loaded === undefined) return;
    this.loaded = undefined;
    const { world, sync, colliders } = this.options;
    for (const entity of [...sceneEntities(loaded), ...this.live.values()]) sync.unbind(entity);
    for (const entity of this.live.values()) if (world.isAlive(entity)) world.destroy(entity);
    this.live.clear();
    unloadScene(world, loaded, colliders);
    this.options.light?.setEnvironment({});
  }
}
