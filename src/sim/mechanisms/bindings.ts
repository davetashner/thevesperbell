// Signal-graph nodes bound to a mechanism entity (mw-e03.18, mw-e03.19).

import type { EntityId } from '../core/component';
import type { World } from '../core/world';
import { SignalGraphComponent } from '../signals/runtime';

/** The lever and button nodes bound to `entity`, as [graph, node, kind]. */
export function boundNodes(world: World<never>, entity: EntityId): [EntityId, string, string][] {
  const found: [EntityId, string, string][] = [];
  if (!world.isRegistered(SignalGraphComponent)) return found;
  world.query(SignalGraphComponent).forEach((graph, instance) => {
    for (const node of instance.graph.nodes) {
      if (node.kind !== 'lever' && node.kind !== 'button') continue;
      if (node.entity !== undefined && instance.bindings[node.entity] === entity) {
        found.push([graph, node.id, node.kind]);
      }
    }
  });
  return found;
}
