import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_NAV_BAKE_SETTINGS, NavMesh } from '@sim/index';
import {
  bakedScenes,
  bakeScenes,
  bakeSettings,
  CONTENT_DIR,
  navmeshPath,
  NAVMESH_DIR,
  serializeNavMesh,
} from './bake';
import { defaultIo, main, USAGE, type CliIo } from './cli';

const REPO = join(import.meta.dirname, '../../..');

/** A scratch repo holding a copy of the content (without navmeshes unless asked). */
function scratch(withNavmeshes = false): string {
  const dir = mkdtempSync(join(tmpdir(), 'vesper-nav-'));
  cpSync(join(REPO, CONTENT_DIR), join(dir, CONTENT_DIR), { recursive: true });
  if (!withNavmeshes) rmSync(join(dir, NAVMESH_DIR), { recursive: true, force: true });
  dirs.push(dir);
  return dir;
}
const dirs: string[] = [];

function io(cwd: string) {
  const out = { log: [] as string[], error: [] as string[] };
  let clock = 0;
  const value: CliIo = {
    cwd,
    log: (line) => out.log.push(line),
    error: (line) => out.error.push(line),
    now: () => (clock += 100),
  };
  return { io: value, out };
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('pnpm nav:bake / nav:check (mw-e11.4)', () => {
  // One test per committed navmesh, each with its own budget: re-baking them all in one test grew
  // past its timeout as scenes were added (the Briarwood and the town green bake for 5 to 25 s alone).
  it('AC-6: the testbed is among the committed navmeshes', () => {
    expect(bakedScenes(REPO)).toContain('testbed');
  });

  it.each(bakedScenes(REPO))(
    'AC-6: the committed navmesh of %s is what a bake gives now',
    (scene) => {
      const [outcome] = bakeScenes(REPO, [scene], false);
      expect(outcome?.current).toBe(true);
    },
    120_000,
  );

  it('AC-6: bakes a scene into its data file, then check passes; a stale file fails check', () => {
    const dir = scratch();
    const { io: cli, out } = io(dir);
    expect(bakedScenes(dir)).toEqual([]);
    expect(main(['bake'], cli)).toBe(1);
    expect(out.error).toEqual(['No scenes to bake: name one, e.g. pnpm nav:bake testbed']);
    expect(main(['bake', 'testbed'], cli)).toBe(0);
    expect(out.log[0]).toMatch(
      /^wrote src\/content\/data\/navmesh\/testbed\.json: \d+ polygons, \d+ portals, \d+ links$/,
    );
    expect(out.log[1]).toBe('baked 1 navmesh(es) in 100 ms');
    const text = readFileSync(join(dir, navmeshPath('testbed')), 'utf8');
    expect(text).toBe(readFileSync(join(REPO, navmeshPath('testbed')), 'utf8'));
    // Re-baking every baked scene leaves it alone.
    expect(main(['bake'], cli)).toBe(0);
    expect(out.log[2]).toMatch(/^unchanged /);
    expect(main(['check'], cli)).toBe(0);
    writeFileSync(join(dir, navmeshPath('testbed')), text.replace('"version": 1', '"version": 99'));
    expect(main(['check'], cli)).toBe(1);
    expect(out.error.at(-1)).toBe(
      'src/content/data/navmesh/testbed.json is stale: run pnpm nav:bake and commit it',
    );
  });

  it('keeps a navmesh’s own settings on a re-bake, and defaults for a missing or broken file', () => {
    const dir = scratch(true);
    expect(bakeSettings(dir, 'testbed')).toEqual(DEFAULT_NAV_BAKE_SETTINGS);
    expect(bakeSettings(dir, 'combat-sandbox')).toEqual(DEFAULT_NAV_BAKE_SETTINGS);
    const file = join(dir, navmeshPath('testbed'));
    const text = readFileSync(file, 'utf8');
    writeFileSync(file, text.replace('"agentRadius": 0.35', '"agentRadius": 0.5'));
    expect(bakeSettings(dir, 'testbed').agentRadius).toBe(0.5);
    const [outcome] = bakeScenes(dir, ['testbed'], false);
    expect(outcome?.data.settings.agentRadius).toBe(0.5);
    expect(outcome?.current).toBe(false);
    writeFileSync(file, 'not json');
    expect(bakeSettings(dir, 'testbed')).toEqual(DEFAULT_NAV_BAKE_SETTINGS);
    expect(() => bakeScenes(dir, ['nowhere'], false)).toThrow(
      new RangeError('no scene "nowhere" to bake'),
    );
  });

  it('writes one row per line, empty lists inline, and reads back as the same mesh', () => {
    const [outcome] = bakeScenes(REPO, ['testbed'], false);
    const data = outcome?.data;
    if (data === undefined) throw new Error('no bake');
    const text = serializeNavMesh(data);
    expect(text.split('\n').length).toBeGreaterThan(
      data.polys.length + data.portals.length + data.links.length,
    );
    const { $schema, ...parsed } = JSON.parse(text) as { $schema: string };
    expect($schema).toBe('../navmesh.schema.json');
    expect(parsed).toEqual(data);
    expect(new NavMesh(parsed as typeof data).polyCount).toBe(data.polys.length);
    expect(serializeNavMesh({ ...data, polys: [], portals: [], links: [], doors: [] })).toContain(
      '  "polys": [],',
    );
  });

  it('prints usage for --help and refuses anything else', () => {
    const { io: cli, out } = io(REPO);
    expect(main(['--help'], cli)).toBe(0);
    expect(main(['-h'], cli)).toBe(0);
    expect(out.log).toEqual([USAGE, USAGE]);
    expect(main([], cli)).toBe(2);
    expect(main(['check', 'extra'], cli)).toBe(2);
    expect(out.error).toEqual([USAGE, USAGE]);
    const io2 = defaultIo(REPO);
    expect(io2.cwd).toBe(REPO);
    expect(io2.now()).toBeGreaterThan(0);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    io2.log('hello');
    io2.error('oops');
    expect(log).toHaveBeenCalledWith('hello');
    expect(error).toHaveBeenCalledWith('oops');
    vi.restoreAllMocks();
  });
});
