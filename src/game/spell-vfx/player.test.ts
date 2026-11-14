import { describe, expect, it } from 'vitest';
import { loadGameContent } from '@content/game-content';
import type { EntityId, Vec3 } from '@sim/index';
import type { VfxAnchorResolver, VfxSpawnOptions } from '../vfx/index.ts';
import type { BeamDrawing, BeamSpec, RingSpec, SpellVfxSurfaces } from '@render/spell-vfx/rules';
import { NO_SPELL_VFX, SpellVfxLibrary } from './library.ts';
import { SpellVfxPlayer } from './player.ts';

const content = loadGameContent();
const library = new SpellVfxLibrary(content.all('spell-vfx-template'), content.all('vfx-effect'));
const FULL = library.resolve({
  castWindup: { template: 'svt-windup-gather' },
  castRelease: { template: 'svt-release-burst' },
  projectile: { template: 'svt-projectile-bolt' },
  impact: { template: 'svt-impact-burst' },
  area: { template: 'svt-area-rune-ring' },
  beam: { template: 'svt-beam-stream' },
  sustainOnTarget: { template: 'svt-sustain-aura' },
  summon: { template: 'svt-summon-swirl' },
});

const CASTER: EntityId = 1;
const TARGET: EntityId = 2;

/** Recording stand-ins for the VfxSystem and the two drawings. */
function rig() {
  const places = new Map<EntityId, Vec3>([
    [CASTER, { x: 0, y: 1.3, z: 0 }],
    [TARGET, { x: 0, y: 1, z: -10 }],
  ]);
  const spawned: { effect: string; options: VfxSpawnOptions }[] = [];
  const stopped: number[] = [];
  const rings: { centre: Vec3; radius: number; ring: RingSpec; closed: boolean }[] = [];
  const beams: { spec: BeamSpec; starts: Vec3[]; ends: Vec3[]; closed: boolean }[] = [];
  const anchors: VfxAnchorResolver = (entity, socket) => {
    const position = places.get(entity);
    return position && socket !== 'gone' ? { position } : undefined;
  };
  const surfaces: SpellVfxSurfaces = {
    openRing: (spec) => {
      const live = { ...spec, closed: false };
      rings.push(live);
      return { close: () => (live.closed = true) };
    },
    openBeam: (spec) => {
      const live = { spec, starts: [] as Vec3[], ends: [] as Vec3[], closed: false };
      beams.push(live);
      const drawing: BeamDrawing = {
        setEnds: (start, end) => {
          live.starts.push({ ...start });
          live.ends.push({ ...end });
        },
        close: () => (live.closed = true),
      };
      return drawing;
    },
  };
  let handles = 0;
  const player = new SpellVfxPlayer({
    vfx: {
      spawn: (effect, options) => {
        spawned.push({ effect, options });
        return ++handles;
      },
      stop: (handle) => stopped.push(handle),
    },
    anchors,
    surfaces,
  });
  return { player, places, spawned, stopped, rings, beams };
}

describe('spell VFX player (mw-e29.10)', () => {
  it('particle slots spawn their tinted effect on the caster or target, scaled', () => {
    const { player, spawned, stopped } = rig();
    const windup = player.castWindup(FULL, { entity: CASTER, socket: 'hand-r' });
    player.castRelease(FULL, { entity: CASTER });
    player.sustainOnTarget(FULL, { entity: TARGET });
    expect(spawned.map((s) => s.effect)).toEqual([
      'vfx-spell-windup-motes~8b5cf6',
      'vfx-spell-release-burst~8b5cf6',
      'vfx-spell-sustain-motes~8b5cf6',
    ]);
    expect(spawned[0]?.options).toMatchObject({ entity: CASTER, socket: 'hand-r', scale: 1 });
    expect(spawned[1]?.options.socket).toBeUndefined();
    windup?.stop();
    expect(stopped).toEqual([1]);
  });

  it('a projectile plays its head and trail on the projectile and stops both', () => {
    const { player, spawned, stopped } = rig();
    player.projectile(FULL, { entity: CASTER })?.stop();
    expect(spawned.map((s) => s.effect)).toEqual([
      'vfx-spell-projectile-head~8b5cf6',
      'vfx-spell-projectile-trail~8b5cf6',
    ]);
    expect(stopped).toEqual([1, 2]);
  });

  it('an impact lands at the point, turned to the surface normal when given', () => {
    const { player, spawned } = rig();
    player.impact(FULL, { x: 1, y: 0, z: 2 });
    player.impact(FULL, { x: 1, y: 0, z: 2 }, { x: 0, y: 1, z: 0 });
    player.impact(FULL, { x: 1, y: 0, z: 2 }, { x: 0, y: -1, z: 0 });
    player.impact(FULL, { x: 1, y: 0, z: 2 }, { x: 1, y: 0, z: 0 });
    expect(spawned[0]?.options).toMatchObject({ position: { x: 1, y: 0, z: 2 } });
    expect(spawned[0]?.options.rotation).toBeUndefined();
    expect(spawned[1]?.options).toMatchObject({
      rotation: { x: 0, y: 0, z: -0, w: 1 },
      worldRotation: true,
    });
    expect(spawned[2]?.options.rotation).toEqual({ x: 1, y: 0, z: 0, w: 0 });
    const side = spawned[3]?.options.rotation;
    expect(side?.z).toBeLessThan(0); // up turned to +x: a quarter turn about -z
  });

  it('AC-2: an area spell of radius 4 m opens a ring of radius 4 at its centre, motes spread over it', () => {
    const { player, rings, spawned } = rig();
    const area = player.area(FULL, { x: 3, y: 0, z: -2 }, 4);
    expect(rings).toHaveLength(1);
    expect(rings[0]).toMatchObject({ radius: 4, centre: { x: 3, y: 0, z: -2 } });
    expect(spawned[0]?.options.scale).toBe(4);
    area?.stop();
    expect(rings[0]?.closed).toBe(true);
  });

  it('AC-3: a beam start follows the cast socket every frame, and the end follows its target', () => {
    const { player, places, beams } = rig();
    const beam = player.beam(FULL, { entity: CASTER, socket: 'hand-r' }, { entity: TARGET });
    expect(player.liveBeams).toBe(1);
    const walk = [
      { x: 1, y: 1.3, z: 0 },
      { x: 2, y: 1.3, z: -1 },
      { x: 3, y: 1.4, z: -2 },
    ];
    for (const at of walk) {
      places.set(CASTER, at);
      player.update();
    }
    places.set(TARGET, { x: 5, y: 1, z: -9 });
    player.update();
    const drawn = beams[0];
    expect(drawn?.starts.slice(1, 4)).toEqual(walk); // one start per frame, each where the socket was
    expect(drawn?.ends.at(-1)).toEqual({ x: 5, y: 1, z: -9 });
    beam?.stop();
    expect(drawn?.closed).toBe(true);
    expect(player.liveBeams).toBe(0);
  });

  it('a beam holds its last ends while a socket is gone and does no work with no beam alive', () => {
    const { player, beams, places } = rig();
    player.update(); // nothing alive: nothing to do
    const beam = player.beam(FULL, { entity: CASTER }, { position: { x: 0, y: 1, z: -5 } });
    places.delete(CASTER);
    player.update();
    expect(beams[0]?.starts).toHaveLength(1); // only the opening placement
    beam?.stop();
    beam?.stop();
  });

  it('a beam to a gone end socket is never placed', () => {
    const { player, beams } = rig();
    player.beam(FULL, { entity: CASTER }, { entity: TARGET, socket: 'gone' });
    expect(beams[0]?.starts).toEqual([]);
  });

  it('a summon plays its effect and reports how long the body dissolves', () => {
    const { player, spawned } = rig();
    const summoned = player.summon(FULL, { position: { x: 0, y: 0, z: -3 } });
    expect(spawned[0]?.effect).toBe('vfx-spell-summon-swirl~8b5cf6');
    expect(summoned?.summon.dissolveSeconds).toBe(1.2);
  });

  it('AC-4: a spell missing a slot skips it without error and spawns nothing', () => {
    const { player, spawned, rings, beams } = rig();
    const none = NO_SPELL_VFX;
    const at = { entity: CASTER };
    expect(player.castWindup(none, at)).toBeUndefined();
    expect(player.castRelease(none, at)).toBeUndefined();
    expect(player.projectile(none, at)).toBeUndefined();
    expect(player.impact(none, { x: 0, y: 0, z: 0 })).toBeUndefined();
    expect(player.area(none, { x: 0, y: 0, z: 0 }, 4)).toBeUndefined();
    expect(player.beam(none, at, { entity: TARGET })).toBeUndefined();
    expect(player.sustainOnTarget(none, at)).toBeUndefined();
    expect(player.summon(none, at)).toBeUndefined();
    expect(() => {
      player.update();
    }).not.toThrow();
    expect([spawned.length, rings.length, beams.length]).toEqual([0, 0, 0]);
  });

  it('a spawn the VFX layer refuses (null handle) is not an error and stops nothing', () => {
    const refusing = new SpellVfxPlayer({
      vfx: {
        spawn: () => null,
        stop: () => {
          throw new Error('nothing to stop');
        },
      },
      anchors: () => undefined,
      surfaces: rig().player as never,
    });
    const playing = refusing.castWindup(FULL, { entity: CASTER });
    expect(() => playing?.stop()).not.toThrow();
  });
});
