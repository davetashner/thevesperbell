import { describe, expect, it } from 'vitest';
import { World } from '../core/world';
import {
  addCapabilities,
  CapabilityRegistry,
  capabilitySources,
  hasCapability,
} from '../progression/capabilities';
import { progressionLearned, UnlockBook } from '../progression/unlocks';
import { KnownSpellsComponent, knowsSpell } from './components';
import { SpellLearned, SpellLearning, spellCapability, type SpellLearnedInfo } from './learning';

function setup(learning: SpellLearning, capabilities = true) {
  const world = new World<never>({ seed: 1 });
  world.register(KnownSpellsComponent);
  const actor = world.spawn();
  world.add(actor, KnownSpellsComponent, { spells: [] });
  if (capabilities) addCapabilities(world, actor);
  world.step();
  const learned: SpellLearnedInfo[] = [];
  world.events.on(SpellLearned, (e) => learned.push(e));
  return { world, actor, learned, learning };
}

describe('learning a spell (mw-e07.2)', () => {
  it('a bare learner just knows the spell and says so once', () => {
    const { world, actor, learned, learning } = setup(new SpellLearning(), false);
    expect(learning.learn(world, actor, 'bolt', 'primer')).toEqual({ status: 'learned' });
    world.step();
    expect(knowsSpell(world, actor, 'bolt')).toBe(true);
    expect(learned).toEqual([
      { tick: expect.any(Number) as number, actor, spellId: 'bolt', source: 'primer' },
    ]);
    expect(learning.learn(world, actor, 'bolt', 'primer')).toEqual({ status: 'already-known' });
    expect(learning.check(world, actor, 'bolt', 'book:primer')).toEqual({
      status: 'already-known',
    });
    world.step();
    expect(learned).toHaveLength(1);
  });

  it('grants a declared spell capability with the learned source; an undeclared one is skipped', () => {
    const registry = new CapabilityRegistry(['spell.bolt']);
    const { world, actor, learning } = setup(new SpellLearning({ capabilities: registry }));
    learning.learn(world, actor, 'bolt', 'primer');
    learning.learn(world, actor, 'fixture-spark', 'primer');
    expect(capabilitySources(world, actor, 'spell.bolt')).toEqual(['learned']);
    expect(hasCapability(world, actor, spellCapability('fixture-spark'))).toBe(false);
    expect(knowsSpell(world, actor, 'fixture-spark')).toBe(true);
  });

  it('goes through the unlock book when the spell has an unlock: prerequisites bind, the channel is recorded', () => {
    const registry = new CapabilityRegistry(['spell.ember', 'spell.firebolt']);
    const unlocks = new UnlockBook(registry, [
      { capability: 'spell.ember', prerequisites: [], channels: ['book', 'trainer'] },
      { capability: 'spell.firebolt', prerequisites: ['spell.ember'], channels: ['book'] },
    ]);
    const { world, actor, learned, learning } = setup(
      new SpellLearning({ capabilities: registry, unlocks }),
    );
    const channels: string[] = [];
    world.events.on(progressionLearned, (e) => channels.push(e.channel));
    expect(learning.check(world, actor, 'firebolt', 'book:tome')).toMatchObject({
      status: 'refused',
      refusals: [{ reason: 'missing-prerequisite', capability: 'spell.ember' }],
    });
    expect(learning.learn(world, actor, 'firebolt', 'tome')).toMatchObject({ status: 'refused' });
    expect(knowsSpell(world, actor, 'firebolt')).toBe(false);
    expect(learning.learn(world, actor, 'ember', 'trainer:abbot', 'trainer:abbot')).toEqual({
      status: 'learned',
    });
    expect(learning.learn(world, actor, 'firebolt', 'tome')).toEqual({ status: 'learned' });
    world.step();
    expect(channels).toEqual(['trainer:abbot', 'book:tome']);
    expect(learned.map((e) => e.source)).toEqual(['trainer:abbot', 'tome']);
  });

  it('a capability already held from a class still adds the spell to the known list', () => {
    const registry = new CapabilityRegistry(['spell.ember']);
    const unlocks = new UnlockBook(registry, [
      { capability: 'spell.ember', prerequisites: [], channels: ['book'] },
    ]);
    const { world, actor, learning } = setup(
      new SpellLearning({ capabilities: registry, unlocks }),
    );
    registry.grant(world, actor, 'spell.ember', 'class');
    expect(learning.learn(world, actor, 'ember', 'tome')).toEqual({ status: 'learned' });
    expect(knowsSpell(world, actor, 'ember')).toBe(true);
  });
});
