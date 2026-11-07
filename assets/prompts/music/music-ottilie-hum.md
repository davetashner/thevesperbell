# music-ottilie-hum

| Field | Value |
|---|---|
| Asset id | `music-ottilie-hum` (Ottilie's wordless working hum; cue `hum-ottilie`) |
| Category | music |
| Consuming bead(s) | `mw-ju8.40` (integrated now, ahead of the rest of `mw-ju8.11`) |
| Prompt bead | `mw-ju8.10` (section 3) |
| Suno mode | Songs (Custom, Instrumental OFF: a hum is a voice; the lyrics field holds no words) |
| Template | `_templates/music-track.md` |
| Anchor / reference inputs | none |
| Family | Marsh's General Store (D dorian, 92 bpm, 6/8), the shop theme melody hummed |

## Brief

A wordless, close-miked female hum, as Ottilie Marsh hums absent-mindedly while she works. It plays as a looping spatial sound at her position in the ground-floor shop, audible at the counter and fading with distance, so it sits under her dialogue. There is no voice acting in the MVP (audio bible); this is her sound identity beside the shop theme.

## Filled prompt

```text
STYLE FIELD:
solo female humming, wordless, mm and hm only, close-miked, warm, mature low-mid voice, unaccompanied with one soft hammered dulcimer drone, D dorian, 92 bpm, 6/8, the shop theme melody hummed absent-mindedly while working, medieval folk, intimate dry room, no words, no lyrics

LYRICS FIELD:
[Hummed melody, wordless: mm, hm, mm]
[Hummed melody, wordless: mm, hm, mm]
```

**Exclude styles:**

```text
lyrics, words, singing, choir, pop, rap, EDM, drum kit, electric guitar, synth, autotune, reverb wash, vibrato diva
```

## Output spec

| Property | Value |
|---|---|
| Key / mode | D dorian (not verified with an analyser) |
| BPM / metre | 92 / 6 beats per bar as written in the sidecar (the loop is not bar-aligned) |
| Source format | WAV in `assets/_incoming/music/music-ottilie-hum.wav` (gitignored): 48 kHz 16-bit mono, 170.0 s, -37.4 LUFS integrated, peak -24 dBFS |
| Runtime | `public/assets/audio/music/music-ottilie-hum.{ogg,m4a,json}`: 41.5 s loop cut at 64.5 s of the source with a 2.5 s equal-power crossfade, -22 LUFS integrated, peak -8.9 dBFS, no denoise |

Reproduce: `scripts/audio/import-suno-take.sh assets/_incoming/music/music-ottilie-hum.wav public/assets/audio/music music-ottilie-hum -22 -3 48 64 64.5 41.5 2.5 92 6 "D dorian"`

## Consistency checklist

- [x] Preamble not used: this take is a voice, so the shared instrumental preamble would contradict it (the style field above is the brief's own)
- [x] No artist, composer, band or game names
- [x] Generated on a paid Suno tier (Pro, annual v6), tier and date recorded
- [x] Zero intelligible words (owner auditioned and approved)
- [ ] Key and BPM verified with an analyser on import
- [x] Loop seam chosen on import (silent gaps between phrases, no click at the seam)

## Approval gate

| Gate | Version | Decision | Approver | Date | Note |
|---|---|---|---|---|---|
| music-take (owner picks in Suno) | v1 | approved | owner | 2026-11-07 | vocal stem of take B, "much better isolated", no words; `approvals.json` hash entry to follow |

## Iteration log

| # | Date | Tool / model / tier | Prompt change | Result | Keep? |
|---|---|---|---|---|---|
| 1 | 2026-11-07 | Suno v6 / Pro plan (annual) | initial; two takes titled `music-ottilie-hum` (2:45, 3:00); Suno's style rewrite added "full-voice belt" and "layered backing hums" | take B https://suno.com/song/8778266c-5aac-4f81-a2a3-bf21ee30d6b4 (owner liked it from 0:10 but it has instruments) | no, as is |
| 2 | 2026-11-07 | Suno v6 auto stem split (vocals) | none | vocal stem https://suno.com/song/831a0ed6-f6a9-4f98-9db9-aff36ef2040b, the instrument-free hum | yes, owner's pick |
| 3 | 2026-11-07 | macOS Voice Memos (owner) | none | the monthly Suno download cap was spent, so the owner played the stem and recorded and exported it with Voice Memos (mono AAC about 62 kbps), trimmed the silent start; converted to the WAV above (original kept as `music-ottilie-hum.source.m4a`, both gitignored). The AAC pass, not Suno's WAV, is the source: quality is lossy-on-lossy | yes |

## Provenance (copy into `assets/CREDITS.md` on integrate)

| Asset id | Source file | SHA-256 | Tool | Date | Licence / terms | Prompt file |
|---|---|---|---|---|---|---|
| music-ottilie-hum | `assets/_incoming/music/music-ottilie-hum.wav` | `ad12128152c12f31475bde96ecf6a4e91fbd662743438e5fcfb1880b47f2da97` | Suno v6 (Pro plan, annual), vocal stem split, recorded via macOS Voice Memos; owner-made | 2026-11-07 | GEN-OWNED: Suno terms, paid-tier output owned by the user | this file |
