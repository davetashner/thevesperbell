// mw-e29.7: the magical material library, headless. The sim's real death path (the debug console's
// `kill` on a spawned creature) drives the corpse glue, with Three.js objects standing in for a
// creature's render entity and the real dissolve patching real materials; only the GPU is missing, so
// shader compilation is the e2e's (e2e/magic-materials.spec.ts, Chromium, Firefox, WebKit).
import * as RAPIER from '@dimforge/rapier3d-deterministic';
import {
  BoxGeometry,
  Color,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Scene,
  Vector2,
  type Camera,
  type Material,
  type WebGLProgramParametersWithUniforms,
  type WebGLRenderer,
} from 'three';
import { describe, expect, it } from 'vitest';
import { loadDevContent } from '@content/dev-content';
import { markExercised } from '@content/testing';
import { attachCorpseDissolves } from '@game/vfx/index';
import {
  DEATH_DISSOLVE_DELAY_SECONDS,
  DEATH_DISSOLVE_SECONDS,
} from '@render/magic-materials/rules';
import { MagicMaterials } from '@render/magic-materials/index';
import { uniform } from '@render/magic-materials/uniforms';
import { applyDissolve } from '@render/magic-materials/dissolve';
import {
  creatureEntities,
  hashWorld,
  killCommand,
  spawnCommand,
  type EntityId,
  type World,
} from '@sim/index';
import { createGameWorld } from '@tools/replay/testbed-player-scenario';

const content = loadDevContent();

/** `value`, or a failed test when it is missing. */
function must<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('expected a value');
  return value;
}
const FRAME = 1 / 60;

/** A creature's stand-in render entity: a group of two meshes sharing `material`. */
function proxy(material: Material): Group {
  const group = new Group();
  group.name = 'creature:fixture-guard';
  for (const x of [-0.3, 0.3]) {
    const mesh = new Mesh(new BoxGeometry(0.4, 1.6, 0.4), material);
    mesh.position.x = x;
    group.add(mesh);
  }
  return group;
}

/** What the renderer would hand a material's onBeforeCompile, with the uniforms it patched in. */
function compile(material: Material): WebGLProgramParametersWithUniforms {
  const shader = {
    uniforms: {},
    vertexShader: 'void main() {\n#include <project_vertex>\n}',
    fragmentShader:
      'void main() {\n#include <clipping_planes_fragment>\n#include <color_fragment>\n#include <emissivemap_fragment>\n}',
  } as unknown as WebGLProgramParametersWithUniforms;
  material.onBeforeCompile(shader, {} as WebGLRenderer);
  return shader;
}

function uniformOf(material: Material, name: string): unknown {
  return (compile(material).uniforms[name] as { value: unknown } | undefined)?.value;
}

function spawnGuard() {
  const world = createGameWorld<unknown>(RAPIER, { seed: 1, hz: 60, scene: 'testbed', content });
  world.world.step([spawnCommand('fixture-guard', 1, { x: 0, y: 0, z: 9 })]);
  const [entity] = creatureEntities(world.world);
  if (entity === undefined) throw new Error('no creature spawned');
  return { world: world.world, entity };
}

describe('creature death dissolve (AC-3)', () => {
  function rig(world: World, entity: EntityId, material: Material) {
    const scene = new Scene();
    const body = proxy(material);
    scene.add(body);
    const dissolves: ReturnType<typeof applyDissolve>[] = [];
    const glue = attachCorpseDissolves({
      events: world.events,
      proxyOf: (target) => (target === entity ? body : undefined),
      dissolve: (_target, drawn) => {
        const dissolve = applyDissolve(drawn, { seed: 1 });
        dissolves.push(dissolve);
        return dissolve;
      },
      progress: (dissolve, progress) => {
        dissolve.setProgress(progress);
      },
      remove: (_target, drawn, dissolve) => {
        dissolve.dispose();
        drawn.removeFromParent();
      },
    });
    return { scene, body, glue, dissolves };
  }

  it('AC-3: on the creature’s Died event the dissolve runs over 1.2 s and the render entity is removed afterwards', ({
    task,
  }) => {
    markExercised(task, 'creature', 'fixture-guard');
    const { world, entity } = spawnGuard();
    const { scene, body, glue } = rig(world, entity, new MeshStandardMaterial());
    expect(glue.size).toBe(0);
    world.step([killCommand(entity)]);
    world.events.flush();
    expect(glue.dying(entity)).toBe(true);
    const hashAtDeath = hashWorld(world);

    let started: number | undefined;
    let removedAt: number | undefined;
    for (let frame = 1; frame <= 6 * 60 && removedAt === undefined; frame++) {
      glue.update(FRAME);
      const t = frame * FRAME;
      if ((glue.progressOf(entity) ?? 0) > 0 && started === undefined) started = t;
      if (body.parent === null) removedAt = t;
    }
    expect(started).toBeDefined();
    expect(removedAt).toBeDefined();
    // The dissolve waits for the collapse, runs 1.2 s, and the entity goes with its last frame.
    expect(must(started)).toBeCloseTo(DEATH_DISSOLVE_DELAY_SECONDS, 1);
    expect(must(removedAt) - must(started)).toBeCloseTo(DEATH_DISSOLVE_SECONDS, 1);
    expect(scene.children).toHaveLength(0);
    expect(glue.removed).toBe(1);
    expect(glue.dying(entity)).toBe(false);
    expect(glue.progressOf(entity)).toBeUndefined();
    // Render-only: the sim was not written to.
    expect(hashWorld(world)).toBe(hashAtDeath);
  });

  it('a creature that is not drawn changes nothing, and a detached glue stops listening', () => {
    const { world, entity } = spawnGuard();
    world.step([spawnCommand('fixture-guard', 1, { x: 4, y: 0, z: 9 })]);
    const undrawn = creatureEntities(world).find((id) => id !== entity);
    if (undrawn === undefined) throw new Error('no second creature');
    const { glue } = rig(world, entity, new MeshStandardMaterial());
    // Dies, but it has no render entity: nothing starts.
    world.step([killCommand(undrawn)]);
    world.events.flush();
    expect(glue.dying(undrawn)).toBe(false);
    expect(glue.size).toBe(0);
    // Once detached, even a drawn creature's death starts nothing.
    glue.detach();
    world.step([killCommand(entity)]);
    world.events.flush();
    expect(glue.dying(entity)).toBe(false);
  });

  it('a dissolve on one creature never dissolves another sharing its material', () => {
    const { world, entity } = spawnGuard();
    const shared = new MeshStandardMaterial({ color: 0xd8cfb4 });
    const a = rig(world, entity, shared);
    const neighbour = proxy(shared);
    world.step([killCommand(entity)]);
    world.events.flush();
    a.glue.update(DEATH_DISSOLVE_DELAY_SECONDS + 0.6);

    // The dying body wears copies of its own, patched and half dissolved.
    const dying = a.dissolves[0];
    expect(dying?.progress).toBeCloseTo(0.5, 1);
    for (const mesh of a.body.children as Mesh[]) {
      expect(mesh.material).not.toBe(shared);
      expect(uniformOf(mesh.material as Material, 'uDissolve')).toBeCloseTo(0.5, 1);
    }
    // The neighbour still wears the shared original, which was never patched.
    for (const mesh of neighbour.children as Mesh[]) {
      expect(mesh.material).toBe(shared);
    }
    expect(Object.hasOwn(shared, 'onBeforeCompile')).toBe(false);
    expect(shared.customProgramCacheKey()).toBe(new MeshStandardMaterial().customProgramCacheKey());

    // A second dying body has its own progress: the uniforms are per copy, not per program.
    const other = applyDissolve(neighbour, { seed: 2 });
    other.setProgress(0.9);
    const neighbourMaterial = (neighbour.children[0] as Mesh).material as Material;
    expect(uniformOf(neighbourMaterial, 'uDissolve')).toBeCloseTo(0.9, 5);
    expect(uniformOf((a.body.children[0] as Mesh).material as Material, 'uDissolve')).toBeCloseTo(
      0.5,
      1,
    );
    // Both share one compiled program (same cache key), so dissolving many costs one compile.
    expect(neighbourMaterial.customProgramCacheKey()).toBe(
      ((a.body.children[0] as Mesh).material as Material).customProgramCacheKey(),
    );

    // Finishing puts the shared original back on the dead body.
    a.glue.update(5);
    other.dispose();
    for (const mesh of neighbour.children as Mesh[]) expect(mesh.material).toBe(shared);
  });

  it('dissolve patches skinned and static lit materials, depth and shadow too, and ignores unlit ones', () => {
    const lit = new MeshStandardMaterial();
    const unlit = new MeshBasicMaterial();
    const group = new Group();
    const litMesh = new Mesh(new BoxGeometry(), lit);
    const unlitMesh = new Mesh(new BoxGeometry(), unlit);
    const arrayMesh = new Mesh(new BoxGeometry(), [lit, unlit]);
    group.add(litMesh, unlitMesh, arrayMesh);
    const dissolve = applyDissolve(group, { tint: 0xff7a1a, intensity: 2, edge: 5, sweep: 2 });
    expect(unlitMesh.material).toBe(unlit);
    expect(unlitMesh.customDepthMaterial).toBeUndefined();
    expect(litMesh.customDepthMaterial).toBeDefined();
    expect(litMesh.customDistanceMaterial).toBeDefined();
    expect(Array.isArray(arrayMesh.material)).toBe(true);
    expect((arrayMesh.material as Material[])[1]).toBe(unlit);
    expect(dissolve.materials).toHaveLength(2);
    const body = compile(litMesh.material);
    expect(body.fragmentShader).toContain('discard');
    expect(body.fragmentShader).toContain('totalEmissiveRadiance');
    expect(body.vertexShader).toContain('vDissolveWorld');
    // The shadow materials discard on the same field but never light anything.
    const shadow = compile(must(litMesh.customDepthMaterial));
    expect(shadow.fragmentShader).toContain('discard');
    expect(shadow.fragmentShader).not.toContain('totalEmissiveRadiance');
    // Edge and sweep are kept in range; the tint is the one asked for.
    expect(uniformOf(litMesh.material as Material, 'uDissolveEdge')).toBe(0.3);
    expect((uniformOf(litMesh.material as Material, 'uDissolveSweep') as { z: number }).z).toBe(1);
    dissolve.setLook({ intensity: 0 });
    expect(uniformOf(litMesh.material as Material, 'uDissolveGlow')).toBe(0);
    dissolve.setProgress(7);
    expect(dissolve.progress).toBe(1);
    dissolve.dispose();
    expect(litMesh.material).toBe(lit);
    expect(litMesh.customDepthMaterial).toBeUndefined();
  });
});

/** A renderer that records what the library asks of it. */
function fakeRenderer(width = 800, height = 450) {
  const calls: string[] = [];
  const renderer = {
    info: { autoReset: true, render: { frame: 0 } },
    shadowMap: { autoUpdate: true },
    getDrawingBufferSize: (target: Vector2) => target.set(width, height),
    copyFramebufferToTexture: () => {
      calls.push('copy');
    },
    getRenderTarget: () => null,
    setRenderTarget: () => {
      calls.push('target');
    },
    clear: () => {
      calls.push('clear');
    },
    render: (scene: Scene) => {
      calls.push('render');
      renderer.info.render.frame++;
      seen.push(scene.overrideMaterial !== null);
    },
  };
  const seen: boolean[] = [];
  return { renderer, calls, seen };
}

/** Draws `mesh` as a renderer would, for `frame`. */
function draw(
  mesh: Mesh,
  renderer: ReturnType<typeof fakeRenderer>['renderer'],
  frame: number,
  scene = new Scene(),
  camera: Camera = {} as Camera,
): void {
  renderer.info.render.frame = frame;
  mesh.onBeforeRender(
    renderer as unknown as WebGLRenderer,
    scene,
    camera,
    mesh.geometry,
    mesh.material as Material,
    null as never,
  );
}

describe('distortion on High and Low (AC-2, AC-4)', () => {
  it('AC-2: on the Low preset distortion is skipped and no distortion pass runs', () => {
    const { renderer, calls } = fakeRenderer();
    const magic = new MagicMaterials({
      renderer: renderer,
      tier: 'low',
    });
    expect(magic.heatHaze()).toBeUndefined();
    expect(magic.heatHaze({ intensity: 3 })).toBeUndefined();
    expect(magic.stats()).toMatchObject({
      tier: 'low',
      hazes: 0,
      distortionSkipped: 2,
      distortionPasses: 0,
    });
    expect(calls).toEqual([]);
  });

  it('AC-2: switching to Low hides the hazes already alive, so their pass stops; High brings it back', () => {
    const { renderer, calls } = fakeRenderer();
    const magic = new MagicMaterials({ renderer: renderer });
    const haze = magic.heatHaze({ tint: 0xffb066 });
    expect(haze).toBeDefined();
    expect(magic.stats().hazes).toBe(1);
    draw(must(haze).mesh, renderer, 1);
    expect(calls).toEqual(['copy']);
    magic.setTier('low');
    expect(must(haze).mesh.visible).toBe(false);
    expect(magic.stats()).toMatchObject({ tier: 'low', hazes: 0, distortionPasses: 1 });
    magic.setTier('high');
    expect(must(haze).mesh.visible).toBe(true);
    expect(magic.stats().hazes).toBe(1);
  });

  it('AC-4 set-up: six hazes in one frame take one frame copy between them, and a new frame copies again', () => {
    const { renderer, calls } = fakeRenderer();
    const magic = new MagicMaterials({ renderer: renderer });
    const hazes = Array.from({ length: 6 }, () => magic.heatHaze({ size: 3 }));
    expect(magic.stats().hazes).toBe(6);
    for (const haze of hazes) draw(must(haze).mesh, renderer, 10);
    expect(calls).toEqual(['copy']);
    for (const haze of hazes) draw(must(haze).mesh, renderer, 11);
    expect(calls).toEqual(['copy', 'copy']);
    expect(magic.stats().distortionPasses).toBe(2);
    // A resize reallocates the frame texture and copies at once.
    const resized = fakeRenderer(400, 300);
    const small = new MagicMaterials({ renderer: resized.renderer });
    const one = small.heatHaze();
    draw(must(one).mesh, resized.renderer, 1);
    resized.renderer.getDrawingBufferSize = (target: Vector2) => target.set(640, 360);
    draw(must(one).mesh, resized.renderer, 1);
    expect(resized.calls).toEqual(['copy', 'copy']);
    small.dispose();
    magic.dispose();
  });

  it('a haze that is disposed leaves the library and takes no more frame copies', () => {
    const { renderer } = fakeRenderer();
    const magic = new MagicMaterials({ renderer: renderer });
    const haze = magic.heatHaze();
    haze?.dispose();
    expect(magic.stats().hazes).toBe(0);
  });
});

describe('reduced motion and photosensitivity (nothing flashes)', () => {
  it('pulses, runes and haze hold still in reduced motion and never pulse above 2 Hz', () => {
    const { renderer } = fakeRenderer();
    let reduced = false;
    const magic = new MagicMaterials({
      renderer: renderer,
      reducedMotion: () => reduced,
    });
    const body = new Mesh(new BoxGeometry(), new MeshStandardMaterial());
    const pulse = magic.pulse(body, { tint: 0xff7a1a, intensity: 1, hz: 40 });
    const glow = magic.fresnel(body, { pulseHz: 40, intensity: 1 });
    const rune = magic.runeDecal({ pulseHz: 40, spin: 1 });
    const haze = magic.heatHaze();
    const emissive = () => body.material.emissiveIntensity;
    const material = pulse.materials[0] as MeshStandardMaterial;
    const levels = new Set<number>();
    const rim = new Set<number>();
    for (let step = 0; step < 100; step++) {
      magic.update(0.01);
      levels.add(Number(material.emissiveIntensity.toFixed(4)));
      rim.add(Number(uniform<number>(glow.material, 'uIntensity').value.toFixed(4)));
    }
    // A 40 Hz request is capped at 2 Hz: in one second the glow rises and falls twice, not 40 times.
    let turns = 0;
    const series: number[] = [];
    const sample = new MagicMaterials({
      renderer: renderer,
      reducedMotion: () => false,
    });
    const probe = new Mesh(new BoxGeometry(), new MeshStandardMaterial());
    const watched = sample.pulse(probe, { hz: 40, intensity: 1 });
    for (let step = 0; step < 200; step++) {
      sample.update(0.005);
      series.push((watched.materials[0] as MeshStandardMaterial).emissiveIntensity);
    }
    for (let i = 2; i < series.length; i++) {
      const a = must(series[i - 1]) - must(series[i - 2]);
      const b = must(series[i]) - must(series[i - 1]);
      if (a > 0 && b <= 0) turns++;
    }
    expect(turns).toBeLessThanOrEqual(2);
    expect(levels.size).toBeGreaterThan(5);
    expect(rim.size).toBeGreaterThan(5);

    reduced = true;
    magic.update(0.3);
    const held = emissive();
    magic.update(0.2);
    expect(emissive()).toBe(held);
    expect(uniform<number>(rune.mesh.material, 'uSpin').value).toBe(0);
    const frozen = uniform<number>(must(haze).mesh.material, 'uTime').value;
    magic.update(1);
    expect(uniform<number>(must(haze).mesh.material, 'uTime').value).toBe(frozen);
    expect(uniform<number>(must(haze).mesh.material, 'uStrength').value).toBeCloseTo(0.006, 6);
    // Putting a look back removes the copies.
    pulse.dispose();
    expect(body.material).toBeInstanceOf(MeshStandardMaterial);
  });

  it('every material takes a tint and an intensity and can change both', () => {
    const { renderer } = fakeRenderer();
    const magic = new MagicMaterials({ renderer: renderer });
    const body = new Mesh(new BoxGeometry(), new MeshStandardMaterial());
    const parent = new Group();
    parent.add(body);
    const glow = magic.fresnel(body, { tint: 0x112233, intensity: 2, power: 3 });
    expect(glow.shells).toHaveLength(1);
    expect(glow.shells[0]?.parent).toBe(parent);
    glow.setLook({ tint: 0xff0000 });
    glow.setLook({ intensity: 0.5 });
    expect(uniform<Color>(glow.material, 'uColor').value.r).toBe(1);
    glow.update(0, false);
    expect(uniform<number>(glow.material, 'uIntensity').value).toBe(0.5);
    glow.dispose();
    expect(parent.children).toEqual([body]);

    const rune = magic.runeDecal({ tint: 0x00ff00, intensity: 1.3, radius: 2 });
    rune.setLook({ tint: 0x0000ff });
    rune.setLook({ intensity: 0.7 });
    rune.update(3, false);
    expect(uniform<Color>(rune.mesh.material, 'uColor').value.b).toBe(1);
    expect(uniform<number>(rune.mesh.material, 'uIntensity').value).toBe(0.7);
    rune.dispose();

    const haze = must(magic.heatHaze({ tint: 0x00ff00, intensity: 1 }));
    haze.setLook({ intensity: 2 });
    haze.update(1, false);
    expect(uniform<number>(haze.mesh.material, 'uStrength').value).toBeCloseTo(0.024, 6);
    expect(uniform<number>(haze.mesh.material, 'uTime').value).toBe(0.5);

    const soft = magic.softParticle({ tint: 0x123456, intensity: 1, blend: 'alpha' });
    soft.setLook({ tint: 0xffffff });
    soft.setLook({ intensity: 2 });
    expect(uniform<number>(soft.mesh.material, 'uIntensity').value).toBe(2);
    expect(uniform<number>(soft.mesh.material, 'uAdditive').value).toBe(0);
    soft.dispose();

    const pulse = magic.pulse(body, { tint: 0x0000ff, intensity: 1, hz: 0 });
    pulse.setLook({ intensity: 2 });
    magic.update(0.1);
    expect((pulse.materials[0] as MeshStandardMaterial).emissiveIntensity).toBe(2);
    pulse.dispose();
  });
});

describe('soft particles and the depth pass', () => {
  it('depth is drawn only while a soft particle exists, once per frame, without the see-through things', () => {
    const { renderer, calls, seen } = fakeRenderer();
    const scene = new Scene();
    const solid = new Mesh(new BoxGeometry(), new MeshStandardMaterial());
    const glass = new Mesh(new BoxGeometry(), new MeshBasicMaterial({ transparent: true }));
    const hidden = new Mesh(new BoxGeometry(), new MeshBasicMaterial({ depthWrite: false }));
    scene.add(solid, glass, hidden);
    const magic = new MagicMaterials({ renderer: renderer });
    const camera = { near: 0.1, far: 200 } as unknown as Camera;

    // Nothing asked for depth yet: no pass.
    magic.depth.update(renderer, scene, camera);
    expect(calls).toEqual([]);

    const a = magic.softParticle({ size: 2 });
    const b = magic.softParticle({ soft: false });
    scene.add(a.mesh, b.mesh);
    expect(magic.depth.users).toBe(1); // the hard-edged puff takes no depth
    let visibleDuring: boolean[] = [];
    const draw1 = renderer.render;
    renderer.render = (s: Scene) => {
      visibleDuring = [solid.visible, glass.visible, hidden.visible, a.mesh.visible];
      draw1(s);
    };
    draw(a.mesh, renderer, 5, scene, camera);
    expect(calls).toEqual(['target', 'clear', 'render', 'target']);
    expect(visibleDuring).toEqual([true, false, false, false]);
    expect(seen).toEqual([true]);
    // Everything is back as it was, including the override material and the renderer's flags.
    expect([solid.visible, glass.visible, hidden.visible, a.mesh.visible]).toEqual([
      true,
      true,
      true,
      true,
    ]);
    expect(scene.overrideMaterial).toBeNull();
    expect(renderer.info.autoReset).toBe(true);
    expect(renderer.shadowMap.autoUpdate).toBe(true);
    expect(magic.depth.texture).toBeDefined();
    expect(uniform<number>(a.mesh.material, 'uDepthOn').value).toBe(1);
    expect(uniform<number>(a.mesh.material, 'uNear').value).toBe(0.1);
    expect(uniform<number>(a.mesh.material, 'uFar').value).toBe(200);
    // The nested render did not count as a new frame: a second puff in the same frame reuses it.
    draw(a.mesh, renderer, renderer.info.render.frame, scene, camera);
    expect(calls.filter((call) => call === 'render')).toHaveLength(1);
    expect(magic.stats().depthPasses).toBe(1);
    // The hard puff never touches depth.
    draw(b.mesh, renderer, 9, scene, camera);
    expect(uniform<number>(b.mesh.material, 'uDepthOn').value).toBe(0);

    a.dispose();
    expect(magic.depth.texture).toBeUndefined();
    magic.depth.acquire()();
    magic.dispose();
  });

  it('on Low a soft particle fades by its own rim: no depth, no depth pass', () => {
    const { renderer, calls } = fakeRenderer();
    const magic = new MagicMaterials({
      renderer: renderer,
      tier: 'low',
    });
    const puff = magic.softParticle();
    draw(puff.mesh, renderer, 1, new Scene(), { near: 0.1, far: 50 } as unknown as Camera);
    expect(calls).toEqual([]);
    expect(uniform<number>(puff.mesh.material, 'uDepthOn').value).toBe(0);
    expect(magic.stats().depthPasses).toBe(0);
  });

  it('releasing depth twice counts once', () => {
    const { renderer } = fakeRenderer();
    const magic = new MagicMaterials({ renderer: renderer });
    const release = magic.depth.acquire();
    magic.depth.acquire();
    release();
    release();
    expect(magic.depth.users).toBe(1);
  });
});
