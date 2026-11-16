// Entry point: node scripts/assets/turntable-cli.ts <out dir> <model.glb> [<model.glb> …]
//
// The turntable gate of style bible §17.2: renders each GLB from four sides on parchment in headless
// Chromium with the project's own three.js (meshopt-compressed runtime files load too), writes
// <out dir>/<model>.png, and prints and saves <out dir>/stats.json with each model's triangles,
// materials, texture sizes and bounds (m) for its prompt file and the §13.2 budget check.
import { createServer } from 'node:http';
import { readFileSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { basename, extname, join, resolve } from 'node:path';
import type { AddressInfo } from 'node:net';
import { withPage } from './chromium.ts';

const [outDir, ...models] = process.argv.slice(2);
if (outDir === undefined || models.length === 0) {
  console.error('usage: turntable-cli.ts <out dir> <model.glb> [<model.glb> …]');
  process.exit(2);
}
mkdirSync(outDir, { recursive: true });

const THREE_ROOT = resolve('node_modules/three');
const VIEW = 480;
const PAGE = `<!doctype html><html><head><meta charset="utf-8">
<style>html,body{margin:0;background:#EFE2C4}canvas{display:block}</style>
<script type="importmap">{"imports":{"three":"/three/build/three.module.js","three/addons/":"/three/examples/jsm/"}}</script>
</head><body><script type="module">
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
const W = ${String(VIEW)};
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setSize(W * 4, W);
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);
window.render = async (url) => {
  const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(url);
  const obj = gltf.scene;
  let tris = 0; const mats = new Set(); const tex = [];
  obj.traverse((o) => {
    if (!o.isMesh) return;
    const g = o.geometry;
    tris += (g.index ? g.index.count : g.attributes.position.count) / 3;
    [].concat(o.material).forEach((m) => { mats.add(m.uuid); if (m.map?.image) tex.push(m.map.image.width + 'x' + m.map.image.height); });
  });
  const box = new THREE.Box3().setFromObject(obj);
  const size = box.getSize(new THREE.Vector3()); const c = box.getCenter(new THREE.Vector3());
  const r = Math.max(size.x, size.y, size.z);
  renderer.setScissorTest(true);
  for (let i = 0; i < 4; i++) {
    const scene = new THREE.Scene(); scene.background = new THREE.Color(0xEFE2C4);
    scene.add(new THREE.HemisphereLight(0xc4d2ec, 0x5a4a3e, 1.6));
    const sun = new THREE.DirectionalLight(0xfff1dc, 2.2); sun.position.set(-1, 2, 1.5); scene.add(sun);
    scene.add(obj);
    const cam = new THREE.PerspectiveCamera(30, 1, r / 100, r * 20);
    const a = (i * Math.PI) / 2 + Math.PI / 6;
    cam.position.set(c.x + Math.sin(a) * r * 2.4, c.y + r * 0.9, c.z + Math.cos(a) * r * 2.4); cam.lookAt(c);
    renderer.setViewport(i * W, 0, W, W); renderer.setScissor(i * W, 0, W, W); renderer.render(scene, cam);
  }
  return { tris: Math.round(tris), materials: mats.size, textures: tex, size: [size.x, size.y, size.z].map((v) => +v.toFixed(2)) };
};
window.ready = true;
</script></body></html>`;

const TYPES: Readonly<Record<string, string>> = {
  '.js': 'text/javascript',
  '.glb': 'model/gltf-binary',
  '.wasm': 'application/wasm',
};
// Serves the page, three.js from node_modules and the models by index.
const server = createServer((req, res) => {
  const url = decodeURIComponent((req.url ?? '/').split('?')[0] ?? '/');
  let file: string | undefined;
  if (url === '/') {
    res.writeHead(200, { 'content-type': 'text/html' }).end(PAGE);
    return;
  }
  if (url.startsWith('/three/')) file = join(THREE_ROOT, url.slice('/three/'.length));
  else if (url.startsWith('/model/')) file = resolve(models[Number(url.slice('/model/'.length))] ?? '');
  if (file === undefined || !existsSync(file)) {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
  res.end(readFileSync(file));
});
await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
const { port } = server.address() as AddressInfo;

const stats: Record<string, unknown> = {};
try {
  await withPage(async (page) => {
    await page.setViewportSize({ width: VIEW * 4, height: VIEW });
    await page.goto(`http://127.0.0.1:${String(port)}/`);
    await page.waitForFunction(() => (window as unknown as { ready?: boolean }).ready === true);
    for (const [index, model] of models.entries()) {
      const id = basename(model, '.glb');
      stats[id] = await page.evaluate(
        (url) => (window as unknown as { render: (u: string) => Promise<unknown> }).render(url),
        `/model/${String(index)}`,
      );
      await page.screenshot({ path: join(outDir, `${id}.png`) });
      console.log(id, JSON.stringify(stats[id]));
    }
  });
} finally {
  server.close();
}
writeFileSync(join(outDir, 'stats.json'), `${JSON.stringify(stats, null, 1)}\n`);
