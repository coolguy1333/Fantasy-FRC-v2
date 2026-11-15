const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Database = require("better-sqlite3");
const { startServer, token } = require("./helpers/server");

const today = () => `fantasyfrc-${new Date().toISOString().slice(0, 10)}.db`;

async function waitFor(check, ms = 5000) {
  for (const end = Date.now() + ms; Date.now() < end; ) {
    if (check()) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return false;
}

test("a daily backup is written on start, old ones are pruned", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "ffrc-backup-"));
  const backups = path.join(dataDir, "backups");
  fs.mkdirSync(backups);
  for (const day of ["2001-01-01", "2001-01-02", "2001-01-03"]) fs.writeFileSync(path.join(backups, `fantasyfrc-${day}.db`), "old");
  fs.writeFileSync(path.join(backups, "notes.txt"), "not a backup - leave alone");

  const s = await startServer({ DATA_DIR: dataDir, BACKUP_KEEP_DAYS: "2" });
  try {
    const tok = token("alice");
    const { updatedAt } = (await s.call("GET", "/api/state", { tok })).json;
    await s.call("PATCH", "/api/state", { tok, body: { updatedAt, patch: { profiles: { set: { alice: { name: "Alice" } } } } } });
    assert.ok(await waitFor(() => fs.existsSync(path.join(backups, today()))), s.log());
    assert.deepEqual(fs.readdirSync(backups).sort(), ["fantasyfrc-2001-01-03.db", today(), "notes.txt"].sort());
    const copy = new Database(path.join(backups, today()), { readonly: true });
    assert.ok(copy.prepare("SELECT name FROM sqlite_master WHERE name = 'state'").get(), "the backup is a real database");
    copy.close();
  } finally {
    await s.stop();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test("BACKUP_KEEP_DAYS=0 turns backups off", async () => {
  const s = await startServer({ BACKUP_KEEP_DAYS: "0" });
  try {
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(fs.existsSync(path.join(s.dataDir, "backups")), false);
  } finally {
    await s.stop();
    s.cleanup();
  }
});
