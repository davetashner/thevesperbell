// mw-e39.35, mw-e40.31 (part of mw-e40.11): Tereza Maelo's first-blood duel runs (her arms stall is
// tests/integration/tereza-shop.test.ts). The real Wendmouth harbour loaded headless as the game wires it (createGameWorld:
// physics, AI, combat, the player), Tereza's real dialogue, the game's logic host and dispositions, the
// sim's duel engine, the duel glue and the shop. The duel starts from her dialogue, ends at the first
// hit, and writes the facts her dialogue reads back.
import * as RAPIER from '@dimforge/rapier3d-deterministic';
import { describe, expect, it } from 'vitest';
import { loadGameContent } from '@content/index';
import { markExercised } from '@content/testing';
import { DUEL_BEHAVIOUR, startDuelUi } from '@game/duel/duel';
import { installFactRegistry } from '@game/facts';
import { createGameDispositions, npcResolver } from '@game/conversation/npcs';
import { installGameLogic, questsOf } from '@game/logic/index';
import { logicEmitted } from '@game/logic/host';
import {
  brainOf,
  CapabilityRegistry,
  CreatureComponent,
  DialogueRuntime,
  DuelEnded,
  FirstBloodDuels,
  healthOf,
  InventoryRules,
  PlacementComponent,
  PlayerClassComponent,
  teleportCommand,
  type EntityId,
  type World,
} from '@sim/index';
import type { DialogueDef } from '@content/types/dialogue';
import type { UiRoot } from '@ui/index';
import { createGameWorld } from '@tools/replay/testbed-player-scenario';

const content = loadGameContent();
const TEREZA = 'tereza-arms-stall';

/** The harbour headless, with the duel, the dialogue and the shop wired as src/main.ts wires them. */
function harbour() {
  const game = createGameWorld<unknown>(RAPIER, {
    seed: 1,
    hz: 60,
    scene: 'wendmouth-harbour',
    magic: true,
  });
  const world = game.world as unknown as World<never>;
  const { player } = game;
  installFactRegistry(world.facts, content, false);
  world.register(PlayerClassComponent);
  world.add(player, PlayerClassComponent, { classId: 'knight' });
  const dispositions = createGameDispositions(world, content, () => player);
  dispositions.listen();
  const logic = installGameLogic(world, {
    world,
    player: () => player,
    inventory: new InventoryRules(content.all('item')),
    capabilities: new CapabilityRegistry([]),
    quests: questsOf(content),
    disposition: { dispositions, resolve: npcResolver(world) },
  });
  // No screen is open: the conversation is the dialogue runtime's, not a window.
  const ui = { top: undefined } as unknown as UiRoot;
  const toasts: string[] = [];
  const duels = new FirstBloodDuels(world, game.combat.damage, DUEL_BEHAVIOUR);
  const duelUi = startDuelUi({
    ui,
    world,
    player,
    duels,
    host: logic.host,
    toast: (text) => toasts.push(text),
  });
  const found = npcResolver(world)('npc-tereza');
  if (found === undefined) throw new Error('Tereza is not in the harbour');
  const tereza: EntityId = found;
  const runtime = new DialogueRuntime({
    world,
    host: logic.host,
    dialogues: (id) => content.get('dialogue', id) as unknown as DialogueDef,
  });
  const ended: string[] = [];
  world.events.on(DuelEnded, ({ victor }) => ended.push(victor));
  /** One sim step, then the glue's after-step hooks. */
  const step = (ticks = 1): void => {
    for (let i = 0; i < ticks; i++) {
      world.step([]);
      duelUi.afterStep();
    }
  };
  /** A dialogue effect's `emit` reaches the world as `logic.emitted`, as the game's host does it. */
  const listen = (): string[] => {
    const seen: string[] = [];
    world.events.on(logicEmitted, ({ event }) => seen.push(event));
    return seen;
  };
  const talk = (): void => {
    runtime.start(TEREZA, 'npc-tereza');
    for (let view = runtime.view; view?.kind === 'line'; view = runtime.advance());
  };
  const options = (): string[] => runtime.choices().map((c) => c.id);
  const pick = (id: string): void => {
    const index = runtime.choices().findIndex((c) => c.id === id);
    expect(index, `option ${id} offered`).toBeGreaterThanOrEqual(0);
    expect(runtime.choose(index).ok).toBe(true);
    for (let view = runtime.view; view?.kind === 'line'; view = runtime.advance());
  };
  const fact = (key: string) => world.facts.get(key);
  const near = (): void => {
    const at = world.get(tereza, PlacementComponent);
    if (at === undefined) throw new Error('Tereza is not placed');
    (world as unknown as World).step([
      teleportCommand(player, { x: at.x, y: at.y, z: at.z + 1.2 }),
    ]);
  };
  return {
    game,
    world,
    player,
    tereza,
    logic,
    dispositions,
    duels,
    toasts,
    runtime,
    ended,
    step,
    listen,
    talk,
    options,
    pick,
    fact,
    near,
  };
}

/** The player lands a blow on Tereza, or she lands one on the player. */
function strike(h: ReturnType<typeof harbour>, from: EntityId, to: EntityId): void {
  h.game.combat.damage.apply(h.world, to, { instigator: from, amounts: { slash: 80 } });
  h.step(2);
}

describe('Tereza Maelo first-blood duel and arms stall (mw-e39.35, mw-e40.31)', () => {
  it('AC-1: accepting the challenge in her dialogue starts the duel, with her fighting stance', ({
    task,
  }) => {
    markExercised(task, 'behaviour', 'duellist');
    markExercised(task, 'attack', 'tereza-sabre-cut');
    markExercised(task, 'attack', 'tereza-sabre-lunge');
    const h = harbour();
    const emitted = h.listen();
    h.near();
    h.step(30);
    expect(brainOf(h.world, h.tereza)?.behaviour).toBe('shopkeeper');
    h.talk();
    h.pick('accept-duel');
    expect(h.duels.active).toBeUndefined();
    h.step(2);
    expect(emitted).toContain('tereza.duel-start');
    expect(h.duels.active).toEqual({ player: h.player, duellist: h.tereza });
    expect(brainOf(h.world, h.tereza)?.behaviour).toBe('duellist');
    expect(h.toasts[0]).toMatch(/First blood/);
  });

  it('AC-2: the player landing the first hit wins: nobody is hurt, she yields and the dialogue records won', () => {
    const h = harbour();
    h.near();
    h.talk();
    h.pick('accept-duel');
    h.step(2);
    const before = healthOf(h.world, h.tereza)?.current;
    const disposition = h.dispositions.get(h.tereza);
    strike(h, h.player, h.tereza);
    expect(h.ended).toEqual(['player']);
    expect(healthOf(h.world, h.tereza)?.current).toBe(before);
    expect(brainOf(h.world, h.tereza)?.behaviour).toBe('shopkeeper');
    expect(h.dispositions.get(h.tereza)).toBe(disposition);
    expect(h.fact('tereza.duel.fought')).toBe(true);
    expect(h.fact('tereza.duel.victor')).toBe('player');
    expect(h.toasts.at(-1)).toMatch(/yours/);
    h.talk();
    expect(h.fact('tereza.duel.result')).toBe('won');
    expect(h.fact('tereza.under-counter')).toBe(true);
    expect(h.fact('tereza.duel.fought')).toBe(false);
  });

  it('AC-3: after a win her debt-of-honour option appears and sets tereza.tern-access', () => {
    const h = harbour();
    h.near();
    h.talk();
    h.pick('accept-duel');
    h.step(2);
    strike(h, h.player, h.tereza);
    h.talk();
    expect(h.options()).toContain('ask-tern');
    h.pick('ask-tern');
    expect(h.fact('tereza.tern-access')).toBe(true);
  });

  it('AC-4: the first hit may be hers: the player loses no health, and the dialogue records lost', () => {
    const h = harbour();
    h.near();
    h.talk();
    h.pick('accept-duel');
    h.step(2);
    strike(h, h.tereza, h.player);
    expect(h.ended).toEqual(['duellist']);
    expect(healthOf(h.world, h.player)?.current).toBe(healthOf(h.world, h.player)?.max);
    expect(h.fact('tereza.duel.victor')).toBe('tereza');
    expect(h.toasts.at(-1)).toMatch(/hers/);
    h.talk();
    expect(h.fact('tereza.duel.result')).toBe('lost');
    expect(h.fact('tereza.under-counter')).toBe(false);
    expect(h.fact('tereza.tern-access')).toBe(false);
  });

  it('AC-5: left to herself she fights: with the player standing still she lands the first hit, harmlessly', () => {
    const h = harbour();
    h.near();
    h.talk();
    h.pick('accept-duel');
    h.step(1200);
    expect(h.ended).toEqual(['duellist']);
    expect(healthOf(h.world, h.player)?.current).toBe(healthOf(h.world, h.player)?.max);
    expect(h.fact('tereza.duel.victor')).toBe('tereza');
  });

  it('AC-6: a new game carries no duel facts, and she is a creature in the scene', () => {
    const h = harbour();
    expect(h.fact('tereza.duel.result')).toBe('none');
    expect(h.fact('tereza.duel.fought')).toBe(false);
    expect(h.world.get(h.tereza, CreatureComponent)?.origin.creature).toBe('npc-tereza');
  });
});
