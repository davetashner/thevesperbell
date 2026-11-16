// The procedural sky dome of an outdoor scene: one sphere around the camera, drawn first with no depth
// test, whose shader paints the sky gradient, the sun and moon, a star field and drifting clouds from
// the state src/render/sky/model.ts computes for the game minute. No image assets: everything is noise
// and maths, fixed per scene by its seed, so the look is the same every visit.
//
// The star field and cloud shapes are deterministic; only the twinkle and the cloud drift use the
// render clock (they are cosmetic). Painterly by design: soft cloud edges stepped into a few value
// bands, round star dots without bloom, a flat sun disc with a soft glow (style bible §3).
//
// Render-only (needs a GPU context), so it is excluded from unit coverage; the sky maths is unit
// tested in src/render/sky/model.test.ts and the drawing is checked by the harbour screenshots.

import {
  BackSide,
  Color,
  Mesh,
  ShaderMaterial,
  SphereGeometry,
  SRGBColorSpace,
  Vector2,
  Vector3,
  type Camera,
} from 'three';
import type { Rgb, SkyState } from './model';

/** Radius of the dome, m: inside the camera's far plane; it is drawn first, so size does not matter. */
const RADIUS = 150;

const vertexShader = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    vec4 world = modelMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const fragmentShader = /* glsl */ `
  uniform vec3 uZenith;
  uniform vec3 uHorizon;
  uniform vec3 uSunDir;
  uniform vec3 uMoonDir;
  uniform vec3 uSunColour;
  uniform vec3 uCloudColour;
  uniform float uNight;
  uniform float uTwilight;
  uniform float uStars;
  uniform float uClouds;
  uniform vec2 uWind;
  uniform float uSeed;
  uniform float uTime;
  varying vec3 vDir;

  float hash13(vec3 p) {
    p = fract(p * 0.1031 + uSeed * 0.0137);
    p += dot(p, p.zyx + 31.32);
    return fract((p.x + p.y) * p.z);
  }
  float hash12(vec2 p) {
    vec3 q = fract(vec3(p.xyx) * 0.1031 + uSeed * 0.0213);
    q += dot(q, q.yzx + 33.33);
    return fract((q.x + q.y) * q.z);
  }
  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), u.x),
               mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 5; i++) {
      v += a * noise(p);
      p = p * 2.03 + vec2(17.1, 9.3);
      a *= 0.5;
    }
    return v;
  }

  void main() {
    vec3 dir = normalize(vDir);
    float up = dir.y;

    // Gradient: horizon colour low, zenith high; below the horizon a darker band (never black).
    float h = clamp(up, 0.0, 1.0);
    vec3 col = mix(uHorizon, uZenith, pow(h, 0.55));
    col = mix(col, uHorizon * 0.55, smoothstep(0.0, -0.25, up));

    // Warm glow around the sun at dawn and dusk, a soft halo by day.
    float sunDot = dot(dir, uSunDir);
    float glow = pow(max(sunDot, 0.0), 8.0) * (0.25 + 0.6 * uTwilight) * (1.0 - uNight);
    col += uSunColour * glow * 0.5;

    // Stars: one candidate per cell of a direction grid, shown where the hash clears the density.
    if (uStars > 0.001 && up > 0.0) {
      vec3 p = dir * 140.0;
      vec3 cell = floor(p);
      float pick = hash13(cell);
      if (pick > 1.0 - 0.06 * uStars) {
        vec3 centre = cell + 0.5 + (vec3(hash13(cell + 1.7), hash13(cell + 3.1), hash13(cell + 5.3)) - 0.5) * 0.6;
        float d = length(p - centre);
        float size = mix(0.12, 0.28, hash13(cell + 7.9));
        float twinkle = 0.75 + 0.25 * sin(uTime * (1.0 + 2.0 * pick) + pick * 60.0);
        float star = smoothstep(size, 0.0, d) * twinkle * smoothstep(0.0, 0.25, up);
        col += vec3(0.95, 0.92, 1.0) * star * min(1.0, uStars * 1.6);
      }
    }

    // Sun and moon discs (behind the clouds).
    float sunDisc = smoothstep(0.9990, 0.9995, sunDot);
    col = mix(col, uSunColour * 1.15, sunDisc * (1.0 - uNight * 0.9));
    float moonDot = dot(dir, uMoonDir);
    float moonDisc = smoothstep(0.9992, 0.99965, moonDot);
    col = mix(col, vec3(0.86, 0.84, 0.95), moonDisc * uNight);
    col += vec3(0.5, 0.48, 0.62) * pow(max(moonDot, 0.0), 40.0) * 0.15 * uNight;

    // Clouds: fbm on a plane overhead, drifting with the wind; stepped into soft value bands for a
    // painted look (a light touch: hard bands read as contour lines up close), thinning towards the
    // horizon so the backdrop reads.
    if (uClouds > 0.001 && up > 0.0) {
      vec2 uv = dir.xz / (up + 0.18) * 2.6 + uWind * uTime * 0.01 + uSeed * 3.7;
      float n = fbm(uv);
      float edge = 0.66 - 0.4 * uClouds;
      float c = smoothstep(edge - 0.06, edge + 0.32, n);
      c = mix(c, floor(c * 3.0 + 0.5) / 3.0, 0.3); // a hint of painted value bands, soft edges
      float lit = 0.75 + 0.25 * fbm(uv * 1.7 + uSunDir.xz);
      vec3 cloud = uCloudColour * lit + uSunColour * pow(max(sunDot, 0.0), 6.0) * 0.25 * (1.0 - uNight);
      col = mix(col, cloud, c * 0.9 * smoothstep(0.0, 0.18, up));
    }

    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }
`;

/** The linear colour three.js wants for an sRGB 0–1 triple. */
function linear(rgb: Rgb, out: Color): Color {
  return out.setRGB(rgb[0], rgb[1], rgb[2], SRGBColorSpace);
}

export interface SkyDomeView {
  readonly mesh: Mesh;
  /** Shows `state` (the sky at the current game minute). */
  update(state: SkyState): void;
  dispose(): void;
}

/** A sky dome mesh to add to the scene; call `update` whenever the game minute or sky colour changes. */
export function createSkyDome(now: () => number = () => performance.now() / 1000): SkyDomeView {
  const uniforms = {
    uZenith: { value: new Color() },
    uHorizon: { value: new Color() },
    uSunDir: { value: new Vector3(0, 1, 0) },
    uMoonDir: { value: new Vector3(0, -1, 0) },
    uSunColour: { value: new Color() },
    uCloudColour: { value: new Color() },
    uNight: { value: 0 },
    uTwilight: { value: 0 },
    uStars: { value: 0 },
    uClouds: { value: 0 },
    uWind: { value: new Vector2(0, 1) },
    uSeed: { value: 1 },
    uTime: { value: 0 },
  };
  const material = new ShaderMaterial({
    uniforms,
    vertexShader,
    fragmentShader,
    side: BackSide,
    depthTest: false,
    depthWrite: false,
    fog: false,
  });
  const mesh = new Mesh(new SphereGeometry(RADIUS, 48, 24), material);
  mesh.name = 'sky-dome';
  mesh.renderOrder = -2000; // before the painted backdrop (-1000) and the level
  mesh.frustumCulled = false;
  mesh.onBeforeRender = (_renderer, _scene, camera: Camera) => {
    mesh.position.copy(camera.position);
    mesh.updateMatrixWorld();
    uniforms.uTime.value = now();
  };
  return {
    mesh,
    update(state) {
      linear(state.zenith, uniforms.uZenith.value);
      linear(state.horizon, uniforms.uHorizon.value);
      linear(state.sunColour, uniforms.uSunColour.value);
      linear(state.cloudColour, uniforms.uCloudColour.value);
      uniforms.uSunDir.value.set(...state.sun);
      uniforms.uMoonDir.value.set(...state.moon);
      uniforms.uNight.value = state.night;
      uniforms.uTwilight.value = state.twilight;
      uniforms.uStars.value = state.stars;
      uniforms.uClouds.value = state.clouds;
      uniforms.uWind.value.set(state.wind[0], state.wind[1]);
      uniforms.uSeed.value = state.seed;
    },
    dispose() {
      mesh.removeFromParent();
      mesh.geometry.dispose();
      material.dispose();
    },
  };
}
