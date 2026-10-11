PORT ?= 3099

.PHONY: dev build install clean backup deploy vps-setup password

## dev: run blog + CMS locally with auto-reload (http://127.0.0.1:$(PORT)/)
dev: install
	PORT=$(PORT) bun --watch server.js

## build: regenerate dist/ from data/blog.db
build: install
	bun run build.js

install: node_modules

node_modules: package.json bun.lock
	bun install --frozen-lockfile
	@touch node_modules

## backup: consistent snapshot of the DB into backups/
backup:
	@mkdir -p backups
	bun -e 'import {Database} from "bun:sqlite"; new Database("data/blog.db").run("VACUUM INTO ?", ["backups/blog-$(shell date +%Y%m%d-%H%M%S).db"])'

## deploy: run on VPS from /opt/blog; pull, build, restart CMS, reload nginx
deploy:
	./deploy/deploy.sh

## vps-setup: provision nginx and systemd, then deploy (requires Bun, nginx, sudo, and /etc/blog-cms.env)
vps-setup:
	@test -n "$(SERVER)" || { echo "usage: make vps-setup SERVER=user@host [DOMAIN=blog.example.com]"; exit 1; }
	./deploy/setup-vps.sh "$(SERVER)" "$(DOMAIN)"

## password: generate ADMIN_PASSWORD_HASH (argon2id, base64) for .env or /etc/blog-cms.env
password:
	@read -r -s -p "Password admin (min 12 karakter): " P; echo; \
	[ $${#P} -ge 12 ] || { echo "Terlalu pendek."; exit 1; }; \
	P="$$P" bun -e 'const h = await Bun.password.hash(process.env.P, { algorithm: "argon2id", memoryCost: 19456, timeCost: 2 }); console.log("ADMIN_PASSWORD_HASH=" + Buffer.from(h).toString("base64"))'

clean:
	rm -rf dist dist.tmp-*
