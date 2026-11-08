// A controllable player in a loaded scene (mw-e02.23): the glue from sampled ActionFrames to a
// body on screen. It installs the player into the sim (spawn at the scene's player start, look and
// controller systems; see src/sim/player), resolves collisions against the given CollisionWorld (the
// game passes RapierCollisionWorld over the sim's physics, mw-e02.21), binds a placeholder body to
// the player through render sync so it is interpolated like every other entity, and each drawn frame
// places the orbit camera (mw-e02.4, src/game/camera) behind the interpolated body and publishes
// small read-only readouts for the HUD and the Playwright e2e: the player's state after every sim
// tick, and the camera's after every frame it drives.
//
// With `interaction` (mw-e02.5) the player can also focus and interact with world objects: the
// sim's interaction system runs after the controller, the scene's interactable spawns get their
// affordances, and `prompt()` returns what the contextual prompt should show.
//
// With `animation` (mw-e02.6) the placeholder body is the grey-box humanoid rig, animated from the
// sim: after each sim step the player's published locomotion (CharacterLocomotion) and action
// timeline are captured (`onStep`), and each drawn frame the AnimationDriver poses the rig from them.
// Animation only reads the sim; the body's transform stays the interpolated sim position (root
// motion is never applied). A crouch lowers the rig's pelvis by CROUCH_DROP × the crouch state's
// weight, so the bent legs keep the feet on the ground.
//
// With `ledges` (mw-e02.12) the player mantles onto the scene's crates and ledges, and with the
// ledge-hang capability grabs, hangs from and shimmies along higher ones (src/sim/climb/mantle.ts);
// the rig plays the graph's mantle and hang states from the published locomotion. With `climb`
// (mw-e02.13) it climbs the scene's ladders, ropes and ivy (src/sim/climb/climb.ts) and pulls up
// onto the ledge at the top; the readout's `traversal` says which mode has it.
//
// Renderer-agnostic: the caller supplies the body object and how an object follows its entity
// (object3DBinding for Three.js). The sim steps only through the frame loop, as ever; nothing here
// mutates the sim after setup (the camera's collision queries are read-only).
//
// With `lockOn` (mw-e02.16) the player also gets lock-on (src/sim/targeting): the scene's targetable
// spawns become lock targets, and while locked the orbit camera frames the player and target together
// (LockFraming, presentation only). `lockTarget()` tells the HUD where the lock marker goes. With
// `melee` too, the knight's attacks turn toward the locked target during startup (mw-e02.31),
// located as lock-on locates it.
//
// With `bow` (mw-e05.21) and `moves`, the player also carries a bow and quiver (installPlayer's
// combat.bow): its toggle takes the bow out, fire draws and looses, and the readout's `bow` shows
// what is selected and how many arrows are left. While it draws, the orbit camera's field of view
// eases from the camera's own toward the bow's aim.fov (AimZoom), and back once the draw ends. The
// arrows themselves are the world's (startTestbedCombat installs the arrow system).

import type {
  CameraTuning,
  ControllerTuning,
  Frozen,
  LockOnTuning,
  MoveTable,
  TargetableDef,
} from '@content/index';
import type { AnimationController, Pose } from '@render/animation/index';
import {
  addInteractor,
  addSceneInteractables,
  ActionTimelineComponent,
  CharacterController,
  giveTargetable,
  installInteraction,
  installLockOn,
  installPlayer,
  lockedTarget,
  placedTargetPosition,
  interacted,
  interactionPrompt,
  LockOnComponent,
  PLAYER_FALL_RESET_MARGIN,
  PlayerLook,
  ViewAnchor,
  waterVolumes,
  breathFraction,
  CharacterBreath,
  DEFAULT_WATER_TUNING,
  sceneLedges,
  sceneRopes,
  type BodyId,
  BowComponent,
  isDrawing,
  QuiverComponent,
  staminaOf,
  type PlayerMeleeOptions,
  type CollisionWorld,
  type DefeatedCheck,
  type EntityId,
  type Interaction,
  type InteractionPrompt,
  type InteractorKit,
  type LineOfSight,
  type LoadClass,
  type LoadedScene,
  type SightWorld,
  type TargetLocator,
  type TraversalMode,
  type World,
  type StatusLookup,
} from '@sim/index';
import type { TestbedBow } from '../combat/testbed-combat';
import {
  AimZoom,
  applyOrbitPose,
  LockFraming,
  lookSettings,
  nearPlaneClear,
  OrbitCamera,
  toRadians,
  type OrbitCameraTarget,
} from '../camera';
import {
  AnimationDriver,
  characterLocomotion,
  simAnimReader,
  type CharacterProbe,
} from '../animation';
import type { FrameInfo } from '../loop';
import type { Quat, RenderSync, SceneBinding, SimView, Transform, Vec3 } from '../loop/render-sync';

/** Reads an entity's transform from the sim (what render sync interpolates). */
export type TransformReader = (view: SimView, entity: EntityId) => Transform | undefined;

/** What the player publishes each tick: plain JSON, rounded to 0.1 mm. */
export interface PlayerReadout {
  /** The sim tick the readout was taken after. */
  readonly tick: number;
  /** Feet position, metres. */
  readonly position: Vec3;
  readonly grounded: boolean;
  /** The traversal mode that has the player (mantle, hang, climb), or null in plain locomotion. */
  readonly traversal: TraversalMode | null;
  /** Look yaw, radians (0 looks along −z). */
  readonly yaw: number;
  /** Look pitch, radians above the horizon. */
  readonly pitch: number;
  /** Combat state, when the player has moves (mw-e04.6): the e2e reads the chain from it. */
  readonly combat?: PlayerCombatReadout;
  /** The locked target's entity, or null; present only when the player has lock-on. */
  readonly lock?: EntityId | null;
  /** The bow and quiver, when the player has a bow (mw-e05.21). */
  readonly bow?: PlayerBowReadout;
  /** Water and breath, when the scene has water (mw-e02.14). */
  readonly water?: PlayerWaterReadout;
}

/** The player's water in a readout (mw-e02.14). */
export interface PlayerWaterReadout {
  /** The feet are in water at least wading deep. */
  readonly inWater: boolean;
  /** The armor is dragging the player down. */
  readonly sinking: boolean;
  /** Share of a full breath left, 0–1. */
  readonly breath: number;
}

/** The player's bow in a readout. */
export interface PlayerBowReadout {
  /** The bow is out. */
  readonly equipped: boolean;
  /** Arrow type the next draw nocks. */
  readonly selected: string;
  /** Ticks drawn so far, or null when not drawing. */
  readonly draw: number | null;
  /** Arrows left by type, in the quiver's cycle order. */
  readonly quiver: Readonly<Record<string, number>>;
}

/** Lock-on for the player (mw-e02.16). */
export interface TestbedLockOn {
  /** Lock-on tuning (content `lock-on`, `player`). */
  readonly tuning: Frozen<LockOnTuning>;
  /** Line of sight to lock points: LineOfSight over the sim's physics (RapierSightWorld). */
  readonly sight: Pick<LineOfSight, 'ray'>;
  /** The targetable profile a scene spawn names (content `targetable`). */
  readonly profile: (id: string) => Frozen<TargetableDef> | undefined;
  /** Where targets are; defaults to their placement, else their scene position. */
  readonly locate?: TargetLocator;
  /** Which targets are defeated (zeroHealth where the damage model is registered). */
  readonly defeated?: DefeatedCheck;
}

/** The locked target and its main lock point, for the HUD marker. */
export interface LockTarget {
  readonly entity: EntityId;
  /** World metres. */
  readonly point: Vec3;
}

/** The player's combat state in a readout. */
export interface PlayerCombatReadout {
  /** The move in progress, or null when idle. */
  readonly action: string | null;
  /** Stamina now (rounded to 0.1 mm like positions: 1e-4). */
  readonly stamina: number;
  /** The shield is up. */
  readonly blocking: boolean;
}

/** What the orbit camera publishes each frame it drives (the e2e clipping probe reads it). */
export interface CameraReadout {
  /** Frames the orbit camera has placed the camera for. */
  readonly frames: number;
  /** Of those, frames whose near plane touched geometry (nearPlaneClear failed): must stay 0. */
  readonly clipped: number;
  /** Of those, frames where collision held the boom short of the zoom distance. */
  readonly pulledIn: number;
  /** This frame's boom length and zoom distance, metres (rounded to 0.1 mm). */
  readonly boom: number;
  readonly zoom: number;
  /** This frame's camera position (rounded to 0.1 mm). */
  readonly position: Vec3;
  /** This frame's vertical field of view, degrees (rounded to 1e-4): narrower while aiming. */
  readonly fov: number;
}

/**
 * The player's interactions (mw-e02.5). Register the placement component and the world properties
 * on the world first (the focus reads both).
 */
export interface TestbedInteractionOptions {
  /** Solid colliders that block reach: RapierSightWorld over the world's physics. */
  readonly sight?: SightWorld;
  /** Colliders belonging to an entity, which never block reach to it. */
  readonly bodiesOf?: (entity: EntityId) => readonly BodyId[];
  /** The player's capabilities and items (none until classes and inventory arrive). */
  readonly kit?: Partial<InteractorKit>;
  /** Receives every interaction the player completes (the e2e hook). */
  readonly publish?: (interaction: Interaction) => void;
}

/**
 * How far the grey-box humanoid's pelvis sinks when fully crouched, metres: with its crouch clips'
 * knees bent about 70° (thigh 0.42 m, shin 0.43 m) the feet would float this far off the ground.
 * A property of the placeholder rig and clips; real rigs (e37) bring their own crouch.
 */
export const CROUCH_DROP = 0.38;

/** The player's animated body (mw-e02.6). */
export interface PlayerAnimationView {
  /** The body's controller (the grey-box humanoid graph). */
  readonly controller: AnimationController;
  /** Writes a pose into the body (bone rotations only). */
  readonly apply: (pose: Pose) => void;
  /** Lowers the body's pelvis by `metres` below rest (0 = standing). */
  readonly lower?: (metres: number) => void;
  /** Receives the body's animation probe after every frame it animates (the e2e hook). */
  readonly publish?: (probe: CharacterProbe) => void;
}

export interface TestbedPlayerOptions<TObject, TCommand> {
  readonly world: World<TCommand>;
  /** The loaded scene; the player spawns at its `player-start` spawn, or at `startSpawn`. */
  readonly scene: LoadedScene;
  /** The spawn to start at instead of `player-start`: an area transition's arrival (mw-e01.11). */
  readonly startSpawn?: string;
  readonly sync: RenderSync;
  readonly tuning: Frozen<ControllerTuning>;
  /** The orbit camera and look tuning (content `camera`, `player`). */
  readonly cameraTuning: Frozen<CameraTuning>;
  /** Collision for the controller and the camera: RapierCollisionWorld over the world's physics. */
  readonly collision: CollisionWorld;
  /** The placeholder body; its origin is the player's feet and it faces −z. */
  readonly object: TObject;
  /** How `object` follows the player (object3DBinding for Three.js). */
  readonly binding: (object: TObject, read: TransformReader) => SceneBinding<TObject>;
  readonly camera: OrbitCameraTarget;
  /** Receives a readout after every sim tick that a frame shows (the e2e test hook). */
  readonly publish?: (readout: PlayerReadout) => void;
  /** Receives the camera's readout after every frame it drives (the e2e clipping probe). */
  readonly publishCamera?: (readout: CameraReadout) => void;
  /** Mouse look, radians per count; defaults to the camera tuning's. */
  readonly sensitivity?: number;
  /**
   * The moves the player may perform (`compileMoves` of the game content): gives it stamina, an
   * action timeline and the dodge roll and backstep (mw-e04.8). Absent = movement only.
   */
  readonly moves?: MoveTable;
  /** Lets the player focus and interact with world objects (mw-e02.5). */
  readonly interaction?: TestbedInteractionOptions;
  /**
   * Sword and shield (mw-e04.6), with `moves`: the light chain and the block. The caller registers
   * the hit-volume, damage and placement components and wires the strikes (see installPlayer).
   */
  readonly melee?: PlayerMeleeOptions;
  /** Animates the body from the sim (mw-e02.6); absent = a still body. */
  readonly animation?: PlayerAnimationView;
  /** Gives the player lock-on (mw-e02.16); absent = none. */
  readonly lockOn?: TestbedLockOn;
  /**
   * Mantling and ledge hangs over the scene's ledges (mw-e02.12); the world must have the world
   * properties registered (a ledge's hold reads them). Absent = none.
   */
  readonly ledges?: TestbedLedgeOptions;
  /**
   * Climbing ladders, ropes, ivy and (with the capability) rough walls (mw-e02.13); the world must
   * have the world properties registered and the scene's colliders bound to their pieces (scene
   * physics), since what can be climbed is read from them. Absent = none.
   */
  readonly climb?: TestbedClimbOptions;
  /**
   * Wading, swimming, sinking and breath in the scene's water regions (mw-e02.14). Absent = the
   * player walks through water as if it were not there.
   */
  readonly water?: TestbedWaterOptions;
  /**
   * A bow and quiver (mw-e05.21), with `moves`: drawn, the camera narrows to its aim. The world's
   * arrow system (startTestbedCombat) flies what it looses. Absent = none.
   */
  readonly bow?: TestbedBow;
  /** Status definitions: slowed and rooted scale the player's speed (mw-e06.24). */
  readonly statuses?: StatusLookup;
}

/** The player's climbing (mw-e02.13). */
export interface TestbedClimbOptions {
  /** The player's climbing capabilities (e.g. CLIMB_ROUGH_CAPABILITY), on top of the registry's (mw-e19.2). */
  readonly capabilities?: readonly string[];
}

/** The player's water (mw-e02.14). */
export interface TestbedWaterOptions {
  /** The player's armor load class now; absent = light (nothing sinks). */
  readonly loadClass?: (entity: EntityId) => LoadClass | undefined;
  /** Applies a drowning tick of `amount` points to the player. */
  readonly onDrown?: (entity: EntityId, amount: number) => void;
}

/** The player's mantling and ledge hangs (mw-e02.12). */
export interface TestbedLedgeOptions {
  /** The player's capabilities (e.g. LEDGE_HANG_CAPABILITY), on top of the registry's (mw-e19.2). */
  readonly capabilities?: readonly string[];
}

export interface TestbedPlayer {
  readonly entity: EntityId;
  /** Whether the orbit camera drives the camera (off while the debug camera flies). */
  drivesCamera: boolean;
  /** Call after every sim step (the loop's onStep): captures what animation reads. */
  onStep(): void;
  /** Call once per drawn frame, after render sync and before drawing. */
  frame(info?: Pick<FrameInfo, 'alpha' | 'timeMs'>): void;
  /** Zooms the orbit camera by whole mouse-wheel notches (positive = out). */
  zoom(notches: number): void;
  /**
   * The death beat's camera pull-back (mw-e01.8), 0 (none) to 1 (all of DEATH_PULL_BACK): the orbit
   * camera backs off and tilts down over the body. Presentation only.
   */
  pullBack(fraction: number): void;
  /** The player's state now, or undefined once disposed. */
  readout(): PlayerReadout | undefined;
  /** What the Interact prompt shows now; undefined with nothing in focus or no interaction. */
  prompt(): InteractionPrompt | undefined;
  /** The locked target as of the last tick, or undefined when not locked (or no lock-on). */
  lockTarget(): LockTarget | undefined;
  /** Unbinds the body and removes the player (its systems stay; they find no player). */
  dispose(): void;
}

/** How far the death beat pulls the orbit camera back (mw-e01.8): extra boom and downward tilt. */
export const DEATH_PULL_BACK = Object.freeze({ metres: 2.5, pitch: (-20 * Math.PI) / 180 });

const round = (n: number): number => Math.round(n * 1e4) / 1e4 + 0;
const roundVec = ({ x, y, z }: Vec3): Vec3 => ({ x: round(x), y: round(y), z: round(z) });

/** The yaw (radians about +y) of a rotation about +y only, as the player's transform carries. */
export function yawOf(rotation: Quat): number {
  return 2 * Math.atan2(rotation.y, rotation.w);
}

/** The rotation of `yaw` radians about +y. */
export function yawRotation(yaw: number): Quat {
  return { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) };
}

/** The player's transform: its feet, turned to its look yaw. */
export const readPlayerTransform: TransformReader = (view, entity) => {
  const state = view.get(entity, CharacterController);
  const look = view.get(entity, PlayerLook);
  if (state === undefined || look === undefined) return undefined;
  return { position: state.position, rotation: yawRotation(look.yaw) };
};

/**
 * The player's body animated on its own driver (the player is always near the camera): `frame`
 * poses it, lowers its pelvis by the crouch state's weight and publishes the probe.
 */
function animatedBody(
  view: SimView,
  entity: EntityId,
  animation: PlayerAnimationView,
  moves: MoveTable | undefined,
): { readonly driver: AnimationDriver; frame(alpha: number, dt: number): void } {
  const driver = new AnimationDriver(view);
  driver.add(entity, {
    name: 'player',
    controller: animation.controller,
    // Without moves the player has no action timeline (movement only).
    read: simAnimReader({
      moves: moves ?? new Map(),
      locomotion: characterLocomotion,
      timeline: moves !== undefined,
    }),
    apply: animation.apply,
  });
  return {
    driver,
    frame(alpha, dt) {
      driver.frame(alpha, dt);
      const probe = driver.probe()['player'];
      if (probe === undefined) return;
      animation.lower?.(CROUCH_DROP * (probe.layers[0]?.weights['crouch'] ?? 0));
      animation.publish?.(probe);
    },
  };
}

/** Seconds between two frame timestamps; 0 for the first frame or a clock that went back. */
const secondsSince = (last: number | undefined, now: number): number =>
  last === undefined ? 0 : Math.max(0, now - last) / 1000;

/** Puts a controllable player into `options.scene`. Call between sim steps, after loading. */
export function setupTestbedPlayer<TObject, TCommand>(
  options: TestbedPlayerOptions<TObject, TCommand>,
): TestbedPlayer {
  const { world, scene, sync, camera, publish, publishCamera, collision, tuning } = options;
  const cameraTuning = options.cameraTuning;
  const look = lookSettings(cameraTuning);
  const lowestPitch = look.minPitch;
  const { lockOn } = options;
  // With lock-on, attacks face the locked target during startup (mw-e02.31).
  const melee =
    options.melee === undefined || lockOn === undefined
      ? options.melee
      : { ...options.melee, target: lockedTarget, locate: lockOn.locate ?? placedTargetPosition };
  const entity = installPlayer(world, {
    spawns: scene.layout.spawns,
    ...(options.startSpawn !== undefined && { startSpawn: options.startSpawn }),
    collision,
    tuning,
    fallResetY:
      Math.min(
        ...scene.layout.pieces.map((piece) => piece.min.y),
        ...scene.layout.spawns.map((spawn) => spawn.position.y),
      ) - PLAYER_FALL_RESET_MARGIN,
    look: {
      ...look,
      ...(options.sensitivity !== undefined && { sensitivity: options.sensitivity }),
    },
    pitch: toRadians(cameraTuning.pitch.initial),
    ...(options.ledges !== undefined && {
      ledges: { index: sceneLedges(scene), ...options.ledges },
    }),
    ...(options.climb !== undefined && { climb: options.climb }),
    ...(options.statuses !== undefined && { statuses: options.statuses }),
    ...(options.water !== undefined && {
      water: { volumes: waterVolumes(scene.layout.regions), ...options.water },
    }),
    ...(options.moves !== undefined && {
      combat: {
        moves: options.moves,
        ...(melee !== undefined && { melee }),
        ...(options.bow !== undefined && { bow: options.bow }),
      },
    }),
  });
  // The scene's authored ropes (pieces marked climbable: rope) hang ready to climb (mw-e02.13).
  if (options.climb !== undefined) sceneRopes(world, scene);
  const orbit = new OrbitCamera(cameraTuning, collision);
  const interaction = options.interaction;
  let unsubscribe: (() => void) | undefined;
  if (interaction !== undefined) {
    const { sight, bodiesOf, publish: publishInteraction } = interaction;
    installInteraction(world, {
      ...(sight !== undefined && { sight }),
      ...(bodiesOf !== undefined && { bodiesOf: (_world, target) => bodiesOf(target) }),
    });
    addInteractor(world, entity, interaction.kit);
    addSceneInteractables(world, scene.spawns);
    if (publishInteraction !== undefined) {
      unsubscribe = world.events.on(interacted, (event) => {
        if (event.actor === entity) publishInteraction(event);
      });
    }
  }
  const hasMoves = options.moves !== undefined;
  const bow = hasMoves ? options.bow : undefined;
  const aim = bow && { ...bow.aim, zoom: new AimZoom(cameraTuning.fov) };
  let framing: LockFraming | undefined;
  if (lockOn !== undefined) {
    installLockOn(world, entity, {
      tuning: lockOn.tuning,
      sight: lockOn.sight,
      locate: lockOn.locate ?? placedTargetPosition,
      ...(lockOn.defeated !== undefined && { defeated: lockOn.defeated }),
    });
    for (const { entity: target, spawn } of scene.spawns) {
      const profile = spawn.targetable === undefined ? undefined : lockOn.profile(spawn.targetable);
      if (profile !== undefined) giveTargetable(world, target, profile);
    }
    framing = new LockFraming(lockOn.tuning.framing, { min: look.minPitch, max: look.maxPitch });
  }

  const lockTarget = (): LockTarget | undefined => {
    const target = lockOn && world.get(entity, LockOnComponent)?.target;
    const anchor = world.get(entity, ViewAnchor);
    return target == null || anchor === undefined
      ? undefined
      : { entity: target, point: anchor.point };
  };

  // Remember the interpolated transform render sync last applied: the camera follows exactly what
  // is drawn.
  let shown: Transform | undefined;
  const inner = options.binding(options.object, readPlayerTransform);
  sync.bind(entity, {
    ...inner,
    apply(object, transform) {
      inner.apply(object, transform);
      shown = transform;
    },
  });

  const readout = (): PlayerReadout | undefined => {
    const state = world.get(entity, CharacterController);
    const view = world.get(entity, PlayerLook);
    if (state === undefined || view === undefined) return undefined;
    // Only a player with moves has a timeline (and the components are only registered then).
    const timeline = hasMoves ? world.get(entity, ActionTimelineComponent) : undefined;
    const pool = timeline === undefined ? undefined : staminaOf(world, entity);
    return {
      tick: world.tick,
      position: roundVec(state.position),
      grounded: state.grounded,
      traversal: state.traversal,
      yaw: round(view.yaw),
      pitch: round(view.pitch),
      ...(timeline !== undefined && {
        combat: {
          action: timeline.current?.move ?? null,
          stamina: round(pool?.current ?? 0),
          blocking: pool?.blocking ?? false,
        },
      }),
      ...(lockOn !== undefined && { lock: world.get(entity, LockOnComponent)?.target ?? null }),
      ...(bow !== undefined && { bow: bowReadout() }),
      ...waterReadout(),
    };
  };

  const waterReadout = (): { water?: PlayerWaterReadout } => {
    const breath = world.isRegistered(CharacterBreath)
      ? world.get(entity, CharacterBreath)
      : undefined;
    if (breath === undefined) return {};
    const water = tuning.water ?? DEFAULT_WATER_TUNING;
    return {
      water: {
        inWater: breath.inWater,
        sinking: breath.sinking,
        breath: round(breathFraction(breath, water, world.clock.hz)),
      },
    };
  };

  const bowReadout = (): PlayerBowReadout => {
    const state = world.get(entity, BowComponent);
    const slots = world.get(entity, QuiverComponent)?.slots ?? [];
    return {
      equipped: state?.equipped ?? false,
      selected: state?.selected ?? '',
      draw: state?.draw?.ticks ?? null,
      quiver: Object.fromEntries(slots.map((slot) => [slot.arrow, slot.count])),
    };
  };

  /** Eases the lens toward the bow's aim while the player draws (mw-e05.21). */
  const zoomLens = (dt: number): void => {
    if (aim === undefined) return;
    const fov = aim.zoom.update(isDrawing(world, entity), aim.fov, aim.time, dt);
    if (fov === camera.fov) return;
    camera.fov = fov;
    camera.updateProjectionMatrix?.();
  };

  // Pitch is not part of the interpolated transform (the body does not tilt), so it is
  // interpolated here between the last two ticks the camera saw, as render sync does for yaw.
  let pitchTick: number | undefined;
  let pitchBefore = 0;
  let pitchNow = 0;
  const drawnPitch = (current: number, alpha: number): number => {
    if (pitchTick === undefined) pitchNow = current;
    if (world.tick !== pitchTick) {
      pitchBefore = pitchNow;
      pitchNow = current;
      pitchTick = world.tick;
    }
    return pitchBefore + (pitchNow - pitchBefore) * alpha;
  };

  const body =
    options.animation === undefined
      ? undefined
      : animatedBody(world, entity, options.animation, options.moves);

  const counts = { frames: 0, clipped: 0, pulledIn: 0 };
  let lastMs: number | undefined;
  let publishedTick = -1;
  let drove = false;
  let drivesCamera = true;
  let pulled = 0;

  const placeCamera = (alpha: number, dt: number): void => {
    const state = world.get(entity, CharacterController);
    const look = world.get(entity, PlayerLook);
    if (shown === undefined || state === undefined || look === undefined) return;
    const height = state.crouched ? tuning.capsule.crouchHeight : tuning.capsule.height;
    // Coming back from the debug camera is a cut: no recovery from wherever it last was.
    if (!drove) {
      orbit.cut();
      framing?.cut();
    }
    drove = true;
    const feet = shown.position;
    const simView = { yaw: yawOf(shown.rotation), pitch: drawnPitch(look.pitch, alpha) };
    const pivot = { x: feet.x, y: feet.y + cameraTuning.pivotHeight, z: feet.z };
    const framed = framing?.update(simView, pivot, lockTarget()?.point, dt) ?? simView;
    const view =
      pulled === 0
        ? framed
        : {
            ...framed,
            pitch: Math.max(lowestPitch, framed.pitch + pulled * DEATH_PULL_BACK.pitch),
          };
    zoomLens(dt);
    const pose = orbit.update({ feet, ...view, height }, camera, dt);
    applyOrbitPose(camera, pose);
    if (publishCamera === undefined) return;
    counts.frames += 1;
    if (!nearPlaneClear(collision, pose, camera)) counts.clipped += 1;
    if (pose.boom < pose.ideal - 1e-6) counts.pulledIn += 1;
    publishCamera({
      ...counts,
      boom: round(pose.boom),
      zoom: round(pose.ideal),
      position: roundVec(pose.position),
      fov: round(camera.fov),
    });
  };

  const player: TestbedPlayer = {
    entity,
    get drivesCamera() {
      return drivesCamera;
    },
    set drivesCamera(value: boolean) {
      drivesCamera = value;
      if (!value) drove = false;
    },
    onStep() {
      body?.driver.capture();
    },
    frame(info) {
      const dt = info === undefined ? 0 : secondsSince(lastMs, info.timeMs);
      if (info !== undefined) lastMs = info.timeMs;
      if (drivesCamera) placeCamera(info?.alpha ?? 1, dt);
      body?.frame(info?.alpha ?? 1, dt);
      if (publish === undefined || world.tick === publishedTick) return;
      const current = readout();
      if (current === undefined) return;
      publishedTick = world.tick;
      publish(current);
    },
    zoom(notches) {
      orbit.zoomBy(notches);
    },
    pullBack(fraction) {
      pulled = Math.min(1, Math.max(0, fraction));
      orbit.pullBack = pulled * DEATH_PULL_BACK.metres;
    },
    readout,
    prompt() {
      if (interaction === undefined || !world.isAlive(entity)) return undefined;
      return interactionPrompt(world, entity);
    },
    lockTarget,
    dispose() {
      unsubscribe?.();
      body?.driver.remove(entity);
      sync.unbind(entity);
      if (world.isAlive(entity)) world.destroy(entity);
      shown = undefined;
    },
  };
  player.frame(); // camera and readout in place before the first frame
  return player;
}
