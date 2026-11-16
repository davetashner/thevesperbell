// The Gilded Tern's rope and ladders (render only): shrouds with ratline rungs from each mast's fighting top down
// to deadeyes on the bulwarks, stays between the mast heads, and a rope ladder up the climbable board
// on the mainmast. The generated mast module only supplies the mast, yards, sails and top (its rope is
// cut away, model-strips.ts); everything here is thin tubes (rope.ts) so it reads as rope.
//
// Where it goes follows each mast dressing (its base point and height): the fighting top sits a fixed
// fraction of the way up, the shrouds splay out to the bulwarks 4.3 m either side of the mast. The
// ladder's place is the grey-box climb board's, checked against the scene in
// tests/integration/tern-rigging.test.ts.

import { Mesh, MeshStandardMaterial } from 'three';
import type { SceneDressing } from '@sim/index';
import { fadeNearCamera } from './dressing';
import { ratlines, ropeGeometry, type Point, type Segment } from './rope';

/** The mast module whose rope is replaced. */
export const RIGGED_MODEL = 'model-ship-gilded-tern-rigging-01';
/** The dressing whose mast carries the climb ladder. */
export const CLIMB_MAST = 'tern-mainmast';

const TARRED = 0x4a3422;
const HEMP = 0xc2a266;
const IRON = 0x2c2a30;

/** The underside of the fighting top, as a fraction of the mast's height above its foot. */
const TOP_FRACTION = 0.66;
/** The mast head (where the stays tie on), as a fraction of the mast's height. */
const HEAD_FRACTION = 0.93;
/** Where the shrouds end: bulwark top height and its distance from the mast's centre line. */
export const CHAIN_PLATE_Y = 3.4;
export const CHAIN_PLATE_X = 4.3;
/** How far from the mast the shrouds start on the top, and how they spread along the ship. */
const TOP_HALF_BEAM = 1.3;
const TOP_SPREAD = 0.7;
const FOOT_SPREAD = 1.4;
const SHROUD_RADIUS = 0.07;
const RATLINE_RADIUS = 0.05;
const RUNGS = 9;
/** The climb ladder's offsets from the mainmast's base: just outside the board, and its width. */
export const LADDER_DX = 3.05;
export const LADDER_DZ = 0.25;
const LADDER_HALF_WIDTH = 0.3;
export const LADDER_TOP = 11.8;
const LADDER_RUNG_GAP = 0.5;

/** The dressing the boarding ladder on its port side and the ladder up out of its hold hang from. */
export const HULL_DRESSING = 'tern-hull';
/**
 * The hull ladder's offsets from the hull's base point: on the port side, level with the main hatch, its
 * rails 0.3 m either side of the grey-box ladder it replaces (x -5.25, z -6 from the hull's middle), and the
 * hold ladder under the main hatch (x 0, z +5.25). Checked against the scene in tests/integration/tern-dressing.test.ts.
 */
export const HULL_LADDER_DX = -5.25;
export const HULL_LADDER_DZ = -6;
export const HOLD_LADDER_DZ = 5.25;
/** Where those ladders end: the pool floor and the hold floor below, a hand above the bulwark and the deck. */
export const HULL_LADDER_FOOT = -6;
export const HULL_LADDER_TOP = 3.2;
export const HOLD_LADDER_FOOT = -1.5;
export const HOLD_LADDER_TOP = 3;
const RUNG_GAP = 0.5;
const RAIL_HALF_WIDTH = 0.3;

/**
 * A ladder of two tarred rails and hemp rungs, standing at (`x`, `z`) from `foot` to `top`; its rails
 * are spread along `across` (the axis the ladder is wide on).
 */
export function ladder(
  x: number,
  z: number,
  foot: number,
  top: number,
  across: 'x' | 'z',
): Segment[] {
  const dx = across === 'x' ? RAIL_HALF_WIDTH : 0;
  const dz = across === 'z' ? RAIL_HALF_WIDTH : 0;
  const left: readonly [Point, Point] = [
    [x - dx, foot, z - dz],
    [x - dx, top, z - dz],
  ];
  const right: readonly [Point, Point] = [
    [x + dx, foot, z + dz],
    [x + dx, top, z + dz],
  ];
  const rungs = Math.floor((top - foot) / RUNG_GAP);
  return [
    { a: left[0], b: left[1], radius: SHROUD_RADIUS, colour: TARRED },
    { a: right[0], b: right[1], radius: SHROUD_RADIUS, colour: TARRED },
    ...ratlines(left, right, rungs, 0.5 / rungs, RATLINE_RADIUS, HEMP),
  ];
}

/** The hull's two ladders: the boarding ladder down to the pool and the one up out of the hold. */
export function hullLadders(hull: SceneDressing): Segment[] {
  return [
    ...ladder(
      hull.at.x + HULL_LADDER_DX,
      hull.at.z + HULL_LADDER_DZ,
      HULL_LADDER_FOOT,
      HULL_LADDER_TOP,
      'z',
    ),
    ...ladder(hull.at.x, hull.at.z + HOLD_LADDER_DZ, HOLD_LADDER_FOOT, HOLD_LADDER_TOP, 'x'),
  ];
}

/** The shrouds and ratlines of the mast standing at `at`, `height` metres tall. */
export function shrouds(at: Point, height: number): Segment[] {
  const top = at[1] + TOP_FRACTION * height - 0.1;
  const out: Segment[] = [];
  for (const side of [-1, 1]) {
    const rope = (k: number): readonly [Point, Point] => [
      [at[0] + side * TOP_HALF_BEAM, top, at[2] + k * TOP_SPREAD],
      [at[0] + side * CHAIN_PLATE_X, CHAIN_PLATE_Y, at[2] + k * FOOT_SPREAD],
    ];
    const [fore, middle, aft] = [rope(-1), rope(0), rope(1)];
    const ropes = [fore, middle, aft];
    for (const [from, to] of ropes) {
      out.push({ a: from, b: to, radius: SHROUD_RADIUS, colour: TARRED });
      out.push({
        a: to,
        b: [to[0], to[1] + 0.22, to[2]],
        radius: 0.13,
        colour: IRON,
      });
    }
    out.push(...ratlines(fore, middle, RUNGS, 0.1, RATLINE_RADIUS, HEMP));
    out.push(...ratlines(middle, aft, RUNGS, 0.1, RATLINE_RADIUS, HEMP));
  }
  return out;
}

/** A stay from the head of the mast at `aft` to a point a little lower on the mast at `fore`. */
export function stay(aft: Point, aftHeight: number, fore: Point, foreHeight: number): Segment {
  return {
    a: [aft[0], aft[1] + HEAD_FRACTION * aftHeight, aft[2]],
    b: [fore[0], fore[1] + 0.78 * foreHeight, fore[2]],
    radius: SHROUD_RADIUS,
    colour: TARRED,
  };
}

/** The rope ladder up the climb board beside the mast standing at `at`. */
export function climbLadder(at: Point): Segment[] {
  const x = at[0] + LADDER_DX;
  const z = at[2] + LADDER_DZ;
  const foot = at[1] + 0.1;
  const left: readonly [Point, Point] = [
    [x, foot, z - LADDER_HALF_WIDTH],
    [x, LADDER_TOP, z - LADDER_HALF_WIDTH],
  ];
  const right: readonly [Point, Point] = [
    [x, foot, z + LADDER_HALF_WIDTH],
    [x, LADDER_TOP, z + LADDER_HALF_WIDTH],
  ];
  const rungs = Math.floor((LADDER_TOP - foot) / LADDER_RUNG_GAP);
  return [
    { a: left[0], b: left[1], radius: SHROUD_RADIUS, colour: TARRED },
    { a: right[0], b: right[1], radius: SHROUD_RADIUS, colour: TARRED },
    ...ratlines(left, right, rungs, 0.5 / rungs, RATLINE_RADIUS, HEMP),
  ];
}

/** All the rope of one mast, plus the stay forward to the next mast along the ship if it has one. */
export function mastRope(mast: SceneDressing, forward: SceneDressing | undefined): Segment[] {
  const at: Point = [mast.at.x, mast.at.y, mast.at.z];
  const out = shrouds(at, mast.size.y);
  if (forward !== undefined) {
    out.push(stay(at, mast.size.y, [forward.at.x, forward.at.y, forward.at.z], forward.size.y));
  }
  if (mast.id === CLIMB_MAST) out.push(...climbLadder(at));
  return out;
}

/** The rope meshes for the scene's rigged masts (one per mast), each fading like its mast does. */
export function loadRigging(dressings: readonly SceneDressing[]): Mesh[] {
  const masts = dressings.filter((d) => d.model === RIGGED_MODEL).sort((a, b) => a.at.z - b.at.z);
  const rope = (name: string, segments: readonly Segment[]): Mesh => {
    const mesh = new Mesh(
      ropeGeometry(segments),
      new MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true }),
    );
    mesh.name = `rigging:${name}`;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  };
  const meshes = masts.map((mast, i) => {
    const mesh = rope(mast.id, mastRope(mast, masts[i - 1]));
    if (mast.fadesNearCamera) fadeNearCamera(mesh);
    return mesh;
  });
  const hull = dressings.find((d) => d.id === HULL_DRESSING);
  if (hull !== undefined) meshes.push(rope(`${hull.id}-ladders`, hullLadders(hull)));
  return meshes;
}
