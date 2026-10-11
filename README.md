# mardoketlabs

A small personal blog with a Markdown editor. Bun stores posts in SQLite, generates a static site in `dist/`, and serves a password-protected CMS at `/admin/`.

## Requirements

- Bun 1.4.2 or newer (required by `bun.lock`)
- `make` for the commands below

## Run locally

```sh
bun install --frozen-lockfile
make password
```

`make password` prompts for an admin password of at least 12 characters and prints an `ADMIN_PASSWORD_HASH=...` line. Put that line in a local `.env` file, then start the app:

```sh
make dev
```

Open <http://127.0.0.1:3099/> for the blog or <http://127.0.0.1:3099/admin/> to write a post. `make dev` watches for code changes. Use `make dev PORT=3000` to choose another port.

The app creates `data/blog.db` and builds `dist/` on startup. With no admin password hash, the public blog still works, but `/admin/` returns HTTP 503.

## Writing and building

In `/admin/`, create, preview, edit, or delete posts. Saving or deleting a post regenerates `dist/`. Post bodies use Markdown; raw HTML is allowed, so only trusted authors should have CMS access. Slugs use lowercase letters, numbers, and hyphens; `admin` and `page` are reserved.

Useful commands:

```sh
make build    # Regenerate dist/ from data/blog.db
make backup   # Save a SQLite snapshot under backups/
make clean    # Remove generated dist/ files
```

The generated site includes post pages, paginated index pages, static assets, and `/rss.xml`. `data/`, `backups/`, `dist/`, and `.env` are ignored by Git. Keep backups of `data/blog.db`; it is the source of truth for posts.

## Deployment

Production configuration lives in `deploy/`: `nginx.conf` serves `dist/` and proxies `/admin/`, `blog-cms.service` runs Bun, and `deploy.sh` updates the site from Git.

1. Push this repository to its GitHub origin. Point the blog domain at the Debian or Ubuntu VPS before requesting its certificate. Git and Make are needed for the initial clone and setup command.
2. On the VPS, clone the repository into `/opt/blog` (create the directory first if you prefer):

   ```sh
   mkdir -p /opt/blog
   git clone https://github.com/mardommah/personal-blog.git /opt/blog
   cd /opt/blog
   ```

   `git pull` works only inside an existing checkout. Use `git clone` for the first download. `/opt/blog` must be empty before cloning.
3. As root in `/opt/blog`, run `make vps-setup`. Enter the domain and, if no admin hash exists, an admin password when prompted. You can set `DOMAIN=blog.example.com` in `/opt/blog/.env` or pass `make vps-setup DOMAIN=blog.example.com` to skip the domain prompt. An existing `ADMIN_PASSWORD_HASH` in `/etc/blog-cms.env` or `/opt/blog/.env` is reused.

Setup installs required system packages, installs or upgrades Bun to match `bun.lock`, configures nginx and systemd, builds the site, starts the CMS, and requests an HTTPS certificate through Certbot. Certbot may ask for contact email and terms acceptance. Keep ports 80 and 443 reachable. Until HTTPS is active, nginx rejects `/admin/` requests.

For later releases, push changes to the tracked Git branch, then run **one command as root on the VPS**:

```sh
cd /opt/blog && make deploy
```

This runs `git pull --ff-only`, installs locked production dependencies and regenerates `dist/` as the `blog` user, checks nginx configuration, restarts `blog-cms`, and reloads nginx. Local changes to tracked files stop deployment before the pull. Posts in `data/blog.db` stay on the VPS; Git ignores `data/` and `dist/`.

The CMS uses its own password login and session cookie. nginx adds a rate limit to `/admin/login`. HTTPS is required in production so the login cookie receives the `Secure` flag.

## Project layout

- `db.js`: SQLite schema and post queries
- `build.js`: Markdown rendering and static site generation
- `server.js`: local static server and CMS routes
- `auth.js`: admin login and sessions
- `static/`: CSS, JavaScript, and icons copied into `dist/`
- `deploy/`: nginx, systemd, VPS setup, and update scripts
