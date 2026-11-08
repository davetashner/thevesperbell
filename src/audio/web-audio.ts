// The slice of the Web Audio API the engine touches, as structural interfaces. The real
// `AudioContext` satisfies them, and so does the hand-written fake in fake-context.ts, which is how
// src/audio gets unit coverage in Node (no Web Audio there). Keep this list minimal: every member
// added here must also be implemented by the fake.

/** An `AudioParam`: only direct value writes and the two ramps the engine schedules. */
export interface AudioParamLike {
  value: number;
  setValueAtTime(value: number, startTime: number): unknown;
  linearRampToValueAtTime(value: number, endTime: number): unknown;
  cancelScheduledValues(cancelTime: number): unknown;
}

/** Anything that can be the target of `connect`. */
export interface AudioNodeLike {
  connect(destination: AudioNodeLike): unknown;
  disconnect(): void;
}

export interface GainNodeLike extends AudioNodeLike {
  readonly gain: AudioParamLike;
  channelCount: number;
  channelCountMode: ChannelCountMode;
  channelInterpretation: ChannelInterpretation;
}

export interface DynamicsCompressorNodeLike extends AudioNodeLike {
  readonly threshold: AudioParamLike;
  readonly knee: AudioParamLike;
  readonly ratio: AudioParamLike;
  readonly attack: AudioParamLike;
  readonly release: AudioParamLike;
}

export interface PannerNodeLike extends AudioNodeLike {
  panningModel: PanningModelType;
  distanceModel: DistanceModelType;
  refDistance: number;
  maxDistance: number;
  rolloffFactor: number;
  readonly positionX: AudioParamLike;
  readonly positionY: AudioParamLike;
  readonly positionZ: AudioParamLike;
}

export interface AudioBufferLike {
  readonly duration: number;
  readonly length: number;
  readonly numberOfChannels: number;
  readonly sampleRate: number;
  getChannelData(channel: number): Float32Array;
}

export interface AudioBufferSourceNodeLike extends AudioNodeLike {
  buffer: AudioBufferLike | null;
  loop: boolean;
  loopStart: number;
  loopEnd: number;
  readonly playbackRate: AudioParamLike;
  onended: ((this: never, ev: Event) => unknown) | null;
  start(when?: number, offset?: number): void;
  stop(when?: number): void;
}

/**
 * `AudioListener`. Firefox has no `positionX`/`forwardX`… params (only the deprecated
 * `setPosition`/`setOrientation`), so the params are optional and the methods are the fallback.
 */
export interface AudioListenerLike {
  readonly positionX?: AudioParamLike;
  readonly positionY?: AudioParamLike;
  readonly positionZ?: AudioParamLike;
  readonly forwardX?: AudioParamLike;
  readonly forwardY?: AudioParamLike;
  readonly forwardZ?: AudioParamLike;
  readonly upX?: AudioParamLike;
  readonly upY?: AudioParamLike;
  readonly upZ?: AudioParamLike;
  setPosition(x: number, y: number, z: number): void;
  setOrientation(x: number, y: number, z: number, xUp: number, yUp: number, zUp: number): void;
}

/** The `AudioContext` surface the engine uses. */
export interface AudioContextLike {
  readonly state: AudioContextState;
  readonly currentTime: number;
  readonly sampleRate: number;
  readonly destination: AudioNodeLike;
  readonly listener: AudioListenerLike;
  resume(): Promise<void>;
  createGain(): GainNodeLike;
  createDynamicsCompressor(): DynamicsCompressorNodeLike;
  createPanner(): PannerNodeLike;
  createBufferSource(): AudioBufferSourceNodeLike;
  createBuffer(numberOfChannels: number, length: number, sampleRate: number): AudioBufferLike;
  decodeAudioData(data: ArrayBuffer): Promise<AudioBufferLike>;
}
