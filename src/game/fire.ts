// Fire in the running game (mw-e06.15): the element field and the fire rules, so heat from a spell
// (or a burning neighbour) ignites what can burn, flames spread, and a burnt object becomes its
// material's charred state. Before this the game's sim had stimuli and the light field but nothing
// that turned heat into fire; Ember's 500 degree spark landed and did nothing.
//
// The caller adds these after the stimulus system (installGamePhysics's `afterStimuli`), in this
// order: the rules read the tick's resolved stimuli, then the field diffuses what they changed.
// The field is open air everywhere (a scene's doors seal and unseal their doorways themselves).

import { burntMaterials, materialPresets, type GameContent } from '@content/index';
import {
  assignProperty,
  ElementRuleSet,
  entitiesWithProperty,
  flameTemperatureOf,
  readProperty,
  resolveFireConfig,
  elementFieldSystem,
  elementRulesSystem,
  fireRules,
  installElementField,
  type World,
} from '@sim/index';

/** Installs the element field and the fire rules from the game's material data. Once, at setup. */
export function installGameFire<TInput>(
  world: World<TInput>,
  content: Pick<GameContent, 'all'>,
): void {
  const materials = content.all('material');
  installElementField(world);
  world
    .addSystem(
      elementRulesSystem(
        new ElementRuleSet(
          fireRules({ presets: materialPresets(materials), burnt: burntMaterials(materials) }),
        ),
      ),
    )
    .addSystem(elementFieldSystem());
}

/**
 * Brings every authored fire to flame temperature (a torch, a lantern or a crate a scene lights from
 * the start): with the fire rules installed, a burning thing cooler than its ignition point goes out
 * as `cold`, and scene data only says `burning: true`. Call once after a scene is loaded, between
 * steps; returns how many it warmed.
 */
export function settleAuthoredFires(world: World<never>): number {
  const config = resolveFireConfig();
  let warmed = 0;
  for (const entity of entitiesWithProperty(world, 'burning')) {
    if (!readProperty(world, entity, 'burning')) continue;
    const ignition = readProperty(world, entity, 'ignitionPoint');
    if (readProperty(world, entity, 'temperature') >= ignition) continue;
    assignProperty(world, entity, 'temperature', flameTemperatureOf(config, ignition));
    warmed += 1;
  }
  return warmed;
}
