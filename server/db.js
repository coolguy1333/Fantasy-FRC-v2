const fs = require("fs");
const Database = require("better-sqlite3");
const config = require("./config");
const { emptyState, normalizeState } = require("./state/schema");
const { diffState, mergePatches } = require("./state/patch");

if (!fs.existsSync(config.dataDir)) fs.mkdirSync(config.dataDir, { recursive: true });

function openDatabase() {
  try {
    const db = new Database(config.dbPath);
    db.pragma("journal_mode = WAL");
    return db;
  } catch (err) {
    // Corrupt DB file: quarantine it and start fresh rather than crash-looping.
    // Only for real corruption - a permissions/disk/locking error must not make
    // us move a healthy database aside and silently start from empty.
    const corrupt = err.code === "SQLITE_CORRUPT" || err.code === "SQLITE_NOTADB";
    if (corrupt && fs.existsSync(config.dbPath)) {
      const backupPath = `${config.dbPath}.corrupt-${Date.now()}.bak`;
      fs.renameSync(config.dbPath, backupPath);
      console.error(`Database failed to open, quarantined to ${backupPath}:`, err.message);
      const db = new Database(config.dbPath);
      db.pragma("journal_mode = WAL");
      return db;
    }
    throw err;
  }
}

const db = openDatabase();

db.exec(`
  CREATE TABLE IF NOT EXISTS state (
    id TEXT PRIMARY KEY,
    payload TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    id_hash TEXT PRIMARY KEY,
    sub TEXT NOT NULL,
    email TEXT NOT NULL,
    name TEXT NOT NULL,
    picture TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS sessions_sub ON sessions (sub);
`);

const STATE_ID = "shared-state";

const getStateStmt = db.prepare("SELECT payload, updated_at FROM state WHERE id = ?");
const upsertStateStmt = db.prepare(`
  INSERT INTO state (id, payload, updated_at) VALUES (@id, @payload, @updatedAt)
  ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at
`);

function loadState() {
  const row = getStateStmt.get(STATE_ID);
  if (!row) return { state: emptyState(), updatedAt: 0 };
  try {
    // normalize so a document saved before a domain existed still has every key
    return { state: normalizeState(JSON.parse(row.payload)), updatedAt: Number(row.updated_at) };
  } catch (err) {
    console.error("Stored state is not valid JSON, treating as empty:", err.message);
    return { state: emptyState(), updatedAt: Number(row.updated_at) || 0 };
  }
}

// This process is the only writer, so the parsed document is kept in memory:
// a poll doesn't re-parse the whole thing from SQLite.
let current = null;
const peek = () => (current ||= loadState());

// A copy the caller may change and pass to writeState.
function readState() {
  const { state, updatedAt } = peek();
  return { state: structuredClone(state), updatedAt };
}

// The live document - read only. For answering reads without copying it.
function peekState() {
  return peek();
}

// Recent writes as patches, so a poll can get just what changed since its version.
const CHANGE_LOG_SIZE = 500;
const changeLog = [];

function writeState(state, prevUpdatedAt) {
  const before = peek();
  const updatedAt = Math.max(Date.now(), Number(prevUpdatedAt || 0) + 1, before.updatedAt + 1);
  upsertStateStmt.run({ id: STATE_ID, payload: JSON.stringify(state), updatedAt });
  const saved = structuredClone(state);
  changeLog.push({ from: before.updatedAt, to: updatedAt, patch: diffState(before.state, saved) });
  if (changeLog.length > CHANGE_LOG_SIZE) changeLog.shift();
  current = { state: saved, updatedAt };
  return updatedAt;
}

// Everything that changed after version `since`, as one patch - or null if that
// version is too old (or from before a restart) and the caller needs the whole document.
function changesSince(since) {
  const { updatedAt } = peek();
  if (since === updatedAt) return {};
  const start = changeLog.findIndex((entry) => entry.from === since);
  if (start < 0) return null;
  const entries = changeLog.slice(start);
  for (let i = 1; i < entries.length; i += 1) if (entries[i].from !== entries[i - 1].to) return null;
  if (entries[entries.length - 1].to !== updatedAt) return null;
  return mergePatches(entries.map((entry) => entry.patch));
}

function integrityCheck() {
  try {
    const result = db.pragma("integrity_check");
    const ok = Array.isArray(result) && result[0] && result[0].integrity_check === "ok";
    return { ok, detail: result };
  } catch (err) {
    return { ok: false, detail: err.message };
  }
}

module.exports = { db, readState, peekState, writeState, changesSince, integrityCheck };
