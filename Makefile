PORT ?= 3099

.PHONY: dev build install clean backup deploy password

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

## deploy: make deploy SERVER=user@host
deploy:
	@test -n "$(SERVER)" || { echo "usage: make deploy SERVER=user@host"; exit 1; }
	./deploy/deploy.sh $(SERVER)

## password: generate ADMIN_PASSWORD_HASH (argon2id, base64) for .env or /etc/blog-cms.env
password:
	@read -r -s -p "Password admin (min 12 karakter): " P; echo; \
	[ $${#P} -ge 12 ] || { echo "Terlalu pendek."; exit 1; }; \
	P="$$P" bun -e 'const h = await Bun.password.hash(process.env.P, { algorithm: "argon2id", memoryCost: 19456, timeCost: 2 }); console.log("ADMIN_PASSWORD_HASH=" + Buffer.from(h).toString("base64"))'

clean:
	rm -rf dist dist.tmp-*
