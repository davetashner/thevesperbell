import { contentReferences } from '@tools/dialogue/validate';
import { expect } from 'vitest';
import { describeContent } from '@content/testing';
import { dialogueLogicRegistry } from '@sim/logic/dialogue-kinds';
import { validateServiceLogic } from '@sim/services';
import type { ServiceDef } from '@content/types/service';

const mentions = (node: unknown, id: string): boolean =>
  JSON.stringify(node).includes(`"service":"${id}"`);

describeContent(
  'service',
  'AC-4: provider, conditions and effects resolve; a dialogue sells it',
  (entry, content) => {
    const service = entry as unknown as ServiceDef;
    expect(content.has('creature', service.providerNpcId.id)).toBe(true);
    expect(
      validateServiceLogic(service, dialogueLogicRegistry(), contentReferences(content)),
    ).toEqual([]);
    const creature = content.get('creature', service.providerNpcId.id);
    expect(creature.dialogue).toBeDefined();
    const dialogue = content.get('dialogue', creature.dialogue?.id ?? '');
    expect(mentions(dialogue, service.id)).toBe(true);
  },
);
