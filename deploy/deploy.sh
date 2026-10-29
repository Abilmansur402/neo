#!/usr/bin/env bash
# Deploy NeoOutcome AI to the VPS described in deploy/.env.production.
#
#   ./deploy/deploy.sh setup     # first time: install Docker + firewall on the server
#   ./deploy/deploy.sh           # sync code, build and (re)start all services
#   ./deploy/deploy.sh logs      # follow container logs
#   ./deploy/deploy.sh models    # train the tabular model locally and push it to the S3 registry
#   ./deploy/deploy.sh status    # health check through the public domain
#
# Requires: ssh, rsync. Authenticate once with `ssh-copy-id -p $DEPLOY_PORT $DEPLOY_USER@$DEPLOY_HOST`
# (enter the server password there — never store it in a file).
set -euo pipefail
cd "$(dirname "$0")/.."

ENV_FILE=deploy/.env.production
[ -f "$ENV_FILE" ] || { echo "Missing $ENV_FILE — copy deploy/.env.production.example and fill it in"; exit 1; }
set -a; source "$ENV_FILE"; set +a
: "${DEPLOY_HOST:?}" "${DEPLOY_USER:?}" "${DOMAIN:?}"
DEPLOY_PORT=${DEPLOY_PORT:-22}; DEPLOY_PATH=${DEPLOY_PATH:-/opt/neooutcome-ai}
SSH="ssh -p $DEPLOY_PORT $DEPLOY_USER@$DEPLOY_HOST"
COMPOSE="docker compose --env-file deploy/.env.production -f docker-compose.yml -f docker-compose.prod.yml"

case "${1:-deploy}" in
  setup)
    $SSH "APP_PORT=$APP_PORT DEPLOY_PATH=$DEPLOY_PATH bash -s" < deploy/server-setup.sh ;;
  deploy)
    echo "[deploy] syncing to $DEPLOY_USER@$DEPLOY_HOST:$DEPLOY_PATH"
    rsync -az --delete -e "ssh -p $DEPLOY_PORT" \
      --exclude node_modules --exclude dist --exclude .venv --exclude __pycache__ --exclude .git --exclude 'backend/artifacts' \
      ./ "$DEPLOY_USER@$DEPLOY_HOST:$DEPLOY_PATH/"
    echo "[deploy] building and starting containers"
    $SSH "cd $DEPLOY_PATH && $COMPOSE pull --ignore-buildable -q && $COMPOSE up -d --build --remove-orphans && $COMPOSE ps"
    echo "[deploy] https://$DOMAIN$( [ "$APP_PORT" != 443 ] && echo ":$APP_PORT" )" ;;
  logs)
    $SSH "cd $DEPLOY_PATH && $COMPOSE logs -f --tail=100 ${2:-}" ;;
  models)
    echo "[models] training xgb-24h locally ${DATA:+on $DATA} and pushing to s3://$NEO_S3_BUCKET"
    ( cd backend && python -m ml.train_tabular ${DATA:+--data "$DATA"} --version "${VERSION:-v3.2}" --push )
    echo "[models] restarting backend so it pulls the new artifact"
    $SSH "cd $DEPLOY_PATH && $COMPOSE restart backend" ;;
  status)
    curl -fsS "https://$DOMAIN$( [ "$APP_PORT" != 443 ] && echo ":$APP_PORT" )/api/health" | python3 -m json.tool ;;
  *) echo "usage: $0 [setup|deploy|logs|models|status]"; exit 1 ;;
esac
