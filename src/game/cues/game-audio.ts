// Game audio wiring (mw-e28.2): the cue bridge on a world's event bus, playing the game's sound
// manifest through the audio engine, so sim events (hits, stagger, physics impacts…) are heard in
// the testbed. Presentation only: the bridge reads events and material lookups and never writes to
// the sim. Nothing plays before the autoplay policy lets the context run (the first user gesture,
// see installGestureUnlock), so sounds from the scene settling at load are dropped, not queued.

import type { CaptionTrigger, PlayOptions, Vec3 } from '@audio/index';
import type { ArrowDefinition, CreatureDef, CueRuleDef, MoveDef } from '@content/index';
import type { EntityId, World } from '@sim/index';
import type { SimView, Transform } from '../loop/render-sync.ts';
import {
  AudioCueBridge,
  soundVariantCount,
  worldCueLookups,
  type CueMaterial,
  type CuePlayer,
} from './audio-bridge.ts';

/** The engine as the wiring uses it (the AudioEngine satisfies it). */
export interface GameAudioEngine extends CuePlayer {
  readonly context: { readonly state: string } | undefined;
}

export interface GameAudioOptions {
  readonly world: World<never>;
  readonly engine: GameAudioEngine;
  /** Variant counts per cue (the engine's SoundRegistry satisfies it). */
  readonly registry: { get(id: string): { readonly variants: readonly string[] } | undefined };
  readonly sheets: readonly { readonly rules: readonly CueRuleDef[] }[];
  readonly materials: readonly CueMaterial[];
  /** Moves, for their own sounds (swing whooshes on ActionPhaseChanged). */
  readonly moves?: readonly Pick<MoveDef, 'id' | 'presentation'>[];
  /** Arrows, for their own impact sounds (arrowImpact's `sound` fact). */
  readonly arrows?: readonly Pick<ArrowDefinition, 'id' | 'cues'>[];
  /** Creatures, for their audio slots (mw-e28.8). */
  readonly creatures?: readonly Pick<CreatureDef, 'id' | 'audio'>[];
  /** Armour weight class of a character, for the footstep armour layer (e04.16 will own it). */
  readonly armorOf?: (entity: EntityId) => string | undefined;
  /** Presentation clock in ms. */
  readonly now: () => number;
  /** Called with each cue actually sent to the engine (debug overlays, e2e probes). */
  readonly onPlay?: (cue: string, options: PlayOptions) => void;
  /** Called for each cue occurrence whose rule carries a caption (mw-e28.14), audio running or not. */
  readonly onCaption?: (caption: CaptionTrigger) => void;
  /** Where an entity is (the same lookup the engine positions its sounds with). */
  readonly positionOf?: (entity: EntityId) => Vec3 | undefined;
}

/** Attaches the cue bridge to the world's events; returns a function that detaches it. */
export function attachGameAudio(options: GameAudioOptions): () => void {
  const { engine, onPlay } = options;
  const player: CuePlayer = {
    play: (cue, playOptions) => {
      if (engine.context?.state !== 'running') return null;
      onPlay?.(cue, playOptions);
      return engine.play(cue, playOptions);
    },
  };
  const bridge = new AudioCueBridge({
    sheets: options.sheets,
    player,
    now: options.now,
    lookups: worldCueLookups(options.world, options.materials, {
      ...(options.moves !== undefined && { moves: options.moves }),
      ...(options.arrows !== undefined && { arrows: options.arrows }),
      ...(options.creatures !== undefined && { creatures: options.creatures }),
      ...(options.armorOf !== undefined && { armorOf: options.armorOf }),
    }),
    variantCount: soundVariantCount(options.registry),
    ...(options.onCaption !== undefined && { onCaption: options.onCaption }),
    ...(options.positionOf !== undefined && { positionOf: options.positionOf }),
  });
  return bridge.attach(options.world.events);
}

/** Reads an entity's transform, if it has the component the reader knows. */
export type EntityTransformReader = (view: SimView, entity: EntityId) => Transform | undefined;

/**
 * Where an entity's sounds come from: the first reader that knows the entity (physics objects,
 * placed characters, static scene pieces…).
 */
export function soundPositions(
  view: SimView,
  readers: readonly EntityTransformReader[],
): (entity: EntityId) => Transform['position'] | undefined {
  return (entity) => {
    for (const read of readers) {
      const transform = read(view, entity);
      if (transform !== undefined) return transform.position;
    }
    return undefined;
  };
}
