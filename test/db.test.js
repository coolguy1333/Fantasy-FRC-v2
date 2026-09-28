const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const SERVER = path.join(__dirname, "..", "server", "index.js");

function run(dataDir) {
  return spawnSync(process.execPath, [SERVER], {
    env: { ...process.env, DATA_DIR: dataDir, PORT: "0", HOST: "127.0.0.1" },
    timeout: 2500,
    encoding: "utf8"
  });
}

test("a corrupt database is quarantined and replaced", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ffrc-db-"));
  fs.writeFileSync(path.join(dir, "fantasyfrc.db"), "this is not a sqlite database".repeat(50));
  const result = run(dir);
  assert.match(result.stderr, /quarantined/);
  assert.ok(fs.readdirSync(dir).some((f) => f.includes(".corrupt-")));
  fs.rmSync(dir, { recursive: true, force: true });
});

test("a database that merely can't be opened is never moved aside", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ffrc-db-"));
  // A directory where the file should be: SQLITE_CANTOPEN, not corruption.
  fs.mkdirSync(path.join(dir, "fantasyfrc.db"));
  const result = run(dir);
  assert.notEqual(result.status, 0);
  assert.deepEqual(fs.readdirSync(dir), ["fantasyfrc.db"]);
  fs.rmSync(dir, { recursive: true, force: true });
});
