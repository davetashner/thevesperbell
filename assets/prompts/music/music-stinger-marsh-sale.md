# music-stinger-marsh-sale

| Field | Value |
|---|---|
| Asset id | `music-stinger-marsh-sale` (cue `stinger-marsh-sale`) |
| Category | music |
| Consuming bead(s) | `mw-ju8.11` |
| Prompt bead | `mw-ju8.10 (section 4, generated as a separate cue)` |
| Suno mode | Songs (Custom, Instrumental ON), one cue per generation (the original three-cue bundle came out as one continuous piece) |
| Template | `_templates/music-stinger.md` |
| Anchor / reference inputs | none |
| Family | Marsh's General Store (D dorian, 6/8) |

## Brief

Plays when a deal goes through at Marsh's General Store (buying, selling to the merchant, buying back), at most once per 1.5 s. A non-spatial one-shot on the music bus.

## Filled prompt

```text
STYLE FIELD:
instrumental, dark folk fantasy RPG score, medieval and early-baroque, hurdy-gurdy drone, nyckelharpa melody, solo cello, low string ensemble, wordless choir oohs, frame drum, bodhran, hammered dulcimer, celtic harp, wooden flute, modal harmony, acoustic, organic, intimate stone-hall reverb, mysterious yet warm and hopeful, cinematic but restrained, no vocals, D dorian, 92 bpm, a warm resolving cadence on hammered dulcimer and pizzicato cello with a soft coin-purse jingle, 3 seconds, satisfied

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
| Source format | WAV in `assets/_incoming/music/music-stinger-marsh-sale.wav` (gitignored): 48 kHz mono, 7.4 s, -36.1 LUFS integrated, peak -20.4 dBFS; the take was recorded via Voice Memos (see the iteration log) |
| Runtime | `public/assets/audio/music/music-stinger-marsh-sale.{ogg,m4a}`: 5.6 s; the owner pre-trimmed it to sound from 1.0 s to 6.6 s with silence either side: kept 0.97 s to 6.6 s as is, with a 10 ms fade-in and a 0.2 s fade-out; normalised to -16 LUFS with a -2 dBTP limiter: measured -16.1 LUFS, peak -2.0 dBFS (Opus and AAC) |

Reproduce: ffmpeg -i assets/_incoming/music/music-stinger-marsh-sale.wav -af "atrim=start=0.97:end=6.6,asetpts=PTS-STARTPTS,afade=t=in:d=0.01,afade=t=out:st=5.43:d=0.2" /tmp/sale.wav && scripts/audio/import-suno-take.sh /tmp/sale.wav public/assets/audio/music music-stinger-marsh-sale -16 -1.5 96 96

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
| 1 | 2026-11-07 | Suno v6 / Pro plan (annual) | initial; two takes (A, B) | take B https://suno.com/song/f1516705-c1ac-4ef7-b504-e3ed2ded7d8f | yes, owner's pick |
| 2 | 2026-11-07 | macOS Voice Memos (owner) | none | the Suno take was recorded as played with macOS Voice Memos by the owner (mono AAC about 62 kbps) on 2026-11-07, because the monthly Suno download cap was spent; the AAC pass, not Suno's WAV, is the source (lossy-on-lossy) | yes |

## Provenance (copy into `assets/CREDITS.md` on integrate)

| Asset id | Source file | SHA-256 | Tool | Date | Licence / terms | Prompt file |
|---|---|---|---|---|---|---|
| music-stinger-marsh-sale | `assets/_incoming/music/music-stinger-marsh-sale.wav` | `e8a80e3ad2b1fd686a4295ea94bfcbc61022ce34dc0ef8e57eaeae83e412ccf5` | Suno v6 (Pro plan, annual), recorded via macOS Voice Memos; owner-made | 2026-11-07 | GEN-OWNED: Suno terms, paid-tier output owned by the user | this file |
