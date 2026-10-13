#!/bin/sh
set -eu

: "${LEXUE_IMAGE:?缺少 LEXUE_IMAGE}"
: "${LEXUE_APP_ARCHIVE:?缺少 LEXUE_APP_ARCHIVE}"
: "${LEXUE_RUNTIME_IMAGE:?缺少 LEXUE_RUNTIME_IMAGE}"
LEXUE_PORT="${LEXUE_PORT:-}"
COMPOSE_FILE="${COMPOSE_FILE:-compose.yaml}"
CONTAINER_NAME="lexue"

case "$LEXUE_APP_ARCHIVE" in
  */*|*..*)
    printf '应用归档文件名不合法：%s\n' "$LEXUE_APP_ARCHIVE" >&2
    exit 1
    ;;
esac

[ -f "$LEXUE_APP_ARCHIVE" ] || {
  printf '找不到应用归档：%s\n' "$LEXUE_APP_ARCHIVE" >&2
  exit 1
}
[ -f "$LEXUE_APP_ARCHIVE.sha256" ] || {
  printf '找不到应用校验文件：%s.sha256\n' "$LEXUE_APP_ARCHIVE" >&2
  exit 1
}

[ -f env-config.mjs ] || { printf '缺少配置迁移程序 env-config.mjs\n' >&2; exit 1; }

previous_image="$(docker inspect --format '{{.Config.Image}}' "$CONTAINER_NAME" 2>/dev/null || true)"

write_env() {
  # 使用已有Node运行环境处理dotenv，避免覆盖密钥或误处理多行值。
  docker run --rm --network none --user "$(id -u):$(id -g)" \
    --volume "$(pwd):/config" --workdir /config --entrypoint node \
    "$LEXUE_RUNTIME_IMAGE" env-config.mjs deploy /config "$1" "$LEXUE_PORT"
}

wait_healthy() {
  attempts=0
  while [ "$attempts" -lt 18 ]; do
    status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$CONTAINER_NAME" 2>/dev/null || true)"
    if [ "$status" = "healthy" ] || [ "$status" = "running" ]; then
      return 0
    fi
    if [ "$status" = "unhealthy" ] || [ "$status" = "exited" ] || [ "$status" = "dead" ]; then
      return 1
    fi
    attempts=$((attempts + 1))
    sleep 5
  done
  return 1
}

sha256sum -c "$LEXUE_APP_ARCHIVE.sha256"
if ! docker image inspect "$LEXUE_RUNTIME_IMAGE" >/dev/null 2>&1; then
  : "${LEXUE_RUNTIME_ARCHIVE:?服务器缺少运行环境，请上传运行环境归档}"
  case "$LEXUE_RUNTIME_ARCHIVE" in */*|*..*) printf '运行环境归档文件名不合法\n' >&2; exit 1 ;; esac
  sha256sum -c "$LEXUE_RUNTIME_ARCHIVE.sha256"
  # 先解压再导入，任一阶段失败都不会切换生产容器。
  runtime_tar="$(mktemp ./lexue-runtime.XXXXXX)"
  trap 'rm -f "$runtime_tar"' EXIT HUP INT TERM
  gzip -dc "$LEXUE_RUNTIME_ARCHIVE" > "$runtime_tar"
  docker load -i "$runtime_tar"
  rm -f "$runtime_tar"
  trap - EXIT HUP INT TERM
fi
docker image inspect "$LEXUE_RUNTIME_IMAGE" >/dev/null

build_dir="$(mktemp -d ./lexue-build.XXXXXX)"
trap 'rm -rf "$build_dir"' EXIT HUP INT TERM
tar -xzf "$LEXUE_APP_ARCHIVE" -C "$build_dir"
docker build --network none --pull=false --build-arg "LEXUE_RUNTIME_IMAGE=$LEXUE_RUNTIME_IMAGE" \
  -f "$build_dir/deploy/Dockerfile.app" -t "$LEXUE_IMAGE" "$build_dir"
docker image inspect "$LEXUE_IMAGE" >/dev/null
rm -rf "$build_dir"
trap - EXIT HUP INT TERM

write_env "$LEXUE_IMAGE"
# PostgreSQL 由 compose.postgres-only.yaml 独立管理，但共享同一项目网络。
# 这里不能使用 --remove-orphans，否则发布应用时会误删数据库容器。
if docker compose -f "$COMPOSE_FILE" up -d --pull never lexue && wait_healthy; then
  if [ -n "${LEXUE_RUNTIME_ARCHIVE:-}" ]; then
    rm -f "$LEXUE_RUNTIME_ARCHIVE" "$LEXUE_RUNTIME_ARCHIVE.sha256"
  fi
  printf '乐学已部署：%s\n' "$LEXUE_IMAGE"
  exit 0
fi

printf '新版本健康检查失败，准备回滚。\n' >&2
docker logs --tail 100 "$CONTAINER_NAME" >&2 || true

if [ -n "$previous_image" ]; then
  write_env "$previous_image"
  docker compose -f "$COMPOSE_FILE" up -d --pull never lexue
  if wait_healthy; then
    printf '已回滚到：%s\n' "$previous_image" >&2
  else
    printf '回滚后服务仍未恢复，请人工检查。\n' >&2
  fi
else
  printf '没有可用的上一版本镜像，无法自动回滚。\n' >&2
fi

exit 1
