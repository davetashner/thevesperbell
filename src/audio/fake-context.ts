// Hand-written AudioContext test double (mw-e28.1). Node has no Web Audio, so src/audio's tests run
// the engine against this: it records the node graph, param writes and scheduled ramps, and lets
// tests drive time, `resume()`, decode success/failure and `ended` events. Deliberately small; it
// implements exactly the web-audio.ts interfaces. Not exported from index.ts (test-only), but kept in
// src/audio so later audio beads (mixer, occlusion, reverb) reuse it.
import type {
  AudioBufferLike,
  AudioBufferSourceNodeLike,
  AudioContextLike,
  AudioListenerLike,
  AudioNodeLike,
  AudioParamLike,
  BiquadFilterNodeLike,
  DynamicsCompressorNodeLike,
  GainNodeLike,
  PannerNodeLike,
} from './web-audio.ts';

/** A scheduled automation event, for assertions. */
export type ParamEvent =
  | { readonly type: 'set'; readonly value: number; readonly time: number }
  | { readonly type: 'ramp'; readonly value: number; readonly time: number }
  | { readonly type: 'cancel'; readonly time: number };

export class FakeParam implements AudioParamLike {
  value: number;
  readonly events: ParamEvent[] = [];

  constructor(value: number) {
    this.value = value;
  }

  setValueAtTime(value: number, time: number): this {
    this.events.push({ type: 'set', value, time });
    this.value = value;
    return this;
  }

  /** Records the ramp and jumps to its end value (tests don't need interpolation). */
  linearRampToValueAtTime(value: number, time: number): this {
    this.events.push({ type: 'ramp', value, time });
    this.value = value;
    return this;
  }

  cancelScheduledValues(time: number): this {
    this.events.push({ type: 'cancel', time });
    return this;
  }
}

export class FakeNode implements AudioNodeLike {
  readonly outputs: AudioNodeLike[] = [];
  disconnected = false;

  constructor(readonly kind: string) {}

  connect(destination: AudioNodeLike): AudioNodeLike {
    this.outputs.push(destination);
    return destination;
  }

  disconnect(): void {
    this.disconnected = true;
    this.outputs.length = 0;
  }
}

export class FakeGain extends FakeNode implements GainNodeLike {
  readonly gain = new FakeParam(1);
  channelCount = 2;
  channelCountMode: ChannelCountMode = 'max';
  channelInterpretation: ChannelInterpretation = 'speakers';

  constructor() {
    super('gain');
  }

  /**
   * What this node outputs for a stereo input, per the Web Audio mixing rules this fake models:
   * an explicit one-channel node downmixes stereo speakers to (L + R) / 2, and the one channel is
   * then up-mixed to both outputs; otherwise the channels pass through. Gain is not applied.
   */
  mix(input: readonly [number, number]): [number, number] {
    if (this.channelCountMode === 'explicit' && this.channelCount === 1) {
      const mono = (input[0] + input[1]) / 2;
      return [mono, mono];
    }
    return [input[0], input[1]];
  }
}

export class FakeCompressor extends FakeNode implements DynamicsCompressorNodeLike {
  readonly threshold = new FakeParam(-24);
  readonly knee = new FakeParam(30);
  readonly ratio = new FakeParam(12);
  readonly attack = new FakeParam(0.003);
  readonly release = new FakeParam(0.25);

  constructor() {
    super('compressor');
  }
}

export class FakeBiquad extends FakeNode implements BiquadFilterNodeLike {
  type: BiquadFilterType = 'lowpass';
  readonly frequency = new FakeParam(350);

  constructor() {
    super('biquad');
  }
}

export class FakePanner extends FakeNode implements PannerNodeLike {
  panningModel: PanningModelType = 'equalpower';
  distanceModel: DistanceModelType = 'inverse';
  refDistance = 1;
  maxDistance = 10000;
  rolloffFactor = 1;
  readonly positionX = new FakeParam(0);
  readonly positionY = new FakeParam(0);
  readonly positionZ = new FakeParam(0);

  constructor() {
    super('panner');
  }
}

export class FakeBuffer implements AudioBufferLike {
  readonly #channels: Float32Array[];

  constructor(
    readonly numberOfChannels: number,
    readonly length: number,
    readonly sampleRate: number,
  ) {
    this.#channels = Array.from({ length: numberOfChannels }, () => new Float32Array(length));
  }

  get duration(): number {
    return this.length / this.sampleRate;
  }

  getChannelData(channel: number): Float32Array {
    const data = this.#channels[channel];
    if (!data) throw new RangeError(`no channel ${String(channel)}`);
    return data;
  }
}

export class FakeSource extends FakeNode implements AudioBufferSourceNodeLike {
  buffer: AudioBufferLike | null = null;
  loop = false;
  loopStart = 0;
  loopEnd = 0;
  readonly playbackRate = new FakeParam(1);
  onended: ((this: never, ev: Event) => unknown) | null = null;
  startedAt: number | undefined;
  stoppedAt: number | undefined;

  constructor() {
    super('source');
  }

  start(when = 0): void {
    this.startedAt = when;
  }

  stop(when = 0): void {
    this.stoppedAt = when;
  }

  /** Simulates the browser firing `ended`. */
  end(): void {
    this.onended?.call(undefined as never, new Event('ended'));
  }
}

/** Listener with AudioParams (Chromium/WebKit style) or, with `legacy`, setters only (Firefox). */
export class FakeListener implements AudioListenerLike {
  positionX?: FakeParam;
  positionY?: FakeParam;
  positionZ?: FakeParam;
  forwardX?: FakeParam;
  forwardY?: FakeParam;
  forwardZ?: FakeParam;
  upX?: FakeParam;
  upY?: FakeParam;
  upZ?: FakeParam;
  readonly calls: { method: string; args: number[] }[] = [];

  constructor(legacy: boolean) {
    if (legacy) return;
    this.positionX = new FakeParam(0);
    this.positionY = new FakeParam(0);
    this.positionZ = new FakeParam(0);
    this.forwardX = new FakeParam(0);
    this.forwardY = new FakeParam(0);
    this.forwardZ = new FakeParam(-1);
    this.upX = new FakeParam(0);
    this.upY = new FakeParam(1);
    this.upZ = new FakeParam(0);
  }

  setPosition(...args: [number, number, number]): void {
    this.calls.push({ method: 'setPosition', args });
  }

  setOrientation(...args: [number, number, number, number, number, number]): void {
    this.calls.push({ method: 'setOrientation', args });
  }
}

export interface FakeContextOptions {
  /** Initial state; browsers start `suspended` without a user gesture. */
  readonly state?: AudioContextState;
  readonly sampleRate?: number;
  /** Listener without AudioParams, like Firefox. */
  readonly legacyListener?: boolean;
  /**
   * Decoder: returns a buffer for the bytes or throws to simulate a corrupt file. Default decodes
   * any bytes to a 1 s mono buffer whose length is the byte count × 1000 (so tests control size).
   */
  readonly decode?: (data: ArrayBuffer) => AudioBufferLike;
}

export class FakeAudioContext implements AudioContextLike {
  state: AudioContextState;
  currentTime = 0;
  readonly sampleRate: number;
  readonly destination = new FakeNode('destination');
  readonly listener: FakeListener;
  readonly gains: FakeGain[] = [];
  readonly panners: FakePanner[] = [];
  readonly sources: FakeSource[] = [];
  readonly compressors: FakeCompressor[] = [];
  readonly biquads: FakeBiquad[] = [];
  resumeCalls = 0;
  readonly #decode: (data: ArrayBuffer) => AudioBufferLike;

  constructor(options: FakeContextOptions = {}) {
    this.state = options.state ?? 'running';
    this.sampleRate = options.sampleRate ?? 48_000;
    this.listener = new FakeListener(options.legacyListener ?? false);
    this.#decode =
      options.decode ?? ((data) => new FakeBuffer(1, data.byteLength * 1000, this.sampleRate));
  }

  resume(): Promise<void> {
    this.resumeCalls++;
    this.state = 'running';
    return Promise.resolve();
  }

  createGain(): FakeGain {
    const node = new FakeGain();
    this.gains.push(node);
    return node;
  }

  createDynamicsCompressor(): FakeCompressor {
    const node = new FakeCompressor();
    this.compressors.push(node);
    return node;
  }

  createBiquadFilter(): FakeBiquad {
    const node = new FakeBiquad();
    this.biquads.push(node);
    return node;
  }

  createPanner(): FakePanner {
    const node = new FakePanner();
    this.panners.push(node);
    return node;
  }

  createBufferSource(): FakeSource {
    const node = new FakeSource();
    this.sources.push(node);
    return node;
  }

  createBuffer(numberOfChannels: number, length: number, sampleRate: number): FakeBuffer {
    return new FakeBuffer(numberOfChannels, length, sampleRate);
  }

  /** Asynchronous like the real one: a throwing decoder becomes a rejection. */
  decodeAudioData(data: ArrayBuffer): Promise<AudioBufferLike> {
    return Promise.resolve().then(() => this.#decode(data));
  }

  /** Sources that have started and not been stopped. */
  get playing(): FakeSource[] {
    return this.sources.filter((s) => s.startedAt !== undefined && s.stoppedAt === undefined);
  }
}
