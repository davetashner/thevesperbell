// Reading a real spell scroll (mw-ju8.17): scroll-of-ember from content casts Ember through the real
// pipeline, free, for a class that has learned nothing and has no mana, and is used up. src/sim tests
// cannot load content at runtime, so the content-backed path lives here.
import { describe, expect, it } from 'vitest';
import { loadGameContent } from '@content/index';
import { createScrollRules, scrollCasts } from '@game/items/scroll-read';
import {
  addInventory,
  DAMAGE_COMPONENTS,
  FakeCollisionWorld,
  HIT_VOLUME_COMPONENTS,
  installSpellProjectiles,
  installSpells,
  installStimuli,
  InventoryRules,
  inventoryOf,
  knowsSpell,
  placeEntity,
  registerWorldProperties,
  ScrollRead,
  SpellCast,
  SpellFizzled,
  stimulusSystem,
  TagsComponent,
  World,
  type CastCommand,
} from '@sim/index';

const content = loadGameContent();

function game() {
  // Ember's light and noise ops need the emission systems, which this test is not about.
  const spells = new Map(
    content
      .all('spell')
      .map((s) => [
        s.id,
        { ...s, effects: s.effects.filter((e) => e.op === 'damage' || e.op === 'stimulus') },
      ]),
  );
  const world = installStimuli(registerWorldProperties(new World<CastCommand>({ seed: 4 })));
  world.register(...DAMAGE_COMPONENTS, ...HIT_VOLUME_COMPONENTS, TagsComponent);
  const pipeline = installSpells(world, { spells: (id) => spells.get(id) });
  installSpellProjectiles(world, pipeline, {
    collision: new FakeCollisionWorld([]),
    muzzleHeight: 0,
  });
  world.addSystem(stimulusSystem());
  const inventory = new InventoryRules(content.all('item'));
  const rules = createScrollRules(content, pipeline, inventory);
  const player = world.spawn();
  addInventory(world, player);
  placeEntity(world, player, { x: 0, y: 0, z: 0 }, 0.4);
  world.step();
  return { world, rules, inventory, player };
}

describe('reading a spell scroll (mw-ju8.17)', () => {
  it('AC-3: reading scroll-of-ember casts Ember once, free, and consumes the scroll', () => {
    const { world, rules, inventory, player } = game();
    const cast: string[] = [];
    const read: string[] = [];
    const fizzled: string[] = [];
    world.events.on(SpellCast, (e) => cast.push(`${e.spell}:${e.source}`));
    world.events.on(ScrollRead, (e) => read.push(`${e.scroll}>${e.spell}`));
    world.events.on(SpellFizzled, (e) => fizzled.push(e.reason));
    const added = inventory.add(world, player, 'scroll-of-ember', 2);
    if (!added.ok) throw new Error(added.reason);
    const [instanceId] = added.instanceIds;
    if (instanceId === undefined) throw new Error('no instance');

    // Nothing learned and no mana installed at all: a normal cast would be refused.
    expect(knowsSpell(world, player, 'ember')).toBe(false);

    expect(rules.read(world, player, instanceId, { aim: { x: 1, y: 0, z: 0 } })).toEqual({
      ok: true,
    });
    for (let i = 0; i < 5; i++) world.step();
    expect(cast).toEqual(['ember:free']);
    expect(read).toEqual(['scroll-of-ember>ember']);
    expect(fizzled).toEqual([]);
    expect(inventoryOf(world, player)?.items.map((i) => i.count)).toEqual([1]);

    // Learning is untouched: reading teaches nothing.
    expect(knowsSpell(world, player, 'ember')).toBe(false);

    expect(rules.read(world, player, instanceId, { aim: { x: 1, y: 0, z: 0 } })).toEqual({
      ok: true,
    });
    expect(inventoryOf(world, player)?.items).toEqual([]);
    expect(rules.read(world, player, instanceId)).toEqual({ ok: false, reason: 'not-readable' });
  }, 30_000);

  it('only scrolls with spell content cast; the other shipped scrolls wait for their spells', () => {
    expect([...scrollCasts(content)]).toEqual([['scroll-of-ember', 'ember']]);
  });
});
