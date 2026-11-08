// The knight's models (mw-e37.21, mw-juy): the Tripo image-to-3D body of char-knight-base-01 skinned
// onto the animation rig, with the sword and shield as separate props on the rig's hands. Image-to-3D
// tools return static meshes facing +x, so each is turned and placed here: the body is turned to face
// −z (the rig's forward), stood on the ground and bound to the nearest grey-box bones (autoSkin), so
// the animation runtime poses it with no per-model skeleton; each prop is scaled, turned and fixed to
// one bone, so it moves exactly as that bone does.
//
// Render-only (needs a GPU context to draw), so it is excluded from unit coverage and verified by the
// Playwright testbed player e2e (e2e/testbed-player.spec.ts).

import {
  Bone,
  Group,
  type BufferGeometry,
  Mesh,
  Float32BufferAttribute,
  type Object3D,
  Vector3,
  Skeleton,
  SkinnedMesh,
  Uint16BufferAttribute,
} from 'three';
import {
  placeGeometry,
  readGlbMesh,
  turnAndGround,
  type GlbModel,
  type Placement,
} from '../models/glb';
import {
  autoSkin,
  bindRegion,
  fitSegments,
  restSegments,
  type GreyboxRig,
  type Pose,
  type Rig,
  type SegmentFit,
} from '../animation/index';
import { readBlade, type BladeReadout, type Point3 } from './blade';

/** Where the optimised models are served from (public/assets/model). */
export const KNIGHT_MODEL_URL = '/assets/model/model-char-knight-01.glb';

/** A mesh and its material, in the space its consumer expects. */
export type KnightModel = GlbModel;

/** How a held prop sits on its bone: a placement (see Placement) plus the file and the bone. */
export interface PropPlacement extends Placement {
  readonly url: string;
  /** The rig bone the prop is fixed to. */
  readonly bone: string;
}

/** A prop loaded and placed, ready to attach to `bone`. */
export interface KnightProp extends KnightModel {
  readonly bone: string;
}

/** The knight: the body, and whichever props loaded (a missing prop is left off, not fatal). */
export interface KnightAssets {
  readonly body: KnightModel;
  readonly props: readonly KnightProp[];
}

/** The sword, in the right hand (the rig's `sword` bone hangs from the right forearm). */
export const SWORD_PLACEMENT: PropPlacement = {
  url: '/assets/model/model-prop-arming-sword-01.glb',
  bone: 'sword',
  // Tripo leaves the sword tilted 37.3° in the y–z plane, hilt up and back: this stands it blade-down.
  rotateDeg: [37.3, 0, 0],
  length: 0.85,
  anchor: 'top',
  // The grip, not the pommel, sits in the hand: the body mesh's hand is 0.18 m outboard of the rig's
  // wrist and 0.08 m forward of it (the fitted forearm of KNIGHT_SEGMENT_FITS). The knight's sword bone
  // sits at that wrist (KNIGHT_WRIST), so only what is left of the offset is baked in here.
  offset: [0, 0.1, -0.01],
};

/**
 * Where the body mesh's wrist is, relative to the rig's: the sword bone is moved there for the knight
 * (mw-a6t), so turning it bends the wrist of the mesh's hand, not the rig's joint beside it. Added to
 * the bone's rest offset; SWORD_PLACEMENT bakes in the rest of the grip's offset, so at rest the sword
 * stays exactly where it was and every move's clip (none turns this bone) is unchanged.
 */
export const KNIGHT_WRIST: readonly [number, number, number] = [0.18, 0, -0.07];

/**
 * How much of the body mesh's right hand follows the sword bone: the fist (below y 0.90 and within
 * 0.14 m of the grip's axis) wholly, blending out to the forearm by y 0.98, so the hand and the sword
 * turn together at the wrist.
 */
export function knightHandShare(x: number, y: number, z: number): number {
  if (Math.hypot(x - 0.45, z + 0.07) > 0.14 || x < 0.34) return 0;
  return Math.min(1, Math.max(0, (0.98 - y) / 0.08));
}

/** The shield, on the left forearm. */
export const SHIELD_PLACEMENT: PropPlacement = {
  url: '/assets/model/model-prop-wooden-shield-01.glb',
  bone: 'forearm-l',
  // Tripo's shield faces +x with the boss toward +x: +90° about y turns it to face −z, like the body.
  rotateDeg: [0, 90, 0],
  length: 0.75,
  anchor: 'centre',
  offset: [-0.12, -0.1, -0.16],
};

/** Mirrors a fit from the right side to the left (x → −x, the left bone's name). */
function mirror(fit: SegmentFit): SegmentFit {
  const flip = (p: readonly [number, number, number]): [number, number, number] => [
    -p[0],
    p[1],
    p[2],
  ];
  return {
    ...fit,
    ...(fit.head === undefined ? {} : { head: flip(fit.head) }),
    ...(fit.tail === undefined ? {} : { tail: flip(fit.tail) }),
  };
}

const RIGHT_FITS: Readonly<Record<string, SegmentFit>> = {
  // Heights are the rig's joints (the bones pivot there); x follows the mesh, whose arms hang angled
  // out and whose legs stand apart, so the cloth at the body's sides is nearer the torso than a limb.
  'upper-arm-r': { head: [0.3, 1.52, 0], tail: [0.36, 1.22, 0], radius: 0.07, lateral: 0.2 },
  'forearm-r': { head: [0.36, 1.22, 0], tail: [0.46, 0.8, 0], radius: 0.09, lateral: 0.28 },
  'thigh-r': { head: [0.14, 0.92, 0], tail: [0.18, 0.48, 0], lateral: 0.1 },
  'shin-r': { head: [0.18, 0.48, 0], tail: [0.26, 0.04, 0], lateral: 0.1 },
};

/**
 * Where the knight mesh's limbs lie in its rest pose, per bone (a rig-space segment each; see
 * fitSegments). The tabard and belt between and beside them then stay with the torso bones.
 */
export const KNIGHT_SEGMENT_FITS: Readonly<Record<string, SegmentFit>> = Object.fromEntries(
  Object.entries(RIGHT_FITS).flatMap(([bone, fit]) => [
    [bone, fit],
    [bone.replace(/-r$/, '-l'), mirror(fit)],
  ]),
);

/** Loads the knight's body and puts it in rig space (feet at y = 0, facing −z). */
export async function loadKnightModel(url: string = KNIGHT_MODEL_URL): Promise<KnightModel> {
  const model = await readGlbMesh(url);
  // +90° about y: the mesh's +x (front) becomes −z.
  turnAndGround(model.geometry, 90);
  return model;
}

/** Loads a held prop and places it as `placement` says, in its bone's space. */
export async function loadKnightProp(placement: PropPlacement): Promise<KnightProp> {
  const { geometry, material } = await readGlbMesh(placement.url);
  placeGeometry(geometry, placement, placement.url);
  return { geometry, material, bone: placement.bone };
}

/**
 * Loads the knight: the body (required; rejects if it cannot load) and the sword and shield (each
 * optional: one that fails is left off).
 */
export async function loadKnight(): Promise<KnightAssets> {
  const [body, sword, shield] = await Promise.allSettled([
    loadKnightModel(),
    loadKnightProp(SWORD_PLACEMENT),
    loadKnightProp(SHIELD_PLACEMENT),
  ]);
  if (body.status === 'rejected') throw body.reason as Error;
  const props: KnightProp[] = [];
  for (const prop of [sword, shield]) {
    if (prop.status === 'fulfilled') props.push(prop.value);
    else console.warn('A knight prop did not load; leaving it off.', prop.reason);
  }
  return { body: body.value, props };
}

/** What differs between the characters one rig carries (see createKnightRig). */
export interface RigOptions {
  /** The root group's name (default `<rig>-knight`). */
  readonly name?: string;
  /** The body mesh's name (default `knight-mesh`). */
  readonly meshName?: string;
  /** Where the body's limbs lie, per bone (default the knight's). */
  readonly fits?: Readonly<Record<string, SegmentFit>>;
  /**
   * A wrist at the sword bone (the knight's): its rest offset is moved by `pivot`, and the vertices
   * `hand` gives a share of (0 to 1, see bindRegion) turn with it.
   */
  readonly wrist?: {
    readonly pivot: readonly [number, number, number];
    readonly hand: (x: number, y: number, z: number) => number;
  };
}

/**
 * The knight skinned to `rig`: a bone hierarchy at the rig's rest offsets (the same shape
 * createGreyboxRig builds) with the body mesh bound to it and each prop fixed to its bone. `apply` and
 * `lower` pose it exactly as the grey-box view, so either drives the same animation.
 */
export function createKnightRig(
  rig: Rig,
  assets: KnightAssets,
  options: RigOptions = {},
): GreyboxRig {
  const root = new Group();
  root.name = options.name ?? `${rig.id}-knight`;
  const bones: Bone[] = [];
  rig.defs.forEach((def, i) => {
    const bone = new Bone();
    bone.name = def.bone;
    const wrist = def.bone === 'sword' ? options.wrist?.pivot : undefined;
    bone.position.set(
      def.offset[0] + (wrist?.[0] ?? 0),
      def.offset[1] + (wrist?.[1] ?? 0),
      def.offset[2] + (wrist?.[2] ?? 0),
    );
    const parent = rig.parents[i] ?? -1;
    (parent < 0 ? root : (bones[parent] ?? root)).add(bone);
    bones.push(bone);
  });
  const geometry = assets.body.geometry.clone();
  const position = geometry.getAttribute('position');
  // The sword is its own prop, so no body vertex binds to the sword bone.
  const held = new Set<number>(rig.index.has('sword') ? [rig.index.get('sword') ?? -1] : []);
  const skin = autoSkin(
    position.array,
    fitSegments(restSegments(rig), rig.index, options.fits ?? KNIGHT_SEGMENT_FITS),
    held,
  );
  const sword = rig.index.get('sword');
  if (options.wrist !== undefined && sword !== undefined) {
    bindRegion(skin, position.array, sword, options.wrist.hand);
  }
  geometry.setAttribute('skinIndex', new Uint16BufferAttribute(skin.indices, 4));
  geometry.setAttribute('skinWeight', new Float32BufferAttribute(skin.weights, 4));
  const mesh = new SkinnedMesh(geometry, assets.body.material);
  mesh.name = options.meshName ?? 'knight-mesh';
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  // The bounding sphere is the bind pose's; poses swing the arms past it.
  mesh.frustumCulled = false;
  root.add(mesh);
  for (const prop of assets.props) {
    const bone = bones[rig.index.get(prop.bone) ?? -1];
    if (bone === undefined) continue;
    const propMesh = new Mesh(prop.geometry, prop.material);
    propMesh.name = `knight-${prop.bone}-prop`;
    propMesh.castShadow = true;
    propMesh.receiveShadow = true;
    bone.add(propMesh);
  }
  root.updateMatrixWorld(true);
  mesh.bind(new Skeleton(bones), mesh.matrixWorld);
  return {
    root,
    apply(pose: Pose) {
      for (let i = 0; i < bones.length; i++) {
        const o = i * 4;
        bones[i]?.quaternion.set(
          pose[o] ?? 0,
          pose[o + 1] ?? 0,
          pose[o + 2] ?? 0,
          pose[o + 3] ?? 1,
        );
      }
    },
    lower(metres) {
      const pelvis = bones[0];
      const rest = rig.defs[0]?.offset[1] ?? 0;
      if (pelvis !== undefined) pelvis.position.y = rest - metres;
    },
  };
}

/**
 * Where the knight's blade points now, in the body's space, or undefined while the knight model or
 * its sword has not loaded (mw-a6t). The grip and tip are the sword mesh's highest and lowest
 * vertices; the leg is the right hip, knee and ankle. Read by the page for the e2e; render-only.
 */
export function readPlayerBlade(body: Object3D): BladeReadout | undefined {
  const prop = body.getObjectByName('knight-sword-prop');
  const hip = body.getObjectByName('thigh-r');
  const knee = body.getObjectByName('shin-r');
  const elbow = body.getObjectByName('forearm-r');
  if (!(prop instanceof Mesh) || hip === undefined || knee === undefined || elbow === undefined)
    return undefined;
  const geometry = prop.geometry as BufferGeometry;
  geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  if (box === null) return undefined;
  body.updateMatrixWorld(true);
  const local = (object: Object3D, x: number, y: number, z: number): Point3 => {
    const v = body.worldToLocal(object.localToWorld(new Vector3(x, y, z)));
    return [v.x, v.y, v.z];
  };
  const cx = (box.min.x + box.max.x) / 2;
  const cz = (box.min.z + box.max.z) / 2;
  return readBlade(
    local(prop, cx, box.max.y, cz),
    local(prop, cx, box.min.y, cz),
    [local(hip, 0, 0, 0), local(knee, 0, 0, 0), local(knee, 0, -0.44, 0)],
    [local(elbow, 0, 0, 0), local(elbow, 0, -0.28, 0)],
  );
}
