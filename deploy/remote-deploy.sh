#!/bin/sh
set -eu

: "${LEXUE_IMAGE:?缺少 LEXUE_IMAGE}"
: "${LEXUE_IMAGE_ARCHIVE:?缺少 LEXUE_IMAGE_ARCHIVE}"
LEXUE_PORT="${LEXUE_PORT:-8080}"
COMPOSE_FILE="${COMPOSE_FILE:-compose.yaml}"
CONTAINER_NAME="lexue"

case "$LEXUE_IMAGE_ARCHIVE" in
  */*|*..*)
    printf '镜像归档文件名不合法：%s\n' "$LEXUE_IMAGE_ARCHIVE" >&2
    exit 1
    ;;
esac

[ -f "$LEXUE_IMAGE_ARCHIVE" ] || {
  printf '找不到镜像归档：%s\n' "$LEXUE_IMAGE_ARCHIVE" >&2
  exit 1
}
[ -f "$LEXUE_IMAGE_ARCHIVE.sha256" ] || {
  printf '找不到镜像校验文件：%s.sha256\n' "$LEXUE_IMAGE_ARCHIVE" >&2
  exit 1
}

previous_image="$(docker inspect --format '{{.Config.Image}}' "$CONTAINER_NAME" 2>/dev/null || true)"

write_env() {
  umask 077
  {
    printf 'LEXUE_IMAGE=%s\n' "$1"
    printf 'LEXUE_PORT=%s\n' "$LEXUE_PORT"
  } > .env.next
  mv .env.next .env
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

sha256sum -c "$LEXUE_IMAGE_ARCHIVE.sha256"
gzip -dc "$LEXUE_IMAGE_ARCHIVE" | docker load
docker image inspect "$LEXUE_IMAGE" >/dev/null
rm -f "$LEXUE_IMAGE_ARCHIVE" "$LEXUE_IMAGE_ARCHIVE.sha256"

write_env "$LEXUE_IMAGE"
# PostgreSQL 由 compose.postgres-only.yaml 独立管理，但共享同一项目网络。
# 这里不能使用 --remove-orphans，否则发布应用时会误删数据库容器。
docker compose -f "$COMPOSE_FILE" up -d --pull never lexue

if wait_healthy; then
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
