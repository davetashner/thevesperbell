// Magical material testbed (mw-e29.7): the `?magic` URL parameter lays the library's materials out in
// front of the camera, one of each, so a screenshot shows them all and the e2e can check them.
//
//   ?magic=materials   dissolve at four stages and live, fresnel glow, emissive pulse, rune decal,
//                      heat haze (High only) and soft particles beside hard ones (AC-1 smoke)
//   ?magic=haze        six overlapping heat hazes over a busy backdrop (AC-4 perf)
//   &quality=low       draws it on the Low tier whatever the setting says (AC-2)
//
// This file is the layout and parsing; demo.ts builds the objects.
// The demo takes the camera over for as long as it runs.

import type { VfxQualityTier } from '@content/index';
import type { Vec3 } from '@sim/index';

export type MagicDemoMode = 'materials' | 'haze';

/** `?magic=materials` / `?magic=haze` → that mode; `?magic` alone → materials; absent → undefined. */
export function parseMagicParam(search: string): MagicDemoMode | undefined {
  const value = new URLSearchParams(search).get('magic');
  if (value === null) return undefined;
  return value === 'haze' ? 'haze' : 'materials';
}

/** `?quality=low` / `?quality=high` → that tier, anything else → undefined (use the setting). */
export function parseQualityParam(search: string): VfxQualityTier | undefined {
  const value = new URLSearchParams(search).get('quality');
  return value === 'low' || value === 'high' ? value : undefined;
}

/** Dissolve progress of the four fixed dissolves of the materials demo. */
export const DISSOLVE_STAGES: readonly number[] = [0, 0.35, 0.65, 0.9];
/** Seconds one loop of the live dissolve takes. */
export const DISSOLVE_LOOP_SECONDS = 3.2;
/** Heat hazes in the haze (perf) mode: AC-4 asks for six. */
export const HAZE_COUNT = 6;

/** Progress of the live dissolve at `seconds`: a ramp from whole to gone, then it starts over. */
export function dissolveLoop(seconds: number): number {
  const phase =
    (((seconds % DISSOLVE_LOOP_SECONDS) + DISSOLVE_LOOP_SECONDS) % DISSOLVE_LOOP_SECONDS) /
    DISSOLVE_LOOP_SECONDS;
  return Math.min(phase / 0.85, 1);
}

/** What the demo shows in its rows. */
export type DemoItem =
  | 'dissolve-0'
  | 'dissolve-1'
  | 'dissolve-2'
  | 'dissolve-3'
  | 'dissolve-live'
  | 'fresnel'
  | 'pulse'
  | 'rune'
  | 'haze'
  | 'soft'
  | 'hard';

export interface DemoSlot {
  readonly item: DemoItem;
  /** Metres ahead of the stage origin. */
  readonly depth: number;
  /** Metres to the viewer's right of the stage origin. */
  readonly across: number;
}

const SPACING = 2.2;

/** Where each item stands: dissolves in the near row, everything else behind them. */
export const DEMO_SLOTS: readonly DemoSlot[] = [
  ...(['dissolve-0', 'dissolve-1', 'dissolve-2', 'dissolve-3', 'dissolve-live'] as const).map(
    (item, i): DemoSlot => ({ item, depth: -1.6, across: (i - 2) * SPACING }),
  ),
  ...(['fresnel', 'pulse', 'rune', 'haze', 'soft', 'hard'] as const).map((item, i): DemoSlot => ({
    item,
    depth: 1.6,
    across: (i - 2.5) * SPACING,
  })),
];

/** The ground point of slot `slot` for a stage at `origin` facing `forward` (unit, horizontal). */
export function slotPosition(slot: DemoSlot, origin: Vec3, forward: Vec3): Vec3 {
  // Viewer's right is forward turned a quarter clockwise seen from above.
  const right = { x: -forward.z, z: forward.x };
  return {
    x: origin.x + forward.x * slot.depth + right.x * slot.across,
    y: origin.y,
    z: origin.z + forward.z * slot.depth + right.z * slot.across,
  };
}

/**
 * The stage stands high above the testbed, out of its walls and props: the demo takes the camera
 * over (see cameraPose), so a screenshot shows the materials against a plain dark backdrop.
 */
export const STAGE_ORIGIN: Vec3 = Object.freeze({ x: 0, y: 120, z: 0 });
/** The stage faces −z. */
export const STAGE_FORWARD: Vec3 = Object.freeze({ x: 0, y: 0, z: -1 });

/** What the camera frames: everything, the dissolves, or one item (`&focus=`). */
export type DemoFocus = 'overview' | 'dissolves' | DemoItem;

/** `?focus=fresnel` etc. → that focus; absent or unknown → the overview. */
export function parseFocusParam(search: string): DemoFocus {
  const value = new URLSearchParams(search).get('focus');
  if (value === 'dissolves') return value;
  return DEMO_SLOTS.some((slot) => slot.item === value) ? (value as DemoItem) : 'overview';
}

/** The items a focus shows: all of them for the overview, otherwise just those it frames. */
export function focusItems(focus: DemoFocus): readonly DemoItem[] {
  if (focus === 'overview') return DEMO_SLOTS.map((slot) => slot.item);
  if (focus === 'dissolves') {
    return DEMO_SLOTS.filter((slot) => slot.item.startsWith('dissolve-')).map((s) => s.item);
  }
  // The two puffs only mean something side by side.
  return focus === 'soft' || focus === 'hard' ? ['soft', 'hard'] : [focus];
}

/** Where the camera stands and what it looks at for a stage at `origin` facing −z. */
export function cameraPose(
  origin: Vec3,
  focus: DemoFocus = 'overview',
): { position: Vec3; target: Vec3 } {
  if (focus === 'overview') {
    return {
      position: { x: origin.x, y: origin.y + 8.2, z: origin.z + 7.6 },
      target: { x: origin.x, y: origin.y + 0.2, z: origin.z },
    };
  }
  const shown = focusItems(focus);
  const spots = DEMO_SLOTS.filter((slot) => shown.includes(slot.item)).map((slot) =>
    slotPosition(slot, origin, STAGE_FORWARD),
  );
  const xs = spots.map((spot) => spot.x);
  const centre = (Math.min(...xs) + Math.max(...xs)) / 2;
  const span = Math.max(...xs) - Math.min(...xs);
  const at = spots[0] ?? origin;
  return {
    position: { x: centre, y: at.y + 1.6, z: at.z + 3.4 + span * 0.3 },
    target: { x: centre, y: at.y + 0.8, z: at.z },
  };
}

/** Where the six hazes of the perf mode go: two rows of three, 0.8 m apart, overlapping. */
export function hazePlacements(origin: Vec3, forward: Vec3): Vec3[] {
  const right = { x: -forward.z, z: forward.x };
  return Array.from({ length: HAZE_COUNT }, (_, i) => {
    const column = (i % 3) - 1;
    const row = Math.floor(i / 3);
    return {
      x: origin.x + right.x * column * 0.8 + forward.x * row * 0.7,
      y: origin.y + 1.1 + row * 0.35,
      z: origin.z + right.z * column * 0.8 + forward.z * row * 0.7,
    };
  });
}
