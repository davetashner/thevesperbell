import { describe, expect, it, vi } from 'vitest';
import type { PlayOptions } from '@audio/index';
import {
  SALE_MIN_GAP_MS,
  SHOP_STINGERS,
  ShopStingers,
  STINGER_FADE_S,
  type StingerEngine,
} from './shop-stingers.ts';

const SET = SHOP_STINGERS[0];
if (SET === undefined) throw new Error('no stingers');
const MERCHANT = SET.merchant;

function setup(contextState = 'running') {
  let state = contextState;
  let clock = 0;
  const played: { cue: string; options: PlayOptions | undefined }[] = [];
  const handles: { stop: ReturnType<typeof vi.fn> }[] = [];
  const engine: StingerEngine = {
    get context() {
      return state === 'none' ? undefined : { state };
    },
    play: (cue, options) => {
      played.push({ cue, options });
      const handle = { cueId: cue, state: 'playing' as const, stop: vi.fn(), fade: vi.fn() };
      handles.push(handle);
      return handle;
    },
  };
  const stingers = new ShopStingers({ engine, now: () => clock });
  return {
    stingers,
    played,
    handles,
    cues: () => played.map((p) => p.cue),
    tick: (ms: number) => {
      clock += ms;
    },
    setState: (value: string) => {
      state = value;
    },
  };
}

describe('ShopStingers (mw-ju8.11)', () => {
  it('AC-4: opening plays the greeting, a deal the sale cadence, closing the farewell', () => {
    const t = setup();
    t.stingers.handle({ kind: 'opened', merchantId: MERCHANT });
    t.tick(SALE_MIN_GAP_MS);
    t.stingers.handle({ kind: 'deal', merchantId: MERCHANT });
    t.stingers.handle({ kind: 'closed', merchantId: MERCHANT });
    expect(t.cues()).toEqual([SET.greeting, SET.sale, SET.farewell]);
    expect(t.played.every((p) => p.options === undefined)).toBe(true);
  });

  it('AC-5: a quick run of deals sounds one cadence, the next after the gap', () => {
    const t = setup();
    t.stingers.handle({ kind: 'deal', merchantId: MERCHANT });
    t.tick(SALE_MIN_GAP_MS - 1);
    t.stingers.handle({ kind: 'deal', merchantId: MERCHANT });
    expect(t.cues()).toEqual([SET.sale]);
    t.tick(1);
    t.stingers.handle({ kind: 'deal', merchantId: MERCHANT });
    expect(t.cues()).toEqual([SET.sale, SET.sale]);
  });

  it('AC-5: only one stinger sounds at a time: a new one fades the last', () => {
    const t = setup();
    t.stingers.handle({ kind: 'opened', merchantId: MERCHANT });
    t.stingers.handle({ kind: 'closed', merchantId: MERCHANT });
    expect(t.handles[0]?.stop).toHaveBeenCalledWith(STINGER_FADE_S);
    expect(t.handles[1]?.stop).not.toHaveBeenCalled();
  });

  it('AC-4: merchants without stingers are silent', () => {
    const t = setup();
    t.stingers.handle({ kind: 'opened', merchantId: 'bridgeward-fighting-hall' });
    expect(t.played).toEqual([]);
  });

  it('AC-4: nothing is requested before the audio context runs, or without one', () => {
    const t = setup('suspended');
    t.stingers.handle({ kind: 'opened', merchantId: MERCHANT });
    expect(t.played).toEqual([]);
    const none = setup('none');
    none.stingers.handle({ kind: 'opened', merchantId: MERCHANT });
    expect(none.played).toEqual([]);
    t.setState('running');
    t.stingers.handle({ kind: 'opened', merchantId: MERCHANT });
    expect(t.played).toHaveLength(1);
  });

  it('AC-5: a deal while audio could not run does not use up the gap', () => {
    const t = setup('suspended');
    t.stingers.handle({ kind: 'deal', merchantId: MERCHANT });
    t.setState('running');
    t.stingers.handle({ kind: 'deal', merchantId: MERCHANT });
    expect(t.played).toHaveLength(1);
  });

  it('AC-4: dispose fades out the stinger that is sounding', () => {
    const t = setup();
    t.stingers.handle({ kind: 'opened', merchantId: MERCHANT });
    t.stingers.dispose();
    expect(t.handles[0]?.stop).toHaveBeenCalledWith(STINGER_FADE_S);
    t.stingers.dispose();
    expect(t.handles[0]?.stop).toHaveBeenCalledTimes(1);
  });
});
