// The shanghai loop in the running game (mw-e40.30, bible 4.5 and 5.14): losing the Drowned Gull's
// crew table wakes the player in the Gilded Tern's hold, and Hesketh settles the matter on deck.
//
// - Losing. The crew-table contest (drowned-gull-crew-dice) writes `hesketh.shanghaied` when the
//   player loses it; an ordinary loss at the Gull writes nothing. When that contest ends with the
//   fact set, a narration window plays (the fade, and the sim is paused behind it), the player is
//   moved to the `tern-hold-wake` spawn, the game clock moves WAKE_HOURS on and a toast says where
//   the Captain is. A save carried across a loss that never woke the player starts nothing.
// - The Captain. While `hesketh.shanghaied` is set Hesketh stands at the `tern-captain-post` spawn
//   on deck (his leash post moves with him, so he stays put) and otherwise at his own post on the
//   quay. His `shanghai` dialogue entry then plays when the player talks to him. The move waits
//   until the conversation that cleared the fact has ended, so he never leaves mid-sentence.
// - `afterStep` runs once per sim step.

import {
  CreatureComponent,
  ContestEnded,
  gameClockOf,
  isConversing,
  PlacementComponent,
  placeEntity,
  SceneSpawnComponent,
  SceneTransformComponent,
  type EntityId,
  type Vec3,
  type World,
} from '@sim/index';
import {
  openEpilogueSlideshow,
  type EpilogueSlideModel,
  type EpilogueSlideshow,
  type UiRoot,
} from '@ui/index';
import { npcResolver } from '../conversation/npcs';

/** The fact the crew table's loss writes and Hesketh's dialogue clears. */
export const SHANGHAIED_FACT = 'hesketh.shanghaied';
/** The contest whose loss shanghais the player. */
export const SHANGHAI_CONTEST = 'drowned-gull-crew-dice';
/** Where the player wakes, and where the Captain waits while they are on his articles. */
export const WAKE_SPAWN = 'tern-hold-wake';
export const CAPTAIN_SPAWN = 'tern-captain-post';
export const HESKETH = 'npc-hesketh';
/** Game hours that pass while the player is out. */
export const WAKE_HOURS = 6;
/** `data-screen` of the narration window. */
export const SHANGHAI_SCREEN = 'shanghai';

export const SHANGHAI_PAGES: readonly EpilogueSlideModel[] = Object.freeze([
  {
    id: 'shanghai-0',
    title: 'Shanghaied',
    text: 'The last die lands the wrong way up. Somebody pats your shoulder, somebody else pushes a cup into your hand, and the Drowned Gull tips sideways and goes out.',
  },
  {
    id: 'shanghai-1',
    text: 'You wake to the creak of timber and the smell of tar and bilge, among crates that are not yours. The Gilded Tern lies still on the water above you. Somewhere on deck, a captain is waiting to explain the articles you have signed.',
  },
]);

export const WAKE_TOAST =
  'You wake in the Gilded Tern’s hold. Climb the ladder and speak to Captain Hesketh on deck.';

export interface ShanghaiUiOptions {
  readonly ui: UiRoot;
  readonly world: World<never>;
  readonly player: EntityId;
  /** Moves the player to a point (a debug teleport command in the game). */
  readonly teleport: (entity: EntityId, to: Vec3) => void;
  readonly toast: (text: string) => void;
}

/** The shanghai loop in a running game. */
export interface ShanghaiUi {
  /** Call after every sim step. */
  afterStep(): void;
}

/** Wires the crew-table loss to the hold wake and keeps the Captain where the story needs him. */
export function startShanghaiUi(options: ShanghaiUiOptions): ShanghaiUi {
  const { ui, world, player, teleport, toast } = options;
  let pending = false;
  let narration: EpilogueSlideshow | undefined;
  const spawnAt = (id: string): Vec3 | undefined => {
    if (!world.isRegistered(SceneSpawnComponent)) return undefined;
    for (const entity of world.query(SceneSpawnComponent).ids()) {
      if (world.get(entity, SceneSpawnComponent)?.id === id) {
        return world.get(entity, SceneTransformComponent)?.position;
      }
    }
    return undefined;
  };
  world.events.on(ContestEnded, ({ contest, outcome }) => {
    if (
      contest === SHANGHAI_CONTEST &&
      outcome === 'lost' &&
      world.facts.get(SHANGHAIED_FACT) === true
    ) {
      pending = true;
    }
  });
  const wake = (): void => {
    const to = spawnAt(WAKE_SPAWN);
    if (to === undefined) return;
    teleport(player, to);
    gameClockOf(world)?.advanceTime(WAKE_HOURS * 60, 'shanghai');
    narration = openEpilogueSlideshow(ui, {
      slides: SHANGHAI_PAGES,
      screenId: SHANGHAI_SCREEN,
      label: 'Narration',
      unit: 'Page',
      onEnd: () => {
        narration = undefined;
        toast(WAKE_TOAST);
      },
    });
  };
  /** Hesketh at the deck post while the player is on his articles, at his own post otherwise. */
  const seatCaptain = (): void => {
    const captain = npcResolver(world)(HESKETH);
    const creature = captain === undefined ? undefined : world.get(captain, CreatureComponent);
    const leash = creature?.origin.leash;
    if (captain === undefined || creature === undefined || leash === undefined) return;
    if (isConversing(world, captain)) return;
    const post =
      world.facts.get(SHANGHAIED_FACT) === true ? spawnAt(CAPTAIN_SPAWN) : creature.origin.at;
    if (
      post === undefined ||
      (post.x === leash.post.x && post.z === leash.post.z && post.y === leash.post.y)
    ) {
      return;
    }
    world.set(captain, CreatureComponent, {
      ...creature,
      origin: { ...creature.origin, leash: { ...leash, post } },
    });
    placeEntity(world, captain, post, world.get(captain, PlacementComponent)?.radius ?? 0);
  };
  return {
    afterStep: () => {
      seatCaptain();
      if (pending && ui.top === undefined && narration === undefined) {
        pending = false;
        wake();
      }
    },
  };
}
