import { describe, expect, it } from 'vitest';
import { buildConfig, settingsFor } from './config.ts';

describe('assets:build settings', () => {
  it('uses the longest matching class prefix, else the default', () => {
    const config = {
      ...buildConfig,
      classes: [
        { prefix: 'model-', textureSize: 256, maxTriangles: 100 },
        { prefix: 'model-creature-', textureSize: 512, maxTriangles: 6000 },
      ],
    };
    expect(settingsFor('model-creature-wolf-01', undefined, config)).toEqual({
      textureSize: 512,
      lowTextureSize: 256,
      maxTriangles: 6000,
      simplifyRatio: 1,
    });
    expect(settingsFor('model-prop-cup-01', undefined, config).textureSize).toBe(256);
    expect(settingsFor('tex-stone-01', undefined, config)).toMatchObject(buildConfig.default);
  });

  it('a build.json sidecar overrides the class', () => {
    expect(
      settingsFor('model-creature-horn-01', {
        textureSize: 2048,
        maxTriangles: 20000,
        simplifyRatio: 0.5,
      }),
    ).toEqual({ textureSize: 2048, lowTextureSize: 1024, maxTriangles: 20000, simplifyRatio: 0.5 });
  });

  it('rejects an out-of-range or unknown sidecar field', () => {
    expect(() => settingsFor('model-prop-a-01', { simplifyRatio: 0 })).toThrow();
    expect(() => settingsFor('model-prop-a-01', { tris: 5 })).toThrow();
  });
});
