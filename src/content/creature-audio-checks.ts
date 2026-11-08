// Load-time checks of creature audio (mw-e28.8), after every file has parsed:
//
// - every creature declares an `audio` block with every required slot (idle loop, footsteps, alert
//   bark, telegraph, hurt, poise break, death); placeholder cue ids are fine;
// - a creature with an unblockable move or a grab also declares `audio.unblockableTelegraph`, a cue
//   distinct from its ordinary `telegraph`, so the player hears "this one cannot be blocked";
// - every move of a creature's attacks winds up at least CREATURE_AUDIO_MIN_LEAD_TICKS (15 ticks,
//   250 ms) from its telegraph to its first active tick: the telegraph cue plays on TelegraphStarted,
//   so a shorter lead leaves no time to hear it and react (the stricter windup rules of
//   attack-checks.ts imply this; it is checked on its own so the audio rule cannot be loosened by
//   accident).
//
// Issues name the creature file; a missing attack or move is the loader's reference error.

import type { ContentCheck, ContentIssue } from './loader.ts';
import type { AttackDef } from './types/attack.ts';
import type { CreatureDef } from './types/creature.ts';
import { CREATURE_AUDIO_SLOTS } from './types/creature-audio.ts';
import type { MoveDef } from './types/move.ts';

/** Fewest ticks between a move's telegraph and its first active tick: 250 ms at 60 Hz. */
export const CREATURE_AUDIO_MIN_LEAD_TICKS = 15;

/** The moves an attack performs (its move, then each `chainNext`), skipping unknown ones. */
function chainOf(attack: AttackDef, moves: ReadonlyMap<string, MoveDef>): MoveDef[] {
  const chain: MoveDef[] = [];
  for (let move = moves.get(attack.move.id); move !== undefined && !chain.includes(move);) {
    chain.push(move);
    move = move.chainNext === undefined ? undefined : moves.get(move.chainNext.id);
  }
  return chain;
}

/** The check: audio slots, the unblockable telegraph and the telegraph lead (see the file header). */
export const checkCreatureAudio: ContentCheck = (entries) => {
  const moves = new Map<string, MoveDef>();
  const attacks = new Map<string, AttackDef>();
  for (const { type, value } of entries) {
    if (type === 'move') moves.set(value.id, value as MoveDef);
    else if (type === 'attack') attacks.set(value.id, value as AttackDef);
  }
  const issues: ContentIssue[] = [];
  for (const { type, file, value } of entries) {
    if (type !== 'creature') continue;
    const creature = value as CreatureDef;
    const report = (pointer: string, message: string) =>
      issues.push({ file, pointer, message: `creature "${creature.id}": ${message}` });
    const { audio } = creature;
    if (audio === undefined) {
      report('/audio', `no audio block; declare ${CREATURE_AUDIO_SLOTS.join(', ')}`);
    } else {
      for (const slot of CREATURE_AUDIO_SLOTS) {
        if (audio[slot] === undefined) report(`/audio/${slot}`, `audio slot "${slot}" is missing`);
      }
    }
    let unblockable = false;
    for (const [index, ref] of creature.attacks.entries()) {
      const attack = attacks.get(ref.id);
      if (attack === undefined) continue;
      for (const move of chainOf(attack, moves)) {
        if (attack.kind === 'grab' || move.flags.unblockable) unblockable = true;
        const lead = move.frames.startup - move.telegraphTick;
        if (lead < CREATURE_AUDIO_MIN_LEAD_TICKS) {
          report(
            `/attacks/${String(index)}`,
            `attack "${attack.id}" move "${move.id}" telegraphs ${String(lead)} ticks before its ` +
              `first active tick; the telegraph cue needs at least ` +
              `${String(CREATURE_AUDIO_MIN_LEAD_TICKS)} (250 ms)`,
          );
        }
      }
    }
    if (unblockable && audio !== undefined) {
      if (audio.unblockableTelegraph === undefined) {
        report(
          '/audio/unblockableTelegraph',
          'has an unblockable move or grab, so it must declare audio.unblockableTelegraph',
        );
      } else if (audio.unblockableTelegraph === audio.telegraph) {
        report(
          '/audio/unblockableTelegraph',
          `unblockableTelegraph "${audio.unblockableTelegraph}" must differ from its ordinary telegraph`,
        );
      }
    }
  }
  return issues;
};
