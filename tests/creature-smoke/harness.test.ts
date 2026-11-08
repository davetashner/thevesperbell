// mw-e12.15: the acceptance criteria of the creature smoke harness, proved on fixture creature defs
// (in-memory files next to the frozen fixtures) rather than the bestiary, so bestiary tuning can never
// break them. The generated battery over the real creature files is ./creature-smoke.test.ts.
import { describe, expect, it } from 'vitest';
import { gameContentSources } from '@content/game-content';
import { devContentSources } from '@content/dev-content';
import { DAMAGE_TYPES } from '@content/index';
import { loadContent, type ContentSource } from '@content/loader';
import { contentChecks, contentTypes, type GameContent } from '@content/registry';
import { BATTERY, planSmoke, runSmoke, smokeName, subjectsOf, type SmokeSubject } from './harness';

const GUARD_STRIKE_TRACK = 'fixture-guard-strike';

/** A creature file derived from the fixture hound (no attacks, a behaviour-less sandbag). */
function creatureFile(id: string, patch: Record<string, unknown>): ContentSource {
  return {
    path: `src/content/fixtures/meta/creature/${id}.json`,
    text: JSON.stringify({
      id,
      family: 'animal',
      stats: { health: 40, poise: 10, mass: 30, size: 'small' },
      senses: 'beast',
      locomotion: 'humanoid',
      audio: {
        idleLoop: `sfx-${id}-idle`,
        footsteps: `sfx-${id}-step`,
        alertBark: `sfx-${id}-bark-alert`,
        telegraph: `sfx-${id}-telegraph`,
        hurt: `sfx-${id}-hurt`,
        poiseBreak: `sfx-${id}-stagger`,
        death: `sfx-${id}-death`,
      },
      ...patch,
    }),
  };
}

const IMMUNE = Object.fromEntries(DAMAGE_TYPES.map((type) => [type, 0]));

function metaContent(): GameContent {
  return loadContent(
    contentTypes,
    [
      ...gameContentSources(),
      ...devContentSources(),
      creatureFile('meta-plain', {}),
      creatureFile('meta-immune', { resistances: IMMUNE }),
      creatureFile('meta-swordsman', { attacks: ['fixture-guard-strike'] }),
      creatureFile('meta-broken', { attacks: ['fixture-guard-strike'] }),
    ],
    contentChecks,
  );
}

const content = metaContent();
const only = (...ids: string[]): SmokeSubject[] =>
  subjectsOf(content).filter((s) => ids.includes(s.creature.id));
/** The broken creature's view of content: the hitbox track its attack's move names is gone. */
const brokenRefs: SmokeSubject['refs'] = {
  has: (type, id) =>
    !(type === 'socket-track' && id === GUARD_STRIKE_TRACK) && content.has(type, id),
  get: (type, id) => content.get(type, id),
};
const byName = (results: ReturnType<typeof runSmoke>) =>
  new Map(results.map((result) => [result.name, result]));

describe('the creature smoke harness (mw-e12.15)', () => {
  it('AC-1: given N creature files, N × (battery size) named tests are planned and run', () => {
    const subjects = only('meta-plain', 'meta-immune', 'meta-swordsman');
    const plan = planSmoke(subjects);
    expect(plan).toHaveLength(subjects.length * BATTERY.length);
    expect(plan.map((test) => test.name)).toEqual(
      subjects.flatMap((s) => BATTERY.map((step) => smokeName(s.creature.id, step))),
    );
    expect(plan[0]?.name).toBe('creature:meta-immune smoke — spawn');
    const results = runSmoke(plan);
    expect(results).toHaveLength(plan.length);
    expect(results.filter((r) => r.status === 'failed')).toEqual([]);
  });

  it('AC-1: a creature that opts into extra scenario steps gets them after the battery, by name', () => {
    const calls: string[] = [];
    const plan = planSmoke(only('meta-plain'), {
      'meta-plain': [{ name: 'scenario one', run: (rig) => calls.push(rig.id) }],
    });
    expect(plan).toHaveLength(BATTERY.length + 1);
    expect(plan.at(-1)?.name).toBe('creature:meta-plain smoke — scenario one');
    expect(runSmoke(plan.slice(-1))[0]?.status).toBe('passed');
    expect(calls).toEqual(['meta-plain']);
  });

  it('AC-2: a creature whose attack references a missing hitbox fails only its attack step, naming the ref', () => {
    const subjects = only('meta-swordsman', 'meta-broken').map((subject) =>
      subject.creature.id === 'meta-broken' ? { ...subject, refs: brokenRefs } : subject,
    );
    const results = runSmoke(planSmoke(subjects));
    const failed = results.filter((r) => r.status === 'failed');
    expect(failed.map((r) => r.name)).toEqual([smokeName('meta-broken', 'attacks')]);
    expect(failed[0]?.message).toContain(GUARD_STRIKE_TRACK);
    expect(failed[0]?.message).toContain('hitbox');
    // The healthy swordsman's attack step ran and passed.
    expect(byName(results).get(smokeName('meta-swordsman', 'attacks'))?.status).toBe('passed');
  });

  it('AC-3: a creature immune to every damage type has its lethal-damage step assert survival', () => {
    const results = byName(runSmoke(planSmoke(only('meta-immune', 'meta-plain'))));
    expect(results.get(smokeName('meta-immune', 'lethal damage'))?.status).toBe('passed');
    // The same step on the mortal one asserts death, and passes only because it died.
    expect(results.get(smokeName('meta-plain', 'lethal damage'))?.status).toBe('passed');
  });

  it('AC-3: the lethal step fails when an immune creature somehow dies, or a mortal one survives', () => {
    // Claim immunity in the data the step reads while the world's creature is mortal: it must notice.
    const mortal = only('meta-plain')[0];
    const immune = only('meta-immune')[0];
    if (mortal === undefined || immune === undefined) throw new Error('missing meta creatures');
    const lying = { ...mortal, creature: { ...mortal.creature, resistances: IMMUNE } };
    const result = runSmoke(planSmoke([lying])).find((r) => r.name.endsWith('lethal damage'));
    expect(result?.status).toBe('failed');
    expect(result?.message).toContain('immune to every damage type');
    const dying = { ...immune, creature: { ...immune.creature, resistances: {} } };
    const other = runSmoke(planSmoke([dying])).find((r) => r.name.endsWith('lethal damage'));
    expect(other?.status).toBe('failed');
    expect(other?.message).toContain('not dead');
  });

  it('AC-4: a creature with no attacks has its attack step skipped, reported as skipped, not passed', () => {
    const results = byName(runSmoke(planSmoke(only('meta-plain'))));
    const attacks = results.get(smokeName('meta-plain', 'attacks'));
    expect(attacks).toEqual({
      name: smokeName('meta-plain', 'attacks'),
      status: 'skipped',
      message: 'no attacks declared',
    });
    expect(results.get(smokeName('meta-plain', 'spawn'))?.status).toBe('passed');
  });

  it('a creature whose behaviour profile has no content skips the perceive step with the reason', () => {
    const results = byName(runSmoke(planSmoke(only('meta-plain'))));
    const perceive = results.get(smokeName('meta-plain', 'perceive'));
    expect(perceive?.status).toBe('skipped');
    expect(perceive?.message).toContain('no brain');
  });
});
