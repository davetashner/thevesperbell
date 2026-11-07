import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  assetCategory,
  gameSoundRegistry,
  inverseDistanceGain,
  loopSidecarSchema,
} from '@audio/index';
import { SCENE_HUMS } from './scene-hums.ts';

const AUDIO_DIR = 'public/assets/audio';
const hum = SCENE_HUMS.find((h) => h.point === 'npc-ottilie');

describe('Ottilie’s hum (mw-ju8.40)', () => {
  const def = gameSoundRegistry().get(hum?.cue ?? '');

  it('AC-1: the hum is a final Opus + AAC pair with a loop sidecar spanning the file', () => {
    expect(def).toBeDefined();
    expect(def?.placeholder).toBe(false);
    expect(def?.loop).toBe(true);
    for (const asset of def?.variants ?? []) {
      for (const ext of ['ogg', 'm4a']) {
        expect(existsSync(`${AUDIO_DIR}/${assetCategory(asset)}/${asset}.${ext}`)).toBe(true);
      }
      const sidecar = loopSidecarSchema.parse(
        JSON.parse(readFileSync(`${AUDIO_DIR}/${assetCategory(asset)}/${asset}.json`, 'utf8')),
      );
      expect(sidecar.loopStartSample).toBe(0);
      // 41.5 s at 48 kHz: a 30 to 60 s crossfaded loop.
      expect(sidecar.loopEndSample / 48000).toBeGreaterThanOrEqual(30);
      expect(sidecar.loopEndSample / 48000).toBeLessThanOrEqual(60);
    }
  });

  it('AC-2: the hum is a spatial loop on the music bus that fades with distance from Ottilie', () => {
    expect(def?.spatial).toBe(true);
    expect(def?.bus).toBe('music');
    const sceneText = readFileSync('src/content/data/scene/marsh-store.json', 'utf8');
    const scene = JSON.parse(sceneText) as {
      spawns: { id: string; at: number[]; creature?: string }[];
    };
    const ottilie = scene.spawns.find((s) => s.id === hum?.point);
    const counter = scene.spawns.find((s) => s.id === 'shop-counter');
    expect(hum?.scene).toBe('marsh-store');
    expect(ottilie?.creature).toBe('npc-ottilie');
    const [ox = 0, , oz = 0] = ottilie?.at ?? [];
    const [cx = 0, , cz = 0] = counter?.at ?? [];
    const atCounter = inverseDistanceGain(Math.hypot(ox - cx, oz - cz));
    const atDoor = inverseDistanceGain(7);
    expect(atCounter).toBeGreaterThan(0.8);
    expect(atDoor).toBeLessThan(atCounter / 2);
  });

  it('AC-3: CREDITS and the prompt file record Suno v6 Pro annual, the stem split and Voice Memos', () => {
    const credits = readFileSync('assets/CREDITS.md', 'utf8');
    const row = credits.split('\n').find((line) => line.includes('music-ottilie-hum'));
    expect(row).toContain('generated:suno/v6');
    expect(row).toContain('Suno Pro (annual)');
    expect(row).toContain('assets/prompts/music/music-ottilie-hum.md');
    const prompt = readFileSync('assets/prompts/music/music-ottilie-hum.md', 'utf8');
    expect(prompt).toMatch(/Suno v6/);
    expect(prompt).toMatch(/Pro plan \(annual\)/);
    expect(prompt).toMatch(/stem/i);
    expect(prompt).toMatch(/Voice Memos/);
  });
});
