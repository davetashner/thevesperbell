// Quests as data (mw-e23.1): `src/content/data/quest/<id>.json`, one quest per file. A quest is a
// problem the world hands the player and the ways it can end. `objectives` are the things the quest
// tracks (each bound to a kind of world event, see `QUEST_OBJECTIVE_KINDS`); `resolutions` are the
// ways it can be solved, each with the approach it stands for (fight, sneak, talk, cast, trick) and
// a condition: the first to hold wins, so a problem supports several solutions; `failures` are the
// ways it can go wrong, and every failure must continue the story (a successor quest, another
// stage, or a bittersweet resolution) so failing is a story and not a dead end (constitution §2).
// `stages` optionally sequence a long quest (a stage's `transitions` move it on by condition, for
// quests that branch); `startWhen` starts a quest by condition, and a quest
// without one is started by an effect (a dialogue option, another quest's `startQuest`).
//
// Conditions (`startWhen`, `activeWhen`, `when`) and effects are the shared logic DSL
// (docs/design/logic-dsl.md, src/sim/logic). This schema checks everything one file can say about
// itself structurally: ids are unique, every stage, resolution and objective reference names a
// member of the file, a failure can fire and continues, and every text key is unique. The DSL's own
// kinds and references (items, NPCs, facts, dialogues, areas) are validated by
// src/sim/quest/validate.ts (content may not import the sim at runtime); resolvability and cycles
// are the quest validator (mw-e23.5). Text is inline for the MVP; every text has a stable key for
// localization (`questTextKey`). The format guide is docs/design/quest-format.md and the field
// reference docs/content/quest-schema.md is generated (`pnpm content:docs`).

import { z } from 'zod';
import { contentId, ref } from '../schema.ts';

/** Stage, objective, resolution and failure ids: lowercase kebab-case, stable forever (saves). */
export const QUEST_LOCAL_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** What a resolution stands for; the validator wants a non-combat one (mw-e23.5). */
export const QUEST_APPROACHES = [
  'combat',
  'stealth',
  'diplomacy',
  'magic',
  'trickery',
  'other',
] as const;
export type QuestApproach = (typeof QUEST_APPROACHES)[number];

/**
 * The objective kinds, in the order the docs list them (mw-e23.3 binds each to sim events).
 * Adding a kind = one entry in `OBJECTIVE_SCHEMAS` below, and its event binding in the sim.
 */
export const QUEST_OBJECTIVE_KINDS = [
  'haveItem',
  'deliverItem',
  'fact',
  'entityState',
  'enterArea',
  'talkTo',
  'dialogueNode',
  'learnCapability',
  'event',
] as const;
export type QuestObjectiveKind = (typeof QUEST_OBJECTIVE_KINDS)[number];

/**
 * Entity states an `entityState` objective waits for. `removed` is outcome-agnostic (killed,
 * befriended into leaving, fled for good, subdued...): prefer it so non-combat solutions count.
 */
export const QUEST_ENTITY_STATES = ['dead', 'befriended', 'fled', 'subdued', 'removed'] as const;
export type QuestEntityState = (typeof QUEST_ENTITY_STATES)[number];

/** The parts of a quest that have text, for `questTextKey`. */
export type QuestTextPart = 'title' | 'summary' | 'stage' | 'objective' | 'resolution' | 'failure';

const localId = z
  .string()
  .regex(QUEST_LOCAL_ID_PATTERN, 'must be lowercase kebab-case, e.g. "tell-the-town"');
const stageRef = localId.describe('Id of a stage of this quest.');
const text = z
  .string()
  .min(1)
  .refine((value) => value === value.trim(), 'must not start or end with whitespace');
const textKey = z
  .string()
  .regex(/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/, 'must be a dotted lowercase key')
  .optional()
  .describe('Localization key for the text. Default: `quest.<quest id>.<part>[.<id>]`.');
const note = z.string().min(1).optional().describe('A note for writers; never shown to players.');

/**
 * A condition or effect of the logic DSL (src/sim/logic). Only its shape is checked here: an object
 * with a `kind`. Kinds, fields and references are validated by src/sim/quest/validate.ts.
 */
const logicNode = z
  .looseObject({ kind: z.string().min(1).describe('The logic kind, e.g. "hasItem".') })
  .describe('A logic DSL node: an object with a `kind` and that kind’s fields.');
const effects = z
  .array(logicNode)
  .min(1)
  .describe('Effects (logic DSL) applied together: all or nothing.');
const count = z.int().min(1).default(1).describe('How many.');
const scalar = z.union([z.boolean(), z.int(), contentId]);

// ---------------------------------------------------------------------------------------------
// Objectives

const objectiveBase = {
  id: localId.describe('Id of the objective, unique in the quest; other logic names it.'),
  text: text.describe('The journal line, e.g. "Find out who has been taking the books."'),
  textKey,
  optional: z.boolean().default(false).describe('Not needed to resolve; a bonus or a side thread.'),
  hidden: z.boolean().default(false).describe('Not shown until complete (a surprise).'),
  activeWhen: logicNode
    .optional()
    .describe('Condition (logic DSL) from which the objective is active. Omit: with its stage.'),
  stage: stageRef.optional().describe('Active only in this stage. Omit: in every stage.'),
  note,
};

const objective = <K extends QuestObjectiveKind, P extends z.ZodType>(
  kind: K,
  description: string,
  params: P,
) =>
  z.strictObject({
    ...objectiveBase,
    kind: z.literal(kind).describe(description),
    params,
  });

const OBJECTIVE_SCHEMAS = [
  objective(
    'haveItem',
    'The player holds the item. Completes while held and reverts when it is lost, unless `latch`.',
    z.strictObject({
      item: ref('item'),
      count,
      latch: z
        .boolean()
        .default(false)
        .describe('Stay complete once reached, even if the item is later dropped or spent.'),
    }),
  ),
  objective(
    'deliverItem',
    'The player hands the item to an NPC.',
    z.strictObject({ item: ref('item'), npc: ref('creature'), count }),
  ),
  objective(
    'fact',
    'A world fact has a value.',
    z.strictObject({
      fact: z.string().min(1).describe('Key of a registered world fact.'),
      value: scalar.default(true).describe('The value to wait for. Default: true.'),
    }),
  ),
  objective(
    'entityState',
    'A creature reaches a state. Prefer `removed` so non-combat solutions count.',
    z.strictObject({
      creature: ref('creature'),
      state: z.enum(QUEST_ENTITY_STATES).describe('The state to wait for.'),
    }),
  ),
  objective(
    'enterArea',
    'The player enters an area (a trigger volume).',
    z.strictObject({ area: localId.describe('Id of the area.') }),
  ),
  objective('talkTo', 'The player talks to an NPC.', z.strictObject({ npc: ref('creature') })),
  objective(
    'dialogueNode',
    'The player reaches a node of a dialogue.',
    z.strictObject({
      dialogue: localId.describe('Id of the dialogue.'),
      node: localId.describe('Id of the node.'),
    }),
  ),
  objective(
    'learnCapability',
    'The player learns a capability.',
    z.strictObject({ capability: localId.describe('Id of the capability.') }),
  ),
  objective(
    'event',
    'A named event is emitted (by an `emit` effect or a system).',
    z.strictObject({ event: localId.describe('Name of the event.') }),
  ),
] as const;

const objectiveSchema = z.discriminatedUnion('kind', OBJECTIVE_SCHEMAS, {
  // Only an unknown (or missing) `kind` reaches here: other problems are reported by the option.
  error: (issue) =>
    `unknown objective kind ${JSON.stringify((issue.input as { kind?: unknown } | null)?.kind)}; expected one of ${QUEST_OBJECTIVE_KINDS.join(', ')}`,
});

// ---------------------------------------------------------------------------------------------
// Stages, resolutions, failures

const transitionSchema = z.strictObject({
  when: logicNode.describe(
    'Condition (logic DSL) that moves the quest on. The first to hold, in file order, wins.',
  ),
  stage: stageRef.describe('The stage the quest moves to.'),
  effects: effects
    .optional()
    .describe('Effects applied in the same atomic batch as the move (e.g. set a fact).'),
  note,
});

const stageSchema = z.strictObject({
  id: localId.describe('Id of the stage, unique in the quest.'),
  text: text.optional().describe('Journal text while the quest is in this stage.'),
  textKey,
  transitions: z
    .array(transitionSchema)
    .default([])
    .describe(
      'Moves out of this stage, evaluated while it is current (branching quests: the first condition that holds picks the next stage).',
    ),
  note,
});

const resolutionSchema = z.strictObject({
  id: localId.describe('Id of the resolution; written to the world as `quest.<id>.resolution`.'),
  approach: z.enum(QUEST_APPROACHES).describe('The way of solving it this stands for.'),
  when: logicNode.describe(
    'Condition (logic DSL) that resolves the quest this way. The first to hold, in priority order, wins.',
  ),
  priority: z
    .int()
    .default(0)
    .describe('Higher wins when several conditions hold in the same tick. Ties: file order.'),
  effects: effects.optional(),
  journal: text.describe('The journal entry written when the quest ends this way.'),
  journalKey: textKey,
  note,
});

const continuationSchema = z.discriminatedUnion(
  'kind',
  [
    z.strictObject({
      kind: z.literal('startQuest').describe('A successor quest begins in the same tick.'),
      quest: ref('quest').describe('Id of the quest that starts.'),
    }),
    z.strictObject({
      kind: z.literal('setStage').describe('This quest carries on in another stage.'),
      stage: stageRef,
    }),
    z.strictObject({
      kind: z.literal('resolve').describe('This quest ends with a (bittersweet) resolution.'),
      resolution: localId.describe('Id of a resolution of this quest.'),
    }),
  ],
  {
    error: (issue) => {
      const input = issue.input as { kind?: unknown } | null | undefined;
      return input === undefined || input === null
        ? 'a failure must continue the story: give a continuation (startQuest, setStage or resolve)'
        : `unknown continuation kind ${JSON.stringify(input.kind)}; expected startQuest, setStage or resolve`;
    },
  },
);

const failureSchema = z
  .strictObject({
    id: localId.describe('Id of the failure, unique in the quest.'),
    when: logicNode.optional().describe('Condition (logic DSL) under which the quest fails.'),
    npcRemoved: z
      .array(ref('creature'))
      .default([])
      .describe('The quest fails when any of these NPCs is removed (killed, fled, gone).'),
    itemDestroyed: z
      .array(ref('item'))
      .default([])
      .describe('The quest fails when the quest copy of any of these items is destroyed.'),
    deadlineDays: z
      .int()
      .min(1)
      .optional()
      .describe('The quest fails this many in-game days after it started, if still open.'),
    effects: effects.optional(),
    journal: text.describe('The journal entry written for this failure, in the story’s voice.'),
    journalKey: textKey,
    continuation: continuationSchema.describe(
      'How the story goes on. Required: a failure is never a dead end.',
    ),
    note,
  })
  .refine(
    (f) =>
      f.when !== undefined ||
      f.npcRemoved.length > 0 ||
      f.itemDestroyed.length > 0 ||
      f.deadlineDays !== undefined,
    'a failure needs a way to happen: `when`, `npcRemoved`, `itemDestroyed` or `deadlineDays`',
  );

export type QuestObjective = z.output<typeof objectiveSchema>;
export type QuestStage = z.output<typeof stageSchema>;
export type QuestTransition = z.output<typeof transitionSchema>;
export type QuestResolution = z.output<typeof resolutionSchema>;
export type QuestFailure = z.output<typeof failureSchema>;
export type QuestContinuation = z.output<typeof continuationSchema>;

type Path = (string | number)[];

/** The localization key of a quest text: `quest.<id>.title`, `quest.<id>.objective.<oid>`... */
export function questTextKey(questId: string, part: QuestTextPart, id?: string): string {
  return `quest.${questId}.${part}${id === undefined ? '' : `.${id}`}`;
}

function checkDuplicates(
  ctx: z.RefinementCtx,
  what: string,
  items: readonly { id: string; path: Path }[],
): void {
  const first = new Map<string, Path>();
  for (const { id, path } of items) {
    const seen = first.get(id);
    if (seen === undefined) {
      first.set(id, path);
    } else {
      const at = (p: Path) =>
        p.map((s) => (typeof s === 'number' ? `[${String(s)}]` : `.${s}`)).join('');
      ctx.addIssue({
        code: 'custom',
        path,
        message: `duplicate ${what} id "${id}": at ${at(seen).slice(1)} and ${at(path).slice(1)}`,
      });
    }
  }
}

export const questSchema = z
  .strictObject({
    id: contentId.describe('Id of the quest; stable forever (saves track its state).'),
    title: text.describe('The quest’s name in the journal.'),
    titleKey: textKey,
    summary: text.describe('What the quest is about, as the journal first tells it.'),
    summaryKey: textKey,
    notes: z.string().min(1).optional().describe('What the quest is for, for writers.'),
    givers: z
      .array(ref('creature'))
      .default([])
      .describe('NPCs who hand the quest out (the journal and map point at them).'),
    startWhen: logicNode
      .optional()
      .describe('Condition (logic DSL) that starts the quest. Omit: it is started by an effect.'),
    stages: z
      .array(stageSchema)
      .default([])
      .describe('Optional sequencing, in order. The quest begins in `initialStage`.'),
    initialStage: stageRef
      .optional()
      .describe('The stage the quest starts in. Default: the first stage.'),
    objectives: z.array(objectiveSchema).default([]).describe('What the quest tracks.'),
    resolutions: z
      .array(resolutionSchema)
      .min(1, 'a quest needs at least one resolution, or it can never be finished')
      .describe('The ways the quest ends well (or at least ends). At least one.'),
    failures: z.array(failureSchema).default([]).describe('The ways the quest goes wrong.'),
  })
  .superRefine((quest, ctx) => {
    const stages = new Set(quest.stages.map((s) => s.id));
    const resolutions = new Set(quest.resolutions.map((r) => r.id));
    const issue = (path: Path, message: string): void => {
      ctx.addIssue({ code: 'custom', path, message });
    };

    checkDuplicates(
      ctx,
      'stage',
      quest.stages.map((s, i) => ({ id: s.id, path: ['stages', i, 'id'] })),
    );
    checkDuplicates(
      ctx,
      'objective',
      quest.objectives.map((o, i) => ({ id: o.id, path: ['objectives', i, 'id'] })),
    );
    checkDuplicates(
      ctx,
      'resolution',
      quest.resolutions.map((r, i) => ({ id: r.id, path: ['resolutions', i, 'id'] })),
    );
    checkDuplicates(
      ctx,
      'failure',
      quest.failures.map((f, i) => ({ id: f.id, path: ['failures', i, 'id'] })),
    );

    if (quest.initialStage !== undefined && !stages.has(quest.initialStage)) {
      issue(['initialStage'], `initialStage names unknown stage "${quest.initialStage}"`);
    }
    if (quest.initialStage !== undefined && quest.stages.length === 0) {
      issue(['initialStage'], 'initialStage needs `stages`');
    }
    quest.stages.forEach((stage, i) => {
      stage.transitions.forEach((t, j) => {
        const at: Path = ['stages', i, 'transitions', j, 'stage'];
        if (!stages.has(t.stage)) {
          issue(at, `stage "${stage.id}" moves to unknown stage "${t.stage}"`);
        } else if (t.stage === stage.id) {
          issue(at, `stage "${stage.id}" moves to itself`);
        }
      });
    });
    quest.objectives.forEach((o, i) => {
      if (o.stage !== undefined && !stages.has(o.stage)) {
        issue(['objectives', i, 'stage'], `objective "${o.id}" names unknown stage "${o.stage}"`);
      }
    });
    quest.failures.forEach((failure, i) => {
      const c = failure.continuation;
      const at: Path = ['failures', i, 'continuation'];
      if (c.kind === 'setStage' && !stages.has(c.stage)) {
        issue([...at, 'stage'], `failure "${failure.id}" continues in unknown stage "${c.stage}"`);
      } else if (c.kind === 'resolve' && !resolutions.has(c.resolution)) {
        issue(
          [...at, 'resolution'],
          `failure "${failure.id}" continues with unknown resolution "${c.resolution}"`,
        );
      } else if (c.kind === 'startQuest' && c.quest.id === quest.id) {
        issue(
          [...at, 'quest'],
          `failure "${failure.id}" continues with its own quest; give a successor`,
        );
      }
    });

    const keys: { id: string; path: Path }[] = [
      {
        id: quest.titleKey ?? questTextKey(quest.id, 'title'),
        path: [quest.titleKey === undefined ? 'id' : 'titleKey'],
      },
      {
        id: quest.summaryKey ?? questTextKey(quest.id, 'summary'),
        path: [quest.summaryKey === undefined ? 'id' : 'summaryKey'],
      },
    ];
    const keyed = (
      section: string,
      part: QuestTextPart,
      items: readonly {
        id: string;
        textKey?: string | undefined;
        journalKey?: string | undefined;
      }[],
      skip: (index: number) => boolean = () => false,
    ): void => {
      items.forEach((item, i) => {
        if (skip(i)) return;
        const field = item.journalKey === undefined ? 'textKey' : 'journalKey';
        const explicit = item.journalKey ?? item.textKey;
        keys.push({
          id: explicit ?? questTextKey(quest.id, part, item.id),
          path: [section, i, explicit === undefined ? 'id' : field],
        });
      });
    };
    keyed('stages', 'stage', quest.stages, (i) => quest.stages[i]?.text === undefined);
    keyed('objectives', 'objective', quest.objectives);
    keyed('resolutions', 'resolution', quest.resolutions);
    keyed('failures', 'failure', quest.failures);
    checkDuplicates(ctx, 'text key', keys);
  });

/** One quest file as loaded. */
export type QuestDef = z.output<typeof questSchema>;
/** One quest file as written (defaults optional). */
export type QuestDefInput = z.input<typeof questSchema>;
