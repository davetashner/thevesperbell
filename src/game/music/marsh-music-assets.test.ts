import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { assetCategory, gameSoundRegistry, loopSidecarSchema } from '@audio/index';
import { SCENE_BEDS } from './scene-beds.ts';
import { SHOP_STINGERS } from './shop-stingers.ts';

const AUDIO_DIR = 'public/assets/audio';
const registry = gameSoundRegistry();
const BED = SCENE_BEDS[0];
const STINGERS = SHOP_STINGERS[0];
const ASSETS = [
  'music-marsh-general-store',
  'music-stinger-marsh-greeting',
  'music-stinger-marsh-sale',
  'music-stinger-marsh-farewell',
];

describe('Marsh’s General Store music (mw-ju8.11)', () => {
  it('AC-1: the shop theme is a final non-spatial music-bus loop with a loop sidecar over 60 s', () => {
    const def = registry.get(BED?.cue ?? '');
    expect(def?.placeholder).toBe(false);
    expect(def?.loop).toBe(true);
    expect(def?.spatial).toBe(false);
    expect(def?.bus).toBe('music');
    for (const asset of def?.variants ?? []) {
      const path = `${AUDIO_DIR}/${assetCategory(asset)}/${asset}.json`;
      const sidecar = loopSidecarSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
      expect(sidecar.loopStartSample).toBe(0);
      expect(sidecar.loopEndSample / 48000).toBeGreaterThanOrEqual(60);
      expect(sidecar.key).toBe('D dorian');
    }
  });

  it('AC-4: the greeting, sale and farewell are final non-looping, non-spatial music-bus one-shots', () => {
    for (const cue of [STINGERS?.greeting, STINGERS?.sale, STINGERS?.farewell]) {
      const def = registry.get(cue ?? '');
      expect(def?.placeholder).toBe(false);
      expect(def?.loop).toBe(false);
      expect(def?.spatial).toBe(false);
      expect(def?.bus).toBe('music');
    }
  });

  it('AC-6: every asset ships as an Opus + AAC pair', () => {
    for (const asset of ASSETS) {
      for (const ext of ['ogg', 'm4a']) {
        expect(existsSync(`${AUDIO_DIR}/${assetCategory(asset)}/${asset}.${ext}`)).toBe(true);
      }
    }
  });

  it('AC-7: CREDITS and each prompt file record Suno v6, Pro annual and the Voice Memos route', () => {
    const credits = readFileSync('assets/CREDITS.md', 'utf8');
    for (const asset of ASSETS) {
      const row = credits.split('\n').find((line) => line.startsWith(`| ${asset}`));
      expect(row).toContain('generated:suno/v6');
      expect(row).toContain('Suno Pro (annual)');
      expect(row).toContain(`assets/prompts/music/${asset}.md`);
      const prompt = readFileSync(`assets/prompts/music/${asset}.md`, 'utf8');
      expect(prompt).toMatch(/Suno v6/);
      expect(prompt).toMatch(/Pro plan \(annual\)/);
      expect(prompt).toMatch(/https:\/\/suno\.com\/song\//);
    }
    for (const asset of ASSETS.slice(1)) {
      expect(readFileSync(`assets/prompts/music/${asset}.md`, 'utf8')).toMatch(/Voice Memos/);
    }
  });

  it('AC-8: the bed belongs to the store scene, which has the merchant counter', () => {
    const scene = JSON.parse(readFileSync('src/content/data/scene/marsh-store.json', 'utf8')) as {
      id: string;
      spawns: { tags?: string[] }[];
    };
    expect(scene.id).toBe(BED?.scene);
    expect(scene.spawns.some((s) => s.tags?.includes(`merchant:${STINGERS?.merchant ?? ''}`))).toBe(
      true,
    );
  });
});
