// The kick's own rules (mw-e04.18): a door it reaches is slammed open (or resists), a creature behind
// a slammed door is hurt by it, and a small creature it hits is knocked back. What it does to shovable
// objects is the move's world impact (world-impact.test.ts, tests/integration/kick.test.ts).
import type { MoveTable, RuntimeMove } from '@content/index';
import { describe, expect, it } from 'vitest';
import type { EntityId } from '../../core/component';
import { World } from '../../core/world';
import { IDENTITY_POSE } from '../../geom';
import { type ActionFrame } from '../../input/action-frame';
import { INTERACTION_COMPONENTS } from '../../interaction/system';
import { DoorComponent, type DoorProfile } from '../../mechanisms/components';
import { doorBlocked, type DoorBlocked } from '../../mechanisms/events';
import { doorState, installMechanisms, makeDoor } from '../../mechanisms/system';
import { noiseEmitted, type NoiseEvent } from '../../noise/events';
import { addProperties, registerWorldProperties } from '../../properties/components';
import { placeEntity } from '../../stimulus/placement';
import type { Vec3 } from '../../stimulus/shapes';
import {
  ImpactResisted,
  installStimuli,
  stimulusSystem,
  type ImpactResistance,
} from '../../stimulus/stimulus';
import { DAMAGE_COMPONENTS, giveCombatant, healthOf } from '../damage/components';
import { DamageApplied, type DamageResult } from '../damage/events';
import { DamageModel } from '../damage/model';
import {
  giveHitboxes,
  giveHurtboxes,
  HIT_VOLUME_COMPONENTS,
  type Hurtbox,
  type SocketTrack,
} from '../hits/components';
import { hitVolumeSystem, noAllies } from '../hits/system';
import { giveHitReactions, HitReactionComponent } from '../reactions/components';
import { HitReaction, type HitReactionInfo } from '../reactions/events';
import { installHitReactions, type Pusher } from '../reactions/reactions';
import { giveStamina, StaminaComponent, staminaSystem } from '../stamina';
import { ACTION_TIMELINE_COMPONENTS, giveActionTimeline } from '../timeline/components';
import { actionTimelineSystem, requestMove } from '../timeline/timeline';
import { giveFacing, giveGuard, MELEE_COMPONENTS, setBlockHeld } from './components';
import { facingSystem, keepFacing } from './facing';
import { blockSystem, shieldGuard } from './guard';
import { installKick, KICK_RESISTED_LOUDNESS } from './kick';
import { installMeleeStrikes } from './strikes';

const v3 = (x: number, y: number, z: number): Vec3 => ({ x, y, z });

/** The kick as compileMove builds it from src/content/data/move/kick.json. */
function kickMove(overrides: Partial<RuntimeMove> = {}): RuntimeMove {
  return Object.freeze({
    id: 'kick',
    verb: 'attack',
    startup: 10,
    active: 3,
    recovery: 16,
    totalTicks: 29,
    activeFrom: 10,
    recoveryFrom: 13,
    staminaCost: 8,
    cancelWindows: [],
    damage: {
      amounts: { blunt: 3 },
      poiseDamage: 20,
      staminaDamage: 10,
      impulse: v3(0, 0, 160),
      impactForce: 600,
      tags: [],
    },
    hitbox: {
      track: 'still',
      shape: { kind: 'sphere', center: v3(0, 0.5, 0.8), radius: 0.25 },
      reach: 'close',
      swing: 'thrust',
    },
    worldImpact: { force: 140, maxWeight: 40 },
    parryable: false,
    blockable: true,
    unblockable: false,
    interruptible: false,
    hyperarmor: null,
    iframes: null,
    telegraphTick: 0,
    hitStop: 'light',
    chainNext: null,
    charge: null,
    presentation: { anim: 'anim-knight-kick' },
    motion: null,
    ...overrides,
  } as unknown as RuntimeMove);
}

const KICK = kickMove();
const TRACKS = new Map<string, SocketTrack>([['still', { id: 'still', keys: [IDENTITY_POSE] }]]);
const DOOR: DoorProfile = {
  id: 'wooden-door',
  kind: 'hinged',
  size: v3(1.2, 2.2, 0.06),
  seconds: 1,
  crush: 0,
  manual: true,
  blocks: { light: true, gas: true, sound: true },
  loudness: 50,
};
const LOCK = { id: 'cell', tier: 1, pickTier: 1, sealed: false, tags: [], hint: 'Locked.' };
const SHIELD = Object.freeze({
  id: 'wood-shield',
  kind: 'shield' as const,
  absorption: Object.freeze({ slash: 85, pierce: 85, blunt: 85, fire: 30 }),
  stability: 60,
  raiseTicks: 6,
  arcDegrees: 120,
  moveSpeedScale: 0.5,
});
const torso: Hurtbox = {
  id: 'torso',
  socket: 'root',
  region: 'torso',
  armored: false,
  multiplier: 1,
  shape: { kind: 'capsule', from: v3(0, 0.4, 0), to: v3(0, 1.4, 0), radius: 0.4 },
};

interface Options {
  /** The kick move, when not the shipped one. */
  readonly kickMove?: RuntimeMove;
  /** Size class `sizeOf` reports for every creature. */
  readonly size?: string;
}

function setup(options: Options = {}) {
  const kickDef = options.kickMove ?? KICK;
  const moves: MoveTable = new Map([[kickDef.id, kickDef]]);
  const world = installStimuli(
    registerWorldProperties(
      new World<ActionFrame>({ seed: 1 }).register(
        ...ACTION_TIMELINE_COMPONENTS,
        StaminaComponent,
        ...MELEE_COMPONENTS,
        ...HIT_VOLUME_COMPONENTS,
        ...DAMAGE_COMPONENTS,
        HitReactionComponent,
        ...INTERACTION_COMPONENTS,
      ),
    ),
  );
  const damage = new DamageModel();
  damage.register(shieldGuard());
  const pushed: { entity: EntityId; impulse: Vec3 }[] = [];
  const pusher: Pusher = (_w, entity, impulse) => {
    pushed.push({ entity, impulse });
    return true;
  };
  world
    .addSystem(staminaSystem())
    .addSystem(blockSystem({ moves }))
    .addSystem(actionTimelineSystem({ moves }))
    .addSystem(facingSystem({ moves, desired: keepFacing }))
    .addSystem(hitVolumeSystem({ isAlly: noAllies }))
    .addSystem(stimulusSystem());
  installMeleeStrikes(world, { moves, tracks: TRACKS, damage });
  const reactions = { moves, damage, pushers: [pusher] };
  installHitReactions(world, reactions);
  installMechanisms(world);
  installKick(world, {
    moves,
    tracks: TRACKS,
    damage,
    reactions,
    move: 'kick',
    sizeOf: (_w, entity) => (entity === foe ? options.size : undefined),
  });
  const knight = world.spawn();
  placeEntity(world, knight, v3(0, 0, 0), 0.35);
  giveActionTimeline(world, knight);
  giveStamina(world, knight);
  giveFacing(world, knight);
  giveHitboxes(world, knight);
  const foe = world.spawn();
  const log = {
    resisted: [] as ImpactResistance[],
    noises: [] as NoiseEvent[],
    blocked: [] as DoorBlocked[],
    damage: [] as DamageResult[],
    reactions: [] as HitReactionInfo[],
  };
  world.events.on(ImpactResisted, (e) => log.resisted.push(e));
  world.events.on(noiseEmitted, (e) => log.noises.push(e));
  world.events.on(doorBlocked, (e) => log.blocked.push(e));
  world.events.on(DamageApplied, (e) => log.damage.push(e));
  world.events.on(HitReaction, (e) => log.reactions.push(e));
  const kick = () => {
    requestMove(world, knight, 'kick');
    for (let i = 0; i < 40; i++) world.step([]);
  };
  /** The foe, a combatant that reacts to hits, `z` m ahead of the knight. */
  const placeFoe = (z: number, extra: { health?: number; reacts?: boolean } = {}) => {
    placeEntity(world, foe, v3(0, 0, z), 0.4);
    giveHurtboxes(world, foe, { boxes: [torso] });
    giveCombatant(world, foe, { health: extra.health ?? 200, poise: 60 });
    giveActionTimeline(world, foe);
    giveFacing(world, foe, v3(0, 0, -1));
    if (extra.reacts !== false) giveHitReactions(world, foe);
  };
  /** A door whose closed leaf stands `z` m ahead of the knight. */
  const placeDoor = (z: number, instance: Partial<Parameters<typeof makeDoor>[3]> = {}) => {
    const door = world.spawn();
    addProperties(world, door, { weight: 60 });
    makeDoor(world, door, DOOR, { origin: v3(0, 0, z), ...instance });
    return door;
  };
  return { world, knight, foe, log, pushed, kick, placeFoe, placeDoor };
}

describe('kicking a door (mw-e04.18)', () => {
  it('slams an unlocked closed door open, much faster than a hand', () => {
    const s = setup();
    const door = s.placeDoor(1);
    s.kick();
    expect(s.world.get(door, DoorComponent)?.openness).toBe(1);
    expect(doorState(s.world.get(door, DoorComponent) as never)).toBe('open');
    expect(s.log.resisted).toEqual([]);
    expect(s.log.blocked).toEqual([]);
  });

  it('AC-4: a locked door stays closed and emits ImpactResisted plus a noise event', () => {
    const s = setup();
    const door = s.placeDoor(1, { lock: LOCK });
    s.kick();
    expect(s.world.get(door, DoorComponent)?.openness).toBe(0);
    expect(s.log.resisted).toEqual([
      {
        tick: s.log.resisted[0]?.tick ?? -1,
        entity: door,
        weight: 60,
        maxWeight: 40,
        impulse: v3(0, 0, 140),
        source: s.knight,
      },
    ]);
    expect(s.log.noises).toEqual([
      expect.objectContaining({
        kind: 'kick',
        loudness: KICK_RESISTED_LOUDNESS,
        entity: door,
        source: s.knight,
      }),
    ]);
  });

  it('a jammed door resists the same way', () => {
    const s = setup();
    const door = s.placeDoor(1, { state: 'jammed' });
    s.kick();
    expect(s.world.get(door, DoorComponent)?.openness).toBe(0);
    expect(s.log.resisted.map((e) => e.entity)).toEqual([door]);
    expect(s.log.noises).toHaveLength(1);
  });

  it('a kick without a listed force or weight limit resists with an empty push', () => {
    const plain = kickMove({ worldImpact: { blunt: 5 } });
    const s = setup({ kickMove: plain });
    s.placeDoor(1, { lock: LOCK });
    s.kick();
    expect(s.log.resisted).toMatchObject([{ maxWeight: 0, impulse: v3(0, 0, 0) }]);
  });

  it('a kicker with no place in the world kicks nothing', () => {
    const s = setup();
    const door = s.placeDoor(1);
    const loner = s.world.spawn();
    giveActionTimeline(s.world, loner);
    giveFacing(s.world, loner);
    requestMove(s.world, loner, 'kick');
    for (let i = 0; i < 40; i++) s.world.step([]);
    expect(s.world.get(door, DoorComponent)?.openness).toBe(0);
  });

  it('leaves an open door and a door out of reach alone', () => {
    const s = setup();
    const open = s.placeDoor(1, { state: 'open' });
    const far = s.placeDoor(6);
    s.kick();
    expect(s.world.get(open, DoorComponent)?.openness).toBe(1);
    expect(s.world.get(far, DoorComponent)?.openness).toBe(0);
    expect(s.log.resisted).toEqual([]);
    expect(s.log.noises).toEqual([]);
  });

  it('AC-3: a creature behind the door takes blunt damage from it and flinches, and the door opens as far as it can', () => {
    const s = setup();
    const door = s.placeDoor(1);
    s.placeFoe(1.5, { health: 200 });
    s.kick();
    const hit = s.log.damage.find((r) => r.packet.source === door) ?? expect.fail('no door hit');
    expect(hit.target).toBe(s.foe);
    expect(hit.packet.instigator).toBe(s.knight);
    expect(hit.amounts.blunt).toBe(3);
    expect(healthOf(s.world, s.foe)?.current).toBe(197);
    expect(s.log.blocked).toMatchObject([{ entity: door, by: s.foe, slammedBy: s.knight }]);
    expect(s.log.reactions.find((r) => r.entity === s.foe)).toMatchObject({ reaction: 'flinch' });
    expect(s.world.get(door, DoorComponent)?.target).toBe(1);
    expect(s.world.get(door, DoorComponent)?.openness).toBeGreaterThan(0);
  });

  it('a slammed door only hurts combatants: a crate behind it just stops it', () => {
    const s = setup();
    const door = s.placeDoor(1);
    const crate = s.world.spawn();
    placeEntity(s.world, crate, v3(0, 0, 1.5), 0.4);
    s.kick();
    expect(s.log.blocked).toMatchObject([{ entity: door, by: crate, slammedBy: s.knight }]);
    expect(s.log.damage).toEqual([]);
  });

  it('a door that was not kicked hurts nobody it meets', () => {
    const s = setup();
    const door = s.placeDoor(1);
    s.placeFoe(1.5);
    s.world.events.emit(doorBlocked, {
      tick: 0,
      entity: door,
      kind: 'hinged',
      by: s.foe,
      openness: 0.2,
      crushed: false,
      position: v3(0, 0, 1.5),
    });
    s.world.step([]);
    expect(s.log.damage).toEqual([]);
  });
});

describe('kicking a small creature (mw-e04.18)', () => {
  it('knocks it back with the kick’s impulse, over the flinch the hit chose', () => {
    const s = setup({ size: 'small' });
    s.placeFoe(1);
    s.kick();
    const reactions = s.log.reactions.filter((r) => r.entity === s.foe).map((r) => r.reaction);
    expect(reactions).toEqual(['flinch', 'knockback']);
    expect(s.pushed).toHaveLength(1);
    expect(s.pushed[0]?.entity).toBe(s.foe);
    expect(s.pushed[0]?.impulse.z).toBeGreaterThan(150);
    expect(s.log.reactions.at(-1)).toMatchObject({ instigator: s.knight, reaction: 'knockback' });
  });

  it('a larger creature only flinches, and what is no creature is not knocked back', () => {
    for (const size of ['medium', undefined]) {
      const s = setup(size === undefined ? {} : { size });
      s.placeFoe(1);
      s.kick();
      expect(s.log.reactions.filter((r) => r.entity === s.foe).map((r) => r.reaction)).toEqual([
        'flinch',
      ]);
      expect(s.pushed).toEqual([]);
    }
  });

  it('does not knock back a kick the creature blocked, or one that killed it', () => {
    const blocked = setup({ size: 'small' });
    blocked.placeFoe(1);
    giveGuard(blocked.world, blocked.foe, SHIELD);
    setBlockHeld(blocked.world, blocked.foe, true);
    for (let i = 0; i < 10; i++) blocked.world.step([]);
    blocked.kick();
    expect(blocked.log.damage.find((r) => r.target === blocked.foe)?.tags).toContain('blocked');
    expect(blocked.pushed).toEqual([]);
    const killed = setup({ size: 'small' });
    killed.placeFoe(1, { health: 2 });
    killed.kick();
    expect(killed.log.damage.find((r) => r.target === killed.foe)?.died).toBe(true);
    expect(killed.pushed).toEqual([]);
  });

  it('a small combatant that does not react to hits is left to the damage alone', () => {
    const s = setup({ size: 'small' });
    s.placeFoe(1, { reacts: false });
    s.kick();
    expect(s.log.damage.some((r) => r.target === s.foe)).toBe(true);
    expect(s.log.reactions).toEqual([]);
    expect(s.pushed).toEqual([]);
  });
});

describe('installing the kick', () => {
  it('refuses a kick move that is missing, has no hitbox or no damage', () => {
    for (const moves of [
      new Map<string, RuntimeMove>(),
      new Map([['kick', kickMove({ hitbox: null })]]),
      new Map([['kick', kickMove({ damage: null })]]),
    ]) {
      const world = new World<never>({ seed: 1 });
      expect(() =>
        installKick(world, {
          moves,
          tracks: TRACKS,
          damage: new DamageModel(),
          reactions: { moves },
          move: 'kick',
          sizeOf: () => undefined,
        }),
      ).toThrow(/kick move "kick"/);
    }
  });

  it('can be removed again', () => {
    const moves: MoveTable = new Map([['kick', KICK]]);
    const world = new World<never>({ seed: 1 });
    const off = installKick(world, {
      moves,
      tracks: TRACKS,
      damage: new DamageModel(),
      reactions: { moves },
      move: 'kick',
      sizeOf: () => undefined,
    });
    off();
  });
});
