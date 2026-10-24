// A paid spell lesson goes through SpellLearning like a studied book does (mw-e07.13): paying the
// bridge sorcerer makes Ember known, fires SpellLearned {source: trainer} and the real cast pipeline
// accepts the spell. Real content.
import { describe, expect, it } from 'vitest';
import { loadGameContent } from '@content/index';
import { createCapabilityRegistry, createUnlockBook } from '@game/capabilities';
import {
  addCapabilities,
  addInventory,
  addStudent,
  DAMAGE_COMPONENTS,
  FakeCollisionWorld,
  giveMana,
  HIT_VOLUME_COMPONENTS,
  installMana,
  installSpellProjectiles,
  installSpells,
  installStimuli,
  InventoryRules,
  knowsSpell,
  placeEntity,
  PlayerClassComponent,
  registerWorldProperties,
  Shops,
  SpellCast,
  SpellFizzled,
  SpellLearned,
  stimulusSystem,
  TagsComponent,
  World,
  type CastCommand,
} from '@sim/index';

const content = loadGameContent();
const MERCHANT = 'bridge-sorcerer';

function game() {
  const spells = new Map(
    content
      .all('spell')
      .map((s) => [
        s.id,
        { ...s, effects: s.effects.filter((e) => e.op === 'damage' || e.op === 'stimulus') },
      ]),
  );
  const world = installStimuli(registerWorldProperties(new World<CastCommand>({ seed: 4 })));
  world.register(
    ...DAMAGE_COMPONENTS,
    ...HIT_VOLUME_COMPONENTS,
    PlayerClassComponent,
    TagsComponent,
  );
  const pipeline = installSpells(world, { spells: (id) => spells.get(id) });
  installSpellProjectiles(world, pipeline, {
    collision: new FakeCollisionWorld([]),
    muzzleHeight: 0,
  });
  installMana(world, pipeline);
  world.addSystem(stimulusSystem());
  const registry = createCapabilityRegistry(content, true);
  const book = createUnlockBook(content, registry);
  const rules = new InventoryRules(content.all('item'));
  const player = world.spawn();
  addInventory(world, player);
  rules.addGold(world, player, 250);
  addCapabilities(world, player);
  addStudent(world, player);
  giveMana(world, player);
  world.add(player, PlayerClassComponent, { classId: 'sorcerer' });
  placeEntity(world, player, { x: 0, y: 0, z: 0 }, 0.4);
  world.step();
  const shops = new Shops(content.all('merchant'), content.all('item'), rules);
  return { world, player, book, shops };
}

describe('a paid spell lesson (mw-e07.13)', () => {
  it('AC-1: paying Idris Quillon fires SpellLearned {source: trainer} and Ember becomes castable', () => {
    const { world, player, book, shops } = game();
    const learned: string[] = [];
    const cast: string[] = [];
    const fizzled: string[] = [];
    world.events.on(SpellLearned, (e) => learned.push(`${e.spellId}<${e.source}`));
    world.events.on(SpellCast, (e) => cast.push(e.spell));
    world.events.on(SpellFizzled, (e) => fizzled.push(e.reason));

    world.step([{ type: 'cast', caster: player, spell: 'ember', aim: { x: 1, y: 0, z: 0 } }]);
    expect(fizzled).toEqual(['unknown-spell']);

    expect(shops.train(world, player, MERCHANT, 'ember', book)).toMatchObject({ ok: true });
    expect(knowsSpell(world, player, 'ember')).toBe(true);
    expect(book.knows(world, player, 'spell.ember')).toBe(true);
    world.step();
    expect(learned).toEqual([`ember<trainer:${MERCHANT}`]);

    world.step([{ type: 'cast', caster: player, spell: 'ember', aim: { x: 1, y: 0, z: 0 } }]);
    for (let i = 0; i < 5; i++) world.step();
    expect(cast).toEqual(['ember']);
    expect(fizzled).toEqual(['unknown-spell']);
  });

  it('a refused or unaffordable lesson learns nothing and fires nothing', () => {
    const { world, player, book, shops } = game();
    const learned: string[] = [];
    world.events.on(SpellLearned, (e) => learned.push(e.spellId));
    new InventoryRules(content.all('item')).spendGold(world, player, 100);
    expect(shops.train(world, player, MERCHANT, 'ember', book)).toMatchObject({
      ok: false,
      reason: 'cannot-afford',
    });
    world.step();
    expect(knowsSpell(world, player, 'ember')).toBe(false);
    expect(learned).toEqual([]);
  });
});
