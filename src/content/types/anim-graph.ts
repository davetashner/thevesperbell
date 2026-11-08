// Animation state graphs as content (mw-e02.20): `src/content/data/anim-graph/<rig>.json`. One graph
// per rig — the grey-box humanoid, a four-legged creature, later every NPC — so the same runtime
// (src/render/animation) animates them all from different data. A graph carries its rig's skeleton
// (bones, parents, rest offsets, grey-box shapes), named bone masks and an ordered list of layers:
// the base locomotion layer first, then masked override layers (upper-body actions) and additive
// layers (hit reactions). Each layer is a small state machine: states play a clip, a 1D/2D blend of
// clips by sim-published parameters, or the sim's current move (time-warped to its frame data), and
// transitions crossfade between them when conditions on sim parameters hold.
//
// Animation never decides gameplay: the parameters are read from the sim (ANIM_PARAMETERS below is
// the whole vocabulary the game publishes), and nothing in a graph can write back.

import { z } from 'zod';
import type { Frozen } from '../loader.ts';
import { contentId, ref } from '../schema.ts';
import { HIT_DIRECTIONS, HIT_REACTION_KINDS } from './damage.ts';

/** How a layer combines with the layers below it. */
export const ANIM_LAYER_MODES = ['override', 'additive'] as const;
/** A layer mode. */
export type AnimLayerMode = (typeof ANIM_LAYER_MODES)[number];

/** Phases the action parameters report (the sim's ActionPhase, plus none when idle). */
export const ANIM_ACTION_PHASES = ['none', 'startup', 'active', 'recovery'] as const;
/** Verbs the action parameters report (the sim's MoveVerb, plus none when idle). */
export const ANIM_ACTION_VERBS = ['none', 'attack', 'dodge', 'parry'] as const;
/**
 * Locomotion states the `locomotion` parameter reports (the sim's LocomotionState, mw-e02.6, plus
 * none for an entity that publishes none).
 */
export const ANIM_LOCOMOTION_STATES = [
  'none',
  'idle',
  'walk',
  'run',
  'sprint',
  'crouch',
  'airborne',
  'landing',
  'climb',
  'mantle',
  'hang',
  'swim',
] as const;

/**
 * Phases the `guard` parameter reports: no shield up, rising (the shield's raise ticks), up and
 * blocking, and just lowered (a short window for the lowering pose).
 */
export const ANIM_GUARD_PHASES = ['none', 'raising', 'held', 'lowering'] as const;

/** Directions the hit parameters report (the sim's hit quadrant, plus none when not reacting). */
export const ANIM_HIT_DIRECTIONS = ['none', ...HIT_DIRECTIONS] as const;

/** One sim-published parameter: a number, a flag, or one of a fixed set of strings. */
export type AnimParameterSpec =
  | { readonly kind: 'number'; readonly description: string }
  | { readonly kind: 'boolean'; readonly description: string }
  | { readonly kind: 'string'; readonly values: readonly string[]; readonly description: string };

/**
 * Every parameter the game publishes from sim state (src/game/animation reads them). Graph conditions
 * and blend axes may name only these.
 */
export const ANIM_PARAMETERS = {
  speed: { kind: 'number', description: 'Horizontal speed, m/s.' },
  turnRate: { kind: 'number', description: 'Yaw rate, rad/s (positive turns left).' },
  grounded: { kind: 'boolean', description: 'Standing on the ground.' },
  locomotion: {
    kind: 'string',
    values: ANIM_LOCOMOTION_STATES,
    description: 'The sim’s locomotion state (idle, walk, run, airborne, landing…), or none.',
  },
  verticalSpeed: { kind: 'number', description: 'Vertical speed, m/s (positive rising).' },
  acting: { kind: 'boolean', description: 'A committed move is in progress (action timeline).' },
  actionPhase: {
    kind: 'string',
    values: ANIM_ACTION_PHASES,
    description: 'Phase of the move in progress, or none.',
  },
  actionVerb: {
    kind: 'string',
    values: ANIM_ACTION_VERBS,
    description: 'Verb of the move in progress, or none.',
  },
  hitReact: {
    kind: 'boolean',
    description: 'Held in a hit reaction (the action timeline’s interrupt lock).',
  },
  hitReaction: {
    kind: 'string',
    values: HIT_REACTION_KINDS,
    description:
      'The hit reaction the sim chose and is playing (mw-e04.7), or none; a flinch during a ' +
      'move’s active or recovery ticks plays without interrupting it (an additive layer).',
  },
  hitDirection: {
    kind: 'string',
    values: ANIM_HIT_DIRECTIONS,
    description: 'Side of the entity the reacting hit came from, or none when not reacting.',
  },
  carry: {
    kind: 'boolean',
    description:
      'The entity carries its sword at the low-ready while it stands, walks, runs or crouches ' +
      '(mw-a6t); published only for readers that opt in (the knight), false otherwise.',
  },
  guard: {
    kind: 'string',
    values: ANIM_GUARD_PHASES,
    description:
      'Phase of the entity’s raised shield (its guard component: raisedAt), or none; published ' +
      'only for readers that opt in (creatures), none otherwise.',
  },
} as const satisfies Record<string, AnimParameterSpec>;

/** A parameter name. */
export type AnimParameterName = keyof typeof ANIM_PARAMETERS;
/** Every parameter name, in declaration order. */
export const ANIM_PARAMETER_NAMES = Object.keys(ANIM_PARAMETERS) as readonly AnimParameterName[];

/** Comparison operators of a transition condition. Flags and strings allow only == and !=. */
export const ANIM_CONDITION_OPS = ['==', '!=', '<', '<=', '>', '>='] as const;
/** A condition operator. */
export type AnimConditionOp = (typeof ANIM_CONDITION_OPS)[number];

/** Default crossfade when a new move restarts an action state that is already playing, seconds. */
export const ANIM_RESTART_FADE = 0.08;

const finite = z.number();
const vec3 = z.tuple([finite, finite, finite]);
const parameterName = z.enum(ANIM_PARAMETER_NAMES as [AnimParameterName, ...AnimParameterName[]]);
const clipRef = ref('anim-clip');

const boneSchema = z.strictObject({
  bone: contentId.describe('Bone name, unique in the skeleton, e.g. "upper-arm-l".'),
  parent: contentId
    .nullable()
    .describe('Parent bone (listed earlier), or null for the root; exactly one root.'),
  offset: vec3.describe(
    'Rest position relative to the parent, metres ([x, y, z]; +y up, −z forward).',
  ),
  shape: z
    .strictObject({
      size: z
        .tuple([z.number().positive(), z.number().positive(), z.number().positive()])
        .describe('Box size, metres.'),
      center: vec3.default([0, 0, 0]).describe('Box centre relative to the bone, metres.'),
    })
    .optional()
    .describe('Grey-box placeholder shape drawn for the bone; absent = invisible.'),
});

const conditionSchema = z.strictObject({
  param: parameterName.describe('A sim-published parameter (ANIM_PARAMETERS).'),
  op: z.enum(ANIM_CONDITION_OPS).describe('Comparison; flags and strings allow == and != only.'),
  value: z
    .union([z.number(), z.boolean(), z.string()])
    .describe('Value compared against; must match the parameter’s kind.'),
});

const blendPointSchema = z.strictObject({
  at: finite.describe('Parameter value at which this clip has full weight.'),
  clip: clipRef.describe('Clip id.'),
});

const blend2dPointSchema = z.strictObject({
  at: z
    .tuple([finite, finite])
    .describe('[x, y] parameter values at which this clip has full weight.'),
  clip: clipRef.describe('Clip id.'),
});

const motionSchema = z
  .discriminatedUnion('kind', [
    z.strictObject({
      kind: z.literal('clip'),
      clip: clipRef.describe('Clip id (the clip manifest, content type anim-clip).'),
    }),
    z.strictObject({
      kind: z.literal('blend1d'),
      param: parameterName.describe('Number parameter the blend follows, e.g. "speed".'),
      points: z
        .array(blendPointSchema)
        .min(1)
        .describe('Clips by parameter value, ascending; weights are linear between neighbours.'),
    }),
    z.strictObject({
      kind: z.literal('blend2d'),
      x: parameterName.describe('Number parameter on the x axis, e.g. "speed".'),
      y: parameterName.describe('Number parameter on the y axis, e.g. "turnRate".'),
      points: z
        .array(blend2dPointSchema)
        .min(1)
        .describe('Clips by [x, y]; weights are inverse-distance, exact on a point.'),
    }),
    z.strictObject({
      kind: z.literal('action'),
      fallback: clipRef.describe(
        'Clip played when the running move’s presentation.anim is not a clip of this rig.',
      ),
    }),
    z.strictObject({ kind: z.literal('none') }),
  ])
  .describe(
    'What the state plays: { kind: "clip", clip }, { kind: "blend1d", param, points }, ' +
      '{ kind: "blend2d", x, y, points }, { kind: "action", fallback } (the sim’s running move, ' +
      'time-warped to its frame data) or { kind: "none" } (the layer contributes nothing).',
  );

const stateSchema = z.strictObject({
  id: contentId.describe('State id, unique in its layer (the probe reports it), e.g. "idle".'),
  motion: motionSchema,
});

const transitionSchema = z.strictObject({
  from: z.string().min(1).describe('Source state id, or "*" for any state other than `to`.'),
  to: contentId.describe('Target state id.'),
  duration: z.number().min(0).max(5).default(0.2).describe('Crossfade duration, seconds.'),
  when: z
    .array(conditionSchema)
    .prefault([])
    .describe('Conditions on sim parameters, all of which must hold; empty = always.'),
});

const layerSchema = z.strictObject({
  id: contentId.describe('Layer id, e.g. "base", "action", "hit".'),
  mode: z
    .enum(ANIM_LAYER_MODES)
    .default('override')
    .describe('override replaces lower layers (by mask); additive adds its rotations on top.'),
  mask: contentId
    .optional()
    .describe('Bone mask (a key of `masks`) the layer affects; absent = every bone.'),
  initial: contentId.describe('State the layer starts in.'),
  states: z.array(stateSchema).min(1).describe('The layer’s states.'),
  transitions: z
    .array(transitionSchema)
    .prefault([])
    .describe('Transitions, tried in order; the first whose `from` and `when` match is taken.'),
});

type Issue = (path: readonly (string | number)[], message: string) => void;

function checkSkeleton(bones: readonly z.output<typeof boneSchema>[], fail: Issue): Set<string> {
  const seen = new Set<string>();
  let roots = 0;
  bones.forEach((bone, index) => {
    if (seen.has(bone.bone))
      fail(['skeleton', index, 'bone'], `bone "${bone.bone}" is listed twice`);
    if (bone.parent === null) {
      roots += 1;
      if (index !== 0) fail(['skeleton', index, 'parent'], 'only the first bone may be the root');
    } else if (!seen.has(bone.parent)) {
      fail(
        ['skeleton', index, 'parent'],
        `parent "${bone.parent}" must be a bone listed before "${bone.bone}"`,
      );
    }
    seen.add(bone.bone);
  });
  if (roots !== 1)
    fail(['skeleton'], `needs exactly one root bone (parent null), has ${String(roots)}`);
  return seen;
}

function checkCondition(
  condition: z.output<typeof conditionSchema>,
  path: readonly (string | number)[],
  fail: Issue,
): void {
  const spec: AnimParameterSpec = ANIM_PARAMETERS[condition.param];
  const { op, value } = condition;
  if (spec.kind === 'number') {
    if (typeof value !== 'number') fail([...path, 'value'], `${condition.param} is a number`);
    return;
  }
  if (op !== '==' && op !== '!=') {
    fail([...path, 'op'], `${condition.param} is a ${spec.kind}: use == or !=`);
  }
  if (spec.kind === 'boolean') {
    if (typeof value !== 'boolean') fail([...path, 'value'], `${condition.param} is a boolean`);
  } else if (typeof value !== 'string' || !spec.values.includes(value)) {
    fail([...path, 'value'], `${condition.param} is one of: ${spec.values.join(', ')}`);
  }
}

function checkMotion(
  motion: z.output<typeof motionSchema>,
  path: readonly (string | number)[],
  fail: Issue,
): void {
  const numeric = (param: AnimParameterName, at: readonly (string | number)[]) => {
    if (ANIM_PARAMETERS[param].kind !== 'number')
      fail(at, `blend parameter ${param} must be a number`);
  };
  if (motion.kind === 'blend1d') {
    numeric(motion.param, [...path, 'param']);
    motion.points.forEach((point, i) => {
      const previous = motion.points[i - 1];
      if (previous !== undefined && point.at <= previous.at) {
        fail([...path, 'points', i, 'at'], 'blend points must be in strictly ascending order');
      }
    });
  } else if (motion.kind === 'blend2d') {
    numeric(motion.x, [...path, 'x']);
    numeric(motion.y, [...path, 'y']);
  }
}

function checkLayer(
  layer: z.output<typeof layerSchema>,
  index: number,
  masks: ReadonlySet<string>,
  fail: Issue,
): void {
  const path = ['layers', index] as const;
  if (index === 0 && (layer.mode !== 'override' || layer.mask !== undefined)) {
    fail([...path], 'the first (base) layer must be an unmasked override layer');
  }
  if (layer.mask !== undefined && !masks.has(layer.mask)) {
    fail([...path, 'mask'], `unknown mask "${layer.mask}"`);
  }
  const states = new Set<string>();
  layer.states.forEach((state, i) => {
    if (states.has(state.id))
      fail([...path, 'states', i, 'id'], `state "${state.id}" is listed twice`);
    states.add(state.id);
    checkMotion(state.motion, [...path, 'states', i, 'motion'], fail);
  });
  if (!states.has(layer.initial)) {
    fail([...path, 'initial'], `unknown state "${layer.initial}" in layer "${layer.id}"`);
  }
  layer.transitions.forEach((transition, i) => {
    const at = [...path, 'transitions', i] as const;
    if (transition.from !== '*' && !states.has(transition.from)) {
      fail(
        [...at, 'from'],
        `transition from unknown state "${transition.from}" in layer "${layer.id}"`,
      );
    }
    if (!states.has(transition.to)) {
      fail([...at, 'to'], `transition to unknown state "${transition.to}" in layer "${layer.id}"`);
    }
    transition.when.forEach((condition, c) => {
      checkCondition(condition, [...at, 'when', c], fail);
    });
  });
}

/** Schema of one rig's animation graph, `src/content/data/anim-graph/<rig>.json`. */
export const animGraphSchema = z
  .strictObject({
    id: contentId.describe('Rig id, e.g. "greybox-humanoid"; clips name it as their rig.'),
    notes: z.string().min(1).describe('What the rig is for, for owner review.'),
    skeleton: z
      .array(boneSchema)
      .min(1)
      .describe('Bones, parents before children; the first is the root.'),
    masks: z
      .record(contentId, z.array(contentId).min(1))
      .prefault({})
      .describe('Named bone sets for masked layers, e.g. { "upper-body": ["spine", …] }.'),
    layers: z
      .array(layerSchema)
      .min(1)
      .describe(
        'Layers, bottom first: base locomotion, then masked actions, then additive reactions.',
      ),
  })
  .superRefine((graph, ctx) => {
    const fail: Issue = (path, message) => {
      ctx.addIssue({ code: 'custom', path: [...path], message: `graph "${graph.id}": ${message}` });
    };
    const bones = checkSkeleton(graph.skeleton, fail);
    for (const [mask, members] of Object.entries(graph.masks)) {
      members.forEach((bone, i) => {
        if (!bones.has(bone))
          fail(['masks', mask, i], `mask bone "${bone}" is not in the skeleton`);
      });
    }
    const layers = new Set<string>();
    const masks = new Set(Object.keys(graph.masks));
    graph.layers.forEach((layer, index) => {
      if (layers.has(layer.id))
        fail(['layers', index, 'id'], `layer "${layer.id}" is listed twice`);
      layers.add(layer.id);
      checkLayer(layer, index, masks, fail);
    });
  });

/** An animation graph as written in JSON. */
export type AnimGraphDefInput = z.input<typeof animGraphSchema>;
/** A validated animation graph. */
export type AnimGraphDef = z.output<typeof animGraphSchema>;
/** A layer of a validated graph. */
export type AnimLayerDef = AnimGraphDef['layers'][number];
/** A state of a validated graph. */
export type AnimStateDef = AnimLayerDef['states'][number];
/** A state's motion. */
export type AnimMotionDef = AnimStateDef['motion'];
/** A transition of a validated graph. */
export type AnimTransitionDef = AnimLayerDef['transitions'][number];
/** A transition condition. */
export type AnimConditionDef = AnimTransitionDef['when'][number];
/** A skeleton bone. */
export type AnimBoneDef = AnimGraphDef['skeleton'][number];

/** Every clip id a motion references. */
export function motionClips(motion: Frozen<AnimMotionDef>): string[] {
  switch (motion.kind) {
    case 'clip':
      return [motion.clip.id];
    case 'blend1d':
    case 'blend2d':
      return motion.points.map((p) => p.clip.id);
    case 'action':
      return [motion.fallback.id];
    case 'none':
      return [];
  }
}
