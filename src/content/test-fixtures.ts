// Frozen test-fixture content (mw-e12.3): grey-box creatures that AI and stealth rule tests spawn
// instead of bestiary creatures, so tuning the bestiary never breaks a rule test. The files live in
// src/content/fixtures/creatures/<type>/, outside the game's content root, so the game's content
// (which globs only ./data, see game-content.ts) never includes them; only debug builds load them,
// through dev-content.ts (mw-e12.4). Changing a fixture value requires updating the scenario tests
// that depend on it (see the README next to the files).
// Test-only: not exported from index.ts, so nothing in the game imports it.

import { gameContentSources } from './game-content.ts';
import { loadContent, type ContentSource } from './loader.ts';
import { contentChecks, contentTypes, type GameContent } from './registry.ts';

const files = import.meta.glob<string>('./fixtures/creatures/*/*.json', {
  eager: true,
  query: '?raw',
  import: 'default',
});

/** Where the fixture files live, relative to the repo root. */
export const FIXTURE_CONTENT_ROOT = 'src/content/fixtures/creatures';

/** The frozen fixture creature ids. */
export const FIXTURE_CREATURE_IDS = ['fixture-guard', 'fixture-hound', 'fixture-sentinel'] as const;

/** A fixture creature id. */
export type FixtureCreatureId = (typeof FIXTURE_CREATURE_IDS)[number];

/** Every fixture file, with repo-relative paths. */
export function fixtureContentSources(): ContentSource[] {
  return Object.entries(files).map(([path, text]) => ({
    path: `${FIXTURE_CONTENT_ROOT}/${path.slice('./fixtures/creatures/'.length)}`,
    text,
  }));
}

/**
 * The game's content plus the test fixtures, loaded and validated together (fixtures refer to the
 * baseline `sense` and `locomotion` profiles). Throws a ContentLoadError listing every problem.
 */
export function loadFixtureContent(): GameContent {
  return loadContent(
    contentTypes,
    [...gameContentSources(), ...fixtureContentSources()],
    contentChecks,
  );
}

// Fixture spells (mw-e06.1): one small spell per delivery kind, together using every effect op, for the
// spell pipeline's tests (e06.2+) — never shipped, and not spells a player learns (mw-e08 owns those).
const spellFiles = import.meta.glob<string>('./fixtures/spells/*/*.json', {
  eager: true,
  query: '?raw',
  import: 'default',
});

/** Where the fixture spell files live, relative to the repo root. */
export const SPELL_FIXTURE_ROOT = 'src/content/fixtures/spells';

/** The fixture spell ids. */
export const FIXTURE_SPELL_IDS = [
  'fixture-bolt',
  'fixture-fire-wall',
  'fixture-gust',
  'fixture-raise',
  'fixture-ray',
  'fixture-shift',
  'fixture-ward',
] as const;

/** Every fixture spell file, with repo-relative paths. */
export function spellFixtureSources(): ContentSource[] {
  return Object.entries(spellFiles).map(([path, text]) => ({
    path: `${SPELL_FIXTURE_ROOT}/${path.slice('./fixtures/spells/'.length)}`,
    text,
  }));
}

/**
 * The game's content, the fixture creatures and the fixture spells (which summon and transform into
 * fixture creatures), loaded and validated together. Throws a ContentLoadError listing every problem.
 */
export function loadSpellFixtureContent(): GameContent {
  return loadContent(
    contentTypes,
    [...gameContentSources(), ...fixtureContentSources(), ...spellFixtureSources()],
    contentChecks,
  );
}

// Fixture items (mw-e17.2): one small item per category, for the item schema's and the inventory's
// tests (mw-e17.3+) — never shipped; game items are world content.
const itemFiles = import.meta.glob<string>('./fixtures/items/*/*.json', {
  eager: true,
  query: '?raw',
  import: 'default',
});

/** Where the fixture item files live, relative to the repo root. */
export const ITEM_FIXTURE_ROOT = 'src/content/fixtures/items';

/** The fixture item ids, by category. */
export const FIXTURE_ITEM_IDS = {
  weapon: 'fixture-sword',
  armor: 'fixture-mail-hauberk',
  shield: 'fixture-wooden-shield',
  ammo: 'fixture-arrow',
  book: 'fixture-primer',
  key: 'fixture-tower-key',
  consumable: 'fixture-oil-flask',
  tool: 'fixture-climbing-hook',
  quest: 'fixture-bell-tongue',
  artifact: 'fixture-lodestone-charm',
  currency: 'fixture-gold',
  misc: 'fixture-pebble',
} as const;

/** Every fixture item file, with repo-relative paths. */
export function itemFixtureSources(): ContentSource[] {
  return Object.entries(itemFiles).map(([path, text]) => ({
    path: `${ITEM_FIXTURE_ROOT}/${path.slice('./fixtures/items/'.length)}`,
    text,
  }));
}

/**
 * The game's content, the fixture creatures and spells (which fixture books teach) and the fixture
 * items (which name its moves, arrows, shields, materials and capabilities), loaded and validated together. Throws a ContentLoadError listing every problem.
 */
export function loadItemFixtureContent(): GameContent {
  return loadContent(
    contentTypes,
    [
      ...gameContentSources(),
      ...fixtureContentSources(),
      ...itemFixtureSources(),
      ...spellFixtureSources(),
    ],
    contentChecks,
  );
}
