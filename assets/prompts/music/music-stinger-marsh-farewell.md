# music-stinger-marsh-farewell

| Field | Value |
|---|---|
| Asset id | `music-stinger-marsh-farewell` (cue `stinger-marsh-farewell`) |
| Category | music |
| Consuming bead(s) | `mw-ju8.11` |
| Prompt bead | `mw-ju8.10 (section 4, generated as a separate cue)` |
| Suno mode | Songs (Custom, Instrumental ON), one cue per generation (the original three-cue bundle came out as one continuous piece) |
| Template | `_templates/music-stinger.md` |
| Anchor / reference inputs | none |
| Family | Marsh's General Store (D dorian, 6/8) |

## Brief

Plays when the player closes Marsh's General Store's shop window. A non-spatial one-shot on the music bus.

## Filled prompt

```text
STYLE FIELD:
instrumental, dark folk fantasy RPG score, medieval and early-baroque, hurdy-gurdy drone, nyckelharpa melody, solo cello, low string ensemble, wordless choir oohs, frame drum, bodhran, hammered dulcimer, celtic harp, wooden flute, modal harmony, acoustic, organic, intimate stone-hall reverb, mysterious yet warm and hopeful, cinematic but restrained, no vocals, D dorian, 92 bpm, a gentle descending two-phrase figure on solo flute and harp, 4 seconds, friendly, clear ending

LYRICS FIELD:
[Instrumental]
[Short cue]
[End]
```

**Exclude styles** (audio bible §4.1, verbatim):

```text
vocals, lyrics, rap, pop, EDM, dubstep, trap, drum kit, electric guitar, synth, synth pad, 808, trailer braams, orchestral hits, lo-fi, autotune
```

## Output spec

| Property | Value |
|---|---|
| Key / mode | D dorian (not verified with an analyser) |
| BPM / metre | 92 (nominal) |
| Source format | WAV in `assets/_incoming/music/music-stinger-marsh-farewell.wav` (gitignored): 48 kHz mono, 21.5 s, -23.3 LUFS integrated, peak -9.9 dBFS; the take was recorded via Voice Memos (see the iteration log) |
| Runtime | `public/assets/audio/music/music-stinger-marsh-farewell.{ogg,m4a}`: 10.2 s; OWNER INSTRUCTION: only up to 10.20 s of the 21.5 s take (new music starts right after), with a 10 ms fade-in and a 0.4 s fade-out ending at 10.20 s so the next phrase never sounds; normalised to -16 LUFS with a -2 dBTP limiter: measured -16.0 LUFS, peak -3.5 dBFS (Opus); -16.0 LUFS, peak -3.4 dBFS (AAC) |

Reproduce: ffmpeg -i assets/_incoming/music/music-stinger-marsh-farewell.wav -af "atrim=start=0:end=10.2,asetpts=PTS-STARTPTS,afade=t=in:d=0.01,afade=t=out:st=9.8:d=0.4" /tmp/farewell.wav && scripts/audio/import-suno-take.sh /tmp/farewell.wav public/assets/audio/music music-stinger-marsh-farewell -16 -1.5 96 96

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
| music-take (owner picks in Suno) | v1 | approved | owner | 2026-11-07 | owner picked take B in Suno 2026-11-07 and approved the cut; `approvals.json` hash entry to follow |

## Iteration log

| # | Date | Tool / model / tier | Prompt change | Result | Keep? |
|---|---|---|---|---|---|
| 1 | 2026-11-07 | Suno v6 / Pro plan (annual) | initial; two takes (A, B) | take B https://suno.com/song/ad9497b6-ed1b-4f5b-81d0-cbaf46c7dc75 | yes, owner's pick |
| 2 | 2026-11-07 | macOS Voice Memos (owner) | none | the Suno take was recorded as played with macOS Voice Memos by the owner (mono AAC about 62 kbps) on 2026-11-07, because the monthly Suno download cap was spent; the AAC pass, not Suno's WAV, is the source (lossy-on-lossy) | yes |

## Provenance (copy into `assets/CREDITS.md` on integrate)

| Asset id | Source file | SHA-256 | Tool | Date | Licence / terms | Prompt file |
|---|---|---|---|---|---|---|
| music-stinger-marsh-farewell | `assets/_incoming/music/music-stinger-marsh-farewell.wav` | `453539eb7e6f7c6c133f94c029ff7dca48857e41908eed5852a19113a83b554e` | Suno v6 (Pro plan, annual), recorded via macOS Voice Memos; owner-made | 2026-11-07 | GEN-OWNED: Suno terms, paid-tier output owned by the user | this file |
