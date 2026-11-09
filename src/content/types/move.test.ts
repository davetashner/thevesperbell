import { describe, expect, expectTypeOf, it } from 'vitest';
import type { DamagePacketInput } from '../../sim/combat/damage/packet.ts';
import type { StimulusShape } from '../../sim/stimulus/shapes.ts';
import { loadGameContent } from '../game-content.ts';
import { ContentLoadError, loadContent, type ContentSource } from '../loader.ts';
import { contentTypes } from '../registry.ts';
import { serializeContent } from '../schema.ts';
import { describeContent } from '../testing.ts';
import {
  ANIM_ID_PATTERN,
  AUDIO_CUE_PATTERN,
  VFX_CUE_PATTERN,
  compileMove,
  compileMoves,
  moveSchema,
  moveWarnings,
  type MoveDefInput,
  type MoveEntry,
  type RuntimeMove,
} from './move.ts';

/** The moves the beads ask for: knight sword light 1–3, heavy, charged, bash, kick, roll, backstep, roll attack, dummy. */
const REQUIRED_MOVES = [
  'backstep',
  'dodge-roll',
  'dodge-roll-heavy',
  'dodge-roll-light',
  'dodge-roll-medium',
  'dodge-stumble',
  'forgotten-archer-shot',
  'forgotten-archer-shove',
  'forgotten-brute-overhead',
  'forgotten-brute-sweep',
  'forgotten-lunging-thrust',
  'forgotten-overhead-chop',
  'forgotten-shield-bash',
  'forgotten-shield-counter',
  'forgotten-slash-1',
  'forgotten-slash-2',
  'halberd-chop',
  'halberd-sweep',
  'kick',
  'mace-light',
  'roll-attack',
  'shield-bash',
  'shield-parry',
  'spear-thrust',
  'sword-heavy',
  'sword-heavy-charged',
  'sword-light-1',
  'sword-light-2',
  'sword-light-3',
  'sword-riposte',
  'training-dummy-swing',
];

const swing = {
  id: 'fixture-swing',
  notes: 'Test move.',
  verb: 'attack',
  frames: { startup: 12, active: 4, recovery: 18 },
  damage: { amounts: { slash: 20 } },
  hitbox: {
    track: 'fixture-arc',
    shape: { kind: 'sphere', center: { x: 0, y: 1, z: 1 }, radius: 0.5 },
    reach: 'medium',
    swing: 'horizontal',
  },
  presentation: { anim: 'anim-fixture-swing' },
} satisfies MoveDefInput;

const roll = {
  id: 'fixture-roll',
  notes: 'Test dodge.',
  verb: 'dodge',
  frames: { startup: 2, active: 13, recovery: 21 },
  presentation: { anim: 'anim-fixture-roll' },
} satisfies MoveDefInput;

const file = (json: MoveDefInput): ContentSource => ({
  path: `data/move/${json.id}.json`,
  text: JSON.stringify(json),
});

/** The load issues for `moves`, or [] when they load. */
function issuesOf(...moves: MoveDefInput[]) {
  try {
    loadContent(contentTypes, moves.map(file));
    return [];
  } catch (error) {
    if (error instanceof ContentLoadError) return error.issues;
    throw error;
  }
}

/** `pointer: message` for every schema problem with one move, or [] when it is valid. */
function problems(move: unknown): string[] {
  const result = moveSchema.safeParse(move);
  return result.success ? [] : result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
}

const entry = (move: MoveDefInput): MoveEntry => moveSchema.parse(move);

describeContent('move', 'AC-1: passes the schema and has a runtime form', (move, content) => {
  expect(moveSchema.parse(JSON.parse(serializeContent(move)))).toEqual(move);
  expect(move.notes.length).toBeGreaterThan(40); // a real explanation of the numbers
  expect(moveWarnings([move])).toEqual([]);
  const runtime = compileMove(move);
  expect(runtime.totalTicks).toBe(move.frames.startup + move.frames.active + move.frames.recovery);
  if (move.chainNext !== undefined) expect(content.resolve(move.chainNext).verb).toBe(move.verb);
  if (move.charge !== undefined) {
    const from = content.resolve(move.charge.from);
    expect(from.staminaCost).toBeLessThan(move.staminaCost);
    // The charge only holds the windup: the swing it releases has the uncharged move's frames.
    expect(from.frames).toEqual(move.frames);
  }
});

describe('move schema', () => {
  it('AC-1: every knight move the bead lists (and the e04.20 skeleton set) loads, and sword-light-1 is 12/4/18 ticks', () => {
    const content = loadGameContent();
    expect(content.all('move').map((m) => m.id)).toEqual(REQUIRED_MOVES);
    const table = compileMoves(content.all('move'));
    expect([...table.keys()]).toEqual(REQUIRED_MOVES);
    expect(table.get('sword-light-1')).toMatchObject({
      startup: 12,
      active: 4,
      recovery: 18,
      totalTicks: 34,
      activeFrom: 12,
      recoveryFrom: 16,
      staminaCost: 12,
      chainNext: 'sword-light-2',
      parryable: true,
      blockable: true,
      unblockable: false,
    });
    expect(table.get('sword-light-1')?.damage).toMatchObject({
      amounts: { slash: 20 },
      poiseDamage: 15,
    });
  });

  it('mw-e04.12: the shipped parry is the bead’s 30-tick, 10-stamina move with window 4–13; the riposte is a critical with i-frames throughout', () => {
    const table = compileMoves(loadGameContent().all('move'));
    expect(table.get('shield-parry')).toMatchObject({
      verb: 'parry',
      totalTicks: 30,
      activeFrom: 4,
      recoveryFrom: 14,
      staminaCost: 10,
      hitbox: null,
      damage: null,
    });
    const riposte = table.get('sword-riposte');
    expect(riposte?.damage).toMatchObject({
      amounts: { slash: 20 },
      tags: ['critical', 'riposte'],
    });
    expect(riposte?.iframes).toEqual({ from: 0, to: (riposte?.totalTicks ?? 0) - 1 });
    expect(riposte?.hitStop).toBe('critical');
  });

  it('mw-e04.8: the shipped roll and backstep carry the bead’s timing, i-frames, motion and roll attack', () => {
    const table = compileMoves(loadGameContent().all('move'));
    expect(table.get('dodge-roll')).toMatchObject({
      verb: 'dodge',
      totalTicks: 36,
      staminaCost: 20,
      iframes: { from: 2, to: 14 },
      motion: { distance: 3, direction: 'input' },
      cancelWindows: [{ into: 'attack', from: 28, to: 35, move: 'roll-attack' }],
    });
    expect(table.get('backstep')).toMatchObject({
      verb: 'dodge',
      totalTicks: 24,
      staminaCost: 12,
      iframes: { from: 2, to: 7 },
      motion: { direction: 'backward' },
    });
    expect(table.get('roll-attack')?.verb).toBe('attack');
  });

  it('mw-e04.8: motion and a cancel window’s move compile to plain values', () => {
    const runtime = compileMove(
      entry({
        ...roll,
        cancelWindows: [
          { into: 'attack', from: 28, to: 35, move: 'fixture-swing' },
          { into: 'block', from: 30, to: 35 },
        ],
        motion: { distance: 3, direction: 'input' },
      }),
    );
    expect(runtime.motion).toEqual({ distance: 3, direction: 'input' });
    expect(runtime.cancelWindows).toEqual([
      { into: 'attack', from: 28, to: 35, move: 'fixture-swing' },
      { into: 'block', from: 30, to: 35, move: null },
    ]);
    expect(Object.isFrozen(runtime.cancelWindows[0])).toBe(true);
    expect(Object.isFrozen(runtime.motion)).toBe(true);
  });

  it('mw-e04.8: a window cannot name its own move, motion needs active ticks, and window moves must exist', () => {
    expect(
      problems({
        ...roll,
        cancelWindows: [{ into: 'dodge', from: 20, to: 30, move: 'fixture-roll' }],
      }),
    ).toEqual(['cancelWindows.0.move: move "fixture-roll": a move cannot cancel into itself']);
    expect(
      problems({
        ...roll,
        frames: { startup: 2, active: 0, recovery: 10 },
        motion: { distance: 1, direction: 'backward' },
      }),
    ).toEqual([
      'motion: move "fixture-roll": a move with motion needs at least one active tick to travel on',
    ]);
    expect(
      problems({
        ...roll,
        frames: { startup: 2, active: 0, recovery: 10 },
        motion: { distance: 0, direction: 'backward' },
      }),
    ).toEqual([]);
    expect(
      issuesOf({
        ...roll,
        cancelWindows: [{ into: 'attack', from: 28, to: 35, move: 'nope' }],
      }).map((i) => [i.pointer, i.message]),
    ).toEqual([['/cancelWindows/0/move', 'move:fixture-roll references missing move:nope']]);
  });

  it('AC-1: the runtime table is sorted by id, whatever order the moves come in', () => {
    const a = entry({ ...swing, id: 'a' });
    const b = entry({ ...swing, id: 'b' });
    expect([...compileMoves([b, a]).keys()]).toEqual(['a', 'b']);
  });

  it('AC-1: a non-hitting move compiles with nulls and is neither parryable nor blockable', () => {
    const runtime = compileMove(entry({ ...roll, flags: { iframes: { from: 2, to: 14 } } }));
    expect(runtime).toEqual({
      id: 'fixture-roll',
      verb: 'dodge',
      startup: 2,
      active: 13,
      recovery: 21,
      totalTicks: 36,
      activeFrom: 2,
      recoveryFrom: 15,
      staminaCost: 0,
      cancelWindows: [],
      damage: null,
      hitbox: null,
      parryable: false,
      blockable: false,
      unblockable: false,
      interruptible: false,
      hyperarmor: null,
      iframes: { from: 2, to: 14 },
      telegraphTick: 0,
      chainNext: null,
      charge: null,
      motion: null,
      hitStop: null,
      presentation: { anim: 'anim-fixture-roll' },
    } satisfies RuntimeMove);
    expect(Object.isFrozen(runtime)).toBe(true);
  });

  it('mw-e03.11: a swing carries its world impact into the runtime move; only hitting moves may', () => {
    const smash = compileMove(moveSchema.parse({ ...swing, worldImpact: { blunt: 150 } }));
    expect(smash.worldImpact).toEqual({ blunt: 150 });
    expect(compileMove(moveSchema.parse(swing)).worldImpact).toBeUndefined();
    expect(problems({ ...roll, worldImpact: { force: 10 } })).toEqual([
      'worldImpact: move "fixture-roll": only a move with a hitbox strikes the world',
    ]);
    expect(problems({ ...swing, worldImpact: { fire: 10 } })).toEqual([
      'worldImpact: Unrecognized key: "fire"',
    ]);
    // mw-e04.14: a shove may carry a weight limit; a limit needs a shove.
    const bash = compileMove(
      moveSchema.parse({ ...swing, worldImpact: { force: 150, maxWeight: 60 } }),
    );
    expect(bash.worldImpact).toEqual({ force: 150, maxWeight: 60 });
    expect(problems({ ...swing, worldImpact: { blunt: 60, maxWeight: 60 } })).toEqual([
      'worldImpact.maxWeight: move "fixture-swing": a weight limit needs a force to limit',
    ]);
    expect(problems({ ...swing, worldImpact: { force: 150, maxWeight: 0 } })).toHaveLength(1);
    const heavy = compileMoves(loadGameContent().all('move')).get('sword-heavy');
    expect(heavy?.worldImpact).toEqual({ blunt: 150 });
  });

  it('AC-1: a charged move compiles its charge with a plain move id', () => {
    const charge = {
      from: 'fixture-swing',
      minHoldTicks: 12,
      fullHoldTicks: 60,
      autoReleaseTicks: 90,
      holdTick: 10,
    };
    const runtime = compileMove(entry({ ...swing, id: 'charged', charge }));
    expect(runtime.charge).toEqual(charge);
    expect(runtime.hyperarmor).toBeNull();
  });

  it('AC-1: defaults are filled and hit templates fit the damage model and stimulus shapes', () => {
    const move = entry(swing);
    expect(move).toMatchObject({
      schemaVersion: 1,
      staminaCost: 0,
      cancelWindows: [],
      telegraphTick: 0,
      flags: { parryable: true, unblockable: false, interruptible: false },
      damage: {
        poiseDamage: 0,
        staminaDamage: 0,
        impulse: { x: 0, y: 0, z: 0 },
        impactForce: 0,
        tags: [],
      },
    });
    expectTypeOf<NonNullable<RuntimeMove['damage']>>().toExtend<DamagePacketInput>();
    expectTypeOf<NonNullable<RuntimeMove['hitbox']>['shape']>().toExtend<StimulusShape>();
  });

  it('AC-2: an i-frame range past startup+active+recovery fails with the move id and field path', () => {
    const issues = issuesOf({ ...roll, flags: { iframes: { from: 2, to: 36 } } });
    expect(issues).toEqual([
      {
        file: 'data/move/fixture-roll.json',
        pointer: '/flags/iframes/to',
        message: expect.stringMatching(
          /^move "fixture-roll": to \(36\) extends beyond the move's last tick \(35;.*\(at flags\.iframes\.to\)$/,
        ) as string,
      },
    ]);
  });

  it('AC-2: a hyperarmor range or cancel window past the move fails at its path', () => {
    const issues = issuesOf({
      ...swing,
      flags: { hyperarmor: { from: 10, to: 34, poiseCap: 40 } },
      cancelWindows: [
        { into: 'dodge', from: 22, to: 33 },
        { into: 'attack', from: 30, to: 40 },
      ],
    });
    expect(issues.map((i) => i.pointer)).toEqual(['/flags/hyperarmor/to', '/cancelWindows/1/to']);
    expect(issues.every((i) => i.message.includes('move "fixture-swing"'))).toBe(true);
  });

  it('AC-2: a range that ends before it starts fails', () => {
    expect(problems({ ...roll, flags: { iframes: { from: 5, to: 4 } } })).toEqual([
      'flags.iframes.to: move "fixture-roll": to (4) is before from (5)',
    ]);
  });

  it('AC-3: a chainNext (or charge.from) naming a missing move fails listing each dangling ref', () => {
    const issues = issuesOf(
      { ...swing, chainNext: 'sword-light-9' },
      {
        ...swing,
        id: 'charged',
        charge: {
          from: 'no-such-heavy',
          minHoldTicks: 0,
          fullHoldTicks: 1,
          autoReleaseTicks: 1,
          holdTick: 0,
        },
      },
    );
    expect(issues).toEqual([
      {
        file: 'data/move/charged.json',
        pointer: '/charge/from',
        message: 'move:charged references missing move:no-such-heavy',
      },
      {
        file: 'data/move/fixture-swing.json',
        pointer: '/chainNext',
        message: 'move:fixture-swing references missing move:sword-light-9',
      },
    ]);
  });

  it('AC-3: chains that resolve load', () => {
    expect(issuesOf({ ...swing, chainNext: 'b' }, { ...swing, id: 'b' })).toEqual([]);
  });

  it('AC-4: a parryable unblockable move without a parryNote warns; with a note or unparryable it does not', () => {
    const grab = entry({ ...swing, flags: { unblockable: true } });
    expect(moveWarnings([grab])).toEqual([
      {
        move: 'fixture-swing',
        path: 'flags',
        message: expect.stringContaining('both parryable and unblockable') as string,
      },
    ]);
    const noted = entry({
      ...swing,
      flags: { unblockable: true, parryNote: 'A telegraphed slam.' },
    });
    const unparryable = entry({ ...swing, flags: { unblockable: true, parryable: false } });
    expect(moveWarnings([noted, unparryable])).toEqual([]);
    expect(compileMove(unparryable)).toMatchObject({
      parryable: false,
      blockable: false,
      unblockable: true,
    });
  });

  it('AC-5: an unknown audioCue passes validation with one warning naming the id', () => {
    const move = {
      ...swing,
      presentation: {
        anim: 'anim-fixture-swing',
        audioCue: 'sfx-fixture-whoosh',
        vfxCue: 'vfx-fixture-trail',
      },
    };
    expect(issuesOf(move)).toEqual([]);
    const warnings = moveWarnings([entry(move)], {
      audio: ['sfx-other'],
      vfx: ['vfx-fixture-trail'],
      anim: ['anim-fixture-swing'],
    });
    expect(warnings).toEqual([
      {
        move: 'fixture-swing',
        path: 'presentation.audioCue',
        message: expect.stringContaining('"sfx-fixture-whoosh"') as string,
      },
    ]);
  });

  it('AC-5: unknown anim and vfx ids warn too; kinds with no known list are not checked', () => {
    const move = entry({
      ...swing,
      presentation: { anim: 'anim-x', audioCue: 'sfx-x', vfxCue: 'vfx-x' },
    });
    expect(moveWarnings([move], { anim: [], vfx: [] }).map((w) => w.path)).toEqual([
      'presentation.anim',
      'presentation.vfxCue',
    ]);
    expect(moveWarnings([move])).toEqual([]);
    expect(moveWarnings([entry(roll)], { audio: [], vfx: [] })).toEqual([]);
  });

  it('mw-e04.20: telegraph cues follow the naming patterns and unknown ones warn like the others', () => {
    const telegraph = { audioCue: 'sfx-telegraph-x', vfxCue: 'vfx-telegraph-x' };
    const move = entry({ ...swing, presentation: { anim: 'anim-x', telegraph } });
    expect(compileMove(move).presentation.telegraph).toEqual(telegraph);
    expect(moveWarnings([move], { audio: [], vfx: ['vfx-telegraph-x'] })).toEqual([
      {
        move: 'fixture-swing',
        path: 'presentation.telegraph.audioCue',
        message: expect.stringContaining('"sfx-telegraph-x"') as string,
      },
    ]);
    expect(
      problems({
        ...swing,
        presentation: { anim: 'anim-x', telegraph: { audioCue: 'vfx-a', vfxCue: 'sfx-b' } },
      }),
    ).toEqual([
      expect.stringContaining('presentation.telegraph.audioCue: must be an audio cue id'),
      expect.stringContaining('presentation.telegraph.vfxCue: must be a VFX cue id'),
    ]);
    expect(
      problems({ ...swing, presentation: { anim: 'anim-x', telegraph: { audioCue: 'sfx-a' } } }),
    ).toHaveLength(1);
  });

  it('presentation ids must follow the asset naming patterns', () => {
    expect(ANIM_ID_PATTERN.test('anim-knight-kick')).toBe(true);
    expect(AUDIO_CUE_PATTERN.test('sfx-knight-kick')).toBe(true);
    expect(VFX_CUE_PATTERN.test('vfx-impact-dust')).toBe(true);
    const bad = problems({
      ...swing,
      presentation: { anim: 'knight-kick', audioCue: 'knight-kick', vfxCue: 'sfx-dust' },
    });
    expect(bad).toEqual([
      expect.stringContaining('presentation.anim: must be an animation id'),
      expect.stringContaining('presentation.audioCue: must be an audio cue id'),
      expect.stringContaining('presentation.vfxCue: must be a VFX cue id'),
    ]);
  });

  it('a move must last at least one tick', () => {
    expect(problems({ ...roll, frames: { startup: 0, active: 0, recovery: 0 } })).toEqual([
      'frames: move "fixture-roll": must last at least one tick',
    ]);
  });

  it('an attack needs a hitbox, and hitbox and damage go together', () => {
    const noHitbox = { ...swing, hitbox: undefined };
    expect(problems(noHitbox)).toEqual([
      'hitbox: move "fixture-swing": an attack needs a hitbox',
      'hitbox: move "fixture-swing": hitbox and damage go together: a move that can hit needs both',
    ]);
    const noDamage = { ...swing, damage: undefined };
    expect(problems(noDamage)).toEqual([
      'damage: move "fixture-swing": hitbox and damage go together: a move that can hit needs both',
    ]);
  });

  it('a hitting move needs an active tick and a telegraph before it', () => {
    expect(problems({ ...swing, frames: { startup: 12, active: 0, recovery: 18 } })).toEqual([
      'frames.active: move "fixture-swing": a move with a hitbox needs at least one active tick',
    ]);
    expect(problems({ ...swing, telegraphTick: 12 })).toEqual([
      'telegraphTick: move "fixture-swing": telegraphTick (12) must come before the first active tick (12)',
    ]);
    expect(problems({ ...swing, telegraphTick: 11 })).toEqual([]);
  });

  it('a non-hitting move’s telegraph must be inside the move', () => {
    expect(problems({ ...roll, telegraphTick: 36 })).toEqual([
      'telegraphTick: move "fixture-roll": telegraphTick (36) is past the move',
    ]);
    expect(problems({ ...roll, telegraphTick: 35 })).toEqual([]);
  });

  it('a move cannot chain into itself', () => {
    expect(problems({ ...swing, chainNext: 'fixture-swing' })).toEqual([
      'chainNext: move "fixture-swing": a move cannot chain into itself',
    ]);
  });

  it('a charge must come from another move with min ≤ full ≤ auto-release hold ticks', () => {
    const charge = {
      from: 'fixture-swing',
      minHoldTicks: 61,
      fullHoldTicks: 60,
      autoReleaseTicks: 59,
      holdTick: 12,
    };
    expect(problems({ ...swing, charge })).toEqual([
      'charge.from: move "fixture-swing": cannot be the move itself',
      'charge.minHoldTicks: move "fixture-swing": must be at most fullHoldTicks',
      'charge.fullHoldTicks: move "fixture-swing": must be at most autoReleaseTicks',
      'charge.holdTick: move "fixture-swing": holdTick (12) must come before the first active tick (12)',
    ]);
  });

  it('hit volumes accept capsules and boxes and reject non-positive sizes and unknown kinds', () => {
    const withShape = (shape: unknown) => ({ ...swing, hitbox: { ...swing.hitbox, shape } });
    const capsule = {
      kind: 'capsule',
      from: { x: 0, y: 1, z: 0 },
      to: { x: 0, y: 1, z: 1 },
      radius: 0.1,
    };
    const box = { kind: 'box', center: { x: 0, y: 1, z: 1 }, halfExtents: { x: 1, y: 1, z: 1 } };
    expect(problems(withShape(capsule))).toEqual([]);
    expect(problems(withShape(box))).toEqual([]);
    expect(problems(withShape({ ...capsule, radius: 0 }))).toHaveLength(1);
    expect(problems(withShape({ kind: 'cone' }))).toHaveLength(1);
  });

  it('damage amounts are keyed by the damage model’s types', () => {
    expect(problems({ ...swing, damage: { amounts: { sharp: 1 } } })).toHaveLength(1);
    expect(problems({ ...swing, damage: { amounts: { fire: -1 } } })).toHaveLength(1);
  });
});
