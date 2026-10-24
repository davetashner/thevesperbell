import { describe, expect, it } from 'vitest';
import { gameContentSources } from '../game-content.ts';
import { ContentLoadError, loadContent, type ContentSource } from '../loader.ts';
import { contentChecks, contentTypes } from '../registry.ts';
import { describeContent } from '../testing.ts';
import { PLAYER_CLASSES } from './controller.ts';
import { GAME_CONFIG_ID, gameSchema, type GameConfigInput } from './game.ts';

const GAME_FILE = 'src/content/data/game/game.json';

const config = (over: Partial<GameConfigInput> = {}): GameConfigInput => ({
  id: GAME_CONFIG_ID,
  notes: 'Test.',
  playableClasses: ['knight'],
  startScene: 'slice',
  clock: {
    dayLengthRealMinutes: 60,
    start: { day: 1, minute: 360 },
    phases: [{ id: 'day', startMinute: 0 }],
    pauseScreens: {},
  },
  ...over,
});

/** Issues from loading the game's content with the game file replaced by `json`. */
function loadIssues(json: unknown): string[] {
  const sources: ContentSource[] = [
    ...gameContentSources().filter((s) => s.path !== GAME_FILE),
    { path: GAME_FILE, text: JSON.stringify(json) },
  ];
  try {
    loadContent(contentTypes, sources, contentChecks);
  } catch (error) {
    if (!(error instanceof ContentLoadError)) throw error;
    return error.issues.map((i) => `${i.file}#${i.pointer}: ${i.message}`);
  }
  return [];
}

describe('game configuration (mw-e01.15)', () => {
  describeContent('game', 'lists playable classes that all have class data', (entry, content) => {
    expect(entry.id).toBe(GAME_CONFIG_ID);
    expect(entry.playableClasses.length).toBeGreaterThan(0);
    for (const target of entry.playableClasses) {
      expect(content.has('class', target.id)).toBe(true);
      expect(PLAYER_CLASSES as readonly string[]).toContain(target.id);
    }
  });

  it('m1 ships the Knight as the only playable class', () => {
    const content = loadContent(contentTypes, gameContentSources(), contentChecks);
    const game = content.get('game', GAME_CONFIG_ID);
    expect(game.playableClasses.map(({ id }) => id)).toEqual(['knight']);
  });

  it('AC-3: a playable class with no class data file fails validation naming the id', () => {
    expect(loadIssues(config({ playableClasses: ['knight', 'bard'] }))).toEqual([
      `${GAME_FILE}#/playableClasses/1: game:game references missing class:bard`,
    ]);
  });

  it('AC-4: an empty playableClasses fails validation: a build must offer a class', () => {
    const result = gameSchema.safeParse(config({ playableClasses: [] }));
    expect(result.success).toBe(false);
    expect(result.error?.issues.map(({ message }) => message)).toEqual([
      'a build must offer at least one playable class',
    ]);
    expect(loadIssues(config({ playableClasses: [] }))).toEqual([
      `${GAME_FILE}#/playableClasses: a build must offer at least one playable class (at playableClasses)`,
    ]);
  });

  it('m1 starts a new game in the slice scene (mw-e01.2)', () => {
    const content = loadContent(contentTypes, gameContentSources(), contentChecks);
    const game = content.get('game', GAME_CONFIG_ID);
    expect(game.startScene.id).toBe('slice');
    expect(content.has('scene', game.startScene.id)).toBe(true);
  });

  it('mw-e01.2 AC-4: a startScene with no scene file fails the content check naming the missing id', () => {
    expect(loadIssues(config({ startScene: 'mountain-road' }))).toEqual([
      `${GAME_FILE}#/startScene: game:game references missing scene:mountain-road`,
    ]);
    // A start scene is required: the title screen and New Game need one.
    const withoutStart: Partial<GameConfigInput> = config();
    delete withoutStart.startScene;
    expect(gameSchema.safeParse(withoutStart).success).toBe(false);
  });

  it('rejects a class listed twice and any id but "game"', () => {
    expect(loadIssues(config({ playableClasses: ['knight', 'knight'] }))).toEqual([
      `${GAME_FILE}#/playableClasses/1: "knight" is listed twice (at playableClasses[1])`,
    ]);
    expect(gameSchema.safeParse(config({ id: 'other' as never })).success).toBe(false);
    expect(gameSchema.parse(config()).playableClasses.map(({ id }) => id)).toEqual(['knight']);
  });

  it('mw-e27.12: the clock block needs a phase, a valid start minute and kebab-case phase ids', () => {
    const clock = config().clock;
    expect(gameSchema.safeParse(config()).success).toBe(true);
    expect(gameSchema.safeParse(config({ clock: { ...clock, phases: [] } })).success).toBe(false);
    expect(
      gameSchema.safeParse(config({ clock: { ...clock, start: { day: 1, minute: 1440 } } }))
        .success,
    ).toBe(false);
    expect(
      gameSchema.safeParse(
        config({ clock: { ...clock, phases: [{ id: 'Noon', startMinute: 0 }] } }),
      ).success,
    ).toBe(false);
    expect(gameSchema.safeParse({ ...config(), clock: undefined }).success).toBe(false);
  });
});
