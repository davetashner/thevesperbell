// Stand-in figures for the spell VFX testbed (mw-e29.10, `?spells`): a caster, a target and a summoned
// body that dissolves in and out (the magical materials' dissolve, so the summon slot's dissolve
// seconds are seen on a real dissolving mesh). Plain capsules and boxes: no assets.
//
// Render-only; verified by e2e/spell-vfx.spec.ts.

import type { Dissolve, MagicMaterials } from '../magic-materials/index';
import type { Vec3 } from '@sim/index';
import { BoxGeometry, CapsuleGeometry, Group, Mesh, MeshStandardMaterial, type Scene } from 'three';

function figure(color: number, body: 'capsule' | 'box'): Group {
  const group = new Group();
  const material = new MeshStandardMaterial({ color, roughness: 0.8 });
  const mesh = new Mesh(
    body === 'capsule' ? new CapsuleGeometry(0.28, 1.0, 4, 12) : new BoxGeometry(0.7, 1.6, 0.5),
    material,
  );
  mesh.position.y = body === 'capsule' ? 0.9 : 0.8;
  group.add(mesh);
  return group;
}

/** Where the figures stand, from the demo's stage. */
export interface SpellDemoFiguresState {
  readonly caster: Vec3;
  readonly target: Vec3;
  readonly summoned: {
    readonly at: Vec3;
    readonly present: boolean;
    /** 0 whole … 1 gone. */
    readonly dissolve: number;
  };
}

/** The testbed's figures; `update` places them each frame from the demo. */
export class SpellDemoFigures {
  readonly #caster = figure(0x6a5a8a, 'capsule');
  readonly #target = figure(0x7a6a58, 'box');
  readonly #summoned = figure(0x9fd8e0, 'capsule');
  readonly #dissolve: Dissolve;
  readonly #group = new Group();

  constructor(scene: Scene, magic: MagicMaterials) {
    this.#group.name = 'spell-vfx-demo';
    this.#group.add(this.#caster, this.#target, this.#summoned);
    scene.add(this.#group);
    this.#dissolve = magic.dissolve(this.#summoned, { tint: 0x8b5cf6 });
  }

  update(stage: SpellDemoFiguresState): void {
    const { caster, target, summoned } = stage;
    this.#caster.position.set(caster.x, caster.y, caster.z);
    this.#target.position.set(target.x, target.y, target.z);
    this.#summoned.position.set(summoned.at.x, summoned.at.y, summoned.at.z);
    this.#dissolve.setProgress(summoned.dissolve);
    this.#summoned.visible = summoned.present && summoned.dissolve < 1;
  }

  dispose(): void {
    this.#group.removeFromParent();
  }
}
