// mw-e27.8: fact-gated spawns and variant groups. The rule (which spawns exist for the facts) is pure
// and deterministic; `SpawnVariants` applies changes as facts change, holding back those on screen.
import { describe, expect, it } from 'vitest';
import { World } from '../core/world';
import { InMemoryColliderSink } from '../physics/static-colliders';
import type { Condition } from '../facts/conditions';
import { testKit } from './fixtures';
import {
  layoutScene,
  type SceneSpawnPlacement,
  type SceneSpawnSpec,
  type SceneSpec,
} from './layout';
import { loadScene, registerSceneComponents } from './loader';
import { presentSpawnIds, SpawnVariants } from './variants';

const spawn = (id: string, extra: Partial<SceneSpawnSpec> = {}): SceneSpawnSpec => ({
  id,
  at: [id.length, 0, 0],
  yaw: 0,
  tags: [],
  ...extra,
});

const sceneOf = (spawns: SceneSpawnSpec[]): SceneSpec => ({
  id: 'variant-test',
  grid: 1,
  placements: [],
  spawns,
});

const placements = (spawns: SceneSpawnSpec[]): readonly SceneSpawnPlacement[] =>
  layoutScene(sceneOf(spawns), testKit).spawns;

const fact = (key: string, extra: Partial<Condition> = {}): Condition => ({ fact: key, ...extra });

const MILLER = [
  spawn('miller-home', { variant: { group: 'miller', when: fact('miller.rescued') } }),
  spawn('miller-away', { variant: { group: 'miller', when: fact('miller.fled') } }),
  spawn('miller-gone', { variant: { group: 'miller' } }),
];

describe('presentSpawnIds', () => {
  it('lists ungated spawns always', () => {
    const world = new World({ seed: 1 });
    expect(presentSpawnIds(placements([spawn('a'), spawn('bb')]), world.facts)).toEqual([
      'a',
      'bb',
    ]);
  });

  it('spawnIf: the spawn exists only while its condition holds', () => {
    const world = new World({ seed: 1 });
    const spawns = placements([spawn('door', { spawnIf: fact('cellar.sealed') })]);
    expect(presentSpawnIds(spawns, world.facts)).toEqual([]);
    world.facts.set('cellar.sealed', true);
    expect(presentSpawnIds(spawns, world.facts)).toEqual(['door']);
  });

  it('despawnIf: the spawn is gone while its condition holds; with spawnIf, both must allow it', () => {
    const world = new World({ seed: 1 });
    const spawns = placements([
      spawn('a', { despawnIf: fact('gone') }),
      spawn('bb', { spawnIf: fact('on'), despawnIf: fact('gone') }),
    ]);
    expect(presentSpawnIds(spawns, world.facts)).toEqual(['a']);
    world.facts.set('on', true);
    expect(presentSpawnIds(spawns, world.facts)).toEqual(['a', 'bb']);
    world.facts.set('gone', true);
    expect(presentSpawnIds(spawns, world.facts)).toEqual([]);
  });

  it('AC-2: when several variants match, the first listed wins, every time', () => {
    const world = new World({ seed: 1 });
    const spawns = placements(MILLER);
    world.facts.set('miller.rescued', true);
    world.facts.set('miller.fled', true);
    for (let i = 0; i < 3; i++) {
      expect(presentSpawnIds(spawns, world.facts)).toEqual(['miller-home']);
    }
    world.facts.set('miller.rescued', false);
    expect(presentSpawnIds(spawns, world.facts)).toEqual(['miller-away']);
    world.facts.set('miller.fled', false);
    expect(presentSpawnIds(spawns, world.facts)).toEqual(['miller-gone']);
  });

  it('a group with no default has no active variant when none matches', () => {
    const world = new World({ seed: 1 });
    const spawns = placements(MILLER.slice(0, 2));
    expect(presentSpawnIds(spawns, world.facts)).toEqual([]);
  });

  it('the chosen variant is still held back by its own spawnIf; the others do not take over', () => {
    const world = new World({ seed: 1 });
    const spawns = placements([
      spawn('x', { variant: { group: 'g' }, spawnIf: fact('on') }),
      spawn('yy', { variant: { group: 'g' } }),
    ]);
    expect(presentSpawnIds(spawns, world.facts)).toEqual([]);
    world.facts.set('on', true);
    expect(presentSpawnIds(spawns, world.facts)).toEqual(['x']);
  });
});

describe('loadScene with gated spawns', () => {
  it('leaves out spawns whose gate is closed and keeps them in authoredSpawns', () => {
    const world = registerSceneComponents(new World({ seed: 1 }));
    const loaded = loadScene(
      world,
      sceneOf([spawn('a'), spawn('door', { spawnIf: fact('cellar.sealed') })]),
      testKit,
      new InMemoryColliderSink(),
    );
    expect(loaded.layout.spawns.map((s) => s.id)).toEqual(['a']);
    expect(loaded.spawns.map((s) => s.spawn.id)).toEqual(['a']);
    expect(loaded.authoredSpawns.map((s) => s.id)).toEqual(['a', 'door']);
    expect(loaded.authoredSpawns[1]?.gate).toEqual({ spawnIf: fact('cellar.sealed') });
  });
});

describe('SpawnVariants', () => {
  const setup = (inView: (id: string) => boolean = () => false, extra: SceneSpawnSpec[] = []) => {
    const world = new World({ seed: 1 });
    const spawns = placements([
      spawn('door', {
        spawnIf: fact('miller.rescued'),
        ...(extra.length > 0 && { swapInView: true }),
      }),
      ...extra,
    ]);
    const applied: string[] = [];
    const variants = new SpawnVariants(world, spawns, [], {
      inView: (position) => inView(String(position.x)),
      apply: (s, present) => applied.push(`${s.id}:${String(present)}`),
    });
    const flip = (value: boolean): void => {
      world.facts.set('miller.rescued', value);
      world.events.flush();
    };
    return { world, variants, applied, flip };
  };

  it('AC-1: spawns when the fact turns true out of view', () => {
    const { variants, applied, flip } = setup();
    expect(variants.step()).toEqual([]);
    flip(true);
    expect(variants.step()).toEqual(['door']);
    expect(applied).toEqual(['door:true']);
    expect(variants.isPresent('door')).toBe(true);
  });

  it('AC-1: in view it waits, and spawns once it is out of view', () => {
    let visible = true;
    const { variants, applied, flip } = setup(() => visible);
    flip(true);
    expect(variants.step()).toEqual([]);
    expect(variants.pending()).toEqual(['door']);
    expect(variants.step()).toEqual([]);
    expect(applied).toEqual([]);
    visible = false;
    expect(variants.step()).toEqual(['door']);
    expect(variants.pending()).toEqual([]);
    expect(applied).toEqual(['door:true']);
  });

  it('a change that flips back while waiting is never applied', () => {
    const { variants, applied, flip } = setup(() => true);
    flip(true);
    variants.step();
    flip(false);
    expect(variants.step()).toEqual([]);
    expect(variants.pending()).toEqual([]);
    expect(applied).toEqual([]);
  });

  it('swapInView lets a change happen on screen', () => {
    const extra = [spawn('other')];
    const { variants, applied, flip } = setup(() => true, extra);
    flip(true);
    expect(variants.step()).toEqual(['door']);
    expect(applied).toEqual(['door:true']);
  });

  it('takes a spawn away when its gate closes, and ignores unrelated facts', () => {
    const { world, variants, applied, flip } = setup();
    flip(true);
    variants.step();
    world.facts.set('unrelated', true);
    world.events.flush();
    expect(variants.step()).toEqual([]);
    flip(false);
    expect(variants.step()).toEqual(['door']);
    expect(applied).toEqual(['door:true', 'door:false']);
  });

  it('swaps a variant group: the old one goes and the new one comes, in scene order', () => {
    const world = new World({ seed: 1 });
    const spawns = placements(MILLER);
    const applied: string[] = [];
    const variants = new SpawnVariants(world, spawns, ['miller-gone'], {
      apply: (s, present) => applied.push(`${s.id}:${String(present)}`),
    });
    world.facts.set('miller.rescued', true);
    world.events.flush();
    expect(variants.step()).toEqual(['miller-home', 'miller-gone']);
    expect(applied).toEqual(['miller-home:true', 'miller-gone:false']);
    variants.dispose();
    world.facts.set('miller.rescued', false);
    world.events.flush();
    expect(variants.step()).toEqual([]);
  });

  it('several changes before a step are applied together', () => {
    const { world, variants, applied, flip } = setup();
    flip(true);
    world.facts.set('miller.rescued', false);
    world.facts.set('miller.rescued', true);
    world.events.flush();
    expect(variants.step()).toEqual(['door']);
    expect(applied).toEqual(['door:true']);
  });
});
