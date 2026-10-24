import { describe, expect, it } from 'vitest';
import { WORLD_SECTION_ID } from './format';
import { CREATURES_SECTION_ID } from './creatures';
import { INVENTORY_SECTION_ID } from './inventory';
import { LEVEL_DELTAS_SECTION_ID } from './level-deltas';
import { GAME_CLOCK_SECTION_ID } from './game-clock';
import { MERCHANTS_SECTION_ID } from './merchants';
import { WORLD_FACTS_SECTION_ID } from './world-facts';
import { createGameSaveRegistry } from './sections';

describe('createGameSaveRegistry', () => {
  it('holds the world section, then inventory, creatures, world facts, level deltas, merchants and the game clock, and returns an independent registry per call', () => {
    const a = createGameSaveRegistry();
    expect(a.sections.map((section) => section.id)).toEqual([
      WORLD_SECTION_ID,
      INVENTORY_SECTION_ID,
      CREATURES_SECTION_ID,
      WORLD_FACTS_SECTION_ID,
      LEVEL_DELTAS_SECTION_ID,
      MERCHANTS_SECTION_ID,
      GAME_CLOCK_SECTION_ID,
    ]);
    expect(createGameSaveRegistry()).not.toBe(a);
  });
});
