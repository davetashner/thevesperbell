// Sound caption glue (mw-e28.14): takes the captioned cues the audio cue bridge reports, runs them
// through the caption tracker (range, de-dupe, priority; src/audio/captions.ts) and hands the caption
// widget the words and arrow angles each drawn frame. Presentation only: it reads nothing from the
// sim. Captions are off until the player turns them on in Accessibility settings.
//
// Text comes from the string table: "[{sound}, {direction}]" filled with the rule's caption string
// and the direction sector's string, e.g. "[Footsteps, behind left]". The player's own sounds are
// never captioned.

import type { CaptionTracker, CaptionTrigger } from '@audio/index';
import { formatString } from '@content/index';
import type { CaptionSize, SoundCaptions } from '@ui/index';

export interface SoundCaptionsGlueOptions {
  readonly tracker: CaptionTracker;
  readonly widget: SoundCaptions;
  /** Whether captions are on (the `accessibility.captions` setting). */
  readonly enabled: () => boolean;
  /** The caption size (the `accessibility.captionSize` setting). */
  readonly size: () => CaptionSize;
  /** True for sources that must not be captioned (the player's own footsteps). */
  readonly ignore?: (source: string) => boolean;
  /** Presentation clock in ms (the same clock the frame calls pass). */
  readonly now: () => number;
}

/** What the glue has measured, for the e2e probe. */
export interface SoundCaptionsStats {
  /** Captions on screen now. */
  readonly shown: number;
  /** ms from the latest new caption being reported to it being handed to the widget, or null. */
  readonly latencyMs: number | null;
}

export interface SoundCaptionsGlue {
  /** The cue bridge's `onCaption`. */
  trigger(caption: CaptionTrigger): void;
  /** Call once per drawn frame. */
  frame(nowMs: number): void;
  stats(): SoundCaptionsStats;
}

export function attachSoundCaptions(options: SoundCaptionsGlueOptions): SoundCaptionsGlue {
  const { tracker, widget, enabled, size, ignore, now } = options;
  let startedAt: number | undefined;
  let shown = 0;
  let latencyMs: number | null = null;
  return {
    trigger(caption) {
      if (!enabled() || ignore?.(caption.source) === true) return;
      const at = now();
      if (tracker.trigger(caption, at)) startedAt ??= at;
    },
    stats: () => ({ shown, latencyMs }),
    frame(nowMs) {
      if (!enabled()) {
        tracker.clear();
        startedAt = undefined;
        shown = 0;
        widget.update({ enabled: false, size: size(), captions: [] });
        return;
      }
      const visible = tracker.visible(nowMs);
      shown = visible.length;
      if (startedAt !== undefined && shown > 0) {
        latencyMs = Math.round((now() - startedAt) * 10) / 10;
        startedAt = undefined;
      }
      widget.update({
        enabled: true,
        size: size(),
        captions: visible.map((c) => ({
          key: c.key,
          bearingDeg: c.bearingDeg,
          text: formatString('caption.format', {
            sound: formatString(c.stringId),
            direction: formatString(`caption.direction.${c.sector}`),
          }),
        })),
      });
    },
  };
}
