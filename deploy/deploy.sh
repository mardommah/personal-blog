#!/bin/sh
# Run on the VPS from /opt/blog after changes are pushed to its tracked branch.
set -eu

cd /opt/blog
test -d .git || { echo 'Run from a Git checkout at /opt/blog.' >&2; exit 1; }
git diff --quiet && git diff --cached --quiet || { echo 'Working tree has local changes; commit or resolve them first.' >&2; exit 1; }
git pull --ff-only
/usr/local/bin/bun install --production --frozen-lockfile
if [ "$(id -u)" -eq 0 ]; then
  runuser -u blog -- /usr/local/bin/bun run build.js
  nginx -t
  systemctl restart blog-cms
  systemctl reload nginx
else
  sudo -n -u blog /usr/local/bin/bun run build.js
  sudo -n nginx -t
  sudo -n systemctl restart blog-cms
  sudo -n systemctl reload nginx
fi
