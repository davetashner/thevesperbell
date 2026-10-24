import { describe, expect, it } from 'vitest';
import { knowsSpell } from './components';
import { installSpellLearning, isLearnSpellCommand, learnSpellCommand } from './learn-command';
import { makeSpell, spellWorld } from './testing';
import type { CastCommand } from './pipeline';
import type { World } from '../core/world';
import type { LearnSpellCommand } from './learn-command';

type Input = CastCommand | LearnSpellCommand;

describe('learn-spell command (mw-e06.15)', () => {
  const setup = () => {
    const fixture = spellWorld([makeSpell('t-known')]);
    const world = fixture.world as World<Input>;
    installSpellLearning(world, fixture.pipeline);
    return { world, caster: fixture.spawn() };
  };

  it('teaches the caster the spell on the tick the command runs', () => {
    const { world, caster } = setup();
    world.step([{ type: 'cast', caster, spell: 'nonsense' }, learnSpellCommand(caster, 't-known')]);
    expect(knowsSpell(world, caster, 't-known')).toBe(true);
  });

  it('keeps every spell taught in the same tick to a caster who knew none', () => {
    const fixture = spellWorld([makeSpell('t-a'), makeSpell('t-b')]);
    const world = fixture.world as World<Input>;
    installSpellLearning(world, fixture.pipeline);
    const caster = fixture.spawn();
    world.step([
      learnSpellCommand(caster, 't-a'),
      learnSpellCommand(caster, 't-b'),
      learnSpellCommand(caster, 't-a'),
    ]);
    expect(knowsSpell(world, caster, 't-a')).toBe(true);
    expect(knowsSpell(world, caster, 't-b')).toBe(true);
    world.step([learnSpellCommand(caster, 't-b')]);
    expect(knowsSpell(world, caster, 't-a')).toBe(true);
  });

  it('is idempotent and also teaches a caster who already knows another spell', () => {
    const { world, caster } = setup();
    world.step([learnSpellCommand(caster, 't-known'), learnSpellCommand(caster, 't-known')]);
    world.step([learnSpellCommand(caster, 't-known')]);
    expect(knowsSpell(world, caster, 't-known')).toBe(true);
  });

  it('ignores a spell the pipeline does not know and a caster that is gone', () => {
    const { world, caster } = setup();
    world.step([learnSpellCommand(caster, 'nonsense')]);
    expect(knowsSpell(world, caster, 'nonsense')).toBe(false);
    world.destroy(caster);
    world.step([learnSpellCommand(caster, 't-known')]);
    expect(world.isAlive(caster)).toBe(false);
  });

  it('isLearnSpellCommand recognises only its own type', () => {
    expect(isLearnSpellCommand(learnSpellCommand(1, 'x'))).toBe(true);
    expect(isLearnSpellCommand({ type: 'cast' })).toBe(false);
    expect(isLearnSpellCommand(null)).toBe(false);
    expect(isLearnSpellCommand('learn-spell')).toBe(false);
  });
});
