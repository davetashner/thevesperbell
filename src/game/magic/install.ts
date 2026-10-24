// Magic in the running game (mw-e06.15): the spell pipeline and everything that hangs on it, installed
// into the game world in the one order ADR-0007 and the modules' own notes require. Before this the
// whole spell sim ran only in tests.
//
// Order (all before the stimulus system, so a spell's stimuli resolve in the tick it is cast; the
// caller installs this from `installGamePhysics`'s `beforeStimuli` hook):
//   spells (the pipeline and its `cast` command) → learning → mana → casting (cast phase, cooldowns,
//   `cancel-cast`) → projectiles → volumes → emission (light and noise; after projectiles so a light
//   reads this tick's position).
//
// Spells are the game content's (`spell`), looked up by id. The player gets a mana pool and nothing
// else: what it can cast is what it has learned (`learn-spell`, from the console until books and
// scrolls teach, mw-ju8.17).

import type { SpellEntry } from '@content/index';
import {
  DEFAULT_MANA_PROFILE,
  giveMana,
  installCasting,
  installMana,
  installSpellEmission,
  installSpellLearning,
  installSpellProjectiles,
  installSpells,
  installSpellVolumes,
  type CastController,
  type CollisionWorld,
  type DamageModel,
  type EntityId,
  type InvulnerabilityRule,
  type SpellLookup,
  type SpellPipeline,
  type Vec3,
  type World,
} from '@sim/index';

export interface GameMagicOptions {
  /** Every spell in the game's content. */
  readonly spells: readonly SpellEntry[];
  /** The damage model every hit resolves through (the shield rule registered). */
  readonly damage: DamageModel;
  /** The level projectiles hit: RapierCollisionWorld over the sim's physics. */
  readonly collision: CollisionWorld;
  /** Who a bolt flies through this tick (dodge i-frames). */
  readonly invulnerable: InvulnerabilityRule;
  /** Whether a point is under water (the scene's water volumes): flames are quenched there. */
  readonly water?: (point: Vec3) => boolean;
}

/** What the game keeps of the installed magic. */
export interface GameMagic {
  readonly pipeline: SpellPipeline;
  readonly casting: CastController;
  readonly spells: SpellLookup;
  /** Every spell id, sorted (the console completes from it). */
  readonly spellIds: readonly string[];
}

/** Installs the spell pipeline and its systems in `world` (see the file header). Once, outside a step. */
export function installGameMagic<TInput>(
  world: World<TInput>,
  options: GameMagicOptions,
): GameMagic {
  const byId = new Map(options.spells.map((spell) => [spell.id, spell] as const));
  const spells: SpellLookup = (id) => byId.get(id);
  const pipeline = installSpells(world, { spells, damage: options.damage });
  installSpellLearning(world, pipeline);
  installMana(world, pipeline);
  const casting = installCasting(world, pipeline);
  installSpellProjectiles(world, pipeline, {
    collision: options.collision,
    invulnerable: options.invulnerable,
    ...(options.water !== undefined && { water: options.water }),
  });
  installSpellVolumes(world, pipeline);
  installSpellEmission(world, pipeline);
  return { pipeline, casting, spells, spellIds: [...byId.keys()].sort() };
}

/** Gives the player a mana pool of `max` points (the sorcerer's regen and delay). Outside a step. */
export function givePlayerMana<TInput>(world: World<TInput>, player: EntityId, max: number): void {
  giveMana(world, player, { ...DEFAULT_MANA_PROFILE, max });
}
