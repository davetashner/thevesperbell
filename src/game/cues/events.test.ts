import { describe, expect, it } from 'vitest';
import { CUE_EVENT_NAMES, cueDirections, cueEventSpec, type CueEventName } from '@content/index';
import type { TelegraphInfo } from '@sim/index';
import { CUE_EVENT_BINDINGS, telegraphSound, type CueLookups, type CueReading } from './events.ts';

const MATERIALS: Record<number, string> = { 1: 'bone', 2: 'iron', 3: 'dry-wood' };
const CLASSES: Record<string, string> = { iron: 'metal', bone: 'bone', stone: 'stone' };
const lookups: CueLookups = {
  materialOf: (e) => MATERIALS[e],
  impactClassOf: (m) => CLASSES[m],
  shieldOf: (e) => (e === 1 ? 'wood-shield' : undefined),
  moveSoundOf: (m) => (m === 'sword-light-1' ? 'sfx-knight-sword-swing-light' : undefined),
  surfaceUnder: () => 'wood',
  surfaceOfMaterial: (material) => (material === 'water' ? 'water-shallow' : undefined),
  armorOf: (e) => (e === 4 ? 'plate' : undefined),
  arrowCuesOf: (arrow) =>
    arrow === 'water'
      ? {
          trailVfx: 'vfx-arrow-trail-water',
          impactVfx: 'vfx-arrow-impact-water',
          flightSfx: 'sfx-arrow-flyby',
          impactSfx: 'sfx-arrow-water-splash',
        }
      : undefined,
};
/** Only the two required lookups: every optional fact is absent. */
const bare: CueLookups = { materialOf: lookups.materialOf, impactClassOf: lookups.impactClassOf };

const hitbox = {
  tick: 1,
  attacker: 4,
  hitbox: 'sword-light-1',
  activeTick: 2,
  target: 1,
  hurtbox: 'torso',
  region: 'torso',
  multiplier: 1,
  armored: false,
  direction: { x: 0, y: 0, z: 1 },
};

const origin = { x: 1, y: 2, z: 3 };
const packet = {
  instigator: 4,
  source: 2,
  amounts: { slash: 18, blunt: 4 },
  region: 'head',
  tags: [],
};

/** One representative payload per event. */
const SAMPLES: Record<CueEventName, unknown> = {
  DamageApplied: {
    tick: 1,
    target: 1,
    packet,
    amounts: { blunt: 4, slash: 18 },
    total: 22,
    immune: false,
    poiseDamage: 15,
    staminaDamage: 0,
    tags: ['critical'],
    healthBefore: 30,
    healthAfter: 8,
    poiseBroken: true,
    died: false,
  },
  PoiseBroken: { tick: 1, target: 1, instigator: 4, source: null },
  aiAlertStateChanged: {
    tick: 1,
    entity: 4,
    from: 'suspicious',
    to: 'alerted',
    cause: 'event:saw-target',
  },
  GuardBroken: { tick: 1, entity: 1, instigator: 4, source: null, staggerTicks: 60 },
  HitParried: { tick: 1, entity: 1, attacker: 4, source: null, parriedTicks: 90 },
  DodgedHit: hitbox,
  ActionPhaseChanged: { tick: 1, entity: 4, move: 'sword-light-1', phase: 'active', moveTick: 13 },
  LocomotionEvents: { tick: 1, entity: 4, kind: 'footstep', foot: 'left', gait: 'walk' },
  WaterEntered: { tick: 1, entity: 4, volume: 'river', speed: 9 },
  Died: { tick: 1, target: 1, killer: null, source: 2, tags: ['backstab'] },
  TelegraphStarted: {
    tick: 1,
    attacker: 4,
    attack: 'guard-strike',
    move: 'guard-strike',
    cue: 'guard-strike-windup',
    audioCue: null,
    vfxCue: null,
    parryable: true,
    unblockable: false,
  },
  AttackHit: {
    tick: 1,
    attacker: 4,
    attack: 'guard-strike',
    target: 1,
    source: 2,
    results: [{ total: 18 }, { total: 4 }],
  },
  AttackProjectileLaunched: {
    tick: 1,
    attacker: 4,
    attack: 'spit',
    projectile: 9,
    origin,
    direction: { x: 0, y: 0, z: 1 },
  },
  AttackEnded: { tick: 1, attacker: 4, attack: 'guard-strike', reason: 'staggered', elapsed: 9 },
  ActionRejected: { entity: 4, action: 'dodge', reason: 'stamina', tick: 1 },
  StaminaExhausted: { entity: 4, tick: 1 },
  StaminaRecovered: { entity: 4, tick: 1 },
  fireIgnited: { entity: 3 },
  fireExtinguished: { entity: 3, cause: 'water' },
  fireBurntOut: { entity: 3, becomes: 'charred' },
  stimulusResolved: {
    tick: 1,
    stimulus: { shape: { kind: 'point', at: origin }, element: 'fire', source: 4 },
    amount: 5,
    hits: [{ entity: 3, falloff: 1, amount: 5 }],
  },
  propertyChanged: { entity: 3, key: 'burning', old: false, new: true, source: null },
  factChanged: { key: 'bell-rung', old: undefined, new: true, source: null, tick: 1 },
  signalReceived: {
    graph: 7,
    graphId: 'gate',
    node: 'chime',
    receiver: 'audio-cue',
    entity: null,
    key: 'sfx-bell-chime',
    value: true,
    tick: 1,
  },
  volumeEntered: { graph: 7, graphId: 'gate', node: 'plate', entity: 4, tick: 1 },
  volumeExited: { graph: 7, graphId: 'gate', node: 'plate', entity: 4, tick: 1 },
  physicsImpact: {
    entity: 3,
    other: 5,
    materials: ['dry-wood', 'iron'],
    energy: 54,
    impulse: 18,
    speed: 6,
    normal: { x: 0, y: -1, z: 0 },
    position: origin,
  },
  ArrowFired: {
    tick: 1,
    entity: 9,
    arrow: 'water',
    shooter: 4,
    origin,
    velocity: { x: 0, y: 36, z: 48 },
  },
  arrowImpact: {
    tick: 2,
    entity: 9,
    arrow: 'water',
    shooter: 4,
    other: 1,
    material: 'bone',
    hardness: 'medium',
    outcome: 'shatter',
    speed: 58,
    energy: 42,
    impulse: 1.45,
    normal: { x: 0, y: 0, z: -1 },
    position: origin,
    hurtbox: 'head',
    region: 'head',
  },
  breakableBroken: {
    tick: 3,
    entity: 7,
    profile: 'old-wall',
    material: 'stone',
    cause: 'structure',
    by: 'blunt',
    source: 4,
    position: origin,
    cleared: { min: origin, max: origin },
    debris: [10, 11],
    spilled: [],
    reveals: 'hidden-room',
    loudness: 85,
  },
  doorStateChanged: {
    tick: 3,
    entity: 3,
    kind: 'hinged',
    from: 'closed',
    to: 'opening',
    source: 4,
    position: origin,
  },
  doorBlocked: {
    tick: 3,
    entity: 2,
    kind: 'portcullis',
    by: 7,
    openness: 0.27,
    crushed: true,
    position: origin,
  },
  lockUnlocked: { tick: 3, entity: 2, lock: 'slice-exit', by: 'key', source: 4, key: 'old-key' },
  lockRefused: {
    tick: 3,
    entity: 2,
    lock: 'slice-exit',
    reason: 'no-key',
    hint: 'Locked.',
    source: 4,
  },
  switchUsed: { tick: 3, entity: 2, kind: 'lever', position: 1, positions: 2, source: 4 },
  mechanismJammed: { tick: 3, entity: 1, frozen: true, source: null },
};

const read = (event: CueEventName, payload: unknown, look = lookups): CueReading =>
  CUE_EVENT_BINDINGS[event].read(payload, look);

/** The kind a fact value has, in CUE_FACT_KINDS terms. */
function kindOf(value: unknown): string {
  if (Array.isArray(value)) return 'list';
  return typeof value;
}

describe('cue event bindings', () => {
  it('bind every cue event to the sim event of the same name', () => {
    expect(Object.keys(CUE_EVENT_BINDINGS)).toEqual(CUE_EVENT_NAMES);
    for (const name of CUE_EVENT_NAMES) expect(CUE_EVENT_BINDINGS[name].type.name).toBe(name);
  });

  it('produce only declared facts, of the declared kind, and only declared anchors', () => {
    const mismatches: string[] = [];
    for (const name of CUE_EVENT_NAMES) {
      const spec = cueEventSpec(name);
      const { anchors, facts } = read(name, SAMPLES[name]);
      for (const [key, value] of Object.entries(facts)) {
        if (value !== undefined && spec.facts[key] !== kindOf(value)) {
          mismatches.push(`${name}.${key}`);
        }
      }
      for (const key of Object.keys(anchors)) {
        if (!spec.anchors.includes(key)) mismatches.push(`${name}@${key}`);
      }
    }
    expect(mismatches).toEqual([]);
  });

  it('mw-e29.3: carry only declared directions, each of unit length', () => {
    const facingLookups: CueLookups = { ...lookups, facingOf: () => ({ x: 3, y: 0, z: 4 }) };
    const problems: string[] = [];
    for (const name of CUE_EVENT_NAMES) {
      const declared = cueDirections(name);
      const { directions = {} } = read(name, SAMPLES[name], facingLookups);
      for (const [key, value] of Object.entries(directions)) {
        if (!declared.includes(key as never)) problems.push(`${name}~${key}`);
        if (value !== undefined && Math.abs(Math.hypot(value.x, value.y, value.z) - 1) > 1e-9) {
          problems.push(`${name}~${key} is not unit`);
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it('mw-e29.3: a blow travels along its packet direction, else its instigator’s facing; the hit normal faces back', () => {
    const along = { x: 0, y: 0, z: 1 };
    const back = { x: 0, y: 0, z: -1 };
    const facingLookups: CueLookups = {
      ...lookups,
      facingOf: (e) => (e === 4 ? along : undefined),
    };
    const damage = (extra: object, look = facingLookups) =>
      read('DamageApplied', { ...(SAMPLES.DamageApplied as object), ...extra }, look).directions;
    expect(damage({ packet: { ...packet, direction: { x: 2, y: 0, z: 0 } } })).toEqual({
      attackerForward: { x: 1, y: 0, z: 0 },
      hitNormal: { x: -1, y: 0, z: 0 },
    });
    expect(damage({})).toEqual({ attackerForward: along, hitNormal: back });
    expect(damage({ packet: { ...packet, instigator: null } })).toEqual({});
    expect(damage({}, lookups)).toEqual({});
    expect(damage({ packet: { ...packet, direction: { x: 0, y: 0, z: 0 } } })).toEqual({});
    expect(read('HitParried', SAMPLES.HitParried, facingLookups).directions).toEqual({
      attackerForward: along,
      hitNormal: back,
    });
    expect(read('AttackHit', SAMPLES.AttackHit, facingLookups).directions).toEqual({
      attackerForward: along,
      hitNormal: back,
    });
  });

  it('derive hit facts from materials: impact class and material id of target and weapon', () => {
    expect(read('DamageApplied', SAMPLES.DamageApplied)).toEqual({
      anchors: { target: { entity: 1 }, instigator: { entity: 4 }, source: { entity: 2 } },
      facts: {
        target: 'bone',
        targetMaterial: 'bone',
        weapon: 'metal',
        weaponMaterial: 'iron',
        damageType: 'slash',
        contact: 'hit',
        region: 'head',
        tags: ['critical'],
        immune: false,
        died: false,
        poiseBroken: true,
        total: 22,
        poiseDamage: 15,
      },
      directions: {},
    });
    // No source: the instigator is the weapon; a material without an impact class is its own class.
    const unarmed = read('DamageApplied', {
      ...(SAMPLES.DamageApplied as object),
      target: 3,
      packet: { ...packet, source: null, instigator: 2 },
      amounts: {},
    });
    expect(unarmed.anchors).toMatchObject({ source: undefined, instigator: { entity: 2 } });
    expect(unarmed.facts).toMatchObject({ target: 'dry-wood', weapon: 'metal' });
    expect(unarmed.facts['damageType']).toBeUndefined();
    // Nobody to blame and no material known: no material facts at all.
    const none = read('DamageApplied', {
      ...(SAMPLES.DamageApplied as object),
      target: 8,
      packet: { ...packet, source: null, instigator: null },
    });
    expect(Object.keys(none.facts)).not.toContain('target');
    expect(Object.keys(none.facts)).not.toContain('weapon');
  });

  it('name the damage type that dealt the most, whatever the order', () => {
    const dominant = (amounts: Record<string, number>) =>
      read('DamageApplied', { ...(SAMPLES.DamageApplied as object), amounts }).facts['damageType'];
    expect(dominant({ slash: 18, blunt: 4 })).toBe('slash');
    expect(dominant({ blunt: 4, slash: 18 })).toBe('slash');
    expect(dominant({ fire: 0 })).toBeUndefined();
  });

  it('mw-e03.11: read a break: what broke, of what, why, and how loud', () => {
    expect(read('breakableBroken', SAMPLES.breakableBroken)).toEqual({
      anchors: {
        entity: { entity: 7, position: origin },
        at: { position: origin },
        source: { entity: 4 },
      },
      facts: {
        entity: 'stone',
        material: 'stone',
        profile: 'old-wall',
        cause: 'structure',
        by: 'blunt',
        loudness: 85,
      },
    });
    const clay = { ...(SAMPLES.breakableBroken as object), material: 'clay', source: null };
    expect(read('breakableBroken', clay).facts).toMatchObject({ entity: 'clay', material: 'clay' });
    expect(read('breakableBroken', clay).anchors['source']).toBeUndefined();
  });

  it('mw-e03.18: read doors, locks and switches: what moved, of what, and how', () => {
    expect(read('doorStateChanged', SAMPLES.doorStateChanged)).toEqual({
      anchors: {
        entity: { entity: 3, position: origin },
        at: { position: origin },
        source: { entity: 4 },
      },
      facts: {
        entity: 'dry-wood',
        entityMaterial: 'dry-wood',
        kind: 'hinged',
        from: 'closed',
        to: 'opening',
      },
    });
    expect(read('doorBlocked', SAMPLES.doorBlocked).facts).toEqual({
      entity: 'metal',
      entityMaterial: 'iron',
      kind: 'portcullis',
      crushed: true,
    });
    expect(read('lockUnlocked', SAMPLES.lockUnlocked).facts).toEqual({
      lock: 'slice-exit',
      by: 'key',
      key: 'old-key',
    });
    const picked = { ...(SAMPLES.lockUnlocked as object), by: 'pick', key: null, source: null };
    expect(read('lockUnlocked', picked).facts['key']).toBeUndefined();
    expect(read('lockRefused', SAMPLES.lockRefused).facts).toEqual({
      lock: 'slice-exit',
      reason: 'no-key',
    });
    expect(read('switchUsed', SAMPLES.switchUsed).facts).toEqual({
      entity: 'metal',
      entityMaterial: 'iron',
      kind: 'lever',
      position: 1,
    });
    expect(read('mechanismJammed', SAMPLES.mechanismJammed)).toEqual({
      anchors: { entity: { entity: 1 }, source: undefined },
      facts: { entity: 'bone', entityMaterial: 'bone', frozen: true },
    });
  });

  it('read attack, stamina and fire payloads', () => {
    expect(read('TelegraphStarted', SAMPLES.TelegraphStarted).facts).toEqual({
      attack: 'guard-strike',
      move: 'guard-strike',
      telegraph: 'guard-strike-windup',
      telegraphSound: 'sfx-telegraph-guard-strike-windup',
      parryable: true,
      unblockable: false,
    });
    // mw-e04.20: a move that declares its own telegraph audio plays it instead.
    const lunge = {
      ...(SAMPLES.TelegraphStarted as object),
      audioCue: 'sfx-telegraph-lunge',
      vfxCue: 'vfx-telegraph-flare',
      unblockable: true,
    };
    expect(read('TelegraphStarted', lunge).facts).toMatchObject({
      telegraphSound: 'sfx-telegraph-lunge',
      telegraphVfx: 'vfx-telegraph-flare',
      unblockable: true,
    });
    expect(read('AttackHit', SAMPLES.AttackHit).facts).toMatchObject({
      total: 22,
      weapon: 'metal',
    });
    expect(read('AttackProjectileLaunched', SAMPLES.AttackProjectileLaunched).anchors).toEqual({
      origin: { position: origin },
      attacker: { entity: 4 },
      projectile: { entity: 9, position: origin },
    });
    expect(read('StaminaRecovered', SAMPLES.StaminaRecovered)).toEqual({
      anchors: { entity: { entity: 4 } },
      facts: {},
    });
    expect(read('fireBurntOut', SAMPLES.fireBurntOut).facts).toEqual({
      material: 'dry-wood',
      becomes: 'charred',
      destroyed: false,
    });
    expect(read('fireBurntOut', { entity: 3, becomes: null }).facts).toEqual({
      material: 'dry-wood',
      becomes: undefined,
      destroyed: true,
    });
  });

  it('anchor a stimulus at a representative point of its shape', () => {
    const at = (shape: object) =>
      read('stimulusResolved', {
        stimulus: { shape, element: 'water', source: null },
        amount: 1,
        hits: [],
      }).anchors['at'];
    expect(at({ kind: 'point', at: origin })).toEqual({ position: origin });
    expect(at({ kind: 'sphere', center: origin })).toEqual({ position: origin });
    expect(at({ kind: 'box', center: origin })).toEqual({ position: origin });
    expect(at({ kind: 'cone', apex: origin })).toEqual({ position: origin });
    expect(at({ kind: 'capsule', from: origin })).toEqual({ position: origin });
    expect(at({ kind: 'contact', target: 5 })).toEqual({ entity: 5 });
  });

  it('split a changed value into on / to / value facts by its type', () => {
    const change = (value: unknown) =>
      read('factChanged', { key: 'k', new: value, source: 3, tick: 1 }).facts;
    expect(change(true)).toEqual({ key: 'k', on: true });
    expect(change('open')).toEqual({ key: 'k', to: 'open' });
    expect(change(4)).toEqual({ key: 'k', value: 4 });
    expect(
      read('propertyChanged', { entity: 3, key: 'lightEmitter', new: { radius: 1 }, source: 4 }),
    ).toEqual({
      anchors: { entity: { entity: 3 }, source: { entity: 4 } },
      facts: { key: 'lightEmitter', material: 'dry-wood' },
    });
  });

  it('read signal receipts, keyed receivers without an entity', () => {
    expect(read('signalReceived', SAMPLES.signalReceived)).toEqual({
      anchors: { entity: undefined },
      facts: {
        graph: 'gate',
        node: 'chime',
        receiver: 'audio-cue',
        key: 'sfx-bell-chime',
        value: true,
      },
    });
    expect(
      read('signalReceived', {
        ...(SAMPLES.signalReceived as object),
        receiver: 'door',
        entity: 6,
        key: null,
      }).facts['key'],
    ).toBeUndefined();
  });

  it('AC-1: read a physics impact: both sides’ impact class and material, energy, impulse and speed', () => {
    expect(read('physicsImpact', SAMPLES.physicsImpact)).toEqual({
      anchors: {
        entity: { entity: 3, position: origin },
        other: { entity: 5 },
        at: { position: origin },
      },
      facts: {
        entity: 'dry-wood', // no impact class known: the material is its own class
        entityMaterial: 'dry-wood',
        other: 'metal',
        otherMaterial: 'iron',
        energy: 54,
        impulse: 18,
        speed: 6,
      },
      // The payload normal points from the object into what it hit; the surface faces back up.
      directions: { hitNormal: { x: 0, y: 1, z: 0 } },
    });
    // Unbound level geometry: no `other` anchor, but the payload still names its material.
    const unbound = read('physicsImpact', {
      ...(SAMPLES.physicsImpact as object),
      other: null,
      materials: ['bone', 'generic'],
    });
    expect(unbound.anchors['other']).toBeUndefined();
    expect(unbound.facts).toMatchObject({ entity: 'bone', other: 'generic' });
    // A degenerate contact normal gives no direction.
    const flat = { ...(SAMPLES.physicsImpact as object), normal: { x: 0, y: 0, z: 0 } };
    expect(read('physicsImpact', flat).directions).toEqual({ hitNormal: undefined });
  });

  it('mw-e28.4: tell a clean hit from a blocked one (with the blocker’s shield) and an immune one', () => {
    const damage = (extra: object, look = lookups) =>
      read('DamageApplied', { ...(SAMPLES.DamageApplied as object), ...extra }, look).facts;
    expect(damage({ tags: ['blocked'] })).toMatchObject({
      contact: 'blocked',
      shield: 'wood-shield',
    });
    expect(damage({ tags: ['blocked', 'guard-break'] })['contact']).toBe('blocked');
    expect(damage({ tags: ['blocked'] }, bare)['shield']).toBeUndefined();
    expect(damage({ immune: true, tags: [] })).toMatchObject({ contact: 'immune' });
    expect(damage({ immune: true, tags: [] })['shield']).toBeUndefined();
  });

  it('mw-e28.16: a parried hit is contact parried; the parry names its parrier, attacker and shield', () => {
    const damage = (extra: object) =>
      read('DamageApplied', { ...(SAMPLES.DamageApplied as object), ...extra }).facts;
    expect(damage({ tags: ['parried', 'parryable'] })).toMatchObject({ contact: 'parried' });
    expect(damage({ tags: ['parried'] })['shield']).toBeUndefined();
    expect(read('HitParried', SAMPLES.HitParried)).toEqual({
      anchors: { entity: { entity: 1 }, attacker: { entity: 4 }, source: undefined },
      facts: { shield: 'wood-shield' },
      directions: {},
    });
    expect(read('HitParried', { ...(SAMPLES.HitParried as object), attacker: null }, bare)).toEqual(
      {
        anchors: { entity: { entity: 1 }, attacker: undefined, source: undefined },
        facts: { shield: undefined },
        directions: {},
      },
    );
  });

  it('mw-e28.4: read guard breaks, dodged swings and move phases (with the move’s own sound)', () => {
    expect(read('GuardBroken', SAMPLES.GuardBroken)).toEqual({
      anchors: { entity: { entity: 1 }, instigator: { entity: 4 }, source: undefined },
      facts: { shield: 'wood-shield' },
    });
    expect(read('DodgedHit', SAMPLES.DodgedHit)).toEqual({
      anchors: { target: { entity: 1 }, attacker: { entity: 4 } },
      facts: { hitbox: 'sword-light-1', region: 'torso' },
    });
    expect(read('ActionPhaseChanged', SAMPLES.ActionPhaseChanged)).toEqual({
      anchors: { entity: { entity: 4 } },
      facts: { move: 'sword-light-1', phase: 'active', sound: 'sfx-knight-sword-swing-light' },
    });
    expect(read('ActionPhaseChanged', SAMPLES.ActionPhaseChanged, bare).facts['sound']).toBe(
      undefined,
    );
    expect(read('GuardBroken', SAMPLES.GuardBroken, bare).facts['shield']).toBeUndefined();
  });

  it('mw-e28.6: read footsteps and landings with the surface underfoot and the armour layer', () => {
    expect(read('LocomotionEvents', SAMPLES.LocomotionEvents)).toEqual({
      anchors: { entity: { entity: 4 } },
      facts: { kind: 'footstep', foot: 'left', gait: 'walk', surface: 'wood', armor: 'plate' },
    });
    // Wading: the material the step was taken in names the surface, not the ground under it.
    expect(
      read('LocomotionEvents', {
        tick: 1,
        entity: 4,
        kind: 'footstep',
        foot: 'left',
        gait: 'walk',
        material: 'water',
      }).facts['surface'],
    ).toBe('water-shallow');
    expect(
      read('LocomotionEvents', {
        tick: 1,
        entity: 4,
        kind: 'footstep',
        foot: 'left',
        gait: 'walk',
        material: 'mud',
      }).facts['surface'],
    ).toBe('wood');
    expect(read('WaterEntered', SAMPLES.WaterEntered)).toEqual({
      anchors: { entity: { entity: 4 } },
      facts: { speed: 9 },
    });
    const land = (impactSpeed: number) =>
      read('LocomotionEvents', { tick: 1, entity: 5, kind: 'land', impactSpeed }).facts;
    expect(land(4)).toEqual({
      kind: 'land',
      impactSpeed: 4,
      landing: 'light',
      surface: 'wood',
      armor: undefined,
    });
    expect(land(6)['landing']).toBe('heavy');
    // Airborne events have no surface; without the optional lookups there is no surface or armour.
    expect(read('LocomotionEvents', { tick: 1, entity: 4, kind: 'jumpStart' }).facts).toEqual({
      kind: 'jumpStart',
      surface: undefined,
      armor: 'plate',
    });
    expect(read('LocomotionEvents', SAMPLES.LocomotionEvents, bare).facts).toEqual({
      kind: 'footstep',
      foot: 'left',
      gait: 'walk',
    });
  });

  it('mw-e05.19 AC-1: an arrow impact on stone carries entity/other/at and arrow, outcome, surface impact class (other), energy and speed', () => {
    const stone = read('arrowImpact', {
      ...(SAMPLES.arrowImpact as object),
      arrow: 'standard',
      other: 5,
      material: 'stone',
      hardness: 'hard',
      outcome: 'ricochet',
      hurtbox: undefined,
      region: undefined,
    });
    expect(stone).toEqual({
      anchors: {
        entity: { entity: 9, position: origin },
        other: { entity: 5 },
        at: { position: origin },
      },
      facts: {
        arrow: 'standard',
        outcome: 'ricochet',
        other: 'stone',
        otherMaterial: 'stone',
        hardness: 'hard',
        creature: false,
        region: undefined,
        sound: undefined,
        vfx: undefined,
        energy: 42,
        speed: 58,
        impulse: 1.45,
      },
      directions: { hitNormal: { x: 0, y: 0, z: -1 } },
    });
    // Unbound geometry has no `other` anchor.
    expect(
      read('arrowImpact', { ...(SAMPLES.arrowImpact as object), other: null }).anchors['other'],
    ).toBeUndefined();
  });

  it('mw-e05.19: a creature hit names the region, and the arrow’s own impact sound and VFX', () => {
    expect(read('arrowImpact', SAMPLES.arrowImpact).facts).toMatchObject({
      creature: true,
      region: 'head',
      other: 'bone',
      sound: 'sfx-arrow-water-splash',
      vfx: 'vfx-arrow-impact-water',
    });
    expect(read('arrowImpact', SAMPLES.arrowImpact, bare).facts['sound']).toBeUndefined();
  });

  it('mw-e05.19 AC-3: ArrowFired is anchored at the arrow and carries its id, trail, flight sound and speed', () => {
    expect(read('ArrowFired', SAMPLES.ArrowFired)).toEqual({
      anchors: {
        arrow: { entity: 9, position: origin },
        shooter: { entity: 4 },
        origin: { position: origin },
      },
      facts: {
        arrow: 'water',
        trail: 'vfx-arrow-trail-water',
        flight: 'sfx-arrow-flyby',
        speed: 60,
      },
      directions: { attackerForward: { x: 0, y: 0.6, z: 0.8 } },
    });
    const trap = read('ArrowFired', { ...(SAMPLES.ArrowFired as object), shooter: null }, bare);
    expect(trap.anchors['shooter']).toBeUndefined();
    expect(trap.facts).toMatchObject({ arrow: 'water', trail: undefined });
  });

  it('mw-e28.8: creature slots read as facts: bark, hurt, poise break, death, steps and telegraphs', () => {
    const audio = {
      idleLoop: 'sfx-t-idle',
      footsteps: 'sfx-t-step',
      alertBark: 'sfx-t-bark',
      telegraph: 'sfx-t-tele',
      unblockableTelegraph: 'sfx-t-tele-heavy',
      hurt: 'sfx-t-hurt',
      poiseBreak: 'sfx-t-stagger',
      death: 'sfx-t-death',
    };
    const creature = { ...lookups, creatureAudioOf: () => audio };
    expect(read('aiAlertStateChanged', SAMPLES.aiAlertStateChanged, creature)).toEqual({
      anchors: { entity: { entity: 4 } },
      facts: { from: 'suspicious', to: 'alerted', cause: 'event:saw-target', bark: 'sfx-t-bark' },
    });
    expect(read('Died', SAMPLES.Died, creature).facts['creatureDeath']).toBe('sfx-t-death');
    expect(read('PoiseBroken', SAMPLES.PoiseBroken, creature).facts['creaturePoiseBreak']).toBe(
      'sfx-t-stagger',
    );
    expect(read('LocomotionEvents', SAMPLES.LocomotionEvents, creature).facts).toMatchObject({
      creatureSteps: 'sfx-t-step',
    });
    const land = read(
      'LocomotionEvents',
      { tick: 1, entity: 4, kind: 'land', impactSpeed: 3 },
      creature,
    );
    expect(land.facts['creatureSteps']).toBeUndefined();
    // Hurt is for a clean hit that left it standing: not a kill, not an immune glance.
    const damage = SAMPLES.DamageApplied as object;
    expect(read('DamageApplied', damage, creature).facts['creatureHurt']).toBe('sfx-t-hurt');
    expect(
      read('DamageApplied', { ...damage, died: true }, creature).facts['creatureHurt'],
    ).toBeUndefined();
    expect(
      read('DamageApplied', { ...damage, immune: true }, creature).facts['creatureHurt'],
    ).toBeUndefined();
    // The move's own cue wins; else the creature's slot (unblockable one for unblockable moves).
    const tele = SAMPLES.TelegraphStarted as TelegraphInfo;
    expect(telegraphSound(tele, audio)).toBe('sfx-t-tele');
    expect(telegraphSound({ ...tele, unblockable: true }, audio)).toBe('sfx-t-tele-heavy');
    expect(telegraphSound({ ...tele, audioCue: 'sfx-own' }, audio)).toBe('sfx-own');
    expect(telegraphSound(tele)).toBe('sfx-telegraph-guard-strike-windup');
    expect(read('TelegraphStarted', tele, creature).facts['telegraphSound']).toBe('sfx-t-tele');
    // Nothing that is no creature has a slot.
    expect(
      read('aiAlertStateChanged', SAMPLES.aiAlertStateChanged, bare).facts['bark'],
    ).toBeUndefined();
  });
});
