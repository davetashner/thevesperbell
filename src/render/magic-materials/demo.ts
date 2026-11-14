// The magical materials testbed scene (mw-e29.7): builds, in front of the camera, one of each
// material of the library on test figures, so a screenshot shows the whole set and the e2e can check
// that every shader compiles and draws. Layout and parsing are in src/tools/magic-demo; the five
// dissolving figures all share ONE material, which shows that dissolving one never dissolves another.
//
// Render-only; verified by e2e/magic-materials.spec.ts and tests/integration/magic-materials.test.ts.

import {
  BoxGeometry,
  CapsuleGeometry,
  Color,
  Group,
  Mesh,
  MeshStandardMaterial,
  PointLight,
  SphereGeometry,
  type Camera,
  type Object3D,
  type Scene,
} from 'three';
import {
  DEMO_SLOTS,
  DISSOLVE_STAGES,
  dissolveLoop,
  cameraPose,
  focusItems,
  hazePlacements,
  slotPosition,
  STAGE_FORWARD,
  STAGE_ORIGIN,
  type DemoItem,
  type DemoFocus,
  type MagicDemoMode,
} from './demo-layout';
import { type Dissolve, type MagicMaterials } from './index';

/** The Forgotten's cold eye-glow: the tint the death dissolve wears (style bible §5.1). */
export const DEATH_TINT = 0x9fd8e0;

/** A skeleton-ish test figure: bone-coloured capsule body, head and arms; feet at the origin. */
function figure(material: MeshStandardMaterial): Group {
  const group = new Group();
  const parts: [Mesh, number, number, number][] = [
    [new Mesh(new CapsuleGeometry(0.26, 0.8, 4, 12), material), 0, 0.95, 0],
    [new Mesh(new SphereGeometry(0.2, 14, 10), material), 0, 1.68, 0],
    [new Mesh(new BoxGeometry(0.14, 0.7, 0.14), material), -0.46, 1.0, 0],
    [new Mesh(new BoxGeometry(0.14, 0.7, 0.14), material), 0.46, 1.0, 0],
  ];
  for (const [mesh, x, y, z] of parts) {
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  return group;
}

export interface MagicDemoStats {
  readonly mode: MagicDemoMode;
  readonly placed: boolean;
  readonly items: readonly DemoItem[];
  /** Dissolve progress of each dissolving figure, in the order of the demo. */
  readonly dissolves: readonly number[];
  /** True while the material every dissolving figure was made with has not been patched. */
  readonly sharedMaterialUntouched: boolean;
  /** Material copies the dissolving figures own between them. */
  readonly copies: number;
}

export class MagicDemo {
  readonly #scene: Scene;
  readonly #magic: MagicMaterials;
  readonly #mode: MagicDemoMode;
  readonly #focus: DemoFocus;
  readonly #root = new Group();
  readonly #shared = new MeshStandardMaterial({ color: new Color(0xd8cfb4), roughness: 0.9 });
  readonly #dissolves: { dissolve: Dissolve; stage: number | undefined }[] = [];
  readonly #items: DemoItem[] = [];
  #placed = false;
  #seconds = 0;

  constructor(
    scene: Scene,
    magic: MagicMaterials,
    mode: MagicDemoMode,
    focus: DemoFocus = 'overview',
  ) {
    this.#focus = focus;
    this.#scene = scene;
    this.#magic = magic;
    this.#mode = mode;
    this.#root.name = 'magic-demo';
    scene.add(this.#root);
  }

  /** Builds the stage: a dark floor and wall, a light, and the materials on it. */
  #place(): void {
    this.#placed = true;
    const origin = STAGE_ORIGIN;
    const floor = new Mesh(
      new BoxGeometry(30, 0.4, 16),
      new MeshStandardMaterial({ color: 0x3a3a44, roughness: 0.9 }),
    );
    floor.position.set(origin.x, origin.y - 0.2, origin.z);
    floor.receiveShadow = true;
    const wall = new Mesh(
      new BoxGeometry(30, 10, 0.4),
      new MeshStandardMaterial({ color: 0x30323f, roughness: 1 }),
    );
    wall.position.set(origin.x, origin.y + 5, origin.z - 5.2);
    const light = new PointLight(0xfff1d6, 160, 40, 1.4);
    light.position.set(origin.x + 2, origin.y + 6, origin.z + 4);
    this.#root.add(floor, wall, light);
    if (this.#mode === 'haze') {
      this.#placeHaze(origin, STAGE_FORWARD);
      return;
    }
    const shown = focusItems(this.#focus);
    for (const slot of DEMO_SLOTS) {
      if (!shown.includes(slot.item)) continue;
      const at = slotPosition(slot, origin, STAGE_FORWARD);
      this.#items.push(slot.item);
      this.#build(slot.item, at);
    }
  }

  #add(object: Object3D, at: { x: number; y: number; z: number }, lift = 0): void {
    object.position.set(at.x, at.y + lift, at.z);
    this.#root.add(object);
  }

  #build(item: DemoItem, at: { x: number; y: number; z: number }): void {
    const magic = this.#magic;
    if (item.startsWith('dissolve-')) {
      const body = figure(this.#shared);
      this.#add(body, at);
      const index = item === 'dissolve-live' ? undefined : Number(item.slice('dissolve-'.length));
      const dissolve = magic.dissolve(body, {
        tint: DEATH_TINT,
        intensity: 1,
        feet: at.y,
        height: 1.9,
        seed: this.#dissolves.length + 1,
      });
      this.#dissolves.push({ dissolve, stage: index });
      return;
    }
    switch (item) {
      case 'fresnel': {
        const ball = new Mesh(
          new SphereGeometry(0.75, 32, 20),
          new MeshStandardMaterial({ color: 0x23233a, roughness: 0.5, metalness: 0.2 }),
        );
        ball.castShadow = true;
        this.#add(ball, at, 0.9);
        magic.fresnel(ball, { tint: 0x6f95ff, intensity: 1.6, power: 2.2, pulseHz: 0.6 });
        break;
      }
      case 'pulse': {
        const column = new Mesh(
          new CapsuleGeometry(0.4, 0.9, 6, 16),
          new MeshStandardMaterial({ color: 0x8a8478, roughness: 0.7 }),
        );
        column.castShadow = true;
        this.#add(column, at, 0.85);
        magic.pulse(column, { tint: 0xff7a1a, intensity: 0.8, hz: 1.2 });
        break;
      }
      case 'rune': {
        const decal = magic.runeDecal({
          tint: 0x9fd8e0,
          intensity: 0.85,
          radius: 1.15,
          spin: 0.05,
        });
        this.#add(decal.mesh, at, 0.03);
        break;
      }
      case 'haze': {
        this.#backdrop(at, 1.6);
        const haze = magic.heatHaze({ tint: 0xffb066, intensity: 2.5, size: 2.0 });
        if (haze !== undefined) this.#add(haze.mesh, at, 1.15);
        break;
      }
      case 'soft':
      case 'hard': {
        // A pillar to stand in the puff, and the floor under it: both cut a hard-edged puff in a
        // line, and a soft one fades out ahead of them.
        const pillar = new Mesh(
          new BoxGeometry(0.3, 2.0, 0.3),
          new MeshStandardMaterial({ color: 0x5b5a54, roughness: 0.95 }),
        );
        pillar.castShadow = true;
        this.#add(pillar, at, 1.0);
        const puff = magic.softParticle({
          tint: 0x8b5cf6,
          intensity: 1.5,
          size: 2.4,
          softness: 0.8,
          soft: item === 'soft',
        });
        this.#add(puff.mesh, at, 0.35);
        break;
      }
      default:
        break;
    }
  }

  /** A row of coloured bars standing behind a haze, so the bending shows. */
  #backdrop(at: { x: number; y: number; z: number }, width: number): void {
    const colours = [0xd9b26f, 0x3d6bff, 0xe5dcc5, 0xc8331a, 0x2ec4a6, 0xffe9a8];
    colours.forEach((colour, i) => {
      const bar = new Mesh(
        new BoxGeometry(width / colours.length, 2.4, 0.1),
        new MeshStandardMaterial({ color: colour, roughness: 0.8 }),
      );
      bar.position.set(
        at.x + (i - (colours.length - 1) / 2) * (width / colours.length),
        at.y + 1.2,
        at.z - 1.2,
      );
      this.#root.add(bar);
    });
  }

  #placeHaze(
    origin: { x: number; y: number; z: number },
    forward: { x: number; y: number; z: number },
  ): void {
    this.#backdrop({ x: origin.x, y: origin.y, z: origin.z }, 6);
    for (const spot of hazePlacements(origin, forward)) {
      const haze = this.#magic.heatHaze({ tint: 0xffb066, intensity: 2, size: 3.2 });
      if (haze !== undefined) this.#add(haze.mesh, spot);
    }
  }

  /** Moves the demo on and points `camera` at the stage; call each frame, after the game's camera. */
  update(seconds: number, camera: Camera): void {
    if (!this.#placed) this.#place();
    const pose = cameraPose(STAGE_ORIGIN, this.#focus);
    camera.position.set(pose.position.x, pose.position.y, pose.position.z);
    camera.lookAt(pose.target.x, pose.target.y, pose.target.z);
    this.#seconds += seconds;
    for (const { dissolve, stage } of this.#dissolves) {
      dissolve.setProgress(
        stage === undefined ? dissolveLoop(this.#seconds) : (DISSOLVE_STAGES[stage] ?? 0),
      );
    }
    this.#magic.update(seconds);
  }

  stats(): MagicDemoStats {
    const sources = new Set<unknown>();
    for (const { dissolve } of this.#dissolves) {
      for (const material of dissolve.materials) sources.add(material);
    }
    return {
      mode: this.#mode,
      placed: this.#placed,
      items: this.#items,
      dissolves: this.#dissolves.map(({ dissolve }) => Number(dissolve.progress.toFixed(3))),
      // The one material the figures were made with is never patched: each figure dissolves on
      // copies of its own.
      sharedMaterialUntouched:
        this.#shared.onBeforeCompile === MeshStandardMaterial.prototype.onBeforeCompile,
      copies: sources.size,
    };
  }

  dispose(): void {
    for (const { dissolve } of this.#dissolves) dissolve.dispose();
    this.#dissolves.length = 0;
    this.#root.removeFromParent();
    this.#scene.remove(this.#root);
  }
}
