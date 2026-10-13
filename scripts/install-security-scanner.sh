#!/usr/bin/env sh
set -eu
# CI固定Linux x64版本和官方归档SHA256；更新版本时必须同时更新校验值。
scanner_dir="${RUNNER_TEMP:-/tmp}/lexue-gitleaks"
mkdir -p "$scanner_dir"
curl -fsSL --retry 3 --max-time 60 \
  https://github.com/gitleaks/gitleaks/releases/download/v8.30.1/gitleaks_8.30.1_linux_x64.tar.gz \
  -o "$scanner_dir/gitleaks.tar.gz"
printf '%s  %s\n' 551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb "$scanner_dir/gitleaks.tar.gz" | sha256sum -c -
tar -xzf "$scanner_dir/gitleaks.tar.gz" -C "$scanner_dir" gitleaks
if [ -n "${GITHUB_PATH:-}" ]; then printf '%s\n' "$scanner_dir" >> "$GITHUB_PATH"; fi
