// Rendered light from the sim's light field (mw-e03.37). The sim decides how lit every position is
// (src/sim/light); this only mirrors it, so what looks lit is what guards see (style bible §3,
// "gameplay-true lighting"). Nothing here feeds back into the sim.
//
// - Same falloff: a sim emitter of level L and reach R lights distance d with L × (1 − d/R)². Three's
//   point and spot lights use a different window, so `useSimFalloff` patches the light shader chunks:
//   lights with decay 0 and a distance use the sim's curve. Only this rig makes such lights.
// - No angle term: the sim's level is the light arriving at a position from any direction, so a
//   floor lit at a grazing angle by a fire on the ground is as lit, for stealth, as one right under a
//   lamp. The same patch divides these lights' contribution by the surface's cos(incidence) (down to
//   0.1, about 84°): a surface facing the light at all shows the sim's level. Surfaces facing away
//   stay unlit.
// - Same brightness: every rendered light gets `renderIntensity(level, colour)`, the sim level scaled
//   by LIGHT_SCALE and divided by the colour's luminance, so a warm torch and a white moon of the same
//   sim level brighten a surface equally. The greybox's hemisphere fill and key light use the same
//   mapping for the field's ambient level and directional lights.
// - Pools that only grow: the style bible allows ≤ 8 dynamic point lights per pixel on High (≤ 4 on
//   Low) and no shadow-casting point lights. Every light in the scene costs every lit fragment, even
//   at intensity 0, and adding or removing one recompiles every material. So the rig starts empty (a
//   scene with no emitters pays nothing) and grows its pools in steps of POOL_STEP up to the caps
//   (6 point + 2 spot by default) the first time more emitters are lit at once; it never shrinks, so
//   materials recompile at most a few times per session. Unused lights sit at intensity 0. The game
//   picks which emitters fill it (src/game/light selectLights).
//
// Point lights cast no shadows (budget), so a wall between a torch and a floor darkens that floor in
// the sim but not on screen; see the follow-up bead noted in the PR.
//
// Render-only (needs a GPU context): excluded from unit coverage, verified by e2e/lighting.spec.ts.

import type { EntityId, LightEmitterView } from '@sim/index';
import {
  Color,
  Mesh,
  MeshBasicMaterial,
  PointLight,
  ShaderChunk,
  SphereGeometry,
  SpotLight,
  type Scene,
} from 'three';

/** Render intensity per unit of sim light level, for a colour of luminance 1. */
export const LIGHT_SCALE = 3.5;

/** Style bible torch colour (§3 Interior/underground key): fire. */
const FIRE_COLOUR = new Color(0xf08a3c);
/** Style bible `hearth`: lamps, lanterns and other non-fire emitters. */
const LAMP_COLOUR = new Color(0xe8a24a);

/** Relative luminance of a (linear) colour. */
function luminance(colour: Color): number {
  return 0.2126 * colour.r + 0.7152 * colour.g + 0.0722 * colour.b;
}

/** The render intensity that makes a light of `colour` as bright as sim level `level`. */
export function renderIntensity(level: number, colour: Color): number {
  return (LIGHT_SCALE * level) / Math.max(luminance(colour), 1e-3);
}

const WINDOW =
  'distanceFalloff *= pow2( saturate( 1.0 - pow4( lightDistance / cutoffDistance ) ) );';
const SIM_FALLOFF = [
  'if ( decayExponent == 0.0 ) {',
  '\t\t\tdistanceFalloff *= pow2( saturate( 1.0 - lightDistance / cutoffDistance ) );',
  '\t\t} else {',
  `\t\t\t${WINDOW}`,
  '\t\t}',
].join('\n');

const POINT_INFO = 'getPointLightInfo( pointLight, geometryPosition, directLight );';
const SPOT_INFO = 'getSpotLightInfo( spotLight, geometryPosition, directLight );';
/** Cancels the diffuse cos(incidence) for sim lights (decay 0), down to a cos of 0.1. */
const noAngle = (light: string): string =>
  `if ( ${light}.decay == 0.0 ) directLight.color /= max( dot( geometryNormal, directLight.direction ), 0.1 );`;

function patch(
  name: 'lights_pars_begin' | 'lights_fragment_begin',
  from: string,
  to: string,
): void {
  const chunk = ShaderChunk[name];
  if (chunk.includes(to)) return;
  if (!chunk.includes(from)) {
    throw new Error(`three.js ${name} chunk changed: update useSimFalloff (mw-e03.37)`);
  }
  ShaderChunk[name] = chunk.replace(from, to);
}

/**
 * Makes lights with decay 0 and a distance light surfaces exactly like the sim's emitters: the sim's
 * falloff and no angle term (see the file header). Idempotent; call before the first frame compiles
 * any material. Throws when Three's chunks changed shape (an upgrade), so a mismatch cannot pass
 * silently.
 */
export function useSimFalloff(): void {
  patch('lights_pars_begin', WINDOW, SIM_FALLOFF);
  patch('lights_fragment_begin', POINT_INFO, `${POINT_INFO}\n\t\t${noAngle('pointLight')}`);
  patch('lights_fragment_begin', SPOT_INFO, `${SPOT_INFO}\n\t\t${noAngle('spotLight')}`);
}

/** A sim emitter as the rig draws it. */
export interface RigLight extends LightEmitterView {
  /** A burning thing (torch colour and a flame), else a lamp. */
  readonly fire: boolean;
  /** Colour the scene gave this light ([r, g, b] 0-1, mw-ju8.43); else flame or lamp colour. */
  readonly tint?: readonly [number, number, number] | undefined;
}

export interface LightRigOptions {
  /** Most point lights the pool grows to (default 6). */
  readonly points?: number;
  /** Most spotlights the pool grows to (default 2). */
  readonly spots?: number;
}

/** Lights added at a time when a pool grows (each growth recompiles every lit material). */
export const POOL_STEP = 2;

/** The pool size that holds `wanted` lights: whole steps, never below `size`, at most `cap`. */
export function grownPool(size: number, wanted: number, cap: number): number {
  if (wanted <= size) return size;
  return Math.min(cap, Math.ceil(wanted / POOL_STEP) * POOL_STEP);
}

export interface LightRig {
  /** Most lights of each kind the rig draws, for the game's selection. */
  readonly caps: { readonly points: number; readonly spots: number };
  /**
   * Draws exactly these lights (at most the caps; extras are ignored), growing the pools if they
   * are too small, and switches the rest off. Returns the intensity drawn for each emitting entity.
   */
  sync(points: readonly RigLight[], spots: readonly RigLight[]): ReadonlyMap<EntityId, number>;
  dispose(): void;
}

const FLAME_RADIUS = 0.07;

/** Adds the fixed light pools to `scene`. */
export function createLightRig(scene: Scene, options: LightRigOptions = {}): LightRig {
  useSimFalloff();
  const flameGeometry = new SphereGeometry(FLAME_RADIUS, 8, 6);
  const flameMaterial = new MeshBasicMaterial({ color: FIRE_COLOUR });
  const caps = { points: options.points ?? 6, spots: options.spots ?? 2 };
  const points: { light: PointLight; flame: Mesh }[] = [];
  const spots: SpotLight[] = [];
  const grow = (wantedPoints: number, wantedSpots: number): void => {
    const pointCount = grownPool(points.length, wantedPoints, caps.points);
    while (points.length < pointCount) {
      const light = new PointLight(FIRE_COLOUR, 0, 1, 0);
      const flame = new Mesh(flameGeometry, flameMaterial);
      flame.visible = false;
      light.add(flame);
      scene.add(light);
      points.push({ light, flame });
    }
    const spotCount = grownPool(spots.length, wantedSpots, caps.spots);
    while (spots.length < spotCount) {
      const light = new SpotLight(LAMP_COLOUR, 0, 1, Math.PI / 4, 0, 0);
      scene.add(light, light.target);
      spots.push(light);
    }
  };

  const scratch = new Color();

  const place = (light: PointLight | SpotLight, source: RigLight, drawn: Map<EntityId, number>) => {
    const colour =
      source.tint !== undefined
        ? scratch.setRGB(source.tint[0], source.tint[1], source.tint[2])
        : source.fire
          ? FIRE_COLOUR
          : LAMP_COLOUR;
    const { x, y, z } = source.position;
    light.position.set(x, y, z);
    light.color.copy(colour);
    light.distance = source.radius;
    light.intensity = renderIntensity(source.level, colour);
    if (source.entity !== null) drawn.set(source.entity, light.intensity);
  };

  return {
    caps,
    sync(pointLights, spotLights) {
      grow(pointLights.length, spotLights.filter((light) => light.cone !== null).length);
      const drawn = new Map<EntityId, number>();
      points.forEach(({ light, flame }, i) => {
        const source = pointLights[i];
        flame.visible = source?.fire === true;
        if (source === undefined) {
          light.intensity = 0;
          return;
        }
        place(light, source, drawn);
      });
      spots.forEach((light, i) => {
        const source = spotLights[i];
        if (source?.cone == null) {
          light.intensity = 0;
          return;
        }
        place(light, source, drawn);
        const { direction, cosHalfAngle } = source.cone;
        // Three caps a spotlight's half-angle at 90°; wider sim cones light the whole hemisphere.
        light.angle = Math.min(Math.PI / 2, Math.acos(Math.min(1, Math.max(-1, cosHalfAngle))));
        light.target.position.set(
          light.position.x + direction.x,
          light.position.y + direction.y,
          light.position.z + direction.z,
        );
        light.target.updateMatrixWorld();
      });
      return drawn;
    },
    dispose() {
      for (const { light } of points) scene.remove(light);
      for (const light of spots) scene.remove(light, light.target);
      flameGeometry.dispose();
      flameMaterial.dispose();
    },
  };
}
