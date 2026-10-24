// The deterministic game rules (backlog contract §2). No DOM, renderer, wall clock or Math.random.
export const layer = 'sim' as const;

export * from './ai';
export * from './breakables';
export * from './character';
export * from './climb';
export * from './combat';
export * from './creatures';
export { DEFAULT_TICK_RATE_HZ, SimClock, type ClockState, type ReadonlyClock } from './clock';
export {
  defineComponent,
  type ComponentOptions,
  type ComponentType,
  type EntityId,
} from './core/component';
export {
  DEFAULT_MAX_EVENTS_PER_FLUSH,
  defineEvent,
  EventBus,
  EventCycleError,
  type EventHandler,
  type EventType,
} from './core/events';
export { Query, type ComponentList, type ComponentValues } from './core/query';
export {
  applyDifficultyCommands,
  DEFAULT_DIFFICULTY,
  DIFFICULTY_COMMAND,
  DIFFICULTY_KEYS,
  DIFFICULTY_RANGES,
  DifficultyChanged,
  difficultyCommand,
  DifficultyConfigError,
  difficultyOverrides,
  isDifficultyCommand,
  resolveDifficulty,
  type DifficultyChange,
  type DifficultyCommand,
  type DifficultyConfig,
  type DifficultyKey,
  type DifficultyOverrides,
  type DifficultyRange,
} from './difficulty';
export {
  World,
  type InputFilter,
  type SnapshotOptions,
  type System,
  type TickContext,
  type WorldOptions,
  type WorldSnapshot,
} from './core/world';
export * from './debug';
export * from './deltas';
export * from './economy';
export * from './elements';
export * from './factions';
export * from './facts';
export * from './field';
export * from './geom';
export * from './input';
export * from './interaction';
export * from './light';
export * from './loot';
export * from './magic';
export * from './mechanisms';
export * from './nav';
export * as simMath from './math';
export * from './noise';
export * from './perception';
export * from './physics';
export * from './player';
export * from './inventory';
export * from './items';
export * from './progression';
export * from './properties';
export * from './respawn';
export * from './gametime';
export * from './rest';
export * from './scene';
export * from './sight';
export * from './stealth';
export * from './stimulus';
export * from './targeting';
export * from './testing';
export * from './signals';
export { EmptyChoiceError, Rng, type RngState, type Weighted } from './rng';
export {
  CanonicalEncodingError,
  diffSnapshots,
  encodeCanonical,
  encodeSnapshot,
  hashSnapshot,
  hashWorld,
  SNAPSHOT_ENCODING_VERSION,
  xxHash32,
  type SnapshotDifference,
} from './snapshot';
export {
  DEFAULT_CHECKPOINT_INTERVAL,
  InvalidReplayError,
  parseReplay,
  REPLAY_FORMAT_VERSION,
  serializeReplay,
  UnsupportedReplayVersionError,
  type InputRun,
  type JsonValue,
  type Replay,
  type ReplayCheckpoint,
} from './replay/format';
export {
  describeOutcome,
  playReplay,
  reblessReplay,
  ReplayError,
  type Divergence,
  type PlayOptions,
  type ReblessOptions,
  type ReplayOutcome,
} from './replay/player';
export {
  recordScenario,
  ReplayRecordError,
  ReplayRecorder,
  type RecorderOptions,
  type RecordScenarioOptions,
} from './replay/recorder';
export type { DriveContext, ReplayScenario } from './replay/scenario';
export { replayScenarios } from './replay/scenarios';
export {
  coreCommand,
  coreComponents,
  coreScenario,
  type CoreCommand,
} from './replay/scenarios/core';
