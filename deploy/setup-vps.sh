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

domain=${1:-}
if [ -z "$domain" ] && [ -f .env ]; then
  domain=$(sed -n 's/^DOMAIN=//p' .env)
fi
if [ -z "$domain" ]; then
  printf 'Domain blog: '
  IFS= read -r domain || exit 1
fi
if ! printf '%s' "$domain" | grep -Eq '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'; then
  echo 'Enter a lowercase domain such as blog.example.com.' >&2
  exit 1
fi

# Debian/Ubuntu packages needed by the site and Tunnel connector.
command -v apt-get >/dev/null || { echo 'VPS setup requires Debian or Ubuntu.' >&2; exit 1; }
apt-get update
DEBIAN_FRONTEND=noninteractive apt-get install -y git make nginx curl unzip ca-certificates
install -d -m 0755 /usr/share/keyrings
curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg -o /usr/share/keyrings/cloudflare-main.gpg
chmod 0644 /usr/share/keyrings/cloudflare-main.gpg
printf 'deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared any main\n' > /etc/apt/sources.list.d/cloudflared.list
apt-get update
DEBIAN_FRONTEND=noninteractive apt-get install -y cloudflared

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

install -m 0644 deploy/blog-tunnel.service /etc/systemd/system/blog-tunnel.service

# Preserve the old public nginx site for rollback, but serve this blog only on loopback.
old_site=/etc/nginx/sites-enabled/blog
new_site=/etc/nginx/sites-enabled/blog-tunnel
if [ -e "$old_site" ] && [ ! -L "$old_site" ]; then
  echo 'Existing nginx blog site is not a symlink; inspect it before Tunnel setup.' >&2
  exit 1
fi
old_target=
if [ -L "$old_site" ]; then
  old_target=$(readlink "$old_site")
  unlink "$old_site"
fi
if [ -f /etc/nginx/sites-available/blog-tunnel ]; then
  cp -p /etc/nginx/sites-available/blog-tunnel /etc/nginx/sites-available/blog-tunnel.previous
fi
sed "s/example.com/$domain/g" deploy/nginx.conf > /etc/nginx/sites-available/blog-tunnel
new_was_enabled=1
if [ ! -e "$new_site" ]; then
  new_was_enabled=0
  ln -s /etc/nginx/sites-available/blog-tunnel "$new_site"
fi
if ! nginx -t; then
  if [ "$new_was_enabled" -eq 0 ]; then unlink "$new_site"; fi
  if [ -f /etc/nginx/sites-available/blog-tunnel.previous ]; then
    cp -p /etc/nginx/sites-available/blog-tunnel.previous /etc/nginx/sites-available/blog-tunnel
  fi
  if [ -n "$old_target" ]; then ln -s "$old_target" "$old_site"; fi
  echo 'nginx configuration failed; previous site link restored.' >&2
  exit 1
fi
systemctl daemon-reload
systemctl reload nginx

if [ ! -s /etc/blog-tunnel.token ]; then
  test -t 0 || { echo 'Interactive terminal required for Cloudflare Tunnel token.' >&2; exit 1; }
  printf 'Cloudflare Tunnel token (from Networking > Tunnels): '
  stty -echo
  trap 'stty echo' 0 1 2 15
  IFS= read -r tunnel_token
  stty echo
  trap - 0 1 2 15
  printf '\n'
  [ -n "$tunnel_token" ] || { echo 'Tunnel token is required.' >&2; exit 1; }
  install -m 0600 /dev/null /etc/blog-tunnel.token
  printf '%s\n' "$tunnel_token" > /etc/blog-tunnel.token
  unset tunnel_token
fi
chown root:root /etc/blog-tunnel.token
chmod 0600 /etc/blog-tunnel.token
systemctl enable --now blog-tunnel
systemctl restart blog-tunnel
printf 'Origin ready. Route %s to http://127.0.0.1:8080 in Cloudflare Tunnel.\n' "$domain"
