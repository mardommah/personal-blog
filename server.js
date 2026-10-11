// Minimal CMS: create/edit/delete posts in SQLite, rebuild dist/ after each change.
// Listens on 127.0.0.1 only; nginx proxies /admin/ (see deploy/nginx.conf). Login: auth.js.
// Non-/admin paths serve dist/ for local dev; in production nginx serves those directly.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
import { build, esc, renderMarkdown, themeHead, themeButton } from "./build.js";
import { listPosts, getPost, createPost, updatePost, deletePost } from "./db.js";
import { authConfigured, isLoggedIn, lockedFor, login, logout } from "./auth.js";

const PORT = Number(process.env.PORT) || 3000;
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
// URL paths owned by the site itself: /admin/ (CMS), /page/N/ (pagination).
const RESERVED_SLUGS = new Set(["admin", "page"]);

// Serialize builds so concurrent saves never write dist/ at the same time.
let queue = Promise.resolve();
const serial = (fn) => (queue = queue.then(fn, fn));

const page = (title, body) => `<!doctype html>
<html lang="id"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · CMS</title><link rel="stylesheet" href="/style.css">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
${themeHead}
<style>
  label { display: block; margin-top: 1rem; font-weight: 600; }
  input, textarea { width: 100%; font: inherit; padding: .5rem; background: var(--bg); color: var(--fg);
    border: 1px solid var(--muted); border-radius: 4px; }
  textarea { min-height: 24rem; font-family: ui-monospace, monospace; font-size: .9rem; }
  button { margin-top: 1rem; padding: .5rem 1.25rem; font: inherit; cursor: pointer; }
  .row { display: flex; gap: 1rem; align-items: center; justify-content: space-between; }
  .err { color: var(--err); }
  .hint { color: var(--muted); font-size: .875rem; margin: .25rem 0 0; }
  .hint code { background: rgba(127,127,127,.15); padding: 0 .25rem; border-radius: 3px; }
  .preview { margin-top: 2rem; padding-top: 1rem; border-top: 1px solid var(--muted); }
  .actions { display: flex; gap: .75rem; }
  form.inline { display: inline; } form.inline button { margin: 0; padding: .1rem .5rem; }
</style></head>
<body><header class="site-header"><a class="site-title" href="/admin/">CMS</a>
<div class="row"><a href="/" target="_blank">Lihat blog ↗</a>${themeButton}</div></header>
<main>${body}</main></body></html>`;

const loginPage = (error = "") => page("Login", `<h1>Login</h1>
${error ? `<p class="err" role="alert">${esc(error)}</p>` : ""}
<form method="post" action="/admin/login">
  <label>Password <input name="password" type="password" required autocomplete="current-password" autofocus></label>
  <button type="submit">Masuk</button>
</form>`);

const readPost = (slug) => (SLUG_RE.test(slug) ? getPost(slug) : null);

const today = () => new Date().toISOString().slice(0, 10);

function editor(post, isNew, error = "", preview = null) {
  const action = isNew ? "/admin/new" : `/admin/edit/${post.slug}`;
  return page(isNew ? "Post baru" : `Edit ${post.title}`, `
<h1>${isNew ? "Post baru" : "Edit post"}</h1>
${error ? `<p class="err">${esc(error)}</p>` : ""}
<form method="post" action="${action}">
  <label>Judul <input name="title" required maxlength="200" value="${esc(post.title || "")}"></label>
  <label>Slug (URL) <input name="slug" required pattern="[a-z0-9]+(-[a-z0-9]+)*" value="${esc(post.slug || "")}"
    ${isNew ? "" : "readonly"} placeholder="judul-post-saya"></label>
  <label>Tanggal <input name="date" type="date" required value="${esc(post.date || today())}"></label>
  <input type="hidden" name="_new" value="${isNew ? 1 : 0}">
  <label for="body">Isi (Markdown)</label>
  <textarea id="body" name="body" aria-describedby="md-hint">${esc(post.body || "")}</textarea>
  <p class="hint" id="md-hint"><code>## Judul</code> <code>**tebal**</code> <code>*miring*</code>
    <code>[teks](https://url)</code> <code>![alt](/gambar.png)</code> <code>- list</code> <code>1. list</code>
    <code>&gt; kutipan</code> <code>\`kode\`</code> <code>\`\`\`</code> blok kode, tabel <code>| a | b |</code></p>
  <div class="actions">
    <button type="submit">Simpan &amp; publish</button>
    <button type="submit" formaction="/admin/preview" formnovalidate>Preview</button>
  </div>
</form>
${preview === null ? "" : `<section class="preview" aria-label="Preview"><h2>Preview</h2>
<article><h1>${esc(post.title || "")}</h1><time>${esc(post.date || "")}</time>${preview}</article></section>`}`);
}

async function readForm(req) {
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > 1_000_000) throw Object.assign(new Error("Payload too large"), { status: 413 });
    chunks.push(c);
  }
  return Object.fromEntries(new URLSearchParams(Buffer.concat(chunks).toString("utf8")));
}

function validate(f) {
  const title = (f.title || "").replace(/[\r\n]+/g, " ").trim();
  const slug = (f.slug || "").trim();
  const date = (f.date || "").trim();
  const body = (f.body || "").replace(/\r\n/g, "\n");
  if (!title) return { error: "Judul wajib diisi." };
  if (!SLUG_RE.test(slug)) return { error: "Slug hanya huruf kecil, angka, dan tanda '-'." };
  if (RESERVED_SLUGS.has(slug)) return { error: `Slug "${slug}" dipakai sistem, pilih yang lain.` };
  if (!DATE_RE.test(date)) return { error: "Tanggal tidak valid." };
  return { post: { title, slug, date, body } };
}

const DIST = resolve("dist");
const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".xml": "application/rss+xml",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif",
  ".svg": "image/svg+xml", ".webp": "image/webp", ".ico": "image/x-icon" };

async function serveStatic(res, pathname) {
  let file = resolve(DIST, "." + decodeURIComponent(pathname));
  if (file !== DIST && !file.startsWith(DIST + sep)) return false;
  if (pathname.endsWith("/")) file = resolve(file, "index.html");
  try {
    const data = await readFile(file);
    res.writeHead(200, { "content-type": TYPES[extname(file)] || "application/octet-stream" });
    res.end(data);
    return true;
  } catch (e) {
    if (e.code === "ENOENT" || e.code === "EISDIR") return false;
    throw e;
  }
}

const send = (res, status, html) => {
  res.writeHead(status, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
  res.end(html);
};
const redirect = (res, to) => res.writeHead(303, { location: to }).end();

async function handle(req, res) {
  const { pathname } = new URL(req.url, "http://localhost");

  // Reject cross-site POSTs (CSRF); the SameSite=Strict session cookie is the second layer.
  if (req.method === "POST") {
    const site = req.headers["sec-fetch-site"];
    if (site && site !== "same-origin") return send(res, 403, "Forbidden");
    const origin = req.headers.origin;
    if (!site && origin && new URL(origin).host !== req.headers.host) return send(res, 403, "Forbidden");
  }

  if (pathname.startsWith("/admin")) {
    // Fail closed: no password configured means no CMS at all.
    if (!authConfigured)
      return send(res, 503, page("CMS terkunci", "<p>ADMIN_PASSWORD_HASH belum diset. Jalankan <code>make password</code>.</p>"));

    if (pathname === "/admin/login") {
      if (req.method === "GET") return isLoggedIn(req) ? redirect(res, "/admin/") : send(res, 200, loginPage());
      if (req.method === "POST") {
        const mins = lockedFor(req);
        if (mins) return send(res, 429, loginPage(`Terlalu banyak percobaan. Coba lagi dalam ${mins} menit.`));
        const setCookie = await login(req, (await readForm(req)).password);
        if (!setCookie) return send(res, 401, loginPage("Password salah."));
        res.setHeader("set-cookie", setCookie);
        return redirect(res, "/admin/");
      }
    }

    if (!isLoggedIn(req)) return redirect(res, "/admin/login");

    if (pathname === "/admin/logout" && req.method === "POST") {
      res.setHeader("set-cookie", logout(req));
      return redirect(res, "/admin/login");
    }
  }

  if (req.method === "GET" && pathname === "/admin/") {
    const rows = listPosts().map((p) => `<li><time>${p.date}</time>
      <a href="/admin/edit/${p.slug}">${esc(p.title)}</a>
      <form class="inline" method="post" action="/admin/delete/${p.slug}"
        onsubmit="return confirm('Hapus post ini?')"><button>hapus</button></form></li>`).join("");
    return send(res, 200, page("Posts", `<div class="row"><h1>Posts</h1><a href="/admin/new">+ Post baru</a></div>
      <form class="inline" method="post" action="/admin/logout"><button>Keluar</button></form>
      <ul class="posts">${rows || "<li>Belum ada post.</li>"}</ul>`));
  }

  if (pathname === "/admin/preview" && req.method === "POST") {
    const f = await readForm(req);
    return send(res, 200, editor(f, f._new === "1", "", renderMarkdown(f.body || "")));
  }

  if (pathname === "/admin/new") {
    if (req.method === "GET") return send(res, 200, editor({}, true));
    if (req.method === "POST") {
      const f = await readForm(req);
      const { post, error } = validate(f);
      if (error) return send(res, 400, editor(f, true, error));
      if (!createPost(post)) return send(res, 409, editor(f, true, "Slug sudah dipakai."));
      await serial(build);
      return redirect(res, "/admin/");
    }
  }

  const m = pathname.match(/^\/admin\/(edit|delete)\/([^/]+)$/);
  if (m) {
    const [, action, slug] = m;
    const existing = readPost(slug);
    if (!existing) return send(res, 404, page("Not found", "<p>Post tidak ditemukan.</p>"));

    if (action === "edit" && req.method === "GET") return send(res, 200, editor(existing, false));
    if (action === "edit" && req.method === "POST") {
      const f = { ...(await readForm(req)), slug };
      const { post, error } = validate(f);
      if (error) return send(res, 400, editor(f, false, error));
      updatePost(post);
      await serial(build);
      return redirect(res, "/admin/");
    }
    if (action === "delete" && req.method === "POST") {
      deletePost(slug);
      await serial(build);
      return redirect(res, "/admin/");
    }
  }

  if (req.method === "GET" && !pathname.startsWith("/admin") && (await serveStatic(res, pathname))) return;

  send(res, 404, page("Not found", "<p>Halaman tidak ada.</p>"));
}

createServer((req, res) =>
  handle(req, res).catch((e) => {
    console.error(e);
    if (!res.headersSent) send(res, e.status || 500, esc(e.message || "Server error"));
  })
).listen(PORT, "127.0.0.1", async () => {
  await build();
  console.log(`CMS on http://127.0.0.1:${PORT}/admin/`);
});
