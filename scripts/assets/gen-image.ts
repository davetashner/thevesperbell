// The local image runner behind `pnpm asset:gen-image`: one filled prompt file in, versioned
// candidates out (assets/_incoming/<id>/vN.png + vN.json), generated on this machine by mflux (MLX).
// The process spawn and the texture pass are injected, so the decisions here are unit tested
// without a GPU; assets/prompts/README.md (Tooling) has the install and weights setup.
import { spawn as spawnChild } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ParsedPrompt } from './gen-image-prompt.ts';

/** One mflux model the runner may use. Apache-2.0 only (style bible §16: free public distribution). */
export interface ModelSpec {
  /** The runner's name for it (`--model`). */
  readonly id: string;
  /** The mflux executable. */
  readonly command: string;
  /** mflux's `--model` value. */
  readonly mfluxModel: string;
  /** The Hugging Face repo the weights come from (its revision goes in the provenance). */
  readonly repo: string;
  readonly steps: number;
  /** mflux's `--quantize` bits: 8 keeps quality with half the memory of bf16. */
  readonly quantize: number;
  readonly licence: string;
}

const Z_IMAGE_TURBO: ModelSpec = {
  id: 'z-image-turbo',
  command: 'mflux-generate-z-image-turbo',
  mfluxModel: 'z-image-turbo',
  repo: 'Tongyi-MAI/Z-Image-Turbo',
  steps: 9,
  quantize: 8,
  licence: 'Apache-2.0',
};

const QWEN_IMAGE: ModelSpec = {
  id: 'qwen-image',
  command: 'mflux-generate-qwen',
  mfluxModel: 'qwen-image',
  repo: 'Qwen/Qwen-Image-2512',
  steps: 25,
  quantize: 8,
  licence: 'Apache-2.0',
};

const FLUX2_KLEIN_4B: ModelSpec = {
  id: 'flux2-klein-4b',
  command: 'mflux-generate-flux2',
  mfluxModel: 'flux2-klein-4b',
  repo: 'black-forest-labs/FLUX.2-klein-4B',
  steps: 4,
  quantize: 8,
  licence: 'Apache-2.0',
};

export const MODELS: Readonly<Record<string, ModelSpec>> = {
  'z-image-turbo': Z_IMAGE_TURBO,
  'qwen-image': QWEN_IMAGE,
  'flux2-klein-4b': FLUX2_KLEIN_4B,
};

/**
 * The model a prompt gets without --model (docs/art/local-image-bakeoff.md): FLUX.2-klein-4b draws
 * flat material for tileable textures; Qwen-Image follows long, many-part prompts (prop sheets,
 * concepts) best. Z-Image-Turbo stays available but truncates our prompts at 512 tokens.
 */
export function defaultModelFor(category: string | null): ModelSpec {
  return category === 'Tileable texture' ? FLUX2_KLEIN_4B : QWEN_IMAGE;
}

/** What a spawned process left behind: its exit code and the tail of its output. */
export interface SpawnResult {
  readonly code: number;
  readonly output: string;
}

export type Spawn = (command: string, args: readonly string[], env: NodeJS.ProcessEnv) => Promise<SpawnResult>;

/** Runs `pnpm asset:texture`'s main with these arguments; returns its exit code. */
export type TextureStep = (args: readonly string[]) => Promise<number>;

export interface Deps {
  readonly spawn: Spawn;
  readonly texture: TextureStep;
  /** Wall-clock time for the provenance date and the timing. */
  readonly now: () => Date;
  /** HF_HOME: where the weights live (outside the repo, e.g. ~/llm/imagegen/hf). */
  readonly hfHome: string;
  /** Folder holding the mflux executables, or '' to find them on PATH. */
  readonly binDir: string;
  readonly log: (line: string) => void;
}

/** Spawns a process, streaming its output to stderr and keeping the last 4 KB for errors. */
export const spawnProcess: Spawn = (command, args, env) =>
  new Promise((resolve) => {
    const child = spawnChild(command, [...args], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    const keep = (chunk: Buffer): void => {
      process.stderr.write(chunk);
      output = (output + chunk.toString()).slice(-4096);
    };
    child.stdout.on('data', keep);
    child.stderr.on('data', keep);
    child.on('error', (err) => {
      resolve({ code: 127, output: err.message });
    });
    child.on('close', (code) => {
      resolve({ code: code ?? 1, output });
    });
  });

/** How the texture pass treats this asset: a trim tiles left to right, a cut-out net is alpha. */
export function textureMode(assetId: string): 'both' | 'x' | 'alpha' {
  if (assetId.includes('-alpha')) return 'alpha';
  if (assetId.includes('trim')) return 'x';
  return 'both';
}

/** Generation size per §14.1 category (multiples of 16), from the templates' output specs. */
export function sizeFor(prompt: ParsedPrompt): readonly [number, number] {
  switch (prompt.category) {
    case 'Tileable texture':
      return textureMode(prompt.assetId) === 'x' ? [1536, 512] : [1024, 1024];
    case 'Concept art':
    case 'Environment concept':
    case 'Key art / title':
      return [1536, 864];
    case 'Skybox / backdrop':
      return [2048, 1024];
    case 'Prop sheet':
    case 'Character reference sheet':
    case 'Creature reference sheet':
      return [1536, 1024];
    default:
      return [1024, 1024];
  }
}

/** Parses `--size WxH`. */
export function parseSize(value: string): readonly [number, number] {
  const match = /^(\d+)x(\d+)$/.exec(value);
  const [width, height] = [Number(match?.[1]), Number(match?.[2])];
  if (match === null || width % 16 !== 0 || height % 16 !== 0) {
    throw new Error(`--size ${value}: want WxH, both multiples of 16`);
  }
  return [width, height];
}

/** The next unused version number in an asset's staging folder (v1 when it is empty or missing). */
export function nextVersion(dir: string): number {
  if (!existsSync(dir)) return 1;
  let top = 0;
  for (const name of readdirSync(dir)) {
    const match = /^v(\d+)\./.exec(name);
    if (match !== null) top = Math.max(top, Number(match[1]));
  }
  return top + 1;
}

/**
 * The weights revision in the HF cache for `repo`: refs/main when the hub wrote one, else the only
 * snapshot (mflux downloads by commit, which leaves no ref), else 'unknown'.
 */
export function revisionOf(hfHome: string, repo: string): string {
  const cache = join(hfHome, 'hub', `models--${repo.replace('/', '--')}`);
  const ref = join(cache, 'refs', 'main');
  if (existsSync(ref)) return readFileSync(ref, 'utf8').trim();
  const snapshots = existsSync(join(cache, 'snapshots')) ? readdirSync(join(cache, 'snapshots')) : [];
  const [only, ...more] = snapshots;
  return only !== undefined && more.length === 0 ? only : 'unknown';
}

const sha256 = (data: string | Buffer): string => createHash('sha256').update(data).digest('hex');

/** mflux's arguments for one image. */
export function mfluxArgs(
  model: ModelSpec,
  job: { promptFile: string; seed: number; width: number; height: number; steps: number; output: string },
): string[] {
  return [
    '--model', model.mfluxModel,
    '--quantize', String(model.quantize),
    '--prompt-file', job.promptFile,
    '--seed', String(job.seed),
    '--steps', String(job.steps),
    '--width', String(job.width),
    '--height', String(job.height),
    '--output', job.output,
  ]; // prettier-ignore
}

export interface GenerateOptions {
  /** The prompt file's repo-relative path, as recorded in the provenance. */
  readonly promptPath: string;
  readonly prompt: ParsedPrompt;
  /** assets/_incoming (or another staging root). */
  readonly incoming: string;
  readonly model: ModelSpec;
  readonly seed: number;
  readonly count: number;
  readonly size?: readonly [number, number] | undefined;
  readonly steps?: number | undefined;
  /** Run tileable textures through the texture pass (default true). */
  readonly tile: boolean;
}

/** One finished candidate. */
export interface Candidate {
  readonly version: number;
  readonly image: string;
  readonly sidecar: string;
  readonly seconds: number;
}

/**
 * Generates `count` candidates (seeds seed, seed+1, …), each as the next free vN, never overwriting.
 * A tileable texture also gets vN.tile.webp and a vN.seams.jpg repeat from the texture pass.
 */
export async function generate(options: GenerateOptions, deps: Deps): Promise<Candidate[]> {
  const { prompt, model } = options;
  const dir = join(options.incoming, prompt.assetId);
  mkdirSync(dir, { recursive: true });
  const [width, height] = options.size ?? sizeFor(prompt);
  const steps = options.steps ?? model.steps;
  const command = deps.binDir === '' ? model.command : join(deps.binDir, model.command);
  const env = { ...process.env, HF_HOME: deps.hfHome, HF_HUB_DISABLE_TELEMETRY: '1' };
  const tiled = options.tile && prompt.category === 'Tileable texture';
  const done: Candidate[] = [];
  for (let i = 0; i < options.count; i++) {
    const version = nextVersion(dir);
    const seed = options.seed + i;
    const image = join(dir, `v${String(version)}.png`);
    const sidecar = join(dir, `v${String(version)}.json`);
    const promptFile = join(dir, `v${String(version)}.prompt.txt`);
    writeFileSync(promptFile, prompt.text, { flag: 'wx' });
    const started = deps.now();
    deps.log(`${prompt.assetId} v${String(version)}: ${model.id}, seed ${String(seed)}, ${String(width)}×${String(height)}`);
    const result = await deps.spawn(command, mfluxArgs(model, { promptFile, seed, width, height, steps, output: image }), env);
    if (result.code !== 0 || !existsSync(image)) {
      throw new Error(`${model.command} failed (exit ${String(result.code)}):\n${result.output}`);
    }
    const seconds = Math.round((deps.now().getTime() - started.getTime()) / 100) / 10;
    const provenance = {
      assetId: prompt.assetId,
      version,
      promptFile: options.promptPath,
      promptSha256: sha256(prompt.text),
      category: prompt.category,
      droppedLines: prompt.dropped,
      tool: 'mflux (local, MLX)',
      model: model.id,
      repo: model.repo,
      revision: revisionOf(deps.hfHome, model.repo),
      licence: model.licence,
      quantize: model.quantize,
      seed,
      steps,
      width,
      height,
      seconds,
      date: started.toISOString(),
      imageSha256: sha256(readFileSync(image)),
    };
    writeFileSync(sidecar, `${JSON.stringify(provenance, null, 2)}\n`, { flag: 'wx' });
    if (tiled) {
      const mode = textureMode(prompt.assetId);
      const base = join(dir, `v${String(version)}`);
      const args = [image, `${base}.tile.webp`, '--mode', mode, '--preview', `${base}.seams.jpg`];
      if (mode === 'x') args.push('--size', '1024x256');
      const code = await deps.texture(args);
      if (code !== 0) throw new Error(`texture pass failed for ${image} (exit ${String(code)})`);
    }
    deps.log(`${image}: ${String(seconds)} s`);
    done.push({ version, image, sidecar, seconds });
  }
  return done;
}
