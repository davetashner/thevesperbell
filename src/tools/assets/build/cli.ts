// pnpm assets:build [--candidate assets/_incoming/<id>/vN.glb] (mw-e37.8). Run directly by Node.
import { parseArgs } from 'node:util';
import { buildAll, buildCandidate, MANIFEST_PATH } from './build.ts';

export const USAGE = `Usage: pnpm assets:build [--candidate <path>]

Optimises every model under assets/source/<category>/<id>/<id>.glb|.gltf into public/assets/model/<id>.glb
(High) and public/assets/model/low/<id>.glb (Low, half-size textures): dedup, prune, weld, optional
simplify (build.json simplifyRatio), LOD0 triangle budget check, WebP textures resized to the tier,
meshopt compression. Lists them in ${MANIFEST_PATH}. Unchanged models are skipped.

  --candidate <path>  build one assets/_incoming/<id>/vN.glb beside itself (vN.runtime.glb,
                      vN.runtime-low.glb) for the turntable gate; no manifest`;

export interface CliIo {
  root: string;
  log(line: string): void;
  error(line: string): void;
}

export const defaultIo: CliIo = {
  root: process.cwd(),
  log: (line) => {
    console.log(line);
  },
  error: (line) => {
    console.error(line);
  },
};

export async function main(argv: string[], io: CliIo = defaultIo): Promise<number> {
  try {
    const { values } = parseArgs({
      args: argv,
      options: { candidate: { type: 'string' }, help: { type: 'boolean', short: 'h', default: false } },
    });
    if (values.help) {
      io.log(USAGE);
      return 0;
    }
    if (values.candidate !== undefined) {
      for (const line of await buildCandidate(io.root, values.candidate)) io.log(line);
      return 0;
    }
    const started = Date.now();
    const report = await buildAll(io.root, (line) => {
      io.log(line);
    });
    for (const error of report.errors) io.error(error);
    io.log(
      `assets:build: ${String(report.built.length)} built, ${String(report.cached.length)} cached, ${String(report.errors.length)} failed in ${String(Date.now() - started)} ms`,
    );
    return report.errors.length === 0 ? 0 : 1;
  } catch (error) {
    io.error(`assets:build: ${(error as Error).message}`);
    return 1;
  }
}
