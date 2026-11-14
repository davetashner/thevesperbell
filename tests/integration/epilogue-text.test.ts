// mw-e39.16: the ending cards and epilogue slides against the main quest's ending logic. Every
// combination of the seven ending facts (horn.fate, abbot.fate, vane.fate, knot.breach-sealed,
// clatter.restored, goblins.standing, tansy.saved) must give exactly one headline ending and at
// least three slides, every slide must have text, and no slide may name a character the player has not met.
import { describe, expect, it } from 'vitest';
import { loadGameContent } from '@content/index';
import { markExercised } from '@content/testing';
import { epilogueSlide, type Narration } from '@content/types/narration';
import type { QuestDef } from '@content/types/quest';
import { declareFacts, QuestRuntime, World } from '@sim/index';
import { evaluateLogic, MemoryLogicHost } from '@sim/logic/index';

const MAIN = 'quest-labyrinth-beneath-briar-glen';
const content = loadGameContent();
const main = content.get('quest', MAIN) as unknown as QuestDef;
const epilogue = content.get('quest', 'quest-briar-glen-epilogue') as unknown as QuestDef;
const narrations = content.all('narration') as readonly Narration[];
const slides = narrations.find((n) => n.kind === 'epilogue')?.sequences ?? [];

class WorldHost extends MemoryLogicHost {
  constructor(world: World) {
    super({ capabilities: [] });
    Object.defineProperty(this, 'facts', { value: world.facts });
  }
}

function boot() {
  const world = new World({ seed: 11 });
  declareFacts(world.facts, content.all('fact'), { mode: 'throw' });
  const runtime = new QuestRuntime({
    quests: content.all('quest') as never,
    facts: world.facts,
    host: new WorldHost(world),
    events: world.events,
  });
  world.facts.set('player.class', 'archer');
  world.facts.set('briar-glen.arrived', true);
  world.step();
  runtime.update();
  runtime.completeObjective(MAIN, 'return-to-briar-glen');
  return { world, host: runtime.host };
}

/** The fact keys a logic tree reads. */
function factsRead(node: unknown, found = new Set<string>()): Set<string> {
  if (Array.isArray(node)) node.forEach((n) => factsRead(n, found));
  else if (typeof node === 'object' && node !== null) {
    const record = node as Record<string, unknown>;
    if (typeof record['fact'] === 'string') found.add(record['fact']);
    Object.values(record).forEach((n) => factsRead(n, found));
  }
  return found;
}

const HORN = ['alive', 'dead'];
const ABBOT = ['unresolved', 'at-rest', 'defeated', 'joined'];
const VANE = ['unexposed', 'exposed', 'confessed', 'bribed-player', 'fled'];
const GOBLINS = ['hostile', 'neutral', 'friendly'];
const BOOLS = [false, true];

interface Outcome {
  readonly facts: Record<string, boolean | string>;
  readonly headline: string;
  readonly slides: string[];
}

/** Every combination of the seven ending facts (and the bell rung or failed, Hale's testimony, speaking for Horn), run through the quests' own conditions. */
function everyCombination(extra: Record<string, boolean | string> = {}): Outcome[] {
  const { world, host } = boot();
  const out: Outcome[] = [];
  for (const horn of HORN)
    for (const abbot of ABBOT)
      for (const vane of VANE)
        for (const sealed of BOOLS)
          for (const clatter of BOOLS)
            for (const goblins of GOBLINS)
              for (const tansy of BOOLS)
                for (const bell of ['rung', 'failed'])
                  for (const hale of BOOLS)
                    for (const spoken of BOOLS) {
                      const facts = {
                        'horn.fate': horn,
                        'abbot.fate': abbot,
                        'vane.fate': vane,
                        'knot.breach-sealed': sealed,
                        'clatter.restored': clatter,
                        'goblins.standing': goblins,
                        'tansy.saved': tansy,
                        'bell.rung': bell,
                        'hale.testimony.given': hale,
                        'horn.spoken-for': spoken,
                        'bounty.outcome': 'paid',
                        ...extra,
                      };
                      world.facts.transaction(() => {
                        for (const [key, value] of Object.entries(facts))
                          world.facts.set(key, value);
                      });
                      const holding = main.resolutions.filter((r) =>
                        evaluateLogic(r.when as never, host),
                      );
                      expect(holding, JSON.stringify(facts)).toHaveLength(1);
                      const effect = holding[0]?.effects?.find(
                        (e) => e.kind === 'setFact' && e['fact'] === 'ending.headline',
                      );
                      const headline = String((effect as { value?: unknown } | undefined)?.value);
                      world.facts.set('ending.headline', headline);
                      out.push({
                        facts,
                        headline,
                        slides: epilogue.objectives
                          .filter(
                            (o) =>
                              o.activeWhen === undefined ||
                              evaluateLogic(o.activeWhen as never, host),
                          )
                          .map((o) => o.id),
                      });
                    }
  return out;
}

describe('epilogue text against the ending logic', () => {
  const outcomes = everyCombination();
  const home = everyCombination({ 'crate.intercepted': true });
  const sailed = everyCombination({ 'tern.sailed': true });
  const withHarbour = [...outcomes, ...home, ...sailed];

  it('AC-1: every combination of the seven ending facts gives exactly one headline ending and at least three slides', () => {
    expect(outcomes).toHaveLength(2 * 4 * 5 * 2 * 2 * 3 * 2 * 2 * 2 * 2);
    expect(new Set(outcomes.map((o) => o.headline))).toEqual(
      new Set(['vespers-rung', 'last-warden', 'hirelings-silence', 'long-vespers']),
    );
    for (const o of outcomes) {
      expect(o.slides.length, JSON.stringify(o.facts)).toBeGreaterThanOrEqual(3);
    }
  });

  it('AC-1: every slide an ending selects has text, in the order of the objectives', () => {
    const ids = new Set<string>();
    for (const o of withHarbour) o.slides.forEach((id) => ids.add(id));
    for (const id of ids) expect(epilogueSlide(narrations, id), id).toBeTruthy();
    expect(slides.map((s) => s.id).sort()).toEqual(epilogue.objectives.map((o) => o.id).sort());
    expect([...ids].sort()).toEqual(epilogue.objectives.map((o) => o.id).sort());
  });

  it('AC-1: a slide names the facts and endings that choose it, and the objective agrees', () => {
    const seen = new Map<string, Set<string>>();
    for (const o of withHarbour) {
      for (const id of o.slides) seen.set(id, (seen.get(id) ?? new Set()).add(o.headline));
    }
    for (const objective of epilogue.objectives) {
      const slide = slides.find((s) => s.id === objective.id);
      const read = [...factsRead(objective.activeWhen)].filter((f) => f !== 'ending.headline');
      expect([...(slide?.facts ?? [])].sort(), objective.id).toEqual(read.sort());
      expect([...(slide?.endings ?? [])].sort(), objective.id).toEqual(
        [...(seen.get(objective.id) ?? [])].sort(),
      );
    }
  });

  it('AC-1: the last slide of each ending is the one the bible names', () => {
    const last = (headline: string, facts: Record<string, boolean | string>) => {
      const o = outcomes.find(
        (x) => x.headline === headline && Object.entries(facts).every(([k, v]) => x.facts[k] === v),
      );
      return o?.slides[o.slides.length - 1];
    };
    expect(last('long-vespers', {})).toBe('lv-wake-in-the-cradle');
    expect(last('hirelings-silence', {})).toBe('hs-someone-sits-up');
    expect(last('last-warden', { 'goblins.standing': 'hostile', 'clatter.restored': false })).toBe(
      'lw-lantern-and-footprints',
    );
  });

  it('AC-4: with Clatter, the goblins and Hale never met, a neutral slide is used and none names them', () => {
    for (const o of outcomes) {
      const goblinsFriendly = o.facts['goblins.standing'] === 'friendly';
      for (const id of o.slides) {
        const text = epilogueSlide(narrations, id) ?? '';
        if (/Clatter|Anselm/.test(text)) expect(o.facts['clatter.restored'], id).toBe(true);
        if (text.includes('Kettleback')) expect(goblinsFriendly, id).toBe(true);
        expect(text, id).not.toMatch(/Mags|Nell|Gannet|Oakum|Snig/);
        if (text.includes('Hale')) expect(o.facts['hale.testimony.given'], id).toBe(true);
      }
    }
    const unmet = outcomes.filter(
      (o) =>
        o.facts['clatter.restored'] === false &&
        o.facts['hale.testimony.given'] === false &&
        o.facts['goblins.standing'] !== 'friendly' &&
        o.facts['vane.fate'] === 'unexposed',
    );
    expect(unmet.length).toBeGreaterThan(0);
    for (const o of unmet) {
      if (o.headline === 'vespers-rung') expect(o.slides, 'bell').toContain('vr-bell-tansy');
      if (o.headline === 'last-warden')
        expect(o.slides, 'watch').toContain('lw-lantern-and-footprints');
      if (o.headline === 'vespers-rung' || o.headline === 'last-warden') {
        expect(o.slides, 'vane').toContain('vane-quiet');
      }
      expect(o.slides.join(','), 'clatter').not.toMatch(/clatter/);
    }
  });

  it('harbour facts add slides and never change the headline ending', () => {
    const plain = outcomes.length;
    expect(home).toHaveLength(plain);
    home.forEach((o, i) => {
      expect(o.headline).toBe(outcomes[i]?.headline);
      expect(o.slides).toContain('harbor-name-stone-home');
      expect(o.slides).not.toContain('harbor-tern-ox');
    });
    sailed.forEach((o, i) => {
      expect(o.headline).toBe(outcomes[i]?.headline);
      expect(o.slides).toContain('harbor-tern-ox');
    });
  });

  it('marks the epilogue quest as exercised', ({ task }) => {
    markExercised(task, 'quest', 'quest-briar-glen-epilogue');
    for (const n of narrations) markExercised(task, 'narration', n.id);
    expect(epilogue.objectives.length).toBeGreaterThan(20);
  });
});
