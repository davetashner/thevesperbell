// Test scaffolding for the spell pipeline (mw-e06.2): a small world with stimuli and spells
// installed, and builders that write spells as data (src/sim may import content only as types, so
// these build fully-defaulted SpellEntry values by hand). Used by tests only.

import type { SpellEntry } from '@content/index';
import { DAMAGE_COMPONENTS, giveCombatant } from '../combat/damage';
import type { EntityId } from '../core/component';
import { World } from '../core/world';
import { addProperties, registerWorldProperties } from '../properties/components';
import { placeEntity } from '../stimulus/placement';
import { installStimuli, stimulusSystem } from '../stimulus/stimulus';
import { installSpells, type CastCommand, type SpellPipeline } from './pipeline';

type Effect = SpellEntry['effects'][number];
type Stimulus = Extract<Effect, { op: 'stimulus' }>;

/** A status op. */
export const statusOp = (status: string, duration = 10, stacks = 1): Effect => ({
  op: 'status',
  status,
  duration,
  stacks,
});

/** A damage op dealing `amounts`. */
export const damageOp = (amounts: Extract<Effect, { op: 'damage' }>['amounts']): Effect => ({
  op: 'damage',
  amounts,
  poiseDamage: 0,
  staminaDamage: 0,
  impulse: { x: 0, y: 0, z: 0 },
  impactForce: 0,
  tags: [],
});

/** A stimulus op (`gas` names the gas type for element "gas"). */
export const stimulusOp = (
  element: Stimulus['element'],
  intensity: number,
  radius = 0,
  gas?: string,
): Effect => ({
  op: 'stimulus',
  element,
  intensity,
  radius,
  duration: 0,
  falloff: 'linear',
  ...(gas === undefined ? {} : { gas }),
});

/** A valid spell (a self-cast "warded" status unless `overrides` say otherwise). */
export function makeSpell(id: string, overrides: Partial<SpellEntry> = {}): SpellEntry {
  return {
    id,
    schemaVersion: 1,
    name: id,
    school: 'arcane',
    tier: 1,
    next: [],
    cost: { mana: 0 },
    castTime: 0,
    cooldown: 0,
    delivery: { kind: 'self' },
    effects: [statusOp('warded')],
    tags: [],
    vfxCue: 'vfx-test',
    sfxCue: 'sfx-test',
    flags: { tooUseful: false, castWhileMoving: false },
    ...overrides,
  };
}

export interface SpellTestWorld {
  readonly world: World<CastCommand>;
  readonly pipeline: SpellPipeline;
  /** A combatant at `x` on the ground with 100 health and a temperature. */
  readonly spawn: (x?: number) => EntityId;
}

/** A world with properties, stimuli, damage components and spells (looked up in `spells`). */
export function spellWorld(spells: readonly SpellEntry[], seed = 3): SpellTestWorld {
  const world = installStimuli(registerWorldProperties(new World<CastCommand>({ seed })));
  world.register(...DAMAGE_COMPONENTS);
  const byId = new Map(spells.map((spell) => [spell.id, spell]));
  const pipeline = installSpells(world, { spells: (id) => byId.get(id) });
  world.addSystem(stimulusSystem());
  const spawn = (x = 0): EntityId => {
    const entity = world.spawn();
    giveCombatant(world, entity, { health: 100 });
    addProperties(world, entity, { temperature: 20 });
    placeEntity(world, entity, { x, y: 0, z: 0 }, 0.5);
    return entity;
  };
  return { world, pipeline, spawn };
}
