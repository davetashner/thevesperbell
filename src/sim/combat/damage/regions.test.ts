import { describe, expect, it } from 'vitest';
import { BrainComponent, type Brain } from '../../ai/components';
import { World } from '../../core/world';
import {
  effectiveHurtbox,
  HIT_VOLUME_COMPONENTS,
  markHumanoid,
  regionStateOf,
  setRegionState,
  type Hurtbox,
} from '../hits/components';
import { ACTION_TIMELINE_COMPONENTS, giveActionTimeline } from '../timeline/components';
import { giveHitReactions, HitReactionComponent } from '../reactions/components';
import { HitReaction, type HitReactionInfo } from '../reactions/events';
import { installHitReactions } from '../reactions/reactions';
import { StaminaComponent } from '../stamina';
import { DAMAGE_COMPONENTS, giveCombatant, healthOf } from './components';
import {
  DamageApplied,
  Deflected,
  HitMarker,
  type DamageResult,
  type DeflectInfo,
  type HitMarkerInfo,
} from './events';
import { DamageModel, hitMarkerVariant } from './model';
import { DAMAGE_TAGS, type DamagePacketInput } from './packet';

function setup() {
  const world = new World<never>({ seed: 3 }).register(
    ...DAMAGE_COMPONENTS,
    ...HIT_VOLUME_COMPONENTS,
    ...ACTION_TIMELINE_COMPONENTS,
    HitReactionComponent,
    StaminaComponent,
    BrainComponent,
  );
  const model = new DamageModel();
  installHitReactions(world, { moves: new Map(), damage: model });
  const applied: DamageResult[] = [];
  const deflected: DeflectInfo[] = [];
  const markers: HitMarkerInfo[] = [];
  const reactions: HitReactionInfo[] = [];
  world.events.on(DamageApplied, (e) => applied.push(e));
  world.events.on(Deflected, (e) => deflected.push(e));
  world.events.on(HitMarker, (e) => markers.push(e));
  world.events.on(HitReaction, (e) => reactions.push(e));
  const target = world.spawn();
  giveCombatant(world, target, { health: 200, poise: 50 });
  giveActionTimeline(world, target);
  giveHitReactions(world, target);
  const hit = (packet: DamagePacketInput) => {
    const result = model.apply(world, target, packet);
    world.events.flush();
    return result;
  };
  return { world, model, target, applied, deflected, markers, reactions, hit };
}

const PIERCE_20 = { pierce: 20 };

describe('headshots, weak points and armour (mw-e05.6)', () => {
  it('AC-1: a 20-pierce arrow to a x2.0 head does 40 damage and is tagged headshot', () => {
    const s = setup();
    const result = s.hit({ amounts: PIERCE_20, region: 'head', regionMultiplier: 2 });
    expect(result?.total).toBe(40);
    expect(result?.tags).toContain(DAMAGE_TAGS.headshot);
    expect(healthOf(s.world, s.target)?.current).toBe(160);
    expect(s.markers.map((m) => m.variant)).toEqual(['headshot']);
  });

  it('a weak point deals x3 damage and double poise damage, tagged weakpoint', () => {
    const s = setup();
    const result = s.hit({
      amounts: PIERCE_20,
      poiseDamage: 10,
      region: 'weakpoint',
      regionMultiplier: 3,
    });
    expect(result).toMatchObject({ total: 60, poiseDamage: 20 });
    expect(result?.tags).toContain(DAMAGE_TAGS.weakpoint);
    expect(s.markers.map((m) => m.variant)).toEqual(['weakpoint']);
  });

  it('AC-2: a disabled weakpoint resolves against the underlying region', () => {
    const core: Hurtbox = {
      id: 'core',
      socket: 'root',
      region: 'weakpoint',
      armored: false,
      multiplier: 3,
      enabledIn: ['roaring'],
      underlying: { region: 'limb', multiplier: 0.5 },
      shape: { kind: 'sphere', center: { x: 0, y: 0, z: 0 }, radius: 0.2 },
    };
    expect(effectiveHurtbox(core, 'default')).toMatchObject({ region: 'limb', multiplier: 0.5 });
    expect(effectiveHurtbox(core, 'roaring')).toBe(core);
    const always: Hurtbox = { ...core };
    delete (always as { enabledIn?: unknown }).enabledIn;
    expect(effectiveHurtbox(always, 'default')).toBe(always);
    const plain: Hurtbox = { ...core };
    delete (plain as { underlying?: unknown }).underlying;
    expect(effectiveHurtbox(plain, 'default')).toMatchObject({ region: 'torso', multiplier: 1 });
    const head: Hurtbox = { ...core, region: 'head', multiplier: 2 };
    expect(effectiveHurtbox(head, 'default')).toBe(head);
    // The hit then carries the underlying region: no weakpoint tag, its own multiplier.
    const s = setup();
    const resolved = effectiveHurtbox(core, 'default');
    const result = s.hit({
      amounts: PIERCE_20,
      region: resolved.region,
      regionMultiplier: resolved.multiplier,
    });
    expect(result?.total).toBe(10);
    expect(result?.tags).not.toContain(DAMAGE_TAGS.weakpoint);
  });

  it('region state defaults to "default" and follows setRegionState', () => {
    const s = setup();
    expect(regionStateOf(s.world, s.target)).toBe('default');
    setRegionState(s.world, s.target, 'roaring');
    expect(regionStateOf(s.world, s.target)).toBe('roaring');
    setRegionState(s.world, s.target, 'idle');
    expect(regionStateOf(s.world, s.target)).toBe('idle');
    markHumanoid(s.world, s.target);
    markHumanoid(s.world, s.target);
    expect(regionStateOf(s.world, s.target)).toBe('idle');
    const bare = new World<never>({ seed: 1 });
    expect(regionStateOf(bare, bare.spawn())).toBe('default');
  });

  it('AC-3: armour 30 against penetration 20 deflects for 0 damage with a Deflected event', () => {
    const s = setup();
    const result = s.hit({
      amounts: PIERCE_20,
      poiseDamage: 15,
      staminaDamage: 5,
      region: 'torso',
      armor: 30,
      penetration: 20,
      instigator: 7,
      source: 8,
    });
    expect(result).toMatchObject({ total: 0, poiseDamage: 0, staminaDamage: 0 });
    expect(result?.tags).toContain(DAMAGE_TAGS.deflected);
    expect(s.deflected).toEqual([
      {
        tick: 0,
        target: s.target,
        instigator: 7,
        source: 8,
        region: 'torso',
        armor: 30,
        penetration: 20,
      },
    ]);
    expect(s.markers.map((m) => m.variant)).toEqual(['deflected']);
  });

  it('AC-3: a blunt arrow ignores deflection and deals x0.5 instead', () => {
    const s = setup();
    const result = s.hit({
      amounts: { blunt: 20 },
      region: 'torso',
      armor: 30,
      penetration: 0,
      tags: [DAMAGE_TAGS.blunt],
    });
    expect(result?.total).toBe(10);
    expect(result?.tags).not.toContain(DAMAGE_TAGS.deflected);
    expect(s.deflected).toEqual([]);
  });

  it('armour the arrow out-penetrates (or melee, which has no penetration) does not deflect', () => {
    const s = setup();
    expect(s.hit({ amounts: PIERCE_20, armor: 20, penetration: 20 })?.total).toBe(20);
    expect(s.hit({ amounts: PIERCE_20, armor: 30 })?.total).toBe(20);
    expect(s.hit({ amounts: PIERCE_20, armor: 0, penetration: 0 })?.total).toBe(20);
    expect(s.deflected).toEqual([]);
  });

  it('AC-4: a head hit on an unaware humanoid staggers it regardless of poise', () => {
    const s = setup();
    markHumanoid(s.world, s.target);
    s.world.add(s.target, BrainComponent, { state: 'unaware' } as unknown as Brain);
    const result = s.hit({
      amounts: { pierce: 1 },
      poiseDamage: 0,
      region: 'head',
      regionMultiplier: 2,
    });
    expect(result?.tags).toContain(DAMAGE_TAGS.staggering);
    expect(result?.poiseBroken).toBe(false);
    expect(s.reactions.at(-1)).toMatchObject({ reaction: 'stagger', suppressed: null });
  });

  it('a head hit on an alert humanoid, an unaware non-humanoid or an unaware body hit does not stagger', () => {
    const alert = setup();
    markHumanoid(alert.world, alert.target);
    alert.world.add(alert.target, BrainComponent, { state: 'combat' } as unknown as Brain);
    alert.hit({ amounts: { pierce: 1 }, region: 'head' });
    expect(alert.reactions.at(-1)?.reaction).toBe('none');

    const beast = setup();
    beast.world.add(beast.target, BrainComponent, { state: 'unaware' } as unknown as Brain);
    expect(beast.hit({ amounts: { pierce: 1 }, region: 'head' })?.tags).not.toContain(
      DAMAGE_TAGS.staggering,
    );

    const body = setup();
    markHumanoid(body.world, body.target);
    body.world.add(body.target, BrainComponent, { state: 'unaware' } as unknown as Brain);
    expect(body.hit({ amounts: { pierce: 1 }, region: 'torso' })?.tags).not.toContain(
      DAMAGE_TAGS.staggering,
    );
  });

  it('a deflected head hit does not stagger an unaware humanoid', () => {
    const s = setup();
    markHumanoid(s.world, s.target);
    s.world.add(s.target, BrainComponent, { state: 'unaware' } as unknown as Brain);
    const result = s.hit({ amounts: PIERCE_20, region: 'head', armor: 50, penetration: 10 });
    expect(result?.tags).not.toContain(DAMAGE_TAGS.staggering);
  });

  it('worlds without the brain or region-state components never stagger on a head hit', () => {
    const world = new World<never>({ seed: 1 }).register(...DAMAGE_COMPONENTS);
    const target = world.spawn();
    giveCombatant(world, target, { health: 100 });
    const result = new DamageModel().apply(world, target, { amounts: PIERCE_20, region: 'head' });
    expect(result?.tags).toEqual([DAMAGE_TAGS.headshot]);
    const noBrain = new World<never>({ seed: 1 }).register(
      ...DAMAGE_COMPONENTS,
      ...HIT_VOLUME_COMPONENTS,
    );
    const t = noBrain.spawn();
    giveCombatant(noBrain, t, { health: 100 });
    markHumanoid(noBrain, t);
    expect(
      new DamageModel().apply(noBrain, t, { amounts: PIERCE_20, region: 'head' })?.tags,
    ).toEqual([DAMAGE_TAGS.headshot]);
  });

  it('a hit another rule tagged deflected reports zero armour and penetration', () => {
    const s = setup();
    s.hit({ amounts: PIERCE_20, tags: [DAMAGE_TAGS.deflected] });
    expect(s.deflected).toMatchObject([{ armor: 0, penetration: 0, region: undefined }]);
  });

  it('a humanoid with no brain is never unaware', () => {
    const s = setup();
    markHumanoid(s.world, s.target);
    expect(s.hit({ amounts: PIERCE_20, region: 'head' })?.tags).not.toContain(
      DAMAGE_TAGS.staggering,
    );
  });

  it('hitMarkerVariant reads tags first, then the region', () => {
    expect(hitMarkerVariant([])).toBe('normal');
    expect(hitMarkerVariant([], 'head')).toBe('headshot');
    expect(hitMarkerVariant([], 'weakpoint')).toBe('weakpoint');
    expect(hitMarkerVariant(['weakpoint'])).toBe('weakpoint');
    expect(hitMarkerVariant(['deflected'], 'head')).toBe('deflected');
    expect(hitMarkerVariant(['parried'])).toBe('deflected');
    expect(hitMarkerVariant(['blocked'])).toBe('deflected');
  });

  it('immune hits emit no marker', () => {
    const s = setup();
    const world = new World<never>({ seed: 1 }).register(...DAMAGE_COMPONENTS);
    const t = world.spawn();
    giveCombatant(world, t, { health: 10, resistances: { pierce: 0 } });
    const seen: HitMarkerInfo[] = [];
    world.events.on(HitMarker, (e) => seen.push(e));
    new DamageModel().apply(world, t, { amounts: { pierce: 5 } });
    world.events.flush();
    expect(seen).toEqual([]);
    expect(s.markers).toEqual([]);
  });
});
