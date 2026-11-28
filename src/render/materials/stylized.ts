// The shared stylized lit material (mw-e37.13, style bible §3 and §6.1): every surface in the game is
// lit by it, so kits, generated models and painted textures read as one world. It is a
// MeshStandardMaterial whose direct lighting is replaced by a soft three-band ramp; shadows lean toward
// dusk and are lifted off black in proportion to the ambient fill (a dark room stays dark, §3
// gameplay-true lighting); a rim light in the preset's key colour picks out silhouettes; lit surfaces
// clamp below cream. The only specular is the wet sheen. Optional masks (an ORM-style texture: R
// ambient occlusion, G where wetness shows, B where the emissive colour glows) and a colour-grade LUT
// hook complete it.
//
// One program per feature set: every preset parameter is a uniform shared by all stylized materials
// (switching preset never recompiles), and the cache key adds only whether a mask is bound and the
// optional extension's key. A subclass rather than an onBeforeCompile on an instance, so clone() (the
// element looks clone materials) keeps the stylized lighting and its own wetness.
//
// Scene swaps: a swap's releaseUploads() disposes these materials and the shared LUT texture on the
// GPU; three uploads them again on their next draw, and the shared uniform objects stay valid, so
// nothing here holds a renderer or assumes a fresh one.
//
// Render-only (needs a GPU to draw), so it is excluded from unit coverage; the shader patch is checked
// headless in tests/integration/stylized-material.test.ts and drawn in e2e/stylized-material.spec.ts.

import {
  Color,
  DataTexture,
  LinearFilter,
  MeshStandardMaterial,
  RGBAFormat,
  type Material,
  type MeshStandardMaterialParameters,
  type Texture,
  type WebGLProgramParametersWithUniforms,
} from 'three';
import {
  PALETTE,
  STYLIZED_PRESETS,
  WET_DARKEN,
  WET_SHEEN,
  type LightingPreset,
  type StylizedParams,
  type StylizedQuality,
} from './presets.ts';

/** A uniform as three reads it. */
interface Uniform<T> {
  value: T;
}

/** Size of the identity grading LUT along each axis (a 16×16×16 cube laid out as a 256×16 strip). */
const LUT_SIZE = 16;

/** The identity colour-grade LUT: sampling it returns the colour unchanged. */
function identityLut(): DataTexture {
  const data = new Uint8Array(LUT_SIZE * LUT_SIZE * LUT_SIZE * 4);
  for (let b = 0; b < LUT_SIZE; b++) {
    for (let g = 0; g < LUT_SIZE; g++) {
      for (let r = 0; r < LUT_SIZE; r++) {
        const i = (g * LUT_SIZE * LUT_SIZE + b * LUT_SIZE + r) * 4;
        data[i] = Math.round((r / (LUT_SIZE - 1)) * 255);
        data[i + 1] = Math.round((g / (LUT_SIZE - 1)) * 255);
        data[i + 2] = Math.round((b / (LUT_SIZE - 1)) * 255);
        data[i + 3] = 255;
      }
    }
  }
  const texture = new DataTexture(data, LUT_SIZE * LUT_SIZE, LUT_SIZE, RGBAFormat);
  texture.name = 'stylized-grade-identity';
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

/** Uniforms every stylized material shares: the preset, the palette limits and the grading hook. */
const shared = {
  vbShadowTint: { value: new Color() },
  vbShadowHue: { value: 0 },
  vbShadowLift: { value: 0 },
  vbRimColour: { value: new Color() },
  vbRimStrength: { value: 0 },
  vbRimPower: { value: 1 },
  vbBandEdges: { value: [0, 0] as number[] },
  vbBandSoftness: { value: 0 },
  vbBandLevels: { value: [0, 0, 0] as number[] },
  vbAlbedoMin: { value: new Color(PALETTE.ink) },
  vbAlbedoMax: { value: new Color(PALETTE.cream) },
  vbWetDarken: { value: WET_DARKEN },
  vbWetSheen: { value: WET_SHEEN },
  vbGradeLut: { value: null as Texture | null },
  vbGradeAmount: { value: 0 },
} satisfies Record<string, Uniform<unknown>>;

let currentPreset: LightingPreset = 'day';
let quality: StylizedQuality = 'high';
let lutTexture: DataTexture | undefined;

/** Puts `params` into the shared uniforms; every stylized material shows it on its next draw. */
function applyParams(params: StylizedParams): void {
  shared.vbShadowTint.value.setHex(params.shadowTint);
  shared.vbShadowHue.value = params.shadowHue;
  shared.vbShadowLift.value = params.shadowLift;
  shared.vbRimColour.value.setHex(params.rimColour);
  shared.vbRimStrength.value = params.rimStrength;
  shared.vbRimPower.value = params.rimPower;
  shared.vbBandEdges.value = [...params.bandEdges];
  shared.vbBandSoftness.value = params.bandSoftness;
  shared.vbBandLevels.value = [...params.bandLevels];
}
applyParams(STYLIZED_PRESETS[currentPreset]);

/** Lights every stylized material by `preset` (style bible §3). No recompile. */
export function useStylizedPreset(preset: LightingPreset): void {
  currentPreset = preset;
  applyParams(STYLIZED_PRESETS[preset]);
}

/** The preset stylized materials are lit by. */
export function stylizedPreset(): LightingPreset {
  return currentPreset;
}

/**
 * The colour-grade hook (style bible §3, a LUT per location): `lut` is a 16³ cube laid out as a
 * 256×16 strip (blue picks the 16-pixel tile, red runs along it, green up it), blended in by `amount`.
 * Null turns grading off.
 */
export function setStylizedGrade(lut: Texture | null, amount = 1): void {
  shared.vbGradeLut.value = lut;
  shared.vbGradeAmount.value = lut === null ? 0 : Math.min(1, Math.max(0, amount));
}

/** Every live stylized material, so a quality change can recompile them. */
const live = new Set<WeakRef<StylizedMaterial>>();

/** Switches quality: Low drops normal maps (they are kept and come back on High). */
export function setStylizedQuality(next: StylizedQuality): void {
  if (next === quality) return;
  quality = next;
  for (const ref of [...live]) {
    const material = ref.deref();
    if (material === undefined) live.delete(ref);
    else if (material.stylizedNormalMap !== null) material.showNormalMap();
  }
}

/** The current quality. */
export function stylizedQuality(): StylizedQuality {
  return quality;
}

/**
 * A further shader patch a caller layers under the stylized lighting (the greybox grid and stone,
 * say). It runs before the stylized patch and must keep the chunk includes it hooks, and `key` must
 * change whenever the source it writes does (it joins the program cache key).
 */
export interface StylizedExtension {
  readonly key: string;
  patch(shader: WebGLProgramParametersWithUniforms): void;
}

export interface StylizedMaterialParameters extends MeshStandardMaterialParameters {
  /** 0 = dry … 1 = soaked: darker albedo and a sheen (driven by the element looks). */
  wetness?: number;
  /** ORM-style mask: R ambient occlusion, G where wetness shows, B where the emissive colour glows. */
  maskMap?: Texture | null;
  extension?: StylizedExtension;
}

/** Fragment declarations: the ramp and the stylized direct-light equation that replaces the physical one. */
const FRAGMENT_PARS = /* glsl */ `
uniform vec3 vbShadowTint;
uniform float vbShadowHue;
uniform float vbShadowLift;
uniform vec3 vbRimColour;
uniform float vbRimStrength;
uniform float vbRimPower;
uniform vec2 vbBandEdges;
uniform float vbBandSoftness;
uniform vec3 vbBandLevels;
uniform vec3 vbAlbedoMin;
uniform vec3 vbAlbedoMax;
uniform float vbWetness;
uniform float vbWetDarken;
uniform float vbWetSheen;
uniform sampler2D vbGradeLut;
uniform float vbGradeAmount;
#ifdef USE_VB_MASKMAP
  uniform sampler2D vbMaskMap;
#endif
float vbLit = 0.0;
float vbWet = 0.0;
float vbLuma( vec3 c ) { return dot( c, vec3( 0.2126, 0.7152, 0.0722 ) ); }
float vbRamp( float ndl ) {
  float a = smoothstep( vbBandEdges.x - vbBandSoftness, vbBandEdges.x + vbBandSoftness, ndl );
  float b = smoothstep( vbBandEdges.y - vbBandSoftness, vbBandEdges.y + vbBandSoftness, ndl );
  return mix( vbBandLevels.x, mix( vbBandLevels.y, vbBandLevels.z, b ), a );
}
void RE_Direct_Stylized( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
  float ramp = vbRamp( dot( geometryNormal, directLight.direction ) );
  reflectedLight.directDiffuse += ramp * directLight.color * BRDF_Lambert( material.diffuseColor );
  vbLit = min( 1.0, vbLit + ramp * min( 1.0, vbLuma( directLight.color ) ) );
  vec3 halfDir = normalize( directLight.direction + geometryViewDir );
  float spec = pow( saturate( dot( geometryNormal, halfDir ) ), 48.0 );
  reflectedLight.directSpecular += directLight.color * smoothstep( 0.3, 0.6, spec ) * ramp * vbWetSheen * vbWet;
}
#undef RE_Direct
#define RE_Direct RE_Direct_Stylized
vec3 vbGrade( vec3 c ) {
  vec3 s = clamp( c, 0.0, 1.0 ) * ${(LUT_SIZE - 1).toFixed(1)};
  float b0 = floor( s.b );
  float b1 = min( b0 + 1.0, ${(LUT_SIZE - 1).toFixed(1)} );
  vec2 uv = ( vec2( s.r, s.g ) + 0.5 ) / vec2( ${(LUT_SIZE * LUT_SIZE).toFixed(1)}, ${LUT_SIZE.toFixed(1)} );
  vec3 g0 = texture2D( vbGradeLut, uv + vec2( b0 / ${LUT_SIZE.toFixed(1)}, 0.0 ) ).rgb;
  vec3 g1 = texture2D( vbGradeLut, uv + vec2( b1 / ${LUT_SIZE.toFixed(1)}, 0.0 ) ).rgb;
  return mix( g0, g1, s.b - b0 );
}
`;

/** After the albedo is known: clamp it to the palette, sample the mask, darken when wet. */
const ALBEDO = /* glsl */ `
#ifdef USE_VB_MASKMAP
  vec4 vbMask = texture2D( vbMaskMap, vUv );
#else
  vec4 vbMask = vec4( 1.0 );
#endif
vbWet = saturate( vbWetness ) * vbMask.g;
diffuseColor.rgb = clamp( diffuseColor.rgb, vbAlbedoMin, vbAlbedoMax ) * ( 1.0 - vbWetDarken * vbWet );
`;

/** The mask's B channel gates the emissive colour (glyphs, magic). */
const EMISSIVE = /* glsl */ `
totalEmissiveRadiance *= vbMask.b;
`;

/** The mask's R channel occludes the ambient fill. */
const OCCLUSION = /* glsl */ `
reflectedLight.indirectDiffuse *= vbMask.r;
`;

/** The finish: rim, shadow tint and lift, highlight clamp (emission excepted), then the grade. */
const FINISH = /* glsl */ `
{
  vec3 vbSurface = outgoingLight - totalEmissiveRadiance;
  float vbShade = 1.0 - vbLit;
  // The fill's irradiance against a daylit fill of 0.25: full lift in daylight, little in a dark room.
  float vbAmbient = min( 1.0, PI * vbLuma( reflectedLight.indirectDiffuse ) / max( vbLuma( diffuseColor.rgb ), 1e-4 ) / 0.25 );
  float vbNdv = saturate( dot( normal, geometryViewDir ) );
  float vbRim = pow( 1.0 - vbNdv, vbRimPower ) * vbRimStrength * ( 0.3 + 0.7 * vbLit ) * max( vbAmbient, vbLit );
  vbSurface += vbRimColour * vbRim * mix( vec3( 1.0 ), diffuseColor.rgb, 0.5 );
  vec3 vbHue = vbShadowTint / max( max3( vbShadowTint ), 1e-4 );
  vbSurface = mix( vbSurface, vbSurface * vbHue, vbShade * vbShadowHue );
  // A soft floor: black rises to the tint, brighter texels keep their contrast (a smooth max).
  vec3 vbFloor = vbShadowTint * vbShadowLift * vbAmbient * vbShade;
  vbSurface = sqrt( vbSurface * vbSurface + vbFloor * vbFloor );
  vbSurface = min( vbSurface, vbAlbedoMax );
  outgoingLight = vbSurface + totalEmissiveRadiance;
  if ( vbGradeAmount > 0.0 ) outgoingLight = mix( outgoingLight, vbGrade( outgoingLight ), vbGradeAmount );
}
`;

/** Replaces `include` in `source` with itself followed (or preceded) by `code`; throws if it is missing. */
function inject(source: string, include: string, code: string, before = false): string {
  const marker = `#include <${include}>`;
  if (!source.includes(marker)) throw new Error(`stylized material: no ${marker} to patch`);
  return source.replace(marker, before ? `${code}\n${marker}` : `${marker}\n${code}`);
}

/** Applies the stylized lighting to a MeshStandardMaterial program's shaders. Exported for tests. */
export function patchStylizedShader(shader: { fragmentShader: string }): void {
  let fs = shader.fragmentShader;
  fs = inject(fs, 'lights_physical_pars_fragment', FRAGMENT_PARS);
  fs = inject(fs, 'alphamap_fragment', ALBEDO, true);
  fs = inject(fs, 'emissivemap_fragment', EMISSIVE);
  fs = inject(fs, 'aomap_fragment', OCCLUSION);
  fs = inject(fs, 'opaque_fragment', FINISH, true);
  shader.fragmentShader = fs;
}

/** The shared stylized lit material. Use it (or `toStylized`) for every mesh. */
export class StylizedMaterial extends MeshStandardMaterial {
  readonly isStylizedMaterial = true;
  /** This material's own uniforms (the rest are shared). */
  readonly vbUniforms: { vbWetness: Uniform<number>; vbMaskMap: Uniform<Texture | null> };
  /** A further patch under the stylized lighting, if any. */
  extension: StylizedExtension | undefined;
  /** The normal map, kept while Low quality hides it from the shader. */
  stylizedNormalMap: Texture | null;

  constructor(parameters: StylizedMaterialParameters = {}) {
    const { wetness, maskMap, extension, normalMap, ...standard } = parameters;
    super({ roughness: 0.9, metalness: 0, ...standard });
    this.vbUniforms = { vbWetness: { value: wetness ?? 0 }, vbMaskMap: { value: maskMap ?? null } };
    this.extension = extension;
    this.stylizedNormalMap = normalMap ?? null;
    this.normalMap = quality === 'high' ? this.stylizedNormalMap : null;
    live.add(new WeakRef(this));
  }

  /** 0 = dry … 1 = soaked. Takes effect on the next frame; no recompile. */
  get wetness(): number {
    return this.vbUniforms.vbWetness.value;
  }

  set wetness(value: number) {
    this.vbUniforms.vbWetness.value = Math.min(1, Math.max(0, value));
  }

  /** The ORM-style mask. Binding or unbinding one recompiles (it changes the program). */
  get maskMap(): Texture | null {
    return this.vbUniforms.vbMaskMap.value;
  }

  set maskMap(texture: Texture | null) {
    if ((texture === null) !== (this.vbUniforms.vbMaskMap.value === null)) this.needsUpdate = true;
    this.vbUniforms.vbMaskMap.value = texture;
  }

  /** Sets the normal map (shown on High only). */
  setNormalMap(texture: Texture | null): void {
    this.stylizedNormalMap = texture;
    this.showNormalMap();
  }

  /** Shows the kept normal map when the quality allows it (Low never samples one, AC-4). */
  showNormalMap(): void {
    const wanted = quality === 'high' ? this.stylizedNormalMap : null;
    if (this.normalMap === wanted) return;
    this.normalMap = wanted;
    this.needsUpdate = true;
  }

  override onBeforeCompile(shader: WebGLProgramParametersWithUniforms): void {
    this.extension?.patch(shader);
    Object.assign(shader.uniforms, shared, this.vbUniforms);
    if (this.maskMap !== null) {
      shader.defines = { ...shader.defines, USE_VB_MASKMAP: '', USE_UV: '' };
    }
    patchStylizedShader(shader);
  }

  override customProgramCacheKey(): string {
    return ['vb-stylized', this.maskMap === null ? '' : 'mask', this.extension?.key ?? ''].join(
      '|',
    );
  }

  override copy(source: MeshStandardMaterial): this {
    super.copy(source);
    if (isStylized(source)) {
      this.vbUniforms.vbWetness.value = source.vbUniforms.vbWetness.value;
      this.vbUniforms.vbMaskMap.value = source.vbUniforms.vbMaskMap.value;
      this.extension = source.extension;
      this.stylizedNormalMap = source.stylizedNormalMap;
      this.normalMap = quality === 'high' ? this.stylizedNormalMap : null;
    }
    return this;
  }
}

/** Whether `material` is a stylized material. */
export function isStylized(material: unknown): material is StylizedMaterial {
  return (material as { isStylizedMaterial?: boolean } | null)?.isStylizedMaterial === true;
}

/**
 * A stylized material carrying `source`'s colour, maps, emissive and transparency (a GLB's PBR
 * material, say). Metal and roughness maps are dropped: the stylized look has no PBR specular. A
 * stylized source is returned as is.
 */
export function toStylized(source: MeshStandardMaterial): StylizedMaterial {
  if (isStylized(source)) return source;
  const material = new StylizedMaterial({
    name: source.name,
    color: source.color,
    map: source.map,
    normalMap: source.normalMap,
    normalScale: source.normalScale.clone(),
    emissive: source.emissive,
    emissiveMap: source.emissiveMap,
    emissiveIntensity: source.emissiveIntensity,
    aoMap: source.aoMap,
    aoMapIntensity: source.aoMapIntensity,
    alphaMap: source.alphaMap,
    alphaTest: source.alphaTest,
    transparent: source.transparent,
    opacity: source.opacity,
    side: source.side,
    vertexColors: source.vertexColors,
    flatShading: source.flatShading,
  });
  return material;
}

/** The shared identity LUT, made on first use (a test page can grade with it to check the hook). */
export function identityGradeLut(): DataTexture {
  lutTexture ??= identityLut();
  return lutTexture;
}

/** `material` as a stylized material when it is a standard (PBR) one, a loaded GLB's say; others pass through. */
export function stylizeMaterial(material: Material): Material {
  return (material as Partial<MeshStandardMaterial>).isMeshStandardMaterial === true
    ? toStylized(material as MeshStandardMaterial)
    : material;
}
