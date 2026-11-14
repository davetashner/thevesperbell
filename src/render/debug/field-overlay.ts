// The field debug overlay's drawing (mw-e03.29): one instanced box per element-field cell or light
// tile (translucent; a weak cell is a dim colour, a strong one bright), and a text panel (layer legend,
// property inspector, stimulus timeline, signal wires). It draws a model built by
// src/tools/field-debug from sim reads and never reads or feeds the sim.
//
// Cheap: one InstancedMesh with MAX_FIELD_CELLS preallocated slots (a frame only writes the cells
// it has and sets `count`), and the panel's text is rewritten only when it changed.
//
// Render-only glue (excluded from unit coverage with the rest of src/render): the e2e
// (e2e/field-debug.spec.ts) checks it in the browser, and tests/integration/field-debug.test.ts
// drives it headless over real Three.js objects (building them needs no GPU).

import { BoxGeometry, Color, Group, InstancedMesh, Matrix4, MeshBasicMaterial } from 'three';

/** Most cells drawn at once (the overlay's instance budget). */
export const MAX_FIELD_CELLS = 2048;

/** One drawn cell: a box centred at (x, y, z), `colour` 0xRRGGBB already scaled by strength. */
export interface CellMark {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly size: number;
  readonly height: number;
  readonly colour: number;
  /** The channel value shown (deviation from ambient, or the light level). */
  readonly value: number;
}

/** What the overlay needs of a frame (structurally the tools layer's `FieldDebugFrame`). */
export interface FieldOverlayFrame {
  readonly view:
    | { readonly layer: string; readonly cells: readonly CellMark[]; readonly truncated: boolean }
    | undefined;
  readonly panel: {
    readonly title: string;
    readonly sections: readonly { readonly heading: string; readonly lines: readonly string[] }[];
  };
}

export interface FieldOverlay {
  /** Add to the view scene. */
  readonly object: Group;
  /** Draws `frame`, or hides everything for undefined. */
  update(frame: FieldOverlayFrame | undefined): void;
  /** What was drawn last frame, for the e2e probe. */
  stats(): { cells: number; layer: string | null };
  dispose(): void;
}

export interface FieldOverlayOptions {
  /** The element the panel's text goes in. */
  readonly panel: HTMLElement;
}

/** The overlay's panel text: the title, then each section's heading and lines. */
export function panelText(panel: FieldOverlayFrame['panel']): string {
  return [
    panel.title,
    ...panel.sections.flatMap((section) => [`-- ${section.heading}`, ...section.lines]),
  ].join('\n');
}

export function createFieldOverlay({ panel }: FieldOverlayOptions): FieldOverlay {
  const geometry = new BoxGeometry(1, 1, 1);
  const material = new MeshBasicMaterial({
    opacity: 0.35,
    transparent: true,
    depthWrite: false,
    toneMapped: false,
  });
  const mesh = new InstancedMesh(geometry, material, MAX_FIELD_CELLS);
  mesh.count = 0;
  mesh.frustumCulled = false;
  mesh.renderOrder = 10;
  const object = new Group();
  object.name = 'field-debug';
  object.visible = false;
  object.add(mesh);
  const matrix = new Matrix4();
  const colour = new Color();
  let text = '';
  let drawn = 0;
  let layer: string | null = null;
  return {
    object,
    update(frame) {
      if (frame === undefined) {
        object.visible = false;
        panel.style.display = 'none';
        drawn = 0;
        layer = null;
        text = '';
        return;
      }
      panel.style.display = 'block';
      const next = panelText(frame.panel);
      if (next !== text) panel.textContent = text = next;
      const cells = frame.view?.cells ?? [];
      const count = Math.min(cells.length, MAX_FIELD_CELLS);
      cells.slice(0, count).forEach((cell, i) => {
        matrix.makeScale(cell.size, cell.height, cell.size).setPosition(cell.x, cell.y, cell.z);
        mesh.setMatrixAt(i, matrix);
        mesh.setColorAt(i, colour.setHex(cell.colour));
      });
      mesh.count = count;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor !== null) mesh.instanceColor.needsUpdate = true;
      object.visible = count > 0;
      drawn = count;
      layer = frame.view?.layer ?? null;
    },
    stats: () => ({ cells: drawn, layer }),
    dispose() {
      mesh.dispose();
      geometry.dispose();
      material.dispose();
      object.removeFromParent();
    },
  };
}
