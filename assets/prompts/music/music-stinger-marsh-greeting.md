# music-stinger-marsh-greeting

| Field | Value |
|---|---|
| Asset id | `music-stinger-marsh-greeting` (cue `stinger-marsh-greeting`) |
| Category | music |
| Consuming bead(s) | `mw-ju8.11` |
| Prompt bead | `mw-ju8.10 (section 4, generated as a separate cue)` |
| Suno mode | Songs (Custom, Instrumental ON), one cue per generation (the original three-cue bundle came out as one continuous piece) |
| Template | `_templates/music-stinger.md` |
| Anchor / reference inputs | none |
| Family | Marsh's General Store (D dorian, 6/8) |

## Brief

Plays when the player opens Marsh's General Store's shop window. A non-spatial one-shot on the music bus.

## Filled prompt

```text
STYLE FIELD:
instrumental, dark folk fantasy RPG score, medieval and early-baroque, hurdy-gurdy drone, nyckelharpa melody, solo cello, low string ensemble, wordless choir oohs, frame drum, bodhran, hammered dulcimer, celtic harp, wooden flute, modal harmony, acoustic, organic, intimate stone-hall reverb, mysterious yet warm and hopeful, cinematic but restrained, no vocals, D dorian, 92 bpm, a bright small shop-bell chime flourish on celtic harp and wooden flute, 3 seconds, welcoming

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
| Source format | WAV in `assets/_incoming/music/music-stinger-marsh-greeting.wav` (gitignored): 48 kHz mono, 31.3 s, -34.9 LUFS integrated, peak -19.1 dBFS; the take was recorded via Voice Memos (see the iteration log) |
| Runtime | `public/assets/audio/music/music-stinger-marsh-greeting.{ogg,m4a}`: 4.0 s; the first 4.0 s of the take (a continuous 31.3 s piece, no timestamp from the owner), starting 0.05 s in to drop the leading silence, with a 10 ms fade-in and a 1.0 s fade-out; normalised to -16 LUFS with a -2 dBTP limiter: measured -16.1 LUFS, peak -1.8 dBFS (Opus); -16.2 LUFS, peak -1.9 dBFS (AAC) |

Reproduce: ffmpeg -i assets/_incoming/music/music-stinger-marsh-greeting.wav -af "atrim=start=0.05:end=4.05,asetpts=PTS-STARTPTS,afade=t=in:d=0.01,afade=t=out:st=3:d=1" /tmp/greeting.wav && scripts/audio/import-suno-take.sh /tmp/greeting.wav public/assets/audio/music music-stinger-marsh-greeting -16 -1.5 96 96

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
| 1 | 2026-11-07 | Suno v6 / Pro plan (annual) | initial; two takes (A, B) | take B https://suno.com/song/c71345f2-4cd3-446e-86a9-89fa4394f1b6 | yes, owner's pick |
| 2 | 2026-11-07 | macOS Voice Memos (owner) | none | the Suno take was recorded as played with macOS Voice Memos by the owner (mono AAC about 62 kbps) on 2026-11-07, because the monthly Suno download cap was spent; the AAC pass, not Suno's WAV, is the source (lossy-on-lossy) | yes |

## Provenance (copy into `assets/CREDITS.md` on integrate)

| Asset id | Source file | SHA-256 | Tool | Date | Licence / terms | Prompt file |
|---|---|---|---|---|---|---|
| music-stinger-marsh-greeting | `assets/_incoming/music/music-stinger-marsh-greeting.wav` | `4f006eff1ee243e202a8ad1073fcab21ea3064c1e3fc0b1c4869005701c5925e` | Suno v6 (Pro plan, annual), recorded via macOS Voice Memos; owner-made | 2026-11-07 | GEN-OWNED: Suno terms, paid-tier output owned by the user | this file |
