#!/usr/bin/env bash
# One-time VPS preparation (Ubuntu 22.04/24.04 or Debian 12). Run as root or with sudo.
set -euo pipefail

if ! command -v docker >/dev/null 2>&1; then
  echo "[setup] installing Docker"
  curl -fsSL https://get.docker.com | sh
fi
if ! docker compose version >/dev/null 2>&1; then
  apt-get update && apt-get install -y docker-compose-plugin
fi
systemctl enable --now docker

# Firewall: SSH + HTTP/HTTPS (+ custom app port if set)
if command -v ufw >/dev/null 2>&1; then
  ufw allow OpenSSH >/dev/null
  ufw allow 80/tcp >/dev/null
  ufw allow 443/tcp >/dev/null
  [ -n "${APP_PORT:-}" ] && [ "${APP_PORT}" != "443" ] && ufw allow "${APP_PORT}/tcp" >/dev/null
  ufw --force enable >/dev/null
fi

mkdir -p "${DEPLOY_PATH:-/opt/neooutcome-ai}"
echo "[setup] done · docker $(docker --version | cut -d' ' -f3)"
