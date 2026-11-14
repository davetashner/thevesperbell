// The field debug overlay's state (mw-e03.29): the layer shown (a heatmap of the element field's
// temperature, moisture, gas or charge, or the light level grid), the entity the property inspector
// is on, and the panel text (inspector, stimulus log timeline, signal wires). While everything is
// off it holds no listener and builds nothing: `frame()` is one comparison, and in a release build
// this whole module is not shipped (it loads with the debug console).
//
// It only reads the sim. The inspector's live edit (`inspect set`) and `stim` go out as debug
// commands through the console's `submit`, so the sim applies them on its next tick and replays
// record them.

import {
  ElementFieldComponent,
  elementFieldOf,
  recordStimulusLog,
  type ElementField,
  type EntityId,
  type StimulusLog,
  type StimulusResolution,
  type Vec3,
  type World,
} from '@sim/index';
import {
  fieldLayerView,
  inspectRows,
  lightLayerView,
  pickables,
  pickEntity,
  stimulusLines,
  wireLines,
  type FieldLayer,
  type LayerView,
  type Ray,
} from './model';

export interface FieldDebugOptions {
  readonly world: World<never>;
  /** The level's light, for the light layer; without it that layer says so. */
  readonly light?: { levelAt(point: Vec3): number };
  /** Where the viewer is: field cells are drawn around it, the light grid under it. */
  readonly viewer: () => Vec3;
  /** The point under the crosshair, the light grid's centre; absent or undefined: under the viewer. */
  readonly cursorPoint?: () => Vec3 | undefined;
}

/** The panel's text: a title and a few sections of lines. */
export interface FieldPanel {
  readonly title: string;
  readonly sections: readonly { readonly heading: string; readonly lines: readonly string[] }[];
}

/** What the overlay draws this frame. */
export interface FieldDebugFrame {
  readonly view: LayerView | undefined;
  readonly panel: FieldPanel;
}

/** Light grids rebuild at most this often, in sim ticks (a grid is 225 light samples). */
export const LIGHT_REFRESH_TICKS = 6;

export class FieldDebug {
  readonly #o: FieldDebugOptions;
  #layer: FieldLayer | undefined;
  #selected: EntityId | undefined;
  #log: StimulusLog | undefined;
  /** The log's entries while it records, else none (the same array the log appends to). */
  #entries: readonly StimulusResolution[] = [];
  #light: { view: LayerView; tick: number; key: string } | undefined;

  constructor(options: FieldDebugOptions) {
    this.#o = options;
  }

  get layer(): FieldLayer | undefined {
    return this.#layer;
  }

  /** Shows `layer` (or none). Turning the first thing on starts the stimulus log. */
  set layer(layer: FieldLayer | undefined) {
    this.#layer = layer;
    this.#light = undefined;
    this.#sync();
  }

  get selected(): EntityId | undefined {
    return this.#selected;
  }

  /** The inspected entity (or none). */
  set selected(entity: EntityId | undefined) {
    this.#selected = entity;
    this.#sync();
  }

  /** Anything is showing. */
  get enabled(): boolean {
    return this.#layer !== undefined || this.#selected !== undefined;
  }

  /** The nearest property-holding entity `ray` points at, selected; undefined when none. */
  pick(ray: Ray): EntityId | undefined {
    const picked = pickEntity(ray, pickables(this.#o.world));
    if (picked !== undefined) this.selected = picked;
    return picked;
  }

  /** Starts or stops the stimulus log with the overlay: off, nothing listens. */
  #sync(): void {
    if (this.enabled && this.#log === undefined) {
      this.#log = recordStimulusLog(this.#o.world, 64);
      this.#entries = this.#log.entries;
    } else if (!this.enabled && this.#log !== undefined) {
      this.#log.stop();
      this.#log = undefined;
      this.#entries = [];
    }
  }

  #field(): ElementField | undefined {
    return this.#o.world.isRegistered(ElementFieldComponent)
      ? elementFieldOf(this.#o.world)
      : undefined;
  }

  #view(): LayerView | undefined {
    const layer = this.#layer;
    if (layer === undefined) return undefined;
    const { world, viewer, light } = this.#o;
    if (layer === 'light') {
      if (light === undefined) return undefined;
      const centre = this.#o.cursorPoint?.() ?? viewer();
      const key = `${String(Math.floor(centre.x))},${String(Math.floor(centre.z))}`;
      const cached = this.#light;
      if (cached?.key === key && world.tick - cached.tick < LIGHT_REFRESH_TICKS) {
        return cached.view;
      }
      const view = lightLayerView(light, centre);
      this.#light = { view, tick: world.tick, key };
      return view;
    }
    const field = this.#field();
    return field === undefined ? undefined : fieldLayerView(field, layer, viewer());
  }

  #panel(view: LayerView | undefined): FieldPanel {
    const { world } = this.#o;
    const sections: { heading: string; lines: string[] }[] = [];
    if (this.#layer !== undefined) {
      const lines =
        view === undefined
          ? [`no ${this.#layer === 'light' ? 'light field' : 'element field'} in this scene`]
          : [
              `${String(view.cells.length)} cells${view.truncated ? ' (nearest shown)' : ''}, peak ${String(Math.round(view.peak * 100) / 100)} ${view.unit}`,
            ];
      sections.push({ heading: `layer: ${this.#layer}`, lines });
    }
    if (this.#selected !== undefined) {
      const rows = inspectRows(world, this.#selected);
      sections.push({
        heading: `entity #${String(this.#selected)}`,
        lines:
          rows === undefined
            ? ['gone']
            : rows.length === 0
              ? ['no world properties']
              : [
                  ...rows.map((row) => `${row.key} = ${row.value}`),
                  'edit: inspect set <key> <value>',
                ],
      });
    }
    sections.push({
      heading: 'stimuli (newest first)',
      lines: stimulusLines(this.#entries),
    });
    const wires = wireLines(world);
    if (wires.length > 0) sections.push({ heading: 'signal wires', lines: wires });
    return { title: 'field debug', sections };
  }

  /** The frame to draw, or undefined while everything is off. Read-only. */
  frame(): FieldDebugFrame | undefined {
    if (!this.enabled) return undefined;
    const view = this.#view();
    return { view, panel: this.#panel(view) };
  }

  dispose(): void {
    this.#layer = undefined;
    this.#selected = undefined;
    this.#sync();
  }
}
