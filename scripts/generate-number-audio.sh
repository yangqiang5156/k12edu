#!/usr/bin/env bash
set -euo pipefail

# 使用 macOS 本地语音合成生成数字词元，再压缩为浏览器通用的 MP3。
# PWA 按数字结构组合这些短音频，无需为 0–1000 分别保存整句语音。
project_dir="$(cd "$(dirname "$0")/.." && pwd)"
output_dir="$project_dir/public/audio/numbers"
audio_tmp_dir="$(mktemp -d)"
trap 'rm -rf "$audio_tmp_dir"' EXIT

mkdir -p "$output_dir"

zh_names=(zh_0 zh_1 zh_2 zh_3 zh_4 zh_5 zh_6 zh_7 zh_8 zh_9 zh_ten zh_hundred zh_thousand)
zh_words=(零 一 二 三 四 五 六 七 八 九 十 百 千)

en_names=(en_0 en_1 en_2 en_3 en_4 en_5 en_6 en_7 en_8 en_9 en_10 en_11 en_12 en_13 en_14 en_15 en_16 en_17 en_18 en_19 en_20 en_30 en_40 en_50 en_60 en_70 en_80 en_90 en_hundred en_thousand en_and)
en_words=(zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty thirty forty fifty sixty seventy eighty ninety hundred thousand and)

generate_token() {
  local voice="$1"
  local rate="$2"
  local name="$3"
  local text="$4"
  local source_file="$audio_tmp_dir/$name.aiff"
  local target_file="$output_dir/$name.mp3"

  say -v "$voice" -r "$rate" -o "$source_file" "$text"
  ffmpeg -hide_banner -loglevel error -y -i "$source_file" -ar 22050 -ac 1 -b:a 40k "$target_file"
}

for index in "${!zh_names[@]}"; do
  generate_token Tingting 175 "${zh_names[$index]}" "${zh_words[$index]}"
done

for index in "${!en_names[@]}"; do
  generate_token Samantha 165 "${en_names[$index]}" "${en_words[$index]}"
done

echo "已生成 $(find "$output_dir" -name '*.mp3' | wc -l | tr -d ' ') 个离线数字语音片段。"
