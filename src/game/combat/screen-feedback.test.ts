// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import {
  DAMAGE_COMPONENTS,
  DAMAGE_TAGS,
  DamageApplied,
  DamageModel,
  giveCombatant,
  GuardBroken,
  World,
  type DamagePacketInput,
  type EntityId,
} from '@sim/index';
import { ScreenFeedback } from '@ui/index';
import { CameraShake, TRAUMA } from '../camera/shake';
import { DamageVignette } from '../vfx/screen-feedback';
import { attachScreenFeedback } from './screen-feedback';

function setup() {
  const world = new World<never>({ seed: 1 }).register(...DAMAGE_COMPONENTS);
  const player = world.spawn();
  giveCombatant(world, player, { health: 100, player: true });
  const shake = new CameraShake();
  const overlay = new ScreenFeedback();
  const glue = attachScreenFeedback({
    world,
    player,
    shake,
    vignette: new DamageVignette(),
    overlay,
  });
  const model = new DamageModel();
  const hit = (packet: DamagePacketInput, to: EntityId = player) => {
    model.apply(world, to, packet);
    world.events.flush();
  };
  return { world, player, shake, overlay, glue, hit };
}

const physical = (amount: number, extra: Partial<DamagePacketInput> = {}): DamagePacketInput => ({
  amounts: { slash: amount },
  ...extra,
});

describe('screen feedback glue (mw-e29.5)', () => {
  it('a light hit adds 0.15 trauma and a vignette of the fraction of health lost', () => {
    const s = setup();
    s.hit(physical(10));
    s.glue.frame(0);
    expect(s.shake.trauma).toBeCloseTo(TRAUMA.light);
    expect(s.overlay.element.dataset['vignette']).toBe('0.10');
  });

  it('AC-4: a hit removing 40% of health shows 0.4 and fades out by 300 ms', () => {
    const s = setup();
    s.hit(physical(40));
    s.glue.frame(1000);
    expect(s.overlay.element.dataset['vignette']).toBe('0.40');
    s.glue.frame(1300);
    expect(s.overlay.element.dataset['vignette']).toBe('0.00');
  });

  it('a heavy hit (15% of health, a critical or a poise break) adds 0.3', () => {
    const s = setup();
    s.hit(physical(20));
    s.glue.frame(0);
    expect(s.shake.trauma).toBeCloseTo(TRAUMA.heavy);
    const t = setup();
    t.hit(physical(1, { tags: [DAMAGE_TAGS.critical] }));
    t.glue.frame(0);
    expect(t.shake.trauma).toBeCloseTo(TRAUMA.heavy);
    const p = setup();
    p.world.events.emit(DamageApplied, {
      tick: 1,
      target: p.player,
      packet: { tags: [] } as never,
      amounts: {} as never,
      total: 1,
      immune: false,
      poiseDamage: 50,
      staminaDamage: 0,
      tags: [],
      healthBefore: 100,
      healthAfter: 99,
      poiseBroken: true,
      died: false,
    });
    p.world.events.flush();
    p.glue.frame(0);
    expect(p.shake.trauma).toBeCloseTo(TRAUMA.heavy);
  });

  it('a guard break adds 0.5 once, not also the hit that broke it', () => {
    const s = setup();
    s.world.events.emit(GuardBroken, {
      tick: 1,
      entity: s.player,
      instigator: null,
      source: null,
      staggerTicks: 20,
    });
    s.hit(physical(5, { tags: [DAMAGE_TAGS.guardBreak] }));
    s.glue.frame(0);
    expect(s.shake.trauma).toBeCloseTo(TRAUMA.guardBreak);
  });

  it('ignores other fighters, a guard break of someone else and hits that did nothing', () => {
    const s = setup();
    const foe = s.world.spawn();
    giveCombatant(s.world, foe, { health: 100 });
    s.hit(physical(30), foe);
    s.world.events.emit(GuardBroken, {
      tick: 1,
      entity: foe,
      instigator: null,
      source: null,
      staggerTicks: 20,
    });
    s.world.events.emit(DamageApplied, {
      tick: 1,
      target: s.player,
      packet: { tags: [] } as never,
      amounts: {} as never,
      total: 0,
      immune: false,
      poiseDamage: 0,
      staminaDamage: 0,
      tags: [],
      healthBefore: 100,
      healthAfter: 100,
      poiseBroken: false,
      died: false,
    });
    s.world.events.flush();
    s.glue.frame(0);
    expect(s.shake.trauma).toBe(0);
    expect(s.overlay.element.hidden).toBe(true);
  });

  it('greys the screen below 25% health and stops listening when disposed', () => {
    const s = setup();
    s.hit(physical(88));
    s.glue.frame(0);
    expect(Number(s.overlay.element.dataset['desaturation'])).toBeGreaterThan(0.3);
    s.glue.dispose();
    s.hit(physical(1));
    s.glue.frame(5000);
    expect(s.shake.trauma).toBeCloseTo(TRAUMA.heavy); // the hit after dispose added nothing
  });

  it('shows no grade for a player that is not a combatant', () => {
    const world = new World<never>({ seed: 1 }).register(...DAMAGE_COMPONENTS);
    const overlay = new ScreenFeedback();
    const bystander = world.spawn();
    const glue = attachScreenFeedback({
      world,
      player: bystander,
      shake: new CameraShake(),
      vignette: new DamageVignette(),
      overlay,
    });
    glue.frame(0);
    expect(overlay.element.hidden).toBe(true);
    // A hit event for an entity with no health component still counts, against a max of 1.
    world.events.emit(DamageApplied, {
      tick: 1,
      target: bystander,
      packet: { tags: [] } as never,
      amounts: {} as never,
      total: 1,
      immune: false,
      poiseDamage: 0,
      staminaDamage: 0,
      tags: [],
      healthBefore: 1,
      healthAfter: 0.5,
      poiseBroken: false,
      died: false,
    });
    world.events.flush();
    glue.frame(10);
    expect(overlay.element.dataset['vignette']).toBe('0.50');
  });
});
