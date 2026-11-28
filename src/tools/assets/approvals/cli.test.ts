import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  APPROVALS_PATH,
  APPROVE_USAGE,
  defaultIo,
  MUSIC_APPROVER,
  run,
  STANDING_APPROVER,
  VALIDATE_USAGE,
  type CliIo,
} from './cli.ts';
import { approvalRecord, parseApprovals } from './schema.ts';

const MODEL = 'model-creature-minotaur-01';
const NOW = new Date('2026-11-27T22:30:00.000Z');
const sha = (text: string): string => createHash('sha256').update(text).digest('hex');

const CREDITS = `| Asset id | Type | Placeholder |
|---|---|---|
| ${MODEL} | model | no |
| \`vfx-*\` | vfx | yes |
`;

function repo(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'assets-cli-'));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}

function cli(root: string, command: 'approve' | 'validate', args: string[]) {
  const out: string[] = [];
  const err: string[] = [];
  const io: CliIo = { root, log: (l) => out.push(l), error: (l) => err.push(l), now: () => NOW };
  return { code: run(command, args, io), out, err };
}

const approvals = (root: string) =>
  parseApprovals(readFileSync(join(root, APPROVALS_PATH), 'utf8'), APPROVALS_PATH);

describe('pnpm assets:approve', () => {
  it('AC-3: appends a schema-valid record with the file sha256 and ISO date, keeping earlier records', () => {
    const root = repo({ [`assets/_incoming/${MODEL}/v3.glb`]: 'glb v3' });
    expect(cli(root, 'approve', [MODEL, 'image', 'v1', '--file', `assets/_incoming/${MODEL}/v3.glb`]).code).toBe(0);
    const before = readFileSync(join(root, APPROVALS_PATH), 'utf8');
    const first = approvals(root).records;

    const result = cli(root, 'approve', [MODEL, 'turntable', 'v3']);
    expect(result.code).toBe(0);
    expect(result.out[0]).toContain(`approved ${MODEL} turntable v3`);
    const { records } = approvals(root);
    expect(records.slice(0, -1)).toEqual(first);
    const added = approvalRecord.parse(records.at(-1));
    expect(added).toEqual({
      assetId: MODEL,
      gate: 'turntable',
      version: 'v3',
      sha256: sha('glb v3'),
      decision: 'approved',
      approver: STANDING_APPROVER,
      date: NOW.toISOString(),
      file: `assets/_incoming/${MODEL}/v3.glb`,
      note: '',
    });
    // Append-only: the earlier text is untouched apart from the closing of the array.
    const after = readFileSync(join(root, APPROVALS_PATH), 'utf8');
    expect(after.startsWith(before.slice(0, before.lastIndexOf('}\n  ]')))).toBe(true);
  });

  it('records a rejection with a note, and a music take found under _incoming/music', () => {
    const root = repo({
      [`assets/_incoming/${MODEL}/v2.png`]: 'png',
      'assets/_incoming/music/music-hum-01.wav': 'wav',
    });
    expect(cli(root, 'approve', [MODEL, 'image', 'v2', '--reject', '--note', 'eyes too modern']).code).toBe(0);
    expect(cli(root, 'approve', ['music-hum-01', 'music-take', 'v1', '--approver', 'dave']).code).toBe(0);
    expect(cli(root, 'approve', ['music-hum-01', 'music-take', 'v2']).code).toBe(0);
    const [rejected, take, defaulted] = approvals(root).records;
    expect(rejected).toMatchObject({ decision: 'rejected', note: 'eyes too modern', file: `assets/_incoming/${MODEL}/v2.png` });
    expect(take).toMatchObject({ approver: 'dave', file: 'assets/_incoming/music/music-hum-01.wav' });
    expect(defaulted?.approver).toBe(MUSIC_APPROVER);
  });

  it('--promote copies the approved candidate into assets/source and records that path', () => {
    const root = repo({ [`assets/_incoming/${MODEL}/v4.png`]: 'png v4' });
    const result = cli(root, 'approve', [MODEL, 'image', 'v4', '--promote', 'concept']);
    expect(result.code).toBe(0);
    const target = `assets/source/concept/${MODEL}/${MODEL}.png`;
    expect(readFileSync(join(root, target), 'utf8')).toBe('png v4');
    expect(approvals(root).records[0]?.file).toBe(target);
  });

  it('prints usage, and refuses bad arguments without writing anything', () => {
    const root = repo({
      [`assets/_incoming/${MODEL}/v1.png`]: 'a',
      [`assets/_incoming/${MODEL}/v1.webp`]: 'b',
    });
    expect(cli(root, 'approve', ['--help']).out).toEqual([APPROVE_USAGE]);
    const fails: [string[], RegExp][] = [
      [[], /expected 3 arguments/],
      [['Model_X', 'image', 'v1'], /not a lower-kebab-case asset id/],
      [[MODEL, 'vibes', 'v1'], /unknown gate "vibes"/],
      [[MODEL, 'image', 'v1', '--reject', '--promote', 'concept'], /--promote applies to approvals only/],
      [[MODEL, 'image', 'v1', '--promote', '../up'], /--promote needs a lower-kebab-case category/],
      [[MODEL, 'image', 'v1'], /more than one image candidate/],
      [[MODEL, 'turntable', 'v1'], /no turntable candidate for .* looked for/],
      [[MODEL, 'image', 'v1', '--file', 'nope.png'], /nope\.png does not exist/],
      [[MODEL, 'image', 'v9', '--bogus'], /Unknown option/],
    ];
    for (const [args, message] of fails) {
      const result = cli(root, 'approve', args);
      expect(result.code, args.join(' ')).toBe(1);
      expect(result.err[0], args.join(' ')).toMatch(message);
    }
    expect(existsSync(join(root, APPROVALS_PATH))).toBe(false);
  });
});

describe('pnpm assets:validate', () => {
  it('fails an unapproved final asset, then passes once both gates are approved', () => {
    const root = repo({
      'assets/CREDITS.md': CREDITS,
      [`public/assets/model/${MODEL}.glb`]: 'runtime',
      'public/assets/vfx/vfx-ring-01.png': 'placeholder',
      [`assets/source/model/${MODEL}/${MODEL}.glb`]: 'glb',
      [`assets/source/model/${MODEL}/${MODEL}.png`]: 'png',
    });
    const failing = cli(root, 'validate', []);
    expect(failing.code).toBe(1);
    expect(failing.err).toHaveLength(2);
    expect(failing.out[0]).toBe(
      'assets:validate approvals: 1 final and 1 placeholder runtime assets, 2 problem(s)',
    );
    cli(root, 'approve', [MODEL, 'image', 'v1', '--file', `assets/source/model/${MODEL}/${MODEL}.png`]);
    cli(root, 'approve', [MODEL, 'turntable', 'v1', '--file', `assets/source/model/${MODEL}/${MODEL}.glb`]);
    expect(cli(root, 'validate', []).code).toBe(0);
  });

  it('prints usage, and reports a malformed approvals.json', () => {
    expect(cli(repo({}), 'validate', ['-h']).out).toEqual([VALIDATE_USAGE]);
    const root = repo({ 'assets/CREDITS.md': CREDITS, [APPROVALS_PATH]: '{ nope' });
    const result = cli(root, 'validate', []);
    expect(result.code).toBe(1);
    expect(result.err[0]).toMatch(/^assets:validate: assets\/approvals\.json: .*line 1 column 3/);
  });

  // This is the CI gate: asset and public/ changes run the full pipeline, so the unit tests (and the
  // required coverage gate) fail any PR that ships an unapproved or stale final asset.
  it('the repository itself passes: every final runtime asset is approved', () => {
    const result = cli(process.cwd(), 'validate', []);
    expect(result.err).toEqual([]);
    expect(result.code).toBe(0);
  });
});

describe('entry points and default io', () => {
  const argv = process.argv;
  afterEach(() => {
    process.argv = argv;
    process.exitCode = undefined;
    vi.restoreAllMocks();
  });

  it('default io writes to the console and reads the clock', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    defaultIo.log('hello');
    defaultIo.error('oops');
    expect(log).toHaveBeenCalledWith('hello');
    expect(error).toHaveBeenCalledWith('oops');
    expect(defaultIo.now()).toBeInstanceOf(Date);
  });

  it('approve-cli and validate-cli run their command with process.argv', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    process.argv = ['node', 'approve-cli.ts', '--help'];
    await import('./approve-cli.ts');
    expect(process.exitCode).toBe(0);
    process.argv = ['node', 'validate-cli.ts'];
    await import('./validate-cli.ts');
    expect(process.exitCode).toBe(0);
  });
});
