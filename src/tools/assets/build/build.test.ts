import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildAll,
  buildCandidate,
  discoverModels,
  MANIFEST_PATH,
  readManifest,
  sourceHash,
  type ManifestEntry,
} from './build.ts';
import { settingsFor } from './config.ts';
import { writeFixture, type FixtureOptions } from './fixture.ts';
import { nodeIo } from './pipeline.ts';

const ID = 'model-prop-crate-01';
const source = (id: string, ext = '.glb'): string => `assets/source/model/${id}/${id}${ext}`;

function repo(): string {
  return mkdtempSync(join(tmpdir(), 'assets-build-'));
}

async function addModel(root: string, id: string, options: FixtureOptions = {}, sidecar?: unknown) {
  const path = join(root, source(id));
  mkdirSync(dirname(path), { recursive: true });
  await writeFixture(path, options);
  if (sidecar !== undefined) writeFileSync(join(dirname(path), 'build.json'), JSON.stringify(sidecar));
}

const mtimes = (root: string, paths: string[]): number[] =>
  paths.map((p) => statSync(join(root, p)).mtimeMs);

describe('pnpm assets:build', () => {
  it('AC-1: a 2048² PNG source becomes meshopt + compressed-texture High (≤ tier) and Low (half) GLBs in the manifest', async () => {
    const root = repo();
    await addModel(root, ID, { textureSize: 2048, quads: 8 });
    const lines: string[] = [];
    const report = await buildAll(root, (l) => lines.push(l));
    expect(report).toEqual({ built: [ID], cached: [], errors: [] });
    expect(lines[0]).toMatch(/^built model-prop-crate-01: 16 tris/);

    const entry = readManifest(root).models[ID];
    expect(entry).toMatchObject({
      triangles: 16,
      high: { url: `/assets/model/${ID}.glb`, textures: ['512x512'] },
      low: { url: `/assets/model/low/${ID}.glb`, textures: ['256x256'] },
    });
    const io = await nodeIo();
    for (const tier of [entry?.high, entry?.low]) {
      const bytes = readFileSync(join(root, 'public', String(tier?.url)));
      expect(bytes.byteLength).toBe(tier?.bytes);
      const doc = await io.readBinary(new Uint8Array(bytes));
      const used = doc.getRoot().listExtensionsUsed().map((e) => e.extensionName);
      expect(used).toContain('EXT_meshopt_compression');
      expect(used).toContain('EXT_texture_webp');
      expect(doc.getRoot().listTextures()[0]?.getMimeType()).toBe('image/webp');
    }
  });

  it('AC-2: with no source changes nothing is rewritten, and 100 cached assets finish in ≤ 5 s', async () => {
    const root = repo();
    await addModel(root, ID);
    await buildAll(root, () => undefined);
    // 99 more models whose outputs and manifest entries are already current.
    const manifest = readManifest(root);
    for (let i = 0; i < 99; i++) {
      const id = `model-prop-cached-${String(i).padStart(2, '0')}`;
      mkdirSync(join(root, dirname(source(id))), { recursive: true });
      writeFileSync(join(root, source(id)), `glb ${String(i)}`);
      const entry: ManifestEntry = {
        sourceHash: sourceHash(root, { assetId: id, dir: dirname(source(id)), file: source(id) }, settingsFor(id, undefined)),
        triangles: 2,
        high: { url: `/assets/model/${id}.glb`, bytes: 3, textures: [] },
        low: { url: `/assets/model/low/${id}.glb`, bytes: 3, textures: [] },
      };
      for (const tier of [entry.high, entry.low]) {
        mkdirSync(dirname(join(root, 'public', tier.url)), { recursive: true });
        writeFileSync(join(root, 'public', tier.url), 'abc');
      }
      manifest.models[id] = entry;
    }
    writeFileSync(join(root, MANIFEST_PATH), `${JSON.stringify(manifest, null, 2)}\n`);
    // The first run accepts every forged entry as cached and writes the manifest in its own order.
    expect((await buildAll(root, () => undefined)).cached).toHaveLength(100);
    const watched = [MANIFEST_PATH, `public/assets/model/${ID}.glb`, `public/assets/model/low/${ID}.glb`];
    const before = mtimes(root, watched);
    const started = performance.now();
    const report = await buildAll(root, () => undefined);
    expect(performance.now() - started).toBeLessThan(5000);
    expect(report.built).toEqual([]);
    expect(report.cached).toHaveLength(100);
    expect(mtimes(root, watched)).toEqual(before);
  });

  it('rebuilds when a source, its sidecar or an output changes', async () => {
    const root = repo();
    await addModel(root, ID);
    await buildAll(root, () => undefined);
    // Rejected iterations kept in a subfolder do not count.
    mkdirSync(join(root, dirname(source(ID)), 'iterations'));
    writeFileSync(join(root, dirname(source(ID)), 'iterations', 'v1.glb'), 'old');
    expect((await buildAll(root, () => undefined)).cached).toEqual([ID]);
    writeFileSync(join(root, dirname(source(ID)), 'build.json'), '{"textureSize": 32}');
    expect((await buildAll(root, () => undefined)).built).toEqual([ID]);
    expect(readManifest(root).models[ID]?.high.textures).toEqual(['32x32']);
    rmSync(join(root, `public/assets/model/low/${ID}.glb`));
    expect((await buildAll(root, () => undefined)).built).toEqual([ID]);
  });

  it('AC-4: a model over its triangle budget fails naming the asset; simplifyRatio is the only decimation', async () => {
    const root = repo();
    await addModel(root, ID, { quads: 40 }, { maxTriangles: 20 });
    const report = await buildAll(root, () => undefined);
    expect(report.errors).toEqual([
      expect.stringMatching(/^model-prop-crate-01: 80 triangles exceeds the budget of 20 \(simplifyRatio 1;/),
    ]);
    expect(existsSync(join(root, `public/assets/model/${ID}.glb`))).toBe(false);

    writeFileSync(join(root, dirname(source(ID)), 'build.json'), '{"maxTriangles": 20, "simplifyRatio": 0.05}');
    const simplified = await buildAll(root, () => undefined);
    expect(simplified.errors).toEqual([]);
    expect(readManifest(root).models[ID]?.triangles).toBeLessThanOrEqual(20);
  });

  it('AC-5: a missing texture, an unsupported format or a bad image fails with id and path and leaves previous outputs untouched', async () => {
    const root = repo();
    await addModel(root, ID);
    await buildAll(root, () => undefined);
    const outputs = [`public/assets/model/${ID}.glb`, `public/assets/model/low/${ID}.glb`];
    const before = outputs.map((p) => readFileSync(join(root, p)));
    const entry = readManifest(root).models[ID];

    // Replace the .glb with a .gltf whose texture file is gone.
    rmSync(join(root, source(ID)));
    await writeFixture(join(root, source(ID, '.gltf')));
    rmSync(join(root, dirname(source(ID)), 'albedo.png'));
    await addModel(root, 'model-prop-cup-01', { textureBytes: new Uint8Array([1, 2, 3, 4]) });
    mkdirSync(join(root, 'assets/source/model/model-prop-jug-01'), { recursive: true });
    writeFileSync(join(root, source('model-prop-jug-01', '.fbx')), 'fbx');

    const report = await buildAll(root, () => undefined);
    expect(report.errors).toHaveLength(3);
    expect(report.errors[0]).toMatch(new RegExp(`^${ID}: cannot read .*${ID}\\.gltf: .*albedo\\.png`));
    expect(report.errors[1]).toMatch(/^model-prop-cup-01: /);
    expect(report.errors[2]).toBe(
      `model-prop-jug-01: unsupported format .fbx (${source('model-prop-jug-01', '.fbx')}); convert it to .glb first`,
    );
    expect(outputs.map((p) => readFileSync(join(root, p)))).toEqual(before);
    expect(readManifest(root).models[ID]).toEqual(entry);
  });

  it('reports a malformed or invalid build.json against the asset', async () => {
    const root = repo();
    await addModel(root, ID);
    await addModel(root, 'model-prop-cup-01', {}, { tris: 3 });
    writeFileSync(join(root, dirname(source(ID)), 'build.json'), '{ nope');
    const { errors } = await buildAll(root, () => undefined);
    expect(errors[0]).toMatch(/^model-prop-crate-01: assets\/source\/model\/model-prop-crate-01\/build\.json: /);
    expect(errors[1]).toMatch(/^model-prop-cup-01: assets\/source\/model\/model-prop-cup-01\/build\.json: /);
  });

  it('builds an _incoming candidate beside itself for the turntable gate', async () => {
    const root = repo();
    const file = 'assets/_incoming/model-creature-wolf-01/v3.glb';
    mkdirSync(join(root, dirname(file)), { recursive: true });
    await writeFixture(join(root, file), { textureSize: 1024 });
    const lines = await buildCandidate(root, file);
    expect(lines[0]).toMatch(/^assets\/_incoming\/model-creature-wolf-01\/v3\.runtime\.glb: 4 tris, \d+ B \[512x512\]$/);
    expect(lines[1]).toMatch(/v3\.runtime-low\.glb: \d+ B \[256x256\]$/);
    await expect(buildCandidate(root, 'assets/_incoming/model-a-01/v1.glb')).rejects.toThrow(
      'model-a-01: assets/_incoming/model-a-01/v1.glb does not exist',
    );
  });

  it('an empty repository builds nothing and writes an empty manifest', async () => {
    const root = repo();
    expect(discoverModels(root)).toEqual([]);
    expect(await buildAll(root, () => undefined)).toEqual({ built: [], cached: [], errors: [] });
    expect(readManifest(root).models).toEqual({});
  });
});
