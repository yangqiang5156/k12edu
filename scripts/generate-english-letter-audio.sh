#!/usr/bin/env bash
set -euo pipefail

# 为 A-Z 生成带清晰停顿和中英文过渡语的离线读音。
project_dir="$(cd "$(dirname "$0")/.." && pwd)"
output_dir="$project_dir/public/audio/english"
audio_tmp_dir="$(mktemp -d)"
trap 'rm -rf "$audio_tmp_dir"' EXIT

mkdir -p "$output_dir"

transition_file="$audio_tmp_dir/transition.aiff"
say -v Tingting -r 155 -o "$transition_file" "字母读完啦，接着听单词。"

node -e '
  const data = require(process.argv[1]);
  data.letters.forEach(([upper, lower, example]) => {
    process.stdout.write(`${upper}\t${lower}\t${example}\n`);
  });
' "$project_dir/src/data/curriculum.json" | while IFS=$'\t' read -r upper lower example; do
  upper_file="$audio_tmp_dir/letter-$lower-upper.aiff"
  lower_file="$audio_tmp_dir/letter-$lower-lower.aiff"
  word_file="$audio_tmp_dir/letter-$lower-word.aiff"
  target_file="$output_dir/letter-$lower.mp3"

  say -v Samantha -r 135 -o "$upper_file" "$upper."
  say -v Samantha -r 135 -o "$lower_file" "$lower."
  say -v Samantha -r 135 -o "$word_file" "$example."

  ffmpeg -hide_banner -loglevel error -y \
    -i "$upper_file" \
    -f lavfi -t 0.85 -i "anullsrc=r=22050:cl=mono" \
    -i "$lower_file" \
    -f lavfi -t 1.2 -i "anullsrc=r=22050:cl=mono" \
    -i "$transition_file" \
    -f lavfi -t 0.75 -i "anullsrc=r=22050:cl=mono" \
    -i "$word_file" \
    -filter_complex \
      "[0:a]aresample=22050,aformat=sample_fmts=s16:channel_layouts=mono[a0];\
       [1:a]aformat=sample_fmts=s16:sample_rates=22050:channel_layouts=mono[a1];\
       [2:a]aresample=22050,aformat=sample_fmts=s16:channel_layouts=mono[a2];\
       [3:a]aformat=sample_fmts=s16:sample_rates=22050:channel_layouts=mono[a3];\
       [4:a]aresample=22050,aformat=sample_fmts=s16:channel_layouts=mono[a4];\
       [5:a]aformat=sample_fmts=s16:sample_rates=22050:channel_layouts=mono[a5];\
       [6:a]aresample=22050,aformat=sample_fmts=s16:channel_layouts=mono[a6];\
       [a0][a1][a2][a3][a4][a5][a6]concat=n=7:v=0:a=1[out]" \
    -map "[out]" -ar 22050 -ac 1 -b:a 40k "$target_file"
done

echo "已生成 26 个带停顿和过渡语的离线字母语音。"
