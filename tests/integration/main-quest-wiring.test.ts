// @vitest-environment happy-dom
// mw-e39.38: the main quest (quest-labyrinth-beneath-briar-glen) progresses when the player plays
// the levels that are built today. Real game content: the briar-glen-lane and bellwater-priory
// scenes with their signal graphs, the game's fact registry and quest runtime. The player is
// placed where a walk would put them and the world is stepped; nothing completes an objective by
// hand. Everything whose level is not built yet stays inactive (see the deferred test).
import { loadGameContent, materialPresets } from '@content/index';
import { installFactRegistry } from '@game/facts';
import { startReaderUi } from '@game/reader/reader';
import { installGameLogic, questsOf } from '@game/logic/index';
import { startMechanisms } from '@game/mechanisms/index';
import {
  addCapabilities,
  addInventory,
  applyLogicEffects,
  CapabilityRegistry,
  DialogueStarted,
  INTERACTION_COMPONENTS,
  InMemoryColliderSink,
  InventoryRules,
  interacted,
  loadScene,
  registerSceneComponents,
  registerWorldProperties,
  installStimuli,
  lightComponents,
  stimulusSystem,
  World,
  type KitLookup,
} from '@sim/index';
import { placeEntity } from '@sim/stimulus/placement';
import { UiRoot } from '@ui/index';
import { describe, expect, it } from 'vitest';

const MAIN = 'quest-labyrinth-beneath-briar-glen';
const content = loadGameContent();
const kit: KitLookup = (id) => (content.has('kit', id) ? content.get('kit', id) : undefined);
const inventory = new InventoryRules(content.all('item'));

/** A game as `startWorld` builds it, with one scene loaded and the player standing at `at`. */
function play(scene: string, at: { x: number; y: number; z: number }) {
  const world = installStimuli(
    registerWorldProperties(registerSceneComponents(new World<never>({ seed: 3 }))),
  );
  world.register(...INTERACTION_COMPONENTS, ...lightComponents);
  world.addSystem(stimulusSystem());
  installFactRegistry(world.facts, content, false);
  const player = world.spawn();
  addInventory(world, player, 0);
  addCapabilities(world, player);
  world.step();
  const logic = installGameLogic(world, {
    world,
    player: () => player,
    inventory,
    capabilities: new CapabilityRegistry([]),
    quests: questsOf(content),
  });
  const colliders = new InMemoryColliderSink();
  const loaded = loadScene(world, content.get('scene', scene), kit, colliders);
  startMechanisms(world, loaded, {
    content,
    materials: materialPresets(content.all('material')),
    colliders,
    occluders: new InMemoryColliderSink(),
    player,
  });
  const runtime = logic.quests;
  if (runtime === undefined) throw new Error('no quest runtime');
  const stand = (to: { x: number; y: number; z: number }): void => {
    placeEntity(world, player, to, 0.4);
  };
  const settle = (steps = 4): void => {
    for (let i = 0; i < steps; i++) world.step();
  };
  stand(at);
  /** The player reads the scene's spawn `id`, as the interaction does, and the reader opens it. */
  const read = (id: string): void => {
    document.body.innerHTML = '';
    const target = loaded.spawns.find((s) => s.spawn.id === id)?.entity;
    if (target === undefined) throw new Error(`no spawn ${id}`);
    const ui = new UiRoot(document.body, { unstyled: true });
    const reader = startReaderUi({ ui, world: world, content, player });
    world.events.emit(interacted, { actor: player, target, verb: 'read', affordance: 0 });
    settle(1);
    reader.afterStep();
    settle(2);
  };
  return { world, logic, runtime, stand, settle, read };
}

describe('the main quest plays through the built levels (mw-e39.38)', () => {
  it('AC-1: a new game has only player.class in its facts and the quest is unstarted', () => {
    const g = play('briar-glen-lane', { x: 0, y: 0.9, z: 30 });
    g.world.facts.set('player.class', 'knight');
    g.settle();
    expect(g.world.facts.entries().map(([key]) => key)).toEqual(['player.class']);
    expect(g.runtime.questState(MAIN)).toBe('unstarted');
  });

  it('AC-1: arriving in Briar Glen from the valley writes briar-glen.arrived and starts the quest', () => {
    const g = play('briar-glen-lane', { x: 0, y: 0.9, z: 5 });
    expect(g.world.facts.get('briar-glen.arrived')).toBe(false);
    g.settle();
    expect(g.world.facts.get('briar-glen.arrived')).toBe(true);
    expect(g.runtime.questState(MAIN)).toBe('active');
    expect(g.runtime.objectiveState(MAIN, 'reach-briar-glen')).toBe('complete');
    expect(g.runtime.stage(MAIN)).toBe('first-night');
  });

  it('AC-1: the arrival is kept when the player walks back out of the volume and over the bridge', () => {
    const g = play('briar-glen-lane', { x: 0, y: 0.9, z: 5 });
    g.settle();
    g.stand({ x: 0, y: 0.9, z: 30 });
    g.settle();
    expect(g.world.facts.get('briar-glen.arrived')).toBe(true);
    expect(g.runtime.questState(MAIN)).toBe('active');
  });

  it('AC-2: reaching the belfry deck completes visit-the-priory', () => {
    const g = play('bellwater-priory', { x: 60, y: 0.9, z: 6 });
    g.world.facts.set('briar-glen.arrived', true);
    g.settle();
    expect(g.runtime.objectiveState(MAIN, 'visit-the-priory')).toBe('active');
    g.stand({ x: 85, y: 9.9, z: 73 });
    g.settle();
    expect(g.runtime.objectiveState(MAIN, 'visit-the-priory')).toBe('complete');
  });

  it('AC-2: an early belfry visit does not complete the Climb once its stage starts', () => {
    const g = play('bellwater-priory', { x: 60, y: 0.9, z: 6 });
    g.world.facts.set('briar-glen.arrived', true);
    g.settle();
    // The priory may be visited before Act II: the deck counts as a visit and nothing more.
    g.stand({ x: 85, y: 9.9, z: 73 });
    g.settle();
    expect(g.runtime.objectiveState(MAIN, 'visit-the-priory')).toBe('complete');
    for (const variant of ['with-horn', 'with-goblins', 'with-clatter', 'chased']) {
      expect(
        g.world.facts.get(`quest.${MAIN}.seen.climb-the-shaft-${variant}`),
        variant,
      ).toBeUndefined();
    }
    // Play on to the chased climb (nobody to help): the shaft climb itself is not built, so the
    // objective is still waiting for someone to arrive at the top of the Sounding Shaft.
    const done = (...ids: string[]): void => {
      for (const id of ids) {
        expect(g.runtime.completeObjective(MAIN, id), id).toBeUndefined();
        g.settle(2);
      }
    };
    done('see-the-horned-shape', 'hear-the-bounty');
    g.world.facts.set('hale.list.shared', true);
    g.world.facts.set('mirela.hours.lent', true);
    g.world.facts.set('dot.trinket.confessed', true);
    g.world.facts.set('world.sleepers-path.revealed', true);
    g.settle();
    done('enter-by-front-gate', 'enter-the-knot', 'reach-the-ossuary', 'reach-horns-hall');
    g.world.facts.set('horn.fate', 'dead');
    g.world.facts.set('horn.defeated', true);
    g.settle();
    done('hear-the-friend-below', 'reach-the-cradle');
    g.world.facts.set('abbot.fate', 'defeated');
    g.settle();
    expect(g.runtime.stage(MAIN)).toBe('climb-chased');
    expect(g.runtime.objectiveState(MAIN, 'climb-the-shaft-chased')).toBe('active');
  });

  it('AC-3: talking to Harrow Vane in the morning completes hear-the-bounty and starts the hub', () => {
    const g = play('briar-glen-lane', { x: 0, y: 0.9, z: 5 });
    g.settle();
    // Past the first night (the next day ends it), the morning stage waits on Vane.
    g.world.facts.set('time.day', 2);
    g.settle();
    expect(g.runtime.stage(MAIN)).toBe('morning');
    g.world.events.emit(DialogueStarted, {
      tick: 0,
      dialogue: 'vane-house',
      npc: 'npc-vane',
      entry: 'greeting',
    });
    g.settle();
    expect(g.runtime.objectiveState(MAIN, 'hear-the-bounty')).toBe('complete');
    expect(g.runtime.stage(MAIN)).toBe('investigation');
  });

  it("AC-3: the abbot's reveal dialogue emits abbot-revealed, which the quest listens for", () => {
    const g = play('briar-glen-lane', { x: 0, y: 0.9, z: 5 });
    g.settle();
    const reveal = content
      .get('dialogue', 'abbot-cradle')
      .nodes.find((node) => node.id === 'reveal-end');
    expect(reveal?.kind).toBe('effect');
    const effects = (reveal as unknown as { effects: Parameters<typeof applyLogicEffects>[0] })
      .effects;
    expect(effects).toContainEqual({ kind: 'emit', event: 'abbot-revealed' });
    expect(applyLogicEffects(effects, g.logic.host)).toMatchObject({ ok: true });
    g.settle();
    // The objective sits in a later stage, so the event is remembered until the stage starts.
    expect(g.world.facts.get(`quest.${MAIN}.seen.hear-the-friend-below`)).toBe(true);
  });

  it('AC-5: standing in the mine-gate forecourt completes follow-tansy, once the first night is on', () => {
    const g = play('deepworks', { x: 100, y: 0.9, z: 6 });
    g.world.facts.set('briar-glen.arrived', true);
    g.settle();
    expect(g.runtime.stage(MAIN)).toBe('first-night');
    expect(g.runtime.objectiveState(MAIN, 'follow-tansy')).toBe('active');
    // The mine road is not the gate: walking it completes nothing.
    g.stand({ x: 100, y: 0.9, z: 30 });
    g.settle();
    expect(g.runtime.objectiveState(MAIN, 'follow-tansy')).toBe('active');
    g.stand({ x: 100, y: 0.9, z: 68 });
    g.settle();
    expect(g.runtime.objectiveState(MAIN, 'follow-tansy')).toBe('complete');
    // Optional: the beat it belongs to still waits for the horned shape (not built yet).
    expect(g.runtime.objectiveState(MAIN, 'see-the-horned-shape')).toBe('active');
  });

  it('AC-4: objectives whose level is not built stay untouched by play', () => {
    const g = play('briar-glen-lane', { x: 0, y: 0.9, z: 5 });
    g.settle();
    for (const id of ['enter-the-knot', 'reach-the-cradle', 'ring-the-bell']) {
      expect(g.runtime.objectiveState(MAIN, id), id).not.toBe('complete');
    }
  });

  it('mw-nro9 AC-1: reading the Deepworks gate note completes find-the-friend-note once the investigation is on', () => {
    const g = play('deepworks', { x: 104, y: 0.9, z: 64 });
    g.world.facts.set('briar-glen.arrived', true);
    g.settle();
    g.world.facts.set('time.day', 2);
    g.settle();
    g.runtime.completeObjective(MAIN, 'hear-the-bounty');
    g.settle();
    expect(g.runtime.stage(MAIN)).toBe('investigation');
    expect(g.runtime.objectiveState(MAIN, 'friend-below-note')).toBe('active');
    g.read('read-friend-note-gate');
    expect(g.runtime.objectiveState(MAIN, 'friend-below-note')).toBe('complete');
  });

  it('mw-nro9 AC-1: a note read before the stage is remembered and completes the objective when it starts', () => {
    const g = play('deepworks', { x: 104, y: 0.9, z: 64 });
    g.world.facts.set('briar-glen.arrived', true);
    g.settle();
    g.read('read-friend-note-gate');
    expect(g.runtime.objectiveState(MAIN, 'friend-below-note')).not.toBe('complete');
    g.world.facts.set('time.day', 2);
    g.settle();
    g.runtime.completeObjective(MAIN, 'hear-the-bounty');
    g.settle();
    expect(g.runtime.stage(MAIN)).toBe('investigation');
    expect(g.runtime.objectiveState(MAIN, 'friend-below-note')).toBe('complete');
  });
});
