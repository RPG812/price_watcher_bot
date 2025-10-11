#!/usr/bin/env bash
set -euo pipefail

# === Base config ===
USERNAME="pwb"
APP_NAME="price-watcher"
APP_DIR="/home/$USERNAME/$APP_NAME"
NODE_VERSION="22"

echo "🚀 Starting setup for $APP_NAME"

# --- create user if not exists ---
if ! id "$USERNAME" &>/dev/null; then
  echo "👤 Creating user $USERNAME..."
  adduser --disabled-password --gecos "" "$USERNAME"
  usermod -aG sudo "$USERNAME"
  mkdir -p /home/"$USERNAME"/.ssh
  cp /root/.ssh/authorized_keys /home/"$USERNAME"/.ssh/ 2>/dev/null || true
  chown -R "$USERNAME":"$USERNAME" /home/"$USERNAME"/.ssh
  chmod 700 /home/"$USERNAME"/.ssh
  chmod 600 /home/"$USERNAME"/.ssh/authorized_keys 2>/dev/null || true
else
  echo "✅ User $USERNAME already exists"
fi

# --- base packages ---
echo "📦 Installing base packages..."
apt-get update -y
apt-get install -y curl build-essential htop fail2ban net-tools gnupg ca-certificates ufw rsync

# --- firewall rules (safe mode, do NOT enable ufw automatically) ---
echo "🛡️ Configuring firewall rules..."
ufw allow OpenSSH
ufw allow 27017/tcp
ufw status || true
echo "⚠️ Skipping 'ufw enable' to avoid breaking Xray/VPN configuration"

# --- install MongoDB ---
echo "🗄️ Installing MongoDB..."
curl -fsSL https://pgp.mongodb.com/server-7.0.asc | gpg --dearmor -o /usr/share/keyrings/mongodb-server-7.0.gpg
echo "deb [arch=amd64,arm64 signed-by=/usr/share/keyrings/mongodb-server-7.0.gpg] https://repo.mongodb.org/apt/ubuntu jammy/mongodb-org/7.0 multiverse" | tee /etc/apt/sources.list.d/mongodb-org-7.0.list
apt-get update -y
apt-get install -y mongodb-org
systemctl enable mongod.service
systemctl start mongod.service
systemctl status mongod --no-pager -l || true

# --- install Node.js via nvm for target user ---
echo "🧠 Installing Node.js $NODE_VERSION for $USERNAME..."
sudo -u "$USERNAME" bash <<EOF
set -e
export NVM_DIR="\$HOME/.nvm"
if [ ! -d "\$NVM_DIR" ]; then
  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/master/install.sh | bash
fi
source "\$NVM_DIR/nvm.sh"
nvm install $NODE_VERSION
nvm alias default $NODE_VERSION
nvm use default
npm install -g pm2
pm2 install pm2-logrotate
EOF

# --- prepare app directory ---
echo "📂 Creating app directory..."
mkdir -p "$APP_DIR"
chown -R "$USERNAME":"$USERNAME" "$APP_DIR"

# --- finalize PM2 startup ---
echo "⚙️ Configuring PM2 startup..."
sudo -u "$USERNAME" bash <<EOF
set -e
export NVM_DIR="\$HOME/.nvm"
source "\$NVM_DIR/nvm.sh"
pm2 startup systemd -u "$USERNAME" --hp "/home/$USERNAME"
EOF

echo "✅ Setup complete!"
echo "➡️  Now you can deploy from your Mac with:"
echo "   npm run deploy"
echo "   (this will rsync your project and restart PM2)"
