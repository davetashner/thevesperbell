// The player's kinematic character controller (mw-e02.2), the collision interface it runs on, the
// locomotion state and events it publishes (mw-e02.6) and its movement profiles for stealth
// (mw-e02.10).
// Not exported here, by design: collision-world.contract.ts (Vitest only).
export type { BodyId, Capsule, CollisionHit, CollisionWorld } from './collision-world';
export {
  capsuleOf,
  controllerParams,
  DEFAULT_LAUNCH_TUNING,
  DEFAULT_STEALTH_TUNING,
  IDLE_INPUT,
  initialCharacterState,
  MIN_STRAFE_RADIUS,
  movementState,
  SKIN,
  stepCharacter,
  stepCharacterWithImpacts,
  type ButtonState,
  type CharacterImpact,
  type CharacterInput,
  type CharacterState,
  type CharacterStep,
  type ControllerContext,
  type ControllerParams,
  type ImpulsePart,
  type LaunchState,
  type MovementActions,
  type MovementState,
  type PendingImpulses,
} from './controller';
export {
  CharacterEncumbrance,
  movementGait,
  movementProfile,
  movementProfileOf,
  type Encumbrance,
  type MovementProfile,
} from './profile';
export { FakeCollisionWorld } from './fake-collision-world';
export {
  box,
  radians,
  rampAngle,
  rampAt,
  type GreyboxBox,
  type GreyboxShape,
  type RampRise,
  type GreyboxRamp,
} from './greybox';
export { NOCLIP_BOOST, stepNoclip } from './noclip';
export {
  applyCharacterImpulse,
  impelCharacter,
  installCharacterImpulses,
  type CharacterImpulse,
} from './impulse';
export {
  characterCentre,
  characterPlacementSystem,
  installCharacterStimuli,
  makePushable,
} from './stimuli';
export {
  CharacterController,
  CharacterImpacted,
  CharacterTuning,
  characterControllerSystem,
  characterTuning,
  spawnCharacter,
  type CharacterImpactInfo,
  type CharacterSystemOptions,
} from './system';
export {
  TRAVERSAL_MODES,
  type TraversalContext,
  type TraversalHook,
  type TraversalMode,
} from './traversal';
export {
  CharacterLocomotion,
  classifyLocomotion,
  DEFAULT_GAIT_TUNING,
  giveLocomotion,
  impactSpeed,
  initialLocomotion,
  LOCOMOTION_STATES,
  LocomotionEvents,
  locomotionOf,
  locomotionSystem,
  stepLocomotion,
  type Foot,
  type FootstepGait,
  type Locomotion,
  type LocomotionContext,
  type LocomotionEvent,
  type LocomotionEventKind,
  type LocomotionInputs,
  type LocomotionSnapshot,
  type LocomotionState,
  type LocomotionSystemOptions,
  type LocomotionTick,
} from './locomotion';
export {
  breathFraction,
  CharacterBreath,
  DEFAULT_WATER_TUNING,
  Drowning,
  giveBreath,
  horizontalSpeed,
  Sinking,
  WATER_MATERIAL,
  WATER_TAG,
  waterAt,
  waterDepthAt,
  WaterEntered,
  WaterExited,
  waterMode,
  waterSystem,
  waterTraversal,
  waterVolumes,
  type Breath,
  type WaterEvent,
  type WaterHookOptions,
  type WaterMode,
  type WaterSystemOptions,
  type WaterVolume,
} from './water';
export {
  DEFAULT_FOOTSTEP_SURFACES,
  footSurface,
  footstepLoudness,
  groundUnder,
  type FootSurface,
  type GroundReading,
  type SurfaceOffsets,
} from './footsteps';
