// Public API of save slots (mw-e30.4): the slot model (10 manual, 3 autosave, 1 quicksave), slot
// metadata and thumbnails, and the SaveSlots manager the save/load UI, autosave and quicksave use.

export {
  ALL_SLOTS,
  AUTOSAVE_RING_SIZE,
  AUTOSAVE_SLOTS,
  isSlotId,
  MANUAL_SLOT_COUNT,
  MANUAL_SLOTS,
  QUICKSAVE_SLOT,
  slotKind,
  type SlotId,
  type SlotKind,
} from './ids';
export {
  SaveSlots,
  type CapturedSlotSave,
  type DeleteSlotOutcome,
  type LoadSlotResult,
  type ReadySlotSummary,
  type SavedSlotOutcome,
  type RenameSlotOutcome,
  type SaveSlotInput,
  type SaveSlotOutcome,
  type SaveSlotsOptions,
  type SlotSummary,
  type ThumbnailOutcome,
  type UnreadableSlotError,
} from './manager';
export {
  normalizeSlotLabel,
  readSlotDetails,
  SLOT_LABEL_MAX_LENGTH,
  type SlotDescription,
  type SlotDetails,
  type StoredSlotMetadata,
} from './metadata';
export {
  checkThumbnail,
  loadThumbnail,
  storeThumbnail,
  THUMBNAIL_HEIGHT,
  THUMBNAIL_MAX_BYTES,
  THUMBNAIL_MIME_TYPES,
  THUMBNAIL_WIDTH,
  type SlotThumbnail,
  type StoredThumbnail,
  type ThumbnailCapture,
  type ThumbnailMimeType,
} from './thumbnail';
