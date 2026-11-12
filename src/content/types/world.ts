// The world connectivity map as content (mw-e24.1, docs/design/world-map.md): every place the
// player can be (a node: a town district, a Briarwood zone, a mine gate, a priory room, a Knot area,
// a river stop, a harbour place) and every way between two places (an edge: a path, a door, a
// shortcut, a one-way drop or a secret). Every later level bead builds from this graph, and the
// world validator (src/tools/world, `pnpm world:validate`) proves it: every node reachable from the
// town spawn with the base classes' capabilities, every shortcut's fact produced by some placed
// content, the loops the story bible promises (§3.1), and a main quest that never needs Wendmouth.
//
// A node with a `scene` is built (that scene file exists); the rest are planned. An edge with
// `transitions` is built (each entry is `<scene>/<transition id>`, a scene transition volume that
// really leads across it); the rest are planned and carry the bead that builds them. One file:
// `src/content/data/world/connectivity.json`.

import { z } from 'zod';
import { capabilityId } from './capability.ts';
import { conditionSchema } from './condition.ts';
import { PLAYER_CLASSES } from './controller.ts';
import { contentId, ref } from '../schema.ts';

/** The regions of the map (bible §3.1, §3.5). */
export const WORLD_AREAS = [
  'valley',
  'town',
  'briarwood',
  'moorings-watch',
  'deepworks',
  'priory',
  'knot',
  'river',
  'wendmouth',
] as const;

/** How two places connect. `one-way` can only be taken from → to; every other kind both ways. */
export const EDGE_KINDS = ['path', 'door', 'shortcut', 'one-way', 'secret'] as const;

/** How the player crosses an edge: on foot, or by the barge (a narrated ride / fast travel). */
export const TRAVEL_MODES = ['foot', 'barge'] as const;

/** The epics that own building a place or connection. */
export const OWNER_EPICS = ['e24', 'e25', 'e26', 'e40'] as const;

const bead = z.string().regex(/^mw-[a-z0-9]+(?:\.[0-9]+)*$/, 'must be a bead id, e.g. "mw-e25.1"');

/** `<scene>/<transition id>`: one transition volume of a built scene. */
export const TRANSITION_REF = /^([a-z0-9]+(?:-[a-z0-9]+)*)\/([a-z0-9]+(?:-[a-z0-9]+)*)$/;

const nodeSchema = z.strictObject({
  id: contentId.describe('Node id, unique in the map, e.g. "glen-well".'),
  name: z.string().min(1).describe('Place name exactly as the story bible spells it.'),
  area: z.enum(WORLD_AREAS).describe('Region of the map the place belongs to.'),
  epic: z.enum(OWNER_EPICS).describe('Epic that builds the place (bead split: mw-e25 notes).'),
  scene: ref('scene')
    .optional()
    .describe('The scene file that holds the place. Omitted: planned, not yet built.'),
  optional: z
    .boolean()
    .default(false)
    .describe('The main quest never needs the place (Wendmouth, Kestrel Lock): AC-5 checks it.'),
  notes: z.string().min(1).describe('What the place is and which bible section names it.'),
});

const edgeSchema = z.strictObject({
  id: contentId.describe('Edge id, unique in the map, e.g. "glen-well-cistern".'),
  from: contentId.describe(
    'Node the edge leaves (the only end of a `one-way` edge you can enter).',
  ),
  to: contentId.describe('Node the edge arrives at.'),
  kind: z.enum(EDGE_KINDS).describe('Path, door, shortcut, one-way drop or secret.'),
  travel: z.enum(TRAVEL_MODES).default('foot').describe('How it is crossed: on foot or by barge.'),
  unlock: conditionSchema
    .optional()
    .describe(
      'World state that opens the edge, in the shared fact condition language (docs/design/conditions.md). Omitted: always open. Every shortcut needs one.',
    ),
  routes: z
    .array(capabilityId)
    .default([])
    .describe(
      'Capabilities that can open the edge, any one of them. Empty: anyone can (a quest or puzzle outcome, not a class ability).',
    ),
  classesHint: z
    .array(z.enum(PLAYER_CLASSES))
    .default([])
    .describe(
      'The classes whose MVP capabilities include a route; must equal what the class files say (the validator derives it).',
    ),
  time: z
    .array(contentId)
    .min(1)
    .optional()
    .describe('Clock phases (game.clock.phases) in which the edge can be taken, e.g. the barge.'),
  transitions: z
    .array(z.string().regex(TRANSITION_REF, 'must be "<scene>/<transition id>"'))
    .default([])
    .describe(
      'Built scene transitions that implement the edge (one per direction). Empty: planned.',
    ),
  bead: bead
    .optional()
    .describe('Bead that builds the connection, set on every planned edge between two scenes.'),
  notes: z.string().min(1).describe('What the connection is, and any bible canon for it.'),
});

const loopSchema = z.strictObject({
  id: contentId.describe('Loop id, e.g. "forest-watchtower-priory".'),
  name: z.string().min(1).describe('The loop as the bible words it (§3.1).'),
  edges: z.array(contentId).min(2).describe('Edge ids that form one cycle through the map.'),
});

/** Schema of the connectivity file, `src/content/data/world/connectivity.json`. */
export const worldSchema = z
  .strictObject({
    id: contentId.describe('Map id: "connectivity".'),
    name: z.string().min(1).describe('Display name.'),
    notes: z.string().min(1).describe('What the map covers and its canon sources, for review.'),
    townSpawn: contentId.describe(
      'The node a player enters the town at; reachability starts here.',
    ),
    mainQuest: z
      .array(contentId)
      .min(2)
      .describe('Main-quest waypoints in order (bible §4.1); the critical path joins them.'),
    nodes: z.array(nodeSchema).min(1).describe('Every place on the map.'),
    edges: z.array(edgeSchema).min(1).describe('Every connection between two places.'),
    loops: z.array(loopSchema).default([]).describe('The loops the story bible promises (§3.1).'),
  })
  .superRefine((world, ctx) => {
    const nodeIds = new Set<string>();
    world.nodes.forEach(({ id }, i) => {
      if (nodeIds.has(id)) {
        ctx.addIssue({
          code: 'custom',
          path: ['nodes', i, 'id'],
          message: `node "${id}" is listed twice`,
        });
      }
      nodeIds.add(id);
    });
    const edgeIds = new Set<string>();
    const unknownNode = (path: (string | number)[], what: string, id: string): void => {
      if (!nodeIds.has(id)) {
        ctx.addIssue({ code: 'custom', path, message: `${what} references unknown node "${id}"` });
      }
    };
    world.edges.forEach((edge, i) => {
      if (edgeIds.has(edge.id)) {
        ctx.addIssue({
          code: 'custom',
          path: ['edges', i, 'id'],
          message: `edge "${edge.id}" is listed twice`,
        });
      }
      edgeIds.add(edge.id);
      unknownNode(['edges', i, 'from'], `edge "${edge.id}"`, edge.from);
      unknownNode(['edges', i, 'to'], `edge "${edge.id}"`, edge.to);
      if (edge.from === edge.to) {
        ctx.addIssue({
          code: 'custom',
          path: ['edges', i, 'to'],
          message: `edge "${edge.id}" leads from "${edge.from}" to itself`,
        });
      }
    });
    unknownNode(['townSpawn'], 'townSpawn', world.townSpawn);
    world.mainQuest.forEach((id, i) => {
      unknownNode(['mainQuest', i], 'mainQuest', id);
    });
    const loopIds = new Set<string>();
    world.loops.forEach((loop, i) => {
      if (loopIds.has(loop.id)) {
        ctx.addIssue({
          code: 'custom',
          path: ['loops', i, 'id'],
          message: `loop "${loop.id}" is listed twice`,
        });
      }
      loopIds.add(loop.id);
      loop.edges.forEach((id, j) => {
        if (!edgeIds.has(id)) {
          ctx.addIssue({
            code: 'custom',
            path: ['loops', i, 'edges', j],
            message: `loop "${loop.id}" references unknown edge "${id}"`,
          });
        }
      });
    });
  });

/** A connectivity map as written in JSON. */
export type WorldMapInput = z.input<typeof worldSchema>;
/** A validated connectivity map. */
export type WorldMap = z.output<typeof worldSchema>;
