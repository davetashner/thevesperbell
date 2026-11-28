// The stylized material test scene (mw-e37.13): one row of spheres under the golden-hour preset, so
// e2e/stylized-material.spec.ts can screenshot it at High and Low (AC-1), check that Low compiles no
// normal-map sampling (AC-4) and read the edge cases off the frame: pure black in shadow leans to dusk,
// pure white clamps below cream (AC-5), and wet is darker than dry (AC-3). ?quality=low picks Low.
//
// Spheres, left to right: pure black, pure white, dry stone, wet stone, an emissive glyph mask and a
// normal-mapped (High only) stone. The page publishes what it measured on #status[data-probe] (JSON).
import {
  CanvasTexture,
  Color,
  DirectionalLight,
  HemisphereLight,
  Mesh,
  PerspectiveCamera,
  PlaneGeometry,
  RepeatWrapping,
  Scene,
  SphereGeometry,
  Vector3,
  WebGLRenderer,
} from 'three';
import {
  StylizedMaterial,
  setStylizedQuality,
  useStylizedPreset,
  type StylizedQuality,
} from '@render/materials/index';

const stage = document.querySelector<HTMLElement>('#stage');
const status = document.querySelector<HTMLOutputElement>('#status');

/** A small canvas texture drawn by `draw`. */
function canvasTexture(size: number, draw: (ctx: CanvasRenderingContext2D) => void): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx === null) throw new Error('no 2d context');
  draw(ctx);
  const texture = new CanvasTexture(canvas);
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  return texture;
}

/** ORM mask: full occlusion and wetness, emissive (B) only along two glyph bands. */
function glyphMask(): CanvasTexture {
  return canvasTexture(64, (ctx) => {
    ctx.fillStyle = 'rgb(255,255,0)';
    ctx.fillRect(0, 0, 64, 64);
    ctx.fillStyle = 'rgb(255,255,255)';
    ctx.fillRect(0, 20, 64, 6);
    ctx.fillRect(28, 0, 6, 64);
  });
}

/** A tangent-space normal map of soft horizontal ridges (stone courses). */
function ridgeNormals(): CanvasTexture {
  return canvasTexture(64, (ctx) => {
    for (let y = 0; y < 64; y++) {
      const slope = Math.sin((y / 64) * Math.PI * 8);
      ctx.fillStyle = `rgb(128,${String(Math.round(128 + slope * 90))},${String(Math.round(255 - Math.abs(slope) * 60))})`;
      ctx.fillRect(0, y, 64, 1);
    }
  });
}

interface Swatch {
  readonly id: string;
  readonly material: StylizedMaterial;
}

function swatches(): Swatch[] {
  const stone = 0x8c8a80;
  const glyph = new StylizedMaterial({
    color: 0x5a3e2b,
    emissive: new Color(0x9fd8e0),
    emissiveIntensity: 1.2,
    maskMap: glyphMask(),
  });
  const normal = new StylizedMaterial({ color: stone, normalMap: ridgeNormals() });
  return [
    { id: 'black', material: new StylizedMaterial({ color: 0x000000 }) },
    { id: 'white', material: new StylizedMaterial({ color: 0xffffff }) },
    { id: 'dry', material: new StylizedMaterial({ color: stone }) },
    { id: 'wet', material: new StylizedMaterial({ color: stone, wetness: 1 }) },
    { id: 'glyph', material: glyph },
    { id: 'normal', material: normal },
  ];
}

const RADIUS = 0.6;
const SPACING = 1.5;
const SUN_DIRECTION = new Vector3(-0.6, 0.55, 0.6).normalize();

/** Where sphere `index` sits. */
function centre(index: number, count: number): Vector3 {
  return new Vector3((index - (count - 1) / 2) * SPACING, RADIUS, 0);
}

/** The frame's sRGB colour (0–255) at a world point. */
function sample(
  gl: WebGL2RenderingContext,
  camera: PerspectiveCamera,
  point: Vector3,
): [number, number, number] {
  const ndc = point.clone().project(camera);
  const x = Math.round(((ndc.x + 1) / 2) * gl.drawingBufferWidth);
  const y = Math.round(((ndc.y + 1) / 2) * gl.drawingBufferHeight);
  const pixel = new Uint8Array(4);
  gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
  return [pixel[0] ?? 0, pixel[1] ?? 0, pixel[2] ?? 0];
}

/** Whether any stylized fragment program the renderer built samples a normal map (AC-4). */
function stylizedPrograms(renderer: WebGLRenderer): { count: number; normalMapped: number } {
  const gl = renderer.getContext();
  let count = 0;
  let normalMapped = 0;
  for (const info of renderer.info.programs ?? []) {
    const program = (info as unknown as { program: WebGLProgram }).program;
    for (const shader of gl.getAttachedShaders(program) ?? []) {
      if (gl.getShaderParameter(shader, gl.SHADER_TYPE) !== gl.FRAGMENT_SHADER) continue;
      const source = gl.getShaderSource(shader) ?? '';
      if (!source.includes('RE_Direct_Stylized')) continue;
      count++;
      if (/#define USE_NORMALMAP\b/.test(source)) {
        normalMapped++;
      }
    }
  }
  return { count, normalMapped };
}

function boot(container: HTMLElement, out: HTMLOutputElement): void {
  const quality: StylizedQuality =
    new URLSearchParams(location.search).get('quality') === 'low' ? 'low' : 'high';
  setStylizedQuality(quality);
  useStylizedPreset('golden-hour');

  const renderer = new WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.shadowMap.enabled = true;
  renderer.domElement.dataset['testid'] = 'game-canvas';
  container.append(renderer.domElement);

  const scene = new Scene();
  scene.background = new Color(0x10131c);
  // Golden hour (style bible §3): key #FFB870, sky #8C98C0 over ground #5A4A3E.
  scene.add(new HemisphereLight(0x8c98c0, 0x5a4a3e, 1.2));
  const sun = new DirectionalLight(0xffb870, 2.6);
  sun.position.copy(SUN_DIRECTION).multiplyScalar(10);
  sun.castShadow = true;
  sun.shadow.camera.left = -6;
  sun.shadow.camera.right = 6;
  sun.shadow.camera.top = 6;
  sun.shadow.camera.bottom = -6;
  sun.shadow.mapSize.set(1024, 1024);
  scene.add(sun);

  const ground = new Mesh(
    new PlaneGeometry(14, 6).rotateX(-Math.PI / 2),
    new StylizedMaterial({ color: 0xa89a84 }),
  );
  ground.receiveShadow = true;
  scene.add(ground);

  const list = swatches();
  const geometry = new SphereGeometry(RADIUS, 48, 24);
  geometry.computeTangents();
  list.forEach((swatch, i) => {
    const mesh = new Mesh(geometry, swatch.material);
    mesh.position.copy(centre(i, list.length));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
  });

  const camera = new PerspectiveCamera(35, container.clientWidth / container.clientHeight, 0.1, 50);
  camera.position.set(0, 2.2, 9);
  camera.lookAt(0, 0.5, 0);
  camera.updateMatrixWorld();

  renderer.render(scene, camera);
  renderer.render(scene, camera);

  const gl = renderer.getContext() as WebGL2RenderingContext;
  const toCamera = camera.position.clone();
  /** A point on sphere `id`'s surface, its normal leaning `lean` from the camera direction. */
  const onSphere = (id: string, lean: Vector3): Vector3 => {
    const i = list.findIndex((s) => s.id === id);
    const c = centre(i, list.length);
    const n = toCamera.clone().sub(c).normalize().add(lean).normalize();
    return c.add(n.multiplyScalar(RADIUS));
  };
  const away = SUN_DIRECTION.clone().multiplyScalar(-0.9); // the side turned from the sun
  const lit = SUN_DIRECTION.clone().multiplyScalar(0.5);
  const diffuse = new Vector3(-0.2, -0.35, 0); // lit but off the wet sheen
  const probe = {
    quality,
    programs: stylizedPrograms(renderer),
    blackShadow: sample(gl, camera, onSphere('black', away)),
    whiteLit: sample(gl, camera, onSphere('white', lit)),
    dry: sample(gl, camera, onSphere('dry', diffuse)),
    wet: sample(gl, camera, onSphere('wet', diffuse)),
    errors: gl.getError(),
  };
  out.dataset['probe'] = JSON.stringify(probe);
  out.dataset['state'] = 'ready';
}

if (stage && status) {
  try {
    boot(stage, status);
  } catch (error: unknown) {
    status.dataset['state'] = 'failed';
    console.error(error);
  }
}
