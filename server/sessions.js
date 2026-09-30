// Sign-in lasts for weeks, not for the hour a Google ID token lives: after
// Google proves who someone is, we hand the browser an opaque random session id
// in an HttpOnly cookie. Only its SHA-256 is stored, so a leaked database can't
// be replayed, and signing out really revokes it.

const crypto = require("crypto");
const { db } = require("./db");
const config = require("./config");

const COOKIE_NAME = "ffrc_session";
const MAX_SESSIONS_PER_USER = 10;
const DAY_MS = 24 * 60 * 60 * 1000;

const hash = (id) => crypto.createHash("sha256").update(id).digest("hex");

const insertStmt = db.prepare(
  "INSERT INTO sessions (id_hash, sub, email, name, picture, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
);
const getStmt = db.prepare("SELECT sub, email, name, picture, expires_at FROM sessions WHERE id_hash = ?");
const extendStmt = db.prepare("UPDATE sessions SET expires_at = ? WHERE id_hash = ?");
const deleteStmt = db.prepare("DELETE FROM sessions WHERE id_hash = ?");
const purgeStmt = db.prepare("DELETE FROM sessions WHERE expires_at < ?");
const trimStmt = db.prepare(
  "DELETE FROM sessions WHERE sub = ? AND id_hash NOT IN (SELECT id_hash FROM sessions WHERE sub = ? ORDER BY created_at DESC LIMIT ?)"
);

function createSession(user) {
  const id = crypto.randomBytes(32).toString("base64url");
  const now = Date.now();
  insertStmt.run(hash(id), user.sub, user.email || "", user.name || "", user.picture || "", now, now + config.sessionTtlMs);
  trimStmt.run(user.sub, user.sub, MAX_SESSIONS_PER_USER);
  return id;
}

// Returns { user, renewed } or null. A session used after it is more than a day
// old is pushed out to a full lifetime again, so regular players stay signed in.
function lookupSession(id) {
  if (!id) return null;
  const row = getStmt.get(hash(id));
  if (!row) return null;
  const now = Date.now();
  if (row.expires_at < now) {
    deleteStmt.run(hash(id));
    return null;
  }
  let renewed = false;
  if (row.expires_at - now < config.sessionTtlMs - DAY_MS) {
    extendStmt.run(now + config.sessionTtlMs, hash(id));
    renewed = true;
  }
  return { user: { sub: row.sub, email: row.email, name: row.name, picture: row.picture }, renewed };
}

function deleteSession(id) {
  if (id) deleteStmt.run(hash(id));
}

function purgeExpiredSessions() {
  purgeStmt.run(Date.now());
}

function readSessionId(req) {
  const header = String(req.headers.cookie || "");
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq > 0 && part.slice(0, eq).trim() === COOKIE_NAME) {
      try {
        return decodeURIComponent(part.slice(eq + 1).trim());
      } catch {
        return "";
      }
    }
  }
  return "";
}

function cookieString(req, value, maxAgeSeconds) {
  const secure = req.protocol === "https" ? "; Secure" : "";
  return `${COOKIE_NAME}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure}`;
}

function setSessionCookie(req, res, id) {
  res.append("Set-Cookie", cookieString(req, id, Math.floor(config.sessionTtlMs / 1000)));
}

function clearSessionCookie(req, res) {
  res.append("Set-Cookie", cookieString(req, "", 0));
}

module.exports = {
  COOKIE_NAME,
  createSession,
  lookupSession,
  deleteSession,
  purgeExpiredSessions,
  readSessionId,
  setSessionCookie,
  clearSessionCookie
};
