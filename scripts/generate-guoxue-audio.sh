#!/usr/bin/env bash
set -euo pipefail

# 为内置古诗和经典古文生成带标题、作者、诗句停顿的离线朗读。
project_dir="$(cd "$(dirname "$0")/.." && pwd)"
output_dir="$project_dir/public/audio/guoxue"
audio_tmp_dir="$(mktemp -d)"
start_index="${1:-1}"
end_index="${2:-9999}"
trap 'rm -rf "$audio_tmp_dir"' EXIT

mkdir -p "$output_dir"

esbuild_candidates=("$project_dir"/node_modules/.pnpm/esbuild@*/node_modules/esbuild/bin/esbuild)
esbuild_bin="${esbuild_candidates[0]}"
if [[ ! -x "$esbuild_bin" ]]; then
  echo "未找到 esbuild，无法读取内置国学内容。" >&2
  exit 1
fi

"$esbuild_bin" "$project_dir/src/content.ts" --bundle --platform=node --format=esm --outfile="$audio_tmp_dir/content.mjs" >/dev/null

node --input-type=module -e '
  const module = await import(process.argv[1]);
  const items = module.BUILTIN_CONTENT.filter((item) => item.module === "guoxue" && (item.kind === "poem" || item.kind === "classic"));
  items.forEach((item, index) => {
    const encode = (value = "") => Buffer.from(value).toString("base64");
    process.stdout.write(`${index + 1}\t${item.id}\t${encode(item.title)}\t${encode(item.subtitle)}\t${encode(item.body)}\n`);
  });
' "file://$audio_tmp_dir/content.mjs" | while IFS=$'\t' read -r item_index item_id title_b64 subtitle_b64 body_b64; do
  if (( item_index < start_index || item_index > end_index )); then
    continue
  fi

  title="$(printf '%s' "$title_b64" | base64 -D)"
  subtitle="$(printf '%s' "$subtitle_b64" | base64 -D)"
  body="$(printf '%s' "$body_b64" | base64 -D)"
  # 古文的“掌握XX首古诗后解锁”仅用于排课判断，不属于朗读正文。
  case "$subtitle" in
    掌握*首古诗后解锁) subtitle="" ;;
  esac
  body_with_pauses="${body//$'\n'/。 [[slnc 720]] }"
  source_file="$audio_tmp_dir/$item_id.aiff"
  target_file="$output_dir/$item_id.mp3"
  if [[ "$item_id" == classic-* ]]; then
    # 使用新文件名，避免已安装PWA或浏览器继续播放旧版古文缓存。
    target_file="$output_dir/$item_id-clean-v2.mp3"
  fi
  author_part=""
  if [[ -n "$subtitle" ]]; then
    author_part="[[rate 145]] ${subtitle}。 [[slnc 850]]"
  fi
  phrase="[[rate 158]] ${title}。 [[slnc 720]] ${author_part} [[rate 138]] ${body_with_pauses}"

  say -v Tingting -r 145 -o "$source_file" "$phrase"
  ffmpeg -hide_banner -loglevel error -y -i "$source_file" -af "highpass=f=80,lowpass=f=9000" -ar 22050 -ac 1 -b:a 40k "$target_file"
done

echo "已准备 $(find "$output_dir" -name '*.mp3' | wc -l | tr -d ' ') 个有节奏的国学离线朗读。"
