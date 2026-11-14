// Wiring the element field into a world (mw-e03.4). The field lives in the world as one component
// value on one entity, so it is part of every snapshot, save and replay hash (its serialize hook
// emits plain, sorted data). A world without a field has no such component registered, so its
// snapshots and hashes are exactly as before. Stimuli reach the field through `stimulusResolved`;
// `elementFieldSystem` steps it once per tick.

import type { EntityId } from '../core/component';
import { defineComponent } from '../core/component';
import type { System, World } from '../core/world';
import { stimulusResolved } from '../stimulus/stimulus';
import type { FieldConfigInput } from './config';
import { applyStimulusToField } from './coupling';
import { stepField, type FieldLod, type FieldStepReport } from './diffusion';
import type { Vec3 } from '../stimulus/shapes';
import { ElementField } from './grid';

/** The field component (`element.field`; a snapshot and save key, never renamed). */
export const ElementFieldComponent = defineComponent<ElementField>('element.field', {
  serialize: (field) => field.serialize(),
  deserialize: (data) => ElementField.deserialize(data),
});

/**
 * Gives `world` an element field with `config` (validated; see `resolveFieldConfig`): registers the
 * component, creates the field and applies every resolved stimulus to it. Call once at setup,
 * outside a step; to restore a snapshot, install first, then `restore`.
 */
export function installElementField<W extends World<never>>(
  world: W,
  config: FieldConfigInput = {},
): W {
  const field = new ElementField(config);
  world.register(ElementFieldComponent);
  world.add(world.spawn(), ElementFieldComponent, field);
  world.events.on(stimulusResolved, (resolution) => {
    applyStimulusToField(elementFieldOf(world), resolution);
  });
  return world;
}

/** The world's element field; throws when none is installed. */
export function elementFieldOf(world: World<never>): ElementField {
  const found: ElementField[] = [];
  world.query(ElementFieldComponent).forEach((_id: EntityId, field) => found.push(field));
  const field = found[0];
  if (field === undefined) throw new Error('no element field is installed in this world');
  return field;
}

/**
 * The system that steps the element field once per tick; add it after `stimulusSystem` so this
 * tick's stimuli are in the field before it diffuses. `onStep` receives each tick's report. With
 * `focus` (the player's position, undefined while there is none) the field runs at a reduced rate
 * far from it (`FieldLod`, mw-e03.30); without, every awake chunk steps every tick.
 */
export function elementFieldSystem<TInput>(
  onStep?: (report: FieldStepReport) => void,
  focus?: () => Vec3 | undefined,
): System<TInput> {
  return {
    name: 'element-field',
    run: ({ world, tick }) => {
      const anchor = focus?.();
      const lod: FieldLod | undefined = anchor === undefined ? undefined : { tick, anchor };
      const report = stepField(elementFieldOf(world), lod);
      onStep?.(report);
    },
  };
}
