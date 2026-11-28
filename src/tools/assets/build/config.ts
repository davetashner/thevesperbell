// Build settings for pnpm assets:build (mw-e37.8): the High texture size and LOD0 triangle budget per
// model class (style bible §13.2, build-config.json), overridable per model by a build.json sidecar.
import { z } from 'zod';
import configJson from './build-config.json' with { type: 'json' };

const limits = z.strictObject({
  textureSize: z.number().int().min(4).max(4096),
  maxTriangles: z.number().int().positive(),
});

export const buildConfig = z
  .strictObject({
    $comment: z.string(),
    pipelineVersion: z.number().int().positive(),
    lowScale: z.number().gt(0).lt(1),
    classes: z.array(limits.extend({ prefix: z.string().min(1) })),
    default: limits,
  })
  .parse(configJson);
export type BuildConfig = typeof buildConfig;

/** A model's build.json sidecar: any of these replaces its class default. */
export const sidecar = limits.partial().extend({
  simplifyRatio: z.number().gt(0).max(1).optional(),
});

export interface ModelSettings {
  textureSize: number;
  lowTextureSize: number;
  maxTriangles: number;
  /** Fraction of vertices meshopt's simplifier keeps; 1 = no decimation. */
  simplifyRatio: number;
}

/** The settings for one asset id: its class (longest matching prefix), then its sidecar. */
export function settingsFor(
  assetId: string,
  sidecarJson: unknown,
  config: BuildConfig = buildConfig,
): ModelSettings {
  const cls = config.classes
    .filter((c) => assetId.startsWith(c.prefix))
    .sort((a, b) => b.prefix.length - a.prefix.length)[0];
  const over = sidecar.parse(sidecarJson ?? {});
  const textureSize = over.textureSize ?? cls?.textureSize ?? config.default.textureSize;
  return {
    textureSize,
    lowTextureSize: Math.max(1, Math.floor(textureSize * config.lowScale)),
    maxTriangles: over.maxTriangles ?? cls?.maxTriangles ?? config.default.maxTriangles,
    simplifyRatio: over.simplifyRatio ?? 1,
  };
}
