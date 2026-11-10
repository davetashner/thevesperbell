// Puzzle prefabs (mw-e15.4): `src/content/data/prefab/<id>.json`. A prefab is a kit piece for puzzle
// designers: a named bundle of scene spawns (each made of the existing world components: doors,
// plates, optics, light sources, push rules, liquid volumes…) and, when it has behaviour of its own,
// a small signal graph, with a few named parameters to tune. A scene places an instance (`prefabs`
// in the scene file: the prefab, where, how it is turned and its parameter values) and the loader
// expands it into plain spawns and a signal graph before anything else reads the scene, so the sim,
// the checks and the puzzle runtime never know a prefab was involved (src/content/prefabs.ts).
//
// A prefab may never introduce code: it has no component of its own. Every key of a spawn template
// must be a field of a scene spawn, and a missing general property goes to the e03 systemic layer
// first (contract §2). Docs: docs/design/puzzle-prefabs.md, generated from these files.
//
// Parameters are substituted wherever a template holds the string "$name" as a whole value, so the
// value keeps its type (`"rotateStep": "$stepAngle"` becomes the number). A parameter with no
// `default` is required: an instance that leaves it out fails to load with a message naming it.

import { z } from 'zod';
import { contentId } from '../schema.ts';
import { sceneSpawnSchema } from './scene.ts';

/** A parameter name: camelCase, so it reads like a field (`stepAngle`). */
export const PARAMETER_NAME_PATTERN = /^[a-z][A-Za-z0-9]*$/;

/** The scene-spawn fields a template may use (every field of a spawn but its id). */
export const SPAWN_TEMPLATE_KEYS: readonly string[] = Object.keys(sceneSpawnSchema.shape).filter(
  (key) => key !== 'id',
);

/** What a template string `$name` refers to. */
export const PARAMETER_REFERENCE = /^\$([a-z][A-Za-z0-9]*)$/;

const description = z.string().min(1).describe('What the parameter does, for the catalogue.');
const unit = z.string().min(1).optional().describe('Unit of the value, e.g. kg, m, s, degrees.');
const example = (type: string) =>
  z
    .custom<unknown>((value) => value !== undefined, `an example ${type} value`)
    .optional()
    .describe('A value used when the prefab is checked and the parameter has no default.');

const numberParameter = z.strictObject({
  type: z.literal('number'),
  description,
  unit,
  min: z.number().optional().describe('Least value allowed.'),
  max: z.number().optional().describe('Greatest value allowed.'),
  default: z.number().optional().describe('Value when an instance leaves it out; none = required.'),
  example: example('number'),
});

const integerParameter = z.strictObject({
  type: z.literal('integer'),
  description,
  unit,
  min: z.int().optional().describe('Least value allowed.'),
  max: z.int().optional().describe('Greatest value allowed.'),
  default: z.int().optional().describe('Value when an instance leaves it out; none = required.'),
  example: example('integer'),
});

const booleanParameter = z.strictObject({
  type: z.literal('boolean'),
  description,
  default: z
    .boolean()
    .optional()
    .describe('Value when an instance leaves it out; none = required.'),
  example: example('boolean'),
});

const enumParameter = z.strictObject({
  type: z.literal('enum'),
  description,
  values: z.array(z.string().min(1)).min(2).describe('The values it may take.'),
  default: z
    .string()
    .min(1)
    .optional()
    .describe('Value when an instance leaves it out; none = required.'),
  example: example('enum'),
});

/** One parameter of a prefab. */
export const prefabParameterSchema = z.discriminatedUnion('type', [
  numberParameter,
  integerParameter,
  booleanParameter,
  enumParameter,
]);

const outputSchema = z.strictObject({
  name: contentId.describe('What the output is called in the catalogue.'),
  description: z.string().min(1).describe('When it is on, in a designer’s words.'),
  node: contentId
    .optional()
    .describe(
      'A node of the prefab’s graph: the signal "<instance>/<node>" a goal or graph reads.',
    ),
  spawn: contentId
    .optional()
    .describe(
      'A spawn of the prefab: the entity itself (a goal reads where it is, a tag, or `property`).',
    ),
  property: z
    .string()
    .min(1)
    .optional()
    .describe('With `spawn`: the world property of that spawn the output reads.'),
});

const inputSchema = z.strictObject({
  name: contentId.describe('What the input is called in the catalogue.'),
  description: z.string().min(1).describe('What drives it and what it does.'),
  spawn: contentId.describe('The spawn of the prefab that takes it (a signal graph binds it).'),
});

const nodeTemplate = z.looseObject({ id: contentId, kind: z.string().min(1) });
const wireTemplate = z.strictObject({ from: z.string().min(1), to: z.string().min(1) });

/** A spawn template: `local` names it within the prefab; the rest is a scene spawn's fields. */
const spawnTemplate = z
  .looseObject({
    local: contentId.describe('Name of the spawn within the prefab; the instance prefixes it.'),
  })
  .describe(
    'A scene spawn minus its id, at a position relative to the instance; "$name" values take parameters.',
  );

export const prefabSchema = z
  .strictObject({
    id: contentId,
    name: z.string().min(1).describe('Display name in the catalogue.'),
    description: z.string().min(1).describe('What it is for and how a designer uses it.'),
    tags: z.array(contentId).default([]).describe('Catalogue tags: light, weight, water…'),
    parameters: z
      .record(
        z.string().regex(PARAMETER_NAME_PATTERN, 'must be camelCase, e.g. "stepAngle"'),
        prefabParameterSchema,
      )
      .default({})
      .describe('Parameters an instance may set; one without a default must be given.'),
    spawns: z
      .array(spawnTemplate)
      .min(1)
      .describe('The spawns it places, relative to the instance.'),
    graph: z
      .strictObject({
        nodes: z.array(nodeTemplate).min(1).describe('Signal graph nodes (any signal-graph node).'),
        wires: z.array(wireTemplate).describe('Connections, as in a signal graph.'),
      })
      .optional()
      .describe(
        'Its own behaviour, as a signal graph bound to its spawns by their local names (placed with the instance’s id as the graph id).',
      ),
    inputs: z.array(inputSchema).default([]).describe('What can drive it, for the catalogue.'),
    outputs: z
      .array(outputSchema)
      .min(1)
      .describe('What it tells the rest of the puzzle: signals, properties, states.'),
  })
  .superRefine((prefab, ctx) => {
    const issue = (path: (string | number)[], message: string) => {
      ctx.addIssue({ code: 'custom', path, message });
    };
    const locals = new Set<string>();
    prefab.spawns.forEach((spawn, index) => {
      if (locals.has(spawn.local))
        issue(['spawns', index, 'local'], `spawn "${spawn.local}" is used twice`);
      locals.add(spawn.local);
      for (const key of Object.keys(spawn)) {
        if (key === 'local' || SPAWN_TEMPLATE_KEYS.includes(key)) continue;
        issue(
          ['spawns', index, key],
          `"${key}" is not a component or field a scene spawn has; a prefab is built only from existing world components (fields: ${SPAWN_TEMPLATE_KEYS.join(', ')})`,
        );
      }
    });
    const nodes = new Set((prefab.graph?.nodes ?? []).map((node) => node.id));
    for (const [name, parameter] of Object.entries(prefab.parameters)) {
      const at = ['parameters', name];
      if (parameter.default === undefined && parameter.example === undefined) {
        issue(at, `"${name}" has no default, so it needs an example value for the prefab check`);
      }
      const fixed = parameter.default ?? parameter.example;
      if (parameter.type === 'enum') {
        if (fixed !== undefined && !parameter.values.includes(fixed as string)) {
          issue(at, `"${name}" has a default or example outside its values`);
        }
      } else if (parameter.type !== 'boolean') {
        if (fixed !== undefined && typeof fixed !== 'number')
          issue(at, `"${name}" needs a number default or example`);
        if (
          parameter.min !== undefined &&
          parameter.max !== undefined &&
          parameter.min > parameter.max
        ) {
          issue(at, `"${name}" has a min above its max`);
        }
      } else if (fixed !== undefined && typeof fixed !== 'boolean') {
        issue(at, `"${name}" needs a boolean default or example`);
      }
    }
    const reference = (value: unknown, path: (string | number)[]) => {
      if (typeof value === 'string') {
        const name = PARAMETER_REFERENCE.exec(value)?.[1];
        if (name !== undefined && !Object.hasOwn(prefab.parameters, name)) {
          issue(path, `refers to parameter "${name}", which this prefab does not declare`);
        }
      } else if (Array.isArray(value)) {
        value.forEach((item, i) => {
          reference(item, [...path, i]);
        });
      } else if (typeof value === 'object' && value !== null) {
        for (const [key, item] of Object.entries(value)) reference(item, [...path, key]);
      }
    };
    reference(prefab.spawns, ['spawns']);
    reference(prefab.graph, ['graph']);
    for (const [index, node] of (prefab.graph?.nodes ?? []).entries()) {
      const { entity } = node as { entity?: unknown };
      if (typeof entity === 'string' && !locals.has(entity)) {
        issue(
          ['graph', 'nodes', index, 'entity'],
          `binds "${entity}", which is not a spawn of this prefab`,
        );
      }
    }
    prefab.inputs.forEach((input, index) => {
      if (!locals.has(input.spawn))
        issue(
          ['inputs', index, 'spawn'],
          `names spawn "${input.spawn}", which this prefab does not have`,
        );
    });
    prefab.outputs.forEach((output, index) => {
      const at = ['outputs', index];
      if ((output.node === undefined) === (output.spawn === undefined)) {
        issue(at, `"${output.name}" needs exactly one of node and spawn`);
      }
      if (output.node !== undefined && !nodes.has(output.node)) {
        issue(
          [...at, 'node'],
          `"${output.name}" names node "${output.node}", which the prefab's graph does not have`,
        );
      }
      if (output.spawn !== undefined && !locals.has(output.spawn)) {
        issue(
          [...at, 'spawn'],
          `"${output.name}" names spawn "${output.spawn}", which this prefab does not have`,
        );
      }
      if (output.property !== undefined && output.spawn === undefined) {
        issue(at, `"${output.name}" names a property but no spawn`);
      }
    });
  });

/** A prefab as written in a data file. */
export type PrefabEntryInput = z.input<typeof prefabSchema>;
/** A loaded prefab. */
export type PrefabEntry = z.output<typeof prefabSchema>;
/** One parameter of a loaded prefab. */
export type PrefabParameter = z.output<typeof prefabParameterSchema>;
