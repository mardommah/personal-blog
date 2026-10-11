#!/bin/sh
# Run once as root from the Git checkout at /opt/blog.
set -eu

if [ "$(id -u)" -ne 0 ]; then
  echo 'Run as root: sudo make vps-setup' >&2
  exit 1
fi
if [ "$(pwd -P)" != /opt/blog ] || [ ! -d .git ]; then
  echo 'Clone the repository into /opt/blog, then run make vps-setup there.' >&2
  exit 1
fi
umask 022

# Debian/Ubuntu packages needed by the blog.
command -v apt-get >/dev/null || { echo 'VPS setup requires Debian or Ubuntu.' >&2; exit 1; }
apt-get update
DEBIAN_FRONTEND=noninteractive apt-get install -y git make curl unzip ca-certificates

# Install or upgrade Bun before reading the version-2 lockfile.
bun_path=$(command -v bun || true)
if [ -x /root/.bun/bin/bun ]; then bun_path=/root/.bun/bin/bun; fi
if [ -z "$bun_path" ] || [ ! -x "$bun_path" ]; then
  curl -fsSL https://bun.sh/install | bash
  bun_path=/root/.bun/bin/bun
fi
if ! dpkg --compare-versions "$("$bun_path" --version)" ge 1.4.2; then
  "$bun_path" upgrade
fi
if ! dpkg --compare-versions "$("$bun_path" --version)" ge 1.4.2; then
  echo 'Bun 1.4.2 or newer is required by bun.lock.' >&2
  exit 1
fi
if [ "$bun_path" != /usr/local/bin/bun ]; then
  install -m 0755 "$bun_path" /usr/local/bin/bun
fi

# Use existing hash, import it from .env, or ask for a new admin password.
if [ ! -f /etc/blog-cms.env ] || ! grep -q '^ADMIN_PASSWORD_HASH=' /etc/blog-cms.env; then
  if [ -f .env ] && grep -q '^ADMIN_PASSWORD_HASH=' .env; then
    install -m 0600 /dev/null /etc/blog-cms.env
    grep -m1 '^ADMIN_PASSWORD_HASH=' .env > /etc/blog-cms.env
  else
    test -t 0 || { echo 'Interactive terminal required to set admin password.' >&2; exit 1; }
    printf 'Admin password (min 12 characters): '
    stty -echo
    trap 'stty echo' 0 1 2 15
    IFS= read -r password
    printf '\nRepeat password: '
    IFS= read -r password_confirm
    stty echo
    trap - 0 1 2 15
    printf '\n'
    [ "$password" = "$password_confirm" ] && [ "${#password}" -ge 12 ] || {
      echo 'Passwords must match and contain at least 12 characters.' >&2
      exit 1
    }
    hash=$(P="$password" /usr/local/bin/bun -e 'const h = await Bun.password.hash(process.env.P, { algorithm: "argon2id", memoryCost: 19456, timeCost: 2 }); console.log(Buffer.from(h).toString("base64"))')
    unset password password_confirm
    install -m 0600 /dev/null /etc/blog-cms.env
    printf 'ADMIN_PASSWORD_HASH=%s\n' "$hash" > /etc/blog-cms.env
    unset hash
  fi
fi
chown root:root /etc/blog-cms.env
chmod 600 /etc/blog-cms.env

id blog >/dev/null 2>&1 || useradd --system --home /opt/blog --shell /usr/sbin/nologin blog
chgrp blog /opt/blog
chmod 2775 /opt/blog
install -d -m 0750 -o blog -g blog /opt/blog/data
chown -R blog:blog /opt/blog/data
install -m 0644 deploy/blog-cms.service /etc/systemd/system/blog-cms.service
systemctl daemon-reload
systemctl enable blog-cms
make deploy
printf 'Blog ready on http://127.0.0.1:3000. Add its Published Application in Cloudflare.\n'
