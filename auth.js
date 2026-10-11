// Single-admin auth: argon2id hash from ADMIN_PASSWORD_HASH (base64, see `make password`),
// in-memory sessions (restart = log in again), per-IP login throttling.
import { randomBytes } from "node:crypto";

const HASH = process.env.ADMIN_PASSWORD_HASH
  ? Buffer.from(process.env.ADMIN_PASSWORD_HASH, "base64").toString("utf8")
  : "";
const SESSION_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_FAILS = 5;
const LOCK_MS = 15 * 60 * 1000;

const sessions = new Map(); // token -> expiresAt
const fails = new Map(); // ip -> { count, until }

export const authConfigured = HASH.startsWith("$argon2");

// Only the local Cloudflare Tunnel connector can reach the production listener.
const clientIp = (req) => req.headers["cf-connecting-ip"] || req.socket.remoteAddress;

function readCookie(req, name) {
  for (const part of (req.headers.cookie || "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return null;
}

export function isLoggedIn(req) {
  const token = readCookie(req, "sid");
  const exp = token && sessions.get(token);
  if (!exp) return false;
  if (exp < Date.now()) {
    sessions.delete(token);
    return false;
  }
  return true;
}

export function lockedFor(req) {
  const f = fails.get(clientIp(req));
  if (!f || f.count < MAX_FAILS) return 0;
  const left = f.until - Date.now();
  if (left <= 0) {
    fails.delete(clientIp(req));
    return 0;
  }
  return Math.ceil(left / 60000);
}

// Returns Set-Cookie value on success, null on wrong password.
export async function login(req, password) {
  const ip = clientIp(req);
  const ok = typeof password === "string" && password.length > 0 && password.length <= 1024 &&
    (await Bun.password.verify(password, HASH));
  if (!ok) {
    const f = fails.get(ip);
    fails.set(ip, { count: (f?.count || 0) + 1, until: Date.now() + LOCK_MS });
    if (fails.size > 10_000) for (const [k, v] of fails) if (v.until < Date.now()) fails.delete(k);
    return null;
  }
  fails.delete(ip);
  const token = randomBytes(32).toString("base64url");
  sessions.set(token, Date.now() + SESSION_MS);
  return cookie(req, token, SESSION_MS / 1000);
}

export function logout(req) {
  const token = readCookie(req, "sid");
  if (token) sessions.delete(token);
  return cookie(req, "", 0);
}

// Cloudflare Tunnel reports visitor HTTPS; plain HTTP is only used in local development.
const cookie = (req, value, maxAge) =>
  `sid=${value}; Path=/admin; HttpOnly; SameSite=Strict; Max-Age=${maxAge}` +
  (req.headers["x-forwarded-proto"] === "https" ? "; Secure" : "");
