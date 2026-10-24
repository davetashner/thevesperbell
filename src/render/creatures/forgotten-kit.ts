// What each Forgotten wears and carries (mw-ju8.35): the miner keeps its skeleton and pick, the brute
// is a bigger armoured skeleton with a two-handed maul, the archer holds a bow in its left hand and the
// shield-bearer straps a battered iron shield to its left forearm. Pure data and arithmetic (no GPU),
// so it is unit-tested; forgotten-model.ts loads the files and the creature proxy draws them.
//
// All placements are in the body model's own space (feet at the origin, facing +z, so the right hand
// is on −x and the left on +x), before it is scaled to the creature's height or skinned to the rig.

import type { Vector3 } from 'three';
import type { Placement } from '../models/glb';

/** Which skeleton a Forgotten has. */
export type ForgottenBody = 'miner' | 'brute';
/** What it holds in its right hand (a pick or a maul) and on its left (a bow or a shield). */
export type ForgottenRight = 'pick' | 'maul';
export type ForgottenLeft = 'bow' | 'shield';

/** A Forgotten's body and gear. */
export interface ForgottenKit {
  readonly body: ForgottenBody;
  readonly right?: ForgottenRight;
  readonly left?: ForgottenLeft;
}

const MINER_KIT: ForgottenKit = { body: 'miner', right: 'pick' };

/** Per creature id; anything not listed (including no id) is the miner's kit, unchanged. */
const KITS: Readonly<Record<string, ForgottenKit>> = {
  'forgotten-brute': { body: 'brute', right: 'maul' },
  'forgotten-archer': { body: 'miner', left: 'bow' },
  'forgotten-shield-bearer': { body: 'miner', left: 'shield' },
};

/** The kit of creature `id`. */
export function forgottenKit(id?: string): ForgottenKit {
  return (id === undefined ? undefined : KITS[id]) ?? MINER_KIT;
}

/** Where the brute's skeleton is served from. */
export const BRUTE_BODY_URL = '/assets/model/model-creature-forgotten-brute-01.glb';
/** Where each prop is served from. */
export const PROP_URLS = {
  pick: '/assets/model/model-prop-miner-pick-01.glb',
  maul: '/assets/model/model-prop-brute-maul-01.glb',
  bow: '/assets/model/model-prop-forgotten-bow-01.glb',
  shield: '/assets/model/model-prop-forgotten-shield-01.glb',
} as const;

/**
 * The pick in the right hand: Tripo leaves it tilted 17.9° in the y-z plane, so +17.9° about x stands
 * the haft upright; the head swings fore and aft. The butt sits 0.12 m below `hand`.
 */
export function pickPlacement(hand: Vector3): Placement {
  return {
    rotateDeg: [17.9, 0, 0],
    length: 0.85,
    anchor: 'bottom',
    offset: [hand.x, hand.y - 0.12, hand.z],
  };
}

/**
 * The maul in the brute's right hand: Tripo's head lies along the model's x, turned 90° about y so it
 * swings fore and aft (its faces strike forward), 1.6 m long with the grip a third of the way up.
 */
export function maulPlacement(hand: Vector3): Placement {
  return {
    rotateDeg: [0, 90, 0],
    length: 1.6,
    anchor: 'bottom',
    offset: [hand.x, hand.y - 0.5, hand.z],
  };
}

/**
 * The bow in the left hand, limbs upright, belly outward and the string toward the body (so it reads
 * as a bow from the front): Tripo's bow bulges toward +z, so +90° about y turns the belly to +x, the
 * left. 1.15 m tall, its grip at `hand`, held a little forward of the palm.
 */
export function bowPlacement(hand: Vector3): Placement {
  return {
    rotateDeg: [0, 90, 0],
    length: 1.15,
    anchor: 'centre',
    offset: [hand.x, hand.y, hand.z + 0.05],
  };
}

/**
 * The shield on the left forearm, face forward: Tripo's shield faces +x, so −90° about y turns it to
 * +z. 0.8 m tall, centred just above the hand and in front of the arm.
 */
export function shieldPlacement(hand: Vector3): Placement {
  return {
    rotateDeg: [0, -90, 0],
    length: 0.8,
    anchor: 'centre',
    offset: [hand.x, hand.y + 0.12, hand.z + 0.2],
  };
}
