// Resting in the running game (mw-e27.13): the glue between a rest point in the world (a scene spawn
// with `restPoint`, a `rest` affordance), the sim's rules (src/sim/rest/rules.ts), the rest menu
// (src/ui/rest-window.ts) and the HUD clock.
//
// - Interacting with a rest point with the `rest` verb opens the menu after the step that did it. The
//   verb is greyed with the reason while resting is refused: a campfire that is not burning ("The fire
//   is out"), or the autosave "unsafe" veto registry objects or something hostile is near.
// - The menu lists the durations the point's kind offers and the actions other systems registered
//   (`rules.registerAction`). Choosing a duration rests: the time passes, the player is restored, the
//   world is told (`rest.completed`: the autosave and the rest-reset policies hear it), and a toast
//   says how it went. An interrupted rest says what woke the player.
// - `#app[data-rest-ui]` (JSON: open, point, kind, last outcome) and `#app[data-clock]` (JSON: day,
//   minute, phase, text) are the e2e's readouts. The HUD clock shows "Day 1 · 06:00".

import type { GameContent } from '@content/index';
import {
  addAffordanceGate,
  clockText,
  gameClockOf,
  interacted,
  restHostility,
  restPointOf,
  RestRules,
  type EntityId,
  type RestDuration,
  type RestKindSpec,
  type RestOutcome,
  type World,
} from '@sim/index';
import {
  ClockHud,
  openRestWindow,
  type RestChoice,
  type RestWindow,
  type RestWindowModel,
  type UiRoot,
} from '@ui/index';

/** The rest point kinds of `content`, as the sim's rules want them. */
export function restKindSpecs(content: Pick<GameContent, 'all'>): RestKindSpec[] {
  return content.all('rest-point').map((def) => ({
    id: def.id,
    name: def.name,
    needsFire: def.needsFire,
    fullRestHours: def.fullRestHours,
    restores: def.restores,
    durations: def.durations,
    interrupts: def.interrupts,
  }));
}

/** The id a duration has on the menu. */
export function durationId(duration: RestDuration): string {
  return duration.kind === 'hours' ? `hours-${String(duration.hours)}` : duration.kind;
}

/** The label a duration has on the menu. */
export function durationLabel(duration: RestDuration): string {
  if (duration.kind === 'dawn') return 'Until dawn';
  if (duration.kind === 'dusk') return 'Until dusk';
  return duration.hours === 1 ? '1 hour' : `${String(duration.hours)} hours`;
}

/** What the e2e reads of the rest menu. */
export interface RestReading {
  readonly open: boolean;
  readonly point: string | null;
  readonly kind: string | null;
  /** How the last rest went, or null before any. */
  readonly last: {
    readonly ok: boolean;
    readonly hours: number;
    readonly interrupted: string | null;
    readonly detail: string;
  } | null;
}

export interface RestControllerOptions {
  readonly ui: UiRoot;
  readonly world: World<never>;
  readonly player: EntityId;
  readonly rules: RestRules;
  /** Null when nothing objects to resting (the autosave veto registry's verdict), else why not. */
  readonly safety?: () => string | null;
  /** A line of text for the player (a toast). */
  readonly toast?: (text: string) => void;
  readonly onChange?: (reading: RestReading) => void;
}

/** The rest menu for the player's rests. Call `afterStep` each step. */
export class RestController {
  readonly #options: RestControllerOptions;
  readonly #offs: (() => void)[];
  #pending: EntityId | undefined;
  #session:
    | {
        readonly point: EntityId;
        readonly window: RestWindow;
        readonly id: string;
        readonly kind: string;
      }
    | undefined;
  #last: RestReading['last'] = null;

  constructor(options: RestControllerOptions) {
    this.#options = options;
    const { world, player, rules } = options;
    this.#offs = [
      world.events.on(interacted, ({ actor, target, verb }) => {
        if (actor === player && verb === 'rest') this.#pending = target;
      }),
      addAffordanceGate(world, (_world, _actor, target, affordance) =>
        affordance.verb === 'rest'
          ? rules.blocked(world, target, this.#safetyFor(target))?.detail
          : undefined,
      ),
    ];
  }

  get isOpen(): boolean {
    return this.#session !== undefined;
  }

  /** Opens the menu at `point` unless a screen is open or it is not a rest point. */
  open(point: EntityId): boolean {
    const { ui, world, player, rules } = this.#options;
    if (this.#session !== undefined || ui.top !== undefined) return false;
    const kind = rules.kindOf(world, point);
    if (kind === undefined) return false;
    rules.enter(world, player, point);
    const window = openRestWindow(ui, {
      model: this.#model(point),
      onRest: (id) => {
        this.#rest(point, id, window);
      },
      onAction: (id) => {
        const result = rules.invoke(world, player, id);
        window.say(result.ok ? '' : result.detail);
        window.render(this.#model(point));
      },
      onClose: () => {
        rules.leave(player);
        this.#session = undefined;
        this.#report();
      },
    });
    this.#session = {
      point,
      window,
      id: restPointOf(world, point)!.id, // eslint-disable-line @typescript-eslint/no-non-null-assertion
      kind: kind.id,
    };
    this.#report();
    return true;
  }

  /** Opens the menu for a rest point the player just used. */
  afterStep(): void {
    const pending = this.#pending;
    this.#pending = undefined;
    if (pending !== undefined) this.open(pending);
  }

  close(): void {
    this.#session?.window.close();
  }

  dispose(): void {
    for (const off of this.#offs) off();
    this.close();
  }

  #safetyFor(point: EntityId): () => string | null {
    const { world, safety } = this.#options;
    return () => safety?.() ?? restHostility(world, point);
  }

  #model(point: EntityId): RestWindowModel {
    const { world, rules } = this.#options;
    const kind = rules.kindOf(world, point)!; // eslint-disable-line @typescript-eslint/no-non-null-assertion
    const blocked = rules.blocked(world, point, this.#safetyFor(point))?.detail ?? '';
    const durations: RestChoice[] = kind.durations.map((duration) => ({
      id: durationId(duration),
      label: durationLabel(duration),
      reason: blocked,
    }));
    const actions: RestChoice[] = rules
      .menu(world, this.#options.player)
      .map(({ id, label, reason }) => ({ id, label, reason }));
    return { title: kind.name, durations, actions };
  }

  #rest(point: EntityId, id: string, window: RestWindow): void {
    const { world, player, rules, toast } = this.#options;
    const kind = rules.kindOf(world, point)!; // eslint-disable-line @typescript-eslint/no-non-null-assertion
    const duration = kind.durations.find((own) => durationId(own) === id)!; // eslint-disable-line @typescript-eslint/no-non-null-assertion
    const outcome = rules.rest(world, player, { point, duration }, this.#safetyFor(point));
    this.#last = lastOf(outcome);
    const text = outcomeText(outcome);
    window.say(text);
    if (outcome.ok) {
      toast?.(text);
      this.close();
    } else {
      this.#report();
    }
  }

  #report(): void {
    const session = this.#session;
    this.#options.onChange?.({
      open: session !== undefined,
      point: session?.id ?? null,
      kind: session?.kind ?? null,
      last: this.#last,
    });
  }
}

/** How a rest went, for the readout. */
function lastOf(outcome: RestOutcome): NonNullable<RestReading['last']> {
  return outcome.ok
    ? { ok: true, hours: outcome.hours, interrupted: outcome.interrupted?.id ?? null, detail: '' }
    : { ok: false, hours: 0, interrupted: null, detail: outcome.detail };
}

/** What the player is told about a rest. */
export function outcomeText(outcome: RestOutcome): string {
  if (!outcome.ok) return outcome.detail;
  const woke = `Day ${String(outcome.wakes.day)}, ${clockText(outcome.wakes)}`;
  return outcome.interrupted === undefined
    ? `You rest for ${String(outcome.hours)} h and wake at ${woke}.`
    : `${outcome.interrupted.message} (${woke})`;
}

export interface RestUiOptions {
  readonly ui: UiRoot;
  readonly world: World<never>;
  readonly content: Pick<GameContent, 'all'>;
  readonly player: EntityId;
  /** Null when nothing objects to resting, else why not (the autosave veto registry's verdict). */
  readonly safety?: () => string | null;
  readonly toast?: (text: string) => void;
  /** Publishes a readout for the e2e: `restUi` (JSON of a `RestReading`), `clock` (JSON). */
  readonly publish?: (key: 'restUi' | 'clock', value: string) => void;
}

/** The rest menu and HUD clock in a running game. */
export interface RestUi {
  readonly controller: RestController;
  readonly rules: RestRules;
  /** Call after every sim step. */
  afterStep(): void;
}

/** Readies resting and the HUD clock over `content`'s rest point kinds. */
export function startRestUi(options: RestUiOptions): RestUi {
  const { ui, world, content, player, publish } = options;
  const rules = new RestRules(restKindSpecs(content));
  const controller = new RestController({
    ui,
    world,
    player,
    rules,
    ...(options.safety !== undefined && { safety: options.safety }),
    ...(options.toast !== undefined && { toast: options.toast }),
    onChange: (reading) => publish?.('restUi', JSON.stringify(reading)),
  });
  publish?.('restUi', JSON.stringify({ open: false, point: null, kind: null, last: null }));
  const clock = new ClockHud();
  ui.hud.append(clock.element);
  let published = '';
  const showClock = (): void => {
    const game = gameClockOf(world);
    if (game === undefined) return;
    const time = game.time();
    const text = `Day ${String(time.day)} · ${clockText(time)}`;
    const phase = game.phase();
    clock.update({ text, phase });
    const json = JSON.stringify({ ...time, phase, text });
    if (json !== published) {
      published = json;
      publish?.('clock', json);
    }
  };
  showClock();
  return {
    controller,
    rules,
    afterStep: () => {
      controller.afterStep();
      showClock();
    },
  };
}
