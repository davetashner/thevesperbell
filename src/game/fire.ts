// Fire in the running game (mw-e06.15): the element field and the fire rules, so heat from a spell
// (or a burning neighbour) ignites what can burn, flames spread, and a burnt object becomes its
// material's charred state. Before this the game's sim had stimuli and the light field but nothing
// that turned heat into fire; Ember's 500 degree spark landed and did nothing.
//
// The caller adds these after the stimulus system (installGamePhysics's `afterStimuli`), in this
// order: the rules read the tick's resolved stimuli, then the field diffuses what they changed.
// Water (mw-e03.6) rides the same rule set: liquid volumes, wetness drying, submersion and rain.
// Electricity (mw-e03.8) follows it, so conduction sees the tick's wetness.
// The field is open air everywhere (a scene's doors seal and unseal their doorways themselves).

import {
  burntMaterials,
  DEFAULT_ENVIRONMENT_DAMAGE_ID,
  materialPresets,
  toPropertyInit,
  type GameContent,
} from '@content/index';
import {
  actorRules,
  conductionRules,
  installActorElements,
  type ActorSpec,
  type DamageModel,
  ElementRuleSet,
  elementFieldSystem,
  elementRulesSystem,
  fireRules,
  freezeRules,
  liquidRules,
  installElementField,
  installIce,
  installLiquids,
  LightSourceComponent,
  type World,
} from '@sim/index';

/**
 * Installs the element field and the fire rules from the game's material data, and makes creatures
 * and the player actors in them (mw-e03.24): they are wet, burning, frozen and charged by the same
 * rules as objects. `damage` is the damage model a frozen creature's shatter goes through (absent:
 * frozen creatures do not shatter). Once, at setup.
 */
export function installGameFire<TInput>(
  world: World<TInput>,
  content: Pick<GameContent, 'all' | 'get'>,
  options: { readonly damage?: DamageModel } = {},
): void {
  const materials = content.all('material');
  const presets = materialPresets(materials);
  installElementField(world);
  installLiquids(world);
  installIce(world);
  // Creatures by id, and the items that conduct when worn (their material's conductive).
  const specs = new Map<string, ActorSpec>(
    content.all('creature').map((def) => [
      def.id,
      {
        properties: toPropertyInit(def.properties),
        resistances: def.resistances,
        aflame: def.aflame,
      },
    ]),
  );
  const conductive = new Map<string, boolean>(
    content.all('item').map((item) => {
      const props =
        item.worldProperties === undefined ? undefined : toPropertyInit(item.worldProperties);
      const material = props?.material === undefined ? undefined : presets.get(props.material);
      return [item.id, (props?.conductive ?? material?.conductive) === true];
    }),
  );
  const { kinetic } = content.get('environment-damage', DEFAULT_ENVIRONMENT_DAMAGE_ID);
  installActorElements(world, {
    presets,
    creature: (id) => specs.get(id),
    player: { properties: {}, resistances: {}, aflame: false },
    itemConductive: (defId) => conductive.get(defId) === true,
    ...(options.damage !== undefined && {
      shatter: {
        damage: options.damage,
        joulesPerPoint: kinetic.joulesPerPoint,
      },
    }),
  });
  world
    .addSystem(
      elementRulesSystem(
        new ElementRuleSet([
          ...fireRules({
            presets,
            burnt: burntMaterials(materials),
            keepWhenSpent: (world, entity) => world.has(entity, LightSourceComponent),
          }),
          ...freezeRules(),
          ...actorRules(),
          ...liquidRules({ presets }),
          ...conductionRules(),
        ]),
      ),
    )
    .addSystem(elementFieldSystem());
}
