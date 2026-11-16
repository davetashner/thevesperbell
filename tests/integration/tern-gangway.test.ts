// mw-e40.28: boarding the Gilded Tern. The gangway gate (door-tern-gangway, lock tern-gangway) opens to
// Hesketh's gangway token, which he hands over on both routes aboard (Tereza's vouch and the crew
// deal); stepping onto the deck writes tern.boarded. Played with the real DialogueRuntime on the
// harbour as the game wires it, then Interact on the gate, headless.
import * as RAPIER from '@dimforge/rapier3d-deterministic';
import { describe, expect, it } from 'vitest';
import { loadGameContent } from '@content/index';
import type { DialogueDef } from '@content/types/dialogue';
import { markExercised } from '@content/testing';
import {
  actionButton,
  actionFrame,
  actionVector,
  CapabilityRegistry,
  DialogueRuntime,
  DoorComponent,
  interactionPrompt,
  inventoryOf,
  InventoryRules,
  LockComponent,
  PlayerLook,
  SceneSpawnComponent,
  teleportCommand,
  type ActionFrame,
  type World,
} from '@sim/index';
import { createGameDispositions, npcResolver } from '../../src/game/conversation/npcs';
import { installFactRegistry } from '../../src/game/facts';
import { createGameLogicHost } from '../../src/game/logic/host';
import { createGameWorld } from '@tools/replay/testbed-player-scenario';

const content = loadGameContent();
const HESKETH = 'hesketh-gilded-tern';
const PASS = 'tern-gangway-pass';

const UP = actionButton(false, false, false);
const DOWN = actionButton(true, true, false);
const frame = (interact: boolean): ActionFrame =>
  actionFrame({
    move: actionVector(0, 0),
    look: actionVector(0, 0),
    buttons: (action) => (action === 'interact' && interact ? DOWN : UP),
  });
const YAW = Math.PI;
const IDLE = frame(false);
const INTERACT = frame(true);

type Input = ActionFrame | ReturnType<typeof teleportCommand>;

function harbour() {
  const game = createGameWorld<Input>(RAPIER, {
    seed: 9,
    hz: 60,
    scene: 'wendmouth-harbour',
    magic: true,
  });
  const { world, player } = game;
  const sim = world as unknown as World<never>;
  installFactRegistry(world.facts, content, true);
  const found = world
    .query(SceneSpawnComponent)
    .ids()
    .find((e) => world.get(e, SceneSpawnComponent)?.id === 'door-tern-gangway');
  if (found === undefined) throw new Error('no door-tern-gangway');
  const gate = found;
  const settle = (ticks = 10) => {
    for (let i = 0; i < ticks; i++) world.step([IDLE]);
  };
  const stand = (x: number, y: number, z: number, yaw = 0) => {
    world.step([teleportCommand(player, { x, y, z })]);
    world.set(player, PlayerLook, { yaw, pitch: 0 });
    settle();
  };
  const dispositions = createGameDispositions(sim, content, () => player);
  dispositions.listen();
  const host = createGameLogicHost({
    world: sim,
    player: () => player,
    inventory: new InventoryRules(content.all('item')),
    capabilities: new CapabilityRegistry([]),
    disposition: { dispositions, resolve: npcResolver(sim) },
  });
  const talk = (facts: Record<string, boolean>, picks: string[]) => {
    for (const [k, v] of Object.entries(facts)) world.facts.set(k, v);
    const runtime = new DialogueRuntime({
      world: sim,
      host,
      dialogues: (id) => content.get('dialogue', id) as unknown as DialogueDef,
    });
    const settleLines = () => {
      let view = runtime.view;
      for (let i = 0; view?.kind === 'line' && i < 50; i++) view = runtime.advance();
    };
    runtime.start(HESKETH, 'npc-hesketh');
    settleLines();
    for (const id of picks) {
      const index = runtime.choices().findIndex((c) => c.id === id);
      expect(index, `option ${id} offered`).toBeGreaterThanOrEqual(0);
      expect(runtime.choose(index).ok).toBe(true);
      settleLines();
    }
    return runtime.choices().map((c) => c.id);
  };
  const pack = () => (inventoryOf(sim, player)?.items ?? []).map((i) => i.defId);
  return { game, world, sim, player, gate, settle, stand, talk, pack };
}

describe('boarding the Gilded Tern (mw-e40.28)', () => {
  it('AC-1: the gate refuses the player empty-handed and the lock hint points at the Captain', ({
    task,
  }) => {
    markExercised(task, 'lock', 'tern-gangway');
    markExercised(task, 'item', PASS);
    const g = harbour();
    g.stand(35, 0, 97.5, YAW);
    expect(g.world.get(g.gate, LockComponent)?.locked).toBe(true);
    expect(interactionPrompt(g.sim, g.player)).toMatchObject({
      target: g.gate,
      verb: 'unlock',
      available: false,
    });
    g.world.step([INTERACT]);
    expect(g.world.get(g.gate, LockComponent)?.locked).toBe(true);
    expect(content.get('lock', 'tern-gangway').hint).toMatch(/Hesketh/);
  });

  it.each([
    ['the crew deal', {}, ['hire', 'sign-crew']],
    ['Tereza’s vouch', { 'tereza.tern-access': true }, ['ask-passage']],
  ])(
    'AC-2: %s gives the token, which unlocks the gate; the deck sets tern.boarded',
    (_route, seed, picks) => {
      const g = harbour();
      expect(g.world.facts.get('tern.boarded')).not.toBe(true);
      g.talk(seed, picks);
      expect(g.pack()).toContain(PASS);
      expect(g.world.facts.get('hesketh.gangway-open')).toBe(true);

      g.stand(35, 0, 97.5, YAW);
      expect(interactionPrompt(g.sim, g.player)).toMatchObject({
        target: g.gate,
        verb: 'unlock',
        available: true,
      });
      g.world.step([INTERACT]);
      expect(g.world.get(g.gate, LockComponent)?.locked).toBe(false);
      g.settle(120);
      expect(g.world.get(g.gate, DoorComponent)?.openness).toBe(1);

      g.stand(35, 2.6, 110);
      expect(g.world.facts.get('tern.boarded')).toBe(true);
      // Once set it stays set.
      g.stand(35, 0, 90);
      expect(g.world.facts.get('tern.boarded')).toBe(true);
    },
  );

  it('AC-3: after boarding Hesketh has a line about the deck, once', () => {
    const g = harbour();
    g.world.facts.set('tern.boarded', true);
    const ids = g.talk({}, ['ask-aboard']);
    expect(ids).not.toContain('ask-aboard');
    expect(ids).toContain('leave');
  });

  it('AC-4: a new game’s facts stay player.class only', () => {
    const g = harbour();
    expect([...g.world.facts.entries()].map(([k]) => k)).not.toContain('tern.boarded');
    expect(g.world.facts.get('hesketh.gangway-open')).not.toBe(true);
  });
});
