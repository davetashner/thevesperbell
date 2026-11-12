import { describe, expect, it } from 'vitest';
import type { EntityId } from '../core/component';
import { World } from '../core/world';
import type { FieldConfigInput } from '../field/config';
import { installElementField, elementFieldSystem } from '../field/install';
import { fireRules, type BurntMaterials } from '../elements/fire';
import { ElementRuleSet, elementRulesSystem } from '../elements/rules';
import { PhysicsColliderComponent, PhysicsObjectComponent } from '../physics/objects';
import {
  addProperties,
  assignProperty,
  readProperty,
  registerWorldProperties,
  type WorldPropertyInit,
} from '../properties/components';
import { addMaterialProperties, type MaterialPresets } from '../properties/materials';
import { installStimuli, stimulusSystem } from '../stimulus/stimulus';
import {
  canAttachClimb,
  BASE_CLIMB_DIFFICULTY,
  CLIMB_GRADE_RULES,
  CLIMB_REFUSAL_TEXT,
  CLIMB_ICE_CAPABILITY,
  CLIMB_ROUGH_CAPABILITY,
  CLIMB_SHEER_CAPABILITY,
  climbabilityOf,
  climbabilityOfCollider,
  climbDifficulty,
  maxClimbDifficulty,
  ownerOfCollider,
  type Climbability,
} from './surfaces';

const THIEF = [CLIMB_ROUGH_CAPABILITY];
const KNIGHT: readonly string[] = [];

function world(): World<never> {
  return registerWorldProperties(new World<never>({ seed: 1 }));
}

function surface(w: World<never>, init: WorldPropertyInit): EntityId {
  const entity = w.spawn();
  addProperties(w, entity, init);
  return entity;
}

describe('climbable surfaces (mw-e03.22)', () => {
  it('a surface climbs by its grade; without one, or once gone, it is not climbable', () => {
    const w = world();
    const plain = surface(w, { material: 'stone' });
    const ladder = surface(w, { climbable: 'ladder' });
    expect(climbabilityOf(w, plain)).toBe('none');
    expect(climbabilityOf(w, ladder)).toBe('ladder');
    w.destroy(ladder);
    expect(climbabilityOf(w, ladder)).toBe('none');
  });

  it('every grade has a rule: ladders, ropes and ivy for all, rough for climbers, sheer for tools', () => {
    expect(CLIMB_GRADE_RULES).toEqual({
      ladder: { difficulty: 1, requires: null },
      rope: { difficulty: 1, requires: null },
      ivy: { difficulty: 1, requires: null },
      rough: { difficulty: 2, requires: CLIMB_ROUGH_CAPABILITY },
      sheer: { difficulty: 3, requires: CLIMB_SHEER_CAPABILITY },
    });
    const difficulties = (
      ['none', 'ladder', 'rope', 'ivy', 'rough', 'sheer', 'slippery'] as Climbability[]
    ).map(climbDifficulty);
    expect(difficulties).toEqual([0, 1, 1, 1, 2, 3, 3]);
  });

  it('any class attaches to a ladder; rough needs verb.climb.rough; sheer needs a tool', () => {
    const w = world();
    const ladder = surface(w, { climbable: 'ladder' });
    const rough = surface(w, { climbable: 'rough' });
    const sheer = surface(w, { climbable: 'sheer' });
    const bare = surface(w, {});
    expect(canAttachClimb(w, ladder, KNIGHT)).toEqual({ ok: true, climbability: 'ladder' });
    expect(canAttachClimb(w, rough, KNIGHT)).toEqual({
      ok: false,
      reason: 'needs-capability',
      capability: CLIMB_ROUGH_CAPABILITY,
    });
    expect(canAttachClimb(w, rough, THIEF)).toEqual({ ok: true, climbability: 'rough' });
    expect(canAttachClimb(w, sheer, THIEF)).toEqual({
      ok: false,
      reason: 'needs-capability',
      capability: CLIMB_SHEER_CAPABILITY,
    });
    expect(canAttachClimb(w, bare, THIEF)).toEqual({ ok: false, reason: 'not-climbable' });
  });

  it('AC-4: a surface that becomes frozen returns slippery and refuses a climb attach (edge)', () => {
    const w = world();
    const ivy = surface(w, { climbable: 'ivy', frozen: false });
    expect(canAttachClimb(w, ivy, THIEF).ok).toBe(true);
    assignProperty(w, ivy, 'frozen', true);
    expect(climbabilityOf(w, ivy)).toBe('slippery');
    expect(canAttachClimb(w, ivy, THIEF)).toEqual({
      ok: false,
      reason: 'slippery',
      capability: CLIMB_ICE_CAPABILITY,
    });
    // Ice tools (future) hold on; a frozen surface with no grade stays unclimbable.
    expect(canAttachClimb(w, ivy, [CLIMB_ICE_CAPABILITY])).toEqual({
      ok: true,
      climbability: 'slippery',
    });
    const frozenWall = surface(w, { frozen: true });
    expect(climbabilityOf(w, frozenWall)).toBe('none');
    // Thawing gives the grade back.
    assignProperty(w, ivy, 'frozen', false);
    expect(climbabilityOf(w, ivy)).toBe('ivy');
  });

  it('a collision query’s collider or body names its owner and so its grade', () => {
    const w = world();
    w.register(PhysicsObjectComponent, PhysicsColliderComponent);
    const rope = surface(w, { climbable: 'rope' });
    const wall = surface(w, { climbable: 'rough' });
    w.add(rope, PhysicsObjectComponent, { body: 7 } as never);
    w.add(wall, PhysicsColliderComponent, { colliders: [3, 4] });
    expect(ownerOfCollider(w, 7)).toBe(rope);
    expect(ownerOfCollider(w, 4)).toBe(wall);
    expect(ownerOfCollider(w, 9)).toBeUndefined();
    expect(climbabilityOfCollider(w, 7)).toBe('rope');
    expect(climbabilityOfCollider(w, 3)).toBe('rough');
    expect(climbabilityOfCollider(w, 9)).toBe('none');
  });

  it('a world without physics objects or bound colliders has no owners (mw-e02.13)', () => {
    expect(ownerOfCollider(world(), 1)).toBeUndefined();
    const colliders = world();
    colliders.register(PhysicsColliderComponent);
    const wall = surface(colliders, { climbable: 'rough' });
    colliders.add(wall, PhysicsColliderComponent, { colliders: [1] });
    expect(ownerOfCollider(colliders, 1)).toBe(wall);
  });
});

describe('climbability after fire (mw-e03.22 AC-3)', () => {
  const PRESETS: MaterialPresets = new Map<string, WorldPropertyInit>([
    ['ivy', { flammable: true, ignitionPoint: 350, fuel: 1, climbable: 'ivy' }],
    ['wood', { flammable: true, ignitionPoint: 300, fuel: 1, climbable: 'rough' }],
    ['charred', { flammable: false, climbable: 'none' }],
  ]);
  const BURNT: BurntMaterials = new Map([
    ['ivy', null],
    ['wood', 'charred'],
  ]);
  const FIELD: FieldConfigInput = { maxChunks: 8 };

  function fireWorld() {
    const w = installElementField(installStimuli(world()), FIELD);
    w.addSystem(stimulusSystem())
      .addSystem(
        elementRulesSystem(new ElementRuleSet(fireRules({ presets: PRESETS, burnt: BURNT }))),
      )
      .addSystem(elementFieldSystem());
    return w;
  }

  function burning(w: World<never>, material: string): EntityId {
    const entity = w.spawn();
    addMaterialProperties(w, entity, PRESETS, { material, burning: true, temperature: 400 });
    return entity;
  }

  /** Steps until `entity` stops burning (burnt out), at most 5 s. */
  function burnOut(w: World<never>, entity: EntityId): void {
    for (let i = 0; i < 5 * w.clock.hz; i++) {
      w.step();
      if (!w.isAlive(entity) || !readProperty(w, entity, 'burning')) return;
    }
    throw new Error('never burnt out');
  }

  it('AC-3: ivy that burns out is gone: its grade is none and a climb attach is refused', () => {
    const w = fireWorld();
    const ivy = burning(w, 'ivy');
    expect(canAttachClimb(w, ivy, KNIGHT).ok).toBe(true);
    burnOut(w, ivy);
    expect(w.isAlive(ivy)).toBe(false);
    expect(climbabilityOf(w, ivy)).toBe('none');
    expect(canAttachClimb(w, ivy, THIEF)).toEqual({ ok: false, reason: 'not-climbable' });
  });

  it('AC-3: timber that burns out to charred loses its rough climb through burnt-state data', () => {
    const w = fireWorld();
    const beam = burning(w, 'wood');
    expect(climbabilityOf(w, beam)).toBe('rough');
    burnOut(w, beam);
    expect(readProperty(w, beam, 'material')).toBe('charred');
    expect(climbabilityOf(w, beam)).toBe('none');
  });
});

describe('climb difficulty by capability (mw-e10.9)', () => {
  const GRANTS = new Map([
    [CLIMB_ROUGH_CAPABILITY, 3],
    ['verb.climb.sheer', 3],
    ['tool.grip-gloves', 2],
  ]);

  it('AC-1/AC-2: the best difficulty is the highest a held capability grants, 1 with none', () => {
    expect(BASE_CLIMB_DIFFICULTY).toBe(1);
    expect(maxClimbDifficulty(THIEF, GRANTS)).toBe(3);
    expect(maxClimbDifficulty(KNIGHT, GRANTS)).toBe(1);
    expect(maxClimbDifficulty(['verb.climb.ledge'], GRANTS)).toBe(1);
    expect(maxClimbDifficulty(['tool.grip-gloves', 'verb.climb.ledge'], GRANTS)).toBe(2);
    expect(maxClimbDifficulty([...THIEF, 'tool.grip-gloves'], GRANTS)).toBe(3);
  });

  it('a grade harder than the actor’s best is refused first, with the numbers and a prompt', () => {
    const w = world();
    const wall = surface(w, { climbable: 'rough' });
    const ladder = surface(w, { climbable: 'ladder' });
    expect(canAttachClimb(w, wall, THIEF, 3)).toEqual({ ok: true, climbability: 'rough' });
    expect(canAttachClimb(w, wall, THIEF, 1)).toEqual({
      ok: false,
      reason: 'too-difficult',
      difficulty: 2,
      max: 1,
    });
    // Without a limit the capability alone decides (the old rule); a ladder is always difficulty 1.
    expect(canAttachClimb(w, wall, KNIGHT)).toMatchObject({ reason: 'needs-capability' });
    expect(canAttachClimb(w, ladder, KNIGHT, 1).ok).toBe(true);
    // A sheer face needs its capability even from a climber who can attempt difficulty 3.
    const sheer = surface(w, { climbable: 'sheer' });
    expect(canAttachClimb(w, sheer, THIEF, 3)).toMatchObject({ reason: 'needs-capability' });
    // A frozen surface is about grip, not difficulty.
    const ice = surface(w, { climbable: 'rough', frozen: true });
    expect(canAttachClimb(w, ice, THIEF, 1)).toMatchObject({ reason: 'slippery' });
    expect(CLIMB_REFUSAL_TEXT['too-difficult']).toBe('Too hard for you to climb');
    for (const text of Object.values(CLIMB_REFUSAL_TEXT)) expect(text).not.toBe('');
  });
});
