import type { ControllerTuning, Frozen } from '@content/index';
import { describe, expect, it } from 'vitest';
import { SimClock } from '../clock';
import type { BodyId, CollisionHit, CollisionWorld } from '../character/collision-world';
import {
  controllerParams,
  IDLE_INPUT,
  initialCharacterState,
  SKIN,
  stepCharacter,
  type CharacterInput,
  type CharacterState,
} from '../character/controller';
import { FakeCollisionWorld } from '../character/fake-collision-world';
import { impelCharacter } from '../character/impulse';
import type { TraversalHook } from '../character/traversal';
import { add, dot, scale, sub } from '../character/vec';
import type { EntityId } from '../core/component';
import { World } from '../core/world';
import { at as nth } from '../geom/vec';
import { atan2, cos, sin } from '../math';
import { PhysicsColliderComponent } from '../physics/objects';
import { InMemoryColliderSink } from '../physics/static-colliders';
import {
  addProperties,
  assignProperty,
  registerWorldProperties,
  type WorldPropertyInit,
} from '../properties/components';
import type { KitLookup, KitPieceSpec, ScenePlacementSpec, Triple } from '../scene/layout';
import { loadScene, registerSceneComponents, type LoadedScene } from '../scene/loader';
import type { Vec3 } from '../stimulus/shapes';
import {
  CarryLedgerComponent,
  grabRefused,
  holdOf,
  refuseGrab,
  type GrabRefused,
} from '../carry/state';
import {
  climbDrainPerSecond,
  climbRefused,
  climbTraversal,
  DEFAULT_CLIMB_TUNING,
  DEFAULT_STAMINA_BY_DIFFICULTY,
  type ClimbRefused,
} from './climb';
import { sceneLedges } from './ledges';
import { DEFAULT_LEDGE_TUNING, ledgeTraversal } from './mantle';
import { ClimbRopeComponent, makeRope, sceneRopes, spawnRope } from './ropes';
import {
  CLIMB_ICE_CAPABILITY,
  CLIMB_REFUSAL_TEXT,
  CLIMB_ROUGH_CAPABILITY,
  maxClimbDifficulty,
} from './surfaces';

/** The mw-e02.2 starting numbers, without ledge or climb blocks (the sim's defaults apply). */
const BASE: Frozen<ControllerTuning> = {
  capsule: { radius: 0.35, height: 1.8, crouchHeight: 1.0 },
  speeds: { run: 5, sprint: 7.5, crouch: 2.2 },
  accelTime: 0.15,
  decelTime: 0.1,
  airControl: 0.3,
  gravity: 25,
  maxFallSpeed: 40,
  jumpApex: 1.2,
  coyoteMs: 120,
  jumpBufferMs: 150,
  stepHeight: 0.35,
  slopeLimit: 45,
};
/** The same with the ledge and climb blocks the shipped profile states. */
const TUNED: Frozen<ControllerTuning> = {
  ...BASE,
  ledge: DEFAULT_LEDGE_TUNING,
  climb: DEFAULT_CLIMB_TUNING,
};

const HZ = 60;
const DT = 1 / HZ;
const v = (x: number, y: number, z: number): Vec3 => ({ x, y, z });

const KIT: readonly KitPieceSpec[] = [
  {
    id: 'floor',
    purpose: 'walkable',
    parts: [{ shape: 'box', size: [1, 0.2, 1], offset: [0, -0.1, 0], collider: true }],
  },
  {
    id: 'box',
    purpose: 'climbable',
    parts: [{ shape: 'box', size: [1, 1, 1], offset: [0, 0.5, 0], collider: true }],
  },
  {
    id: 'rope',
    purpose: 'climbable',
    parts: [{ shape: 'box', size: [0.05, 1, 0.05], offset: [0, 0.5, 0], collider: false }],
  },
  {
    id: 'wedge',
    purpose: 'walkable',
    parts: [{ shape: 'wedge', size: [1, 1, 1], offset: [0, 0.5, 0], collider: true }],
  },
];
const kit: KitLookup = (id) => KIT.find((piece) => piece.id === id);

/** A placement with the world properties to give its piece. */
interface Piece {
  readonly spec: ScenePlacementSpec;
  readonly properties?: WorldPropertyInit;
}

/** A box from `min` to `max` with `properties`. */
function block(min: Triple, max: Triple, properties?: WorldPropertyInit): Piece {
  return {
    spec: {
      piece: { id: 'box' },
      at: [(min[0] + max[0]) / 2, min[1], (min[2] + max[2]) / 2],
      yaw: 0,
      scale: [max[0] - min[0], max[1] - min[1], max[2] - min[2]],
    },
    ...(properties !== undefined && { properties }),
  };
}

/** An authored rope from `top` down to `bottom` (height), at x, z. */
function ropePiece(x: number, z: number, bottom: number, top: number): Piece {
  return {
    spec: { piece: { id: 'rope' }, at: [x, bottom, z], yaw: 0, scale: [1, top - bottom, 1] },
    properties: { climbable: 'rope' },
  };
}

const FLOOR: Piece = {
  spec: { piece: { id: 'floor' }, at: [0, 0, 0], yaw: 0, scale: [40, 1, 40] },
};

/** Camera yaw looking east (+x): forward runs at the walls, right is +z. */
const EAST = -Math.PI / 2;

interface Keys {
  readonly forward?: number;
  readonly right?: number;
  readonly jump?: boolean;
  readonly crouch?: boolean;
  readonly yaw?: number;
}

function input({ forward = 0, right = 0, jump = false, crouch = false, yaw = EAST }: Keys = {}) {
  return {
    actions: {
      move: { x: right, y: forward },
      jump: { pressed: jump, held: jump },
      sprint: { pressed: false, held: false },
      crouch: { pressed: crouch, held: crouch },
    },
    cameraYaw: yaw,
  } satisfies CharacterInput;
}

const FORWARD = input({ forward: 1 });
const BACK = input({ forward: -1 });
/** The entity the rig's character is, for capabilities and stamina. */
const PLAYER = 999 as EntityId;

interface RigOptions {
  readonly feet?: Vec3;
  readonly capabilities?: readonly string[];
  readonly tuning?: Frozen<ControllerTuning>;
  /** Without the ledge hook: no pull-up at the top. */
  readonly noLedges?: boolean;
  /** Without the rope component registered. */
  readonly noRopes?: boolean;
  /** The collision world to use instead of the scene's (its bodies bound to `bind`). */
  readonly collision?: CollisionWorld;
  /** The climb hook with only its world: no capabilities, stamina or ledge hook. */
  readonly minimal?: boolean;
  /** Whether the character's hands are full: hooks are asked before they start a grab. */
  readonly handsFull?: (entity: EntityId | undefined) => boolean;
  /** Step the character with no entity (a plain controller that is no one's player). */
  readonly anonymous?: boolean;
  /** The hardest climb difficulty the character attempts (mw-e10.9); unlimited when absent. */
  readonly maxDifficulty?: (entity: EntityId | undefined) => number;
}

/** A character in a scene of kit pieces with the ledge and climb hooks, stepped by the controller. */
class Rig {
  readonly world: World<never>;
  readonly scene: LoadedScene;
  readonly collision: CollisionWorld;
  readonly tuning: Frozen<ControllerTuning>;
  state: CharacterState;
  /** The stamina the hook reads; undefined = no pool. */
  stamina: number | undefined = undefined;
  readonly trace: CharacterState[] = [];
  private readonly hooks: TraversalHook[] = [];
  private readonly anonymous: boolean;

  constructor(pieces: readonly Piece[], options: RigOptions = {}) {
    this.world = registerWorldProperties(registerSceneComponents(new World<never>({ seed: 3 })));
    this.world.register(PhysicsColliderComponent);
    if (options.noRopes !== true) this.world.register(ClimbRopeComponent);
    const all = [FLOOR, ...pieces];
    const spec = {
      id: 'climb',
      grid: 1,
      placements: all.map((piece) => piece.spec),
      spawns: [],
    };
    this.scene = loadScene(this.world, spec, kit, new InMemoryColliderSink());
    // Bind each solid part's collider (fake body n is the scene's collider n) to its piece.
    let next = 0;
    for (const part of this.scene.layout.parts) {
      if (part.collider === undefined) continue;
      const handle = nth(this.scene.colliders, next++);
      const entity = nth(this.scene.pieces, part.placement);
      const bound = this.world.get(entity, PhysicsColliderComponent)?.colliders ?? [];
      this.world.add(entity, PhysicsColliderComponent, { colliders: [...bound, handle] });
    }
    all.forEach((piece, n) => {
      if (piece.properties !== undefined) {
        addProperties(this.world, nth(this.scene.pieces, n), piece.properties);
      }
    });
    if (options.noRopes !== true) sceneRopes(this.world, this.scene);
    this.collision =
      options.collision ??
      new FakeCollisionWorld(
        this.scene.layout.parts.flatMap((part) => (part.collider ? [part.collider] : [])),
      );
    const capabilities = options.capabilities ?? [];
    const caps = (entity: EntityId | undefined) => (entity === PLAYER ? capabilities : []);
    const ledges = ledgeTraversal({
      world: this.world,
      ledges: sceneLedges(this.scene),
      capabilities: caps,
      ...(options.handsFull !== undefined && { handsFull: options.handsFull }),
    });
    if (options.noLedges !== true) this.hooks.push(ledges);
    this.hooks.push(
      options.minimal === true
        ? climbTraversal({ world: this.world })
        : climbTraversal({
            world: this.world,
            capabilities: caps,
            stamina: (entity) => (entity === PLAYER ? this.stamina : undefined),
            ...(options.handsFull !== undefined && { handsFull: options.handsFull }),
            ...(options.maxDifficulty !== undefined && { maxDifficulty: options.maxDifficulty }),
            ...(options.noLedges !== true && { ledges }),
          }),
    );
    this.anonymous = options.anonymous === true;
    this.tuning = options.tuning ?? TUNED;
    this.state = initialCharacterState(options.feet ?? v(0, 0, 0));
    this.step(IDLE_INPUT, 3);
  }

  /** The piece entity of placement `n` (the floor is 0, then the pieces in order). */
  piece(n: number): EntityId {
    return nth(this.scene.pieces, n);
  }

  step(tickInput: CharacterInput = IDLE_INPUT, ticks = 1): CharacterState {
    const params = controllerParams(this.tuning, new SimClock(HZ));
    for (let i = 0; i < ticks; i++) {
      this.state = stepCharacter(this.state, tickInput, {
        world: this.collision,
        tuning: this.tuning,
        params,
        hooks: this.hooks,
        ...(!this.anonymous && { entity: PLAYER }),
      });
      this.trace.push(this.state);
    }
    return this.state;
  }

  /** Steps with `tickInput` until `done` holds; the ticks taken. */
  until(tickInput: CharacterInput, done: (s: CharacterState) => boolean, limit = 600): number {
    for (let n = 1; n <= limit; n++) {
      if (done(this.step(tickInput))) return n;
    }
    throw new Error('condition never met');
  }

  /** Every traversal mode the trace went through, in order, without repeats. */
  modes(): (string | null)[] {
    const modes: (string | null)[] = [];
    for (const s of this.trace) if (modes.at(-1) !== s.traversal) modes.push(s.traversal);
    return modes;
  }
}

const climbing = (s: CharacterState) => s.traversal === 'climb';

/** A 3 m stone-like block whose west face is at x = 2 (4 m along z), with `properties`. */
const tower = (properties?: WorldPropertyInit) => block([2, 0, -2], [4, 3, 2], properties);
/** A ladder 0.8 m wide against the tower's west face, as high as the tower. */
const ladder = (height = 3) => block([1.9, 0, -0.4], [2, height, 0.4], { climbable: 'ladder' });
const ROUGH: WorldPropertyInit = { climbable: 'rough' };
const IVY: WorldPropertyInit = { climbable: 'ivy', flammable: true };
const CLIMBER = [CLIMB_ROUGH_CAPABILITY];

describe('climbing (mw-e02.13)', () => {
  it('AC-1: any class walking into a ladder attaches and climbs it at 1.2 m/s', () => {
    const rig = new Rig([tower(), ladder()], { feet: v(1, 0, 0) });
    rig.until(FORWARD, climbing);
    const attached = rig.state;
    expect(attached.climb?.surface).toBe(rig.piece(2));
    expect(attached.climb?.normal).toEqual(v(-1, 0, 0));
    // Hanging WALL_GAP off the ladder's face, still at the foot of it.
    expect(attached.position.x).toBeCloseTo(1.9 - 0.35 - 2 * SKIN, 9);
    expect(attached.position.y).toBeCloseTo(SKIN, 9);
    expect(attached.grounded).toBe(false);
    rig.step(FORWARD, 30);
    expect(rig.state.traversal).toBe('climb');
    expect(rig.state.position.y - attached.position.y).toBeCloseTo(1.2 * 30 * DT, 9);
    expect(rig.state.velocity.y).toBeCloseTo(1.2, 9);
    expect(rig.state.position.x).toBeCloseTo(attached.position.x, 9);
  });

  it('AC-1: at the top the climber pulls up onto the ledge (the ledge hook’s mantle) and stands on it', () => {
    const rig = new Rig([tower(), ladder()], { feet: v(1, 0, 0) });
    rig.until(FORWARD, (s) => s.traversal === null && s.grounded && s.position.y > 2.9);
    expect(rig.modes()).toEqual([null, 'climb', 'mantle', null]);
    // The pull-up started with the hands at the top: feet handHeight (2 m) below it.
    const pull = rig.trace.find((s) => s.traversal === 'mantle');
    expect(pull?.ledge?.path?.ticks).toBe(42); // pullUpMs 700
    expect(pull?.climb).toBeUndefined();
    const top = rig.state;
    expect(top.position.y).toBeCloseTo(3 + SKIN, 9);
    expect(top.position.x).toBeGreaterThan(2);
    expect(top.climb).toBeUndefined();
  });

  it('AC-2: a rough wall needs verb.climb.rough: without it a jump at it attaches nothing', () => {
    const without = new Rig([tower(ROUGH)], { feet: v(1.6, 0, 0) });
    without.step(input({ forward: 1, jump: true }));
    expect(without.state.traversal).toBeNull();
    without.step(FORWARD, 60);
    expect(without.modes()).toEqual([null]);

    const climber = new Rig([tower(ROUGH)], { feet: v(1.6, 0, 0), capabilities: CLIMBER });
    climber.step(input({ forward: 1, jump: true }));
    expect(climber.state.traversal).toBe('climb');
    expect(climber.state.climb?.surface).toBe(climber.piece(1));
  });

  it('AC-2: walking into a rough wall never starts a climb, even for a climber; a catch in the air does', () => {
    const rig = new Rig([tower(ROUGH)], { feet: v(1, 0, 0), capabilities: CLIMBER });
    rig.step(FORWARD, 60);
    expect(rig.modes()).toEqual([null]);
    expect(rig.state.position.x).toBeCloseTo(2 - 0.35 - SKIN, 6);
    // A jump straight up beside it, then pressing into it in the air: caught.
    rig.step(input({ jump: true }));
    expect(rig.state.traversal).toBeNull();
    rig.until(FORWARD, climbing);
    expect(rig.state.position.y).toBeGreaterThan(0.1);
    expect(rig.state.velocity).toEqual(v(0, 0, 0));
  });

  it('AC-3: ivy that loses its climbable property drops its climber on the next tick', () => {
    const rig = new Rig([tower(), block([1.95, 0, -1], [2, 3, 1], IVY)], { feet: v(1, 0, 0) });
    rig.until(FORWARD, climbing);
    rig.step(FORWARD, 30);
    const high = rig.state.position.y;
    assignProperty(rig.world, rig.piece(2), 'climbable', 'none');
    rig.step(FORWARD);
    expect(rig.state.traversal).toBeNull();
    expect(rig.state.climb).toBeUndefined();
    expect(rig.state.grounded).toBe(false);
    rig.step(IDLE_INPUT, 10);
    expect(rig.state.position.y).toBeLessThan(high);
    expect(rig.state.velocity.y).toBeLessThan(0);
  });

  it('AC-3: ivy burnt away (its piece destroyed) drops the climber at once too', () => {
    const rig = new Rig([tower(), block([1.95, 0, -1], [2, 3, 1], IVY)], { feet: v(1, 0, 0) });
    rig.until(FORWARD, climbing);
    rig.step(FORWARD, 30);
    rig.world.destroy(rig.piece(2));
    rig.step(FORWARD);
    expect(rig.state.traversal).toBeNull();
  });

  it('burning ivy is held for the slip grace (1 s), without climbing, then let go', () => {
    const rig = new Rig([tower(), block([1.95, 0, -1], [2, 3, 1], IVY)], { feet: v(1, 0, 0) });
    rig.until(FORWARD, climbing);
    rig.step(FORWARD, 10);
    assignProperty(rig.world, rig.piece(2), 'burning', true);
    const at = rig.state.position;
    rig.step(FORWARD, 59);
    expect(rig.state.traversal).toBe('climb');
    expect(rig.state.climb?.slipping).toBe(59);
    expect(rig.state.position).toEqual(at);
    rig.step(FORWARD);
    expect(rig.state.traversal).toBeNull();
  });

  it('a surface that freezes slips unless the climber has ice tools; a thaw resets the grace', () => {
    const rig = new Rig([tower(), ladder()], { feet: v(1, 0, 0) });
    rig.until(FORWARD, climbing);
    assignProperty(rig.world, rig.piece(2), 'frozen', true);
    rig.step(FORWARD, 30);
    expect(rig.state.climb?.slipping).toBe(30);
    assignProperty(rig.world, rig.piece(2), 'frozen', false);
    rig.step(FORWARD);
    expect(rig.state.climb?.slipping).toBe(0);

    const iced = new Rig([tower(), ladder()], {
      feet: v(1, 0, 0),
      capabilities: [CLIMB_ICE_CAPABILITY],
    });
    assignProperty(iced.world, iced.piece(2), 'frozen', true);
    iced.until(FORWARD, climbing);
    const from = iced.state.position.y;
    iced.step(FORWARD, 30);
    expect(iced.state.traversal).toBe('climb');
    expect(iced.state.position.y).toBeGreaterThan(from);
  });

  it('a frozen ladder cannot be caught at all without ice tools', () => {
    const rig = new Rig([tower(), ladder()], { feet: v(1, 0, 0) });
    assignProperty(rig.world, rig.piece(2), 'frozen', true);
    rig.step(FORWARD, 60);
    expect(rig.modes()).toEqual([null]);
  });

  it('losing the capability a surface needs drops the climber', () => {
    const caps: string[] = [CLIMB_ROUGH_CAPABILITY];
    const rig = new Rig([tower(ROUGH)], { feet: v(1.6, 0, 0), capabilities: caps });
    rig.step(input({ forward: 1, jump: true }));
    expect(rig.state.traversal).toBe('climb');
    caps.pop();
    rig.step(FORWARD);
    expect(rig.state.traversal).toBeNull();
  });

  it('AC-4: a rope spawned at runtime climbs exactly like an authored one', () => {
    const authored = new Rig([ropePiece(2, 0, 0, 4)], { feet: v(1, 0, 0) });
    expect(authored.world.get(authored.piece(1), ClimbRopeComponent)).toEqual({
      anchor: v(2, 4, 0),
      length: 4,
    });
    const spawned = new Rig([], { feet: v(1, 0, 0) });
    const rope = spawnRope(spawned.world, { anchor: v(2, 4, 0), length: 4 });
    const script = (rig: Rig) => {
      rig.step(FORWARD, 90);
      rig.step(BACK, 20);
      rig.step(input({ forward: 1, right: 1 }), 20);
    };
    script(authored);
    script(spawned);
    expect(spawned.modes()).toEqual([null, 'climb']);
    expect(spawned.state.climb?.surface).toBe(rope);
    const strip = (s: CharacterState) => ({ ...s, climb: { ...s.climb, surface: 0 } });
    expect(spawned.trace.map(strip)).toEqual(authored.trace.map(strip));
    // Up the rope at 1.0 m/s on its side facing the climber, never sideways.
    const onIt = spawned.trace.filter(climbing);
    for (const s of onIt) {
      expect(s.position.x).toBeCloseTo(2 - 0.35 - 2 * SKIN, 9);
      expect(s.position.z).toBeCloseTo(0, 9);
    }
  });

  it('a rope stops the hands at its anchor (with no ledge there) and at its end', () => {
    const rig = new Rig([], { feet: v(1, 0, 0) });
    spawnRope(rig.world, { anchor: v(2, 3, 0), length: 1.5 });
    rig.step(FORWARD);
    rig.until(FORWARD, climbing);
    rig.step(FORWARD, 120);
    expect(rig.state.position.y).toBeCloseTo(3 - 2, 9);
    // Down again: the floor stops the climber before the hands reach the rope's end.
    rig.step(BACK, 120);
    expect(rig.state.traversal).toBeNull();
    expect(rig.state.grounded).toBe(true);
  });

  it('a rope that ends high is climbed down only until the hands reach its end', () => {
    const rig = new Rig([], { feet: v(1.63, 3.5, 0) });
    const rope = spawnRope(rig.world, { anchor: v(2, 6, 0), length: 1 });
    // Falling past it, pressing towards it: caught in the air.
    rig.until(FORWARD, climbing);
    expect(rig.state.climb?.surface).toBe(rope);
    rig.step(BACK, 120);
    expect(rig.state.traversal).toBe('climb');
    expect(rig.state.position.y).toBeCloseTo(6 - 1 - 2, 9);
  });

  it('a rope right overhead is caught by any press, and its climber follows its anchor', () => {
    const rig = new Rig([block([3.5, 0, -2], [4, 3, 2])], { feet: v(2, 0, 0) });
    const rope = spawnRope(rig.world, { anchor: v(2, 4, 0), length: 4 });
    rig.step(IDLE_INPUT);
    rig.step(input({ right: 1 }));
    expect(rig.state.traversal).toBe('climb');
    // Pressing right (+z) grabs it from the near side: hanging on −z of the line.
    const n = rig.state.climb?.normal ?? v(1, 1, 1);
    expect(n.x).toBeCloseTo(0, 9);
    expect(n.z).toBeCloseTo(-1, 9);
    expect(rig.state.position.z).toBeCloseTo(-(0.35 + 2 * SKIN), 9);
    rig.world.set(rope, ClimbRopeComponent, { anchor: v(2.5, 4, 0.5), length: 4 });
    rig.step(IDLE_INPUT);
    expect(rig.state.position.x).toBeCloseTo(2.5, 9);
    expect(rig.state.position.z).toBeCloseTo(0.5 - 0.37, 9);
    // A swing into a wall stops the climber where it is.
    rig.world.set(rope, ClimbRopeComponent, { anchor: v(5, 4, 0.5), length: 4 });
    const at = rig.state.position;
    rig.step(IDLE_INPUT);
    expect(rig.state.position).toEqual(at);
  });

  it('ropes out of reach, behind, too high or already gone are not caught', () => {
    const far = new Rig([], { feet: v(1, 0, 0) });
    spawnRope(far.world, { anchor: v(3, 4, 0), length: 4 });
    far.step(input({ forward: 0.001 }), 3);
    expect(far.modes()).toEqual([null]);

    const behind = new Rig([], { feet: v(2.5, 0, 0) });
    spawnRope(behind.world, { anchor: v(2, 4, 0), length: 4 });
    behind.step(IDLE_INPUT);
    behind.step(input({ forward: 0.001 }), 3);
    expect(behind.modes()).toEqual([null]);

    const high = new Rig([], { feet: v(1.5, 0, 0) });
    spawnRope(high.world, { anchor: v(2, 6, 0), length: 1 });
    high.step(IDLE_INPUT);
    high.step(FORWARD, 30);
    expect(high.modes()).toEqual([null]);

    const burnt = new Rig([], { feet: v(1.5, 0, 0) });
    const rope = spawnRope(burnt.world, { anchor: v(2, 4, 0), length: 4 });
    burnt.step(IDLE_INPUT);
    assignProperty(burnt.world, rope, 'climbable', 'none');
    burnt.step(FORWARD, 30);
    expect(burnt.modes()).toEqual([null]);

    // Two ropes in reach: the nearer is taken.
    const two = new Rig([], { feet: v(1.5, 0, 0) });
    spawnRope(two.world, { anchor: v(1.9, 4, 0.3), length: 4 });
    const near = spawnRope(two.world, { anchor: v(1.9, 4, 0), length: 4 });
    two.step(IDLE_INPUT);
    two.step(FORWARD);
    expect(two.state.climb?.surface).toBe(near);
  });

  it('a rope whose climbing place is blocked is not caught, and a line without the rope grade is no rope', () => {
    const tuning = { ...TUNED, climb: { ...DEFAULT_CLIMB_TUNING, reach: 1 } };
    // A beam at head height between the climber and the rope: no room to hang on it.
    const rig = new Rig([block([1.5, 1.7, -2], [1.8, 3, 2])], { feet: v(1, 0, 0), tuning });
    spawnRope(rig.world, { anchor: v(2.05, 4, 0), length: 4 });
    rig.step(IDLE_INPUT);
    rig.step(FORWARD);
    expect(rig.modes()).toEqual([null]);

    const plain = new Rig([], { feet: v(1.5, 0, 0) });
    makeRope(plain.world, plain.world.spawn(), { anchor: v(1.9, 4, 0), length: 4 });
    plain.step(IDLE_INPUT);
    plain.step(FORWARD, 5);
    expect(plain.modes()).toEqual([null]);
  });

  it('AC-5: stamina running out while climbing makes the climber slip and fall', () => {
    const rig = new Rig([tower(), ladder()], { feet: v(1, 0, 0) });
    rig.stamina = 10;
    rig.until(FORWARD, climbing);
    rig.step(FORWARD, 20);
    expect(rig.state.traversal).toBe('climb');
    const high = rig.state.position.y;
    rig.stamina = 0;
    rig.step(FORWARD);
    expect(rig.state.traversal).toBeNull();
    expect(rig.state.grounded).toBe(false);
    rig.step(IDLE_INPUT, 5);
    expect(rig.state.position.y).toBeLessThan(high);
    // And an empty bar cannot catch on again.
    rig.until(FORWARD, (s) => s.grounded);
    rig.step(FORWARD, 20);
    expect(rig.state.traversal).toBeNull();
  });

  it('jump pushes off the surface; crouch lets go', () => {
    const jumper = new Rig([tower(), ladder()], { feet: v(1, 0, 0) });
    jumper.until(FORWARD, climbing);
    jumper.step(FORWARD, 30);
    jumper.step(input({ jump: true }));
    expect(jumper.state.traversal).toBeNull();
    expect(jumper.state.velocity).toEqual(v(-4, 5, 0));

    const dropper = new Rig([tower(), ladder()], { feet: v(1, 0, 0) });
    dropper.until(FORWARD, climbing);
    dropper.step(FORWARD, 30);
    dropper.step(input({ crouch: true }));
    expect(dropper.state.traversal).toBeNull();
    expect(dropper.state.velocity).toEqual(v(0, 0, 0));
  });

  it('a blow knocks the climber off, keeping the launch', () => {
    const rig = new Rig([tower(), ladder()], { feet: v(1, 0, 0) });
    rig.until(FORWARD, climbing);
    rig.state = impelCharacter(rig.state, { velocity: v(-6, 2, 0), stagger: true });
    rig.step(FORWARD);
    expect(rig.state.traversal).toBeNull();
    expect(rig.state.velocity.x).toBeLessThan(-5);
  });

  it('climbing down onto the floor stands the climber on it', () => {
    const rig = new Rig([tower(), ladder()], { feet: v(1, 0, 0) });
    rig.until(FORWARD, climbing);
    rig.step(FORWARD, 30);
    rig.until(BACK, (s) => s.traversal === null);
    expect(rig.state.grounded).toBe(true);
    expect(rig.state.position.y).toBeCloseTo(SKIN, 6);
    expect(rig.state.climb).toBeUndefined();
    // Still pressing back, it walks away (not back onto the ladder).
    rig.step(BACK, 20);
    expect(rig.modes()).toEqual([null, 'climb', null]);
    expect(rig.state.position.x).toBeLessThan(1.4);
  });

  it('moves sideways along the surface and stops where the hands run out of it', () => {
    const rig = new Rig([tower(ROUGH)], { feet: v(1.6, 0, 1), capabilities: CLIMBER });
    rig.step(input({ forward: 1, jump: true }));
    rig.step(FORWARD, 30);
    const from = rig.state.position;
    rig.step(input({ right: 1 }), 30);
    expect(rig.state.position.z - from.z).toBeCloseTo(0.8 * 30 * DT, 9);
    expect(rig.state.position.y).toBe(from.y);
    // On to the 90° corner at z = 2: the hands leave the face, and the climber stops short.
    rig.step(input({ right: 1 }), 120);
    expect(rig.state.traversal).toBe('climb');
    expect(rig.state.position.z).toBeLessThanOrEqual(2);
    expect(rig.state.position.z).toBeGreaterThan(1.9);
  });

  it('does not climb from a holdable surface on to one the climber cannot hold', () => {
    // Ivy on a stone wall: without verb.climb.rough the stone beside the ivy stops the climber.
    const rig = new Rig([tower(ROUGH), block([1.95, 0, -0.5], [2, 3, 0.5], IVY)], {
      feet: v(1, 0, 0),
    });
    rig.until(FORWARD, climbing);
    rig.step(FORWARD, 10);
    rig.step(input({ right: 1 }), 120);
    expect(rig.state.traversal).toBe('climb');
    expect(rig.state.climb?.surface).toBe(rig.piece(2));
    expect(rig.state.position.z).toBeLessThan(0.5);
    // With it, the climber carries on from the ivy on to the stone.
    const climber = new Rig([tower(ROUGH), block([1.95, 0, -0.5], [2, 3, 0.5], IVY)], {
      feet: v(1, 0, 0),
      capabilities: CLIMBER,
    });
    climber.until(FORWARD, climbing);
    climber.step(FORWARD, 10);
    climber.step(input({ right: 1 }), 90);
    expect(climber.state.climb?.surface).toBe(climber.piece(1));
    expect(climber.state.position.x).toBeCloseTo(2 - 0.37, 9);
  });

  it('anything in the way stops the climber (a ceiling over the hands)', () => {
    const rig = new Rig([tower(), ladder(), block([0, 2.6, -2], [1.9, 3, 2])], {
      feet: v(1, 0, 0),
      noLedges: true,
    });
    rig.until(FORWARD, climbing);
    rig.step(FORWARD, 120);
    expect(rig.state.traversal).toBe('climb');
    // The hands (2 m above the feet, over the head) meet the ceiling first.
    expect(rig.state.position.y + 2).toBeLessThanOrEqual(2.6);
    expect(rig.state.position.y + 2).toBeGreaterThan(2.5);
  });

  it('without the ledge hook (or with no room on top) the climber stops at the top', () => {
    const rig = new Rig([tower(), ladder()], { feet: v(1, 0, 0), noLedges: true });
    rig.until(FORWARD, climbing);
    rig.step(FORWARD, 240);
    expect(rig.state.traversal).toBe('climb');
    // The hands reach no higher than the top of the ladder.
    expect(rig.state.position.y + 2).toBeLessThanOrEqual(3);
    expect(rig.state.position.y + 2).toBeGreaterThan(2.97);

    const low = new Rig([tower(), ladder(), block([2, 3, -2], [4, 3.5, 2])], { feet: v(1, 0, 0) });
    low.until(FORWARD, climbing);
    low.step(FORWARD, 240);
    expect(low.state.traversal).toBe('climb');
  });

  it('short climbables are for mantling, not climbing: the hands must reach the surface to attach', () => {
    const rig = new Rig([block([2, 0, -2], [4, 1.5, 2], { climbable: 'ivy' })], {
      feet: v(1, 0, 0),
      noLedges: true,
    });
    rig.step(FORWARD, 60);
    expect(rig.modes()).toEqual([null]);
  });

  it('attaches nowhere without a press, while launched or rolling, or where the capsule will not fit', () => {
    const idle = new Rig([tower(), ladder()], { feet: v(1.5, 0, 0) });
    idle.step(IDLE_INPUT, 10);
    expect(idle.modes()).toEqual([null]);

    const rolling = new Rig([tower(), ladder()], { feet: v(1.5, 0, 0) });
    rolling.step({ ...FORWARD, motion: v(3, 0, 0) }, 10);
    expect(rolling.modes()).toEqual([null]);

    const thrown = new Rig([tower(), ladder()], { feet: v(1, 0, 0) });
    thrown.state = impelCharacter(thrown.state, { velocity: v(3, 1, 0), stagger: true });
    thrown.step(FORWARD);
    expect(thrown.state.traversal).toBeNull();
    // Staggered on landing: still no attach until the recovery is over.
    thrown.until(FORWARD, (s) => s.recovery !== undefined);
    expect(thrown.state.traversal).toBeNull();

    // A low step in front of the ladder: pulled in to the face, the capsule would stand in it.
    const tight = new Rig([tower(), ladder(), block([1.66, 0, -2], [1.8, 0.5, 2])], {
      feet: v(1.3, 0, 0),
      noLedges: true,
    });
    tight.step(FORWARD, 20);
    expect(tight.modes()).toEqual([null]);
  });

  it('only near-vertical faces of pieces are climbed: not ramps, not unbound geometry', () => {
    const shapes = new FakeCollisionWorld([
      { kind: 'box', min: v(-20, -0.2, -20), max: v(20, 0, 20) },
      { kind: 'box', min: v(2, 0, -2), max: v(4, 3, 2) },
    ]);
    const unbound = new Rig([], { feet: v(1, 0, 0), collision: shapes, capabilities: CLIMBER });
    unbound.step(input({ forward: 1, jump: true }));
    unbound.step(FORWARD, 30);
    expect(unbound.modes()).toEqual([null]);

    const ramp = new Rig(
      [
        {
          // A 45° slope rising east from x = 2: its face leans too far back to climb.
          spec: { piece: { id: 'wedge' }, at: [3.5, 0, 0], yaw: 90, scale: [4, 3, 3] },
          properties: { climbable: 'ivy' },
        },
      ],
      { feet: v(0, 0, 0) },
    );
    ramp.step(FORWARD, 60);
    expect(ramp.modes().includes('climb')).toBe(false);
  });

  it('follows a shallow outside corner and climbs on to a shallow inside corner, but not a sharp one', () => {
    // Two walls meeting at z = 0: west of the line a face along z (normal −x); the other turned.
    const turned = (degrees: number, inside: boolean, bBody: BodyId = 3) => {
      const world = new PlaneWorld();
      const a = radians(degrees);
      // Wall A covers z ≤ 0 with its face at x = 2.
      world.add({ point: v(2, 0, 0), normal: v(-1, 0, 0), along: v(0, 0, -1), span: 5, body: 2 });
      // Wall B leaves z = 0 turned by `a` (towards the climber when inside, away when outside).
      const turn = inside ? a : -a;
      const along = v(-sin(turn), 0, cos(turn));
      world.add({
        point: v(2, 0, 0),
        normal: v(-cos(turn), 0, -sin(turn)),
        along,
        span: 5,
        body: bBody,
      });
      return world;
    };
    const run = (
      degrees: number,
      inside: boolean,
      { bBody = 3, b = ROUGH, capabilities = CLIMBER } = {},
    ) => {
      const rig = new Rig([tower(ROUGH), tower(b)], {
        feet: v(1.6, 0, -1),
        capabilities,
        collision: turned(degrees, inside, bBody),
        noLedges: true,
      });
      rig.step(input({ forward: 1, jump: true }));
      expect(rig.state.traversal).toBe('climb');
      // Sideways as the camera sees it, the camera turning to face whatever face is climbed.
      for (let i = 0; i < 150; i++) {
        const n = rig.state.climb?.normal ?? v(-1, 0, 0);
        rig.step(input({ right: 1, yaw: atan2(n.x, n.z) }));
      }
      expect(rig.state.traversal).toBe('climb');
      return { rig, state: rig.state };
    };
    for (const inside of [false, true]) {
      const shallow = run(30, inside);
      expect(shallow.state.climb?.surface).toBe(shallow.rig.piece(2));
      const n = shallow.state.climb?.normal ?? v(0, 0, 0);
      expect(Math.abs(dot(n, v(-1, 0, 0)) - cos(radians(30)))).toBeLessThan(1e-9);
      expect(shallow.state.position.z).toBeGreaterThan(0.3);
      const sharp = run(60, inside);
      expect(sharp.state.climb?.surface).toBe(sharp.rig.piece(1));
      expect(sharp.state.position.z).toBeLessThan(0.1);
    }
    // A shallow inside corner on to geometry no piece owns, or a face the climber cannot hold
    // (stone marked climbable none): the climber stops at the corner.
    for (const blocked of [
      run(30, true, { bBody: 9 }),
      run(30, true, { b: { climbable: 'none' } }),
    ]) {
      expect(blocked.state.climb?.surface).toBe(blocked.rig.piece(1));
      expect(blocked.state.position.z).toBeLessThan(0.1);
    }
  });

  it('a hook with no capabilities or stamina given climbs ladders, but never rough walls', () => {
    const rig = new Rig([tower(), ladder()], { feet: v(1, 0, 0), minimal: true });
    rig.until(FORWARD, climbing);
    rig.step(FORWARD, 30);
    expect(rig.state.traversal).toBe('climb');
    const rough = new Rig([tower(ROUGH)], { feet: v(1.6, 0, 0), minimal: true });
    rough.step(input({ forward: 1, jump: true }));
    expect(rough.state.traversal).toBeNull();
  });

  it('a climb state that lost its surface data hands back to locomotion unless it can catch again', () => {
    const rig = new Rig([tower(), ladder()], { feet: v(1, 0, 0) });
    const hook = climbTraversal({ world: rig.world });
    const ctx = {
      world: rig.collision,
      tuning: TUNED,
      params: controllerParams(TUNED, new SimClock(HZ)),
      entity: PLAYER,
    };
    const lost = { ...rig.state, traversal: 'climb' as const };
    expect(hook.step({ ...ctx, state: lost, input: IDLE_INPUT }).traversal).toBeNull();
    rig.until(FORWARD, climbing);
    const fresh = { ...rig.state, position: v(1.5, 0, 0) };
    delete (fresh as { climb?: unknown }).climb;
    const caught = hook.step({ ...ctx, state: fresh, input: FORWARD });
    expect(caught.traversal).toBe('climb');
    expect(caught.climb?.surface).toBe(rig.piece(2));
  });

  it('two ropes equally near: the one spawned first is caught', () => {
    const rig = new Rig([], { feet: v(1.5, 0, 0) });
    const first = spawnRope(rig.world, { anchor: v(1.9, 4, 0.1), length: 4 });
    spawnRope(rig.world, { anchor: v(1.9, 4, -0.1), length: 4 });
    rig.step(IDLE_INPUT);
    rig.step(FORWARD);
    expect(rig.state.climb?.surface).toBe(first);
  });

  it('from a rope the climber pulls up onto a ledge at its anchor, unless that ledge is burning', () => {
    const run = (burning: boolean) => {
      const rig = new Rig([block([2, 0, -2], [4, 3, 2])], { feet: v(1, 0, 0) });
      spawnRope(rig.world, { anchor: v(1.6, 3, 0), length: 3 });
      if (burning) assignProperty(rig.world, rig.piece(1), 'burning', true);
      rig.until(FORWARD, climbing);
      if (burning) rig.step(FORWARD, 150);
      else rig.until(FORWARD, (s) => s.traversal === null && s.grounded);
      return rig;
    };
    const over = run(false);
    expect(over.modes()).toEqual([null, 'climb', 'mantle', null]);
    expect(over.state.position.y).toBeCloseTo(3 + SKIN, 9);
    const held = run(true);
    expect(held.modes()).toEqual([null, 'climb']);
    expect(held.state.position.y).toBeCloseTo(1, 9);
  });

  it('at the top only a ledge of the climbed face, within reach and with room on top, is pulled up onto', () => {
    // A free-standing ladder (no room on top of it), a block behind the climber (its ledges face
    // the other way or lie behind) and a tower 1 m past the ladder (its ledge is out of reach).
    const rig = new Rig(
      [ladder(), block([0.6, 0, -2], [0.8, 3, 2]), block([3, 0, -2], [4, 3, 2])],
      { feet: v(1.2, 0, 0) },
    );
    rig.until(FORWARD, climbing);
    rig.step(FORWARD, 180);
    expect(rig.modes()).toEqual([null, 'climb']);
    expect(rig.state.position.y + 2).toBeGreaterThan(2.97);
  });

  it('a beam over the head (clear of the hands) stops the climber', () => {
    const rig = new Rig([tower(), ladder(), block([1, 2.3, -2], [1.3, 2.6, 2])], {
      feet: v(1, 0, 0),
      noLedges: true,
    });
    rig.until(FORWARD, climbing);
    rig.step(FORWARD, 120);
    expect(rig.state.traversal).toBe('climb');
    expect(rig.state.position.y + 1.8).toBeLessThanOrEqual(2.3);
    expect(rig.state.position.y + 1.8).toBeGreaterThan(2.1);
  });

  it('uses the sim’s climb defaults when the profile has no climb block, and works without ropes', () => {
    const rig = new Rig([tower(), ladder()], { feet: v(1, 0, 0), tuning: BASE, noRopes: true });
    rig.until(FORWARD, climbing);
    const from = rig.state.position.y;
    rig.step(FORWARD, 30);
    expect(rig.state.position.y - from).toBeCloseTo(1.2 * 30 * DT, 9);
  });

  it('rope helpers refuse a rope of no length', () => {
    const world = registerWorldProperties(new World<never>({ seed: 1 })).register(
      ClimbRopeComponent,
    );
    expect(() => spawnRope(world, { anchor: v(0, 3, 0), length: 0 })).toThrow(RangeError);
    expect(() => {
      makeRope(world, world.spawn(), { anchor: v(0, 3, 0), length: Number.NaN });
    }).toThrow(/longer than 0 m/);
    const rope = spawnRope(world, { anchor: v(0, 3, 0), length: 2 }, { flammable: true });
    expect(world.get(rope, ClimbRopeComponent)).toEqual({ anchor: v(0, 3, 0), length: 2 });
  });
});

const radians = (degrees: number) => (degrees * Math.PI) / 180;

/** A vertical wall: a face through `point` with outward `normal`, `span` metres along `along`. */
interface Plane {
  readonly point: Vec3;
  readonly normal: Vec3;
  readonly along: Vec3;
  readonly span: number;
  readonly body: BodyId;
}

/**
 * A CollisionWorld of a floor at y = 0 and one-sided vertical walls from 0 to 10 m high, for corners
 * the axis-aligned fake cannot build. Rays hit a wall's face from its front; sweeps move the
 * capsule's middle circle against the faces (down: a ray to the floor); nothing overlaps.
 */
class PlaneWorld implements CollisionWorld {
  private readonly planes: Plane[] = [];

  add(plane: Plane): void {
    this.planes.push(plane);
  }

  raycast(origin: Vec3, direction: Vec3, maxDistance: number): CollisionHit | undefined {
    let best: CollisionHit | undefined;
    const consider = (hit: CollisionHit) => {
      if (best === undefined || hit.distance < best.distance) best = hit;
    };
    if (direction.y < 0) {
      const s = -origin.y / direction.y;
      if (s >= 0 && s <= maxDistance) {
        consider({
          distance: s,
          normal: v(0, 1, 0),
          point: add(origin, scale(direction, s)),
          body: 1,
        });
      }
    }
    for (const plane of this.planes) {
      const rate = dot(plane.normal, direction);
      if (rate >= 0) continue;
      const s = dot(plane.normal, sub(plane.point, origin)) / rate;
      if (s < 0 || s > maxDistance) continue;
      const point = add(origin, scale(direction, s));
      const t = dot(sub(point, plane.point), plane.along);
      if (t < 0 || t > plane.span || point.y < 0 || point.y > 10) continue;
      consider({ distance: s, normal: plane.normal, point, body: plane.body });
    }
    return best;
  }

  sweepCapsule(
    capsule: { radius: number; height: number },
    feet: Vec3,
    direction: Vec3,
    maxDistance: number,
  ): CollisionHit | undefined {
    const middle = add(feet, v(0, capsule.height / 2, 0));
    // Down: a ray to the floor from the middle, pulled back by half the height.
    if (direction.y < 0) {
      const reach = capsule.height / 2;
      const hit = this.raycast(middle, direction, maxDistance + reach);
      if (hit === undefined) return undefined;
      return { ...hit, distance: Math.max(0, hit.distance - reach) };
    }
    // Otherwise the capsule's middle circle against the walls: where it first touches a face.
    let best: CollisionHit | undefined;
    for (const plane of this.planes) {
      const rate = dot(plane.normal, direction);
      if (rate >= 0) continue;
      const gap = dot(plane.normal, sub(middle, plane.point)) - capsule.radius;
      const s = gap / -rate;
      if (s < 0 || s > maxDistance) continue;
      const point = sub(add(middle, scale(direction, s)), scale(plane.normal, capsule.radius));
      const t = dot(sub(point, plane.point), plane.along);
      if (t < 0 || t > plane.span) continue;
      if (best === undefined || s < best.distance) {
        best = { distance: s, normal: plane.normal, point, body: plane.body };
      }
    }
    return best;
  }

  overlapCapsule(): boolean {
    return false;
  }

  bodyVelocity(): Vec3 {
    return v(0, 0, 0);
  }
}

describe('grabbing while carrying (mw-e17.14)', () => {
  /** A rig whose character carries a body: a real ledger holds it, and the hooks ask `refuseGrab`. */
  function carrier(pieces: readonly Piece[], feet: Vec3) {
    const rig: { value?: Rig } = {};
    const refused: GrabRefused[] = [];
    const handsFull = (entity: EntityId | undefined) => {
      const world = rig.value?.world;
      return world !== undefined && refuseGrab(world, entity, 'climb');
    };
    const made = new Rig(pieces, { feet, handsFull });
    rig.value = made;
    made.world.events.on(grabRefused, (e) => refused.push(e));
    made.world.register(CarryLedgerComponent);
    const ledger = made.world.spawn();
    made.world.add(ledger, CarryLedgerComponent, {
      holds: [
        {
          actor: PLAYER,
          target: made.world.spawn(),
          mode: 'shoulder',
          since: 0,
          speedScale: 0.5,
          noJump: true,
          charge: -1,
          burning: 0,
        },
      ],
    });
    return { rig: made, refused, ledger };
  }

  it('AC-2: carrying a body, walking into a ladder is refused "hands-full" and the body stays carried', () => {
    const { rig, refused, ledger } = carrier([tower(), ladder()], v(1, 0, 0));
    const before = rig.world.get(ledger, CarryLedgerComponent);
    rig.step(FORWARD, 90);
    expect(rig.modes()).toEqual([null]);
    rig.world.events.flush();
    expect(refused).toEqual([
      { tick: rig.world.tick, actor: PLAYER, grab: 'climb', reason: 'hands-full' },
    ]);
    // Held presses are one refusal, not one per tick, and the hold is untouched.
    expect(rig.world.get(ledger, CarryLedgerComponent)).toBe(before);
    expect(holdOf(rig.world, PLAYER)?.mode).toBe('shoulder');
  });

  it('AC-2: an empty-handed climber still takes the same ladder, and a new refusal starts after a pause', () => {
    const free = new Rig([tower(), ladder()], { feet: v(1, 0, 0) });
    free.until(FORWARD, climbing);
    const { rig, refused } = carrier([tower(), ladder()], v(1, 0, 0));
    rig.step(FORWARD, 90);
    rig.world.events.flush();
    expect(refused).toHaveLength(1);
    // Letting go of the press for a while and pressing again is a new refusal.
    for (let i = 0; i < 5; i++) rig.world.step();
    rig.step(IDLE_INPUT, 1);
    rig.step(FORWARD, 3);
    rig.world.events.flush();
    expect(refused).toHaveLength(2);
    expect(refuseGrab(rig.world, undefined, 'ledge')).toBe(false);
  });

  it('AC-2: carrying, a rope and a ledge are refused too', () => {
    const rope = carrier([ropePiece(2, 0, 0, 3)], v(1.5, 0, 0));
    rope.rig.step(FORWARD, 60);
    expect(rope.rig.modes()).toEqual([null]);
    // A low step: without the load it mantles, loaded it does not.
    const step = block([2, 0, -2], [4, 0.5, 2]);
    const free = new Rig([step], { feet: v(1, 0, 0) });
    free.step(FORWARD, 90);
    expect(free.modes()).toContain('mantle');
    const loaded = new Rig([step], {
      feet: v(1, 0, 0),
      handsFull: () => true,
    });
    loaded.step(FORWARD, 90);
    expect(loaded.modes()).toEqual([null]);
  });
});

describe('climb difficulty and refusals (mw-e10.9)', () => {
  /** Content's capability grants, as the game builds them: the thief's rough verb reaches 3. */
  const GRANTS = new Map([[CLIMB_ROUGH_CAPABILITY, 3]]);
  const rough = () => tower(ROUGH);

  function refusals(rig: Rig): ClimbRefused[] {
    const seen: ClimbRefused[] = [];
    rig.world.events.on(climbRefused, (event) => seen.push(event));
    return seen;
  }

  it('AC-1: a thief with max climb difficulty 3 jumps at a difficulty-2 wall and enters Climbing', () => {
    const capabilities = [CLIMB_ROUGH_CAPABILITY];
    const max = maxClimbDifficulty(capabilities, GRANTS);
    expect(max).toBe(3);
    const rig = new Rig([rough()], {
      feet: v(1.6, 0, 0),
      capabilities,
      maxDifficulty: () => max,
    });
    const seen = refusals(rig);
    rig.step(input({ forward: 1, jump: true }));
    expect(rig.state.traversal).toBe('climb');
    rig.world.events.flush();
    expect(seen).toEqual([]);
  });

  it('AC-2: a knight with max climb difficulty 1 is refused the same wall, with a reason prompt', () => {
    const max = maxClimbDifficulty([], GRANTS);
    expect(max).toBe(1);
    // Even holding the rough capability (a learned trick), difficulty 2 is past its best.
    const rig = new Rig([rough()], {
      feet: v(1.6, 0, 0),
      capabilities: [CLIMB_ROUGH_CAPABILITY],
      maxDifficulty: () => max,
    });
    const seen = refusals(rig);
    rig.step(input({ forward: 1, jump: true }));
    expect(rig.state.traversal).toBeNull();
    rig.step(input({ forward: 1, jump: true }), 5);
    rig.world.events.flush();
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      actor: PLAYER,
      surface: rig.piece(1),
      refusal: { reason: 'too-difficult', difficulty: 2, max: 1 },
      text: CLIMB_REFUSAL_TEXT['too-difficult'],
    });
  });

  it('AC-2: a knight bumping the wall without a jump is not nagged, and a ladder is no refusal', () => {
    const knight = new Rig([rough(), ladder()], { feet: v(1.6, 0, 0), maxDifficulty: () => 1 });
    const seen = refusals(knight);
    knight.step(FORWARD, 30);
    knight.world.events.flush();
    expect(seen).toEqual([]);
    const free = new Rig([tower(), ladder()], { feet: v(1, 0, 0), maxDifficulty: () => 1 });
    free.until(FORWARD, climbing);
  });

  it('AC-2: a knight without the capability is told it does not know how, a rope refuses the same way', () => {
    const rig = new Rig([rough()], { feet: v(1.6, 0, 0) });
    const seen = refusals(rig);
    rig.step(input({ forward: 1, jump: true }));
    rig.world.events.flush();
    expect(seen.map((event) => event.refusal.reason)).toEqual(['needs-capability']);
    // Frozen rope: slippery, refused the same way (no ice tools).
    const frozen = new Rig([ropePiece(2, 0, 0, 3)], { feet: v(1.5, 0, 0) });
    const frozenSeen = refusals(frozen);
    assignProperty(frozen.world, frozen.piece(1), 'frozen', true);
    frozen.step(FORWARD, 3);
    frozen.world.events.flush();
    expect(frozenSeen.map((event) => event.refusal.reason)).toEqual(['slippery']);
    expect(frozen.state.traversal).toBeNull();
  });

  it('a character with no entity is refused silently (nobody to tell), and a rope needs a jump when ropes are not walked on', () => {
    const anonymous = new Rig([rough()], {
      feet: v(1.6, 0, 0),
      anonymous: true,
      maxDifficulty: () => 1,
    });
    const seen = refusals(anonymous);
    anonymous.step(input({ forward: 1, jump: true }), 5);
    anonymous.world.events.flush();
    expect(anonymous.state.traversal).toBeNull();
    expect(seen).toEqual([]);
    // Ropes are not in walkOn here: bumping one attaches nothing and refuses nothing.
    const tuning = { ...TUNED, climb: { ...DEFAULT_CLIMB_TUNING, walkOn: [] } };
    const rope = new Rig([ropePiece(2, 0, 0, 3)], { feet: v(1.5, 0, 0), tuning });
    const ropeSeen = refusals(rope);
    rope.step(FORWARD, 30);
    rope.world.events.flush();
    expect(rope.state.traversal).toBeNull();
    expect(ropeSeen).toEqual([]);
  });

  it('the best difficulty is read live: lowering it mid-climb lets go, and a burnt-out surface is no refusal', () => {
    let max = 3;
    const rig = new Rig([tower(ROUGH)], {
      feet: v(1.6, 0, 0),
      capabilities: CLIMBER,
      maxDifficulty: () => max,
    });
    rig.step(input({ forward: 1, jump: true }));
    rig.step(FORWARD, 10);
    expect(rig.state.traversal).toBe('climb');
    max = 1;
    rig.step(FORWARD, 2);
    expect(rig.state.traversal).toBeNull();
    const charred = new Rig([tower(ROUGH)], {
      feet: v(1.6, 0, 0),
      capabilities: CLIMBER,
      maxDifficulty: () => 3,
    });
    const seen = refusals(charred);
    assignProperty(charred.world, charred.piece(1), 'climbable', 'none');
    charred.step(input({ forward: 1, jump: true }), 3);
    charred.world.events.flush();
    expect(seen).toEqual([]);
  });

  it('climbing drains by difficulty: ladders and ropes 1×, rough stone 1.5×, sheer 2×', () => {
    const rig = new Rig([tower(), ladder(), rough()]);
    const rate = (n: number, tuning = DEFAULT_CLIMB_TUNING) =>
      climbDrainPerSecond(rig.world, rig.piece(n), tuning);
    expect(DEFAULT_STAMINA_BY_DIFFICULTY).toEqual([1, 1.5, 2]);
    expect(rate(2)).toBe(5);
    expect(rate(3)).toBe(7.5);
    assignProperty(rig.world, rig.piece(3), 'climbable', 'sheer');
    expect(rate(3)).toBe(10);
    expect(rate(3, { ...DEFAULT_CLIMB_TUNING, staminaByDifficulty: [1, 2, 4] })).toBe(20);
    // A surface that is no longer climbable (burnt away) drains the base rate.
    assignProperty(rig.world, rig.piece(3), 'climbable', 'none');
    expect(rate(3)).toBe(5);
  });
});
