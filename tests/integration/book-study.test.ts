// Studying a real spellbook from content (mw-e07.2): the fixture primer is picked up, studied for its
// in-game time, and the spell it taught is cast through the real pipeline. src/sim tests cannot load
// content at runtime, so the content-backed path lives here.
import { describe, expect, it } from 'vitest';
import { loadItemFixtureContent } from '@content/test-fixtures';
import { bookStudyDefs, createStudyRules, learnersOf } from '@game/items/book-study';
import { createCapabilityRegistry, createUnlockBook } from '@game/capabilities';
import {
  addCapabilities,
  addInventory,
  addStudent,
  DAMAGE_COMPONENTS,
  DEFAULT_CLOCK_CONFIG,
  FakeCollisionWorld,
  giveMana,
  HIT_VOLUME_COMPONENTS,
  installGameClock,
  installMana,
  installSpellProjectiles,
  installSpells,
  installStimuli,
  installStudy,
  InventoryRules,
  knowsSpell,
  placeEntity,
  registerWorldProperties,
  SpellCast,
  SpellFizzled,
  SpellLearned,
  stimulusSystem,
  TagsComponent,
  World,
  type CastCommand,
} from '@sim/index';
import { PlayerClassComponent } from '@sim/index';

const content = loadItemFixtureContent();
const PRIMER = 'fixture-primer';

function game(classId: string) {
  // The light and noise ops of the fixture spell need the emission systems, which this test is not
  // about; its damage and stimulus effects are enough to prove the cast goes through.
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
  installGameClock(world, DEFAULT_CLOCK_CONFIG);
  const pipeline = installSpells(world, { spells: (id) => spells.get(id) });
  installSpellProjectiles(world, pipeline, {
    collision: new FakeCollisionWorld([]),
    muzzleHeight: 0,
  });
  installMana(world, pipeline);
  world.addSystem(stimulusSystem());
  const registry = createCapabilityRegistry(content, true);
  const rules = createStudyRules(content, registry, createUnlockBook(content, registry));
  installStudy(world, rules);
  const inventory = new InventoryRules(content.all('item'));
  const player = world.spawn();
  addInventory(world, player);
  addCapabilities(world, player);
  addStudent(world, player);
  giveMana(world, player);
  world.add(player, PlayerClassComponent, { classId });
  placeEntity(world, player, { x: 0, y: 0, z: 0 }, 0.4);
  world.step();
  return { world, rules, inventory, player };
}

describe('learning a spell from a book (mw-e07.2)', () => {
  it('AC-6: picks up the fixture book, studies it, and casts its spell', () => {
    const { world, rules, inventory, player } = game('sorcerer');
    const learned: string[] = [];
    const cast: string[] = [];
    const fizzled: string[] = [];
    world.events.on(SpellLearned, (e) => learned.push(`${e.spellId}<${e.source}`));
    world.events.on(SpellCast, (e) => cast.push(e.spell));
    world.events.on(SpellFizzled, (e) => fizzled.push(e.reason));

    // Not yet: the cast is refused.
    world.step([
      { type: 'cast', caster: player, spell: 'fixture-bolt', aim: { x: 1, y: 0, z: 0 } },
    ]);
    expect(fizzled).toEqual(['unknown-spell']);
    expect(inventory.add(world, player, PRIMER, 1)).toMatchObject({ ok: true });
    expect(rules.start(world, player, PRIMER)).toMatchObject({
      status: 'started',
      minutesLeft: 30,
    });
    for (let i = 0; i < 400; i++) world.step();
    expect(knowsSpell(world, player, 'fixture-bolt')).toBe(true);
    expect(learned).toEqual([`fixture-bolt<${PRIMER}`]);
    world.step([
      { type: 'cast', caster: player, spell: 'fixture-bolt', aim: { x: 1, y: 0, z: 0 } },
    ]);
    for (let i = 0; i < 5; i++) world.step();
    expect(cast).toEqual(['fixture-bolt']);
    expect(fizzled).toEqual(['unknown-spell']);
  });

  it('study needs the book in the pack', () => {
    const { world, rules, player } = game('sorcerer');
    expect(rules.start(world, player, PRIMER)).toEqual({
      status: 'refused',
      reason: 'not-carried',
    });
  });

  it('a knight can study an easy first-step book but not a deeper or harder one', () => {
    const defs = bookStudyDefs(content);
    expect(defs.get(PRIMER)).toMatchObject({ spell: 'fixture-bolt', studyMinutes: 30 });
    const bolt = content.all('spell').find((s) => s.id === 'fixture-bolt');
    if (bolt === undefined) throw new Error('fixture-bolt');
    // fixture-bolt: tier 1, fire (licensed), but 15 mana is within the 20-mana bound.
    expect(learnersOf(bolt, 0)).toBe('any');
    expect(learnersOf(bolt, 0.31)).toEqual(['sorcerer']);
    expect(learnersOf({ ...bolt, tier: 2 }, 0)).toEqual(['sorcerer']);
    expect(learnersOf({ ...bolt, cost: { mana: 21 } }, 0)).toEqual(['sorcerer']);
    expect(learnersOf({ ...bolt, school: 'shadow' }, 0)).toEqual(['sorcerer']);
    const knight = game('knight');
    knight.inventory.add(knight.world, knight.player, PRIMER, 1);
    expect(knight.rules.start(knight.world, knight.player, PRIMER)).toMatchObject({
      status: 'started',
    });
  });
});
