// Placeholder creature bodies (mw-e12.4): every spawned creature is drawn as a grey-box capsule the
// size of its nav agent (the `placeholder-capsule` mesh of CreatureDef.presentation) until its own
// mesh lands with the asset integration beads. Origin at the feet, facing +z: a dark visor on the
// front shows which way it faces. A creature carrying attacks is rust-red, one without is slate, so
// a glance tells what might fight back.
//
// The `placeholder-capsule-bones` mesh (the Forgotten, mw-e13.1) adds pale bones over the capsule: a
// skull, a spine down its back and ribs across its chest, so a skeleton reads as one before its
// model lands. Once the miner's model has loaded (mw-2l9, forgotten-model.ts) it takes the capsule's
// place, scaled to the creature's height, skinned to the animation rig when the caller gives one (miner-rig.ts); if it never loads the capsule stays. Any other mesh id
// draws the plain capsule.
//
// Telegraphs (mw-e04.20): while a creature winds up a telegraphed move its body glows — ember for a
// swing a parry deflects, pale steel for one only a shield stops, red for an unblockable move or a
// grab — until the move turns active. `showCreatureTelegraph` only touches the body's material when
// the game reports a change, so idle creatures cost nothing per frame.
//
// Render-only (needs a GPU context to draw), so it is excluded from unit coverage and verified by the
// Playwright creature e2e (e2e/creatures.spec.ts).

import {
  BoxGeometry,
  CapsuleGeometry,
  Color,
  Group,
  Mesh,
  MeshStandardMaterial,
  SphereGeometry,
  type Object3D,
} from 'three';
import type { GreyboxRig, Rig } from '../animation/index';
import { createKnightRig } from '../player/knight-model';
import { loadForgottenMiner } from './forgotten-model';
import { COLLAPSE_PIVOT } from './death';
import { setBodyGlow } from './hit-flash';
import { minerRigAssets, RIG_HEIGHT } from './miner-rig';

const SLATE = 0x6f7f8c;
const RUST = 0x9c4a32;
const VISOR = 0x22222e;
const BONE = 0xd8cfb4;

/** The mesh id that draws the capsule with bones (see the file header). */
export const CAPSULE_BONES_MESH = 'placeholder-capsule-bones';

/** Body glow per telegraph look (see the file header). */
const TELEGRAPH_GLOW = { parry: 0xe0912e, block: 0xc8d4e8, unblockable: 0xd2321e } as const;

/** How a creature's telegraph reads (the game's TelegraphLook). */
export type CreatureTelegraphLook = keyof typeof TELEGRAPH_GLOW;

export { CreatureDeaths } from './death';
export { HIT_FLASH_MS, HitFlashes } from './hit-flash';

/** Where a posed miner is wanted: the rig to skin it to, and who poses it once it is drawn. */
export interface CreatureAnimation {
  readonly rig: Rig;
  /** Called once the model has loaded, with the skinned view to pose (`apply`) each frame. */
  readonly attach: (view: GreyboxRig) => void;
}

/** A capsule body of `radius` and `height` metres, feet at the origin; see the file header. */
export function createCreatureProxy({
  id,
  radius,
  height,
  armed,
  mesh,
  variant,
  animation,
}: {
  readonly id: string;
  readonly radius: number;
  readonly height: number;
  readonly armed: boolean;
  /** CreatureDef.presentation.mesh; absent = the plain capsule. */
  readonly mesh?: string | undefined;
  /** Which of the miner's looks to wear (0 to 3; see variant.ts); absent = the first. */
  readonly variant?: number | undefined;
  /** Skin the miner to an animation rig and hand it to `attach`; absent = a static model. */
  readonly animation?: CreatureAnimation | undefined;
}): Object3D {
  const group = new Group();
  group.name = `creature:${id}`;
  // Everything drawn hangs from the pivot at the feet, so a fallen creature can topple about them.
  const pivot = new Group();
  pivot.name = COLLAPSE_PIVOT;
  group.add(pivot);
  const length = Math.max(height - 2 * radius, 0);
  const skin = new MeshStandardMaterial({ color: new Color(armed ? RUST : SLATE), roughness: 1 });
  const body = new Mesh(new CapsuleGeometry(radius, length, 4, 12), skin);
  body.name = 'body';
  body.position.y = radius + length / 2;
  const visor = new Mesh(
    new BoxGeometry(radius * 1.2, Math.min(0.12, height * 0.15), radius * 0.5),
    new MeshStandardMaterial({ color: new Color(VISOR), roughness: 0.6 }),
  );
  visor.position.set(0, Math.max(height - radius * 0.9, radius), radius * 0.8);
  const parts = [body, visor, ...(mesh === CAPSULE_BONES_MESH ? bones(radius, height) : [])];
  for (const part of parts) {
    part.castShadow = true;
    part.receiveShadow = true;
    pivot.add(part);
  }
  if (mesh === CAPSULE_BONES_MESH) {
    void loadForgottenMiner(variant, id).then(
      (assets) => {
        // The model takes the capsule's place; its body is the one the telegraph glow finds.
        for (const part of parts) part.visible = false;
        body.name = 'proxy-body';
        if (animation !== undefined) {
          // Posed by the shared humanoid rig, which faces −z: the creature faces +z, so it is turned.
          const view = createKnightRig(animation.rig, minerRigAssets(animation.rig, assets), {
            name: 'model',
            meshName: 'body',
          });
          view.root.scale.setScalar(height / RIG_HEIGHT);
          view.root.rotation.y = Math.PI;
          pivot.add(view.root);
          animation.attach(view);
          return;
        }
        assets.body.geometry.computeBoundingBox();
        const scale = height / (assets.body.geometry.boundingBox?.max.y ?? height);
        const model = new Group();
        model.name = 'model';
        model.scale.setScalar(scale);
        // A material of its own, so one miner's telegraph glow does not light the others.
        const skeleton = new Mesh(assets.body.geometry, assets.body.material.clone());
        skeleton.name = 'body';
        skeleton.castShadow = true;
        skeleton.receiveShadow = true;
        model.add(skeleton);
        for (const [held, name] of [
          [assets.pick, 'pick'],
          [assets.offhand, 'offhand'],
        ] as const) {
          if (held === undefined) continue;
          const prop = new Mesh(held.geometry, held.material);
          prop.name = name;
          prop.castShadow = true;
          prop.receiveShadow = true;
          model.add(prop);
        }
        pivot.add(model);
      },
      (error: unknown) => {
        console.warn('The Forgotten miner model did not load; keeping the capsule.', error);
      },
    );
  }
  return group;
}

/** A skull, a spine and four ribs over a capsule of `radius` and `height`, facing +z. */
function bones(radius: number, height: number): Mesh[] {
  const bone = new MeshStandardMaterial({ color: new Color(BONE), roughness: 0.9 });
  const skull = new Mesh(new SphereGeometry(radius * 0.55, 10, 8), bone);
  skull.position.set(0, height - radius * 0.35, radius * 0.25);
  const spine = new Mesh(new BoxGeometry(radius * 0.18, height * 0.55, radius * 0.18), bone);
  spine.position.set(0, height * 0.5, -radius * 0.95);
  const ribs = [0.42, 0.5, 0.58, 0.66].map((fraction) => {
    const rib = new Mesh(new BoxGeometry(radius * 2.1, radius * 0.1, radius * 0.12), bone);
    rib.position.set(0, height * fraction, radius * 0.92);
    return rib;
  });
  return [skull, spine, ...ribs];
}

/** Lights `proxy`'s body for a telegraph of `look`, or puts it out (null). */
export function showCreatureTelegraph(proxy: Object3D, look: CreatureTelegraphLook | null): void {
  setBodyGlow(
    proxy,
    look === null ? { hex: 0, intensity: 0 } : { hex: TELEGRAPH_GLOW[look], intensity: 0.85 },
  );
}
