#!/usr/bin/env bash
set -euo pipefail

# === Base config ===
USERNAME="pwb"
APP_NAME="price-watcher"
APP_DIR="/home/$USERNAME/$APP_NAME"

AUTH_PATH="$(cd "$(dirname "$0")/../auth" && pwd)/auth.mjs"

if [ ! -f "$AUTH_PATH" ]; then
  echo "❌ auth/auth.mjs not found at $AUTH_PATH"
  exit 1
fi

# shellcheck disable=SC2046
read -r SERVER_HOST SERVER_PORT <<<$(node -e "
  import { SERVER_HOST, SERVER_PORT } from 'file://$AUTH_PATH'
  console.log(SERVER_HOST, SERVER_PORT || '')
")

if [ -z "$SERVER_HOST" ]; then
  echo '❌ Missing SERVER_HOST in auth/auth.mjs'
  exit 1
fi

# --- Default port if not specified ---
SERVER_PORT=${SERVER_PORT:-22}

# === Rsync excludes ===
EXCLUDES=(
  "--exclude=.git"
  "--exclude=.idea"
  "--exclude=node_modules"
  "--exclude=*.log"
  "--exclude=deploy/local-deploy.sh"
)

echo "🚀 Deploying $APP_NAME to $USERNAME@$SERVER_HOST:$SERVER_PORT ..."

# --- Step 1: Sync project files ---
echo "📦 Syncing files via rsync..."
rsync -azP -e "ssh -p $SERVER_PORT" "${EXCLUDES[@]}" ./ "$USERNAME@$SERVER_HOST:$APP_DIR"

# --- Step 2: Remote install and restart ---
echo "♻️ Installing deps and restarting PM2 remotely..."
ssh -t -p "$SERVER_PORT" "$USERNAME@$SERVER_HOST" <<EOF
set -e
export NVM_DIR="\$HOME/.nvm"
source "\$NVM_DIR/nvm.sh"
cd "$APP_DIR"

echo "📥 Installing dependencies..."
npm ci --omit=dev

echo "🚀 Restarting PM2..."
if pm2 list | grep -q "$APP_NAME"; then
  pm2 reload deploy/pm2.config.cjs --update-env
else
  pm2 start deploy/pm2.config.cjs
fi
pm2 save

echo "✅ Done! PM2 process list:"
pm2 status
EOF

echo "✅ Deploy complete!"
echo "✅ Bot is running and online!"
