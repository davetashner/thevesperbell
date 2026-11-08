// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import {
  DAMAGE_COMPONENTS,
  CreatureComponent,
  DamageModel,
  giveCombatant,
  PlacementComponent,
  World,
  type DamagePacketInput,
  type EntityId,
} from '@sim/index';
import { BossBar, DamageNumbers, HitMarkers, TargetBar } from '@ui/index';
import {
  attachTargetHud,
  damageText,
  displayName,
  hitVariant,
  liveLock,
  NO_EFFECT_MS,
  POISE_BROKEN_MS,
  TARGET_HOLD_MS,
  targetModel,
} from './target-hud';

function makeCreature(world: World<never>, entity: EntityId, creature: string): void {
  if (!world.isRegistered(CreatureComponent)) world.register(CreatureComponent);
  world.add(entity, CreatureComponent, {
    origin: { creature },
    behaviour: 'x',
    tuning: {},
    needs: {},
  } as never);
}

function setup(options: { enabled?: boolean } = {}) {
  const world = new World<never>({ seed: 1 }).register(...DAMAGE_COMPONENTS, PlacementComponent);
  const player = world.spawn();
  giveCombatant(world, player, { health: 100, player: true });
  world.add(player, PlacementComponent, { x: 0, y: 0, z: 0, radius: 0.4 });
  const foe = world.spawn();
  giveCombatant(world, foe, { health: 40, poise: 30, resistances: { fire: 0 } });
  world.add(foe, PlacementComponent, { x: 0, y: 0, z: -3, radius: 0.4 });
  const bar = new TargetBar();
  const numbers = new DamageNumbers();
  const boss = new BossBar();
  const markers = new HitMarkers();
  const bosses = new Set<string>(['warden']);
  let lock: EntityId | undefined;
  let behind = false;
  const glue = attachTargetHud({
    world,
    player,
    bar,
    boss,
    markers,
    numbers,
    isBoss: (id) => bosses.has(id),
    lock: () => (lock === undefined ? undefined : { entity: lock, point: { x: 0, y: 1, z: -3 } }),
    project: (p) => ({ x: p.x / 10, y: 0, z: behind ? 2 : 0 }),
    size: () => ({ width: 200, height: 100 }),
    numbersEnabled: () => options.enabled ?? true,
  });
  const model = new DamageModel();
  const hit = (to: EntityId, packet: DamagePacketInput) => {
    model.apply(world, to, packet);
    world.events.flush();
  };
  return {
    world,
    player,
    foe,
    bar,
    boss,
    markers,
    numbers,
    glue,
    hit,
    lockOn: (e: EntityId | undefined) => (lock = e),
    behindCamera: (b: boolean) => (behind = b),
  };
}

describe('target HUD glue (mw-e04.21)', () => {
  it('AC-1/AC-2: the bar follows the lock target and hides when it dies or the lock drops', () => {
    const s = setup();
    s.glue.frame(0);
    expect(s.bar.element.hidden).toBe(true);
    s.lockOn(s.foe);
    s.glue.frame(16);
    expect(s.bar.element.hidden).toBe(false);
    expect(s.bar.element.textContent).toContain('Training dummy');
    s.hit(s.foe, { amounts: { slash: 40 }, instigator: s.player });
    s.glue.frame(32);
    expect(s.bar.element.hidden).toBe(true);
    s.lockOn(undefined);
    s.glue.frame(48);
    expect(s.bar.element.hidden).toBe(true);
  });

  it('without a lock the bar shows whoever the player hit, until the hold runs out', () => {
    const s = setup();
    s.hit(s.foe, { amounts: { slash: 10 }, instigator: s.player });
    s.glue.frame(1000);
    expect(s.bar.element.hidden).toBe(false);
    expect(s.bar.health.element.dataset['value']).toBe('30');
    s.glue.frame(1000 + TARGET_HOLD_MS);
    expect(s.bar.element.hidden).toBe(true);
  });

  it('AC-5: a landed hit shows its applied total over the target; a taken hit over the player', () => {
    const s = setup();
    s.hit(s.foe, { amounts: { slash: 12.4 }, instigator: s.player });
    s.hit(s.player, { amounts: { slash: 7 }, instigator: s.foe });
    s.glue.frame(0);
    expect(s.numbers.numbers.map((n) => [n.text, n.kind])).toEqual([
      ['12', 'dealt'],
      ['7', 'taken'],
    ]);
  });

  it('AC-3: an immune hit shows "No effect"', () => {
    const s = setup();
    s.hit(s.foe, { amounts: { fire: 20 }, instigator: s.player });
    s.glue.frame(0);
    expect(s.numbers.numbers[0]?.text).toBe('No effect');
  });

  it('AC-5: with damage numbers off, no number shows (the bar still does)', () => {
    const s = setup({ enabled: false });
    s.hit(s.foe, { amounts: { slash: 5 }, instigator: s.player });
    s.glue.frame(0);
    expect(s.numbers.numbers).toEqual([]);
    expect(s.bar.element.hidden).toBe(false);
  });

  it('ignores hits between others, and a point behind the camera has no number', () => {
    const s = setup();
    const other = s.world.spawn();
    giveCombatant(s.world, other, { health: 10 });
    s.hit(other, { amounts: { slash: 3 }, instigator: s.foe });
    s.behindCamera(true);
    s.hit(s.foe, { amounts: { slash: 3 }, instigator: s.player });
    s.glue.frame(0);
    expect(s.numbers.numbers).toEqual([]);
  });

  it('a hit that does no damage shows no number, and a target without a placement has none', () => {
    const s = setup();
    s.hit(s.foe, { amounts: { slash: 0 }, instigator: s.player });
    const ghost = s.world.spawn();
    giveCombatant(s.world, ghost, { health: 10 });
    s.hit(ghost, { amounts: { slash: 3 }, instigator: s.player });
    s.glue.frame(0);
    expect(s.numbers.numbers).toEqual([]);
  });

  it('dispose stops listening', () => {
    const s = setup();
    s.glue.dispose();
    s.hit(s.foe, { amounts: { slash: 3 }, instigator: s.player });
    s.glue.frame(0);
    expect(s.numbers.numbers).toEqual([]);
  });

  it('names, texts and models', () => {
    expect(displayName('forgotten-miner')).toBe('Forgotten miner');
    expect(displayName('')).toBe('');
    expect(damageText(0.2, false)).toBeNull();
    expect(damageText(0, true)).toBe('No effect');
    const s = setup();
    expect(targetModel(s.world, s.world.spawn())).toBeNull();
    makeCreature(s.world, s.foe, 'forgotten-miner');
    expect(targetModel(s.world, s.foe)?.name).toBe('Forgotten miner');
  });

  it('AC-1/AC-2: the reticle follows a live lock and is gone as soon as the target dies', () => {
    const s = setup();
    const lock = { entity: s.foe, point: { x: 0, y: 1, z: -3 } };
    expect(liveLock(s.world, undefined)).toBeUndefined();
    expect(liveLock(s.world, lock)).toBe(lock);
    s.hit(s.foe, { amounts: { slash: 40 }, instigator: s.player });
    expect(liveLock(s.world, lock)).toBeUndefined();
  });

  it('AC-3: an immune hit shows "No effect" for 800 ms with no chip, then clears', () => {
    const s = setup();
    s.lockOn(s.foe);
    s.glue.frame(0);
    s.hit(s.foe, { amounts: { fire: 20 }, instigator: s.player });
    s.glue.frame(100);
    expect(s.bar.element.textContent).toContain('No effect');
    expect(s.bar.health.chip).toBe(0);
    expect(s.markers.variants).toEqual([]);
    s.glue.frame(100 + NO_EFFECT_MS - 1);
    expect(s.bar.element.textContent).toContain('No effect');
    s.glue.frame(100 + NO_EFFECT_MS);
    expect(s.bar.element.textContent).not.toContain('No effect');
  });

  it('shows the poise bar only after the first poise damage and flashes on PoiseBroken', () => {
    const s = setup();
    s.lockOn(s.foe);
    s.glue.frame(0);
    expect(s.bar.poise.element.hidden).toBe(true);
    s.hit(s.foe, { amounts: { slash: 1 }, poiseDamage: 10, instigator: s.player });
    s.glue.frame(16);
    expect(s.bar.poise.element.hidden).toBe(false);
    expect(s.bar.poise.element.dataset['value']).toBe('20');
    expect(s.bar.poise.flashing).toBe(false);
    s.hit(s.foe, { amounts: { slash: 1 }, poiseDamage: 40, instigator: s.player });
    s.glue.frame(32);
    expect(s.bar.poise.flashing).toBe(true);
    expect(s.bar.element.textContent).toContain('Poise broken');
    s.glue.frame(32 + POISE_BROKEN_MS + 16);
    expect(s.bar.poise.flashing).toBe(false);
    expect(s.bar.element.textContent).not.toContain('Poise broken');
  });

  it('AC-4: a boss that enters combat gets the docked bar with its name and health, not the top bar', () => {
    const s = setup();
    const warden = s.world.spawn();
    giveCombatant(s.world, warden, { health: 200 });
    makeCreature(s.world, warden, 'warden');
    s.world.add(warden, PlacementComponent, { x: 0, y: 0, z: -4, radius: 1 });
    s.glue.frame(0);
    expect(s.boss.element.hidden).toBe(true);
    s.hit(s.player, { amounts: { slash: 5 }, instigator: warden });
    s.glue.frame(16);
    expect(s.boss.element.hidden).toBe(false);
    expect(s.boss.element.textContent).toContain('Warden');
    expect(s.boss.health.element.dataset['value']).toBe('200');
    s.hit(warden, { amounts: { slash: 50 }, instigator: s.player });
    s.glue.frame(32);
    expect(s.boss.health.element.dataset['value']).toBe('150');
    expect(s.bar.element.hidden).toBe(true);
    s.hit(warden, { amounts: { slash: 150 }, instigator: s.player });
    s.glue.frame(48);
    expect(s.boss.element.hidden).toBe(true);
  });

  it('locking a boss engages it', () => {
    const s = setup();
    const warden = s.world.spawn();
    giveCombatant(s.world, warden, { health: 200 });
    makeCreature(s.world, warden, 'warden');
    s.lockOn(warden);
    s.glue.frame(0);
    expect(s.boss.element.hidden).toBe(false);
  });

  it('hit markers show the struck variant at the target, and not for taken hits', () => {
    const s = setup();
    s.hit(s.foe, { amounts: { slash: 1 }, instigator: s.player });
    s.hit(s.foe, { amounts: { slash: 1 }, region: 'head', instigator: s.player });
    s.hit(s.player, { amounts: { slash: 1 }, instigator: s.foe });
    s.glue.frame(0);
    expect(s.markers.variants).toEqual(['normal', 'headshot']);
    s.behindCamera(true);
    s.hit(s.foe, { amounts: { slash: 1 }, instigator: s.player });
    s.glue.frame(500);
    expect(s.markers.variants).toEqual([]);
  });

  it('classifies hit variants', () => {
    const packet = (region?: string) => ({ ...(region !== undefined && { region }) });
    expect(hitVariant({ tags: [], packet: packet() })).toBe('normal');
    expect(hitVariant({ tags: [], packet: packet('torso') })).toBe('normal');
    expect(hitVariant({ tags: [], packet: packet('head') })).toBe('headshot');
    expect(hitVariant({ tags: [], packet: packet('weakpoint') })).toBe('weakpoint');
    expect(hitVariant({ tags: ['weakpoint'], packet: packet() })).toBe('weakpoint');
    expect(hitVariant({ tags: ['parried'], packet: packet('head') })).toBe('deflected');
    expect(hitVariant({ tags: ['blocked'], packet: packet() })).toBe('deflected');
    expect(hitVariant({ tags: ['deflected'], packet: packet('torso') })).toBe('deflected');
    expect(hitVariant({ tags: ['deflected', 'weakpoint'], packet: packet('head') })).toBe(
      'deflected',
    );
  });
});
