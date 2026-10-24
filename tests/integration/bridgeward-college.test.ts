// mw-ju8.13: the Bridgeward College (src/content/data/scene/bridgeward-college.json) loaded headless as
// the game wires it, and its lessons run through the real content: the two instructors' merchants, the
// unlock book and the shop engine. AC-1: paying a trainer teaches the technique and takes the price;
// AC-2's no-sorcery half: nothing the college sells or teaches is a spell. The browser run (AC-2) is
// e2e/bridgeward-college.spec.ts.
import * as RAPIER from '@dimforge/rapier3d-deterministic';
import { describe, expect, it } from 'vitest';
import { loadGameContent } from '@content/index';
import { markExercised } from '@content/testing';
import { createCapabilityRegistry, createUnlockBook } from '@game/capabilities';
import {
  addCapabilities,
  CreatureComponent,
  FactionMemberComponent,
  inventoryOf,
  InventoryRules,
  Shops,
  type World,
} from '@sim/index';
import { createGameWorld } from '@tools/replay/testbed-player-scenario';

const content = loadGameContent();
const TRAINER_BAND = { min: 100, max: 400 };
const FIGHTING = 'bridgeward-fighting-hall';
const ARCHERY = 'bridgeward-archery-butts';

function college(crowns: number) {
  const game = createGameWorld<unknown>(RAPIER, {
    seed: 1,
    hz: 60,
    scene: 'bridgeward-college',
  });
  const sim = game.world as unknown as World<never>;
  const { player } = game;
  const rules = new InventoryRules(content.all('item'));
  const have = inventoryOf(sim, player)?.gold ?? 0;
  if (crowns > have) rules.addGold(sim, player, crowns - have);
  else if (have > crowns) rules.spendGold(sim, player, have - crowns);
  const registry = createCapabilityRegistry(content, true);
  addCapabilities(sim, player);
  // The knight's starting techniques.
  for (const id of ['technique.shield-bash', 'technique.parry']) {
    registry.grant(sim, player, id, 'class');
  }
  const book = createUnlockBook(content, registry);
  const shops = new Shops(content.all('merchant'), content.all('item'), rules);
  return {
    game,
    sim,
    player,
    book,
    shops,
    gold: () => inventoryOf(sim, player)?.gold ?? 0,
  };
}

describe('the Bridgeward College scene, headless (mw-ju8.13)', () => {
  it('both instructors stand in the hall, friendly townsfolk, and nobody else', ({ task }) => {
    markExercised(task, 'scene', 'bridgeward-college');
    markExercised(task, 'creature', 'npc-garrick');
    markExercised(task, 'creature', 'npc-rooke');
    const t = college(0);
    const kinds = t.game.world
      .query(CreatureComponent)
      .ids()
      .map((e) => t.game.world.get(e, CreatureComponent)?.origin.creature)
      .sort();
    expect(kinds).toEqual(['npc-garrick', 'npc-rooke']);
    for (const e of t.game.world.query(CreatureComponent).ids()) {
      expect(t.game.world.get(e, FactionMemberComponent)).toMatchObject({
        faction: 'townsfolk',
        toward: { player: 'friendly' },
      });
    }
  });

  it('each lesson table names an instructor merchant whose NPC is in the scene', () => {
    const spawns = content.get('scene', 'bridgeward-college').spawns;
    const tags = (id: string) => spawns.find((s) => s.id === id)?.tags ?? [];
    expect(tags('garrick-lessons')).toContain(`merchant:${FIGHTING}`);
    expect(tags('rooke-lessons')).toContain(`merchant:${ARCHERY}`);
    expect(content.get('merchant', FIGHTING).npcId).toBe('npc-garrick');
    expect(content.get('merchant', ARCHERY).npcId).toBe('npc-rooke');
  });
});

describe('lessons at the Bridgeward College (mw-ju8.13)', () => {
  it('AC-1: with enough crowns, paying the fighting instructor teaches the technique and drops crowns by the price', ({
    task,
  }) => {
    markExercised(task, 'merchant', FIGHTING);
    const t = college(500);
    const lesson = content.get('merchant', FIGHTING).services.find((s) => s.id === 'riposte');
    expect(lesson).toMatchObject({ kind: 'train', teaches: 'technique.riposte', price: 175 });
    expect(t.book.knows(t.sim, t.player, 'technique.riposte')).toBe(false);
    expect(t.shops.train(t.sim, t.player, FIGHTING, 'riposte', t.book)).toEqual({
      ok: true,
      price: 175,
      capability: 'technique.riposte',
    });
    expect(t.gold()).toBe(325);
    expect(t.book.knows(t.sim, t.player, 'technique.riposte')).toBe(true);
    // The next step in the chain is now open.
    expect(t.shops.train(t.sim, t.player, FIGHTING, 'disarm', t.book)).toMatchObject({
      ok: false,
      reason: 'cannot-afford',
    });
  });

  it('AC-1: the archery instructor teaches the pinning chain in order', ({ task }) => {
    markExercised(task, 'merchant', ARCHERY);
    const t = college(1000);
    expect(t.shops.train(t.sim, t.player, ARCHERY, 'ricochet-shot', t.book)).toMatchObject({
      ok: false,
      reason: 'refused',
    });
    expect(t.gold()).toBe(1000);
    expect(t.shops.train(t.sim, t.player, ARCHERY, 'pinning-shot', t.book).ok).toBe(true);
    expect(t.shops.train(t.sim, t.player, ARCHERY, 'ricochet-shot', t.book).ok).toBe(true);
    expect(t.gold()).toBe(1000 - 150 - 275);
  });

  it('with too few crowns nothing is taught and nothing is charged', () => {
    const t = college(99);
    expect(t.shops.train(t.sim, t.player, FIGHTING, 'shoulder-barge', t.book)).toMatchObject({
      ok: false,
      reason: 'cannot-afford',
    });
    expect(t.gold()).toBe(99);
    expect(t.book.knows(t.sim, t.player, 'technique.shoulder-barge')).toBe(false);
  });

  it('every lesson is priced inside the trainer band and teaches a declared, trainer-taught technique', () => {
    const declared = new Set(
      content.all('capability').flatMap((g) => g.capabilities.map((c) => c.id)),
    );
    const registry = createCapabilityRegistry(content, true);
    const book = createUnlockBook(content, registry);
    for (const id of [FIGHTING, ARCHERY]) {
      const merchant = content.get('merchant', id);
      expect(merchant.services.length).toBeGreaterThan(0);
      for (const service of merchant.services) {
        expect(service.kind).toBe('train');
        expect(service.price).toBeGreaterThanOrEqual(TRAINER_BAND.min);
        expect(service.price).toBeLessThanOrEqual(TRAINER_BAND.max);
        const capability = service.teaches ?? '';
        expect(declared.has(capability)).toBe(true);
        expect(book.unlockFor(capability)?.channels).toContain('trainer');
      }
    }
  });

  it('AC-2: nobody at the college offers sorcery', () => {
    for (const id of [FIGHTING, ARCHERY]) {
      const merchant = content.get('merchant', id);
      expect(merchant.stock).toEqual([]);
      for (const service of merchant.services) {
        expect(service.teaches).not.toMatch(/^spell\./);
      }
    }
    const taught = new Set(
      [FIGHTING, ARCHERY].flatMap((id) =>
        content.get('merchant', id).services.map((s) => s.teaches),
      ),
    );
    const spells = content
      .all('capability')
      .flatMap((g) => g.capabilities.map((c) => c.id))
      .filter((id) => id.startsWith('spell.'));
    for (const spell of spells) expect(taught.has(spell)).toBe(false);
  });
});
