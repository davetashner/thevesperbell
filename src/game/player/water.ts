// The player's water rules, wired to the game's content and combat (mw-e02.14): the armor load class
// that decides whether it swims or sinks (ADR-0003, read from its equipment every tick it is in deep
// water) and drowning as environmental damage. The rules themselves are src/sim/character/water.ts.

import type { GameContent } from '@content/index';
import { DAMAGE_TAGS, EquipmentRules, equipmentOf, type DamageModel, type World } from '@sim/index';
import type { TestbedWaterOptions } from './testbed-player';

/** The tag drowning damage carries besides `environment`. */
export const DROWNING_TAG = 'drowning';

export interface PlayerWaterOptions {
  readonly content: Pick<GameContent, 'all'>;
  readonly world: World<never>;
  /** The damage model drowning resolves through. */
  readonly damage: DamageModel;
  /** The equipment rules the load class is read through; default: built from `content`. */
  readonly equipment?: EquipmentRules;
}

/**
 * The player's water options: its load class from its equipment (light until it has any), and
 * drowning as blunt damage tagged `environment` and `drowning`. The amount is a placeholder until the
 * damage model prices drowning (e04), and armor still absorbs it, which e04 should settle.
 */
export function playerWater(options: PlayerWaterOptions): TestbedWaterOptions {
  const { content, world, damage } = options;
  let rules: EquipmentRules | undefined = options.equipment;
  return {
    loadClass: (entity) => {
      if (equipmentOf(world, entity) === undefined) return undefined;
      rules ??= new EquipmentRules(content.all('item'), content.all('class'));
      return rules.state(world, entity).loadClass;
    },
    onDrown: (entity, amount) => {
      damage.apply(world, entity, {
        amounts: { blunt: amount },
        tags: [DAMAGE_TAGS.environment, DROWNING_TAG],
      });
    },
  };
}
