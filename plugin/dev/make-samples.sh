#!/usr/bin/env bash
# Genera i video SINTETICI dell'harness (plugin/dev/sample/, ignorati da git): barre di prova con nome della clip e
# numero di frame impressi, tono audio. c5 e' in ProRes (Chromium non lo decodifica: serve a provare il ripiego).
# Uso: bash plugin/dev/make-samples.sh     (richiede ffmpeg)
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p sample
command -v ffmpeg >/dev/null || { echo "ffmpeg non trovato" >&2; exit 1; }
make() { # nome frame_totali tinta frequenza codec
  local name="$1" frames="$2" hue="$3" freq="$4" codec="$5" ext="mp4" vc=(-c:v libx264 -pix_fmt yuv420p -preset veryfast -crf 30) ac=(-c:a aac -b:a 64k)
  if [ "$codec" = "prores" ]; then ext="mov"; vc=(-c:v prores_ks -profile:v 0); ac=(-c:a pcm_s16le); fi
  local dur; dur=$(awk "BEGIN{print $frames/25}")
  ffmpeg -hide_banner -loglevel error -y \
    -f lavfi -i "testsrc2=size=640x360:rate=25:duration=$dur" \
    -f lavfi -i "sine=frequency=$freq:duration=$dur:sample_rate=48000" \
    -vf "hue=h=$hue,drawtext=text='$name  %{frame_num}':fontsize=40:fontcolor=white:x=20:y=300:box=1:boxcolor=black@0.6" \
    -af "volume=0.15" "${vc[@]}" "${ac[@]}" -shortest "sample/$name.$ext"
  echo "sample/$name.$ext"
}
make c1 1500 0 330 h264
make c2 1200 120 440 h264
make c3 900 240 550 h264
make c4 1100 60 660 h264
make c5 400 300 770 prores
