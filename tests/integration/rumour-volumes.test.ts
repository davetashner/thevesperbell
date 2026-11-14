// mw-nh24 on real content, headless: the rumour book listens to the arrival volumes of mw-heoa.
// Each scene is loaded the way the game wires it, the player is put at a named spawn, and the real
// volumeEntered event reaches a RumourBook built on the same world and the game's fact registry.
// AC-1: a heard rumour resolves on entering its place's volume (all seven mapped places). AC-2: a
// false rumour (the sea serpent) and a half-true one (Old Mooring) are debunked by their dive volume.
// AC-3: an unheard rumour does nothing and the Millweir stays a lead.
import * as RAPIER from '@dimforge/rapier3d-deterministic';
import { describe, expect, it } from 'vitest';
import { loadGameContent } from '@content/index';
import {
  actionButton,
  actionFrame,
  actionVector,
  teleportCommand,
  type ActionFrame,
  type QuestRuntime,
  type World,
} from '@sim/index';
import { installFactRegistry } from '../../src/game/facts';
import {
  RumourBook,
  rumourFactKey,
  rumoursOf,
  VISIT_TRIGGERS,
} from '../../src/game/rumours/rumours';
import { createGameWorld } from '@tools/replay/testbed-player-scenario';

const content = loadGameContent();
const rumours = rumoursOf(content);
const IDLE = actionFrame({
  move: actionVector(0, 0),
  look: actionVector(0, 0),
  buttons: () => actionButton(false, false, false),
});
type Input = ActionFrame | ReturnType<typeof teleportCommand>;

/** The rumour whose target is `target` (each mapped place has one rumour that targets it). */
const aboutPlace = (target: string) => {
  const found = rumours.find((r) => r.target === target);
  if (found === undefined) throw new Error(`no rumour targets ${target}`);
  return found;
};

/** `scene` loaded as the game does, with a rumour book on its world; `visit` walks to a spawn. */
function open(scene: string) {
  const game = createGameWorld<Input>(RAPIER, { seed: 3, hz: 60, scene, magic: true });
  const world = game.world as unknown as World<never>;
  installFactRegistry(world.facts, content, true);
  const book = new RumourBook({
    world,
    rumours,
    quests: undefined as QuestRuntime | undefined,
    player: () => game.player,
  });
  const settle = (ticks = 10): void => {
    for (let i = 0; i < ticks; i++) game.world.step([IDLE]);
  };
  settle();
  const flag = (id: string, s: 'heard' | 'investigated' | 'debunked') =>
    world.facts.get(rumourFactKey(id, s)) === true;
  const visit = (id: string): void => {
    const found = content.get('scene', scene).spawns.find((s) => s.id === id);
    if (found === undefined) throw new Error(`no spawn ${id} in ${scene}`);
    // Leave every volume first, so that arriving is a fresh entry whatever the scene started in.
    game.world.step([teleportCommand(game.player, { x: 5000, y: 50, z: 5000 })]);
    settle();
    game.world.step([
      teleportCommand(game.player, { x: found.at[0], y: found.at[1] + 0.5, z: found.at[2] }),
    ]);
    settle();
  };
  return { book, flag, visit };
}

const PLACES: readonly [scene: string, spawn: string, place: string, area: string][] = [
  ['briarwood', 'town-gate', 'place-briarwood', 'briarwood'],
  ['briarwood', 'standing-horn', 'place-standing-horn', 'standing-horn'],
  ['moorings-watch', 'moorings-courtyard', 'place-mooring-watch', 'mooring-watch'],
  ['briar-glen-green', 'glen-well', 'place-glen-well', 'glen-well'],
  ['briar-glen-green', 'lamplit-stacks', 'place-lamplit-stacks', 'lamplit-stacks'],
  ['deepworks', 'adit-arrival', 'place-weeping-adit', 'weeping-adit'],
  ['wendmouth-harbour', 'breakwater', 'place-breakwater', 'breakwater'],
];

describe('rumours resolve through the arrival volumes (mw-nh24)', () => {
  it.each(PLACES)(
    'AC-1: a heard rumour of %s/%s ends up investigated on entering %s',
    (scene, spawn, place, area) => {
      expect(VISIT_TRIGGERS[place]).toEqual([{ area }]);
      const rumour = aboutPlace(place);
      const { book, flag, visit } = open(scene);
      book.hear(rumour.id);
      expect(flag(rumour.id, 'investigated')).toBe(false);
      visit(spawn);
      expect(flag(rumour.id, 'investigated')).toBe(true);
    },
  );

  it('AC-2: the false sea serpent is debunked by the breakwater volume', () => {
    const rumour = aboutPlace('place-breakwater');
    expect(rumour.truth).toBe('false');
    const { book, flag, visit } = open('wendmouth-harbour');
    book.hear(rumour.id);
    visit('breakwater');
    expect(flag(rumour.id, 'debunked')).toBe(true);
  });

  it("AC-2: Old Mooring's half-true tower rumour is debunked by the Mooring's Watch volume", () => {
    const rumour = aboutPlace('place-mooring-watch');
    expect(rumour.truth).toBe('half');
    const { book, flag, visit } = open('moorings-watch');
    book.hear(rumour.id);
    visit('tower-roof');
    expect(flag(rumour.id, 'debunked')).toBe(true);
  });

  it('AC-3: a rumour not yet heard is not marked by a visit, and the Millweir has no trigger', () => {
    const rumour = aboutPlace('place-breakwater');
    const { flag, visit } = open('wendmouth-harbour');
    visit('breakwater');
    expect(flag(rumour.id, 'investigated')).toBe(false);
    expect(flag(rumour.id, 'debunked')).toBe(false);
    expect(VISIT_TRIGGERS['place-millweir']).toBeUndefined();
  });
});
