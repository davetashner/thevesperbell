// The local image runner with the mflux process and the texture pass stood in for: prompt checks
// before any spawn, versioning without overwriting, provenance, sizes, and the CLI's exit codes.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readStyleRules, type ParsedPrompt } from './gen-image-prompt';
import {
  defaultModelFor,
  generate,
  mfluxArgs,
  MODELS,
  nextVersion,
  parseSize,
  revisionOf,
  sizeFor,
  spawnProcess,
  textureMode,
  type Deps,
  type Spawn,
} from './gen-image';

vi.mock('./texture-cli.ts', () => ({ main: vi.fn(() => Promise.resolve(0)) }));

const cli = await import('./gen-image-cli');
const rules = readStyleRules(readFileSync('docs/art/style-bible.md', 'utf8'));
const TILE = rules.addOns.get('Tileable texture') ?? '';
const ZIT = MODELS['z-image-turbo'];
if (ZIT === undefined) throw new Error('no z-image-turbo');

const root = (): string => mkdtempSync(join(tmpdir(), 'gen-image-'));

/** A spawn that writes a fake PNG at --output, and records each call. */
function fakeSpawn(calls: { command: string; args: readonly string[]; env: NodeJS.ProcessEnv }[], code = 0): Spawn {
  return (command, args, env) => {
    calls.push({ command, args, env });
    const out = args[args.indexOf('--output') + 1];
    if (code === 0 && out !== undefined) writeFileSync(out, 'png');
    return Promise.resolve({ code, output: code === 0 ? '' : 'boom' });
  };
}

function deps(over: Partial<Deps> = {}): Deps & { lines: string[] } {
  const lines: string[] = [];
  let t = Date.parse('2026-11-27T22:00:00Z');
  return {
    spawn: fakeSpawn([]),
    texture: () => Promise.resolve(0),
    now: () => new Date((t += 1500)),
    hfHome: root(),
    binDir: '/bin/mflux',
    log: (line) => lines.push(line),
    lines,
    ...over,
  };
}

const prompt = (assetId: string, category: string | null): ParsedPrompt => ({
  assetId,
  category,
  text: `${rules.preamble}\n\nbody`,
  dropped: [],
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('generate', () => {
  it('AC-2: versions vN without overwriting and writes provenance JSON', async () => {
    const incoming = root();
    const calls: Parameters<typeof fakeSpawn>[0] = [];
    const d = deps({ spawn: fakeSpawn(calls) });
    mkdirSync(join(d.hfHome, 'hub', 'models--Tongyi-MAI--Z-Image-Turbo', 'refs'), { recursive: true });
    writeFileSync(join(d.hfHome, 'hub', 'models--Tongyi-MAI--Z-Image-Turbo', 'refs', 'main'), 'abc123\n');
    mkdirSync(join(incoming, 'env-a-01'));
    writeFileSync(join(incoming, 'env-a-01', 'v1.png'), 'kept');
    const options = { promptPath: 'p/env-a-01.md', prompt: prompt('env-a-01', 'Environment concept'), incoming, model: ZIT, seed: 7, count: 2, tile: true };
    const made = await generate(options, d);
    expect(made.map((c) => c.version)).toEqual([2, 3]);
    expect(readFileSync(join(incoming, 'env-a-01', 'v1.png'), 'utf8')).toBe('kept');
    expect(calls[0]?.command).toBe('/bin/mflux/mflux-generate-z-image-turbo');
    expect(calls[0]?.env['HF_HOME']).toBe(d.hfHome);
    expect(calls[1]?.args).toContain('8');
    const sidecar = JSON.parse(readFileSync(join(incoming, 'env-a-01', 'v3.json'), 'utf8')) as Record<string, unknown>;
    expect(sidecar).toMatchObject({
      assetId: 'env-a-01',
      version: 3,
      promptFile: 'p/env-a-01.md',
      model: 'z-image-turbo',
      repo: 'Tongyi-MAI/Z-Image-Turbo',
      revision: 'abc123',
      licence: 'Apache-2.0',
      seed: 8,
      steps: 9,
      width: 1536,
      height: 864,
      seconds: 1.5,
    });
    expect(sidecar['promptSha256']).toMatch(/^[0-9a-f]{64}$/);
    expect(sidecar['date']).toBe('2026-11-27T22:00:04.500Z');
    expect(readFileSync(join(incoming, 'env-a-01', 'v3.prompt.txt'), 'utf8')).toBe(`${rules.preamble}\n\nbody`);
    // A run again picks up after the last version.
    await generate({ ...options, count: 1 }, d);
    expect(existsSync(join(incoming, 'env-a-01', 'v4.json'))).toBe(true);
  });

  it('AC-4: tileable mode passes each candidate through the texture pass', async () => {
    const incoming = root();
    const texture = vi.fn(() => Promise.resolve(0));
    const base = { promptPath: 'p.md', incoming, model: ZIT, seed: 1, count: 1, tile: true };
    await generate({ ...base, prompt: prompt('tex-stone-01', 'Tileable texture') }, deps({ texture, binDir: '' }));
    await generate({ ...base, prompt: prompt('tex-rope-trim-01', 'Tileable texture') }, deps({ texture }));
    await generate({ ...base, prompt: prompt('tex-x-01', 'Tileable texture'), tile: false }, deps({ texture }));
    const v1 = join(incoming, 'tex-stone-01', 'v1');
    const trim = join(incoming, 'tex-rope-trim-01', 'v1');
    expect(texture.mock.calls).toEqual([
      [[`${v1}.png`, `${v1}.tile.webp`, '--mode', 'both', '--preview', `${v1}.seams.jpg`]],
      [[`${trim}.png`, `${trim}.tile.webp`, '--mode', 'x', '--preview', `${trim}.seams.jpg`, '--size', '1024x256']],
    ]);
    await expect(
      generate({ ...base, prompt: prompt('tex-stone-01', 'Tileable texture') }, deps({ texture: () => Promise.resolve(1) })),
    ).rejects.toThrow('texture pass failed');
  });

  it('throws with the process output when mflux fails or writes nothing', async () => {
    const base = { promptPath: 'p.md', incoming: root(), model: ZIT, seed: 1, count: 1, tile: true, prompt: prompt('a-01', null) };
    await expect(generate(base, deps({ spawn: fakeSpawn([], 1) }))).rejects.toThrow('failed (exit 1):\nboom');
    await expect(generate(base, deps({ spawn: () => Promise.resolve({ code: 0, output: '' }) }))).rejects.toThrow('exit 0');
  });

  it('uses the --size and --steps overrides', async () => {
    const calls: Parameters<typeof fakeSpawn>[0] = [];
    const base = { promptPath: 'p.md', incoming: root(), model: ZIT, seed: 1, count: 1, tile: true, prompt: prompt('a-01', null) };
    await generate({ ...base, size: [512, 256], steps: 3 }, deps({ spawn: fakeSpawn(calls) }));
    expect(calls[0]?.args.join(' ')).toContain('--steps 3 --width 512 --height 256');
  });
});

describe('helpers', () => {
  it('picks the size from the §14.1 category', () => {
    const size = (category: string | null, id = 'x-01'): readonly number[] => sizeFor(prompt(id, category));
    expect(size('Tileable texture')).toEqual([1024, 1024]);
    expect(size('Tileable texture', 'tex-trim-a-01')).toEqual([1536, 512]);
    expect(size('Concept art')).toEqual([1536, 864]);
    expect(size('Environment concept')).toEqual([1536, 864]);
    expect(size('Key art / title')).toEqual([1536, 864]);
    expect(size('Skybox / backdrop')).toEqual([2048, 1024]);
    expect(size('Prop sheet')).toEqual([1536, 1024]);
    expect(size('Character reference sheet')).toEqual([1536, 1024]);
    expect(size('Creature reference sheet')).toEqual([1536, 1024]);
    expect(size(null)).toEqual([1024, 1024]);
  });

  it('defaults tileable textures to FLUX.2-klein-4b and everything else to Qwen-Image', () => {
    expect(defaultModelFor('Tileable texture').id).toBe('flux2-klein-4b');
    expect(defaultModelFor('Prop sheet').id).toBe('qwen-image');
    expect(defaultModelFor(null).id).toBe('qwen-image');
  });

  it('maps asset ids to texture modes', () => {
    expect(textureMode('tex-net-cargo-alpha-01')).toBe('alpha');
    expect(textureMode('tex-rope-hawser-trim-01')).toBe('x');
    expect(textureMode('tex-stone-01')).toBe('both');
  });

  it('parses --size and rejects sizes the models cannot take', () => {
    expect(parseSize('1024x512')).toEqual([1024, 512]);
    expect(() => parseSize('1000x512')).toThrow('multiples of 16');
    expect(() => parseSize('big')).toThrow('want WxH');
  });

  it('finds the next version and the cached revision', () => {
    const dir = root();
    expect(nextVersion(join(dir, 'missing'))).toBe(1);
    expect(nextVersion(dir)).toBe(1);
    writeFileSync(join(dir, 'v9.json'), '');
    writeFileSync(join(dir, 'v10.prompt.txt'), '');
    writeFileSync(join(dir, 'notes.md'), '');
    expect(nextVersion(dir)).toBe(11);
    expect(revisionOf(dir, 'a/b')).toBe('unknown');
    const snapshots = join(dir, 'hub', 'models--a--b', 'snapshots');
    mkdirSync(join(snapshots, 'f33'), { recursive: true });
    expect(revisionOf(dir, 'a/b')).toBe('f33');
    mkdirSync(join(snapshots, 'e7b'));
    expect(revisionOf(dir, 'a/b')).toBe('unknown');
  });

  it('builds the mflux arguments', () => {
    expect(mfluxArgs(ZIT, { promptFile: 'p.txt', seed: 3, width: 64, height: 32, steps: 9, output: 'o.png' })).toEqual([
      '--model', 'z-image-turbo', '--quantize', '8', '--prompt-file', 'p.txt', '--seed', '3',
      '--steps', '9', '--width', '64', '--height', '32', '--output', 'o.png',
    ]); // prettier-ignore
  });

  it('spawnProcess returns the exit code and the output tail, and 127 for a missing command', async () => {
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const script = 'process.stdout.write("out"); process.stderr.write("err"); process.exit(3)';
    const result = await spawnProcess(process.execPath, ['-e', script], process.env);
    expect(result.code).toBe(3);
    expect(result.output).toContain('out');
    expect(result.output).toContain('err');
    const killed = await spawnProcess(process.execPath, ['-e', 'process.kill(process.pid, "SIGKILL")'], process.env);
    expect(killed.code).toBe(1);
    const missing = await spawnProcess('/nonexistent/mflux', [], process.env);
    expect(missing.code).toBe(127);
  });
});

describe('gen-image-cli', () => {
  const tileFile = (dir: string, body = `${rules.preamble}\n\n${TILE}\n\nMATERIAL: stone.`): string => {
    const path = join(dir, 'tex-stone-01.md');
    writeFileSync(path, `# tex-stone-01\n\n## 3. Filled prompt\n\n\`\`\`text\n${body}\n\`\`\`\n`);
    return path;
  };

  it('needs a prompt file and a known model', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await expect(cli.main([], deps())).resolves.toBe(2);
    await expect(cli.main(['a.md', '--model', 'dall-e'], deps())).resolves.toBe(2);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('usage: gen-image-cli.ts'));
    expect(error).toHaveBeenCalledWith(expect.stringContaining('unknown --model dall-e'));
  });

  it('AC-1: a batch with one paraphrased preamble fails before any spawn', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const dir = root();
    const good = tileFile(dir);
    const bad = join(dir, 'tex-bad-01.md');
    writeFileSync(bad, `## 3. Filled prompt\n\n\`\`\`text\nSTYLE: painterly.\n\`\`\`\n`);
    const calls: Parameters<typeof fakeSpawn>[0] = [];
    await expect(cli.main([good, bad, '--incoming', dir], deps({ spawn: fakeSpawn(calls) }))).resolves.toBe(1);
    expect(calls).toHaveLength(0);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('tex-bad-01.md: the prompt does not open'));
  });

  it('runs a batch from --list with the options, and notes a missing category', async () => {
    const dir = root();
    const list = join(dir, 'list.txt');
    const plain = join(dir, 'misc-a-01.md');
    writeFileSync(plain, `## 2. Filled prompt\n\n\`\`\`text\n${rules.preamble}\n\nA thing.\n\`\`\`\n`);
    writeFileSync(list, `# batch\n${plain}\n\n`);
    const calls: Parameters<typeof fakeSpawn>[0] = [];
    const d = deps({ spawn: fakeSpawn(calls) });
    const argv = [tileFile(dir), '--list', list, '--incoming', dir, '--seed', '5', '--count', '2', '--model', 'qwen-image', '--size', '512x512', '--steps', '4', '--no-tile'];
    await expect(cli.main(argv, d)).resolves.toBe(0);
    expect(calls).toHaveLength(4);
    expect(calls[0]?.command).toBe('/bin/mflux/mflux-generate-qwen');
    expect(calls[3]?.args.join(' ')).toContain('--seed 6 --steps 4 --width 512 --height 512');
    expect(d.lines).toContain(`${plain}: no §14.1 category add-on after the preamble`);
    // Without --model or --seed: the model follows the category, and the random seed is recorded.
    await expect(cli.main([plain, tileFile(dir), '--incoming', dir, '--no-tile'], d)).resolves.toBe(0);
    expect(calls[4]?.command).toBe('/bin/mflux/mflux-generate-qwen');
    expect(calls[5]?.command).toBe('/bin/mflux/mflux-generate-flux2');
    const sidecar = JSON.parse(readFileSync(join(dir, 'misc-a-01', 'v3.json'), 'utf8')) as { seed: number };
    expect(Number.isInteger(sidecar.seed)).toBe(true);
  });

  it('defaultDeps reads HF_HOME and MFLUX_BIN_DIR, falls back under the home folder, and runs the texture CLI', async () => {
    const set = cli.defaultDeps({ HF_HOME: '/w', MFLUX_BIN_DIR: '/b' });
    expect([set.hfHome, set.binDir]).toEqual(['/w', '/b']);
    const unset = cli.defaultDeps({});
    expect(unset.hfHome.endsWith(join('llm', 'imagegen', 'hf'))).toBe(true);
    expect(unset.binDir.endsWith(join('.local', 'bin'))).toBe(true);
    expect(unset.spawn).toBe(spawnProcess);
    expect(unset.now()).toBeInstanceOf(Date);
    await expect(unset.texture(['a.png', 'b.webp'])).resolves.toBe(0);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    unset.log('hi');
    expect(log).toHaveBeenCalledWith('hi');
  });

  it('sets the exit code from main when run as a script', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.resetModules();
    process.argv = ['node', 'scripts/assets/gen-image-cli.ts'];
    process.exitCode = 0;
    await import('./gen-image-cli');
    expect(process.exitCode).toBe(2);
    process.exitCode = 0;
  });
});
