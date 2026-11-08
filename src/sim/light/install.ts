// Wiring the light field into a world (mw-e03.15). The field itself is derived state — rebuilt from
// placements, world properties and the level every tick — so it lives outside the world and is not
// part of snapshots; only its two components (cones, occluder boxes) are world state.

import type { System, World } from '../core/world';
import { stimulusResolved } from '../stimulus/stimulus';
import { lightComponents } from './components';
import type { LightField } from './field';
import { installLightSources, updateLightSources } from './sources';

/**
 * Registers the light components on `world` and feeds `field` every resolved light stimulus. The
 * world must already have world properties and stimuli installed (placements). Call once at setup.
 */
export function installLightField<W extends World<never>>(world: W, field: LightField): W {
  world.register(...lightComponents);
  installLightSources(world);
  world.events.on(stimulusResolved, (resolution) => {
    field.noteStimulus(resolution);
  });
  return world;
}

/**
 * The system that gathers `field`'s sources once per tick. Add it after `stimulusSystem` (so this
 * tick's light stimuli count) and after the element rules (so this tick's fires do); samples taken
 * later in the tick, or next tick, see the result.
 */
export function lightFieldSystem<TInput>(field: LightField): System<TInput> {
  return {
    name: 'light-field',
    run: ({ world }) => {
      updateLightSources(world);
      field.update(world);
    },
  };
}
