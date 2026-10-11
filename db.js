// Post storage: SQLite at data/blog.db (bun:sqlite, built into Bun).
import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";

mkdirSync("data", { recursive: true });
const db = new Database("data/blog.db", { create: true, strict: true });
// Wait for locks instead of failing when CLI build and CMS open the DB together.
db.run("PRAGMA busy_timeout = 5000");
db.run("PRAGMA journal_mode = WAL");
db.run(`CREATE TABLE IF NOT EXISTS posts (
  slug       TEXT PRIMARY KEY,
  title      TEXT NOT NULL,
  date       TEXT NOT NULL,
  body       TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
)`);

const qList = db.query("SELECT slug, title, date, body FROM posts ORDER BY date DESC, slug");
const qGet = db.query("SELECT slug, title, date, body FROM posts WHERE slug = $slug");
const qInsert = db.query(
  "INSERT INTO posts (slug, title, date, body) VALUES ($slug, $title, $date, $body) ON CONFLICT(slug) DO NOTHING"
);
const qUpdate = db.query(
  "UPDATE posts SET title = $title, date = $date, body = $body, updated_at = datetime('now') WHERE slug = $slug"
);
const qDelete = db.query("DELETE FROM posts WHERE slug = $slug");

export const listPosts = () => qList.all();
export const getPost = (slug) => qGet.get({ slug });
// Returns false when the slug is already taken.
export const createPost = (p) => qInsert.run(p).changes === 1;
export const updatePost = (p) => qUpdate.run(p).changes === 1;
export const deletePost = (slug) => qDelete.run({ slug }).changes === 1;
