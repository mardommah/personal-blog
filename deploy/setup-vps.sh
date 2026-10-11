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

for tool in nginx git make runuser; do
  command -v "$tool" >/dev/null || { echo "Missing $tool; install it on the VPS first." >&2; exit 1; }
done
test -x /usr/local/bin/bun || { echo 'Missing Bun at /usr/local/bin/bun.' >&2; exit 1; }
test -f /etc/blog-cms.env || { echo 'Create /etc/blog-cms.env with ADMIN_PASSWORD_HASH first.' >&2; exit 1; }
grep -q '^ADMIN_PASSWORD_HASH=' /etc/blog-cms.env || { echo 'ADMIN_PASSWORD_HASH is missing from /etc/blog-cms.env.' >&2; exit 1; }
chown root:root /etc/blog-cms.env
chmod 600 /etc/blog-cms.env

id blog >/dev/null 2>&1 || useradd --system --home /opt/blog --shell /usr/sbin/nologin blog
chgrp blog /opt/blog
chmod 2775 /opt/blog
install -d -m 0750 -o blog -g blog /opt/blog/data
chown -R blog:blog /opt/blog/data
install -m 0644 deploy/blog-cms.service /etc/systemd/system/blog-cms.service
if [ ! -e /etc/nginx/sites-available/blog ]; then
  sed "s/example.com/$domain/g" deploy/nginx.conf > /etc/nginx/sites-available/blog
elif ! grep -q "server_name $domain;" /etc/nginx/sites-available/blog; then
  echo 'Existing nginx blog site uses another domain. Check /etc/nginx/sites-available/blog.' >&2
  exit 1
fi
if [ ! -e /etc/nginx/sites-enabled/blog ]; then
  ln -s /etc/nginx/sites-available/blog /etc/nginx/sites-enabled/blog
fi
nginx -t
systemctl daemon-reload
systemctl enable blog-cms
make deploy
printf 'Site configured for %s. Enable HTTPS: certbot --nginx -d %s --redirect\n' "$domain" "$domain"
