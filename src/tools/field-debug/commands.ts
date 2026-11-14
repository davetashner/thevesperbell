// The field debug overlay's console commands (mw-e03.29):
//   fields [layer|off]           show the temperature, moisture, gas, charge or light layer; off hides
//   inspect                      inspect the entity under the crosshair
//   inspect <id>|none            inspect an entity by id, or stop
//   inspect set <key> <value>    edit a property of the inspected entity (the sim applies it next tick)
//   stim <element> <intensity> [radius]   deliver a stimulus where the crosshair points
// `fields` and `inspect` only change what the overlay reads; `inspect set` and `stim` go out as sim
// debug commands through `host.submit`, so they are applied next tick and recorded in replays.

import {
  DEBUG_STIM_ELEMENTS,
  MAX_STIM_INTENSITY,
  MAX_STIM_RADIUS,
  propertyCommand,
  stimCommand,
  WORLD_PROPERTY_KEYS,
  type EntityId,
} from '@sim/index';
import { z } from 'zod';
import { propertyValue, type ConsoleHost } from '../console/builtins';
import { ConsoleError, type CommandRegistry } from '../console/registry';
import type { FieldDebug } from './controller';
import { FIELD_LAYERS, type FieldLayer, type Ray } from './model';

export interface FieldDebugCommandOptions {
  readonly debug: FieldDebug;
  /** The ray through the crosshair, for `inspect` with no id. */
  readonly crosshair: () => Ray | undefined;
  readonly isAlive: (entity: EntityId) => boolean;
}

/** `stim` with no radius. */
export const DEFAULT_STIM_RADIUS = 2;

function describe(debug: FieldDebug): string {
  const selected = debug.selected === undefined ? 'none' : `#${String(debug.selected)}`;
  return `fields ${debug.layer ?? 'off'} · inspecting ${selected}`;
}

/** Registers `fields`, `inspect` and `stim` on `registry`. */
export function registerFieldDebugCommands(
  registry: CommandRegistry<ConsoleHost>,
  { debug, crosshair, isAlive }: FieldDebugCommandOptions,
): void {
  registry.registerCommand({
    name: 'fields',
    summary: 'debug overlay: show a field layer (temperature, moisture, gas, charge, light) or off',
    usage: `[${FIELD_LAYERS.join('|')}|off]`,
    args: z.tuple([z.string().optional()]),
    complete: (index) => (index === 0 ? [...FIELD_LAYERS, 'off'] : []),
    run: ([word]) => {
      if (word === undefined) return describe(debug);
      if (word === 'off') {
        debug.layer = undefined;
        return describe(debug);
      }
      if (!(FIELD_LAYERS as readonly string[]).includes(word)) {
        throw new ConsoleError([
          `unknown layer "${word}"; layers: ${FIELD_LAYERS.join(', ')}, off`,
        ]);
      }
      debug.layer = word as FieldLayer;
      return describe(debug);
    },
  });

  registry.registerCommand({
    name: 'inspect',
    summary: 'debug overlay: inspect an entity’s properties; inspect set <key> <value> edits one',
    usage: '[<entityId>|none] | set <property> <value>',
    args: z.array(z.string()).max(3),
    complete: (index) => (index === 0 ? ['none', 'set'] : index === 1 ? WORLD_PROPERTY_KEYS : []),
    run: ([word, key, text], host) => {
      if (word === undefined) {
        const ray = crosshair();
        if (ray === undefined || debug.pick(ray) === undefined) {
          throw new ConsoleError(['no entity with properties under the crosshair']);
        }
        return describe(debug);
      }
      if (word === 'none') {
        debug.selected = undefined;
        return describe(debug);
      }
      if (word === 'set') {
        const target = debug.selected;
        if (target === undefined || !isAlive(target)) {
          throw new ConsoleError(['nothing inspected: inspect <id> first']);
        }
        if (key === undefined || text === undefined) {
          throw new ConsoleError(['usage: inspect set <property> <value>']);
        }
        try {
          host.submit(propertyCommand(target, key, propertyValue(text)));
        } catch (error) {
          // Only the command builder's RangeErrors reach here.
          throw new ConsoleError([(error as Error).message]);
        }
        return `entity ${String(target)}: ${key} = ${text}`;
      }
      const entity = Number(word);
      if (!Number.isInteger(entity) || entity < 1 || !isAlive(entity) || key !== undefined) {
        throw new ConsoleError([`no entity ${word}`]);
      }
      debug.selected = entity;
      return describe(debug);
    },
  });

  registry.registerCommand({
    name: 'stim',
    summary: 'deliver a stimulus where the crosshair points (stim heat 500 2)',
    usage: `<${DEBUG_STIM_ELEMENTS.join('|')}> <intensity, max ${String(MAX_STIM_INTENSITY)}> [radius m, default ${String(DEFAULT_STIM_RADIUS)}, max ${String(MAX_STIM_RADIUS)}]`,
    args: z.tuple([
      z.string(),
      z.coerce.number<string>().positive(),
      z.coerce.number<string>().positive().optional(),
    ]),
    complete: (index) => (index === 0 ? DEBUG_STIM_ELEMENTS : []),
    run: ([element, intensity, radius = DEFAULT_STIM_RADIUS], host) => {
      const at = host.cursorPoint?.() ?? host.spawnPoint();
      try {
        host.submit(stimCommand(element, at, radius, intensity));
      } catch (error) {
        throw new ConsoleError([(error as Error).message]);
      }
      return `${element} ${String(intensity)} radius ${String(radius)} m at ${String(Math.round(at.x * 100) / 100)} ${String(Math.round(at.y * 100) / 100)} ${String(Math.round(at.z * 100) / 100)}`;
    },
  });
}
