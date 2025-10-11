#!/usr/bin/env bash
set -euo pipefail

# === Base config ===
USERNAME="pwb"
APP_NAME="price-watcher"
APP_DIR="/home/$USERNAME/$APP_NAME"

# --- Load SSH host and port from auth/auth.mjs ---
read -r SERVER_HOST SERVER_PORT <<<$(node -e "
  import { SERVER_HOST, SERVER_PORT } from '../auth/auth.mjs'
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
  pm2 reload pm2.config.js --update-env
else
  pm2 start pm2.config.js
fi
pm2 save

echo "✅ Done! PM2 process list:"
pm2 status
EOF

echo "✅ Deploy complete!"
echo "➡️  Logs: ssh -p $SERVER_PORT $USERNAME@$SERVER_HOST 'pm2 logs $APP_NAME --lines 50'"
