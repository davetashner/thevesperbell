// mw-e37.8 AC-3: a model built by pnpm assets:build (meshopt geometry, WebP textures) loads in the
// browser through three's GLTFLoader + MeshoptDecoder, the same loader the game uses, and renders with
// no console errors. The fixture is built here from a generated source (no binary committed) and
// served on a private origin with the project's own three.js, so the spec needs no game scene.
import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { buildAll, readManifest } from '../src/tools/assets/build/build.ts';
import { writeFixture } from '../src/tools/assets/build/fixture.ts';

const ORIGIN = 'http://asset-build.test';
const THREE = resolve('node_modules/three');
const PAGE = `<!doctype html><html><head><meta charset="utf-8">
<style>html,body{margin:0;background:#000}canvas{display:block}</style>
<script type="importmap">{"imports":{"three":"/three/build/three.module.js","three/addons/":"/three/examples/jsm/"}}</script>
</head><body><script type="module">
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
const renderer = new THREE.WebGLRenderer({ preserveDrawingBuffer: true });
renderer.setSize(256, 256);
document.body.appendChild(renderer.domElement);
const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync('/model.glb');
const scene = new THREE.Scene();
scene.add(gltf.scene, new THREE.AmbientLight(0xffffff, 3));
const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 10);
camera.position.set(0, 0, 1.6);
renderer.render(scene, camera);
const gl = renderer.getContext();
const px = new Uint8Array(256 * 256 * 4);
gl.readPixels(0, 0, 256, 256, gl.RGBA, gl.UNSIGNED_BYTE, px);
let lit = 0;
for (let i = 0; i < px.length; i += 4) if (px[i] + px[i + 1] + px[i + 2] > 60) lit++;
const mid = (128 * 256 + 128) * 4;
window.result = { lit: lit / (256 * 256), center: [px[mid], px[mid + 1], px[mid + 2]] };
</script></body></html>`;

test('AC-3: a built model renders with no console errors and passes a screenshot sanity check', async ({
  page,
}) => {
  const root = mkdtempSync(join(tmpdir(), 'asset-build-e2e-'));
  const id = 'model-prop-e2e-01';
  const source = join(root, `assets/source/model/${id}/${id}.glb`);
  mkdirSync(dirname(source), { recursive: true });
  await writeFixture(source, { textureSize: 2048, quads: 4 });
  expect((await buildAll(root, () => undefined)).errors).toEqual([]);
  const glb = readFileSync(join(root, 'public', String(readManifest(root).models[id]?.high.url)));

  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route(`${ORIGIN}/**`, async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/') await route.fulfill({ contentType: 'text/html', body: PAGE });
    else if (path === '/model.glb')
      await route.fulfill({ contentType: 'model/gltf-binary', body: glb });
    else if (path.startsWith('/three/'))
      await route.fulfill({
        contentType: 'text/javascript',
        body: readFileSync(join(THREE, path.slice('/three/'.length))),
      });
    else await route.fulfill({ status: 404, body: '' });
  });

  await page.goto(`${ORIGIN}/`);
  const result = await page.waitForFunction(() => (window as { result?: unknown }).result, null, {
    timeout: 20_000,
  });
  const { lit, center } = (await result.jsonValue()) as { lit: number; center: number[] };
  // The 1 m quad strip fills a good part of the frame, and its middle shows the gradient texture
  // (warm red channel, cool blue channel), not the black clear colour.
  expect(lit).toBeGreaterThan(0.2);
  expect((center[0] ?? 0) + (center[1] ?? 0) + (center[2] ?? 0)).toBeGreaterThan(150);
  expect(errors).toEqual([]);
});
