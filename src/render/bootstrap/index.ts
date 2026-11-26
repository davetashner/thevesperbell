// Renderer bootstrap (mw-e00.19, ADR-0001: Three.js). Creates the canvas, WebGL2 renderer, scene and
// camera; keeps the drawing buffer at CSS size × min(devicePixelRatio, cap) × render scale; and tears
// everything down in dispose() so the WebGL context is released rather than leaked.
import {
  EventDispatcher,
  PerspectiveCamera,
  Scene,
  WebGLRenderer,
  type Material,
  type Object3D,
} from 'three';
import { populateBootScene } from './boot-scene.ts';
import { DEFAULT_MAX_PIXEL_RATIO, clampRenderScale, effectivePixelRatio } from './sizing.ts';

export * from './sizing.ts';

/**
 * The canvas and WebGL context, which can outlive one scene (mw-ju8.44): an in-place area swap
 * builds the next scene on the same canvas, so the context is not recreated and pointer lock holds.
 */
export interface GlSurface {
  readonly canvas: HTMLCanvasElement;
  readonly renderer: WebGLRenderer;
  /**
   * Frees every geometry, material, texture and render target the renderer has uploaded since the
   * last release (or since the surface was made): one area's GPU memory, whoever still holds the
   * objects. One that is drawn again simply uploads again.
   */
  releaseUploads(): void;
  /** Frees GPU resources, releases the WebGL context and removes the canvas. Idempotent. */
  dispose(): void;
}

/**
 * Three.js listens for 'dispose' on everything it uploads (geometries, materials, textures, render
 * targets), so an object holding a 'dispose' listener is one the renderer has on the GPU. The
 * surface notes those, which is how it can free a whole area's resources, including ones the scene
 * graph no longer holds, without the context loss the page used to rely on.
 */
export function trackUploads(): { release(): void; stop(): void } {
  const proto = EventDispatcher.prototype as unknown as {
    addEventListener(this: object, type: string, listener: (event: unknown) => void): void;
  };
  // eslint-disable-next-line @typescript-eslint/unbound-method -- called back with its own `this`
  const original = proto.addEventListener;
  const live = new Set<{ dispose(): void }>();
  const hooked = new WeakSet<object>();
  proto.addEventListener = function (this: object, type, listener) {
    original.call(this, type, listener);
    const target = this as { dispose?: unknown };
    if (type !== 'dispose' || typeof target.dispose !== 'function') return;
    live.add(target as { dispose(): void });
    if (hooked.has(this)) return;
    hooked.add(this);
    // Disposed on its own (a one-off geometry): no longer the surface's to free.
    original.call(this, 'dispose', () => live.delete(target as { dispose(): void }));
  };
  return {
    release() {
      for (const object of [...live]) object.dispose();
      live.clear();
    },
    stop() {
      proto.addEventListener = original;
    },
  };
}

/** Creates the canvas inside `container` and a WebGL2 renderer on it; throws if no context. */
export function createGlSurface(container: HTMLElement): GlSurface {
  const canvas = container.ownerDocument.createElement('canvas');
  canvas.dataset['testid'] = 'game-canvas';
  canvas.style.display = 'block';
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  container.append(canvas);
  const uploads = trackUploads();
  let renderer: WebGLRenderer;
  try {
    renderer = new WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  } catch (error) {
    uploads.stop();
    canvas.remove();
    throw error;
  }
  let disposed = false;
  return {
    canvas,
    renderer,
    releaseUploads: () => {
      uploads.release();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      renderer.setAnimationLoop(null);
      uploads.release();
      uploads.stop();
      renderer.dispose();
      // dispose() frees Three's GPU resources but leaves the context alive until GC; browsers cap
      // live contexts (16 in Chromium), so release it explicitly.
      renderer.forceContextLoss();
      canvas.remove();
    },
  };
}

export interface RenderBootstrapOptions {
  /** Element the canvas is appended to; the canvas fills it. */
  readonly container: HTMLElement;
  /**
   * A canvas and renderer that outlive this bootstrap (mw-ju8.44). When given, dispose() frees only
   * the scene's resources and leaves the surface to its owner.
   */
  readonly surface?: GlSurface;
  /** Cap on devicePixelRatio (default DEFAULT_MAX_PIXEL_RATIO). */
  readonly maxPixelRatio?: number;
  /** Initial render scale (settings hook; default 1). */
  readonly renderScale?: number;
  /** Called once, right after the first frame has been submitted. */
  readonly onFirstFrame?: () => void;
  /**
   * When false, the bootstrap runs no animation loop of its own: the caller draws each frame with
   * `renderFrame` (the game's frame loop does, after stepping the sim; mw-e00.20). Default true.
   */
  readonly animationLoop?: boolean;
  /**
   * When false, the scene starts empty instead of holding the mw-e00.19 placeholder (the game loads
   * a greybox scene into it; mw-e00.21). Default true.
   */
  readonly placeholderScene?: boolean;
}

export interface RenderBootstrap {
  readonly canvas: HTMLCanvasElement;
  readonly renderer: WebGLRenderer;
  readonly scene: Scene;
  readonly camera: PerspectiveCamera;
  /** Current render scale after clamping. */
  readonly renderScale: number;
  /** Draws one frame at render-side time `timeMs` (resizing first if needed). */
  renderFrame(timeMs: number): void;
  /** Settings hook: changes the render scale; applied before the next frame. */
  setRenderScale(scale: number): void;
  /** Stops the loop, frees GPU resources, releases the WebGL context and removes the canvas. Idempotent. */
  dispose(): void;
}

export function createRenderBootstrap(options: RenderBootstrapOptions): RenderBootstrap {
  const { container } = options;
  const view = container.ownerDocument.defaultView;
  const maxPixelRatio = options.maxPixelRatio ?? DEFAULT_MAX_PIXEL_RATIO;
  let renderScale = clampRenderScale(options.renderScale ?? 1);

  const ownsSurface = options.surface === undefined;
  const surface = options.surface ?? createGlSurface(container);
  const { canvas, renderer } = surface;

  const scene = new Scene();
  const camera = new PerspectiveCamera(55, 1, 0.1, 200);
  const boot =
    (options.placeholderScene ?? true)
      ? populateBootScene(scene, camera)
      : { update: () => undefined };

  // Resize is checked every frame (CSS size, DPR and render scale), which also catches a window
  // moving to a monitor with a different devicePixelRatio, where no resize event fires.
  let applied = { width: -1, height: -1, ratio: -1 };
  const resizeIfNeeded = (): void => {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const ratio = effectivePixelRatio(view?.devicePixelRatio ?? 1, maxPixelRatio, renderScale);
    if (width === applied.width && height === applied.height && ratio === applied.ratio) return;
    applied = { width, height, ratio };
    renderer.setPixelRatio(ratio);
    renderer.setSize(width, height, false);
    camera.aspect = height > 0 ? width / height : 1;
    camera.updateProjectionMatrix();
  };

  let firstFrame = true;
  let disposed = false;
  const renderFrame = (timeMs: number): void => {
    if (disposed) return;
    resizeIfNeeded();
    boot.update(timeMs);
    renderer.render(scene, camera);
    if (firstFrame) {
      firstFrame = false;
      options.onFirstFrame?.();
    }
  };
  if (options.animationLoop ?? true) renderer.setAnimationLoop(renderFrame);

  return {
    canvas,
    renderer,
    scene,
    camera,
    renderFrame,
    get renderScale() {
      return renderScale;
    },
    setRenderScale(scale) {
      renderScale = clampRenderScale(scale);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      renderer.setAnimationLoop(null);
      disposeObjectTree(scene);
      scene.clear();
      if (ownsSurface) surface.dispose();
      else surface.releaseUploads();
    },
  };
}

function disposeObjectTree(root: Object3D): void {
  root.traverse((object) => {
    const mesh = object as Partial<{
      geometry: { dispose(): void };
      material: Material | Material[];
    }>;
    mesh.geometry?.dispose();
    const materials = mesh.material === undefined ? [] : [mesh.material].flat();
    for (const material of materials) material.dispose();
  });
}
