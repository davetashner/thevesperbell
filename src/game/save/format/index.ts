// Public API of the versioned save format (mw-e30.1): envelope + byte layout, section registry,
// per-section migrations and typed load errors. Storage (mw-e30.2) and slots (mw-e30.4) build on it.

export { CanonicalDecodeError, decodeCanonical } from './codec';
export {
  decodeSave,
  encodeSave,
  SAVE_FORMAT_VERSION,
  SAVE_SCHEMA_VERSION,
  type BuildInfo,
  type DecodeSaveResult,
  type SaveBody,
  type SaveEnvelope,
} from './envelope';
export {
  MissingMigrationError,
  SaveApplyError,
  SaveCorruptError,
  SaveFromNewerBuildError,
  SaveMigrationError,
  SaveSectionInvalidError,
  type NewerBuildPart,
  type SaveLoadError,
} from './errors';
export {
  SaveRegistry,
  WORLD_SECTION_ID,
  WORLD_SECTION_VERSION,
  type CheckSaveResult,
  type LoadSaveResult,
  type SaveRegistryOptions,
  type SaveWarning,
  type CapturedSave,
  type WriteSaveOptions,
} from './registry';
export {
  defineSaveSection,
  migrateSection,
  validateSection,
  type SaveSection,
  type SectionLoadContext,
  type SectionMigration,
  type SectionRecord,
  type SectionResult,
} from './section';
