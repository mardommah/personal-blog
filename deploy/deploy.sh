#!/bin/sh
# Run on the VPS from /opt/blog after changes are pushed to its tracked branch.
set -eu

test "$(id -u)" -eq 0 || { echo 'Run as root: sudo make deploy' >&2; exit 1; }
cd /opt/blog
test -d .git || { echo 'Run from a Git checkout at /opt/blog.' >&2; exit 1; }
git diff --quiet && git diff --cached --quiet || { echo 'Working tree has local changes; commit or resolve them first.' >&2; exit 1; }
umask 022
git pull --ff-only
# Git files may have been created under a restrictive root umask. The blog user
# reads tracked code, while ignored secrets such as .env retain their modes.
git ls-files -z | xargs -0 -r chmod a+r
chmod a+rx . static deploy
if [ -d node_modules ]; then chown -R blog:blog node_modules; fi
runuser -u blog -- /usr/local/bin/bun install --production --frozen-lockfile
runuser -u blog -- /usr/local/bin/bun run build.js
nginx -t
systemctl restart blog-cms
systemctl reload nginx
