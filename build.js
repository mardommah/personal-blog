// Static blog generator: posts in SQLite -> dist/*.html
import { writeFile, mkdir, rm, cp, rename } from "node:fs/promises";
import { marked } from "marked";
import { listPosts } from "./db.js";

const SITE = { title: "mardoketlabs", tagline: "Personal Blog", description: "Blog Notes." };
const OUT = "dist";
const PER_PAGE = 10;

// Single renderer so CMS preview matches the published page.
export const renderMarkdown = (src) => marked.parse(src);

export const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

// Applies saved theme before first paint so the page never flashes the wrong mode.
export const themeHead = `<script>try{const t=localStorage.getItem("theme");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch{}</script>
<script src="/theme.js" defer></script>`;
export const themeButton = `<button class="theme-toggle" type="button" aria-label="Ganti tema" hidden></button>`;

const layout = (title, content) => `<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(SITE.description)}">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="icon" href="/favicon-32.png" sizes="32x32" type="image/png">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="stylesheet" href="/style.css">
<link rel="alternate" type="application/rss+xml" href="/rss.xml">
${themeHead}
<script src="/nav.js" defer></script>
</head>
<body>
<header class="site-header"><div><a class="site-title" href="/">${esc(SITE.title)}</a><p class="tagline">${esc(SITE.tagline)}</p></div>${themeButton}</header>
<main id="main" tabindex="-1">${content}</main>
<footer>&copy; ${new Date().getFullYear()} ${esc(SITE.title)}</footer>
</body>
</html>
`;

const navLink = (p, rel, label) =>
  p ? `<a class="${rel}" rel="${rel}" href="/${p.slug}/"><span>${label}</span>${esc(p.title)}</a>` : "";

function postNav(older, newer) {
  if (!older && !newer) return "";
  return `<nav class="post-nav" aria-label="Tulisan lain">
${navLink(older, "prev", "← Sebelumnya")}${navLink(newer, "next", "Berikutnya →")}
</nav>`;
}

const pageUrl = (n) => (n === 1 ? "/" : `/page/${n}/`);

function pager(n, total) {
  if (total < 2) return "";
  const link = (to, rel, label) =>
    to >= 1 && to <= total ? `<a class="${rel}" rel="${rel}" href="${pageUrl(to)}">${label}</a>` : "";
  return `<nav class="pagination" aria-label="Halaman">
${link(n - 1, "prev", "← Lebih baru")}<span aria-current="page">Halaman ${n} dari ${total}</span>${link(n + 1, "next", "Lebih lama →")}
</nav>`;
}

export async function build() {
  const posts = listPosts();

  // Per-process temp dir: CLI build and running CMS may build at the same time.
  const TMP = `${OUT}.tmp-${process.pid}`;
  await rm(TMP, { recursive: true, force: true });
  await mkdir(TMP);
  await cp("static", TMP, { recursive: true });

  // posts are newest first: index - 1 is newer, index + 1 is older.
  for (const [i, p] of posts.entries()) {
    await mkdir(`${TMP}/${p.slug}`);
    await writeFile(
      `${TMP}/${p.slug}/index.html`,
      layout(`${p.title} · ${SITE.title}`, `<a class="back" href="/">← Semua tulisan</a>
<article><h1>${esc(p.title)}</h1><time datetime="${p.date}">${p.date}</time>${renderMarkdown(p.body)}</article>
${postNav(posts[i + 1], posts[i - 1])}`)
    );
  }

  // Index pages: / is page 1, then /page/2/, /page/3/, ...
  const total = Math.max(1, Math.ceil(posts.length / PER_PAGE));
  for (let n = 1; n <= total; n++) {
    const items = posts.slice((n - 1) * PER_PAGE, n * PER_PAGE)
      .map((p) => `<li><time datetime="${p.date}">${p.date}</time> <a href="/${p.slug}/">${esc(p.title)}</a></li>`)
      .join("\n");
    const body = items ? `<ul class="posts">${items}</ul>\n${pager(n, total)}` : "<p>Belum ada tulisan.</p>";
    const title = n === 1 ? `${SITE.title} · ${SITE.tagline}` : `Halaman ${n} · ${SITE.title}`;
    const dir = n === 1 ? TMP : `${TMP}/page/${n}`;
    await mkdir(dir, { recursive: true });
    await writeFile(`${dir}/index.html`, layout(title, body));
  }

  const rss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>${esc(SITE.title)}</title><link>/</link><description>${esc(SITE.description)}</description>
${posts.map((p) => `<item><title>${esc(p.title)}</title><link>/${p.slug}/</link><pubDate>${new Date(p.date).toUTCString()}</pubDate></item>`).join("\n")}
</channel></rss>
`;
  await writeFile(`${TMP}/rss.xml`, rss);

  // Swap in finished output so the live site is never half-built.
  // Another process may swap in its own dist/ between our rm and rename; retry, last build wins.
  for (let attempt = 1; ; attempt++) {
    await rm(OUT, { recursive: true, force: true });
    try {
      await rename(TMP, OUT);
      break;
    } catch (e) {
      if (attempt >= 5 || (e.code !== "ENOTEMPTY" && e.code !== "EEXIST")) throw e;
    }
  }
  return posts.length;
}

if (import.meta.main) {
  console.log(`Built ${await build()} post(s) -> ${OUT}/`);
}
