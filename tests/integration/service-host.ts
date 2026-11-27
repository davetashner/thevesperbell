// A `services` record for a MemoryLogicHost carrying the game's service catalog (mw-e20.9), so a
// dialogue test can buy the services the dialogues sell.
import type { GameContent } from '@content/index';
import type { ServiceDef } from '@content/types/service';
import { dialogueLogicRegistry } from '@sim/logic/dialogue-kinds';
import { createServiceCatalog, SERVICES_SERVICE } from '@sim/services';

export const contentServices = (content: GameContent): Record<string, unknown> => ({
  [SERVICES_SERVICE]: createServiceCatalog(
    content.all('service') as unknown as ServiceDef[],
    dialogueLogicRegistry(),
  ),
});
