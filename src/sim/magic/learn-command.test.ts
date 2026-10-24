import { describe, expect, it } from 'vitest';
import type { World } from '../core/world';
import { knowsSpell, learnSpell } from './components';
import {
  installSpellLearning,
  isLearnSpellCommand,
  learnSpellCommand,
  type LearnSpellCommand,
} from './learn-command';
import type { CastCommand } from './pipeline';
import { makeSpell, spellWorld } from './testing';

type Input = CastCommand | LearnSpellCommand;

describe('learn-spell command (mw-e06.15)', () => {
  const setup = () => {
    const fixture = spellWorld([makeSpell('t-known'), makeSpell('t-other')]);
    const world = fixture.world as World<Input>;
    const taught: string[] = [];
    installSpellLearning(world, fixture.pipeline, (w, actor, spell) => {
      taught.push(spell);
      learnSpell(w, actor, spell);
    });
    const caster = fixture.spawn();
    learnSpell(world, caster, 't-other'); // the player's list exists up front
    return { world, caster, taught };
  };

  it('hands the learner each known spell on the tick the command runs', () => {
    const { world, caster, taught } = setup();
    world.step([learnSpellCommand(caster, 't-known'), learnSpellCommand(caster, 't-other')]);
    expect(taught).toEqual(['t-known', 't-other']);
    expect(knowsSpell(world, caster, 't-known')).toBe(true);
  });

  it('ignores a spell the pipeline does not know, a caster that is gone, and other inputs', () => {
    const { world, caster, taught } = setup();
    world.step([
      { type: 'cast', caster, spell: 'nonsense' },
      learnSpellCommand(caster, 'nonsense'),
    ]);
    world.destroy(caster);
    world.step([learnSpellCommand(caster, 't-known')]);
    expect(taught).toEqual([]);
  });

  it('isLearnSpellCommand recognises only its own type', () => {
    expect(isLearnSpellCommand(learnSpellCommand(1, 'x'))).toBe(true);
    expect(isLearnSpellCommand({ type: 'cast' })).toBe(false);
    expect(isLearnSpellCommand(null)).toBe(false);
    expect(isLearnSpellCommand('learn-spell')).toBe(false);
  });
});
