// Validation of the logic DSL inside a contest (mw-e40.5). The content schema
// (src/content/types/contest.ts) checks one file's structure; the conditions and effects it holds
// are the shared logic DSL, which lives here in the sim, so this module validates them: kinds,
// fields and, with a reference checker, the content ids they name (items, facts, NPCs...).
// Issues carry JSON pointers into the contest file.

import type { ContestEntry as ContestDef } from '../../content/types/contest';
import {
  validateLogicCondition,
  validateLogicEffects,
  type LogicIssue,
  type LogicRefChecker,
} from '../logic';

export interface ContestLogicIssue {
  /** RFC 6901 pointer into the contest file. */
  readonly pointer: string;
  readonly message: string;
}

/** `of[1].condition` or `[0].x` -> `/of/1/condition` or `/0/x`. */
function pointerOf(path: string): string {
  return [...path.matchAll(/\[(\d+)\]|([^.[\]]+)/g)].map((m) => `/${m[1] ?? m[0]}`).join('');
}

/** Every problem with the conditions, effects and references of `contest`. */
export function validateContestLogic(
  contest: ContestDef,
  references?: LogicRefChecker,
): ContestLogicIssue[] {
  const issues: ContestLogicIssue[] = [];
  const add = (base: string, found: readonly LogicIssue[]): void => {
    for (const { path, message } of found)
      issues.push({ pointer: base + pointerOf(path), message });
  };
  const condition = (base: string, data: unknown): void => {
    if (data === undefined) return;
    const result = validateLogicCondition(data, { references });
    if (!result.ok) add(base, result.issues);
  };
  const effects = (base: string, data: unknown): void => {
    if (data === undefined) return;
    const result = validateLogicEffects(data, { references });
    if (!result.ok) add(base, result.issues);
  };

  condition('/entry/when', contest.entry.when);
  effects('/entry/effects', contest.entry.effects);
  effects('/win/effects', contest.win.effects);
  effects('/lose/effects', contest.lose.effects);
  effects('/disqualified/effects', contest.disqualified?.effects);
  contest.cheats.forEach((cheat, i) => {
    const at = `/cheats/${String(i)}`;
    condition(`${at}/when`, cheat.when);
    effects(`${at}/detected/effects`, cheat.detected.effects);
    effects(`${at}/undetected/effects`, cheat.undetected.effects);
  });
  effects('/betting/throwMatch/payout', contest.betting?.throwMatch?.payout);
  effects('/betting/throwMatch/grudge', contest.betting?.throwMatch?.grudge);
  return issues;
}
