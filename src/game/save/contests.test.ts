// The contests save section (mw-opf6 AC-3): a contest in progress, its scores, bet, cheats and the
// runner's rng survive a save and load (and so a carry across a transition); a world without a runner
// saves nothing; a contest this build dropped is dropped from the load with a warning.
import { describe, expect, it } from 'vitest';
import { loadGameContent } from '@content/index';
import { MemoryLogicHost, World, type ContestRunner } from '@sim/index';
import { contestsIn, installContests } from '../contest/install';
import { CONTESTS_MIGRATIONS, CONTESTS_SECTION_VERSION, contestsSaveSection } from './contests';
import { migrateSection, validateSection } from './format';
import { createGameSaveRegistry } from './sections';

const build = { gameVersion: '0.1.0', buildSha: 'deadbee', contentHash: 'c0ffee' };
const saveOptions = { build, wallClockSavedAt: 1_790_000_000_000 };
const ARM = 'drowned-gull-arm-wrestling';
const defs = contestsIn(loadGameContent());

function contestWorld(seed: number, contests = defs) {
  const world = new World<never>({ seed });
  const host = new MemoryLogicHost({ gold: 40 });
  const { runner } = installContests(world, { contests, host, player: () => undefined });
  return { world, runner, host };
}

const readInto = (world: World<never>, bytes: Uint8Array, warnings: string[] = []): boolean => {
  const result = createGameSaveRegistry().read(world, bytes);
  if (result.ok) warnings.push(...result.warnings.map((w) => w.message));
  return result.ok;
};

describe('contests save section', () => {
  it('AC-3: a match in progress resumes with its scores, bet, cheat record and rng', () => {
    const { world, runner } = contestWorld(7);
    expect(runner.enter(ARM, 0).ok).toBe(true);
    expect(runner.bet(ARM, { kind: 'onPlayer', stake: 4 }).ok).toBe(true);
    runner.record({ name: 'armwrestle.push', tick: 3 });
    runner.record({ name: 'spell.cast', tick: 4 }); // unseen: a pending grudge
    runner.update(200); // Oona scores twice and the stream advances
    const before = runner.serialize();
    const bytes = createGameSaveRegistry().write(world, saveOptions);

    const loaded = contestWorld(99);
    expect(readInto(loaded.world, bytes)).toBe(true);
    expect(loaded.runner.serialize()).toEqual(before);
    expect(loaded.runner.isActive(ARM)).toBe(true);
    expect(loaded.runner.standings(ARM).map((s) => s.score)).toEqual(
      runner.standings(ARM).map((s) => s.score),
    );
    // Both carry on identically.
    runner.update(900);
    loaded.runner.update(900);
    expect(loaded.runner.result(ARM)).toBe(runner.result(ARM));
    expect(loaded.runner.serialize().rng).toEqual(runner.serialize().rng);
  });

  it('AC-3: a finished contest keeps its result', () => {
    const { world, runner } = contestWorld(7);
    runner.enter(ARM, 0);
    runner.forfeit(ARM);
    const bytes = createGameSaveRegistry().write(world, saveOptions);
    const loaded = contestWorld(1);
    expect(readInto(loaded.world, bytes)).toBe(true);
    expect(loaded.runner.result(ARM)).toBe('forfeit');
    expect(loaded.runner.isActive(ARM)).toBe(false);
  });

  it('a world without a runner saves an empty section and ignores a loaded one', () => {
    const bare = new World<never>({ seed: 1 });
    const bytes = createGameSaveRegistry().write(bare, saveOptions);
    const { world, runner } = contestWorld(2);
    runner.enter(ARM, 0);
    expect(readInto(world, bytes)).toBe(true);
    expect(runner.isActive(ARM)).toBe(false);
    const { world: busy, runner: busyRunner } = contestWorld(3);
    busyRunner.enter(ARM, 0);
    const full = createGameSaveRegistry().write(busy, saveOptions);
    expect(readInto(new World<never>({ seed: 4 }), full)).toBe(true);
  });

  it('a contest this build no longer defines is dropped with a warning', () => {
    const { world, runner } = contestWorld(7);
    runner.enter(ARM, 0);
    runner.forfeit(ARM);
    runner.enter('drowned-gull-dice', 0);
    const bytes = createGameSaveRegistry().write(world, saveOptions);
    const fewer = contestWorld(
      8,
      defs.filter((d) => d.id === 'drowned-gull-dice'),
    );
    const warnings: string[] = [];
    expect(readInto(fewer.world, bytes, warnings)).toBe(true);
    expect(fewer.runner.isActive('drowned-gull-dice')).toBe(true);
    expect(warnings.filter((w) => w.includes(ARM))).toHaveLength(1);
  });

  it('a save from before the section existed loads with no contest running', () => {
    const { world, runner } = contestWorld(3);
    runner.enter(ARM, 0);
    const rng = runner.serialize().rng;
    contestsSaveSection().missing?.(world, { worldFacts: undefined, warn: () => undefined });
    expect(runner.isActive(ARM)).toBe(false);
    expect(runner.serialize().rng).toEqual(rng);
    const bare = new World<never>({ seed: 1 });
    contestsSaveSection().missing?.(bare, { worldFacts: undefined, warn: () => undefined });
  });

  it('a section saved without an rng keeps the runner stream', () => {
    const { world, runner } = contestWorld(3);
    const rng = runner.serialize().rng;
    const section = contestsSaveSection();
    section.deserialize(
      world,
      { active: {}, results: {} },
      { worldFacts: undefined, warn: () => undefined },
    );
    expect(runner.serialize().rng).toEqual(rng);
  });

  it('validates its data and has no migrations yet', () => {
    const section = contestsSaveSection();
    expect(CONTESTS_SECTION_VERSION).toBe(1);
    expect(CONTESTS_MIGRATIONS).toEqual({});
    const { runner } = contestWorld(5);
    runner.enter(ARM, 0);
    runner.bet(ARM, { kind: 'throw' });
    const good: unknown = JSON.parse(JSON.stringify(runner.serialize()));
    expect(validateSection(section, good).ok).toBe(true);
    expect(validateSection(section, { active: {}, results: { x: 'drew' } }).ok).toBe(false);
    expect(migrateSection(section, { version: 1, data: good }).ok).toBe(true);
  });
});

export type { ContestRunner };
