import {
  createBrowserAudioEngine,
  gameSoundRegistry,
  installGestureUnlock,
  listenerPose,
} from '@audio/index';
import {
  controllerTuningFor,
  GAME_CONFIG_ID,
  loadGameContent,
  materialPresets,
  PLAYER_CAMERA_ID,
  PLAYER_CONTROLLER_ID,
  PLAYER_CLASSES,
  PLAYER_LOCK_ON_ID,
  RESPAWN_RULES_ID,
  type GameContent,
  type PlayerClass,
} from '@content/index';
import {
  arrowReadout,
  bindArrows,
  bindSandboxDummies,
  createSandboxHud,
  dummyReadout,
  installSandboxRules,
  prepareTestbedCombat,
  attachCombatHud,
  attachTargetHud,
  cameraForward,
  horizontalHalfFov,
  readArrowTransform,
  readDummyTransform,
  readSandboxDummyTransform,
  startTestbedCombat,
  TRAINING_DUMMY,
  type CombatHudGlue,
  type TargetHudGlue,
  type SandboxHud,
} from '@game/combat/index';
import {
  bindCreatures,
  combatVeto,
  COMBAT_VETO_ID,
  creatureReadout,
  CreatureTelegraphs,
  formatPerceptionStats,
  prepareCreatures,
  SceneNavigation,
  sceneCreatureErrors,
  startCreatureDrops,
  startCreatures,
  startSceneNoise,
  viewCentrePoint,
  watchCreatureAi,
  watchPresence,
  type GameCreatures,
} from '@game/creatures/index';
import { bindBreakLeftovers, BreakWatch, hasBreakables } from '@game/breakables/index';
import {
  bindWorldItems,
  ItemWatch,
  prepareConsumables,
  prepareWorldItems,
  startConsumables,
  startWorldItems,
} from '@game/items/index';
import { startInventoryUi, type InventoryUi } from '@game/items/inventory-screen';
import { startContainerUi, type ContainerUi } from '@game/items/container-window';
import { startShopUi } from '@game/shop/shop-window';
import {
  ContainerWatch,
  hasContainers,
  prepareContainers,
  startContainers,
} from '@game/items/containers';
import {
  doorLeafLooks,
  hasMechanisms,
  MechanismWatch,
  readDoorLeaf,
  sceneCheckpoints,
  startMechanisms,
} from '@game/mechanisms/index';
import { createCapabilityRegistry, createUnlockBook } from '@game/capabilities';
import { createStudyRules } from '@game/items/book-study';
import {
  applyClass,
  classCards,
  createClassRules,
  isPlayerClass,
  kitModel,
  newGameRequest,
  playableClasses,
} from '@game/classes';
import { attachGameAudio, attachGameVfx, soundPositions } from '@game/cues/index';
import { bindVolumes, SliceMusic } from '@game/music/index';
import { layers } from '@game/index';
import { ActionSampler, inputGlyph, type InputDevice } from '@game/input/index';
import { debugConsoleEnabled } from '@game/debug-console-gate';
import { isSlotId, type SlotId } from '@game/save/slots/ids';
import {
  browserFrameSources,
  CommandQueue,
  createGameLoop,
  InputPlayer,
  InputRecorder,
  type InputLogSegment,
  object3DBinding,
} from '@game/loop/index';
import { installFactRegistry } from '@game/facts';
import { bootPhysics } from '@game/physics-loader';
import {
  formatBudgetWarning,
  installGamePhysics,
  playerFocus,
  propBodies,
} from '@game/physics-objects';
import {
  createSettingsStore,
  loadBindings,
  openOptionsMenu,
  type SettingsStore,
} from '@game/settings/index';
import {
  createUiGameBridge,
  PauseController,
  SaveProgress,
  SliceCompleteController,
} from '@game/ui/index';
import {
  createGameLight,
  installGameLight,
  isFire,
  lightProbe,
  lightReadout,
  lightSpawns,
  probeGrid,
  selectLights,
  type LightSpawn,
} from '@game/light/index';
import {
  attachPlayerInput,
  CONTROLLER_HOT_EVENT,
  DeathBeat,
  interactPromptModel,
  lockMarkerModel,
  readControllerFile,
  respawnRulesFrom,
  setupTestbedPlayer,
  type ControllerHotUpdate,
  type TestbedPlayer,
  attachWaterHud,
  playerWater,
  type WaterHudGlue,
} from '@game/player/index';
import {
  readPhysicsObjectTransform,
  readSceneTransform,
  resolveSceneRequest,
  SceneLoader,
} from '@game/scene/index';
import {
  applyCarriedPlayer,
  applyCarriedWorld,
  Arrival,
  carriedClassId,
  peekTransit,
  takeTransit,
  TransitionController,
  type Transit,
} from '@game/transit/index';
import {
  DeathReload,
  takePendingLoad,
  type PendingLoad,
  type PendingLoadStorage,
} from '@game/save/death/index';
import {
  bootMenuRequest,
  opensTitle,
  SaveMenus,
  searchWithoutMenu,
  titleSearch,
  type SaveMenuReadout,
} from '@game/save/menus/index';
import { autosaveReadout, GameAutosave, SafetyVetoes } from '@game/save/autosave/index';
import { describeSave } from '@game/save/describe';
import { createGameSaveRegistry } from '@game/save/sections';
import { SaveSlots } from '@game/save/slots/index';
import { openSaveStore, type OpenedSaveStore } from '@game/save/storage/index';
import { missingFeatures } from '@game/support';
import { vfxTextureManifest, vfxTextureUrls, VfxSystem } from '@game/vfx/index';
import { createRenderBootstrap } from '@render/bootstrap/index';
import { createLeftover, disposeLeftover } from '@render/breakables/index';
import { createWorldItemMesh, disposeWorldItemMesh } from '@render/items/index';
import { createDoorLeaf, disposeDoorLeaf } from '@render/mechanisms/index';
import {
  createArrowShaft,
  createSandboxDummy,
  createTrainingDummy,
  disposeArrowShaft,
} from '@render/combat/index';
import {
  createCreatureProxy,
  CreatureDeaths,
  HitFlashes,
  showCreatureTelegraph,
} from '@render/creatures/index';
import { creatureLocomotion } from '@game/creatures/animation';
import { installRepopulationOnRest, repopulateOnArrival } from '@game/creatures/repopulation';
import { AnimationDriver, simAnimReader } from '@game/animation/index';
import { pickVariant, randomSalt, variantFromSearch } from '@render/creatures/variant';
import { createHitVolumeOverlay } from '@render/debug/hit-volumes';
import { applyEnvironment } from '@render/environment/index';
import { createGreyboxView } from '@render/greybox/index';
import { createLightRig } from '@render/light/index';
import { AnimationController, compileGraph } from '@render/animation/index';
import { createPlayerBody, loadKnight, OcclusionFade, projectToNdc } from '@render/player/index';
import { anyHiddenByBody } from '@game/camera/index';
import { createVfxRenderer } from '@render/vfx/index';
import { captureCanvasThumbnail, type CapturedThumbnail } from '@render/thumbnail';
import {
  addCapabilities,
  installStudy,
  announceRespawn,
  installSceneTransitions,
  AttackerDummyComponent,
  classOf,
  equipChanged,
  factChanged,
  goldChanged,
  itemAdded,
  itemRemoved,
  checkCreatureSpawn,
  checkSandboxCommand,
  checkSandboxSpawn,
  DAMAGE_COMPONENTS,
  HIT_VOLUME_COMPONENTS,
  installDebugCommands,
  installGameClock,
  installPlayerDeath,
  isPlayerDead,
  LineOfSight,
  LEDGE_HANG_CAPABILITY,
  levelDeltasOf,
  persistDroppedItems,
  physicsBodiesOf,
  PhysicsObjectComponent,
  playerRespawned,
  playerStart,
  RapierCollisionWorld,
  RapierSightWorld,
  creaturesInstalled,
  CreatureComponent,
  PlacementComponent,
  registerPersistence,
  installSlainFacts,
  registerSceneComponents,
  RespawnRules,
  sceneAuthoredEntities,
  SceneSpawnComponent,
  SpilledComponent,
  testPropSpawners,
  tuneCommand,
  volumeEntered,
  World,
  WorldPersistence,
  worldItemSpawner,
  zeroHealth,
  DamageApplied,
  Died,
  hashWorld,
  type ActionFrame,
  type DebugCommand,
  type DifficultyCommand,
  type ContainerActionCommand,
  type InventoryActionCommand,
  type SandboxCommand,
  type UseQuickSlotCommand,
  type EntityId,
  type VolumeCrossing,
  type LightEmitterView,
  type RapierPhysics,
  type Vec3,
} from '@sim/index';
import {
  compactProbe,
  playerAnimationProbe,
  setupAnimationDemo,
  type AnimDemo,
} from '@tools/anim-demo/setup';
import { bindDebugCameraInput, DebugCamera } from '@tools/debug-camera/index';
import { layer as tools } from '@tools/index';
import { sceneAgitator } from '@tools/perf/agitator';
import { FramePerfProbe, formatPerfReport, parsePerfParam } from '@tools/perf/frame-probe';
import { formatVfxStats, parseVfxParam, VfxDemo } from '@tools/vfx-demo/index';
import {
  CombatHud,
  DamageNumbers,
  TargetBar,
  DeathFade,
  InteractPrompt,
  KitPanel,
  LockMarker,
  openClassSelect,
  reducedMotion,
  setTextScale,
  UiRoot,
  WaterHud,
} from '@ui/index';
import {
  DEBUG_CAMERA_HINT,
  GAMEPAD_DISCONNECTED_HINT,
  playerControlsHint,
  SANDBOX_HINT,
  sceneErrorMessage,
  sceneLabel,
} from '@ui/scene-hud';
import {
  PHYSICS_FAILED_TEXT,
  PHYSICS_LOADING_TEXT,
  unsupportedMessage,
  type MissingFeature,
} from '@ui/unsupported';

/** The player's placeholder rig: the grey-box humanoid's animation graph (mw-e02.6). */
const PLAYER_RIG_ID = 'greybox-humanoid';

/** Release saves record until playtest builds are versioned (CHANGELOG: Unreleased). */
const GAME_VERSION = '0.0.0';

/** Where each death → reload readout is published on #app (the e2e reads them). */
const READOUT_ATTRIBUTE = { death: 'death', saved: 'savedGame', loaded: 'loadedSave' } as const;

/** Where each save menu readout is published on #app (the e2e reads them). */
const SAVE_MENU_ATTRIBUTE = {
  title: 'saveMenuTitle',
  list: 'saveMenuList',
  saved: 'saveMenuSaved',
  deleted: 'saveMenuDeleted',
} as const;

/** How long a save waits for a drawn frame to take its thumbnail from. */
const THUMBNAIL_WAIT_MS = 5000;
/** The slice's pass fact (docs/design/vertical-slice.md §5); setting it autosaves (mw-e01.7). */
const SLICE_COMPLETE_FACT = 'slice.complete';

/** Placeholder world seed until new-game/save flows choose one. */
const BOOT_SEED = 1;

/** Everything the game feeds `World.step`: sampled input plus queued debug-console commands. */
type GameCommand =
  | ActionFrame
  | ContainerActionCommand
  | DebugCommand
  | DifficultyCommand
  | InventoryActionCommand
  | SandboxCommand
  | UseQuickSlotCommand;

const app = document.querySelector<HTMLElement>('#app');
if (app) {
  app.dataset['layers'] = [...layers, tools].join(' ');
  // Player settings (mw-e31.1): per-browser, loaded first; in memory when the browser blocks storage.
  const settings = createSettingsStore({ storage: () => globalThis.localStorage });
  app.dataset['settingsStore'] = settings.persistent ? 'local' : 'memory';
  startRenderer(app, startSaves(app), settings);
}

// Opens save storage (mw-e30.2). If the browser blocks IndexedDB the game runs on in-memory saves,
// and the player must be told for as long as that lasts.
async function startSaves(root: HTMLElement): Promise<OpenedSaveStore> {
  const saves = await openSaveStore({
    indexedDB: globalThis.indexedDB,
    storage: globalThis.navigator.storage,
  });
  root.dataset['saveStore'] = saves.store.kind;
  if (saves.warning !== undefined) {
    const banner = document.createElement('p');
    banner.setAttribute('role', 'alert');
    banner.dataset['testid'] = 'save-warning';
    banner.textContent = saves.warning;
    root.prepend(banner);
    console.warn(saves.reason);
  }
  return saves;
}

// Renderer and physics bootstrap (mw-e00.19). Checks the minimum features first so a browser
// without WebGL 2 or WebAssembly gets a readable screen instead of a blank page or uncaught error.
function startRenderer(
  root: HTMLElement,
  saves: Promise<OpenedSaveStore>,
  settings: SettingsStore,
): void {
  const missing = missingFeatures(globalThis);
  if (missing.length > 0) {
    showUnsupported(root, missing);
    return;
  }
  let view;
  try {
    view = createRenderBootstrap({
      container: root,
      // The game loop below draws each frame after stepping the sim (mw-e00.20).
      animationLoop: false,
      // The greybox scene below replaces the mw-e00.19 placeholder (mw-e00.21).
      placeholderScene: false,
      onFirstFrame: () => {
        root.dataset['firstFrameMs'] = String(Math.round(performance.now()));
      },
    });
  } catch {
    // The context can still fail to create (blocklisted GPU, hardware acceleration off).
    showUnsupported(root, ['webgl2']);
    return;
  }
  const { camera } = view;

  // ?perf (mw-e00.21 AC-6): times each whole frame callback (sim steps + render submission) and the
  // interval between frames, then logs percentiles once. See src/tools/perf/frame-probe.ts.
  const perf = parsePerfParam(location.search);
  const browserSources = browserFrameSources(globalThis.window);
  let sources = browserSources;
  if (perf !== undefined) {
    const probe = new FramePerfProbe(perf);
    const { scheduler } = browserSources;
    sources = {
      ...browserSources,
      scheduler: {
        request: (callback) =>
          scheduler.request(() => {
            const start = performance.now();
            callback();
            const report = probe.frame(start, performance.now() - start);
            if (report !== undefined) {
              root.dataset['perf'] = JSON.stringify(report);
              const { calls, triangles } = view.renderer.info.render;
              root.dataset['renderInfo'] = JSON.stringify({ calls, triangles });
              console.info(formatPerfReport(report));
            }
          }),
        cancel: (handle) => {
          scheduler.cancel(handle);
        },
      },
    };
  }

  // The debug fly camera (mw-e00.21) drives the view camera directly and hands it back on toggle-off.
  const writeCameraData = (): void => {
    const round = (n: number): number => Math.round(n * 1e4) / 1e4;
    root.dataset['camera'] = JSON.stringify({
      position: camera.position.toArray().map(round),
      quaternion: camera.quaternion.toArray().map(round),
    });
  };
  const debugCamera = new DebugCamera({
    read: () => ({
      position: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
      rotation: {
        x: camera.quaternion.x,
        y: camera.quaternion.y,
        z: camera.quaternion.z,
        w: camera.quaternion.w,
      },
    }),
    write: ({ position, rotation }) => {
      camera.position.set(position.x, position.y, position.z);
      camera.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);
    },
  });

  const hud = document.createElement('div');
  hud.dataset['testid'] = 'scene-hud';
  const label = document.createElement('p');
  label.dataset['testid'] = 'scene-label';
  const hint = document.createElement('p');
  hint.dataset['testid'] = 'debug-camera-hint';
  hint.textContent = DEBUG_CAMERA_HINT;
  const controls = document.createElement('p');
  controls.dataset['testid'] = 'player-controls-hint';
  hud.append(label, controls, hint);
  root.append(hud);

  // Keyboard + mouse and gamepad → one ActionFrame per sim tick (mw-e02.1, mw-e02.9); a click on the
  // canvas takes control (pointer lock) of the player, once there is one (mw-e02.23). A gamepad needs
  // no click: the sampler polls it every tick while the page has focus.
  // Custom bindings saved through the settings store apply at startup (mw-e02.22).
  const savedBindings = loadBindings(settings);
  const sampler = new ActionSampler({
    bindings: savedBindings.bindings,
    padBindings: savedBindings.gamepad,
  });

  // The HUD/menu layer (mw-e00.23). Screens pushed onto it may capture input (gameplay action frames
  // are withheld) and pause the sim; menus need the pointer, so capture releases pointer lock.
  const ui = new UiRoot(root);
  // The text size setting (accessibility.textScale) scales every menu and HUD text.
  setTextScale(ui.element, settings.get('accessibility.textScale'));
  settings.on('accessibility.textScale', (scale) => {
    setTextScale(ui.element, scale);
  });
  // The contextual Interact prompt (mw-e02.5): the player's focus, with the bound key or button.
  const interactPrompt = new InteractPrompt();
  ui.hud.append(interactPrompt.element);
  const uiInput = ui.attachInput({
    window: globalThis.window,
    navigator: globalThis.navigator,
    now: () => performance.now(),
  });
  // The Inventory action (I, View) opens and closes the inventory screen (mw-e17.10), once the world
  // has one: seen in gameplay frames while it is closed, and in the frames drained while it pauses.
  let inventoryUi: InventoryUi | undefined;
  // The container window and pickup toasts (mw-e18.4), once the player exists.
  let containerUi: ContainerUi | undefined;
  // The pause menu (mw-e01.3), once the world has a player: the Pause action (Esc, P, Menu) opens it
  // from gameplay frames, and resumes from the frames drained while it pauses.
  let pauseUi: PauseController | undefined;
  const bridge = createUiGameBridge({
    ui,
    sampleCommands: (tick) => {
      const frames = sampler.sampleCommands(tick);
      if (frames.some((frame) => frame.inventory.pressed)) inventoryUi?.toggle();
      if (frames.some((frame) => frame.pause.pressed)) pauseUi?.pausePressed();
      return frames;
    },
    drain: () => {
      const frame = sampler.sample();
      if (frame.inventory.pressed) inventoryUi?.toggle();
      pauseUi?.drained(frame.pause.pressed);
    },
  });
  // The lock-on marker (mw-e02.16) rides the HUD layer over the locked target's lock point.
  const lockMarker = new LockMarker();
  ui.hud.append(lockMarker.element);
  ui.subscribe(({ capturesInput }) => {
    root.dataset['uiCapture'] = String(capturesInput);
    if (capturesInput && document.pointerLockElement !== null) document.exitPointerLock();
  });
  // The controls hint follows the device last used (mw-e02.9 AC-5); a disconnect says so (AC-4).
  let shown: InputDevice | 'gone' | undefined;
  let padGone = false;
  const showControls = (): void => {
    if (player === undefined) return;
    const device = sampler.lastDevice;
    const gone = padGone && device === 'gamepad';
    if ((gone ? 'gone' : device) === shown) return;
    shown = gone ? 'gone' : device;
    root.dataset['inputDevice'] = device;
    const bindings = { keyboardMouse: sampler.bindings, gamepad: sampler.padBindings };
    const glyph = (
      action:
        | 'move'
        | 'jump'
        | 'sprint'
        | 'crouch'
        | 'dodge'
        | 'primaryAttack'
        | 'secondaryAttack'
        | 'ability1'
        | 'ability3',
    ) => inputGlyph(action, device, bindings);
    controls.textContent = gone
      ? GAMEPAD_DISCONNECTED_HINT
      : playerControlsHint(device, {
          move: glyph('move'),
          jump: glyph('jump'),
          sprint: glyph('sprint'),
          crouch: glyph('crouch'),
          dodge: glyph('dodge'),
          attack: glyph('primaryAttack'),
          strongAttack: glyph('ability1'),
          leftHand: glyph('ability3'),
          block: glyph('secondaryAttack'),
        });
  };
  const playerInput = attachPlayerInput(sampler, {
    window: globalThis.window,
    document: globalThis.document,
    element: view.canvas,
    gamepad: {
      navigator: globalThis.navigator,
      hasFocus: () => document.hasFocus(),
      onConnect: () => {
        padGone = false;
        root.dataset['gamepad'] = 'connected';
      },
      onDisconnect: () => {
        padGone = true;
        root.dataset['gamepad'] = 'disconnected';
      },
    },
  });
  let player: TestbedPlayer | undefined;
  // Area transitions (mw-e01.11): a page that arrives from another area shows the loading overlay
  // (area name) if it takes longer than half a second to become playable, and publishes how long
  // the whole transition took in #app[data-transit]; a page that leaves hands off through
  // `transitions`, whose `leaving` holds the sim while the page reloads.
  const transitStore = sessionStore();
  const incoming = peekTransit(transitStore);
  const arrival =
    incoming === undefined
      ? undefined
      : new Arrival(incoming, {
          overlayParent: root,
          now: () => Date.now(),
          publish: (readout) => {
            root.dataset['transit'] = JSON.stringify(readout);
          },
        });
  let transitions: TransitionController | undefined;
  // The browser ends pointer lock on Esc itself (and on alt-tab), not always passing the key on:
  // losing the player's lock while nothing else is open pauses the game (mw-e01.3).
  let hadLock = false;
  document.addEventListener('pointerlockchange', () => {
    const locked = document.pointerLockElement === view.canvas;
    if (hadLock && !locked) pauseUi?.pointerUnlocked();
    hadLock = locked;
  });

  bindDebugCameraInput(debugCamera, {
    keys: globalThis.window,
    surface: view.canvas,
    onToggle: (active) => {
      root.dataset['debugCamera'] = active ? 'on' : 'off';
      hint.textContent = active ? `${DEBUG_CAMERA_HINT} · ON` : DEBUG_CAMERA_HINT;
      // The fly camera shares WASD: the player lets go of input and the camera while it flies.
      playerInput.enabled = !active;
      if (player) player.drivesCamera = !active;
      writeCameraData();
    },
  });
  root.dataset['debugCamera'] = 'off';

  // Fixed-step sim on requestAnimationFrame (mw-e00.20). The sim owns its physics (mw-e03.35), so the
  // world starts once the physics module has loaded; the dynamic import keeps Rapier and its WASM
  // out of the initial bundle.
  const startWorld = (physics: RapierPhysics, content: GameContent): void => {
    const world = registerSceneComponents(new World<GameCommand>({ seed: BOOT_SEED, physics }));
    // The fact registry (mw-e27.2) on the world's facts: typed declarations, and the former keys
    // that let a save's renamed facts load under their current keys (mw-e27.4).
    installFactRegistry(world.facts, content);
    // The in-game clock (mw-e27.12), first so every system sees the tick's time; its data is game.json.
    installGameClock(world, content.get('game', GAME_CONFIG_ID).clock);
    // The knight's sword and shield (mw-e04.6): moves, socket tracks, the wood shield and the
    // damage model with the shield rule; and the combat sandbox's tuning (mw-e04.9).
    const combat = prepareTestbedCombat(content);
    // Every creature in content, spawnable by id from scene data and the console (mw-e12.4): the
    // bestiary's (the Forgotten miner, mw-e13.1), plus the frozen fixture creatures in debug builds.
    const creatures: GameCreatures = prepareCreatures(content, combat);
    // Debug commands first (mw-e33.1), so a teleport or cheat is what every later system sees. The
    // sim side is always present; only the console that issues them is dev/playtest-only. Props with
    // a body spawn as physics objects (mw-e33.16), like the scene's own movable props. God mode
    // joins the damage model; the sandbox's dummies are spawnable in every scene (mw-e04.9).
    const props = propBodies(content);
    const propSpawners = testPropSpawners(
      content.all('testprop').map((prop) => prop.id),
      { props, materials: materialPresets(content.all('material')) },
    );
    const spawners = new Map([...propSpawners, ...combat.spawners, ...creatures.spawners]);
    installDebugCommands(world, { spawners, damage: combat.damage });
    // The combat sandbox's rules (mw-e04.9): its commands, attacker metronomes (before the player's
    // action timeline, so a swing starts on its beat) and infinite-health refills.
    installSandboxRules(world, combat);
    const commands = new CommandQueue<GameCommand>();
    const afterStep: (() => void)[] = [];
    // Swept hitboxes and region-tagged hurtboxes (mw-e04.2). No faction table is loaded yet, so
    // nobody counts as an ally; ?hitboxes draws what the system tests each tick. The hit-volume
    // system itself joins after the player (startTestbedCombat), so swings sweep on their first
    // active tick.
    world.register(...HIT_VOLUME_COMPONENTS, ...DAMAGE_COMPONENTS);
    // Physics objects (mw-e03.39): scene props fall, stack and get knocked about in the sim; bodies
    // near the player never get forced to sleep. Budget warnings go to the console and to the
    // `data-physics-budget` debug attribute.
    const focus = playerFocus(world);
    // The light field (mw-e03.37): level geometry goes into physics and the field's occluders through
    // one sink, so a piece that burns away stops blocking both.
    const light = createGameLight(physics);
    installGamePhysics(world, {
      // Breaks spill their contents as props (mw-e03.11).
      breakables: { props, materials: materialPresets(content.all('material')) },
      focus: focus.read,
      onBudgetExceeded: (warning) => {
        console.warn(formatBudgetWarning(warning));
        root.dataset['physicsBudget'] = JSON.stringify(warning);
      },
      levelColliders: light.colliders,
    });
    installGameLight(world, light.field);
    const hitOverlay = createHitVolumeOverlay();
    hitOverlay.enabled = new URLSearchParams(location.search).has('hitboxes');
    view.scene.add(hitOverlay.object);
    root.dataset['hitboxOverlay'] = hitOverlay.enabled ? 'on' : 'off';

    let dummy: EntityId | undefined;
    // The combat sandbox's frame-data overlay and slow motion (mw-e04.9), in the sandbox scene or
    // with ?frames anywhere.
    let sandboxHud: SandboxHud | undefined;
    // The player's health and stamina bars with damage feedback (mw-e04.10), once it is a combatant.
    let combatHud: CombatHudGlue | undefined;
    let targetHud: TargetHudGlue | undefined;
    // The breath meter and the sinking warning (mw-e02.14).
    let waterHud: WaterHudGlue | undefined;
    let publishedDummy = '';

    // VFX (mw-e29.1): effects from content, simulated each frame after the sim and the camera have
    // moved, drawn by src/render/vfx. Presentation only: the system reads entity transforms and never
    // writes to the sim. Sockets need skeletons, so entity effects emit from the entity's origin for
    // now. `?vfx` shows the stats overlay; `?vfx=demo` / `?vfx=stress` spawn the test effects.
    const vfxAnchor = (entity: EntityId) =>
      readPhysicsObjectTransform(world, entity) ??
      readDummyTransform(world, entity) ?? // any placed entity: the dummies and the player
      readSceneTransform(world, entity);
    const vfx = new VfxSystem({ effects: content.all('vfx-effect'), anchors: vfxAnchor });
    // VFX cue sheets (mw-e29.3): the same sim events as the audio cue sheets spawn effects — hit
    // dust and sparks, the parry flash, impact puffs, break debris, burning loops. Event-driven, so
    // nothing runs per frame while no effect is live.
    attachGameVfx({
      world,
      vfx,
      sheets: content.all('vfx-cue-sheet'),
      materials: content.all('material'),
      arrows: content.all('arrow'),
      locate: vfxAnchor,
      now: () => performance.now(),
    });
    // Textures load by asset id from the texture manifest: generated placeholders (mw-e29.2) until
    // approved art replaces them under the same ids.
    const vfxView = createVfxRenderer(view.scene, {
      textureUrl: vfxTextureUrls(vfxTextureManifest()),
    });

    // Audio (mw-e28.2): the cue sheets turn sim events (hits, stagger, deaths, physics impacts) into
    // sounds from the sound manifest — the synthesised placeholder pack until final SFX land. The
    // context starts on the first click or key press (autoplay policy); until then nothing plays.
    // Positional sounds follow their entity; the listener follows the camera each frame. The e2e
    // reads the context state and the latest cues from #app[data-audio].
    const sounds = gameSoundRegistry();
    const audio = createBrowserAudioEngine({
      registry: sounds,
      dev: import.meta.env.DEV,
      entityPosition: soundPositions(world, [
        readPhysicsObjectTransform,
        readDummyTransform, // any placed entity: the dummies and the player
        readSceneTransform,
      ]),
    });
    installGestureUnlock(document, audio);
    const recentCues: string[] = [];
    attachGameAudio({
      world,
      engine: audio,
      registry: sounds,
      sheets: content.all('cue-sheet'),
      materials: content.all('material'),
      // Swing whooshes play each move's own sound (mw-e28.4); footsteps read the ground's material.
      moves: content.all('move'),
      // Arrows layer their own impact sounds (a water splash) over the surface's (mw-e05.19).
      arrows: content.all('arrow'),
      now: () => performance.now(),
      onPlay: (cue) => {
        recentCues.push(cue);
        if (recentCues.length > 10) recentCues.shift();
      },
    });
    let publishedAudio = '';
    const publishAudio = (): void => {
      const { state, voices } = audio.stats();
      const json = JSON.stringify({ state, voices, cues: recentCues });
      if (json !== publishedAudio) root.dataset['audio'] = publishedAudio = json;
    };
    const vfxMode = parseVfxParam(location.search);
    let vfxDemo: VfxDemo | undefined;
    let vfxStats: HTMLElement | undefined;
    let vfxStatsAgeMs = Infinity;
    if (vfxMode !== undefined) {
      vfxStats = document.createElement('pre');
      vfxStats.dataset['testid'] = 'vfx-stats';
      hud.append(vfxStats);
    }
    const showVfxStats = (elapsedMs: number): void => {
      vfxStatsAgeMs += elapsedMs;
      if (vfxStats === undefined || vfxStatsAgeMs < 250) return;
      vfxStatsAgeMs = 0;
      const stats = vfx.stats();
      vfxStats.textContent = formatVfxStats(stats);
      root.dataset['vfx'] = JSON.stringify(stats);
    };

    // The creatures now (mw-e12.4 e2e): how many, how many drawn and in view, of which kinds.
    let publishedCreatures = '';
    const publishCreatures = (): void => {
      const readout = creatureReadout(
        world,
        (entity) => sync.has(entity),
        (point) => projectToNdc(camera, point),
      );
      const json = JSON.stringify(readout);
      if (json !== publishedCreatures) root.dataset['creatures'] = publishedCreatures = json;
    };

    // Rendered light mirrors the sim's light field (mw-e03.37): the greybox fill and sun follow its
    // environment, a capped pool of point/spot lights follows the emitters nearest the camera. The
    // e2e reads sim and rendered light of the scene's lit spawns from #app[data-lights], and with
    // ?lightprobe the sim level at visible floor points from #app[data-light-probe].
    const lightRig = createLightRig(view.scene);
    const sightWorld = new RapierSightWorld(physics);
    const probeLight = new URLSearchParams(location.search).has('lightprobe');
    let watchedLights: readonly LightSpawn[] = [];
    let probePoints: readonly Vec3[] = [];
    let shownEnvironment: unknown;
    let publishedLights = '';
    let publishedLightProbe = '';
    const drawLights = (): void => {
      const { field } = light;
      if (field.environment !== shownEnvironment) {
        shownEnvironment = field.environment;
        greybox.setEnvironment(field.environment);
      }
      const chosen = selectLights(field.lights(), camera.position, lightRig.caps);
      const withFire = (l: LightEmitterView) => ({ ...l, fire: isFire(world, l) });
      const drawn = lightRig.sync(chosen.points.map(withFire), chosen.spots.map(withFire));
      if (watchedLights.length > 0) {
        const readout = lightReadout(world, field, watchedLights, drawn);
        const key = JSON.stringify(readout.spawns);
        if (key !== publishedLights) {
          publishedLights = key;
          root.dataset['lights'] = JSON.stringify(readout);
        }
      }
      if (probeLight && probePoints.length > 0) {
        const samples = lightProbe(
          field,
          probePoints,
          (point) => projectToNdc(camera, point),
          (point) => sightWorld.firstCrossing(camera.position, point) === undefined,
        );
        const json = JSON.stringify(samples);
        if (json !== publishedLightProbe) root.dataset['lightProbe'] = publishedLightProbe = json;
      }
    };

    // Arrows (mw-e05.21): every arrow the sim flies or rests gets a grey-box shaft after each step.
    // Once any arrow exists, the e2e reads them from #app[data-arrows]; until then nothing is done.
    let arrowsSeen = false;
    let publishedArrows = '';
    const drawArrows = (): void => {
      const bound = bindArrows(world, sync, () => {
        const shaft = createArrowShaft();
        view.scene.add(shaft);
        return { ...object3DBinding(shaft, readArrowTransform), dispose: disposeArrowShaft };
      });
      if (bound > 0) arrowsSeen = true;
    };
    const publishArrows = (): void => {
      if (!arrowsSeen) return;
      const readout = arrowReadout(
        world,
        (entity) => sync.has(entity),
        (point) => projectToNdc(camera, point),
      );
      const json = JSON.stringify(readout);
      if (json !== publishedArrows) root.dataset['arrows'] = publishedArrows = json;
    };

    // The death beat (mw-e01.8): the camera pull-back and fade between the player's death and the
    // death screen. Set up once the player and the death screen exist (below).
    let deathBeat: DeathBeat | undefined;
    // The slice-complete card (mw-e01.18), opened the frame after slice.complete turns true.
    let sliceCard: SliceCompleteController | undefined;
    let captureAfterRender: ((capture: Promise<CapturedThumbnail>) => void) | undefined;
    // A save's thumbnail (mw-e30.11): the next drawn frame, or the placeholder when no frame comes
    // (a hidden tab). Manual saves and autosaves both take one.
    const captureThumbnail = (): Promise<CapturedThumbnail> =>
      new Promise<CapturedThumbnail>((resolve, reject) => {
        captureAfterRender = (capture) => {
          capture.then(resolve, reject);
        };
        setTimeout(() => {
          reject(new Error('no frame was drawn for the thumbnail'));
        }, THUMBNAIL_WAIT_MS);
      });
    // The scene's checkpoint volumes (mw-e01.4), which request autosaves (mw-e01.7).
    let isCheckpoint: ((crossing: VolumeCrossing) => boolean) | undefined;
    // The title screen is the front door (mw-e01.2): a page naming no scene, new-game choice or menu
    // boots the game's start scene with the title menu over it, and its New Game opens class
    // selection right there (`startNewGame`), with no reload. The e2e reads the timings (page-relative
    // milliseconds) from #app[data-front-door]: the title shown, New Game pressed, the class applied.
    const titleFirst = opensTitle(location.search);
    let startNewGame: (() => void) | undefined;
    const frontDoor: { titleMs?: number; newGameMs?: number; playableMs?: number } = {};
    const markFrontDoor = (step: keyof typeof frontDoor): void => {
      frontDoor[step] = Math.round(performance.now());
      root.dataset['frontDoor'] = JSON.stringify(frontDoor);
    };
    let lastFrameMs: number | undefined;
    const interactions: { tick: number; verb: string; spawn: string | null }[] = [];
    // Animated demo characters in the testbed (mw-e02.20), and the probe the e2e reads.
    let animation: AnimDemo | undefined;
    let creatureAnimation: AnimationDriver | undefined;
    let creatureDeaths: CreatureDeaths | undefined;
    let hitFlashes: HitFlashes | undefined;
    let frameClock: ((ms: number) => void) | undefined;
    let playerFade: OcclusionFade | undefined;
    let publishedProbe = '';
    // The AI debug overlay (mw-e11.17): loaded with the debug console (below), so release builds
    // never have it. `ai.freeze` holds the sim through simPaused; it draws before each render.
    let aiDebug: { held(): boolean; frame(): void } | undefined;
    // Debug pages only (mw-e01.9): the input log's recorder or replay runs just before each sample.
    let beforeSample: ((tick: number) => void) | undefined;
    const { loop, sync } = createGameLoop({
      world,
      sources,
      // Queued debug-console commands pass even while a UI screen withholds gameplay frames.
      sampleCommands: commands.sampler((tick) => {
        beforeSample?.(tick);
        return bridge.sampleCommands(tick);
      }),
      simPaused: () =>
        bridge.simPaused() || aiDebug?.held() === true || transitions?.leaving === true,
      // A pausing menu's queued command (the inventory's Use, Drop…) still runs, one tick a frame;
      // while `ai.freeze` holds the sim, queued commands wait for `ai.step`.
      stepWhilePaused: () => aiDebug?.held() !== true && commands.size > 0,
      onStep: () => {
        player?.onStep();
        animation?.driver.capture();
        creatureAnimation?.capture();
        for (const hook of afterStep) hook();
      },
      draw: (frame) => {
        uiInput.poll();
        bridge.frame();
        const { timeMs } = frame;
        const elapsedMs = timeMs - (lastFrameMs ?? timeMs);
        if (debugCamera.update(elapsedMs)) writeCameraData();
        lastFrameMs = timeMs;
        deathBeat?.frame(frame.alpha);
        sliceCard?.frame();
        containerUi?.frame(timeMs);
        player?.frame(frame);
        if (player !== undefined && playerFade !== undefined) {
          // The body fades while it hides a creature from the camera.
          const at = world.get(player.entity, PlacementComponent);
          let hiding = false;
          if (at !== undefined && creaturesInstalled(world)) {
            const chests: { x: number; y: number; z: number }[] = [];
            world.query(CreatureComponent, PlacementComponent).forEach((_entity, _creature, c) => {
              chests.push({ x: c.x, y: c.y + 1, z: c.z });
            });
            hiding = anyHiddenByBody(camera.position, { x: at.x, y: at.y + 1, z: at.z }, chests);
          }
          playerFade.update(hiding, Math.max(0, elapsedMs) / 1000);
        }
        if (player !== undefined) {
          const glyph = inputGlyph('interact', sampler.lastDevice, {
            keyboardMouse: sampler.bindings,
            gamepad: sampler.padBindings,
          });
          const dead = isPlayerDead(world, player.entity);
          interactPrompt.update(interactPromptModel(dead ? undefined : player.prompt(), glyph));
        }
        if (dummy !== undefined) {
          // The e2e reads the dummy's health here (mw-e04.6 AC-7).
          const readout = JSON.stringify(dummyReadout(world, dummy) ?? null);
          if (readout !== publishedDummy) root.dataset['dummy'] = publishedDummy = readout;
        }
        sandboxHud?.frame();
        combatHud?.frame(timeMs);
        waterHud?.frame(timeMs);
        targetHud?.frame(timeMs);
        lockMarker.update(
          lockMarkerModel(
            player?.lockTarget(),
            (point) => projectToNdc(camera, point),
            root.clientWidth,
            root.clientHeight,
          ),
        );
        hitOverlay.sync(world);
        publishCreatures();
        publishArrows();
        creatureDeaths?.update(Math.max(0, elapsedMs) / 1000);
        frameClock?.(timeMs);
        hitFlashes?.update(timeMs);
        creatureAnimation?.frame(frame.alpha, Math.max(0, elapsedMs) / 1000, camera.position);
        if (animation !== undefined) {
          animation.driver.frame(frame.alpha, Math.max(0, elapsedMs) / 1000, camera.position);
          const probe = JSON.stringify(compactProbe(animation.driver.probe()));
          if (probe !== publishedProbe) root.dataset['animation'] = publishedProbe = probe;
        }
        showControls();
        vfxDemo?.update(elapsedMs / 1000);
        vfx.update(elapsedMs / 1000, camera.position);
        vfxView.draw(vfx.batches, vfx.markers);
        showVfxStats(elapsedMs);
        audio.update(listenerPose(camera.position, camera.quaternion));
        publishAudio();
        drawLights();
        aiDebug?.frame();
        view.renderFrame(timeMs);
        // A save's thumbnail (mw-e30.11) is read straight after a render, while the frame is still
        // in the drawing buffer.
        const capture = captureAfterRender;
        captureAfterRender = undefined;
        capture?.(captureCanvasThumbnail(view.canvas));
      },
    });

    // The scene loader fills the world from content (mw-e00.21); static colliders go into the
    // sim's Rapier world, bound to stone piece entities, and movable props become physics objects
    // drawn from their sim pose (mw-e03.39).
    const greybox = createGreyboxView(view.renderer, view.scene);
    const scenes = new SceneLoader({
      world,
      sync,
      colliders: light.colliders,
      content,
      objects: greybox,
      binding: (object, read) => object3DBinding(object, read),
      physics: {},
      light: light.field,
    });
    // How creature AI travels (mw-e11.21): the loaded scene's navmesh, when it has one.
    const navigation = new SceneNavigation();
    // No ?scene= boots the game's start scene (game.startScene, mw-e01.2): the slice in m1.
    const startScene = content.get('game', GAME_CONFIG_ID).startScene.id;
    const request = resolveSceneRequest(location.search, scenes.available(), startScene);
    // The transition this page arrived by, once its scene is known to be the one asked for.
    let transit: Transit | undefined;
    if (request.kind === 'scene') {
      const scene = content.get('scene', request.id);
      const loaded = scenes.load(scene.id);
      // An area transition's hand-off (mw-e01.11): the facts, level changes and merchants carried
      // from the area just left go in before anything in this one starts; the player arrives at the
      // spawn the transition names (or the one ?spawn= asks for), facing the way it faces.
      const handOff = takeTransit(transitStore);
      transit = handOff?.to === scene.id ? handOff : undefined;
      if (transit === undefined) arrival?.dismiss();
      const asked =
        transit?.spawn ?? new URLSearchParams(location.search).get('spawn') ?? undefined;
      const arrivalSpawn =
        asked !== undefined && loaded.layout.spawns.some((spawn) => spawn.id === asked)
          ? asked
          : undefined;
      if (asked !== undefined && arrivalSpawn === undefined) {
        console.warn(`scene ${scene.id} has no spawn "${asked}": starting at its player start`);
      }
      const carryOptions = {
        registry: createGameSaveRegistry({
          knownItem: (id) => content.has('item', id),
          warn: (message) => {
            console.warn(message);
          },
        }),
        knownItem: (id: string) => content.has('item', id),
        warn: (message: string) => {
          console.warn(message);
        },
      };
      if (transit !== undefined) applyCarriedWorld(world, transit.carry, carryOptions);
      // Sky, fog and the painted backdrop of outdoor scenes (mw-ju8.1). The unapproved backdrop images
      // are not in production builds, so only dev loads them.
      applyEnvironment(view.scene, scene.environment, { load: import.meta.env.DEV });
      // Volume sliders drive the buses; the slice's ambience and music beds play from the first
      // gesture on (mw-0j5), a stand-in for the adaptive controller (mw-e28.11).
      const volumes = bindVolumes(audio, settings);
      const music =
        scene.id === 'slice'
          ? new SliceMusic({ world, engine: audio, now: () => performance.now() })
          : undefined;
      afterStep.push(() => {
        volumes.update();
        music?.update();
      });
      // Noise propagation through the scene's rooms and doors (mw-e09.22): footsteps, breaks and
      // creatures' noises reach listeners muffled by shut doors and walls.
      startSceneNoise(world, content, loaded);
      navigation.load(world, content, loaded);
      camera.position.set(...scene.camera.position);
      camera.lookAt(...scene.camera.target);
      watchedLights = lightSpawns(loaded);
      // The perf-baseline stress scene (mw-e32.1): blasts at its perf-agitator markers keep its props
      // moving; scenes without markers have no agitator.
      const agitator = sceneAgitator(loaded.layout.spawns, world.clock.hz);
      if (agitator !== undefined) {
        afterStep.push(() => {
          const blast = agitator.commandFor(world.tick);
          if (blast !== undefined) commands.push(blast);
        });
      }
      const floor = loaded.layout.pieces[0];
      if (probeLight && floor !== undefined) probePoints = probeGrid(floor.min, floor.max, 0.02);
      // A controllable player (mw-e02.23) in scenes with a player start; it collides with the
      // scene through the sim's Rapier world (mw-e02.21) and brings the orbit camera (mw-e02.4),
      // which queries the same world read-only to stay out of walls.
      // The controller, the camera and arrows (mw-e05.21) all collide with the sim's Rapier world.
      const collision = new RapierCollisionWorld(physics);
      // New game (mw-e19.5): ?newgame opens class selection, ?class=<id> applies that class. Only the
      // game configuration's playable classes can start a run (mw-e01.15); a debug build's
      // ?allclasses unlocks every class.
      const playable = playableClasses(content, location.search, __DEBUG_CONSOLE__);
      const newGame = newGameRequest(location.search, playable);
      const capabilities = createCapabilityRegistry(content);
      if (playerStart(loaded.layout.spawns) !== undefined) {
        // No class is chosen yet (mw-e19.5), so the player moves on the base profile.
        const tuning = controllerTuningFor(content.get('controller', PLAYER_CONTROLLER_ID));
        const cameraTuning = content.get('camera', PLAYER_CAMERA_ID);
        camera.fov = cameraTuning.fov;
        camera.near = cameraTuning.near;
        camera.updateProjectionMatrix();
        // The player's body is the grey-box humanoid, animated from its sim locomotion (mw-e02.6).
        const graph = compileGraph(
          content.get('anim-graph', PLAYER_RIG_ID),
          content.all('anim-clip'),
        );
        // The knight's model (mw-e37.21) takes the boxes' place once it has loaded.
        const body = createPlayerBody(graph.rig, loadKnight());
        playerFade = new OcclusionFade(body.root);
        let publishedPlayerProbe = '';
        player = setupTestbedPlayer({
          world,
          scene: loaded,
          ...(arrivalSpawn !== undefined && { startSpawn: arrivalSpawn }),
          sync,
          tuning,
          cameraTuning,
          collision,
          // The knight's moves: the dodge roll and backstep (mw-e04.8), the light chain and the
          // shield (mw-e04.6) are playable.
          moves: combat.moves,
          melee: combat.melee,
          // The shortbow and a quiver (mw-e05.21): 4 takes it out, hold the attack button to draw.
          bow: combat.bow,
          // Mantling for every class; ledge hangs are capability-gated (mw-e02.12) and granted
          // through the capability registry below.
          ledges: {},
          // Ladders, ropes and ivy for every class (mw-e02.13); rough walls need the climbing
          // capability, which class data (mw-e02.3) will grant the thief.
          climb: {},
          // Wading, swimming and sinking in the scene's water regions (mw-e02.14): the armor load
          // class decides swim or sink; breath running out is drowning damage.
          water: playerWater({ content, world, damage: combat.damage }),
          object: body.root,
          animation: {
            controller: new AnimationController(graph),
            apply: (pose) => {
              body.apply(pose);
            },
            lower: (metres) => {
              body.lower(metres);
            },
            // The e2e animation probe (mw-e02.6 AC-4): each layer's state and clip, and the states
            // and clips entered, oldest first.
            publish: (probe) => {
              const json = JSON.stringify(playerAnimationProbe(probe));
              if (json !== publishedPlayerProbe) {
                root.dataset['playerAnimation'] = publishedPlayerProbe = json;
              }
            },
          },
          binding: (object, read) => {
            view.scene.add(object);
            return object3DBinding(object, read);
          },
          camera,
          // Lock-on (mw-e02.16): the scene's targetable spawns, seen through the sim's physics.
          lockOn: {
            tuning: content.get('lock-on', PLAYER_LOCK_ON_ID),
            sight: new LineOfSight({ world: new RapierSightWorld(physics) }),
            profile: (id) => content.get('targetable', id),
            defeated: zeroHealth,
          },
          publish: (readout) => {
            root.dataset['player'] = JSON.stringify(readout);
          },
          // The e2e clipping probe (mw-e02.4 AC-5): frames drawn, and how many clipped (must be 0).
          publishCamera: (readout) => {
            root.dataset['orbitCamera'] = JSON.stringify(readout);
          },
          // Focus and Interact (mw-e02.5): reach is blocked by anything solid in the sim's Rapier
          // world. The e2e reads the player's interactions (latest last) from #app[data-interactions].
          interaction: {
            sight: new RapierSightWorld(physics),
            bodiesOf: (entity) => physicsBodiesOf(world, entity),
            publish: (event) => {
              interactions.push({
                tick: world.tick,
                verb: event.verb,
                spawn: world.get(event.target, SceneSpawnComponent)?.id ?? null,
              });
              root.dataset['interactions'] = JSON.stringify(interactions.slice(-10));
            },
          },
        });
        focus.entity = player.entity; // bodies near the player never get forced to sleep
        // The player's capabilities (mw-e19.2). A new game grants the chosen class's own (mw-e19.5,
        // below), as does one started from the title; a scene booted straight from its URL has no
        // class, so ledge hangs come as a class grant.
        addCapabilities(world, player.entity);
        if (newGame.kind === 'none' && !titleFirst) {
          capabilities.grant(world, player.entity, LEDGE_HANG_CAPABILITY, 'class');
        }
        // Dev hot reload (mw-e02.3): a saved player controller file retunes the player from the
        // next tick, through the same recorded command as the console's ctl.set; no page reload.
        const tuned = player.entity;
        import.meta.hot?.on(CONTROLLER_HOT_EVENT, (update: ControllerHotUpdate) => {
          const reload = readControllerFile(update);
          if (!reload.ok) {
            for (const problem of reload.problems) console.warn(problem);
          } else if (reload.id === PLAYER_CONTROLLER_ID) {
            commands.push(tuneCommand(tuned, reload.tuning));
            console.info(`${update.file}: applied to the player`);
          }
        });
        // The mouse wheel zooms the orbit camera while the player has control (2–6 m).
        view.canvas.addEventListener(
          'wheel',
          (event) => {
            if (!playerInput.locked) return;
            event.preventDefault();
            player?.zoom(Math.sign(event.deltaY));
          },
          { passive: false },
        );
        showControls();
      }
      if (scene.id === 'testbed') {
        animation = setupAnimationDemo({
          world,
          sync,
          content,
          // The player's combat (mw-e04.8) already runs the action timeline.
          sharedTimeline: player !== undefined,
          binding: (object, read) => {
            view.scene.add(object);
            return object3DBinding(object, read);
          },
        });
      }
      // Hit volumes, melee strikes, hit reactions (mw-e04.7, mw-e04.31), the player as a combatant
      // and the scene's training and sandbox dummies (mw-e04.6, mw-e04.9), after the player.
      // Arrows fly against the level and every hurtbox (mw-e05.21).
      const { dummies } = startTestbedCombat(
        world,
        combat,
        loaded.layout.spawns,
        player?.entity,
        collision,
      );
      drawArrows();
      afterStep.push(drawArrows);
      // The combat HUD (mw-e04.10): bars top-right, sized by the HUD scale setting, fed by the
      // player's sim state and events; arcs point at off-screen attackers relative to the camera.
      if (player !== undefined) {
        const bars = new CombatHud({
          scale: settings.get('accessibility.hudScale'),
          reducedMotion: () => reducedMotion(ui.element, (q) => globalThis.matchMedia(q)),
        });
        ui.hud.append(bars.element);
        settings.on('accessibility.hudScale', (scale) => {
          bars.setScale(scale);
        });
        combatHud = attachCombatHud({
          world,
          player: player.entity,
          hud: bars,
          view: () => ({
            forward: cameraForward(camera.quaternion),
            halfFov: horizontalHalfFov(camera.fov, camera.aspect),
          }),
        });
        // The breath meter (mw-e02.14): shown only while the player is short of breath, with the
        // armor's warning when it drags the player under.
        const breath = new WaterHud({
          reducedMotion: () => reducedMotion(ui.element, (q) => globalThis.matchMedia(q)),
        });
        ui.hud.append(breath.element);
        waterHud = attachWaterHud({
          world,
          player: player.entity,
          hud: breath,
          tuning: controllerTuningFor(content.get('controller', PLAYER_CONTROLLER_ID)),
        });
        // The target bar and damage numbers (mw-e04.21): the locked (or last-hit) fighter's health,
        // and what each hit did, over whoever took it.
        const reduced = (): boolean => reducedMotion(ui.element, (q) => globalThis.matchMedia(q));
        const targetBar = new TargetBar({ reducedMotion: reduced });
        const damageNumbers = new DamageNumbers({ reducedMotion: reduced });
        ui.hud.append(targetBar.element, damageNumbers.element);
        targetHud = attachTargetHud({
          world,
          player: player.entity,
          bar: targetBar,
          numbers: damageNumbers,
          lock: () => player?.lockTarget(),
          project: (point) => projectToNdc(camera, point),
          size: () => ({ width: root.clientWidth, height: root.clientHeight }),
          numbersEnabled: () => settings.get('gameplay.damageNumbers'),
        });
      }
      // World items (mw-e17.7): the scene's items lie in the world as physics objects; the player
      // takes one with Interact and drops (G) or throws (T) the selected one. Each gets a placeholder
      // box once it exists; the e2e reads the pack and the world items from #app[data-items], which
      // is rebuilt only after a take, drop, throw or refusal.
      const worldItems = prepareWorldItems(content);
      startWorldItems(world, worldItems, loaded.spawns, player?.entity);
      // Consumables (mw-e17.6): the use pipeline and the player's four quick slots; a thrown
      // consumable flies as a world item carrying its world properties. No buttons use the slots
      // yet (keys 1–4 are the abilities').
      const consumables = prepareConsumables(content, worldItems);
      startConsumables(world, consumables, player?.entity);
      // The inventory screen and the quick-slot strip (mw-e17.10): I or View opens the screen; its
      // actions reach the sim as commands. The e2e reads #app[data-inventory] (open/closed) and
      // #app[data-quick-slots].
      // Studying a spellbook (mw-e07.2): the inventory's Study action starts a session that the
      // study system plays out as game time passes, learning the spell through the unlock book.
      const study = createStudyRules(
        content,
        capabilities,
        createUnlockBook(content, capabilities),
      );
      installStudy(world, study);
      inventoryUi = startInventoryUi({
        ui,
        world,
        content,
        consumables,
        study,
        player: player?.entity,
        submit: (command) => {
          commands.push(command);
        },
        hudScale: settings.get('accessibility.hudScale'),
        publish: (key, value) => {
          root.dataset[key] = value;
        },
        closeKeys: () => sampler.bindings.inventory,
      });
      globalThis.window.addEventListener('keydown', (event) => {
        if (inventoryUi?.keydown(event) === true) event.preventDefault();
      });
      settings.on('accessibility.hudScale', (scale) => {
        inventoryUi?.setHudScale(scale);
      });
      afterStep.push(() => {
        inventoryUi?.afterStep();
      });
      // The container window and pickup toasts (mw-e18.4): Interact's Search on a chest opens its
      // window; Take, Take gold and Take All reach the sim as commands. Every pickup (a world item,
      // anything taken from a container) shows a toast bottom-right. The e2e reads
      // #app[data-container-window] (open/closed) and #app[data-pickups] (the visible toasts).
      if (player !== undefined) {
        const loot = startContainerUi({
          ui,
          world,
          content,
          player: player.entity,
          submit: (command) => {
            commands.push(command);
          },
          hudScale: settings.get('accessibility.hudScale'),
          now: () => performance.now(),
          publish: (key, value) => {
            root.dataset[key] = value;
          },
        });
        containerUi = loot;
        settings.on('accessibility.hudScale', (scale) => {
          loot.setHudScale(scale);
        });
        afterStep.push(() => {
          loot.afterStep();
        });
        // The shop (mw-e20.10): talking to a counter tagged `merchant:<id>` opens its screen; deals go
        // straight to the shops engine while the sim is paused. #app[data-shop] (JSON: open,
        // merchant, crowns) is the e2e's readout.
        const shop = startShopUi({
          ui,
          world,
          content,
          player: player.entity,
          // Trainers teach through the unlock book (mw-ju8.13).
          unlocks: createUnlockBook(content, capabilities),
          // Sleeping is refused while any autosave safety veto objects (mw-ju8.6).
          safety: () => safety.active()[0]?.reason ?? null,
          publish: (key, value) => {
            root.dataset[key] = value;
          },
        });
        afterStep.push(() => {
          shop.afterStep();
        });
      }
      // Class selection (mw-e19.5): the chosen class's capabilities, kit and stats go onto the player
      // once its inventory exists, and the player then moves on the class's controller tuning. The
      // kit panel shows the class and the pack; #app[data-player-class] is the sim's player.class
      // (the e2e reads both).
      if (player !== undefined && (newGame.kind !== 'none' || titleFirst)) {
        const hero = player.entity;
        const classRules = createClassRules(content, capabilities);
        const profile = content.get('controller', PLAYER_CONTROLLER_ID);
        const kitPanel = new KitPanel();
        ui.hud.append(kitPanel.element);
        let kitDirty = false;
        const markKit = (): void => {
          kitDirty = true;
        };
        world.events.on(itemAdded, markKit);
        world.events.on(itemRemoved, markKit);
        world.events.on(goldChanged, markKit);
        world.events.on(equipChanged, markKit);
        const drawKit = (): void => {
          kitDirty = false;
          kitPanel.update(kitModel(world, hero, content));
        };
        afterStep.push(() => {
          if (kitDirty) drawKit();
        });
        const choose = (classId: PlayerClass): void => {
          applyClass(world, hero, classId, classRules);
          commands.push(tuneCommand(hero, controllerTuningFor(profile, classId)));
          root.dataset['playerClass'] = classOf(world, hero) ?? '';
          drawKit();
          if (frontDoor.newGameMs !== undefined) markFrontDoor('playableMs');
        };
        const selectClass = (): void => {
          openClassSelect(ui, {
            cards: classCards(content, playable),
            onConfirm: (id) => {
              if (isPlayerClass(id) && playable.has(id)) choose(id);
            },
          });
        };
        if (newGame.kind === 'class') choose(newGame.classId);
        else if (newGame.kind === 'select') selectClass();
        else if (newGame.kind === 'none') startNewGame = selectClass;
        else if (newGame.kind === 'locked-class') {
          console.warn(
            `?class=${newGame.classId}: not playable in this build (?allclasses unlocks)`,
          );
        } else
          console.warn(`?class=${newGame.classId}: not a class (${PLAYER_CLASSES.join(', ')})`);
      }
      const itemWatch = new ItemWatch(world, player?.entity);
      let publishedItems = -1;
      const drawItems = (): void => {
        bindWorldItems(world, sync, worldItems, (_entity, size, category) => {
          const object = createWorldItemMesh(size, category);
          view.scene.add(object);
          return {
            ...object3DBinding(object, readPhysicsObjectTransform),
            dispose: disposeWorldItemMesh,
          };
        });
        if (itemWatch.version === publishedItems) return;
        publishedItems = itemWatch.version;
        root.dataset['items'] = JSON.stringify(itemWatch.readout());
      };
      drawItems();
      afterStep.push(drawItems);
      // Breakables (mw-e03.11): only in scenes that have them, debris and spilled props get boxes
      // after each step, and the e2e reads what broke from #app[data-breakables].
      if (hasBreakables(loaded.layout)) {
        const breaks = new BreakWatch(world);
        let publishedBreaks = '';
        const drawBreaks = (): void => {
          bindBreakLeftovers(world, sync, (entity, size) => {
            const object = createLeftover(size, world.has(entity, SpilledComponent));
            view.scene.add(object);
            return {
              ...object3DBinding(object, readPhysicsObjectTransform),
              dispose: disposeLeftover,
            };
          });
          const json = JSON.stringify(breaks.readout());
          if (json !== publishedBreaks) root.dataset['breakables'] = publishedBreaks = json;
        };
        drawBreaks();
        afterStep.push(drawBreaks);
      }
      // Mechanisms (mw-e03.18): only in scenes with doors, switches or signal graphs. Started after
      // the player, so doors and switches get their prompts and move the tick they are told to.
      // Door leaves collide in the sim's Rapier world, closed ones occlude the light field, and
      // each leaf follows its sim pose; the e2e reads them from #app[data-mechanisms].
      if (hasMechanisms(loaded.layout)) {
        const made = startMechanisms(world, loaded, {
          content,
          materials: materialPresets(content.all('material')),
          colliders: physics,
          occluders: light.field.statics,
          player: player?.entity,
        });
        const watch = new MechanismWatch(world, made);
        const leaves = doorLeafLooks(world, made, content).map(
          ({ entity, size, centre, material }) => {
            const object = createDoorLeaf(size, centre, material);
            view.scene.add(object);
            sync.bind(entity, {
              ...object3DBinding(object, readDoorLeaf),
              dispose: disposeDoorLeaf,
            });
            return { entity, object };
          },
        );
        let publishedMechanisms = '';
        const drawMechanisms = (): void => {
          for (const { entity, object } of leaves) object.visible = !watch.broken(entity);
          const json = JSON.stringify(watch.readout());
          if (json !== publishedMechanisms) root.dataset['mechanisms'] = publishedMechanisms = json;
        };
        drawMechanisms();
        afterStep.push(drawMechanisms);
        // Checkpoints (mw-e01.4): the e2e reads the checkpoint volumes the player has entered,
        // oldest first, from #app[data-checkpoints]. Each requests an autosave (mw-e01.7, below).
        const checkpoint = sceneCheckpoints(loaded.layout);
        isCheckpoint = checkpoint;
        const reached: string[] = [];
        world.events.on(volumeEntered, (crossing) => {
          if (!checkpoint(crossing)) return;
          reached.push(crossing.node);
          root.dataset['checkpoints'] = JSON.stringify(reached);
        });
      }
      // Containers (mw-e18.3): only in scenes that have them, after world items (they share the
      // inventory rules) and mechanisms (which unlock a locked chest). Interact on one opens its
      // window (above); the e2e reads what each holds from #app[data-containers].
      if (hasContainers(loaded.layout)) {
        const made = startContainers(
          world,
          prepareContainers(content, worldItems.inventory),
          loaded,
          content,
        );
        const watch = new ContainerWatch(world, made);
        let publishedContainers = '';
        const drawContainers = (): void => {
          const json = JSON.stringify(watch.readout());
          if (json !== publishedContainers) root.dataset['containers'] = publishedContainers = json;
        };
        drawContainers();
        afterStep.push(drawContainers);
      }
      // World facts (mw-e01.4): the e2e reads the set facts, e.g. the slice's pass slice.complete
      // (docs/design/vertical-slice.md §5), from #app[data-facts], rewritten when one changes.
      const publishFacts = (): void => {
        root.dataset['facts'] = JSON.stringify(world.facts.snapshot());
      };
      publishFacts();
      world.events.on(factChanged, publishFacts);
      // The scene's creature spawns (mw-e12.4), after combat so they are hittable and lockable. A
      // spawn naming a creature or faction that does not exist is reported, not fatal. Creatures
      // perceive the player by the light field over the sim's Rapier world (mw-e11.23) and think and
      // walk the scene's navmesh (mw-e11.21); the e2e reads them from #app[data-ai], and ?perf shows
      // perception's spend against its budget.
      const sceneCreatures = startCreatures(world, creatures, combat, loaded.layout.spawns, {
        content,
        player: player?.entity,
        light: light.field,
        sight: sightWorld,
        navigation,
      });
      for (const line of sceneCreatureErrors(sceneCreatures)) console.error(line);
      // Creatures that keep to some phases of the day come and go with the clock (mw-ju8.14).
      watchPresence(world, creatures.spawn, loaded.layout.spawns);
      // A placed creature's death sets its slain fact (mw-e01.7), e.g. entity:slice/skeleton.slain.
      installSlainFacts(world, scene.id, loaded.layout.spawns);
      // A dying creature drops what it carries and rolls its loot table (mw-e01.5): the slice's
      // skeleton drops the gallery key at its body.
      startCreatureDrops(world, content, worldItems, scene.id, loaded.layout.spawns);
      const watch = watchCreatureAi(world, sceneCreatures.ai, navigation);
      if (watch !== undefined) {
        let publishedAi = '';
        let perfLine: HTMLElement | undefined;
        if (perf !== undefined) {
          perfLine = document.createElement('pre');
          perfLine.dataset['testid'] = 'perf-overlay';
          hud.append(perfLine);
        }
        afterStep.push(() => {
          watch.step();
          const readout = watch.readout();
          const json = JSON.stringify(readout);
          if (json === publishedAi) return;
          root.dataset['ai'] = publishedAi = json;
          if (perfLine !== undefined) perfLine.textContent = formatPerceptionStats(readout);
        });
      }
      // Every creature — the scene's, the console's, respawned ones — gets a placeholder capsule
      // (with bones for the Forgotten's placeholder-capsule-bones mesh, mw-e13.1).
      // Its body glows while it winds up a telegraphed move (mw-e04.20); the telegraph watch exists
      // only where creatures do, and a step with no telegraph change costs one empty check.
      const creatureProxies = new Map<EntityId, ReturnType<typeof createCreatureProxy>>();
      // Which look each Forgotten miner wears: one salt per game session, hashed with the miner's
      // entity, so a new game looks different; ?miner=N pins one (mw-1ja).
      // Their animation: the shared humanoid rig and clips, posed by a driver of their own (the
      // testbed's demo characters use another); creatures walk by how far they moved (mw-e37.402).
      const creatureGraph = compileGraph(
        content.get('anim-graph', PLAYER_RIG_ID),
        content.all('anim-clip'),
      );
      const creatureRead = simAnimReader({
        moves: combat.moves,
        locomotion: creatureLocomotion(),
      });
      const minerDriver = new AnimationDriver(world);
      creatureAnimation = minerDriver;
      // A creature that dies falls where it stood and stays there (src/render/creatures/death.ts).
      const deaths = new CreatureDeaths();
      creatureDeaths = deaths;
      // A creature that takes damage flashes white for 80 ms (mw-e29.4).
      const flashes = new HitFlashes();
      hitFlashes = flashes;
      let frameMs = 0;
      world.events.on(DamageApplied, ({ target, total }) => {
        const proxy = creatureProxies.get(target);
        if (proxy !== undefined && total > 0) flashes.flash(proxy, frameMs);
      });
      frameClock = (ms) => {
        frameMs = ms;
      };
      const creatureHeights = new Map<EntityId, number>();
      const minerSalt = randomSalt();
      const pinnedMiner = variantFromSearch(location.search);
      const drawCreatures = (): void => {
        bindCreatures(world, sync, (entity, look) => {
          const object = createCreatureProxy({
            id: look.id,
            radius: look.nav.radius,
            height: look.nav.height,
            armed: look.armed,
            mesh: creatures.table.get(look.id)?.def.presentation.mesh,
            variant: pinnedMiner ?? pickVariant(minerSalt, entity),
            animation: {
              rig: creatureGraph.rig,
              attach: (view) => {
                if (zeroHealth(world, entity)) return;
                minerDriver.add(entity, {
                  name: look.id,
                  controller: new AnimationController(creatureGraph),
                  read: creatureRead,
                  apply: (pose) => {
                    view.apply(pose);
                  },
                });
              },
            },
          });
          view.scene.add(object);
          creatureProxies.set(entity, object);
          creatureHeights.set(entity, look.nav.height);
          if (zeroHealth(world, entity)) deaths.start(object, look.nav.height, true);
          const binding = object3DBinding(object, readSandboxDummyTransform);
          return {
            ...binding,
            dispose: (target: typeof object) => {
              creatureProxies.delete(entity);
              creatureHeights.delete(entity);
              binding.dispose(target);
            },
          };
        });
      };
      drawCreatures();
      afterStep.push(drawCreatures);
      world.events.on(Died, ({ target }) => {
        const proxy = creatureProxies.get(target);
        if (proxy === undefined) return;
        minerDriver.remove(target);
        deaths.start(proxy, creatureHeights.get(target) ?? 1.8);
      });
      if (creaturesInstalled(world)) {
        const telegraphs = new CreatureTelegraphs(world);
        afterStep.push(() => {
          for (const [entity, look] of telegraphs.drain()) {
            const proxy = creatureProxies.get(entity);
            if (proxy !== undefined) showCreatureTelegraph(proxy, look);
          }
        });
      }
      // Sandbox dummies — the scene's and any the console spawns — get grey-box bodies.
      const bindDummies = (): void => {
        bindSandboxDummies(world, sync, (entity) => {
          const attacker = world.has(entity, AttackerDummyComponent);
          const object = createSandboxDummy({
            radius: combat.sandbox.tuning.dummy.radius,
            attacker,
          });
          view.scene.add(object);
          return object3DBinding(object, readSandboxDummyTransform);
        });
      };
      bindDummies();
      afterStep.push(bindDummies);
      const isSandbox = scene.id === combat.sandbox.tuning.scene;
      if (isSandbox || new URLSearchParams(location.search).has('frames')) {
        sandboxHud = createSandboxHud({
          world,
          root,
          hud: ui.hud,
          keys: globalThis.window,
          loop,
          moves: combat.moves,
          player: () => player?.entity,
          hitboxes: hitOverlay,
          visible: true,
          keysEnabled: () => !ui.capturesInput,
        });
        const sandboxHint = document.createElement('p');
        sandboxHint.dataset['testid'] = 'sandbox-hint';
        sandboxHint.textContent = SANDBOX_HINT;
        hud.append(sandboxHint);
      }
      const { radius, torso } = TRAINING_DUMMY;
      for (const entity of dummies) {
        const object = createTrainingDummy({ radius, height: torso.top });
        view.scene.add(object);
        sync.bind(entity, object3DBinding(object, readDummyTransform));
      }
      dummy = dummies[0];
      if (vfxMode === 'demo' || vfxMode === 'stress') {
        const [x, y, z] = scene.camera.target;
        const centre = playerStart(loaded.layout.spawns)?.position ?? { x, y, z };
        vfxDemo = new VfxDemo(vfx, vfxMode, centre);
      }
      // Level deltas (mw-e27.3, mw-e27.4): with everything the scene spawned in place, before the
      // first tick, the level's baseline is taken and any changes stored for it are applied. Saves
      // capture how the level differs from it; dropped items persist with the level.
      if (transit !== undefined && player !== undefined) {
        applyCarriedPlayer(world, player.entity, transit.carry, carryOptions);
        // The class's controller tuning (the kit block above applies it for a chosen class).
        const classId = carriedClassId(transit.carry);
        if (classId !== undefined && isPlayerClass(classId)) {
          const profile = content.get('controller', PLAYER_CONTROLLER_ID);
          commands.push(tuneCommand(player.entity, controllerTuningFor(profile, classId)));
          root.dataset['playerClass'] = classId;
        }
      }
      registerPersistence(world);
      // Creature repopulation (mw-ju8.29): opted-in skeletons killed long enough ago (days pass by
      // resting) stand at their spawns again, so their dead entries leave the stored deltas. Sleeping
      // while this scene is loaded brings them back at once, when out of the player's sight.
      repopulateOnArrival(world, scene.id, loaded.layout.spawns);
      installRepopulationOnRest(world, {
        level: scene.id,
        spawns: loaded.layout.spawns,
        spawnOptions: creatures.spawn,
        sight: sightWorld,
        player: player?.entity,
      });
      levelDeltasOf(world).enter(
        world,
        new WorldPersistence({
          spawners: [worldItemSpawner(worldItems)],
          warn: (message) => {
            console.warn(message);
          },
        }),
        scene.id,
        sceneAuthoredEntities(world, loaded),
      );
      persistDroppedItems(world, () => scene.id);
      // The scene's ways into other scenes (mw-e01.11); answered by `transitions` below.
      if (player !== undefined) installSceneTransitions(world, loaded.layout, player.entity);
      label.textContent = sceneLabel(scene, __BUILD_SHA__);
      root.dataset['scene'] = scene.id;
    } else {
      label.textContent = `No scene · build ${__BUILD_SHA__}`;
      arrival?.dismiss();
      showSceneError(root, request.requested, request.available);
    }
    // Death → reload (mw-e30.7): the player's Died opens the death screen; loading a save or
    // restarting the area reloads the page, which tears the whole world down and builds it again.
    const areaId = request.kind === 'scene' ? request.id : undefined;
    const session = sessionStore();
    // Whether the world moved on since it was last saved or loaded: Quit to Title asks first then.
    const progress = new SaveProgress(() => world.tick);
    // The "not safe to save now" checks (mw-e01.7): they hold back autosaves and disable the pause
    // menu's Save with their reason (mw-e01.3). In m1, a creature in Combat.
    const saveVetoes = { [COMBAT_VETO_ID]: combatVeto(world) };
    const safety = new SafetyVetoes();
    for (const [id, veto] of Object.entries(saveVetoes)) safety.register(id, veto);
    // Items no longer in content are dropped from a loaded save with a warning (mw-e17.8).
    const saveRegistry = createGameSaveRegistry({
      knownItem: (id) => content.has('item', id),
      warn: (message) => {
        console.warn(message);
      },
    });
    const saveBuild = {
      gameVersion: GAME_VERSION,
      buildSha: __BUILD_SHA__,
      contentHash: 'unversioned',
    };
    // Every save names the player's class (mw-e30.14), the one class selection applied.
    const describe = () => describeSave(world, player?.entity, content, areaId ?? '');
    // Leaves for the title screen: the page reloads into the front door (Quit to Title, the slice's
    // completion card, Restart area with no class chosen).
    const leaveForTitle = (): void => {
      const search = titleSearch(location.search);
      location.assign(`${location.pathname}${search === '' ? '' : `?${search}`}`);
    };
    const deathReload = saves.then(
      ({ store }) =>
        new DeathReload({
          ui,
          world,
          store,
          registry: saveRegistry,
          build: saveBuild,
          now: () => Date.now(),
          session,
          areaId,
          // A reload leaves the menus (?menu=) behind and names its scene, so restarting the area
          // from the front door (no ?scene=) restarts the scene rather than showing the title.
          // Restart area names the session's class too (?class=), so the boot is a New Game as that
          // class (mw-e01.16): the same hand-off as the title's, with fresh world facts.
          navigate: (area, classId) => {
            const scene = area ?? areaId;
            location.search = searchWithoutMenu(location.search, {
              ...(scene !== undefined && { scene }),
              ...(classId !== undefined && { class: classId }),
            });
          },
          chosenClass: () => (player === undefined ? undefined : classOf(world, player.entity)),
          toTitle: leaveForTitle,
          describe,
          publish: (readout) => {
            root.dataset[READOUT_ATTRIBUTE[readout.kind]] = JSON.stringify(readout);
            if (readout.kind !== 'death') progress.mark();
            // A death's reload has loaded its save: the player is back in play (mw-e01.8).
            const respawn = pending?.respawn;
            if (readout.kind === 'loaded' && respawn !== undefined && player !== undefined) {
              announceRespawn(world, {
                player: player.entity,
                mode: 'reload',
                rule: respawn.rule,
                slot: readout.slot,
              });
            }
            // The level changes a save holds, and the loaded level's changes after a load
            // (mw-e27.4): the e2e reads them from #app[data-level-deltas].
            if (readout.kind !== 'death') {
              root.dataset['levelDeltas'] = JSON.stringify(levelDeltasOf(world).capture(world));
            }
          },
          warn: (message) => {
            console.warn(message);
          },
        }),
    );
    // The title menu and the Load / Save screens (mw-e30.11): Continue and Load reload into the
    // save's area through the death screen's hand-off; while saves live only in memory every slot
    // screen warns. `?menu=title|load|save` opens one at boot, and a page with no scene, new-game or
    // menu parameter opens the title (the front door, mw-e01.2); the pause menu's Save and Load are
    // mw-e01.3. The e2e reads #app[data-save-menu-*].
    const saveMenus = Promise.all([saves, deathReload]).then(
      ([{ store, warning }, reload]) =>
        new SaveMenus({
          ui,
          world,
          store,
          registry: saveRegistry,
          build: saveBuild,
          now: () => Date.now(),
          describe,
          captureThumbnail,
          warning,
          load: (load) => {
            reload.reload(load);
          },
          // New Game opens class selection over the scene behind the title; a scene with no player
          // to give a class to reloads into a new game instead.
          newGame: () => {
            markFrontDoor('newGameMs');
            if (startNewGame !== undefined) startNewGame();
            else location.search = searchWithoutMenu(location.search, { newgame: '' });
          },
          publish: (readout: SaveMenuReadout) => {
            root.dataset[SAVE_MENU_ATTRIBUTE[readout.kind]] = JSON.stringify(readout);
            if (readout.kind === 'saved') progress.mark();
            if (readout.kind === 'title' && frontDoor.titleMs === undefined) {
              markFrontDoor('titleMs');
            }
          },
          warn: (message) => {
            console.warn(message);
          },
        }),
    );
    // Autosaves (mw-e01.7, mw-e30.5): in a scene with a player, entering a checkpoint volume (the
    // slice's CP-1 and CP-2) and finishing the slice write the autosave ring once it is safe, never
    // while a creature is in Combat. The e2e reads each attempt from #app[data-autosave].
    if (player !== undefined && areaId !== undefined) {
      const checkpoints = isCheckpoint;
      sliceCard = new SliceCompleteController({
        ui,
        world,
        fact: SLICE_COMPLETE_FACT,
        className: () => describe().characterName,
        saveBlocked: () => safety.active()[0]?.reason ?? null,
        returnToTitle: leaveForTitle,
        publish: (state) => {
          root.dataset['sliceComplete'] = state;
        },
      });
      const card = sliceCard;
      let autosave: GameAutosave | undefined;
      void saves.then(({ store }) => {
        autosave = new GameAutosave({
          world,
          slots: new SaveSlots({
            store,
            registry: saveRegistry,
            build: saveBuild,
            now: () => Date.now(),
          }),
          describe: () => ({ ...describe(), captureThumbnail }),
          ...(checkpoints !== undefined && { isCheckpoint: checkpoints }),
          milestones: [SLICE_COMPLETE_FACT],
          vetoes: saveVetoes,
          publish: (event) => {
            root.dataset['autosave'] = JSON.stringify(autosaveReadout(event));
            if (event.type === 'saved') progress.mark();
            card.autosave(event);
          },
          warn: (message) => {
            console.warn(message);
          },
        });
        if (transit !== undefined) {
          autosave.scheduler.request({ kind: 'area-transition', source: transit.to });
        }
      });
      afterStep.push(() => {
        void autosave?.afterStep();
      });
      // Leaving by a transition volume (mw-e01.11): saves the area's changes, carries the player and
      // reloads into the target scene. An arrival autosaves once it is safe (the area-transition
      // trigger of mw-e30.5), so Continue resumes in the new area.
      const hero = player.entity;
      const controller = new TransitionController({
        world,
        player: hero,
        registry: saveRegistry,
        areaName: (id) => content.get('scene', id).name,
        session: transitStore,
        now: () => Date.now(),
        navigate: (search) => {
          location.search = search;
        },
        search: () => location.search,
        overlayParent: root,
        publish: (readout) => {
          root.dataset['transit'] = JSON.stringify(readout);
        },
        warn: (message) => {
          console.warn(message);
        },
      });
      transitions = controller;
      afterStep.push(() => {
        controller.afterStep();
      });
    }
    // The pause menu (mw-e01.3): Esc, P or the pad's Menu while playing. Its Settings, Save and Load
    // open over it (Back returns to it); Save is disabled while a safety veto objects; Quit to Title
    // asks first when there is unsaved progress, then reloads into the front door. The e2e reads
    // #app[data-pause] (open/closed).
    let inPlay = false;
    if (player !== undefined && areaId !== undefined) {
      const hero = player.entity;
      const pause = new PauseController({
        ui,
        canPause: () => inPlay && playerInput.enabled && !isPlayerDead(world, hero),
        saveBlocked: () => safety.active()[0]?.reason ?? null,
        unsavedProgress: () => progress.unsaved,
        pauseKeys: () => sampler.bindings.pause,
        openSettings: () => {
          openOptionsMenu(ui, settings);
        },
        openSave: () => {
          void saveMenus.then((menus) => menus.openSave());
        },
        openLoad: () => {
          void saveMenus.then((menus) => menus.openLoad());
        },
        quitToTitle: leaveForTitle,
        publish: (state) => {
          root.dataset['pause'] = state;
        },
      });
      pauseUi = pause;
      globalThis.window.addEventListener('keydown', (event) => {
        if (pause.keydown(event)) event.preventDefault();
      });
    }
    const openRequestedMenu = (): void => {
      const menu = bootMenuRequest(location.search);
      if (menu.kind === 'unknown')
        console.warn(`?menu=${menu.value}: not a menu (title, load, save)`);
      if (menu.kind !== 'open') return;
      void saveMenus.then((menus) => menus.open(menu.menu));
    };
    // The player's death (mw-e01.8): its Died freezes its input and starts the death beat (the sim
    // counts it in ticks; the content says how long); when the beat ends, the respawn rule for the
    // scene decides what follows, which in m1 is always the death screen. The e2e reads the death
    // from #app[data-player-death] and the respawn after a reload from #app[data-respawned].
    if (player !== undefined && request.kind === 'scene') {
      const rules = content.get('respawn-rules', RESPAWN_RULES_ID);
      installPlayerDeath(world, {
        player: player.entity,
        region: request.id,
        rules: new RespawnRules(respawnRulesFrom(rules)),
        beatSeconds: rules.deathBeatSeconds,
        warn: (message) => {
          console.warn(message);
        },
      });
      const fade = new DeathFade();
      ui.hud.append(fade.element);
      const body = player;
      deathBeat = new DeathBeat({
        world,
        player: body.entity,
        view: {
          pullBack: (fraction) => {
            body.pullBack(fraction);
          },
          fade: (progress) => {
            fade.update(progress);
          },
        },
        onReload: ({ rule }) => {
          void deathReload.then((reload) => reload.playerDied({ rule }));
        },
        publish: (readout) => {
          root.dataset['playerDeath'] = JSON.stringify(readout);
        },
        warn: (message) => {
          console.warn(message);
        },
      });
      world.events.on(playerRespawned, (respawned) => {
        root.dataset['respawned'] = JSON.stringify(respawned);
      });
    }
    const pending: PendingLoad | undefined = takePendingLoad(session);
    // The debug console (mw-e33.1): its own chunk, loaded only in dev builds or with ?debug=1.
    const consoleGate = {
      built: __DEBUG_CONSOLE__,
      dev: import.meta.env.DEV,
      search: location.search,
    };
    const sandboxScene = request.kind === 'scene' && request.id === combat.sandbox.tuning.scene;
    const debugPage =
      __DEBUG_CONSOLE__ && debugConsoleEnabled({ ...consoleGate, sandbox: sandboxScene });
    // `save [slot]` (mw-e30.7): writes the world into a slot and publishes its state hash.
    // The save reads the world when called, so a replay's save (made mid-frame, between two sim ticks of
    // the loop) must not wait a microtask for the death-reload controller: it is kept once it is ready.
    let reloadReady: Awaited<typeof deathReload> | undefined;
    void deathReload.then((reload) => {
      reloadReady = reload;
    });
    const debugSave = (slot: SlotId): void => {
      const failed = (error: unknown): void => {
        console.error(error);
      };
      if (reloadReady !== undefined) reloadReady.debugSave(slot).catch(failed);
      else void deathReload.then((reload) => reload.debugSave(slot)).catch(failed);
    };
    // Input logs (mw-e01.9): a debug page records the inputs and console commands it is given as
    // window.mwInputRecording, and plays a segment set as window.mwInputReplay (by the e2e's init
    // script) back into the same sim ticks, publishing its progress on #app[data-input-replay].
    const inputRecorder = debugPage ? new InputRecorder(() => world.tick) : undefined;
    if (inputRecorder) {
      // Not logged: what the console swallows (its keys, and everything while it is open), which a
      // replay has no console to take.
      inputRecorder.tap(
        sampler,
        (op) =>
          root.dataset['debugConsole'] === 'open' ||
          ('code' in op && (op.code === 'Backquote' || op.code === 'Escape')),
      );
      (window as unknown as { mwInputRecording: () => unknown }).mwInputRecording = () =>
        inputRecorder.segment();
      const replay = (window as unknown as { mwInputReplay?: InputLogSegment }).mwInputReplay;
      const player =
        replay === undefined
          ? undefined
          : new InputPlayer(replay, {
              down: (code) => {
                sampler.down(code);
              },
              up: (code) => {
                sampler.up(code);
              },
              look: (x, y) => {
                sampler.look(x, y);
              },
              releaseAll: () => {
                sampler.releaseAll();
              },
              command: (command) => {
                commands.push(command as GameCommand);
              },
              save: (slot) => {
                if (isSlotId(slot)) debugSave(slot);
              },
            });
      let published = '';
      beforeSample = (tick) => {
        inputRecorder.sampled(tick);
        if (player === undefined) return;
        player.advance(tick);
        const json = JSON.stringify({
          startTick: player.startTick,
          remaining: player.remaining,
          done: player.done,
        });
        if (json !== published) root.dataset['inputReplay'] = published = json;
      };
    }
    if (debugPage) {
      void Promise.all([import('@tools/console/start'), import('@tools/ai-debug/start')]).then(
        ([{ startDebugConsole, unboundDebugSpawns }, { startAiDebug }]) => {
          const bookmarks = new Map(
            (scenes.current?.layout.spawns ?? []).map(
              (spawn) => [spawn.id, spawn.position] as const,
            ),
          );
          const debugConsole = startDebugConsole({
            world,
            submit: (command) => {
              inputRecorder?.record({ op: 'command', command });
              commands.push(command as GameCommand);
            },
            player: (): EntityId | undefined => player?.entity,
            // ctl.get / ctl.set / ctl.dump (mw-e02.3) over the player's live controller tuning.
            controller: content.get('controller', PLAYER_CONTROLLER_ID),
            spawnables: [...spawners.keys()].sort(),
            // Sandbox dummies take options (mw-e04.9: `spawn dummy --poise 60`); props take none.
            // Creatures take a route (mw-e11.21: `spawn fixture-guard --patrol 0,0,12;0,0,20`).
            checkSpawn: (content, options) =>
              combat.spawners.has(content)
                ? checkSandboxSpawn(combat.sandbox, content, options, world.clock.hz)
                : creatures.spawners.has(content)
                  ? checkCreatureSpawn(options)
                  : Object.keys(options).length === 0
                    ? undefined
                    : `${content} takes no options`,
            sandbox: (command) => checkSandboxCommand(combat.sandbox, command, world.clock.hz),
            bookmarks: () => bookmarks,
            // `spawn … at-cursor` (mw-e12.4): where the centre of the view meets the level.
            cursorPoint: () =>
              viewCentrePoint(physics, {
                position: camera.position,
                quaternion: camera.quaternion,
              }),
            scenes: scenes.available(),
            loadScene: (id) => {
              const params = new URLSearchParams(location.search);
              params.set('scene', id);
              location.search = params.toString();
            },
            loop,
            save: (slot) => {
              inputRecorder?.record({ op: 'save', slot });
              debugSave(slot);
            },
            // A UI screen (mw-e00.23): while open it captures input, so the player gets no action
            // frames and pointer lock is released; the sim keeps running.
            dom: { document, keys: globalThis.window, screens: ui },
            storage: globalThis.localStorage,
            onToggle: (open) => {
              root.dataset['debugConsole'] = open ? 'open' : 'closed';
            },
          });
          // ai.debug / ai.freeze / ai.step (mw-e11.17): the overlay reads sim introspection snapshots;
          // a click with the pointer free selects an agent; the probe reads the light under the
          // crosshair. The e2e reads what it drew from #app[data-ai-debug].
          aiDebug = startAiDebug({
            world,
            loop,
            registry: debugConsole.registry,
            scene: view.scene,
            camera,
            root,
            pointerLocked: () => document.pointerLockElement !== null,
            light: light.field,
            cursorPoint: () =>
              viewCentrePoint(physics, {
                position: camera.position,
                quaternion: camera.quaternion,
              }),
            publish: (json) => {
              root.dataset['aiDebug'] = json;
            },
          });
          // Props the console spawned get grey-box objects like the scene's own props: a movable one
          // a body-sized box following its physics pose.
          afterStep.push(() => {
            for (const { entity, placement } of unboundDebugSpawns(world, (id) => sync.has(id))) {
              const size =
                placement.prop !== undefined && world.has(entity, PhysicsObjectComponent)
                  ? props(placement.prop)?.size
                  : undefined;
              sync.bind(
                entity,
                size === undefined
                  ? object3DBinding(greybox.spawn(placement), readSceneTransform)
                  : object3DBinding(greybox.body(placement, size), readPhysicsObjectTransform),
              );
            }
          });
          root.dataset['debugConsole'] = 'closed';
        },
      );
    }
    // Debug attribute (mw-e03.35 AC-4): colliders registered in the physics world.
    root.dataset['colliders'] = String(physics.count());
    // Debug attribute (mw-e03.39): the physics objects the scene spawned.
    root.dataset['physicsObjects'] = String(world.query(PhysicsObjectComponent).ids().length);
    writeCameraData();
    // A save chosen on the death screen (mw-e30.7) reloaded the page into its area; it loads into the
    // freshly built world before the first sim step.
    if (pending === undefined) {
      // The world as booted, before its first step: a Restart area and a New Game as the same class
      // publish the same state hash (mw-e01.16 AC-2, read by the e2e).
      root.dataset['bootState'] = JSON.stringify({ tick: world.tick, hash: hashWorld(world) });
      arrival?.playable();
      loop.start();
      inPlay = true;
      openRequestedMenu();
    } else
      void deathReload
        .then((reload) => reload.resume(pending))
        .finally(() => {
          loop.start();
          inPlay = true;
        });
  };

  const status = document.createElement('p');
  status.setAttribute('role', 'status');
  status.dataset['testid'] = 'physics-status';
  root.append(status);
  // Debug builds (the console built in) add the frozen fixture creatures and the dev-only scenes
  // that place them (mw-e12.4); a release build loads only the game's content and never downloads
  // them.
  const content: Promise<GameContent> = __DEBUG_CONSOLE__
    ? import('@content/dev-content').then(({ loadDevContent }) => loadDevContent())
    : Promise.resolve(loadGameContent());
  void bootPhysics(
    () => import('@dimforge/rapier3d-deterministic'),
    (state) => {
      root.dataset['physics'] = state;
      status.textContent = state === 'loading' ? PHYSICS_LOADING_TEXT : '';
    },
  ).then((boot) => {
    if (!boot.ok) {
      // No physics, no sim (AC-5): say so instead of failing with an uncaught exception.
      status.setAttribute('role', 'alert');
      status.textContent = PHYSICS_FAILED_TEXT;
      console.error(boot.error);
      return;
    }
    root.dataset['physicsVersion'] = boot.module.version();
    status.remove();
    return content.then((loaded) => {
      startWorld(boot.physics, loaded);
    });
  });
}

// Session storage for the death → reload hand-off (mw-e30.7); a browser that blocks it gets a
// stand-in for this page only, so the death screen still works (a load then starts the area afresh).
function sessionStore(): PendingLoadStorage {
  try {
    const storage = globalThis.sessionStorage;
    storage.getItem('');
    return storage;
  } catch {
    const items = new Map<string, string>();
    return {
      getItem: (key) => items.get(key) ?? null,
      setItem: (key, value) => {
        items.set(key, value);
      },
      removeItem: (key) => {
        items.delete(key);
      },
    };
  }
}

// ?scene= named a scene that does not exist (mw-e00.21 AC-4): say so and link the real ones. The
// renderer keeps running on an empty world.
function showSceneError(root: HTMLElement, requested: string, available: readonly string[]): void {
  const message = sceneErrorMessage(requested, available);
  const panel = document.createElement('section');
  panel.setAttribute('role', 'alert');
  panel.dataset['testid'] = 'scene-error';
  const heading = document.createElement('h2');
  heading.textContent = message.heading;
  const body = document.createElement('p');
  body.textContent = message.body;
  const list = document.createElement('ul');
  for (const scene of message.scenes) {
    const item = document.createElement('li');
    const link = document.createElement('a');
    link.href = scene.href;
    link.textContent = scene.id;
    item.append(link);
    list.append(item);
  }
  panel.append(heading, body, list);
  root.dataset['sceneError'] = requested;
  root.append(panel);
}

function showUnsupported(root: HTMLElement, missing: readonly MissingFeature[]): void {
  const message = unsupportedMessage(missing);
  const screen = document.createElement('section');
  screen.setAttribute('role', 'alert');
  screen.dataset['testid'] = 'unsupported-browser';
  const heading = document.createElement('h2');
  heading.textContent = message.heading;
  const body = document.createElement('p');
  body.textContent = message.body;
  const details = document.createElement('ul');
  for (const line of message.details) {
    const item = document.createElement('li');
    item.textContent = line;
    details.append(item);
  }
  screen.append(heading, body, details);
  root.dataset['boot'] = 'unsupported';
  root.append(screen);
}
