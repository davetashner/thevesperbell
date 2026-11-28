// Entry point: node scripts/assets/gen-image-cli.ts <prompt file>… [options]
//
// Generates image candidates on this machine with mflux (assets/prompts/README.md, Tooling).
// Each prompt file's filled block must open with the style bible §14 preamble verbatim; the
// candidates land in assets/_incoming/<asset id>/vN.png with a vN.json provenance sidecar.
//   --model ID     z-image-turbo (default), qwen-image or flux2-klein-4b
//   --seed N       first seed (default random); --count N candidates use N, N+1, …
//   --count N      candidates per prompt file (default 1)
//   --size WxH     generation size (default from the §14.1 category)
//   --steps N      sampling steps (default per model)
//   --list PATH    also read prompt file paths from PATH, one per line (batch mode)
//   --no-tile      skip the texture pass for tileable textures
// Weights come from HF_HOME (default ~/llm/imagegen/hf); the mflux executables from MFLUX_BIN_DIR
// (default ~/.local/bin, where `uv tool install` puts them).
import { randomInt } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { parsePrompt, readStyleRules } from './gen-image-prompt.ts';
import { DEFAULT_MODEL, generate, MODELS, parseSize, spawnProcess, type Deps } from './gen-image.ts';

const USAGE =
  'usage: gen-image-cli.ts <prompt file>… [--model ID] [--seed N] [--count N] [--size WxH] [--steps N] [--list PATH] [--no-tile]';

/** The real process, texture pass, clock and folders. */
export function defaultDeps(env: NodeJS.ProcessEnv = process.env): Deps {
  return {
    spawn: spawnProcess,
    texture: async (args) => (await import('./texture-cli.ts')).main(args),
    now: () => new Date(),
    hfHome: env['HF_HOME'] ?? join(homedir(), 'llm', 'imagegen', 'hf'),
    binDir: env['MFLUX_BIN_DIR'] ?? join(homedir(), '.local', 'bin'),
    log: (line) => {
      console.log(line);
    },
  };
}

/** Runs the CLI; returns the exit code. */
export async function main(argv: readonly string[], deps: Deps = defaultDeps()): Promise<number> {
  const { values, positionals } = parseArgs({
    args: [...argv],
    allowPositionals: true,
    options: {
      model: { type: 'string', default: DEFAULT_MODEL },
      seed: { type: 'string' },
      count: { type: 'string', default: '1' },
      size: { type: 'string' },
      steps: { type: 'string' },
      list: { type: 'string' },
      'no-tile': { type: 'boolean', default: false },
      bible: { type: 'string', default: 'docs/art/style-bible.md' },
      incoming: { type: 'string', default: 'assets/_incoming' },
    },
  });
  const files = [...positionals];
  if (values.list !== undefined) {
    files.push(...readFileSync(values.list, 'utf8').split('\n').map((l) => l.trim()).filter((l) => l !== '' && !l.startsWith('#')));
  }
  const model = MODELS[values.model];
  if (files.length === 0 || model === undefined) {
    console.error(model === undefined ? `unknown --model ${values.model}; one of ${Object.keys(MODELS).join(', ')}` : USAGE);
    return 2;
  }
  try {
    const rules = readStyleRules(readFileSync(values.bible, 'utf8'));
    // Check every file before the first spawn, so a bad prompt in a batch costs no GPU time.
    const prompts = files.map((file) => ({ file, prompt: parsePrompt(file, readFileSync(file, 'utf8'), rules) }));
    const size = values.size === undefined ? undefined : parseSize(values.size);
    for (const { file, prompt } of prompts) {
      if (prompt.category === null) deps.log(`${file}: no §14.1 category add-on after the preamble`);
      await generate(
        {
          promptPath: file,
          prompt,
          incoming: values.incoming,
          model,
          seed: values.seed === undefined ? randomInt(2 ** 31) : Number(values.seed),
          count: Number(values.count),
          size,
          steps: values.steps === undefined ? undefined : Number(values.steps),
          tile: !values['no-tile'],
        },
        deps,
      );
    }
  } catch (err) {
    console.error((err as Error).message);
    return 1;
  }
  return 0;
}

if (process.argv[1]?.endsWith('gen-image-cli.ts') === true) {
  process.exitCode = await main(process.argv.slice(2));
}
