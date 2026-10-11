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

## vps-setup: run on VPS from /opt/blog; configure nginx, CMS, and Cloudflare Tunnel
vps-setup:
	./deploy/setup-vps.sh "$(DOMAIN)"

## password: generate ADMIN_PASSWORD_HASH (argon2id, base64) for .env or /etc/blog-cms.env
password:
	@test -t 0 || { echo "Jalankan dari terminal interaktif."; exit 1; }; \
	printf "Password admin (min 12 karakter): "; stty -echo; trap 'stty echo' 0 1 2 3 15; \
	IFS= read -r P; stty echo; trap - 0 1 2 3 15; printf '\n'; \
	[ $${#P} -ge 12 ] || { echo "Terlalu pendek."; exit 1; }; \
	P="$$P" bun -e 'const h = await Bun.password.hash(process.env.P, { algorithm: "argon2id", memoryCost: 19456, timeCost: 2 }); console.log("ADMIN_PASSWORD_HASH=" + Buffer.from(h).toString("base64"))'

clean:
	rm -rf dist dist.tmp-*
