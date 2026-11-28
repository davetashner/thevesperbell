// Test fixtures for the model pipeline: a flat grid of `quads` quads with one base-colour PNG texture,
// written as .glb or .gltf (used by the build tests and e2e/asset-build.spec.ts; no binaries committed).
import { Document } from '@gltf-transform/core';
import sharp from 'sharp';
import { nodeIo } from './pipeline.ts';

export interface FixtureOptions {
  quads?: number;
  textureSize?: number;
  /** Replace the encoded PNG (e.g. with corrupt bytes). */
  textureBytes?: Uint8Array;
}

/** A size×size PNG gradient, warm orange to teal, so a render is visibly non-blank. */
export async function gradientPng(size: number): Promise<Uint8Array> {
  const pixels = Buffer.alloc(size * size * 3);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 3;
      pixels[i] = 230 - Math.floor((x / size) * 180);
      pixels[i + 1] = 120 + Math.floor((y / size) * 60);
      pixels[i + 2] = 40 + Math.floor((x / size) * 150);
    }
  }
  return new Uint8Array(
    await sharp(pixels, { raw: { width: size, height: size, channels: 3 } }).png().toBuffer(),
  );
}

export async function fixtureDocument(options: FixtureOptions = {}): Promise<Document> {
  const quads = options.quads ?? 2;
  const doc = new Document();
  const buffer = doc.createBuffer();
  const positions: number[] = [];
  const uvs: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  for (let q = 0; q < quads; q++) {
    const x = q / quads - 0.5;
    const w = 1 / quads;
    const base = q * 4;
    positions.push(x, -0.5, 0, x + w, -0.5, 0, x + w, 0.5, 0, x, 0.5, 0);
    normals.push(0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1);
    uvs.push(q / quads, 1, (q + 1) / quads, 1, (q + 1) / quads, 0, q / quads, 0);
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const texture = doc
    .createTexture('albedo')
    .setMimeType('image/png')
    .setURI('albedo.png')
    .setImage(options.textureBytes ?? (await gradientPng(options.textureSize ?? 64)));
  const material = doc.createMaterial('mat').setBaseColorTexture(texture)
    .setMetallicFactor(0)
    .setRoughnessFactor(1)
    .setDoubleSided(true);
  const prim = doc
    .createPrimitive()
    .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(new Float32Array(positions)).setBuffer(buffer))
    .setAttribute(
      'NORMAL',
      doc.createAccessor().setType('VEC3').setArray(new Float32Array(normals)).setBuffer(buffer),
    )
    .setAttribute('TEXCOORD_0', doc.createAccessor().setType('VEC2').setArray(new Float32Array(uvs)).setBuffer(buffer))
    .setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint32Array(indices)).setBuffer(buffer))
    .setMaterial(material);
  const node = doc.createNode('grid').setMesh(doc.createMesh('grid').addPrimitive(prim));
  doc.createScene('scene').addChild(node);
  return doc;
}

/** Writes the fixture to `path` (.glb embeds the texture; .gltf writes albedo.png beside it). */
export async function writeFixture(path: string, options: FixtureOptions = {}): Promise<void> {
  const io = await nodeIo();
  await io.write(path, await fixtureDocument(options));
}
