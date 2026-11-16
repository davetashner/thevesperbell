// The Gilded Tern's hold grating (render only): the generated model came out as blobby slats, so the
// hatch is built here from boxes: a coaming of four boards round the opening, a lattice of slats over a
// dark hold, and two bearers under them. 1.3 m by 1.0 m and 0.3 m high, standing on its spawn point
// like the model it replaces (dock-props.ts, PROP_MODELS['deck-grating']).

import {
  BoxGeometry,
  Color,
  Float32BufferAttribute,
  MeshStandardMaterial,
  type BufferGeometry,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { GlbModel } from '../models/glb';

const WIDTH = 1.3;
const DEPTH = 1.0;
const HEIGHT = 0.3;
const BOARD = 0.12;
const SLAT = 0.07;
const SLAT_GAP = 0.1;

const COAMING = 0x7b5a38;
const SLAT_WOOD = 0x9a7a4e;
const BEARER = 0x5e4429;
const HOLD = 0x15131b;

/** A box `w` x `h` x `d` with its centre at (x, y, z), painted `colour`. */
function box(
  w: number,
  h: number,
  d: number,
  x: number,
  y: number,
  z: number,
  colour: number,
): BufferGeometry {
  const geometry = new BoxGeometry(w, h, d);
  geometry.translate(x, y, z);
  const count = geometry.getAttribute('position').count;
  const rgb = new Color(colour);
  const colours = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) colours.set([rgb.r, rgb.g, rgb.b], i * 3);
  geometry.setAttribute('color', new Float32BufferAttribute(colours, 3));
  return geometry;
}

/** The grating, centred on x and z with its foot at y = 0. */
export function buildDeckGrating(): GlbModel {
  const parts: BufferGeometry[] = [];
  // The dark hold under the slats.
  parts.push(box(WIDTH - 2 * BOARD, 0.02, DEPTH - 2 * BOARD, 0, 0.05, 0, HOLD));
  // Coaming: long boards along x at the front and back, short boards between them at the ends.
  const half = HEIGHT / 2;
  parts.push(box(WIDTH, HEIGHT, BOARD, 0, half, (DEPTH - BOARD) / 2, COAMING));
  parts.push(box(WIDTH, HEIGHT, BOARD, 0, half, -(DEPTH - BOARD) / 2, COAMING));
  parts.push(box(BOARD, HEIGHT, DEPTH - 2 * BOARD, (WIDTH - BOARD) / 2, half, 0, COAMING));
  parts.push(box(BOARD, HEIGHT, DEPTH - 2 * BOARD, -(WIDTH - BOARD) / 2, half, 0, COAMING));
  // Two bearers across the opening, then the slats along it.
  const inner = WIDTH - 2 * BOARD;
  for (const z of [-0.22, 0.22]) parts.push(box(inner, 0.06, 0.06, 0, 0.15, z, BEARER));
  const slats = Math.floor((DEPTH - 2 * BOARD + SLAT_GAP) / (SLAT + SLAT_GAP));
  const span = slats * SLAT + (slats - 1) * SLAT_GAP;
  for (let i = 0; i < slats; i++) {
    const z = -span / 2 + SLAT / 2 + i * (SLAT + SLAT_GAP);
    parts.push(box(inner, 0.05, SLAT, 0, 0.2, z, SLAT_WOOD));
  }
  const geometry = mergeGeometries(parts);
  for (const part of parts) part.dispose();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return {
    geometry,
    material: new MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: true }),
  };
}
