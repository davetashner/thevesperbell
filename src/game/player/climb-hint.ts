// The prompt shown when a climb is refused (mw-e10.9): the knight jumps at a rough wall, a climber
// meets a face harder than its best. The sim says why once (`climb.refused`); this turns it into
// the Interact prompt's greyed state for a moment, so "you cannot climb that" reads on screen.
import type { ClimbRefused } from '@sim/index';
import type { InteractPromptModel } from '@ui/index';

/** How long a refusal stays on screen, ms of the draw clock. */
export const CLIMB_HINT_MS = 2500;

/** A refusal being shown. */
export interface ClimbHint {
  readonly text: string;
  /** The draw-clock time it goes, ms. */
  readonly until: number;
}

/** The hint for a refusal seen at `nowMs`. */
export function climbHintOf(refused: Pick<ClimbRefused, 'text'>, nowMs: number): ClimbHint {
  return { text: refused.text, until: nowMs + CLIMB_HINT_MS };
}

/** The greyed "Climb" prompt for a live hint, or null once it has expired (or with none). */
export function climbHintModel(
  hint: ClimbHint | undefined,
  nowMs: number,
): InteractPromptModel | null {
  if (hint === undefined || nowMs >= hint.until) return null;
  return {
    glyph: '',
    label: 'Climb',
    available: false,
    reason: hint.text,
    hold: false,
    progress: 0,
  };
}
