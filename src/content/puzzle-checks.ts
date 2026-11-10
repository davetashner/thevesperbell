// Load-time puzzle checks (mw-e15.1): what a puzzle file can't check alone. After every file has
// parsed, each puzzle is checked against the rest of the content: every entity it lists is a spawn of
// its scene (the level; a typo fails in CI, not in play), every capability its solutions and hints
// name is declared in the capability registry, and the facts it writes when solved are declared and
// typed (the solved fact a bool). The scene itself is a `ref`, which the loader checks. The goal
// condition is checked by src/content/condition-checks.ts (CONDITION_USAGES), and every scene spawn it
// reads (`entities.entity`) must be listed in the puzzle's `entities`. The signals a puzzle drives
// (`outputs.signals`) must be lever or button nodes of a graph its scene places (mw-e15.3). Issues
// name the file, the JSON pointer and the missing id.

import { conditionEntityRefs, conditionProblems } from './condition-checks.ts';
import { factIndex, lookupFact } from './fact-checks.ts';
import type { ContentCheck, ContentIssue } from './loader.ts';
import { capabilityIds } from './types/capability.ts';
import type { FactGroup } from './types/fact.ts';
import type { Puzzle } from './types/puzzle.ts';
import type { SceneDef } from './types/scene.ts';
import type { SignalGraphEntry } from './types/signal-graph.ts';

/** Every capability a puzzle names, with its JSON pointer. */
function capabilityUsages(puzzle: Puzzle): { pointer: string; id: string }[] {
  return [
    ...puzzle.solutions.flatMap((solution, s) =>
      solution.capabilities.map((id, i) => ({
        pointer: `/solutions/${String(s)}/capabilities/${String(i)}`,
        id,
      })),
    ),
    ...puzzle.hints.flatMap((tier, t) =>
      tier.variants.map(({ capability }, v) => ({
        pointer: `/hints/${String(t)}/variants/${String(v)}/capability`,
        id: capability,
      })),
    ),
  ];
}

/** The content check for puzzles: entities, capabilities and output facts exist. */
export const checkPuzzles: ContentCheck = (entries) => {
  const scenes = new Map<
    string,
    {
      file: string;
      spawns: ReadonlySet<string>;
      props: ReadonlySet<string>;
      graphs: ReadonlySet<string>;
    }
  >();
  const graphs = new Map<string, ReadonlyMap<string, string>>();
  for (const { type, file, value } of entries) {
    if (type === 'signal-graph') {
      const graph = value as SignalGraphEntry;
      graphs.set(graph.id, new Map(graph.nodes.map((node) => [node.id, node.kind])));
    }
    if (type !== 'scene') continue;
    scenes.set(value.id, {
      file,
      spawns: new Set((value as SceneDef).spawns.map(({ id }) => id)),
      props: new Set(
        (value as SceneDef).spawns.flatMap((spawn) => (spawn.prop === undefined ? [] : [spawn.id])),
      ),
      graphs: new Set((value as SceneDef).signals.map(({ graph }) => graph.id)),
    });
  }
  const capabilities = capabilityIds(entries);
  const facts = factIndex(
    entries.filter((entry) => entry.type === 'fact').map((entry) => entry.value as FactGroup),
  );
  const issues: ContentIssue[] = [];
  for (const { type, file, value } of entries) {
    if (type !== 'puzzle') continue;
    const puzzle = value as Puzzle;
    const at = `puzzle:${puzzle.id}`;
    const report = (pointer: string, message: string) => {
      issues.push({ file, pointer, message: `${at} ${message}` });
    };

    // A missing scene is already reported by the loader's reference check.
    const scene = scenes.get(puzzle.scene.id);
    puzzle.entities.forEach(({ id }, i) => {
      if (scene !== undefined && !scene.spawns.has(id)) {
        report(
          `/entities/${String(i)}/id`,
          `names entity "${id}", which level "${puzzle.scene.id}" (${scene.file}) does not place`,
        );
      }
    });

    // A goal may only read entities the puzzle lists, so the entity list is the whole picture.
    const listed = new Set(puzzle.entities.map(({ id }) => id));
    for (const { pointer, entity: ref } of conditionEntityRefs(puzzle.goal)) {
      if (!listed.has(ref)) {
        report(
          `/goal${pointer}`,
          `goal reads entity "${ref}", which the puzzle does not list in \`entities\``,
        );
      }
    }

    for (const { pointer, id } of capabilityUsages(puzzle)) {
      if (!capabilities.has(id)) {
        report(
          pointer,
          `names unknown capability "${id}": declare it in src/content/data/capability/`,
        );
      }
    }

    puzzle.policy.recovery.forEach((policy, i) => {
      const pointer = `/policy/recovery/${String(i)}`;
      if (policy.kind === 'respawn') {
        if (
          scene !== undefined &&
          scene.spawns.has(policy.entity) &&
          !scene.props.has(policy.entity)
        ) {
          report(
            `${pointer}/entity`,
            `respawns "${policy.entity}", which is not a prop spawn of level "${puzzle.scene.id}": only a prop can be dropped again`,
          );
        }
        return;
      }
      if (policy.fact === undefined) return;
      const counter = lookupFact(facts, policy.fact);
      if (counter === undefined) {
        report(
          `${pointer}/fact`,
          `names undeclared fact "${policy.fact}": declare it in src/content/data/fact/`,
        );
      } else if (counter.type !== 'int') {
        report(`${pointer}/fact`, `reset fact "${policy.fact}" must be int, not ${counter.type}`);
      }
    });

    puzzle.outputs.signals.forEach((signal, i) => {
      const pointer = `/outputs/signals/${String(i)}`;
      const [graph = '', node = ''] = signal.split('/');
      const nodes = graphs.get(graph);
      const kind = nodes?.get(node);
      if (nodes === undefined) {
        report(pointer, `drives signal "${signal}", but there is no signal graph "${graph}"`);
      } else if (kind === undefined) {
        report(pointer, `drives signal "${signal}", but graph "${graph}" has no node "${node}"`);
      } else if (kind !== 'lever' && kind !== 'button') {
        report(
          pointer,
          `drives signal "${signal}", a ${kind} node: only a lever (switched on) or a button (pressed) can be driven from outside the graph`,
        );
      } else if (scene !== undefined && !scene.graphs.has(graph)) {
        report(
          pointer,
          `drives signal "${signal}", but level "${puzzle.scene.id}" (${scene.file}) does not place signal graph "${graph}"`,
        );
      }
    });

    const solved = puzzle.outputs.solvedFact;
    const def = lookupFact(facts, solved);
    if (def === undefined) {
      report(
        '/outputs/solvedFact',
        `names undeclared fact "${solved}": declare it in src/content/data/fact/`,
      );
    } else if (def.type !== 'bool') {
      report('/outputs/solvedFact', `solved fact "${solved}" must be bool, not ${def.type}`);
    }
    puzzle.outputs.set.forEach(({ fact, value: written }, i) => {
      for (const { message } of conditionProblems({ fact, eq: written }, facts)) {
        report(`/outputs/set/${String(i)}`, message);
      }
    });
  }
  return issues;
};
