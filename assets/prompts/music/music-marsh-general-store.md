# music-marsh-general-store

| Field | Value |
|---|---|
| Asset id | `music-marsh-general-store` (cue `music-marsh-store`) |
| Category | music |
| Consuming bead(s) | `mw-ju8.11` |
| Prompt bead | `mw-ju8.10 (section 1)` |
| Suno mode | Songs (Custom, Instrumental ON) |
| Template | `_templates/music-track.md` |
| Anchor / reference inputs | none |
| Family | Marsh's General Store (D dorian, 6/8) |

## Brief

Marsh's General Store ground-floor shop theme: cosy, unhurried, diegetic. It loops as the music bed while the player is on the shop floor of the store (the upstairs variant takes over on the upper floor). Ottilie's hum plays on top.

## Filled prompt

```text
STYLE FIELD:
instrumental, dark folk fantasy RPG score, medieval and early-baroque, hurdy-gurdy drone, nyckelharpa melody, solo cello, low string ensemble, wordless choir oohs, frame drum, bodhran, hammered dulcimer, celtic harp, wooden flute, modal harmony, acoustic, organic, intimate stone-hall reverb, mysterious yet warm and hopeful, cinematic but restrained, no vocals, D dorian, 92 bpm, 6/8, cosy bustling shop, unhurried, hammered dulcimer lead, celtic harp arpeggios, wooden flute answering phrases, soft frame drum and shaker, pizzicato cello, village warmth, gentle rising fifth then stepwise descending folk melody, loopable, no vocals

LYRICS FIELD:
[Intro]
[Instrumental]
[Main theme]
[Instrumental break]
[Main theme]
[Outro]
```

**Exclude styles** (audio bible §4.1, verbatim):

```text
vocals, lyrics, rap, pop, EDM, dubstep, trap, drum kit, electric guitar, synth, synth pad, 808, trailer braams, orchestral hits, lo-fi, autotune
```

## Output spec

| Property | Value |
|---|---|
| Key / mode | D dorian (not verified with an analyser) |
| BPM / metre | 92 / 6 beats per bar as written in the sidecar (nominal; the loop length is 117.4 s = 30 bars at 92 bpm, but alignment to the take's real grid was not verified) |
| Source format | WAV in `assets/_incoming/music/music-marsh-general-store.wav` (gitignored): 48 kHz 16-bit stereo, 207.8 s, -16.0 LUFS integrated, peak -4.5 dBFS |
| Runtime | `public/assets/audio/music/music-marsh-general-store.{ogg,m4a,json}`: 117.4 s loop cut at 10.0 s of the source (after the intro, before the outro) with a 2.5 s equal-power crossfade, -18 LUFS integrated, peak -6.6 dBFS (Opus), no denoise |

Reproduce: scripts/audio/import-suno-take.sh assets/_incoming/music/music-marsh-general-store.wav public/assets/audio/music music-marsh-general-store -18 -1.5 96 96 10 117.4 2.5 92 6 "D dorian"

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
| music-take (owner picks in Suno) | v1 | approved | owner | 2026-10-04 | owner picked the take in Suno 2026-10-04 (AC-1 of `mw-ju8.10`); `approvals.json` hash entry to follow |

## Iteration log

| # | Date | Tool / model / tier | Prompt change | Result | Keep? |
|---|---|---|---|---|---|
| 1 | 2026-10-04 | Suno v6 / Pro plan (annual) | initial | https://suno.com/song/b5f07ca1-6aff-4aec-87b1-99aec430c716 (3:28, liked in Suno, real WAV download) | yes, owner's pick |

## Provenance (copy into `assets/CREDITS.md` on integrate)

| Asset id | Source file | SHA-256 | Tool | Date | Licence / terms | Prompt file |
|---|---|---|---|---|---|---|
| music-marsh-general-store | `assets/_incoming/music/music-marsh-general-store.wav` | `4cf09bed651badb889e77c9cbbfcac668a100dac055aef448bea652aa997f1cc` | Suno v6 (Pro plan, annual) | 2026-10-04 | GEN-OWNED: Suno terms, paid-tier output owned by the user | this file |
