// Per-object material copies for the magical looks (mw-e29.7). A creature's materials are shared by
// every creature wearing them, so a look that changes one (a dissolve, a pulse) works on copies the
// object owns and puts the originals back afterwards: one skeleton dissolving never touches the
// others. Render-only; verified by tests/integration/magic-materials.test.ts and the e2e specs.

import { Mesh, MeshStandardMaterial, type Material, type Object3D } from 'three';

interface Original {
  readonly mesh: Mesh;
  readonly material: Material | Material[];
}

/** The standard materials under a root, copied for the root alone. */
export interface MaterialCopies {
  readonly meshes: Mesh[];
  readonly clones: MeshStandardMaterial[];
  /** Puts every mesh's own material back and frees the copies. */
  restore(): void;
}

/** Copies every MeshStandardMaterial under `root` (other materials are left shared). */
export function cloneMaterials(root: Object3D): MaterialCopies {
  const originals: Original[] = [];
  const meshes: Mesh[] = [];
  const clones: MeshStandardMaterial[] = [];
  root.traverse((child) => {
    if (!(child instanceof Mesh)) return;
    const mesh = child as Mesh;
    const source = mesh.material;
    const copy = (material: Material): Material => {
      if (!(material instanceof MeshStandardMaterial)) return material;
      const clone = material.clone();
      clones.push(clone);
      return clone;
    };
    const made = clones.length;
    const next = Array.isArray(source) ? source.map(copy) : copy(source);
    if (clones.length === made) return;
    originals.push({ mesh, material: source });
    meshes.push(mesh);
    mesh.material = next;
  });
  return {
    meshes,
    clones,
    restore() {
      for (const { mesh, material } of originals) mesh.material = material;
      for (const clone of clones) clone.dispose();
      originals.length = 0;
      clones.length = 0;
      meshes.length = 0;
    },
  };
}
