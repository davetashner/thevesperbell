// @vitest-environment happy-dom
// mw-e15.5 AC-4: a sound clue cue is gameplay-critical, so with subtitles on it shows a caption with
// its direction. The path under test is the real one: a clue node of a signal graph emits
// soundClueCued, the shipped `puzzle-clues` cue sheet turns it into a positional sound and a caption
// trigger, and the caption glue words it ("[High chime, left]").
import { describe, expect, it } from 'vitest';
import { CaptionTracker, type CaptionTrigger, type ListenerPose } from '@audio/index';
import { loadGameContent } from '@content/index';
import {
  addProperties,
  addSignalGraph,
  installSignals,
  installStimuli,
  pressButton,
  registerWorldProperties,
  signalSystem,
  World,
  type SignalGraphDef,
} from '@sim/index';
import { SoundCaptions } from '@ui/index';
import { AudioCueBridge } from '../cues/audio-bridge';
import { attachSoundCaptions } from './sound-captions';

const content = loadGameContent();
const HZ = 10;
// Facing -z: +x is to the right, so a source at x = -5 is on the left.
const POSE: ListenerPose = {
  position: { x: 0, y: 0, z: 0 },
  forward: { x: 0, y: 0, z: -1 },
  up: { x: 0, y: 1, z: 0 },
};

const CHIMES: SignalGraphDef = {
  id: 'chimes',
  nodes: [
    { id: 'listen', kind: 'button' },
    {
      id: 'play',
      kind: 'clue',
      cues: ['chime-high', 'chime-low', 'chime-mid'],
      entity: 'source',
    },
  ],
  wires: [{ from: 'listen', to: 'play' }],
};

function setup(subtitles: boolean) {
  const world = installSignals(
    installStimuli(registerWorldProperties(new World<never>({ seed: 3, hz: HZ }))),
  ).addSystem(signalSystem());
  const source = world.spawn();
  addProperties(world, source, {});
  const graph = addSignalGraph(world, CHIMES, { bindings: { source } });
  const widget = new SoundCaptions();
  let now = 0;
  const glue = attachSoundCaptions({
    tracker: new CaptionTracker(() => POSE),
    widget,
    enabled: () => subtitles,
    size: () => 'medium',
    now: () => now,
  });
  const triggers: CaptionTrigger[] = [];
  const played: string[] = [];
  const bridge = new AudioCueBridge({
    sheets: content.all('cue-sheet'),
    player: { play: (cue) => played.push(cue) },
    now: () => now,
    positionOf: (entity) => (entity === source ? { x: -5, y: 1, z: -1 } : undefined),
    onCaption: (caption) => {
      triggers.push(caption);
      glue.trigger(caption);
    },
  });
  bridge.attach(world.events);
  const texts = () =>
    [...widget.element.querySelectorAll('.vb-caption-text')].map((e) => e.textContent);
  /** Presses listen and runs one cue at a time, reading the screen after each. */
  const run = (): (string | null)[][] => {
    const shown: (string | null)[][] = [];
    pressButton(world, graph, 'listen');
    for (let i = 0; i < 3; i++) {
      world.step();
      glue.frame(now);
      shown.push(texts());
      for (let t = 1; t < HZ; t++) {
        world.step();
        now += 100;
      }
    }
    return shown;
  };
  return { run, triggers, played };
}

describe('sound clue captions (mw-e15.5)', () => {
  it('AC-4: with subtitles on, each clue cue shows its caption with a direction label', () => {
    const { run, triggers, played } = setup(true);
    const shown = run();
    expect(triggers.map((t) => t.stringId)).toEqual([
      'caption.clue.chime-high',
      'caption.clue.chime-low',
      'caption.clue.chime-mid',
    ]);
    // The cue is positional: it plays from the source (the bridge hands the position on).
    expect(triggers.every((t) => t.position.x === -5)).toBe(true);
    expect(played).toHaveLength(3);
    // The first caption reads [High chime, left]; the next arrive a second apart and join it.
    expect(shown[0]).toEqual(['[High chime, left]']);
    expect(shown[1]).toContain('[Low chime, left]');
  });

  it('AC-4 edge: with subtitles off, the cues still sound and nothing is shown', () => {
    const { run, played } = setup(false);
    expect(run().flat()).toEqual([]);
    expect(played).toHaveLength(3);
  });
});
