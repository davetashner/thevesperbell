// The cast phase against real spell data (mw-e06.4): fixture spells' castTime, cooldown and channel
// numbers drive the wind-up, release and channel plan. (src/sim tests cannot load content at runtime.)
import { describe, expect, it } from 'vitest';
import { loadSpellFixtureContent } from '@content/test-fixtures';
import {
  castStateOf,
  DEFAULT_MANA_PROFILE,
  giveMana,
  installCasting,
  installMana,
  learnSpell,
  ON_COOLDOWN,
  SpellCast,
  SpellFizzled,
} from '@sim/index';
import { spellWorld } from '@sim/magic/testing';

describe('cast phase with data-driven spells', () => {
  it('AC-1/AC-4: a 0.5 s wind-up releases on the 30th tick, then the 4 s cooldown refuses a recast', () => {
    const spells = loadSpellFixtureContent().all('spell');
    const ward = spells.find((s) => s.id === 'fixture-ward');
    const ray = spells.find((s) => s.id === 'fixture-ray');
    expect(ward?.castTime).toBe(0.5);
    const s = spellWorld(spells);
    installMana(s.world, s.pipeline);
    const casting = installCasting(s.world, s.pipeline);
    const caster = s.spawn();
    giveMana(s.world, caster, DEFAULT_MANA_PROFILE);
    learnSpell(s.world, caster, 'fixture-ward');
    learnSpell(s.world, caster, 'fixture-ray');
    const casts: number[] = [];
    const refused: string[] = [];
    s.world.events.on(SpellCast, (e) => casts.push(e.tick));
    s.world.events.on(SpellFizzled, (e) => refused.push(e.reason));
    s.world.step([{ type: 'cast', caster, spell: 'fixture-ward' }]);
    for (let i = 0; i < 40; i++) s.world.step();
    expect(casts).toEqual([30]);
    s.world.step([{ type: 'cast', caster, spell: 'fixture-ward' }]);
    expect(refused).toEqual([ON_COOLDOWN]);

    // the ray channels: 0.2 s wind-up, then a tick every 0.25 s at 8 mana/s (2 per tick)
    expect(ray?.channel?.manaPerSecond).toBe(8);
    casting.begin({ caster, spell: 'fixture-ray' });
    expect(castStateOf(s.world, caster)).toMatchObject({
      phase: 'winding',
      anchored: true,
      channelled: true,
      channel: { interval: 15, duration: 360, tickCost: 2 },
    });
  });
});
