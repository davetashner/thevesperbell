// The two screen-space helpers the magical materials share (mw-e29.7), each running only while
// something asks for it:
//
// - DistortionPass: a copy of the frame so far, taken once per frame just before the first heat haze
//   draws, which the haze samples with an offset. This is "the distortion pass": on Low nothing asks
//   for it, so it never runs.
// - SoftDepthPass: the opaque scene's depth at half resolution, drawn only while a soft particle
//   material is alive, so particles fade out where they meet a surface instead of cutting a hard line.
//
// Render-only; verified by tests/integration/magic-materials.test.ts (with a stand-in renderer) and
// e2e/magic-materials.spec.ts.

import {
  DepthTexture,
  FramebufferTexture,
  LinearFilter,
  MeshDepthMaterial,
  Vector2,
  WebGLRenderTarget,
  type Camera,
  type Object3D,
  type Scene,
  type Texture,
  type WebGLRenderer,
} from 'three';

/** The renderer calls the distortion pass makes (a stand-in can provide just these). */
export type DistortionRenderer = Pick<
  WebGLRenderer,
  'getDrawingBufferSize' | 'copyFramebufferToTexture'
> & { readonly info: { readonly render: { readonly frame: number } } };

/** Tells one outer frame from the next even when a pass renders nested frames of its own. */
export class FrameGate {
  #seen = -1;
  #serial = 0;

  /** A number that changes once per outer frame. */
  serial(renderer: { readonly info: { readonly render: { readonly frame: number } } }): number {
    const frame = renderer.info.render.frame;
    if (frame !== this.#seen) {
      this.#seen = frame;
      this.#serial++;
    }
    return this.#serial;
  }

  /** Call after rendering a nested frame, so it does not count as a new outer frame. */
  absorb(renderer: { readonly info: { readonly render: { readonly frame: number } } }): void {
    this.#seen = renderer.info.render.frame;
  }
}

const size = new Vector2();

export class DistortionPass {
  /** Frame copies taken so far: 0 for ever on Low. */
  runs = 0;
  readonly #gate: FrameGate;
  #texture: FramebufferTexture | undefined;
  #lastSerial = -1;

  constructor(gate: FrameGate) {
    this.#gate = gate;
  }

  /** The frame so far, copied at most once per frame; call from a haze mesh's onBeforeRender. */
  capture(renderer: DistortionRenderer): Texture {
    renderer.getDrawingBufferSize(size);
    const width = Math.max(1, Math.floor(size.x));
    const height = Math.max(1, Math.floor(size.y));
    let texture = this.#texture;
    if (texture?.image.width !== width || texture.image.height !== height) {
      texture?.dispose();
      texture = new FramebufferTexture(width, height);
      texture.minFilter = LinearFilter;
      texture.magFilter = LinearFilter;
      this.#texture = texture;
      this.#lastSerial = -1;
    }
    const serial = this.#gate.serial(renderer);
    if (serial !== this.#lastSerial) {
      this.#lastSerial = serial;
      renderer.copyFramebufferToTexture(texture);
      this.runs++;
    }
    return texture;
  }

  dispose(): void {
    this.#texture?.dispose();
    this.#texture = undefined;
  }
}

/** What the depth pass needs of a renderer. */
export type DepthRenderer = Pick<
  WebGLRenderer,
  'getDrawingBufferSize' | 'getRenderTarget' | 'setRenderTarget' | 'clear' | 'render'
> & {
  readonly info: { autoReset: boolean; readonly render: { readonly frame: number } };
  readonly shadowMap: { autoUpdate: boolean };
};

function drawnAsOpaque(object: Object3D): boolean {
  const flags = object as Partial<{
    isLine: boolean;
    isPoints: boolean;
    isSprite: boolean;
    material: { transparent: boolean; depthWrite: boolean } | { transparent: boolean }[];
  }>;
  if (flags.isLine === true || flags.isPoints === true || flags.isSprite === true) return false;
  const material = flags.material;
  if (material === undefined) return true;
  const list = Array.isArray(material) ? material : [material];
  return list.every((m) => !m.transparent && (!('depthWrite' in m) || m.depthWrite));
}

export class SoftDepthPass {
  /** Depth renders taken so far. */
  runs = 0;
  readonly #gate: FrameGate;
  readonly #override = new MeshDepthMaterial();
  #target: WebGLRenderTarget | undefined;
  #lastSerial = -1;
  #users = 0;

  constructor(gate: FrameGate) {
    this.#gate = gate;
  }

  /** Soft particle materials that want depth right now. */
  get users(): number {
    return this.#users;
  }

  /** The scene depth, or undefined before the first render. */
  get texture(): DepthTexture | undefined {
    return this.#target?.depthTexture ?? undefined;
  }

  /** Asks for depth; the returned function stops asking. */
  acquire(): () => void {
    this.#users++;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.#users--;
      if (this.#users === 0) this.dispose();
    };
  }

  /** Renders the opaque scene's depth (once per frame, only while someone wants it). */
  update(renderer: DepthRenderer, scene: Scene, camera: Camera): void {
    if (this.#users === 0) return;
    const serial = this.#gate.serial(renderer);
    if (serial === this.#lastSerial) return;
    this.#lastSerial = serial;
    renderer.getDrawingBufferSize(size);
    const width = Math.max(1, Math.floor(size.x / 2));
    const height = Math.max(1, Math.floor(size.y / 2));
    let target = this.#target;
    if (target?.width !== width || target.height !== height) {
      target?.depthTexture?.dispose();
      target?.dispose();
      target = new WebGLRenderTarget(width, height, {
        depthBuffer: true,
        depthTexture: new DepthTexture(width, height),
      });
      this.#target = target;
    }
    // Only what writes depth: particles, ribbons, hazes and other see-through things stay out.
    const hidden: Object3D[] = [];
    scene.traverse((object) => {
      if (object === scene || !object.visible || drawnAsOpaque(object)) return;
      object.visible = false;
      hidden.push(object);
    });
    const previousTarget = renderer.getRenderTarget();
    const previousOverride = scene.overrideMaterial;
    const previousShadows = renderer.shadowMap.autoUpdate;
    const previousReset = renderer.info.autoReset;
    scene.overrideMaterial = this.#override;
    renderer.shadowMap.autoUpdate = false;
    renderer.info.autoReset = false;
    renderer.setRenderTarget(target);
    renderer.clear();
    renderer.render(scene, camera);
    renderer.setRenderTarget(previousTarget);
    renderer.info.autoReset = previousReset;
    renderer.shadowMap.autoUpdate = previousShadows;
    scene.overrideMaterial = previousOverride;
    for (const object of hidden) object.visible = true;
    this.runs++;
    this.#gate.absorb(renderer);
  }

  dispose(): void {
    this.#target?.depthTexture?.dispose();
    this.#target?.dispose();
    this.#target = undefined;
    this.#lastSerial = -1;
  }
}
