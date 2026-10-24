// mw-e27.12 against the real content: the clock block of game.json runs at the sim's tick rate, the
// time facts' declared defaults agree with it, and sleeping at the Sleeping Ox passes the night
// through the game clock (so subscribers hear the night end and merchants restock via rest.completed).

import { describe, expect, it } from 'vitest';
import { GAME_CONFIG_ID, loadGameContent } from '@content/index';
import {
  addInventory,
  DAMAGE_COMPONENTS,
  DAY_CLOCK_FACTS,
  DAY_FACT,
  giveCombatant,
  giveStamina,
  installGameClock,
  InventoryRules,
  LootTables,
  MINUTE_FACT,
  MINUTE_ORIGIN_FACT,
  HELD_AT_FACT,
  PHASE_FACT,
  Shops,
  StaminaComponent,
  totalMinutes,
  World,
} from '@sim/index';

const content = loadGameContent();
const clockConfig = content.get('game', GAME_CONFIG_ID).clock;

function clockWorld(seed = 3) {
  const world = new World({ seed });
  for (const [key, spec] of Object.entries(DAY_CLOCK_FACTS)) world.facts.declare(key, spec);
  const clock = installGameClock(world, clockConfig);
  return { world, clock };
}

describe('game clock content (mw-e27.12)', () => {
  it('the data runs at 60 Hz: 150 ticks per game minute, a day in 60 real minutes', () => {
    const { clock } = clockWorld();
    expect(clock.ticksPerMinute).toBe(150);
    expect(clock.phase()).toBe('dawn');
    expect(clock.config.phases.map((p) => p.id)).toEqual(['dawn', 'day', 'dusk', 'night']);
  });

  it('the declared fact defaults are the clock’s start, so an unwritten world agrees with the data', () => {
    const { world, clock } = clockWorld();
    const declared = (key: string) =>
      content
        .all('fact')
        .flatMap((f) => f.facts)
        .find((f) => f.key === key);
    expect(declared(DAY_FACT)?.default).toBe(clockConfig.start.day);
    expect(declared(MINUTE_FACT)?.default).toBe(clockConfig.start.minute);
    expect(declared(PHASE_FACT)?.default).toBe(clock.phase());
    expect(declared(MINUTE_ORIGIN_FACT)?.default).toBe(0);
    expect(declared(HELD_AT_FACT)?.default).toBe(-1);
    expect(world.facts.get(DAY_FACT)).toBe(clockConfig.start.day);
  });

  it('sleeping at the Sleeping Ox passes the night through the clock: hours, dawn and the day start', () => {
    const items = content.all('item');
    const rules = new InventoryRules(items);
    const shops = new Shops(
      content.all('merchant'),
      items,
      rules,
      new LootTables(content.all('loot-table'), items),
    );
    const { world, clock } = clockWorld(31);
    world.register(...DAMAGE_COMPONENTS, StaminaComponent);
    const player = world.spawn();
    addInventory(world, player, 400);
    giveCombatant(world, player, { health: 40 });
    giveStamina(world, player);
    clock.setTime({ day: 1, minute: 22 * 60 });
    const hours: number[] = [];
    const days: number[] = [];
    clock.subscribe('hourChanged', (e) => hours.push(e.hour));
    clock.subscribe('dayStarted', (e) => days.push(e.day));
    const result = shops.buyService(world, player, 'sleeping-ox', 'room-for-the-night');
    expect(result.ok).toBe(true);
    expect(clock.time()).toEqual({ day: 2, minute: 6 * 60 });
    expect(hours).toEqual([23, 0, 1, 2, 3, 4, 5, 6]);
    expect(days).toEqual([2]);
    expect(clock.total()).toBe(totalMinutes({ day: 2, minute: 360 }));
    expect(world.facts.get(PHASE_FACT)).toBe('dawn');
  });
});
