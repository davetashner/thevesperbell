#!/usr/bin/env bash
# Imports one owner-picked Suno take (audio bible §5): optionally cuts a seamless loop, sets the
# file-level loudness, and writes the runtime Opus .ogg + AAC .m4a (+ loop sidecar JSON, §5.3).
#
#   scripts/audio/import-suno-take.sh <in.wav> <out-dir> <asset-id> <lufs> <true-peak-db> \
#       <opus-kbps> <aac-kbps> [<loop-start-s> <loop-len-s> <crossfade-s> <bpm> <beats-per-bar> <key>]
#
# Without loop arguments the whole take is encoded as is (no sidecar). With them, the segment
# [start, start+len+crossfade] is cut and the last `crossfade` seconds are blended (equal power) into
# the first, so the file loops seamlessly from its end to its start with no bar-grid assumption; the
# sidecar then spans the whole file. Gain is a single linear gain to the target integrated loudness
# followed by a true-peak limiter; the encoded files are re-measured and printed.
set -euo pipefail

in="$1" out="$2" id="$3" lufs="$4" tp="$5" opus_k="$6" aac_k="$7"
start="${8:-}" len="${9:-}" xf="${10:-}" bpm="${11:-}" bpb="${12:-}" key="${13:-}"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$out"

if [[ -n "$start" ]]; then
  end="$(awk -v s="$start" -v l="$len" -v x="$xf" 'BEGIN { printf "%.6f", s + l + x }')"
  tail_from="$(awk -v s="$start" -v l="$len" 'BEGIN { printf "%.6f", s + l }')"
  head_to="$(awk -v s="$start" -v x="$xf" 'BEGIN { printf "%.6f", s + x }')"
  ffmpeg -v error -y -i "$in" -filter_complex \
    "[0:a]atrim=start=${start}:end=${head_to},asetpts=PTS-STARTPTS,afade=t=in:d=${xf}:curve=qsin[h];
     [0:a]atrim=start=${tail_from}:end=${end},asetpts=PTS-STARTPTS,afade=t=out:d=${xf}:curve=qsin[t];
     [h][t]amix=inputs=2:normalize=0:duration=longest[m];
     [0:a]atrim=start=${head_to}:end=${tail_from},asetpts=PTS-STARTPTS[r];
     [m][r]concat=n=2:v=0:a=1[o]" -map '[o]' -ar 48000 -c:a pcm_s16le "$tmp/seg.wav"
else
  ffmpeg -v error -y -i "$in" -ar 48000 -c:a pcm_s16le "$tmp/seg.wav"
fi

measured="$(ffmpeg -nostats -i "$tmp/seg.wav" -af ebur128=peak=true -f null - 2>&1 |
  awk '/^ +I:/ { i = $2 } END { print i }')"
gain="$(awk -v t="$lufs" -v m="$measured" 'BEGIN { printf "%.2f", t - m }')"
chain="volume=${gain}dB,alimiter=limit=$(awk -v t="$tp" 'BEGIN { printf "%.4f", 10 ^ ((t - 0.5) / 20) }'):level=disabled:attack=5:release=60"
if [[ -n "$start" ]]; then
  # The limiter delays its output by its attack time, which would put a gap at the loop seam. Limit
  # three copies back to back and keep the middle one, so its start and end are already in the loop.
  n="$(ffprobe -v error -select_streams a:0 -show_entries stream=duration_ts -of csv=p=0 "$tmp/seg.wav")"
  ffmpeg -v error -y -i "$tmp/seg.wav" -af \
    "aloop=loop=2:size=${n}:start=0,${chain},atrim=start_sample=${n}:end_sample=$((2 * n)),asetpts=PTS-STARTPTS" \
    -ar 48000 -c:a pcm_s16le "$tmp/norm.wav"
else
  ffmpeg -v error -y -i "$tmp/seg.wav" -af "$chain" -ar 48000 -c:a pcm_s16le "$tmp/norm.wav"
fi
ffmpeg -v error -y -i "$tmp/norm.wav" -map_metadata -1 -c:a libopus -b:a "${opus_k}k" -vbr on "$out/$id.ogg"
ffmpeg -v error -y -i "$tmp/norm.wav" -map_metadata -1 -c:a aac -b:a "${aac_k}k" -movflags +faststart "$out/$id.m4a"

if [[ -n "$start" ]]; then
  samples="$(ffprobe -v error -select_streams a:0 -show_entries stream=duration_ts -of csv=p=0 "$tmp/norm.wav")"
  printf '{ "bpm": %s, "beatsPerBar": %s, "loopStartSample": 0, "loopEndSample": %s, "key": "%s" }\n' \
    "$bpm" "$bpb" "$samples" "$key" >"$out/$id.json"
fi

for f in "$out/$id.ogg" "$out/$id.m4a"; do
  echo "== $f"
  ffmpeg -nostats -i "$f" -af ebur128=peak=true -f null - 2>&1 |
    awk '/^ +(I|LRA|Peak):/ { printf "%s %s %s\n", $1, $2, $3 }'
  ffprobe -v error -show_entries format=duration -of csv=p=0 "$f"
done
