#!/bin/sh
# One-time VPS setup. Requires a remote SSH user with passwordless sudo.
set -eu

server=${1:-}
domain=${2:-}
if [ -z "$domain" ] && [ -f .env ]; then
  domain=$(sed -n 's/^DOMAIN=//p' .env)
fi
if [ -z "$domain" ]; then
  printf 'Domain blog: '
  IFS= read -r domain || exit 1
fi
if [ -z "$server" ] || ! printf '%s' "$domain" | grep -Eq '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'; then
  echo 'usage: setup-vps.sh user@host blog.example.com (lowercase domain)' >&2
  exit 1
fi

# Check prerequisites before changing the server.
ssh "$server" 'sudo -n sh -s' <<'REMOTE'
set -eu
command -v nginx >/dev/null
command -v git >/dev/null
command -v make >/dev/null
test -x /usr/local/bin/bun
test -f /etc/blog-cms.env
grep -q '^ADMIN_PASSWORD_HASH=' /etc/blog-cms.env
REMOTE

ssh "$server" 'sudo -n sh -s' <<'REMOTE'
set -eu
id blog >/dev/null 2>&1 || useradd --system --home /opt/blog --shell /usr/sbin/nologin blog
owner=${SUDO_USER:-root}
install -d -m 2775 -o "$owner" -g blog /opt/blog
REMOTE

# The checkout remains on the VPS, so later updates need only `make deploy` there.
ssh "$server" 'sh -s' <<'REMOTE'
set -eu
if [ ! -d /opt/blog/.git ]; then
  test -z "$(ls -A /opt/blog)" || { echo '/opt/blog is not empty and has no Git checkout.' >&2; exit 1; }
  git clone https://github.com/mardommah/personal-blog.git /opt/blog
fi
REMOTE

ssh "$server" 'sudo -n install -d -m 0750 -o blog -g blog /opt/blog/data'

ssh "$server" "sudo -n sh -s -- '$domain'" <<'REMOTE'
set -eu
domain=$1
cd /opt/blog
install -m 0644 deploy/blog-cms.service /etc/systemd/system/blog-cms.service
sed "s/example.com/$domain/g" deploy/nginx.conf > /etc/nginx/sites-available/blog
if [ ! -e /etc/nginx/sites-enabled/blog ]; then
  ln -s /etc/nginx/sites-available/blog /etc/nginx/sites-enabled/blog
fi
nginx -t
systemctl daemon-reload
systemctl enable blog-cms
REMOTE

ssh "$server" 'cd /opt/blog && make deploy'
printf 'HTTP site configured for %s. Enable HTTPS with: sudo certbot --nginx -d %s --redirect\n' "$domain" "$domain"
