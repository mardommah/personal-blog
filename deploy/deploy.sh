#!/bin/sh
# Run on the VPS from /opt/blog after changes are pushed to its tracked branch.
set -eu

cd /opt/blog
test -d .git || { echo 'Run from a Git checkout at /opt/blog.' >&2; exit 1; }
git diff --quiet && git diff --cached --quiet || { echo 'Working tree has local changes; commit or resolve them first.' >&2; exit 1; }
git pull --ff-only
if [ "$(id -u)" -eq 0 ]; then
  if [ -d node_modules ]; then chown -R blog:blog node_modules; fi
  runuser -u blog -- /usr/local/bin/bun install --production --frozen-lockfile
  runuser -u blog -- /usr/local/bin/bun run build.js
  nginx -t
  systemctl restart blog-cms
  systemctl reload nginx
else
  if [ -d node_modules ]; then sudo -n chown -R blog:blog node_modules; fi
  sudo -n -u blog /usr/local/bin/bun install --production --frozen-lockfile
  sudo -n -u blog /usr/local/bin/bun run build.js
  sudo -n nginx -t
  sudo -n systemctl restart blog-cms
  sudo -n systemctl reload nginx
fi
