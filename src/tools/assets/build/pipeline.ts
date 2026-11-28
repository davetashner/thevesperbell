// One model through the import pipeline (mw-e37.8): read glTF/GLB → dedup, prune, weld → optional
// simplify (only to the configured ratio) → LOD0 budget check → textures resized to the tier and
// re-encoded as WebP (EXT_texture_webp) → meshopt compression (EXT_meshopt_compression). The same
// steps as the hand-run `gltf-transform optimize --compress meshopt --texture-compress webp`.
// KTX2 needs a native encoder (KTX-Software toktx) and is a follow-up; WebP is what ships today.
import { ImageUtils, Logger, NodeIO, type Document } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, meshopt, prune, simplify, textureCompress, weld } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';

export const SUPPORTED_EXTENSIONS = ['.glb', '.gltf'] as const;

/** A failure the build reports against one asset; previous outputs stay as they were. */
export class AssetBuildError extends Error {}

export interface TierOptions {
  textureSize: number;
  maxTriangles: number;
  simplifyRatio: number;
}

export interface TierResult {
  glb: Uint8Array;
  triangles: number;
  /** "WxH" of each texture after resizing. */
  textures: string[];
}

let ioPromise: Promise<NodeIO> | undefined;

/** One NodeIO with every extension and the meshopt codecs ready. */
export function nodeIo(): Promise<NodeIO> {
  ioPromise ??= Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready, MeshoptSimplifier.ready]).then(
    () =>
      new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
        'meshopt.decoder': MeshoptDecoder,
        'meshopt.encoder': MeshoptEncoder,
      }),
  );
  return ioPromise;
}

const TRIANGLES = 4;
const TRIANGLE_STRIP = 5;
const TRIANGLE_FAN = 6;

/** Triangles drawn by the default scene's nodes (a mesh used by two nodes counts twice). */
export function countTriangles(doc: Document): number {
  let total = 0;
  for (const node of doc.getRoot().listNodes()) {
    for (const prim of node.getMesh()?.listPrimitives() ?? []) {
      const count = prim.getIndices()?.getCount() ?? prim.getAttribute('POSITION')?.getCount() ?? 0;
      const mode = prim.getMode();
      if (mode === TRIANGLES) total += Math.floor(count / 3);
      else if (mode === TRIANGLE_STRIP || mode === TRIANGLE_FAN) total += Math.max(0, count - 2);
    }
  }
  return total;
}

/** Throws when a texture has no image data (a missing or empty reference). */
export function checkTextures(doc: Document, label: string): void {
  doc
    .getRoot()
    .listTextures()
    .forEach((texture, index) => {
      const image = texture.getImage();
      if (image === null || image.byteLength === 0) {
        const name = texture.getURI() || texture.getName() || `#${String(index)}`;
        throw new AssetBuildError(`${label}: texture ${name} has no image data (missing reference?)`);
      }
    });
}

export function textureSizes(doc: Document): string[] {
  return doc
    .getRoot()
    .listTextures()
    .map((t) => {
      const size = ImageUtils.getSize(t.getImage() ?? new Uint8Array(), t.getMimeType());
      return size === null ? 'unknown' : `${String(size[0])}x${String(size[1])}`;
    });
}

/** Reads `path` and runs the pipeline for one tier. `label` names the asset in errors. */
export async function buildTier(path: string, label: string, options: TierOptions): Promise<TierResult> {
  const io = await nodeIo();
  let doc: Document;
  try {
    doc = await io.read(path);
  } catch (error) {
    throw new AssetBuildError(`${label}: cannot read ${path}: ${(error as Error).message}`, {
      cause: error,
    });
  }
  doc.setLogger(new Logger(Logger.Verbosity.WARN));
  checkTextures(doc, label);
  await doc.transform(dedup(), prune(), weld());
  if (options.simplifyRatio < 1) {
    await doc.transform(simplify({ simplifier: MeshoptSimplifier, ratio: options.simplifyRatio, error: 0.01 }));
  }
  const triangles = countTriangles(doc);
  if (triangles > options.maxTriangles) {
    throw new AssetBuildError(
      `${label}: ${String(triangles)} triangles exceeds the budget of ${String(options.maxTriangles)} (simplifyRatio ${String(options.simplifyRatio)}; raise it in build.json only with the owner's turntable approval)`,
    );
  }
  await doc.transform(
    textureCompress({
      encoder: sharp,
      targetFormat: 'webp',
      resize: [options.textureSize, options.textureSize],
    }),
    meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
  );
  return { glb: await io.writeBinary(doc), triangles, textures: textureSizes(doc) };
}
