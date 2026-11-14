// mw-e29.12: the awareness indicator over real creatures. A fixture guard is spawned with its real
// brain and the AI installed; its state and suspicion are set the way the alert machine leaves them,
// the game-side rules read them off the world and the Three.js renderer builds its objects headless
// (no GPU is needed to build them), so what is checked is what would be drawn.
import { describe, expect, it } from 'vitest';
import { Box3, Group, Mesh, PerspectiveCamera, Scene, type BufferGeometry } from 'three';
import { compileCreatures } from '@content/index';
import { loadFixtureContent } from '@content/test-fixtures';
import { markExercised } from '@content/testing';
import {
  BrainComponent,
  brainOf,
  buildFactionTable,
  compileBehaviours,
  factionSpecFromDef,
  installAi,
  installFactions,
  registerCreatureComponents,
  spawnCreature,
  World,
  type Brain,
  type EntityId,
} from '@sim/index';
import { AwarenessFx, INDICATOR_LIFT_M } from '@game/vfx/awareness-fx';
import { createAwarenessRenderer } from '@render/stealth/awareness';
import { INDICATOR_STYLES, shapeOutline } from '@render/stealth/indicator-shapes';

const fixtures = loadFixtureContent();

function guardWorld(): { world: World<never>; guard: EntityId } {
  const world = installFactions(registerCreatureComponents(new World<never>({ seed: 4 })));
  installAi(world, { behaviours: compileBehaviours(fixtures.all('behaviour')) });
  const spawned = spawnCreature(
    world,
    {
      creatures: compileCreatures(fixtures.all('creature'), fixtures),
      factions: buildFactionTable(fixtures.all('faction').map(factionSpecFromDef)),
    },
    { creature: 'fixture-guard', at: { x: 0, y: 0, z: 6 } },
  );
  if (!spawned.ok) throw new Error('the guard did not spawn');
  world.step();
  return { world, guard: spawned.entity };
}

/** The visible indicator groups of the renderer's object (each holds ink, backdrop and fill meshes). */
function visibleIndicators(scene: Scene): Group[] {
  const root = scene.getObjectByName('awareness');
  return (root?.children ?? []).filter(
    (child): child is Group =>
      child instanceof Group && child.visible && child.children.length === 3,
  );
}

function height(geometry: BufferGeometry): number {
  const box = new Box3().setFromBufferAttribute(geometry.getAttribute('position') as never);
  return box.max.y - box.min.y;
}

function rig(world: World<never>) {
  const now = 5_000;
  const fx = new AwarenessFx({ world, now: () => now });
  const scene = new Scene();
  const renderer = createAwarenessRenderer(scene);
  const camera = new PerspectiveCamera();
  camera.position.set(0, 2, 0);
  const draw = (): void => {
    fx.frame(camera.position);
    renderer.draw(fx.view, camera);
  };
  return { fx, scene, renderer, draw };
}

function brainOrThrow(world: World<never>, guard: EntityId): Brain {
  // The live component, which the test sets the way the alert machine would.
  const brain = world.get(guard, BrainComponent);
  if (brain === undefined) throw new Error('the guard has no brain');
  return brain;
}

describe('awareness indicators over real creatures (mw-e29.12)', () => {
  it('AC-1: a creature entering Suspicious with suspicion 0.4 shows the Suspicious shape filled 40%', ({
    task,
  }) => {
    markExercised(task, 'behaviour', 'fixture-guard');
    markExercised(task, 'creature', 'fixture-guard');
    const { world, guard } = guardWorld();
    const { scene, draw, fx, renderer } = rig(world);
    const brain = brainOrThrow(world, guard);
    // The way the alert machine leaves a creature that just crossed into Suspicious.
    brain.state = 'suspicious';
    brain.blackboard.awareness = 0.4;
    draw();
    expect(fx.view.indicators).toHaveLength(1);
    expect(fx.view.indicators[0]).toMatchObject({
      entity: guard,
      state: 'suspicious',
      shape: INDICATOR_STYLES.suspicious.shape,
      fill: 0.4,
    });
    expect(fx.view.indicators[0]?.y).toBeGreaterThan(INDICATOR_LIFT_M);
    // Rendered: one indicator, whose fill is 40% of the shape's height.
    expect(visibleIndicators(scene)).toHaveLength(1);
    const [group] = visibleIndicators(scene);
    const [ink, back, fill] = group?.children as [Mesh, Mesh, Mesh];
    expect(ink.geometry).toBe(back.geometry);
    expect(fill.visible).toBe(true);
    const ys = shapeOutline('disc').map((p) => p.y);
    const full = height(back.geometry);
    expect(full).toBeCloseTo(Math.max(...ys) - Math.min(...ys), 3);
    expect(height(fill.geometry) / full).toBeCloseTo(0.4, 2);
    // More suspicion fills it further.
    brain.blackboard.awareness = 0.55;
    draw();
    const more = visibleIndicators(scene)[0]?.children[2] as Mesh;
    expect(height(more.geometry) / full).toBeCloseTo(0.55, 2);
    renderer.dispose();
  });

  it('AC-2: a creature in the Unaware state shows no indicator', ({ task }) => {
    markExercised(task, 'behaviour', 'fixture-guard');
    markExercised(task, 'creature', 'fixture-guard');
    const { world, guard } = guardWorld();
    const { scene, draw, fx, renderer } = rig(world);
    expect(brainOf(world, guard)?.state).toBe('unaware');
    draw();
    expect(fx.view.indicators).toHaveLength(0);
    expect(visibleIndicators(scene)).toHaveLength(0);
    // And it disappears again when the creature stands down.
    const brain = brainOrThrow(world, guard);
    brain.state = 'alerted';
    draw();
    expect(visibleIndicators(scene)).toHaveLength(1);
    brain.state = 'unaware';
    draw();
    expect(visibleIndicators(scene)).toHaveLength(0);
    renderer.dispose();
  });

  it('draws every non-Unaware state with its own shape', ({ task }) => {
    markExercised(task, 'behaviour', 'fixture-guard');
    markExercised(task, 'creature', 'fixture-guard');
    const { world, guard } = guardWorld();
    const { draw, fx, renderer } = rig(world);
    const brain = brainOrThrow(world, guard);
    const seen = new Set<string>();
    for (const state of [
      'suspicious',
      'investigating',
      'searching',
      'alerted',
      'combat',
    ] as const) {
      brain.state = state;
      draw();
      seen.add(fx.view.indicators[0]?.shape ?? 'none');
    }
    expect(seen.size).toBe(5);
    renderer.dispose();
  });
});
