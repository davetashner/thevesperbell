// The field debug overlay's entry point (mw-e03.29), loaded by src/main.ts in the debug console's
// chunk (only when the console is enabled, see src/game/debug-console-gate.ts), so a release build
// (VESPER_DEBUG_CONSOLE=off) neither ships nor can enable it. It builds the controller, the
// drawing (src/render/debug/field-overlay.ts) and the console commands, and publishes what it drew
// to #app[data-field-debug] for the e2e.
//
// Cost while off: one `frame()` call per rendered frame that returns at once, plus one hidden
// 3D group and one hidden panel element. Cost while on: one pass over the element field's chunks
// (the layer), at most 225 light samples every few ticks (the light layer), and the panel text.

import type { Vec3, World } from '@sim/index';
import { createFieldOverlay, type FieldOverlay } from '@render/debug/field-overlay';
import type { Camera, Object3D } from 'three';
import type { ConsoleHost } from '../console/builtins';
import type { CommandRegistry } from '../console/registry';
import { cameraRay } from '../ai-debug/start';
import { registerFieldDebugCommands } from './commands';
import { FieldDebug } from './controller';

export interface FieldDebugStartOptions {
  readonly world: World<never>;
  readonly registry: CommandRegistry<ConsoleHost>;
  /** Where the overlay's 3D objects go (the view's scene). */
  readonly scene: { add(object: Object3D): unknown };
  readonly camera: Camera;
  /** The page's game root: the panel goes over it. */
  readonly root: HTMLElement;
  readonly light?: { levelAt(point: Vec3): number };
  readonly cursorPoint?: () => Vec3 | undefined;
  /** Receives the overlay's readout (JSON) whenever it changes. */
  readonly publish?: (json: string) => void;
}

export interface FieldDebugSession {
  readonly debug: FieldDebug;
  readonly overlay: FieldOverlay;
  /** Draws the overlay; call every rendered frame. */
  frame(): void;
  dispose(): void;
}

/** Starts the field debug overlay (off until `fields <layer>` or `inspect`). */
export function startFieldDebug(options: FieldDebugStartOptions): FieldDebugSession {
  const { world, root, camera } = options;
  const panel = root.ownerDocument.createElement('pre');
  panel.dataset['testid'] = 'field-debug-panel';
  panel.style.cssText =
    'position:absolute;top:56px;left:8px;margin:0;padding:6px 8px;box-sizing:border-box;' +
    'max-width:min(380px,calc(100% - 16px));max-height:70%;overflow:hidden;display:none;' +
    'pointer-events:none;z-index:5;background:rgba(0,0,0,0.62);color:#e8e8e8;' +
    'font:11px/1.35 ui-monospace,Menlo,monospace;white-space:pre-wrap;word-break:break-word;';
  root.append(panel);
  const overlay = createFieldOverlay({ panel });
  options.scene.add(overlay.object);
  const debug = new FieldDebug({
    world,
    viewer: () => {
      camera.updateMatrixWorld();
      const { x, y, z } = camera.position;
      return { x, y, z };
    },
    ...(options.light !== undefined && { light: options.light }),
    ...(options.cursorPoint !== undefined && { cursorPoint: options.cursorPoint }),
  });
  registerFieldDebugCommands(options.registry, {
    debug,
    crosshair: () => cameraRay(camera, 0, 0),
    isAlive: (entity) => world.isAlive(entity),
  });
  let published = '';
  return {
    debug,
    overlay,
    frame() {
      const frame = debug.frame();
      overlay.update(frame);
      const json = JSON.stringify({
        selected: debug.selected ?? null,
        ...overlay.stats(),
      });
      if (json === published) return;
      published = json;
      options.publish?.(json);
    },
    dispose() {
      debug.dispose();
      overlay.dispose();
      panel.remove();
    },
  };
}
