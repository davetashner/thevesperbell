// mw-e37.13: the shared stylized material, headless. Real Three.js materials, the real element-look
// renderer and the shipped element-feedback table; only the GPU is missing, so the shader compiling and
// drawing is the e2e's (e2e/stylized-material.spec.ts).
import { BoxGeometry, DataTexture, Group, Mesh, MeshStandardMaterial, ShaderLib } from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import { loadGameContent, type ElementLookDef } from '@content/index';
import { combineLooks, type CombinedLook } from '@game/vfx/element-look';
import { ElementLooks } from '@render/element-look';
import {
  StylizedMaterial,
  WET_DARKEN,
  isStylized,
  patchStylizedShader,
  setStylizedQuality,
  stylizeMaterial,
  stylizedPreset,
  useStylizedPreset,
  wetAlbedoFactor,
} from '@render/materials/index';

function wetLook(): CombinedLook {
  const table = loadGameContent().get('element-feedback', 'element-feedback');
  const wet = table.states.find((s) => s.id === 'wet')?.look as ElementLookDef;
  const look = combineLooks([wet]);
  if (look === undefined) throw new Error('no wet look');
  return look;
}

const texture = (): DataTexture => new DataTexture(new Uint8Array(4), 1, 1);

afterEach(() => {
  setStylizedQuality('high');
  useStylizedPreset('day');
});

describe('stylized material (mw-e37.13)', () => {
  it('AC-3: when an object turns wet its stylized albedo drops 20–30 % with a sheen, and reverting clears it', () => {
    const material = new StylizedMaterial({ color: 0x8c8a80 });
    const object = new Group().add(new Mesh(new BoxGeometry(), material));
    const looks = new ElementLooks();
    const look = wetLook();
    expect(look.wetness).toBe(1);

    looks.sync(new Map([[object, look]]), () => 1);
    const mesh = object.children[0] as Mesh;
    const wet = mesh.material as StylizedMaterial;
    expect(wet).not.toBe(material);
    expect(isStylized(wet)).toBe(true);
    expect(wet.wetness).toBe(1);
    // The wet look's own tint is not layered on top: the albedo drop is the wet mask's alone.
    expect(wet.color.getHex()).toBe(material.color.getHex());
    const drop = 1 - wetAlbedoFactor(wet.wetness);
    expect(drop).toBeGreaterThanOrEqual(0.2);
    expect(drop).toBeLessThanOrEqual(0.3);
    expect(drop).toBeCloseTo(WET_DARKEN);
    expect(material.wetness).toBe(0); // the shared original never changes

    looks.sync(new Map(), () => 1);
    expect(mesh.material).toBe(material);
    expect((mesh.material as StylizedMaterial).wetness).toBe(0);
  });

  it('AC-3: the shader darkens the albedo by the wet mask and adds the sheen only where wet', () => {
    const shader = { fragmentShader: ShaderLib.physical.fragmentShader };
    patchStylizedShader(shader);
    const fs = shader.fragmentShader;
    expect(fs).toContain('( 1.0 - vbWetDarken * vbWet )');
    expect(fs).toMatch(/directSpecular \+=.*vbWetSheen \* vbWet;/);
    // The physical direct light is replaced by the ramp, before the lights loop uses it.
    expect(fs.indexOf('#define RE_Direct RE_Direct_Stylized')).toBeLessThan(
      fs.indexOf('#include <lights_fragment_begin>'),
    );
    // The finish runs before the output is written, the highlight clamp leaving emission out.
    expect(fs.indexOf('vbSurface = min( vbSurface, vbAlbedoMax )')).toBeLessThan(
      fs.indexOf('#include <opaque_fragment>'),
    );
  });

  it('a non-standard program cannot be patched silently', () => {
    expect(() => {
      patchStylizedShader({ fragmentShader: 'void main() {}' });
    }).toThrow(/no #include/);
  });

  it('clones keep the stylized lighting, the wetness, the mask and the extension', () => {
    const extension = { key: 'test', patch: () => undefined };
    const material = new StylizedMaterial({ wetness: 0.5, maskMap: texture(), extension });
    const copy = material.clone();
    expect(copy).toBeInstanceOf(StylizedMaterial);
    expect(copy.wetness).toBe(0.5);
    expect(copy.maskMap).toBe(material.maskMap);
    expect(copy.extension).toBe(extension);
    expect(copy.customProgramCacheKey()).toBe(material.customProgramCacheKey());
    copy.wetness = 1;
    expect(material.wetness).toBe(0.5);
    copy.wetness = 7;
    expect(copy.wetness).toBe(1);
  });

  it('one program per feature set: presets and wetness are uniforms, only a mask or extension changes the key', () => {
    const plain = new StylizedMaterial({ color: 0xff0000 });
    const other = new StylizedMaterial({ color: 0x00ff00, wetness: 1 });
    expect(other.customProgramCacheKey()).toBe(plain.customProgramCacheKey());
    useStylizedPreset('night');
    expect(stylizedPreset()).toBe('night');
    expect(plain.customProgramCacheKey()).toBe(other.customProgramCacheKey());
    const masked = new StylizedMaterial({ maskMap: texture() });
    expect(masked.customProgramCacheKey()).not.toBe(plain.customProgramCacheKey());
    const before = masked.version;
    masked.maskMap = texture(); // swapping one mask for another keeps the program
    expect(masked.version).toBe(before);
    masked.maskMap = null;
    expect(masked.version).toBeGreaterThan(before);
  });

  it('compiles with the shared and own uniforms, and a mask turns on its define and the uv', () => {
    const material = new StylizedMaterial({ maskMap: texture() });
    const shader = {
      uniforms: {},
      defines: {},
      vertexShader: ShaderLib.physical.vertexShader,
      fragmentShader: ShaderLib.physical.fragmentShader,
    } as unknown as Parameters<StylizedMaterial['onBeforeCompile']>[0];
    material.onBeforeCompile(shader);
    expect(Object.keys(shader.uniforms)).toEqual(
      expect.arrayContaining(['vbShadowTint', 'vbRimColour', 'vbWetness', 'vbMaskMap']),
    );
    expect(shader.defines).toMatchObject({ USE_VB_MASKMAP: '', USE_UV: '' });
  });

  it('AC-4: Low hides normal maps from the shader and High brings them back', () => {
    const normal = texture();
    const material = new StylizedMaterial({ normalMap: normal });
    expect(material.normalMap).toBe(normal);
    const version = material.version;
    setStylizedQuality('low');
    expect(material.normalMap).toBeNull();
    expect(material.version).toBeGreaterThan(version);
    const madeOnLow = new StylizedMaterial({ normalMap: normal });
    expect(madeOnLow.normalMap).toBeNull();
    expect(madeOnLow.clone().normalMap).toBeNull();
    setStylizedQuality('low'); // no change, no recompile
    setStylizedQuality('high');
    expect(material.normalMap).toBe(normal);
    expect(madeOnLow.normalMap).toBe(normal);
    madeOnLow.setNormalMap(null);
    expect(madeOnLow.normalMap).toBeNull();
  });

  it('a loaded PBR material becomes stylized with its maps; others pass through', () => {
    const map = texture();
    const pbr = new MeshStandardMaterial({ color: 0x336699, map, metalness: 1, roughness: 0.2 });
    const stylized = stylizeMaterial(pbr) as StylizedMaterial;
    expect(isStylized(stylized)).toBe(true);
    expect(stylized.map).toBe(map);
    expect(stylized.color.getHex()).toBe(0x336699);
    expect(stylized.metalness).toBe(0);
    expect(stylizeMaterial(stylized)).toBe(stylized);
    const group = new Group();
    expect(stylizeMaterial(group as never)).toBe(group);
  });
});
