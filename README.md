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

Production configuration lives in `deploy/`: `blog-cms.service` runs Bun on `127.0.0.1:3000`, and `deploy.sh` updates the site from Git. Use your existing Cloudflare Tunnel connector on the same VPS.

1. Push this repository to its GitHub origin. Git and Make are needed for the initial clone and setup command on a Debian or Ubuntu VPS.
2. On the VPS, clone the repository into `/opt/blog` (create the directory first if you prefer):

   ```sh
   mkdir -p /opt/blog
   git clone https://github.com/mardommah/personal-blog.git /opt/blog
   cd /opt/blog
   ```

   `git pull` works only inside an existing checkout. Use `git clone` for the first download. `/opt/blog` must be empty before cloning.
3. As root in `/opt/blog`, run `make vps-setup`. If no admin hash exists, setup asks for an admin password. An existing `ADMIN_PASSWORD_HASH` in `/etc/blog-cms.env` or `/opt/blog/.env` is reused.
4. In Cloudflare dashboard, open your existing tunnel under **Networking > Tunnels**. Add a **Published Application** with hostname `blog.mardoketlabs.site`, service type `HTTP`, and URL `127.0.0.1:3000`. The connector must run on this VPS. Replace any conflicting existing DNS record or old route for that hostname.

Setup installs required system packages and Bun, configures systemd, builds the site, and starts the blog. It does not install or change your existing Tunnel connector. Cloudflare handles the public HTTPS certificate; no nginx, Certbot, or inbound port 80/443 is required. The app rejects requests unless Cloudflare reports visitor HTTPS.

For later releases, push changes to the tracked Git branch, then run **one command as root on the VPS**:

```sh
cd /opt/blog && make deploy
```

This runs `git pull --ff-only`, installs locked production dependencies and regenerates `dist/` as the `blog` user, then restarts `blog-cms`. Local changes to tracked files stop deployment before the pull. Posts in `data/blog.db` stay on the VPS; Git ignores `data/` and `dist/`.

The CMS uses its own password login, per-IP login throttling, and session cookie. Cloudflare sets `X-Forwarded-Proto` from the visitor's scheme; production rejects HTTP, and HTTPS login cookies use the `Secure` flag. Enable **Always Use HTTPS** for the hostname in Cloudflare to redirect HTTP visitors.

## Project layout

- `db.js`: SQLite schema and post queries
- `build.js`: Markdown rendering and static site generation
- `server.js`: local static server and CMS routes
- `auth.js`: admin login and sessions
- `static/`: CSS, JavaScript, and icons copied into `dist/`
- `deploy/`: systemd, VPS setup, and update scripts
