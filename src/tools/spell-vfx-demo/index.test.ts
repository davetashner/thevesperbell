import { describe, expect, it } from 'vitest';
import { loadGameContent } from '@content/game-content';
import { SPELL_VFX_SLOTS } from '@content/index';
import { SpellVfxLibrary, SpellVfxPlayer } from '@game/spell-vfx/index';
import {
  parseSpellDemoParam,
  SPELL_DEMO_AREA_RADIUS,
  SPELL_DEMO_CASTER,
  SPELL_DEMO_PROJECTILE,
  SPELL_DEMO_SOCKET,
  SPELL_DEMO_STEP_SECONDS,
  SPELL_DEMO_TARGET,
  SpellVfxDemo,
  spellDemoBlocks,
} from './index.ts';

const content = loadGameContent();

describe('spell VFX testbed (mw-e29.10)', () => {
  it('is off without the parameter and for an unknown slot', () => {
    expect(parseSpellDemoParam('')).toBeUndefined();
    expect(parseSpellDemoParam('?spells=')).toBeUndefined();
    expect(parseSpellDemoParam('?spells=bogus')).toBeUndefined();
    expect(parseSpellDemoParam('?scene=does-not-exist')).toBeUndefined();
  });

  it('?spells=demo shows every slot in cast order for each block; ?spells=<slot> shows one', () => {
    const blocks = Object.keys(spellDemoBlocks());
    const all = parseSpellDemoParam('?spells=demo') ?? [];
    expect(all).toHaveLength(blocks.length * SPELL_VFX_SLOTS.length);
    expect(all.slice(0, SPELL_VFX_SLOTS.length).map((s) => s.slot)).toEqual([...SPELL_VFX_SLOTS]);
    expect(parseSpellDemoParam('?spells=area')?.map((s) => s.slot)).toEqual(
      blocks.map(() => 'area'),
    );
  });

  it('AC-1: the demo blocks name templates only and resolve every slot', () => {
    const library = new SpellVfxLibrary(
      content.all('spell-vfx-template'),
      content.all('vfx-effect'),
    );
    for (const block of Object.values(spellDemoBlocks())) {
      const resolved = library.resolve(block);
      for (const slot of SPELL_VFX_SLOTS) expect(resolved[slot], slot).toBeDefined();
    }
  });

  it('plays each step through the player: every slot, the beam start on the caster socket, the projectile impact', () => {
    const library = new SpellVfxLibrary(
      content.all('spell-vfx-template'),
      content.all('vfx-effect'),
    );
    const spawned: string[] = [];
    const rings: number[] = [];
    const beamStarts: { x: number; y: number; z: number }[] = [];
    const hand: { current: SpellVfxDemo | undefined } = { current: undefined };
    const player = new SpellVfxPlayer({
      vfx: {
        spawn: (effect) => {
          spawned.push(effect);
          return spawned.length;
        },
        stop: () => undefined,
      },
      anchors: (entity, socket) => hand.current?.anchor(entity, socket),
      surfaces: {
        openRing: (spec) => {
          rings.push(spec.radius);
          return { close: () => undefined };
        },
        openBeam: () => ({
          setEnds: (start) => beamStarts.push({ ...start }),
          close: () => undefined,
        }),
      },
    });
    const steps = parseSpellDemoParam('?spells=demo') ?? [];
    const demo = new SpellVfxDemo(player, library, steps);
    hand.current = demo;
    const stage = { origin: { x: 0, y: 0, z: 0 }, yaw: 0 };
    const slots: string[] = [];
    let beamHands = 0;
    const dissolves: number[] = [];
    for (let frame = 0; frame < 16 * 60 * 3.3 && slots.length < SPELL_VFX_SLOTS.length; frame++) {
      demo.update(1 / 60, stage);
      player.update();
      const now = demo.stats.slot;
      if (slots.at(-1) !== now) slots.push(now);
      if (now === 'beam') {
        beamHands++;
        // Every frame the beam start is where the caster's socket is right now.
        const hand = demo.anchor(SPELL_DEMO_CASTER, SPELL_DEMO_SOCKET)?.position;
        expect(beamStarts.at(-1)?.z).toBeCloseTo(hand?.z ?? NaN, 6);
        expect(beamStarts.at(-1)?.x).toBeCloseTo(hand?.x ?? NaN, 6);
      }
      if (now === 'summon') dissolves.push(demo.dissolve);
    }
    // One more pass to see the summon out and the cycle restart.
    for (let t = 0; t < SPELL_DEMO_STEP_SECONDS * 2; t += 1 / 60) {
      demo.update(1 / 60, stage);
      player.update();
      if (demo.stats.slot === 'summon') dissolves.push(demo.dissolve);
    }
    expect(slots).toEqual([...SPELL_VFX_SLOTS]);
    expect(rings).toEqual([SPELL_DEMO_AREA_RADIUS]);
    expect(beamHands).toBeGreaterThan(0);
    // The caster walks, so the start moved.
    expect(new Set(beamStarts.map((s) => s.z.toFixed(2))).size).toBeGreaterThan(5);
    // Projectile: head and trail, then its impact at the target; the impact slot adds another.
    expect(
      spawned.filter((e) => e.startsWith('vfx-spell-impact-burst')).length,
    ).toBeGreaterThanOrEqual(2);
    expect(Math.max(...dissolves)).toBe(1);
    expect(Math.min(...dissolves)).toBe(0);
    expect(demo.stats.started).toBeGreaterThanOrEqual(SPELL_VFX_SLOTS.length);
    demo.dispose();
  });

  it('only the stand-ins are anchored, and the projectile is where the flight puts it', () => {
    const library = new SpellVfxLibrary(
      content.all('spell-vfx-template'),
      content.all('vfx-effect'),
    );
    const player = new SpellVfxPlayer({
      vfx: { spawn: () => 1, stop: () => undefined },
      anchors: () => undefined,
      surfaces: {
        openRing: () => ({ close: () => undefined }),
        openBeam: () => ({ setEnds: () => undefined, close: () => undefined }),
      },
    });
    const demo = new SpellVfxDemo(player, library, parseSpellDemoParam('?spells=projectile') ?? []);
    expect(demo.anchor(5, undefined)).toBeUndefined();
    expect(demo.current).toBeUndefined();
    expect(demo.summoned).toBe(false);
    expect(demo.stats.step).toBe(-1);
    expect(demo.figures().summoned.present).toBe(false);
    expect(() => new SpellVfxDemo(player, library, [])).toThrow(/no steps/);
    const stage = { origin: { x: 0, y: 0, z: 0 }, yaw: Math.PI / 2 };
    demo.update(0.1, stage);
    expect(demo.current?.slot).toBe('projectile');
    demo.update(1, stage); // past the 0.9 s flight: the projectile has arrived
    expect(demo.anchor(SPELL_DEMO_PROJECTILE, undefined)?.position.y).toBeCloseTo(
      demo.anchor(SPELL_DEMO_TARGET, undefined)?.position.y ?? NaN,
      5,
    );
  });
});
