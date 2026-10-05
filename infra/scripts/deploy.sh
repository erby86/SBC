#!/usr/bin/env bash
# Deploy sbc-noc on sbc-ubuntu (M17, ADR-0015, ADR-0022). Run from the clone /opt/sbc-noc/src.
#
#   infra/scripts/deploy.sh prod                      # release the current commit to noc.sbc.lan
#   infra/scripts/deploy.sh prod --rollback <tag>     # back to an earlier image tag (no migration)
#   infra/scripts/deploy.sh staging                   # noc-dev.sbc.lan (compose.dev.yml, builds :dev)
#   infra/scripts/deploy.sh prod --list               # releases deployed so far
#
# prod: build images tagged <version>-<sha> → Trivy scan (HIGH/CRITICAL with a fix = stop) + SBOM
#       → backup → migrate → set the noc_app login → start → wait for health → record the release.
# Nothing here touches containers outside sbc-noc-*; the Trivy scanner runs as a throw-away container.
set -euo pipefail
umask 077

ENVIRONMENT="${1:-}"
ACTION="${2:-}"
ROLLBACK_TAG="${3:-}"

SRC="${SRC:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
TRIVY_IMAGE="${TRIVY_IMAGE:-aquasec/trivy:0.67.2}"
NO_SCAN="${NO_SCAN:-false}"
HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-180}"
APPS=(api worker web)

die() { echo "deploy: $*" >&2; exit 1; }
step() { echo; echo "== $*"; }

# Value of KEY from an env file without sourcing it (values contain spaces, & and ||).
envval() { grep -E "^$2=" "$1" | tail -n 1 | cut -d= -f2- || true; }

check_env_file() {
  [ -f "$1" ] || die "$1 not found (template: infra/compose/$(basename "$1").example)"
  local mode
  mode="$(stat -c %a "$1")"
  [ "$mode" = 600 ] || die "$1 must be chmod 600 (is $mode) — ADR-0005"
}

wait_healthy() { # container…
  local deadline=$((SECONDS + HEALTH_TIMEOUT)) c st
  for c in "$@"; do
    while :; do
      st="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$c" 2>/dev/null || echo missing)"
      case "$st" in
        healthy | running) echo "  $c: $st"; break ;;
        unhealthy | exited | dead | missing)
          echo "deploy: $c is $st — see: docker logs --tail 50 $c" >&2
          return 1
          ;;
      esac
      if [ "$SECONDS" -ge "$deadline" ]; then
        echo "deploy: $c not healthy after ${HEALTH_TIMEOUT}s (last: $st)" >&2
        return 1
      fi
      sleep 3
    done
  done
}

trivy_scan() { # image sbom-file
  if [ "$NO_SCAN" = true ]; then
    echo "  NO_SCAN=true — Trivy skipped for $1 (record why in the release note)"
    return
  fi
  local run=(docker run --rm -v /var/run/docker.sock:/var/run/docker.sock:ro
    -v sbc-noc-trivy-cache:/root/.cache/trivy)
  local opts=(--quiet --scanners vuln --severity 'HIGH,CRITICAL' --ignore-unfixed --exit-code 1)
  if [ -f "$SRC/.trivyignore" ]; then
    run+=(-v "$SRC/.trivyignore:/work/.trivyignore:ro")
    opts+=(--ignorefile /work/.trivyignore)
  fi
  "${run[@]}" "$TRIVY_IMAGE" image "${opts[@]}" "$1" ||
    die "Trivy found HIGH/CRITICAL vulnerabilities with a fix in $1 — update the base image or dependency, or add a reviewed entry to .trivyignore"
  "${run[@]}" -v "$(dirname "$2"):/out" "$TRIVY_IMAGE" image --quiet --format cyclonedx \
    --output "/out/$(basename "$2")" "$1"
  echo "  SBOM: $2"
}

deploy_staging() {
  local env_file="${ENV_FILE:-/opt/sbc-noc/dev.env}"
  check_env_file "$env_file"
  local compose=(docker compose --env-file "$env_file" -f "$SRC/infra/compose/compose.dev.yml")

  step "backup sbc-noc-dev-db before migrating (ADR-0015)"
  if docker inspect sbc-noc-dev-db >/dev/null 2>&1; then
    CONTAINER=sbc-noc-dev-db DEST="${BACKUP_DEST:-/opt/sbc-backups/sbc-noc-dev}" "$SRC/infra/scripts/pg-backup.sh"
  else
    echo "  sbc-noc-dev-db does not exist yet — nothing to back up"
  fi

  step "build"
  "${compose[@]}" build --pull

  step "Trivy scan"
  mkdir -p /opt/sbc-noc/sbom
  local app
  for app in "${APPS[@]}"; do trivy_scan "sbc-noc-$app:dev" "/opt/sbc-noc/sbom/staging-$app.cdx.json"; done

  step "migrate + start"
  "${compose[@]}" up -d
  wait_healthy sbc-noc-dev-api sbc-noc-dev-web sbc-noc-dev-worker || exit 1
  echo; echo "staging OK — http://noc-dev.sbc.lan/api/health"
}

prod_compose() { # tag args…
  local tag="$1"
  shift
  NOC_TAG="$tag" docker compose --env-file "$ENV_FILE" -f "$SRC/infra/compose/compose.prod.yml" "$@"
}

record_release() {
  echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) $1 $2" >>"$RELEASES"
}

start_prod() { # tag
  prod_compose "$1" up -d --no-deps noc-api noc-worker noc-web
  prod_compose "$1" up -d noc-alloy
  wait_healthy sbc-noc-api sbc-noc-web sbc-noc-worker
}

deploy_prod() {
  ENV_FILE="${ENV_FILE:-/opt/sbc-noc/prod.env}"
  RELEASES="${RELEASES:-/opt/sbc-noc/prod.releases}"
  check_env_file "$ENV_FILE"
  local prefix
  prefix="$(envval "$ENV_FILE" NOC_IMAGE_PREFIX)"

  if [ "$ACTION" = --list ]; then
    [ -f "$RELEASES" ] && cat "$RELEASES" || echo "no releases yet"
    return
  fi

  if [ "$ACTION" = --rollback ]; then
    [ -n "$ROLLBACK_TAG" ] || die "usage: deploy.sh prod --rollback <tag>   (tags: deploy.sh prod --list)"
    local app
    for app in "${APPS[@]}"; do
      docker image inspect "${prefix}sbc-noc-$app:$ROLLBACK_TAG" >/dev/null 2>&1 ||
        die "image ${prefix}sbc-noc-$app:$ROLLBACK_TAG not found on this host"
    done
    step "rollback to $ROLLBACK_TAG (schema stays — migrations are expand/contract, ADR-0015)"
    start_prod "$ROLLBACK_TAG" || exit 1
    record_release "$ROLLBACK_TAG" rollback
    echo; echo "rolled back to $ROLLBACK_TAG"
    return
  fi
  [ -z "$ACTION" ] || die "unknown option $ACTION"

  cd "$SRC"
  [ -z "$(git status --porcelain --untracked-files=no)" ] ||
    die "the checkout has local changes — a release must be an exact commit (git status)"
  local version sha tag
  version="$(sed -nE 's/^  "version": "([^"]+)".*/\1/p' package.json | head -n 1)"
  sha="$(git rev-parse --short=7 HEAD)"
  [ -n "$version" ] || die "version not found in package.json"
  tag="$version-$sha"
  echo "release $tag ($(git log -1 --format='%s'))"

  step "build images $tag"
  local app
  for app in "${APPS[@]}"; do
    docker build --pull -f "apps/$app/Dockerfile" -t "${prefix}sbc-noc-$app:$tag" \
      --label "org.opencontainers.image.version=$version" \
      --label "org.opencontainers.image.revision=$(git rev-parse HEAD)" .
  done

  step "Trivy scan + SBOM (ADR-0016)"
  mkdir -p /opt/sbc-noc/sbom
  for app in "${APPS[@]}"; do
    trivy_scan "${prefix}sbc-noc-$app:$tag" "/opt/sbc-noc/sbom/$tag-$app.cdx.json"
  done

  if [ -n "$prefix" ] && [ "${NOC_PUSH:-false}" = true ]; then
    step "push to ${prefix%/}"
    for app in "${APPS[@]}"; do docker push "${prefix}sbc-noc-$app:$tag"; done
  fi

  step "database"
  prod_compose "$tag" up -d noc-db
  wait_healthy sbc-noc-db || exit 1
  CONTAINER=sbc-noc-db DEST="${BACKUP_DEST:-/opt/sbc-backups/sbc-noc}" "$SRC/infra/scripts/pg-backup.sh"

  step "migrate"
  prod_compose "$tag" --profile migrate run --rm noc-migrate

  step "login for role noc_app (password from the env file, never on the command line)"
  PW="$(envval "$ENV_FILE" NOC_APP_PASSWORD)"
  [ -n "$PW" ] || die "NOC_APP_PASSWORD is empty in $ENV_FILE"
  export PW
  docker exec -i -e PW sbc-noc-db psql -q -v ON_ERROR_STOP=1 -U sbc_noc -d sbc_noc <<'SQL'
\getenv pw PW
ALTER ROLE noc_app LOGIN PASSWORD :'pw';
SQL
  unset PW

  step "start $tag"
  local previous=""
  [ -f "$RELEASES" ] && previous="$(tail -n 1 "$RELEASES" | cut -d' ' -f2)"
  if ! start_prod "$tag"; then
    [ -n "$previous" ] && echo "deploy failed — roll back with: infra/scripts/deploy.sh prod --rollback $previous" >&2
    exit 1
  fi
  record_release "$tag" deploy
  echo
  echo "prod OK: $tag — check http://noc.sbc.lan/api/health from the management network"
  [ -n "$previous" ] && echo "rollback if needed: infra/scripts/deploy.sh prod --rollback $previous"
  return 0
}

case "$ENVIRONMENT" in
  prod) deploy_prod ;;
  staging) deploy_staging ;;
  *) die "usage: deploy.sh prod|staging [--rollback <tag> | --list]" ;;
esac
