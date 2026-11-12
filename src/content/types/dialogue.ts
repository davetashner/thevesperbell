// Dialogue as data (mw-e22.3): `src/content/data/dialogue/<id>.json`, one conversation per file.
// A dialogue is a graph of nodes a character walks the player through. `entries` are the ways in,
// tried in order (first meeting before return); `nodes` are the steps: `line` (someone speaks),
// `choice` (the player picks an option), `branch` (conditional routing), `check` (a persuasion check
// with a success and a failure branch), `effect` (change the world) and `jump` (continue in another
// dialogue); `end` closes the conversation. Conditions (`when`) and effects are the shared logic DSL
// (docs/design/logic-dsl.md, src/sim/logic). This schema checks everything one file can say about
// itself structurally: every node and option id is unique, every `next`/`onFail`/`success`/`failure`/
// `else` names a node of the file, a node that continues says where (`next`) or ends (`end: true`),
// every speaker is declared, every text key is unique and the last entry is unconditional. The logic
// DSL's own kinds and references are validated by src/sim/dialogue/validate.ts (content may not
// import the sim at runtime), reachability and exits by the dialogue validator (mw-e22.8). The format
// is plain JSON; the rationale and a guide are in docs/design/dialogue-format.md. Text is inline for
// the MVP and every line has a stable text key for localization (`dialogueTextKey`).
// The field reference in docs/content/dialogue-schema.md is generated (`pnpm content:docs`).

import { z } from 'zod';
import { contentId, ref } from '../schema.ts';

/** Node, option and entry ids: lowercase kebab-case, stable forever (saves track visited ids). */
export const DIALOGUE_LOCAL_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Speaker ids that need no declaration: the player's own lines and unattributed narration. */
export const DIALOGUE_RESERVED_SPEAKERS = ['player', 'narrator'] as const;

/**
 * Longest `text` of a line or option the dialogue box shows without scrolling, in characters. The
 * dialogue validator (pnpm dialogue:validate, mw-e22.8) warns above it; `--max-length` overrides it.
 */
export const DIALOGUE_MAX_TEXT_LENGTH = 240;

/** How a `check` node tries to win the NPC over (mw-e22.7). */
export const DIALOGUE_APPROACHES = ['persuade', 'intimidate', 'deceive', 'charm'] as const;
export type DialogueApproach = (typeof DIALOGUE_APPROACHES)[number];

/** The node kinds, in the order the docs list them. */
export const DIALOGUE_NODE_KINDS = [
  'line',
  'choice',
  'branch',
  'check',
  'effect',
  'jump',
  'end',
] as const;
export type DialogueNodeKind = (typeof DIALOGUE_NODE_KINDS)[number];

const localId = z
  .string()
  .regex(DIALOGUE_LOCAL_ID_PATTERN, 'must be lowercase kebab-case, e.g. "first-meeting"');
const nodeRef = localId.describe('Id of a node of this dialogue.');
const text = z
  .string()
  .min(1)
  .refine((value) => value === value.trim(), 'must not start or end with whitespace');
const textKey = z
  .string()
  .regex(/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/, 'must be a dotted lowercase key')
  .optional()
  .describe(
    'Localization key for the text. Default: `dialogue.<dialogue id>.<node id>` (options add `.<option id>`).',
  );
const note = z.string().min(1).optional().describe('A note for writers; never shown to players.');

/**
 * A condition or effect of the logic DSL (src/sim/logic). Only its shape is checked here: an object
 * with a `kind`. Kinds, fields and references are validated by src/sim/dialogue/validate.ts.
 */
const logicNode = z
  .looseObject({ kind: z.string().min(1).describe('The logic kind, e.g. "hasItem".') })
  .describe('A logic DSL node: an object with a `kind` and that kind’s fields.');
const when = logicNode.optional().describe('Condition (logic DSL) that must hold. Omit: always.');
const effects = z
  .array(logicNode)
  .min(1)
  .describe('Effects (logic DSL) applied together: all or nothing.');
const next = nodeRef.optional().describe('Node that follows. Give `next` or `end: true`.');
const end = z
  .literal(true)
  .optional()
  .describe('`true`: the conversation ends here. Give `next` or `end: true`.');

const speakerSchema = z
  .strictObject({
    id: localId.describe('Local id lines name in `speaker`. "player" and "narrator" are built in.'),
    npc: ref('creature').optional().describe('Id of the NPC creature who speaks.'),
    name: text.optional().describe('Display name when there is no `npc` (a voice, a sign).'),
  })
  .refine((s) => s.npc !== undefined || s.name !== undefined, 'give an `npc` or a `name`');

const entrySchema = z.strictObject({
  id: localId.describe('Id of the entry, for tools and previews.'),
  when,
  node: nodeRef.describe('Node the conversation starts at.'),
});

const optionSchema = z.strictObject({
  id: localId.describe('Id of the option, unique in the dialogue; tracked for `once`.'),
  text: text.describe('What the player says or does.'),
  textKey,
  when,
  showWhenLocked: z
    .boolean()
    .default(false)
    .describe('When the condition fails: show the option locked with its reason, not hidden.'),
  once: z.boolean().default(false).describe('Offered only until it has been chosen.'),
  effects: effects.optional(),
  next,
  end,
  onFail: nodeRef
    .optional()
    .describe('Node entered when the effects cannot all apply. Omit: stay and report an error.'),
});

const routeSchema = z.strictObject({
  when: logicNode.describe('Condition (logic DSL) for this route.'),
  next: nodeRef,
});

const modifierSchema = z.strictObject({
  when: logicNode.describe('Condition (logic DSL) under which the modifier applies.'),
  bonus: z
    .int()
    .refine((n) => n !== 0, 'must not be zero')
    .describe('Added to the score.'),
  label: text.describe('Why, in the words shown to the player ("You look the part").'),
});

const nodeBase = { id: localId.describe('Id of the node, unique in the dialogue.'), note };

const lineNode = z.strictObject({
  ...nodeBase,
  kind: z.literal('line').describe('Someone speaks.'),
  speaker: localId.describe('A declared speaker, "player" or "narrator".'),
  text: text.describe('What is said, British-leaning (story bible §11.1).'),
  textKey,
  next,
  end,
});
const choiceNode = z.strictObject({
  ...nodeBase,
  kind: z.literal('choice').describe('The player picks an option.'),
  options: z.array(optionSchema).min(1).describe('The options, in display order.'),
});
const branchNode = z.strictObject({
  ...nodeBase,
  kind: z.literal('branch').describe('Routes by condition without showing anything.'),
  routes: z.array(routeSchema).min(1).describe('Tried in order; the first whose condition holds.'),
  else: nodeRef.describe('Node taken when no route matches.'),
});
const checkNode = z.strictObject({
  ...nodeBase,
  kind: z.literal('check').describe('A deterministic persuasion check (mw-e22.7).'),
  approach: z.enum(DIALOGUE_APPROACHES).describe('How the player tries.'),
  difficulty: z.int().min(1).describe('Score needed; the player’s score is computed from data.'),
  target: localId
    .optional()
    .describe(
      'Speaker being worked on (its NPC’s disposition and personality count). Default: the NPC being talked to.',
    ),
  modifiers: z.array(modifierSchema).default([]).describe('Extra score from items, facts, class.'),
  success: nodeRef.describe('Node entered when the score meets the difficulty.'),
  failure: nodeRef.describe('Node entered otherwise: failures must continue the story.'),
  successEffects: effects.optional(),
  failureEffects: effects.optional(),
});
const effectNode = z.strictObject({
  ...nodeBase,
  kind: z.literal('effect').describe('Changes the world, silently.'),
  effects,
  next,
  end,
  onFail: nodeRef.optional().describe('Node entered when the effects cannot all apply.'),
});
const jumpNode = z.strictObject({
  ...nodeBase,
  kind: z.literal('jump').describe('Continues in another dialogue.'),
  dialogue: ref('dialogue').describe('Id of the dialogue to continue in.'),
  node: nodeRef.optional().describe('Node of that dialogue. Omit: its entries decide.'),
});
const endNode = z.strictObject({
  ...nodeBase,
  kind: z.literal('end').describe('The conversation ends.'),
});

const nodeSchema = z.discriminatedUnion(
  'kind',
  [lineNode, choiceNode, branchNode, checkNode, effectNode, jumpNode, endNode],
  {
    // Only an unknown (or missing) `kind` reaches here: other problems are reported by the option.
    error: (issue) =>
      `unknown node kind ${JSON.stringify((issue.input as { kind?: unknown } | null)?.kind)}; expected one of ${DIALOGUE_NODE_KINDS.join(', ')}`,
  },
);

export type DialogueNode = z.output<typeof nodeSchema>;
export type DialogueOption = z.output<typeof optionSchema>;
export type DialogueSpeaker = z.output<typeof speakerSchema>;
export type DialogueEntry = z.output<typeof entrySchema>;

type Issues = z.RefinementCtx;
type Path = (string | number)[];

/** The localization key of a node's text, or of an option's text when `optionId` is given. */
export function dialogueTextKey(dialogueId: string, nodeId: string, optionId?: string): string {
  return `dialogue.${dialogueId}.${nodeId}${optionId === undefined ? '' : `.${optionId}`}`;
}

/** Every `next`-like reference of a node: pointer path (below the node) and target node id. */
export function nodeTargets(node: DialogueNode): { path: Path; target: string }[] {
  const at = (path: Path, target: string | undefined) =>
    target === undefined ? [] : [{ path, target }];
  switch (node.kind) {
    case 'line':
      return at(['next'], node.next);
    case 'choice':
      return node.options.flatMap((option, i) => [
        ...at(['options', i, 'next'], option.next),
        ...at(['options', i, 'onFail'], option.onFail),
      ]);
    case 'branch':
      return [
        ...node.routes.flatMap((route, i) => at(['routes', i, 'next'], route.next)),
        ...at(['else'], node.else),
      ];
    case 'check':
      return [...at(['success'], node.success), ...at(['failure'], node.failure)];
    case 'effect':
      return [...at(['next'], node.next), ...at(['onFail'], node.onFail)];
    case 'jump':
    case 'end':
      return [];
  }
}

/** A `line`, `effect` or option must continue (`next`) or end (`end: true`), exactly one. */
function checkContinues(
  ctx: Issues,
  path: Path,
  what: string,
  item: { next?: string | undefined; end?: true | undefined },
): void {
  if (item.next === undefined && item.end === undefined) {
    ctx.addIssue({ code: 'custom', path, message: `${what} needs \`next\` or \`end: true\`` });
  } else if (item.next !== undefined && item.end !== undefined) {
    ctx.addIssue({ code: 'custom', path, message: `${what} has both \`next\` and \`end\`` });
  }
}

function checkDuplicates(
  ctx: Issues,
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

export const dialogueSchema = z
  .strictObject({
    id: contentId.describe('Id of the dialogue; stable forever (saves track visited nodes).'),
    notes: z.string().min(1).optional().describe('What the conversation is for, for writers.'),
    speakers: z.array(speakerSchema).describe('Who speaks, besides "player" and "narrator".'),
    entries: z
      .array(entrySchema)
      .min(1)
      .describe(
        'Ways in, tried in order; the first whose condition holds starts. The last has none.',
      ),
    nodes: z.array(nodeSchema).min(1).describe('Every step of the conversation.'),
  })
  .superRefine((dialogue, ctx) => {
    const nodeIds = new Set(dialogue.nodes.map((node) => node.id));
    const options = dialogue.nodes.flatMap((node, n) =>
      node.kind === 'choice'
        ? node.options.map((option, o) => ({
            id: option.id,
            path: ['nodes', n, 'options', o, 'id'] as Path,
          }))
        : [],
    );

    checkDuplicates(
      ctx,
      'speaker',
      dialogue.speakers.map((s, i) => ({ id: s.id, path: ['speakers', i, 'id'] })),
    );
    dialogue.speakers.forEach((speaker, i) => {
      if ((DIALOGUE_RESERVED_SPEAKERS as readonly string[]).includes(speaker.id)) {
        ctx.addIssue({
          code: 'custom',
          path: ['speakers', i, 'id'],
          message: `"${speaker.id}" is built in; do not declare it`,
        });
      }
    });
    checkDuplicates(
      ctx,
      'entry',
      dialogue.entries.map((e, i) => ({ id: e.id, path: ['entries', i, 'id'] })),
    );
    checkDuplicates(
      ctx,
      'node',
      dialogue.nodes.map((n, i) => ({ id: n.id, path: ['nodes', i, 'id'] })),
    );
    checkDuplicates(ctx, 'option', options);
    for (const option of options) {
      if (nodeIds.has(option.id)) {
        ctx.addIssue({
          code: 'custom',
          path: option.path,
          message: `option id "${option.id}" is also a node id; ids share one namespace`,
        });
      }
    }

    const lastEntry = dialogue.entries.length - 1;
    if (dialogue.entries[lastEntry]?.when !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['entries', lastEntry, 'when'],
        message: 'the last entry must have no condition, so a conversation can always start',
      });
    }
    dialogue.entries.forEach((entry, i) => {
      if (!nodeIds.has(entry.node)) {
        ctx.addIssue({
          code: 'custom',
          path: ['entries', i, 'node'],
          message: `entry "${entry.id}" starts at unknown node "${entry.node}"`,
        });
      }
    });

    const speakers = new Set<string>([
      ...DIALOGUE_RESERVED_SPEAKERS,
      ...dialogue.speakers.map((s) => s.id),
    ]);
    const keys: { id: string; path: Path }[] = [];
    dialogue.nodes.forEach((node, n) => {
      const here: Path = ['nodes', n];
      for (const { path, target } of nodeTargets(node)) {
        if (!nodeIds.has(target)) {
          ctx.addIssue({
            code: 'custom',
            path: [...here, ...path],
            message: `node "${node.id}" continues to unknown node "${target}"`,
          });
        }
      }
      if (node.kind === 'line') {
        checkContinues(ctx, here, `line "${node.id}"`, node);
        keys.push({
          id: node.textKey ?? dialogueTextKey(dialogue.id, node.id),
          path: [...here, node.textKey === undefined ? 'id' : 'textKey'],
        });
      }
      if (node.kind === 'effect') checkContinues(ctx, here, `effect "${node.id}"`, node);
      if (node.kind === 'choice') {
        node.options.forEach((option, o) => {
          checkContinues(ctx, [...here, 'options', o], `option "${option.id}"`, option);
          keys.push({
            id: option.textKey ?? dialogueTextKey(dialogue.id, node.id, option.id),
            path: [...here, 'options', o, option.textKey === undefined ? 'id' : 'textKey'],
          });
        });
      }
      const named =
        node.kind === 'line' ? node.speaker : node.kind === 'check' ? node.target : undefined;
      if (named !== undefined && !speakers.has(named)) {
        ctx.addIssue({
          code: 'custom',
          path: [...here, node.kind === 'line' ? 'speaker' : 'target'],
          message: `node "${node.id}" names undeclared speaker "${named}"`,
        });
      }
    });
    checkDuplicates(ctx, 'text key', keys);
  });

/** One dialogue file as loaded. */
export type DialogueDef = z.output<typeof dialogueSchema>;
/** One dialogue file as written (defaults optional). */
export type DialogueDefInput = z.input<typeof dialogueSchema>;
