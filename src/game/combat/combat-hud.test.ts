// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import {
  ActionRejected,
  DAMAGE_COMPONENTS,
  DamageApplied,
  DamageModel,
  DEFAULT_MANA_PROFILE,
  giveCombatant,
  giveMana,
  ManaComponent,
  giveStamina,
  PlacementComponent,
  StaminaComponent,
  World,
  type DamagePacketInput,
  type EntityId,
} from '@sim/index';
import { CombatHud, DAMAGE_ARC_MS, STAMINA_FLASH_MS } from '@ui/index';
import {
  attachCombatHud,
  cameraForward,
  combatHudModel,
  damageBearing,
  hitOrigin,
  horizontalHalfFov,
  offScreen,
  type HudView,
} from './combat-hud';

/** A 90° horizontal view looking along −z (the default camera). */
const AHEAD: HudView = { forward: { x: 0, z: -1 }, halfFov: Math.PI / 4 };

function setup(view: HudView = AHEAD) {
  const world = new World<never>({ seed: 1 }).register(
    ...DAMAGE_COMPONENTS,
    PlacementComponent,
    StaminaComponent,
  );
  const player = world.spawn();
  giveCombatant(world, player, { health: 100, player: true });
  giveStamina(world, player);
  world.add(player, PlacementComponent, { x: 0, y: 0, z: 0, radius: 0.4 });
  const hud = new CombatHud();
  let current = view;
  const glue = attachCombatHud({ world, player, hud, view: () => current });
  const model = new DamageModel();
  const hit = (packet: DamagePacketInput, to: EntityId = player) => {
    model.apply(world, to, packet);
    world.events.flush();
  };
  /** A foe standing at (x, z). */
  const foe = (x: number, z: number): EntityId => {
    const id = world.spawn();
    world.add(id, PlacementComponent, { x, y: 0, z, radius: 0.4 });
    return id;
  };
  const look = (next: HudView) => {
    current = next;
  };
  return { world, player, hud, glue, hit, foe, look };
}

/** The point at `deg` clockwise from −z, `r` metres from the origin. */
const at = (deg: number, r = 3): { x: number; z: number } => {
  const rad = (deg * Math.PI) / 180;
  return { x: r * Math.sin(rad), z: -r * Math.cos(rad) };
};

describe('combat HUD glue (mw-e04.10)', () => {
  it('AC-2: an ActionRejected{reason:"stamina"} event flashes the stamina bar for 300 ms', () => {
    const s = setup();
    s.glue.frame(0);
    s.world.events.emit(ActionRejected, {
      entity: s.player,
      action: 'dodge',
      reason: 'stamina',
      tick: 1,
    });
    s.world.events.flush();
    s.glue.frame(100);
    expect(s.hud.stamina.flashing).toBe(true);
    s.glue.frame(100 + STAMINA_FLASH_MS - 1);
    expect(s.hud.stamina.flashing).toBe(true);
    s.glue.frame(100 + STAMINA_FLASH_MS);
    expect(s.hud.stamina.flashing).toBe(false);
  });

  it('AC-2: refusals for other reasons, or of other entities, do not flash', () => {
    const s = setup();
    const other = s.world.spawn();
    s.world.events.emit(ActionRejected, {
      entity: s.player,
      action: 'attack',
      reason: 'busy',
      tick: 1,
    });
    s.world.events.emit(ActionRejected, {
      entity: other,
      action: 'dodge',
      reason: 'stamina',
      tick: 1,
    });
    s.world.events.flush();
    s.glue.frame(0);
    expect(s.hud.stamina.flashing).toBe(false);
  });

  it('AC-3: a hit from a source 120° behind the camera forward shows an arc at 120° that fades out at 1.5 s', () => {
    const s = setup();
    const { x, z } = at(120);
    s.hit({ amounts: { slash: 15 }, instigator: s.foe(x, z) });
    s.glue.frame(500);
    expect(s.hud.indicator.arcs).toHaveLength(1);
    expect(s.hud.indicator.arcs[0]?.bearing).toBeCloseTo(120, 6);
    expect(s.hud.indicator.arcs[0]?.opacity).toBe(1);
    s.glue.frame(500 + DAMAGE_ARC_MS - 1);
    expect(s.hud.indicator.arcs).toHaveLength(1);
    s.glue.frame(500 + DAMAGE_ARC_MS);
    expect(s.hud.indicator.arcs).toEqual([]);
  });

  it('AC-3: the bearing is relative to the camera, not the world', () => {
    const s = setup();
    // The camera looks along +x (90° clockwise of −z); the foe stands due south (+z, 180°).
    s.look({ forward: { x: 1, z: 0 }, halfFov: Math.PI / 4 });
    s.hit({ amounts: { slash: 5 }, instigator: s.foe(0, 3) });
    s.glue.frame(0);
    expect(s.hud.indicator.arcs[0]?.bearing).toBeCloseTo(90, 6);
  });

  it('shows no arc for an on-screen source, a harmless hit or a hit on someone else', () => {
    const s = setup();
    const ahead = s.foe(0.5, -3);
    s.hit({ amounts: { slash: 5 }, instigator: ahead });
    const dummy = s.world.spawn();
    giveCombatant(s.world, dummy, { health: 50 });
    s.hit({ amounts: { slash: 5 }, instigator: s.foe(0, 3) }, dummy);
    s.world.events.emit(DamageApplied, {
      tick: 1,
      target: s.player,
      packet: {
        instigator: s.foe(0, 3),
        source: null,
        amounts: {},
        poiseDamage: 0,
        staminaDamage: 0,
        impulse: { x: 0, y: 0, z: 0 },
        impactForce: 0,
        regionMultiplier: 1,
        tags: [],
      },
      amounts: {},
      total: 0,
      immune: true,
      poiseDamage: 0,
      staminaDamage: 0,
      tags: [],
      healthBefore: 90,
      healthAfter: 90,
      poiseBroken: false,
      died: false,
    });
    s.world.events.flush();
    s.glue.frame(0);
    expect(s.hud.indicator.arcs).toEqual([]);
  });

  it('AC-5: the bars show the sim health and stamina on the frame after a hit', () => {
    const s = setup();
    s.glue.frame(0);
    expect(s.hud.element.hidden).toBe(false);
    s.hit({ amounts: { slash: 15 } });
    s.glue.frame(16);
    expect(s.hud.health.element.getAttribute('aria-valuenow')).toBe('85');
    expect(s.hud.health.element.dataset['value']).toBe('85');
    expect(s.hud.stamina.element.getAttribute('aria-valuemax')).toBe('100');
  });

  it('hides while the player is not a combatant and stops listening on dispose', () => {
    const world = new World<never>({ seed: 1 }).register(
      ...DAMAGE_COMPONENTS,
      StaminaComponent,
      ManaComponent,
    );
    const player = world.spawn();
    const hud = new CombatHud();
    const glue = attachCombatHud({ world, player, hud, view: () => AHEAD });
    glue.frame(0);
    expect(hud.element.hidden).toBe(true);
    expect(combatHudModel(world, player)).toBeNull();
    giveCombatant(world, player, { health: 40 });
    expect(combatHudModel(world, player)).toEqual({
      health: { value: 40, max: 40 },
      stamina: { value: 0, max: 0 },
    });
    giveMana(world, player, { ...DEFAULT_MANA_PROFILE, max: 20 });
    expect(combatHudModel(world, player)?.mana).toEqual({ value: 20, max: 20 });
    glue.frame(16);
    expect(hud.element.hidden).toBe(false);
    glue.dispose();
    world.events.emit(ActionRejected, {
      entity: player,
      action: 'dodge',
      reason: 'stamina',
      tick: 1,
    });
    world.events.flush();
    glue.frame(32);
    expect(hud.stamina.flashing).toBe(false);
  });
});

describe('hit origin', () => {
  it('prefers the instigator, then the source, then the reverse of the travel direction', () => {
    const s = setup();
    const results: Parameters<typeof hitOrigin>[1][] = [];
    s.world.events.on(DamageApplied, (r) => results.push(r));
    const archer = s.foe(0, 5);
    const arrow = s.foe(-2, 0);
    s.hit({ amounts: { pierce: 1 }, instigator: archer, source: arrow });
    s.hit({ amounts: { pierce: 1 }, instigator: s.world.spawn(), source: arrow });
    s.hit({ amounts: { pierce: 1 }, direction: { x: 1, y: 0, z: 0 } });
    s.hit({ amounts: { pierce: 1 }, direction: { x: 0, y: -1, z: 0 } });
    s.hit({ amounts: { pierce: 1 }, instigator: s.foe(0, 0) }); // standing on the player
    expect(results.map((r) => hitOrigin(s.world, r))).toEqual([
      { x: 0, z: 5 },
      { x: -2, z: 0 },
      { x: -1, z: -0 },
      undefined,
      undefined,
    ]);
  });

  it('falls back to the direction when the target has no position', () => {
    const world = new World<never>({ seed: 1 }).register(...DAMAGE_COMPONENTS, PlacementComponent);
    const target = world.spawn();
    giveCombatant(world, target, { health: 10 });
    const results: Parameters<typeof hitOrigin>[1][] = [];
    world.events.on(DamageApplied, (r) => results.push(r));
    new DamageModel().apply(world, target, {
      amounts: { blunt: 1 },
      direction: { x: 0, y: 0, z: 1 },
    });
    world.events.flush();
    expect(results.map((r) => hitOrigin(world, r))).toEqual([{ x: -0, z: -1 }]);
  });
});

describe('bearing maths', () => {
  it('measures degrees clockwise from forward, 0–360', () => {
    const f = { x: 0, z: -1 };
    expect(damageBearing(f, { x: 0, z: -2 })).toBeCloseTo(0, 10);
    expect(damageBearing(f, { x: 1, z: 0 })).toBeCloseTo(90, 10);
    expect(damageBearing(f, { x: 0, z: 1 })).toBeCloseTo(180, 10);
    expect(damageBearing(f, { x: -1, z: 0 })).toBeCloseTo(270, 10);
    expect(damageBearing(f, at(120))).toBeCloseTo(120, 10);
    expect(damageBearing({ x: 0, z: 0 }, { x: 1, z: 0 })).toBeUndefined();
    expect(damageBearing(f, { x: 0, z: 0 })).toBeUndefined();
  });

  it('knows what is off screen', () => {
    const half = Math.PI / 4; // 45°
    expect(offScreen(30, half)).toBe(false);
    expect(offScreen(330, half)).toBe(false);
    expect(offScreen(46, half)).toBe(true);
    expect(offScreen(300, half)).toBe(true);
    expect(offScreen(120, half)).toBe(true);
  });

  it('derives the camera forward and the horizontal half field of view', () => {
    const identity = cameraForward({ x: 0, y: 0, z: 0, w: 1 });
    expect(identity.x).toBeCloseTo(0, 10);
    expect(identity.z).toBe(-1);
    // Turned 90° left about +y: looks along −x.
    const s = Math.SQRT1_2;
    const left = cameraForward({ x: 0, y: s, z: 0, w: s });
    expect(left.x).toBeCloseTo(-1, 10);
    expect(left.z).toBeCloseTo(0, 10);
    expect(horizontalHalfFov(90, 1)).toBeCloseTo(Math.PI / 4, 10);
    expect(horizontalHalfFov(70, 16 / 9)).toBeGreaterThan((35 * Math.PI) / 180);
  });
});
