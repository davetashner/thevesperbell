// Deterministic persuasion checks (mw-e22.7): decides a dialogue `check` node with no dice. The
// score is the sum of listed parts:
//
//   base + NPC disposition band + global modifiers (class, capability, item, fact) that apply to the
//   approach + the node's own modifiers + the NPC's personality modifiers
//
// and the check succeeds when score >= the node's difficulty. The same state always gives the same
// answer (evaluating reads the world, never changes it), so a reload cannot reroll a failure; the
// bead's decision, to be revisited in playtest. The numbers are content (`persuasion`, see
// src/content/types/persuasion.ts), passed in as `PersuasionRules`. The margin (score minus
// difficulty) maps to the label the UI shows before the player commits: easy, fair, hard or
// impossible. `createPersuasion` gives the runtime its resolver (`DialogueOptions.checks`) and its
// previewer (`DialogueOptions.preview`) from one function, so what the UI shows is what resolves.
//
// A conversation partner's personality is not in the logic context, so the game supplies a lookup
// (`personality`: NPC id to trait values 0..1, from its creature definition); without one, personality
// modifiers do not apply.

import type { DialogueApproach } from '../../content/types/dialogue';
import { npcBand, type NpcBand } from '../disposition/bands';
import {
  evaluateLogic,
  validateLogicCondition,
  type LogicNode,
  type LogicRefChecker,
} from '../logic';
import { dialogueLogicRegistry } from '../logic/dialogue-kinds';
import { pointerOf, type DialogueLogicIssue } from './validate';
import type {
  CheckBreakdown,
  CheckOutcome,
  CheckRequest,
  CheckResolver,
  DifficultyLabel,
  ScoreModifier,
} from './runtime';

/** A modifier from the persuasion table that applies to every check (to some approaches). */
export interface PersuasionModifierRule {
  readonly approaches?: readonly DialogueApproach[] | undefined;
  readonly when: LogicNode;
  readonly bonus: number;
  readonly label: string;
}

/** A modifier from the NPC's personality. */
export interface PersuasionPersonalityRule {
  readonly approaches?: readonly DialogueApproach[] | undefined;
  readonly trait: string;
  readonly atLeast?: number | undefined;
  readonly atMost?: number | undefined;
  readonly bonus: number;
  readonly label: string;
}

/** The persuasion table (content `persuasion`), as the sim reads it. */
export interface PersuasionRules {
  readonly base: number;
  readonly bandModifiers: Readonly<Record<NpcBand, number>>;
  readonly labels: {
    readonly easyFrom: number;
    readonly fairFrom: number;
    readonly hardFrom: number;
  };
  readonly modifiers: readonly PersuasionModifierRule[];
  readonly personality: readonly PersuasionPersonalityRule[];
}

/** Trait values (0..1) of an NPC, by trait name. */
export type Personality = Readonly<Partial<Record<string, number>>>;

/** Looks up an NPC's personality; undefined when unknown. */
export type PersonalityLookup = (npc: string) => Personality | undefined;

/** The label for `margin` (score minus difficulty) under `rules`. */
export function difficultyLabel(
  margin: number,
  labels: PersuasionRules['labels'],
): DifficultyLabel {
  if (margin >= labels.easyFrom) return 'easy';
  if (margin >= labels.fairFrom) return 'fair';
  if (margin >= labels.hardFrom) return 'hard';
  return 'impossible';
}

const applies = (approaches: readonly DialogueApproach[] | undefined, approach: DialogueApproach) =>
  approaches === undefined || approaches.includes(approach);

/** Works out `request`'s check under `rules`: score, margin, label, outcome and every part. */
export function evaluateCheck(
  request: CheckRequest,
  rules: PersuasionRules,
  personality?: PersonalityLookup,
): CheckBreakdown {
  const { node, context, target } = request;
  const registry = dialogueLogicRegistry();
  const band = npcBand(context.disposition(target));
  const modifiers: ScoreModifier[] = [
    { source: 'base', label: 'base', value: rules.base },
    { source: 'disposition', label: band, value: rules.bandModifiers[band] },
  ];
  for (const rule of rules.modifiers) {
    if (applies(rule.approaches, node.approach) && evaluateLogic(rule.when, context, registry)) {
      modifiers.push({ source: 'rule', label: rule.label, value: rule.bonus });
    }
  }
  for (const modifier of node.modifiers) {
    if (evaluateLogic(modifier.when, context, registry)) {
      modifiers.push({ source: 'node', label: modifier.label, value: modifier.bonus });
    }
  }
  const traits = personality?.(target);
  for (const rule of rules.personality) {
    const value = traits?.[rule.trait];
    if (
      value !== undefined &&
      applies(rule.approaches, node.approach) &&
      (rule.atLeast === undefined || value >= rule.atLeast) &&
      (rule.atMost === undefined || value <= rule.atMost)
    ) {
      modifiers.push({ source: 'personality', label: rule.label, value: rule.bonus });
    }
  }
  const score = modifiers.reduce((sum, part) => sum + part.value, 0);
  const margin = score - node.difficulty;
  return {
    approach: node.approach,
    difficulty: node.difficulty,
    target,
    score,
    margin,
    label: difficultyLabel(margin, rules.labels),
    success: margin >= 0,
    modifiers,
  };
}

export interface PersuasionOptions {
  readonly rules: PersuasionRules;
  readonly personality?: PersonalityLookup;
}

/** The runtime's resolver and previewer, from one rule table. */
export function createPersuasion(options: PersuasionOptions): {
  readonly resolve: CheckResolver;
  readonly preview: (request: CheckRequest) => CheckBreakdown;
} {
  const preview = (request: CheckRequest) =>
    evaluateCheck(request, options.rules, options.personality);
  return {
    preview,
    resolve: (request): CheckOutcome => {
      const breakdown = preview(request);
      return { success: breakdown.success, breakdown };
    },
  };
}

/** Every logic problem in the conditions of `rules` (kinds, fields, and references when given). */
export function validatePersuasionRules(
  rules: Pick<PersuasionRules, 'modifiers'>,
  references?: LogicRefChecker,
): DialogueLogicIssue[] {
  const registry = dialogueLogicRegistry();
  return rules.modifiers.flatMap((rule, i) => {
    const result = validateLogicCondition(rule.when, { registry, references });
    return result.ok
      ? []
      : result.issues.map(({ path, message }) => ({
          pointer: `/modifiers/${String(i)}/when${pointerOf(path)}`,
          message,
        }));
  });
}
