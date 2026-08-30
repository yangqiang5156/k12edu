#!/usr/bin/env bash
set -euo pipefail

# 为内置常用字生成离线讲读；已有且有效的音频会保留。
project_dir="$(cd "$(dirname "$0")/.." && pwd)"
output_dir="$project_dir/public/audio/literacy"
audio_tmp_dir="$(mktemp -d)"
start_index="${1:-1}"
end_index="${2:-9999}"
trap 'rm -rf "$audio_tmp_dir"' EXIT

mkdir -p "$output_dir"

node -e '
  const data = require(process.argv[1]);
  [...new Set([...data.characterCorpus])].forEach((character, index) => {
    process.stdout.write(`${index + 1}\t${character}\n`);
  });
' "$project_dir/src/data/curriculum.json" | while IFS=$'\t' read -r item_number character; do
  if (( item_number < start_index || item_number > end_index )); then
    continue
  fi
  source_file="$audio_tmp_dir/char-$item_number.aiff"
  target_file="$output_dir/char-$item_number.mp3"

  if [[ -s "$target_file" ]] && ffprobe -v error "$target_file" >/dev/null 2>&1; then
    continue
  fi

  say -v Tingting -r 170 -o "$source_file" "${character}。这个字读，${character}。"
  ffmpeg -hide_banner -loglevel error -y -i "$source_file" -ar 22050 -ac 1 -b:a 32k "$target_file"
done

echo "已准备 $(find "$output_dir" -name '*.mp3' | wc -l | tr -d ' ') 个离线识字语音。"
