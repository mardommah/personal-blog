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

Production configuration lives in `deploy/`: nginx serves the blog on loopback, `blog-cms.service` runs Bun, `blog-tunnel.service` connects to Cloudflare, and `deploy.sh` updates the site from Git.

1. Push this repository to its GitHub origin. Git and Make are needed for the initial clone and setup command on a Debian or Ubuntu VPS.
2. On the VPS, clone the repository into `/opt/blog` (create the directory first if you prefer):

   ```sh
   mkdir -p /opt/blog
   git clone https://github.com/mardommah/personal-blog.git /opt/blog
   cd /opt/blog
   ```

   `git pull` works only inside an existing checkout. Use `git clone` for the first download. `/opt/blog` must be empty before cloning.
3. In Cloudflare, create a remotely managed tunnel under **Networking > Tunnels**. Copy the tunnel token from the connector installation command; keep it private.
4. As root in `/opt/blog`, run `make vps-setup`. Enter the domain and tunnel token when prompted. If no admin hash exists, setup also asks for an admin password. You can set `DOMAIN=blog.example.com` in `/opt/blog/.env` or pass `make vps-setup DOMAIN=blog.example.com` to skip the domain prompt. An existing `ADMIN_PASSWORD_HASH` in `/etc/blog-cms.env` or `/opt/blog/.env` is reused.
5. When the tunnel connector is healthy, add a **Published application** route for the blog hostname with service URL `http://127.0.0.1:8080`. The route sets the Cloudflare DNS target for the hostname; replace any conflicting existing DNS record.

Setup installs required system packages and Bun, installs `cloudflared`, configures nginx and systemd, builds the site, and starts the CMS and tunnel. Cloudflare handles the public HTTPS certificate; no Certbot or inbound port 80/443 is required for this blog. nginx listens only on `127.0.0.1:8080`. Setup stores the token in `/etc/blog-tunnel.token` with mode `600` and requires HTTPS at Cloudflare before serving the CMS.

For later releases, push changes to the tracked Git branch, then run **one command as root on the VPS**:

```sh
cd /opt/blog && make deploy
```

This runs `git pull --ff-only`, installs locked production dependencies and regenerates `dist/` as the `blog` user, checks nginx configuration, restarts `blog-cms`, and reloads nginx. Local changes to tracked files stop deployment before the pull. Posts in `data/blog.db` stay on the VPS; Git ignores `data/` and `dist/`.

The CMS uses its own password login and session cookie. nginx adds a rate limit to `/admin/login`. Cloudflare sets `X-Forwarded-Proto` from the visitor's scheme; nginx redirects HTTP visitors to HTTPS and passes that scheme to the CMS so login cookies use the `Secure` flag.

## Project layout

- `db.js`: SQLite schema and post queries
- `build.js`: Markdown rendering and static site generation
- `server.js`: local static server and CMS routes
- `auth.js`: admin login and sessions
- `static/`: CSS, JavaScript, and icons copied into `dist/`
- `deploy/`: nginx, systemd, Cloudflare Tunnel, VPS setup, and update scripts
