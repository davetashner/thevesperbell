// Creature audio slots (mw-e28.8): which sound a creature makes for each moment of its life, as
// data in a localised `audio` block of the creature file. The cue sheets (`creature` sheet, the
// combat sheet's telegraph rule) read the slots through the creature the event is about, so no
// code names a creature sound. Every slot is a sound manifest cue id; placeholder ids are fine
// (the audio engine skips a cue the manifest lacks) until the SFX asset groups deliver the sounds.
// The slots are optional here so the load-time check (creature-audio-checks.ts) can name exactly
// which creature is missing which one.

import { z } from 'zod';

/** The slots every creature declares, in the order they are listed in the field reference. */
export const CREATURE_AUDIO_SLOTS = [
  'idleLoop',
  'footsteps',
  'alertBark',
  'telegraph',
  'hurt',
  'poiseBreak',
  'death',
] as const;

/** A required creature audio slot name. */
export type CreatureAudioSlot = (typeof CREATURE_AUDIO_SLOTS)[number];

/** A creature sound cue id: an `sfx-`/`amb-` manifest id, e.g. "sfx-forgotten-hurt". */
export const CREATURE_CUE_PATTERN = /^(?:sfx|amb)(?:-[a-z0-9]+)+$/;

const cue = z
  .string()
  .regex(CREATURE_CUE_PATTERN, 'must be a sound cue id such as "sfx-forgotten-hurt"');

/** The `audio` block of a creature file. */
export const creatureAudioSchema = z
  .strictObject({
    idleLoop: cue
      .optional()
      .describe('Looping ambient sound that follows the creature while it lives (stops on death).'),
    footsteps: cue
      .optional()
      .describe('Footstep set layered over the ground surface’s own step sound.'),
    alertBark: cue
      .optional()
      .describe('Bark played where the creature stands when it becomes Alerted or enters Combat.'),
    telegraph: cue
      .optional()
      .describe(
        'Attack telegraph played on TelegraphStarted when the move declares no telegraph cue of its own.',
      ),
    unblockableTelegraph: cue
      .optional()
      .describe(
        'Distinct, high-priority telegraph for unblockable moves and grabs; required when the creature has one, and different from `telegraph`.',
      ),
    hurt: cue.optional().describe('Played where a clean hit that did not kill it lands.'),
    poiseBreak: cue.optional().describe('Played when its poise breaks and it staggers.'),
    death: cue.optional().describe('Played where it dies; its idle loop stops at the same time.'),
  })
  .describe(
    'Audio slots (mw-e28.8): every creature declares idleLoop, footsteps, alertBark, telegraph, hurt, poiseBreak and death (placeholder ids allowed).',
  );

/** A creature's audio slots as written or loaded. */
export type CreatureAudio = z.output<typeof creatureAudioSchema>;
