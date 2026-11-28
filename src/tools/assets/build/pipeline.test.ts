import { Document } from '@gltf-transform/core';
import { describe, expect, it } from 'vitest';
import { fixtureDocument } from './fixture.ts';
import { AssetBuildError, buildTier, checkTextures, countTriangles, textureSizes } from './pipeline.ts';

const primitiveDoc = (mode: number, count: number, indexed: boolean): Document => {
  const doc = new Document();
  const position = doc.createAccessor().setType('VEC3').setArray(new Float32Array(count * 3));
  const prim = doc.createPrimitive().setMode(mode as 4).setAttribute('POSITION', position);
  if (indexed) prim.setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint16Array(count)));
  doc.createNode('a').setMesh(doc.createMesh().addPrimitive(prim));
  doc.createNode('empty');
  return doc;
};

describe('model pipeline helpers', () => {
  it('counts triangles for lists, strips and fans, and none for points or lines', () => {
    expect(countTriangles(primitiveDoc(4, 9, true))).toBe(3);
    expect(countTriangles(primitiveDoc(4, 6, false))).toBe(2);
    expect(countTriangles(primitiveDoc(5, 6, false))).toBe(4);
    expect(countTriangles(primitiveDoc(6, 1, false))).toBe(0);
    expect(countTriangles(primitiveDoc(0, 6, false))).toBe(0);
    const bare = new Document();
    bare.createNode('n').setMesh(bare.createMesh().addPrimitive(bare.createPrimitive()));
    expect(countTriangles(bare)).toBe(0);
  });

  it('names a texture with no image data, by URI, name or index', () => {
    const doc = new Document();
    doc.createTexture('').setURI('missing.png');
    expect(() => {
      checkTextures(doc, 'model-a-01');
    }).toThrow(new AssetBuildError('model-a-01: texture missing.png has no image data (missing reference?)'));
    const named = new Document();
    named.createTexture('albedo').setImage(new Uint8Array());
    expect(() => {
      checkTextures(named, 'm');
    }).toThrow(/texture albedo has/);
    const anonymous = new Document();
    anonymous.createTexture();
    expect(() => {
      checkTextures(anonymous, 'm');
    }).toThrow(/texture #0 has/);
  });

  it('reports texture sizes, or unknown for an unknown image type', async () => {
    expect(textureSizes(await fixtureDocument({ textureSize: 32 }))).toEqual(['32x32']);
    const doc = new Document();
    doc.createTexture().setMimeType('image/x-unknown');
    expect(textureSizes(doc)).toEqual(['unknown']);
  });

  it('wraps a read failure with the asset id and path', async () => {
    await expect(
      buildTier('/nope/model-a-01.glb', 'model-a-01', {
        textureSize: 64,
        maxTriangles: 10,
        simplifyRatio: 1,
      }),
    ).rejects.toThrow(/^model-a-01: cannot read \/nope\/model-a-01\.glb: /);
  });
});
