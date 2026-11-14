// pnpm world:validate (mw-e24.1), run through scripts/world-validate-cli.ts, which loads this file
// through Vite (path aliases and import.meta.glob content loading). See validate.ts for the checks.

import { loadGameContent, type GameContent } from '@content/index';
import { buildEnv, validateWorld } from './validate';

export const USAGE = `Usage: pnpm world:validate [--plan]

Validates src/content/data/world/connectivity.json (docs/design/world-map.md): every node reachable
from the town spawn with the base classes' capabilities, every shortcut's unlock fact produced by
placed content (warning), the story bible's loops, and a main quest that never needs Wendmouth or
the barge. --plan also lists the planned connections and the beads that build them. Exits 1 on errors.`;

export interface CliIo {
  log(line: string): void;
  content(): GameContent;
}

export const defaultIo: CliIo = {
  log: (line) => {
    console.log(line);
  },
  content: loadGameContent,
};

/** The exit code of `pnpm world:validate <args>`. */
export function main(args: readonly string[], io: CliIo = defaultIo): number {
  if (args.includes('--help') || args.includes('-h')) {
    io.log(USAGE);
    return 0;
  }
  const content = io.content();
  const env = buildEnv(content);
  let failed = false;
  for (const world of content.all('world')) {
    const report = validateWorld(world, env, content);
    for (const error of report.errors) io.log(`::error title=World map::${world.id}: ${error}`);
    for (const warning of report.warnings)
      io.log(`::warning title=World map::${world.id}: ${warning}`);
    io.log(
      `World map "${world.id}": ${String(world.nodes.length)} node(s), ${String(world.edges.length)} edge(s), ${String(world.loops.length)} loop(s); built ${String(report.built.nodes)} node(s) / ${String(report.built.edges)} edge(s), planned ${String(report.planned.nodes)} / ${String(report.planned.edges)}; critical path ${String(report.criticalPath.length)} node(s); ${String(report.errors.length)} error(s), ${String(report.warnings.length)} warning(s).`,
    );
    if (args.includes('--plan')) {
      for (const edge of world.edges) {
        if (edge.transitions.length === 0)
          io.log(`planned: ${edge.id} (${edge.from} -> ${edge.to}) ${edge.bead ?? 'no bead'}`);
      }
    }
    if (report.errors.length > 0) failed = true;
  }
  if (content.all('world').length === 0) {
    io.log('::error title=World map::no world connectivity file found');
    failed = true;
  }
  return failed ? 1 : 0;
}
