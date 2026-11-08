import { describe, expect, it } from 'vitest';
import {
  applyMono,
  applyNightMode,
  BUS_PARENT,
  buildBusGraph,
  dbToGain,
  LIMITER,
  type MixBusId,
  type MixStage,
  NIGHT_COMPRESSOR,
} from './buses.ts';
import { FakeAudioContext, type FakeCompressor, type FakeGain } from './fake-context.ts';
import { BUS_IDS, PLAYABLE_BUS_IDS, type BusId } from './manifest.ts';

describe('bus graph', () => {
  it('wires master → night compressor → limiter → destination and every bus to its parent', () => {
    const ctx = new FakeAudioContext();
    const graph = buildBusGraph(ctx);
    const buses = graph.buses as Record<BusId, FakeGain>;
    const limiter = graph.limiter as FakeCompressor;
    expect(Object.keys(buses).sort()).toEqual([...BUS_IDS].sort());
    expect(buses.master.outputs).toEqual([graph.night]);
    expect((graph.night as FakeCompressor).outputs).toEqual([limiter]);
    expect(limiter.outputs).toEqual([ctx.destination]);
    for (const bus of PLAYABLE_BUS_IDS) {
      // Mix buses go through their stage (snapshot → duck → low-pass) to the parent.
      const stage = graph.stages[bus as MixBusId] as MixStage | undefined;
      let out: unknown = buses[bus];
      if (stage) {
        out = stage.filter;
        expect(buses[bus].outputs).toEqual([stage.snapshot]);
        expect((stage.snapshot as FakeGain).outputs).toEqual([stage.duck]);
        expect((stage.duck as FakeGain).outputs).toEqual([stage.filter]);
      }
      expect((out as FakeGain).outputs).toEqual([buses[BUS_PARENT[bus]]]);
    }
    expect(BUS_PARENT).toMatchObject({ combat: 'sfx', footsteps: 'sfx', creatures: 'sfx' });
  });

  it('sets the master limiter to catch peaks above −1 dB', () => {
    const { limiter } = buildBusGraph(new FakeAudioContext());
    expect({
      threshold: limiter.threshold.value,
      knee: limiter.knee.value,
      ratio: limiter.ratio.value,
      attack: limiter.attack.value,
      release: limiter.release.value,
    }).toEqual(LIMITER);
  });

  it('converts decibels to linear gain', () => {
    expect(dbToGain(0)).toBe(1);
    expect(dbToGain(-20)).toBeCloseTo(0.1);
    expect(dbToGain(6)).toBeCloseTo(1.995, 3);
  });
});

describe('mono and night mode (mw-e28.5)', () => {
  it('night mode starts transparent, then compresses when on and bypasses when off', () => {
    const graph = buildBusGraph(new FakeAudioContext());
    const night = graph.night as FakeCompressor;
    expect(night.ratio.value).toBe(1);
    applyNightMode(graph, true, 0, 0);
    expect(night.ratio.value).toBe(NIGHT_COMPRESSOR.ratio);
    expect(night.threshold.value).toBe(NIGHT_COMPRESSOR.threshold);
    applyNightMode(graph, false, 0, 0);
    expect(night.ratio.value).toBe(1);
  });

  it('AC-5: mono makes master an explicit one-channel mix', () => {
    const graph = buildBusGraph(new FakeAudioContext());
    const master = graph.buses.master as FakeGain;
    expect(master.mix([1, 0])).toEqual([1, 0]);
    applyMono(graph, true);
    expect(master.mix([1, 0])).toEqual([0.5, 0.5]);
    applyMono(graph, false);
    expect(master.mix([1, 0])).toEqual([1, 0]);
  });
});
