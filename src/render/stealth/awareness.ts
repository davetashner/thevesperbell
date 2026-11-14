// Three.js drawing of the awareness feedback (mw-e29.12): the billboard indicator over a creature
// (an ink-edged silhouette of its state's shape, filled from the bottom), the last-known-position
// ghost (a faint standing figure on a ground ring) and the noise ripple (a thin ring flat on the
// ground). The game side (src/game/vfx/awareness-fx.ts) decides what exists, where and how strong;
// this only places pooled objects, so nothing is allocated per frame once warm. Fill geometries are
// cached per shape and quantised fill, so a creature's suspicion rising costs a lookup, not a build.
//
// Everything is depth tested and never writes depth: a creature behind a wall shows nothing a player
// could not see. The ripple is a thin alpha ring (additive washed out on pale stone); its rate is limited by the game side to the 2 Hz
// pulse ceiling.
//
// Render-only (needs a GPU context), so it is excluded from unit coverage and verified by the
// Playwright spec e2e/awareness.spec.ts; the shapes and rules it draws are unit tested in
// indicator-shapes.test.ts and src/game/vfx/awareness-fx.test.ts.

import {
  AdditiveBlending,
  CapsuleGeometry,
  Color,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  RingGeometry,
  Shape,
  ShapeGeometry,
  Vector2,
  type BufferGeometry,
  type Camera,
  type Scene,
} from 'three';
import {
  fillOutline,
  INDICATOR_BACKDROP,
  INDICATOR_INK,
  shapeOutline,
  type IndicatorShape,
  type Point2,
} from './indicator-shapes';

interface IndicatorItem {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly shape: IndicatorShape;
  readonly colour: number;
  readonly fill: number;
  readonly scale: number;
  readonly opacity: number;
}

interface GhostItem {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly colour: number;
  readonly opacity: number;
}

interface RippleItem {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly radius: number;
  readonly opacity: number;
}

/** What the renderer reads each frame (the game side's AwarenessFx view satisfies it). */
export interface AwarenessDrawSource {
  readonly indicators: readonly IndicatorItem[];
  readonly ghosts: readonly GhostItem[];
  readonly ripples: readonly RippleItem[];
}

export interface AwarenessRenderer {
  /** Brings every indicator, ghost and ripple up to date with this frame, facing `camera`. */
  draw(source: AwarenessDrawSource, camera: Camera): void;
  /** Removes the objects from the scene and frees their GPU resources. */
  dispose(): void;
}

/** Half-height of an indicator at scale 1, metres. */
export const INDICATOR_SIZE_M = 0.22;
/** The ink edge's size over the shape's, and how many steps a fill is quantised to. */
const INK_SCALE = 1.28;
const FILL_STEPS = 100;
const INDICATOR_POOL = 24;
const GHOST_POOL = 8;
const RIPPLE_POOL = 6;
const RENDER_ORDER = 1000;

function geometryOf(points: readonly Point2[]): BufferGeometry {
  return new ShapeGeometry(new Shape(points.map((p) => new Vector2(p.x, p.y))));
}

function material(colour: number, additive = false): MeshBasicMaterial {
  return new MeshBasicMaterial({
    color: colour,
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    toneMapped: false,
    ...(additive && { blending: AdditiveBlending }),
  });
}

interface IndicatorSlot {
  readonly group: Group;
  readonly ink: Mesh;
  readonly back: Mesh;
  readonly fill: Mesh;
}

interface GhostSlot {
  readonly group: Group;
  readonly body: Mesh;
  readonly ring: Mesh;
}

/** Builds the renderer and adds its objects to `scene`. */
export function createAwarenessRenderer(scene: Scene): AwarenessRenderer {
  const root = new Group();
  root.name = 'awareness';
  scene.add(root);
  const geometries: BufferGeometry[] = [];
  const keep = (g: BufferGeometry): BufferGeometry => {
    geometries.push(g);
    return g;
  };
  const shapes = new Map<IndicatorShape, BufferGeometry>();
  const fills = new Map<string, BufferGeometry>();
  const shapeGeometry = (shape: IndicatorShape): BufferGeometry => {
    let g = shapes.get(shape);
    if (g === undefined) shapes.set(shape, (g = keep(geometryOf(shapeOutline(shape)))));
    return g;
  };
  const fillGeometry = (shape: IndicatorShape, fill: number): BufferGeometry | undefined => {
    const step = Math.round(fill * FILL_STEPS);
    if (step <= 0) return undefined;
    if (step >= FILL_STEPS) return shapeGeometry(shape);
    const key = `${shape}:${String(step)}`;
    let g = fills.get(key);
    if (g === undefined) {
      const outline = fillOutline(shapeOutline(shape), step / FILL_STEPS);
      fills.set(key, (g = keep(geometryOf(outline))));
    }
    return g;
  };
  const colour = new Color();

  const indicators: IndicatorSlot[] = [];
  for (let i = 0; i < INDICATOR_POOL; i++) {
    const ink = new Mesh(undefined, material(INDICATOR_INK));
    const back = new Mesh(undefined, material(INDICATOR_BACKDROP));
    const fill = new Mesh(undefined, material(0xffffff));
    ink.renderOrder = RENDER_ORDER;
    back.renderOrder = RENDER_ORDER + 1;
    fill.renderOrder = RENDER_ORDER + 2;
    ink.scale.setScalar(INK_SCALE);
    const group = new Group();
    group.add(ink, back, fill);
    group.visible = false;
    root.add(group);
    indicators.push({ group, ink, back, fill });
  }

  const ghostBody = keep(new CapsuleGeometry(0.2, 0.85, 4, 12));
  const ghostRing = keep(new RingGeometry(0.32, 0.4, 32));
  ghostRing.rotateX(-Math.PI / 2);
  const ghosts: GhostSlot[] = [];
  for (let i = 0; i < GHOST_POOL; i++) {
    const body = new Mesh(ghostBody, material(0xffffff));
    const ring = new Mesh(ghostRing, material(0xffffff));
    body.position.y = 0.625;
    body.renderOrder = ring.renderOrder = RENDER_ORDER;
    const group = new Group();
    group.add(body, ring);
    group.visible = false;
    root.add(group);
    ghosts.push({ group, body, ring });
  }

  // A unit ring: thin, scaled to the ripple's radius, flat on the ground.
  const rippleGeometry = keep(new RingGeometry(0.9, 1, 64));
  rippleGeometry.rotateX(-Math.PI / 2);
  const ripples: Mesh[] = [];
  for (let i = 0; i < RIPPLE_POOL; i++) {
    const ring = new Mesh(rippleGeometry, material(0xefe2c4));
    ring.renderOrder = RENDER_ORDER;
    ring.visible = false;
    root.add(ring);
    ripples.push(ring);
  }

  return {
    draw(source, camera) {
      indicators.forEach((slot, i) => {
        const item = source.indicators[i];
        slot.group.visible = item !== undefined;
        if (item === undefined) return;
        slot.group.position.set(item.x, item.y, item.z);
        slot.group.quaternion.copy(camera.quaternion);
        slot.group.scale.setScalar(INDICATOR_SIZE_M * item.scale);
        const shape = shapeGeometry(item.shape);
        slot.ink.geometry = shape;
        slot.back.geometry = shape;
        const filled = fillGeometry(item.shape, item.fill);
        slot.fill.visible = filled !== undefined;
        if (filled !== undefined) slot.fill.geometry = filled;
        (slot.fill.material as MeshBasicMaterial).color.set(colour.set(item.colour));
        (slot.ink.material as MeshBasicMaterial).opacity = item.opacity * 0.9;
        (slot.back.material as MeshBasicMaterial).opacity = item.opacity * 0.75;
        (slot.fill.material as MeshBasicMaterial).opacity = item.opacity;
      });
      ghosts.forEach((slot, i) => {
        const item = source.ghosts[i];
        slot.group.visible = item !== undefined;
        if (item === undefined) return;
        slot.group.position.set(item.x, item.y, item.z);
        for (const [mesh, opacity] of [
          [slot.body, item.opacity * 0.45],
          [slot.ring, item.opacity],
        ] as const) {
          const m = mesh.material as MeshBasicMaterial;
          m.color.set(colour.set(item.colour));
          m.opacity = opacity;
        }
      });
      ripples.forEach((ring, i) => {
        const item = source.ripples[i];
        ring.visible = item !== undefined;
        if (item === undefined) return;
        ring.position.set(item.x, item.y + 0.05, item.z);
        ring.scale.set(item.radius, 1, item.radius);
        (ring.material as MeshBasicMaterial).opacity = item.opacity;
      });
    },
    dispose() {
      scene.remove(root);
      for (const g of geometries) g.dispose();
      root.traverse((object) => {
        if (object instanceof Mesh) (object.material as MeshBasicMaterial).dispose();
      });
    },
  };
}
