// The world state tools' entry point (mw-e27.6), loaded by src/main.ts in the debug console's chunk
// (only when the console is enabled, see src/game/debug-console-gate.ts), so a release build
// (VESPER_DEBUG_CONSOLE=off) neither ships nor can enable it. It registers the console commands and
// a panel over the game (`state.panel on`) listing the facts and the levels' deltas.
//
// Cost while off: one `frame()` call per rendered frame that returns at once, plus one hidden panel
// element. Cost while on: one pass over the facts and level deltas every PANEL_REFRESH_FRAMES.

import { levelDeltasOf, type World } from '@sim/index';
import type { SaveRegistry } from '@game/save/format';
import type { SaveStore } from '@game/save/storage';
import { z } from 'zod';
import type { ConsoleHost } from '../console/builtins';
import type { CommandRegistry } from '../console/registry';
import { registerWorldStateCommands } from './commands';
import { readSaveState, type SaveStateResult } from './save-state';

/** Rendered frames between panel refreshes. */
export const PANEL_REFRESH_FRAMES = 20;

/** Most fact lines the panel shows; the rest are counted. */
export const PANEL_MAX_FACTS = 40;

export interface WorldStateStartOptions {
  readonly world: World<never>;
  readonly registry: CommandRegistry<ConsoleHost>;
  /** The page's game root: the panel goes over it. */
  readonly root: HTMLElement;
  readonly store: Pick<SaveStore, 'read'>;
  readonly saves: SaveRegistry;
  /** Receives the panel's readout (JSON) whenever it changes. */
  readonly publish?: (json: string) => void;
}

export interface WorldStateSession {
  /** Refreshes the panel; call every rendered frame. */
  frame(): void;
  dispose(): void;
}

/** The panel's text for the world now. */
export function panelLines(world: World<never>): string[] {
  const facts = world.facts.entries();
  const levels = levelDeltasOf(world).capture(world);
  const lines = [`facts (${String(facts.length)})`];
  for (const [key, value] of facts.slice(0, PANEL_MAX_FACTS)) {
    lines.push(`  ${key} = ${JSON.stringify(value)}`);
  }
  if (facts.length > PANEL_MAX_FACTS) {
    lines.push(`  ... ${String(facts.length - PANEL_MAX_FACTS)} more (facts.list)`);
  }
  lines.push(`level deltas (${String(levels.length)})`);
  for (const { level, entities, spawned } of levels) {
    lines.push(`  ${level}: ${String(entities.length)} changed, ${String(spawned.length)} spawned`);
  }
  return lines;
}

/** Starts the world state commands and panel (panel off until `state.panel on`). */
export function startWorldState(options: WorldStateStartOptions): WorldStateSession {
  const { world, root, store, saves } = options;
  const panel = root.ownerDocument.createElement('pre');
  panel.dataset['testid'] = 'world-state-panel';
  panel.style.cssText =
    'position:absolute;top:56px;right:8px;margin:0;padding:6px 8px;box-sizing:border-box;' +
    'max-width:min(380px,calc(100% - 16px));max-height:70%;overflow:hidden;display:none;' +
    'pointer-events:none;z-index:5;background:rgba(0,0,0,0.62);color:#e8e8e8;' +
    'font:11px/1.35 ui-monospace,Menlo,monospace;white-space:pre-wrap;word-break:break-word;';
  root.append(panel);
  let on = false;
  let frames = 0;
  let published = '';
  const refresh = (): void => {
    const lines = panelLines(world);
    panel.textContent = lines.join('\n');
    const json = JSON.stringify(lines);
    if (json === published) return;
    published = json;
    options.publish?.(json);
  };

  registerWorldStateCommands(options.registry, {
    world,
    readSlot: async (slot): Promise<SaveStateResult | undefined> => {
      const read = await store.read(slot);
      if (read.status === 'empty') return undefined;
      if (read.status === 'corrupt') return { ok: false, reason: read.error.message };
      return readSaveState(saves, read.bytes);
    },
  });
  options.registry.registerCommand({
    name: 'state.panel',
    summary: 'world state: show or hide the panel of facts and level deltas',
    usage: '[on|off]',
    args: z.tuple([z.enum(['on', 'off']).optional()]),
    complete: (index) => (index === 0 ? ['on', 'off'] : []),
    run: ([word]) => {
      on = word === undefined ? !on : word === 'on';
      panel.style.display = on ? 'block' : 'none';
      if (on) refresh();
      else published = '';
      return `world state panel ${on ? 'on' : 'off'}`;
    },
  });
  return {
    frame() {
      if (!on || ++frames % PANEL_REFRESH_FRAMES !== 0) return;
      refresh();
    },
    dispose() {
      panel.remove();
    },
  };
}
