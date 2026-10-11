# Personal Blog

Target server: 1GB RAM, 5GB disk, 1GHz CPU → keep stack tiny.

## Arsitektur
- Runtime: Bun. Only npm dep: `marked`. Lockfile `bun.lock`.
- `db.js` — SQLite via built-in `bun:sqlite`, file `data/blog.db` (WAL). Table `posts(slug PK, title, date, body, updated_at)`. All SQL lives here.
- `build.js` — static generator: DB → `dist/`. Builds into `dist.tmp-<pid>/` then swaps (never half-built). Exports `build`, `esc`, `renderMarkdown` (single Markdown renderer, GFM; CMS preview uses same fn).
- `server.js` — CMS, plain `node:http`. Binds `127.0.0.1` (`PORT`, default 3000). Routes `/admin/`, `/admin/new`, `/admin/edit/:slug`, `/admin/delete/:slug`, `/admin/preview` (POST, server-rendered, no JS). Every write rebuilds `dist/` (builds serialized via promise queue). Non-`/admin` GETs serve `dist/` for local dev; prod nginx serves them.
- `static/` — copied into `dist/`. `style.css` is mobile first: base = small screen, `@media (min-width: 40rem)` widens. Tap targets ≥44px, tables/pre scroll inside themselves, `overflow-wrap: anywhere` on article.
- Site config: `SITE` in build.js (`title` mardoketlabs, `tagline` Personal Blog). Header = title + tagline + theme button.
- Theme: tokens on `:root`; dark via `prefers-color-scheme` guarded by `:root:not([data-theme="light"])` and `:root[data-theme="dark"]`. `themeHead` (inline no-flash script + `/theme.js`) and `themeButton` exported from build.js, used by blog + CMS. Button = SVG icon (moon in light, sun in dark; shows target mode), hidden without JS, choice in localStorage `theme`.
- Sticky footer: body is flex column `min-height: 100dvh`, `main { flex: 1 0 auto }`.
- Favicon: `static/favicon.svg` (m + dot on #0b62c4), `favicon-32.png`, `apple-touch-icon.png` (180, square). PNGs rendered from SVG via headless Chrome; regenerate if SVG changes.
- Concurrency: build uses `dist.tmp-<pid>/` + retry on rename race; db.js sets `busy_timeout` 5000. CLI build + running CMS is safe.
- Pagination: `PER_PAGE` 10 in build.js. Static pages `/` + `/page/N/` (work without JS). `static/pagination.js` (index pages only) intercepts `a[data-pager]`, fetches page, swaps `<main id="main">`, `pushState`; `popstate` handles back/forward; fetch failure falls back to normal navigation.
- Reserved slugs `admin`, `page` (`RESERVED_SLUGS` in server.js) — they collide with site URLs.
- Post detail page: `← Semua tulisan` back link + prev/next nav (`postNav` in build.js; list is newest first, so `posts[i+1]` = older/Sebelumnya, `posts[i-1]` = newer/Berikutnya).
- `deploy/` — nginx.conf (serves `dist/`, proxies `/admin/`), systemd unit (Bun), `setup-vps.sh` (one-time VPS setup), `deploy.sh` (Git pull, build, restart, nginx reload).
- `Makefile` — `make dev` (watch, port 3099), `make build`, `make backup` (`VACUUM INTO backups/`), `make vps-setup` (on VPS after clone; domain from `.env` or prompt), `make deploy` (on VPS), `make clean`.

## Konvensi
- Auth = app password login (`auth.js`); nginx limits login requests. App binds loopback only. Production CMS requires HTTPS.
- CSRF: POST rejected unless `Sec-Fetch-Site: same-origin` (or matching Origin).
- Slug regex `^[a-z0-9]+(-[a-z0-9]+)*$` — slug becomes `dist/<slug>/` dir name; keep it.
- `data/blog.db` on server = source of truth; never rsync over it. Back up with `make backup`.
- Markdown raw HTML allowed (single trusted author).
- UI follows anti-slop rules: no em dash in visible text, WCAG AA contrast (`--muted` #666 light / #999 dark), light/dark via prefers-color-scheme.
- Old VPS CPU without AVX2 → Bun "Illegal instruction" → use `bun-linux-x64-baseline`.
