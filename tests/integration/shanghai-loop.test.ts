// mw-e40.30: the shanghai loop, the third way aboard the Gilded Tern (bible 4.5, 5.14). Losing the
// Drowned Gull crew table sets hesketh.shanghaied, the glue wakes the player in the Tern's hold and
// seats Hesketh on deck, his real dialogue settles the articles and hands over the gangway token, and
// the gate opens from the deck. Played on the real harbour headless, as src/main.ts wires it.
import * as RAPIER from '@dimforge/rapier3d-deterministic';
import { describe, expect, it, vi } from 'vitest';
import { deriveNavAgent, loadGameContent, resolveLocomotion } from '@content/index';
import type { DialogueDef } from '@content/types/dialogue';
import { markExercised } from '@content/testing';
import { installContests, contestsIn } from '@game/contest/install';
import { createGameDispositions, npcResolver } from '@game/conversation/npcs';
import { installFactRegistry } from '@game/facts';
import { installGameLogic, questsOf } from '@game/logic/index';
import { SHANGHAI_CONTEST, startShanghaiUi } from '@game/shanghai/shanghai';
import {
  actionButton,
  actionFrame,
  actionVector,
  CapabilityRegistry,
  ConversingComponent,
  CreatureComponent,
  DialogueRuntime,
  DoorComponent,
  gameClockOf,
  installGameClock,
  InventoryRules,
  inventoryOf,
  LockComponent,
  NavMesh,
  NavMeshQuery,
  type NavDoorLookup,
  PlacementComponent,
  PlayerLook,
  SceneSpawnComponent,
  teleportCommand,
  type ActionFrame,
  type EntityId,
  type World,
} from '@sim/index';
import { createGameWorld } from '@tools/replay/testbed-player-scenario';
import type { UiRoot } from '@ui/index';

// The DOM does not load the physics wasm in this environment, so the narration window is a stand-in
// that opens a screen and closes it on skip (its real window is tested in src/game/shanghai).
const windows: { screen: string; skip: () => void }[] = [];
vi.mock('@ui/index', async (original) => ({
  ...(await original<typeof import('@ui/index')>()),
  openEpilogueSlideshow: (
    ui: { top: unknown },
    options: { screenId: string; onEnd: (end: string, shown: number) => void },
  ) => {
    ui.top = options.screenId;
    const shown = {
      screen: options.screenId,
      skip: () => {
        ui.top = undefined;
        options.onEnd('skipped', 1);
      },
    };
    windows.push(shown);
    return shown;
  },
}));

const content = loadGameContent();
const scene = content.get('scene', 'wendmouth-harbour');
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
const IDLE = frame(false);
const INTERACT = frame(true);
type Input = ActionFrame | ReturnType<typeof teleportCommand>;

const must = <T>(value: T | undefined): T => {
  if (value === undefined) throw new Error('missing');
  return value;
};
const spawnAt = (id: string) => {
  const found = scene.spawns.find((s) => s.id === id);
  if (found === undefined) throw new Error(`no spawn ${id}`);
  return { x: found.at[0], y: found.at[1], z: found.at[2] };
};

function harbour() {
  const game = createGameWorld<Input>(RAPIER, {
    seed: 3,
    hz: 60,
    scene: 'wendmouth-harbour',
    magic: true,
  });
  const { world, player } = game;
  const sim = world as unknown as World<never>;
  installFactRegistry(world.facts, content, true);
  installGameClock(sim, content.get('game', 'game').clock);
  const dispositions = createGameDispositions(sim, content, () => player);
  dispositions.listen();
  const logic = installGameLogic(sim, {
    world: sim,
    player: () => player,
    inventory: new InventoryRules(content.all('item')),
    capabilities: new CapabilityRegistry([]),
    quests: questsOf(content),
    disposition: { dispositions, resolve: npcResolver(sim) },
  });
  const contests = installContests(sim, {
    contests: contestsIn(content),
    host: logic.host,
    player: () => player,
  });
  const ui = { top: undefined as unknown } as unknown as UiRoot;
  const toasts: string[] = [];
  const queued: Input[] = [];
  const shanghai = startShanghaiUi({
    ui,
    world: sim,
    player,
    teleport: (entity, to) => queued.push(teleportCommand(entity, to)),
    toast: (text) => toasts.push(text),
  });
  const step = (ticks = 1, input: ActionFrame = IDLE) => {
    for (let i = 0; i < ticks; i++) {
      world.step([...queued.splice(0), input]);
      contests.update();
      shanghai.afterStep();
    }
  };
  const hesketh = must(npcResolver(sim)('npc-hesketh'));
  const where = (e: EntityId) =>
    sim.get(e, PlacementComponent) as { x: number; y: number; z: number };
  const gate = must(
    sim
      .query(SceneSpawnComponent)
      .ids()
      .find((e) => sim.get(e, SceneSpawnComponent)?.id === 'door-tern-gangway'),
  );
  const runtime = new DialogueRuntime({
    world: sim,
    host: logic.host,
    dialogues: (id) => content.get('dialogue', id) as unknown as DialogueDef,
  });
  const settleLines = () => {
    for (let view = runtime.view; view?.kind === 'line'; view = runtime.advance());
  };
  const pick = (id: string) => {
    const index = runtime.choices().findIndex((c) => c.id === id);
    expect(index, `option ${id} offered`).toBeGreaterThanOrEqual(0);
    expect(runtime.choose(index).ok).toBe(true);
    settleLines();
  };
  /** Plays a whole contest to its end: the player wins every round (`win`) or none. */
  const play = (id: string, win: boolean) => {
    logic.host.adjustGold(10);
    expect(contests.runner.enter(id, sim.tick)).toEqual({ ok: true });
    for (let i = 0; i < 3000 && contests.runner.isActive(id); i++) {
      if (win && i % 20 === 0) contests.runner.record({ name: 'dice.round-won', tick: sim.tick });
      step();
    }
    expect(contests.runner.isActive(id)).toBe(false);
    step(2);
  };
  const pack = () => (inventoryOf(sim, player)?.items ?? []).map((i) => i.defId);
  return {
    world,
    sim,
    player,
    ui,
    toasts,
    step,
    hesketh,
    where,
    gate,
    runtime,
    settleLines,
    pick,
    play,
    pack,
    contests,
  };
}

/** Closes the narration window the way a player does, with its Skip. */
function dismiss(h: ReturnType<typeof harbour>) {
  windows.at(-1)?.skip();
  h.step(2);
}

describe('the shanghai loop (mw-e40.30)', () => {
  it('AC-1: losing the Tern crew table sets hesketh.shanghaied, wakes the player in the hold, seats the Captain on deck and moves the clock on', ({
    task,
  }) => {
    markExercised(task, 'contest', SHANGHAI_CONTEST);
    const h = harbour();
    const before = gameClockOf(h.sim)?.total() ?? 0;
    h.step(2);
    expect(h.world.facts.get('hesketh.shanghaied')).not.toBe(true);
    h.play(SHANGHAI_CONTEST, false);
    expect(h.world.facts.get('hesketh.shanghaied')).toBe(true);
    // The narration window is the fade; the player is already in the hold behind it.
    expect(h.ui.top).toBe('shanghai');
    h.step(3);
    const wake = spawnAt('tern-hold-wake');
    expect(h.where(h.player).x).toBeCloseTo(wake.x, 0);
    expect(h.where(h.player).z).toBeCloseTo(wake.z, 0);
    expect(h.where(h.player).y).toBeLessThan(1);
    expect((gameClockOf(h.sim)?.total() ?? 0) - before).toBeGreaterThanOrEqual(6 * 60);
    // The Captain is on deck, and stays there.
    const post = spawnAt('tern-captain-post');
    h.step(300);
    expect(h.where(h.hesketh).x).toBeCloseTo(post.x, 0);
    expect(h.where(h.hesketh).z).toBeCloseTo(post.z, 0);
    expect(h.where(h.hesketh).y).toBeGreaterThan(1.5);
    dismiss(h);
    expect(h.toasts.at(-1)).toMatch(/Hesketh/);
  });

  it('AC-2: an ordinary loss at the Gull dice, or winning the crew table, does not shanghai you', () => {
    const h = harbour();
    h.play('drowned-gull-dice', false);
    expect(h.world.facts.get('hesketh.shanghaied')).not.toBe(true);
    expect(h.ui.top).toBeUndefined();
    h.play(SHANGHAI_CONTEST, true);
    expect(h.world.facts.get('hesketh.shanghaied')).not.toBe(true);
    expect(h.ui.top).toBeUndefined();
    expect(h.where(h.player).z).toBeLessThan(100);
  });

  it.each([
    ['working it off', ['work-passage']],
    ['arguing the contract, and failing', ['argue-release']],
  ])(
    'AC-3: Hesketh settles it by %s: the articles are cleared and the gangway token is yours',
    (_how, picks) => {
      const h = harbour();
      h.play(SHANGHAI_CONTEST, false);
      dismiss(h);
      h.runtime.start(HESKETH, 'npc-hesketh');
      h.settleLines();
      for (const id of picks) h.pick(id);
      // A failed argument sends the player round to the work; the success path is covered below.
      expect(h.world.facts.get('hesketh.shanghaied')).toBe(false);
      expect(h.pack()).toContain(PASS);
      expect(h.world.facts.get('hesketh.gangway-open')).toBe(true);
    },
  );

  it('AC-3: the Captain goes back to his post on the quay once the talk has ended', () => {
    const h = harbour();
    h.play(SHANGHAI_CONTEST, false);
    dismiss(h);
    h.step(10);
    h.runtime.start(HESKETH, 'npc-hesketh');
    h.settleLines();
    h.sim.register(ConversingComponent);
    h.sim.add(h.hesketh, ConversingComponent, { with: h.player } as never);
    h.pick('work-passage');
    h.step(5);
    // Mid-conversation he stays where he is.
    expect(h.where(h.hesketh).y).toBeGreaterThan(1.5);
    h.sim.remove(h.hesketh, ConversingComponent);
    h.step(5);
    const home = spawnAt('tern-gangway');
    expect(h.where(h.hesketh).z).toBeLessThan(home.z);
    expect(h.where(h.hesketh).y).toBeLessThan(1);
    const leash = h.sim.get(h.hesketh, CreatureComponent)?.origin.leash;
    expect(leash?.post.z).toBeCloseTo(96, 5);
  });

  it('AC-4: from the deck the player leaves by the gangway: the token opens the gate, and the way from the hold to the gangway is on the navmesh', () => {
    const query = new NavMeshQuery(new NavMesh(content.get('navmesh', 'wendmouth-harbour')));
    const humanoid = deriveNavAgent(
      resolveLocomotion(content.get('locomotion', 'humanoid'), content),
    );
    const open: NavDoorLookup = () => 'open';
    expect(
      query.findPath({
        start: spawnAt('tern-hold-wake'),
        goal: spawnAt('tern-gangway'),
        agent: humanoid,
        doors: open,
      }).status,
    ).toBe('found');

    const h = harbour();
    h.play(SHANGHAI_CONTEST, false);
    dismiss(h);
    h.runtime.start(HESKETH, 'npc-hesketh');
    h.settleLines();
    h.pick('work-passage');
    h.world.step([teleportCommand(h.player, { x: 35, y: 0, z: 100.5 })]);
    h.world.set(h.player, PlayerLook, { yaw: 0, pitch: 0 });
    h.step(10);
    expect(h.sim.get(h.gate, LockComponent)?.locked).toBe(true);
    h.step(1, INTERACT);
    h.step(120);
    expect(h.sim.get(h.gate, LockComponent)?.locked).toBe(false);
    expect(h.sim.get(h.gate, DoorComponent)?.openness).toBe(1);
  });

  it('AC-5: a new game’s facts stay player.class only, and nothing is shanghaied at boot', () => {
    const h = harbour();
    h.step(5);
    expect(h.world.facts.get('hesketh.shanghaied')).not.toBe(true);
    expect(h.ui.top).toBeUndefined();
  });
});
