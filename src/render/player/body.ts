// The player's body (mw-e02.23, mw-e02.6): the grey-box humanoid rig in the knight's colours, animated
// from the sim's locomotion. Its origin is the feet and it faces −z (look yaw 0), matching the
// transform the testbed player binds to it. It is drawn at once; when the knight model (mw-e37.21)
// has loaded it takes the boxes' place, posed by the same rig, and if the model never loads the boxes
// stay. The animation runtime does not change.
//
// Render-only (needs a GPU context to draw), so it is excluded from unit coverage and verified by the
// Playwright testbed player e2e (e2e/testbed-player.spec.ts).

import { createGreyboxRig, type GreyboxRig, type Rig } from '../animation/index';
import { createKnightRig, KNIGHT_WRIST, knightHandShare, type KnightAssets } from './knight-model';

/** The player body's tint (the old capsule's parchment). */
export const PLAYER_BODY_COLOUR = 0xd8d2c4;

/**
 * The player's body: `rig` (the grey-box humanoid) as boxes, named "player". With `model`, the boxes
 * give way to the knight once it resolves; a rejected `model` leaves them.
 */
export function createPlayerBody(rig: Rig, model?: Promise<KnightAssets>): GreyboxRig {
  const boxes = createGreyboxRig(rig, PLAYER_BODY_COLOUR);
  boxes.root.name = 'player';
  let knight: GreyboxRig | undefined;
  let drop = 0;
  void model?.then(
    (loaded) => {
      knight = createKnightRig(rig, loaded, {
        wrist: { pivot: KNIGHT_WRIST, hand: knightHandShare },
      });
      knight.lower(drop);
      boxes.root.add(knight.root);
      for (const child of boxes.root.children) {
        if (child !== knight.root) child.visible = false;
      }
    },
    (error: unknown) => {
      console.warn('The knight model did not load; keeping the grey-box body.', error);
    },
  );
  return {
    root: boxes.root,
    apply(pose) {
      boxes.apply(pose);
      knight?.apply(pose);
    },
    lower(metres) {
      drop = metres;
      boxes.lower(metres);
      knight?.lower(metres);
    },
  };
}
