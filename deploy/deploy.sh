#!/bin/sh
# Push code to server. data/ (SQLite) NOT synced: posts live on server, edited via CMS.
# Usage: ./deploy/deploy.sh user@server
set -e
[ -n "$1" ] || { echo "usage: $0 user@server"; exit 1; }
rsync -avz --delete --exclude data --exclude backups --exclude dist --exclude "dist.tmp-*" --exclude node_modules --exclude .git --exclude ".env*" \
  ./ "$1":/opt/blog/
ssh "$1" 'cd /opt/blog && bun install --production --frozen-lockfile && sudo systemctl restart blog-cms'
