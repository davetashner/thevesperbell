// mw-heoa on real content, headless: the arrival volumes of the rumour targets that had none. Each
// scene is loaded the way the game wires it, the player is put at a named spawn and the volume of
// that place fires volumeEntered with the area id (the node id), which the rumour book's visit
// triggers (src/game/rumours) and any enterArea objective read. AC-1: Briarwood and the Standing
// Horn. AC-2: Mooring's Watch. AC-3: the Glen Well and the Lamplit Stacks. AC-4: the Weeping Adit.
// AC-5: the Breakwater. The Millweir has no scene yet (mw-heoa follow-up), so it has no volume.
import * as RAPIER from '@dimforge/rapier3d-deterministic';
import { describe, expect, it } from 'vitest';
import { loadGameContent } from '@content/index';
import {
  actionButton,
  actionFrame,
  actionVector,
  teleportCommand,
  volumeEntered,
  type ActionFrame,
} from '@sim/index';
import { createGameWorld } from '@tools/replay/testbed-player-scenario';

const content = loadGameContent();
const IDLE = actionFrame({
  move: actionVector(0, 0),
  look: actionVector(0, 0),
  buttons: () => actionButton(false, false, false),
});
type Input = ActionFrame | ReturnType<typeof teleportCommand>;

/** `scene` loaded as the game does; `visit` puts the player at a spawn and lists the volumes entered. */
function open(scene: string) {
  const game = createGameWorld<Input>(RAPIER, { seed: 3, hz: 60, scene, magic: true });
  const entered: string[] = [];
  game.world.events.on(volumeEntered, ({ node, entity }) => {
    if (entity === game.player) entered.push(node);
  });
  const settle = (ticks = 10): void => {
    for (let i = 0; i < ticks; i++) game.world.step([IDLE]);
  };
  settle();
  const spawn = (id: string) => {
    const found = content.get('scene', scene).spawns.find((s) => s.id === id);
    if (found === undefined) throw new Error(`no spawn ${id} in ${scene}`);
    return { x: found.at[0], y: found.at[1] + 0.5, z: found.at[2] };
  };
  const visit = (id: string): string[] => {
    // Leave every volume first, so that arriving is a fresh entry whatever the scene started in.
    game.world.step([teleportCommand(game.player, { x: 5000, y: 50, z: 5000 })]);
    settle();
    entered.length = 0;
    game.world.step([teleportCommand(game.player, spawn(id))]);
    settle();
    return [...entered];
  };
  return { visit, entered };
}

describe('arrival volumes of the rumour targets (mw-heoa)', () => {
  it('AC-1: the town gate trail is the briarwood area and the Standing Horn clearing its own', () => {
    const { visit } = open('briarwood');
    expect(visit('town-gate')).toContain('briarwood');
    expect(visit('standing-horn')).toContain('standing-horn');
    expect(visit('standing-horn')).not.toContain('briarwood');
  });

  it("AC-2: the spur gate, the courtyard and the tower are all Mooring's Watch", () => {
    const { visit } = open('moorings-watch');
    expect(visit('spur-gate')).toContain('mooring-watch');
    expect(visit('moorings-courtyard')).toContain('mooring-watch');
    expect(visit('tower-roof')).toContain('mooring-watch');
  });

  it('AC-3: the Glen Well and the Lamplit Stacks are areas of Market Green', () => {
    const { visit } = open('briar-glen-green');
    expect(visit('glen-well')).toContain('glen-well');
    expect(visit('lamplit-stacks')).toContain('lamplit-stacks');
    expect(visit('lamplit-stacks')).not.toContain('glen-well');
  });

  it('AC-4: the arrival of the Weeping Adit is the weeping-adit area, not the mine gate', () => {
    const { visit } = open('deepworks');
    expect(visit('adit-arrival')).toContain('weeping-adit');
    expect(visit('mine-gate')).not.toContain('weeping-adit');
    expect(visit('mine-gate')).toContain('mine-gate');
  });

  it('AC-5: the breakwater wall is the breakwater area, and the Stone Wharf is not', () => {
    const { visit } = open('wendmouth-harbour');
    expect(visit('breakwater')).toContain('breakwater');
    expect(visit('night-watchman-post')).not.toContain('breakwater');
  });
});
