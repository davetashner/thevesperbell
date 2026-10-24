// The player's casting controller (mw-e06.15): the glue from input actions to the sim's cast
// commands. Each gameplay ActionFrame goes through `commands`, which returns the commands to step
// the sim with in the same frame (so a press is a cast request in the very tick it is sampled):
//
//   cast pressed         aim the selected spell along the reticle ray (aim.ts) and send `cast`
//                        with the aim point (and target); an invalid aim sends nothing and is
//                        counted as a refusal, which the reticle shows in red
//   cast released        ends a channel the press started (`cancel-cast`), so a held spell stops
//                        within the tick of the release
//   cancelCast pressed   calls off whatever the caster is winding up or channelling
//
// The selected spell is presentation state kept here until the hotbar (mw-e06.16) owns selection;
// with none chosen the first spell the caster has learned is used. Nothing here changes the sim:
// the sim decides whether the cast may start (mana, cooldown, learned) and says why not through
// SpellFizzled.

import type { SpellEntry } from '@content/index';
import {
  KnownSpellsComponent,
  type ActionFrame,
  type CancelCastCommand,
  type CastCommand,
  type SpellLookup,
  type World,
} from '@sim/index';
import { resolveAim, type AimContext, type AimInvalid, type AimRay, type AimResult } from './aim';

/** What the controller adds to a frame's commands. */
export type SpellCommand = CastCommand | CancelCastCommand;

export interface SpellCasterOptions extends AimContext {
  readonly spells: SpellLookup;
  /** Whether the caster can act at all (false once dead); defaults to always. */
  readonly canCast?: () => boolean;
}

/** Why the controller itself, before the sim, did not send a cast. */
export type Refusal = AimInvalid | 'no-spell';

export class SpellCaster {
  readonly #options: SpellCasterOptions;
  readonly #world: World<never>;
  #chosen: string | undefined;
  #channelling = false;
  #refusals = 0;
  #lastRefusal: Refusal | undefined;

  constructor(options: SpellCasterOptions) {
    this.#options = options;
    this.#world = options.world;
  }

  /** The spells the caster has learned, in the order learned. */
  learned(): readonly string[] {
    return this.#world.get(this.#options.caster, KnownSpellsComponent)?.spells ?? [];
  }

  /** The spell the cast button casts: the chosen one, else the first learned; undefined for none. */
  get selected(): string | undefined {
    const known = this.learned();
    return this.#chosen !== undefined && known.includes(this.#chosen) ? this.#chosen : known[0];
  }

  /** Chooses `id`; false (and no change) when the caster has not learned it. */
  select(id: string): boolean {
    if (!this.learned().includes(id)) return false;
    this.#chosen = id;
    return true;
  }

  /** The selected spell's definition, if there is one. */
  spell(): SpellEntry | undefined {
    const id = this.selected;
    return id === undefined ? undefined : this.#options.spells(id);
  }

  /** Where the selected spell would go along `ray` now (undefined with none selected). */
  preview(ray: AimRay): AimResult | undefined {
    const spell = this.spell();
    return spell === undefined ? undefined : resolveAim(spell, ray, this.#options);
  }

  /** Casts the controller refused to send, since it was made. */
  get refusals(): number {
    return this.#refusals;
  }

  /** The reason for the latest refusal. */
  get lastRefusal(): Refusal | undefined {
    return this.#lastRefusal;
  }

  /**
   * The cast commands for one gameplay frame. `ray` is read only when a cast is actually aimed.
   */
  commands(frame: ActionFrame, ray: () => AimRay): readonly SpellCommand[] {
    const { caster } = this.#options;
    const out: SpellCommand[] = [];
    if (this.#options.canCast?.() === false) {
      this.#channelling = false;
      return out;
    }
    const cancel = (): void => {
      out.push({ type: 'cancel-cast', caster });
      this.#channelling = false;
    };
    if (frame.cancelCast.pressed) {
      cancel();
      return out;
    }
    const spell = this.spell();
    if (frame.cast.pressed && spell === undefined) this.#refuse('no-spell');
    if (frame.cast.pressed && spell !== undefined) {
      const aim = resolveAim(spell, ray(), this.#options);
      if (!aim.valid) {
        this.#refuse(aim.reason);
      } else {
        out.push({
          type: 'cast',
          caster,
          spell: spell.id,
          aim: aim.point,
          ...(aim.mode === 'target' && aim.target !== null && { target: aim.target }),
        });
        this.#channelling = spell.channel !== undefined;
      }
    }
    if (this.#channelling && frame.cast.released) cancel();
    return out;
  }

  #refuse(reason: Refusal): void {
    this.#refusals += 1;
    this.#lastRefusal = reason;
  }
}
