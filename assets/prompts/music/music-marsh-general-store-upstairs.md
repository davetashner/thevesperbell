# music-marsh-general-store-upstairs

| Field | Value |
|---|---|
| Asset id | `music-marsh-general-store-upstairs` (cue `music-marsh-home`) |
| Category | music |
| Consuming bead(s) | `mw-ju8.11` |
| Prompt bead | `mw-ju8.10 (section 2)` |
| Suno mode | Songs (Custom, Instrumental ON), made with Cover of the store take (Audio Influence 49%) to keep key and melody |
| Template | `_templates/music-track.md` |
| Anchor / reference inputs | none |
| Family | Marsh's General Store (D dorian, 6/8) |

## Brief

The shopkeeper's home above Marsh's General Store: the shop theme melody played slowly and softly, same key. It loops as the music bed on the upper floor and crossfades with the shop theme when the player changes floor.

## Filled prompt

```text
STYLE FIELD:
instrumental, dark folk fantasy RPG score, medieval and early-baroque, hurdy-gurdy drone, nyckelharpa melody, solo cello, low string ensemble, wordless choir oohs, frame drum, bodhran, hammered dulcimer, celtic harp, wooden flute, modal harmony, acoustic, organic, intimate stone-hall reverb, mysterious yet warm and hopeful, cinematic but restrained, no vocals, D dorian, 72 bpm, 6/8, intimate homely evening, kettle-warm, solo celtic harp and soft solo cello, sparse hammered dulcimer, slow breathing pace, the shop theme melody played slowly and softly, fireside stillness, loopable, no vocals

LYRICS FIELD:
[Intro]
[Instrumental]
[Main theme, slow]
[Instrumental break]
[Outro]
```

**Exclude styles** (audio bible §4.1, verbatim):

```text
vocals, lyrics, rap, pop, EDM, dubstep, trap, drum kit, electric guitar, synth, synth pad, 808, trailer braams, orchestral hits, lo-fi, autotune
```

## Output spec

| Property | Value |
|---|---|
| Key / mode | D dorian (same as the store theme, by Cover; not verified with an analyser) |
| BPM / metre | 72 / 6 beats per bar as written in the sidecar (100 s loop = 20 bars of 5 s at 72 bpm eighth-note pulse; not verified against the take's real grid) |
| Source format | WAV in `assets/_incoming/music/music-marsh-general-store-upstairs.wav` (gitignored): 48 kHz 16-bit MONO, 204.6 s (2.7 s of silence at the start), -35.4 LUFS integrated, peak -19.8 dBFS; a Voice Memos placeholder the owner may replace with a stereo Suno download later |
| Runtime | `public/assets/audio/music/music-marsh-general-store-upstairs.{ogg,m4a,json}`: 100.0 s loop cut at 12.0 s of the source with a 3.0 s equal-power crossfade, -18 LUFS integrated (+17 dB of gain on a quiet recording), peak -3.1 dBFS (Opus), no denoise |

Reproduce: scripts/audio/import-suno-take.sh assets/_incoming/music/music-marsh-general-store-upstairs.wav public/assets/audio/music music-marsh-general-store-upstairs -18 -1.5 96 96 12 100 3 72 6 "D dorian"

## Consistency checklist

- [x] Preamble pasted verbatim
- [x] No artist, composer, band or game names
- [x] Generated on a paid Suno tier (Pro, annual v6), tier and date recorded
- [x] Zero intelligible words (instrumental; owner auditioned and approved)
- [ ] Key and BPM verified with an analyser on import
- [x] Loop seam chosen on import (equal-power crossfade, no click at the seam)

## Approval gate

| Gate | Version | Decision | Approver | Date | Note |
|---|---|---|---|---|---|
| music-take (owner picks in Suno) | v1 | approved | owner | 2026-11-07 | owner picked take B in Suno 2026-11-07 (AC-1, AC-2 of `mw-ju8.10`); `approvals.json` hash entry to follow |

## Iteration log

| # | Date | Tool / model / tier | Prompt change | Result | Keep? |
|---|---|---|---|---|---|
| 1 | 2026-11-07 | Suno v6 / Pro plan (annual), Cover of the store take, Audio Influence 49% | initial; two takes | take B https://suno.com/song/ffcc391d-4f2b-495f-9bc7-5b1020926909 (3:23) | yes, owner's pick |
| 2 | 2026-11-07 | macOS Voice Memos (owner) | none | the monthly download cap was spent, so the owner recorded the take playing; the WAV above is that recording | yes, until a stereo download replaces it |

## Provenance (copy into `assets/CREDITS.md` on integrate)

| Asset id | Source file | SHA-256 | Tool | Date | Licence / terms | Prompt file |
|---|---|---|---|---|---|---|
| music-marsh-general-store-upstairs | `assets/_incoming/music/music-marsh-general-store-upstairs.wav` | `94724b3baa5266823b313fca69816c9a89e06ba66de19ef20108ef6a811d59a6` | Suno v6 (Pro plan, annual), recorded via macOS Voice Memos; owner-made | 2026-11-07 | GEN-OWNED: Suno terms, paid-tier output owned by the user | this file |
