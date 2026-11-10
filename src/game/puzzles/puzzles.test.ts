import { describe, expect, it } from 'vitest';
import { loadGameContent } from '@content/index';
import {
  addProperties,
  capabilityUsed,
  registerSceneComponents,
  registerWorldProperties,
  setProperty,
  spawnSceneSpawn,
  World,
} from '@sim/index';
import { PuzzleWatch, puzzleDefs, startPuzzles } from './index';

const content = loadGameContent();

describe('puzzles in the game (mw-e15.3)', () => {
  it('turns the content puzzles of a scene into runtime definitions', () => {
    const defs = puzzleDefs(content, 'brazier-hall');
    expect(defs.map((def) => def.id)).toEqual(['brazier-hall']);
    expect(defs[0]).toMatchObject({
      repeatable: false,
      discovery: { volume: { kind: 'box' } },
      solutions: [
        { id: 'carry-flame', capabilities: [] },
        { id: 'fire-from-range', capabilities: ['spell.ember'] },
      ],
      outputs: {
        solvedFact: 'brazier-hall.solved',
        signals: ['brazier-hall/vault-latch'],
        rewards: ['brazier-hall-vault'],
      },
    });
    expect(defs[0]?.entities).toContainEqual({ id: 'torch-barrel', critical: true });
    expect(puzzleDefs(content, 'mechanism-room')).toEqual([]);
    // A puzzle with no discovery rule carries none.
    expect(puzzleDefs(content, 'testbed')[0]).not.toHaveProperty('discovery');
  });

  function world() {
    const w = registerWorldProperties(new World<never>({ seed: 1, hz: 10 }));
    registerSceneComponents(w);
    w.facts.declare('brazier-hall.solved', { type: 'bool', default: false });
    w.facts.declare('brazier-hall.vault-open', { type: 'bool', default: false });
    return w;
  }

  it('starts nothing for a scene without puzzles', () => {
    const w = world();
    expect(startPuzzles(w, content, 'mechanism-room')).toBeUndefined();
    expect(w.entityCount).toBe(0);
  });

  it('runs the scene’s puzzles and reports an undeclared solve', () => {
    const w = world();
    const braziers = ['brazier-west', 'brazier-north', 'brazier-east'].map((id) => {
      const entity = spawnSceneSpawn(w, 'brazier-hall', {
        id,
        tags: ['brazier'],
        position: { x: 0, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0, w: 1 },
      } as never);
      addProperties(w, entity, { burning: false });
      return entity;
    });
    const player = w.spawn();
    const lines: string[] = [];
    // The shipped puzzle has a route for anyone, so nothing is undeclared there; a stand-in that
    // declares only Ember shows the report.
    const stub = {
      all: () => [
        {
          ...content.all('puzzle').find((p) => p.id === 'brazier-hall'),
          solutions: [{ id: 'ember', name: 'Ember', capabilities: ['spell.ember'], steps: [] }],
        },
      ],
    };
    const runtime = startPuzzles(w, stub as never, 'brazier-hall', {
      player,
      report: (line) => lines.push(line),
    });
    expect(runtime?.ids).toEqual(['brazier-hall']);
    const watch = new PuzzleWatch(runtime as never);
    const first = watch.changed();
    expect(first).toContain('"state":"dormant"');
    expect(watch.changed()).toBeUndefined(); // unchanged since
    w.events.emit(capabilityUsed, { actor: player, capability: 'spell.mage-hand', tick: 0 });
    for (const entity of braziers) setProperty(w, entity, 'burning', true);
    for (let i = 0; i < 15; i++) w.step();
    expect(watch.readout()[0]).toMatchObject({ state: 'solved', attribution: 'undeclared' });
    expect(watch.changed()).toContain('"attribution":"undeclared"');
    expect(lines).toEqual([
      expect.stringMatching(
        /puzzle brazier-hall solved at tick \d+ by an undeclared route \(capabilities used: spell\.mage-hand\)/,
      ),
    ]);
  });

  it('says "none" for an undeclared solve with no capabilities used', () => {
    const w = world();
    const entity = spawnSceneSpawn(w, 'brazier-hall', {
      id: 'brazier-west',
      tags: ['brazier'],
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0, w: 1 },
    } as never);
    addProperties(w, entity, { burning: false });
    const lines: string[] = [];
    const stub = {
      all: () => [
        {
          ...content.all('puzzle').find((p) => p.id === 'brazier-hall'),
          solutions: [{ id: 'ember', name: 'Ember', capabilities: ['spell.ember'], steps: [] }],
        },
      ],
    };
    startPuzzles(w, stub as never, 'brazier-hall', { report: (line) => lines.push(line) });
    setProperty(w, entity, 'burning', true);
    for (let i = 0; i < 15; i++) w.step();
    expect(lines[0]).toContain('capabilities used: none');
  });
});
