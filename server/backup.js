// Daily copies of the database in DATA_DIR/backups, so a bad change or a broken
// disk write never costs more than a day. Uses SQLite's online backup, which is
// safe while the app is running. BACKUP_KEEP_DAYS=0 turns this off.
const fs = require("fs");
const path = require("path");
const config = require("./config");
const { db } = require("./db");

const CHECK_EVERY_MS = 60 * 60 * 1000;
const NAME_RE = /^fantasyfrc-(\d{4}-\d{2}-\d{2})\.db$/;

const backupDir = () => path.join(config.dataDir, "backups");
const nameFor = (date) => `fantasyfrc-${date.toISOString().slice(0, 10)}.db`;

function listBackups() {
  try {
    return fs.readdirSync(backupDir()).filter((name) => NAME_RE.test(name)).sort().reverse();
  } catch {
    return [];
  }
}

function prune(keep) {
  for (const name of listBackups().slice(keep)) {
    try {
      fs.rmSync(path.join(backupDir(), name));
    } catch (err) {
      console.warn(`Couldn't remove old backup ${name}:`, err.message);
    }
  }
}

// Writes today's backup if there isn't one yet. Returns its path, or null if it already existed.
async function backupIfDue(now = new Date()) {
  const target = path.join(backupDir(), nameFor(now));
  if (fs.existsSync(target)) return null;
  fs.mkdirSync(backupDir(), { recursive: true });
  const partial = `${target}.partial`;
  await db.backup(partial);
  fs.renameSync(partial, target);
  prune(config.backupKeepDays);
  return target;
}

let running = false;
async function tick() {
  if (running) return;
  running = true;
  try {
    const made = await backupIfDue();
    if (made) console.log(`Backup written: ${made}`);
  } catch (err) {
    console.error("Backup failed:", err.message);
  } finally {
    running = false;
  }
}

function scheduleBackups() {
  if (config.backupKeepDays <= 0) return;
  setTimeout(tick, 0).unref();
  setInterval(tick, CHECK_EVERY_MS).unref();
}

module.exports = { scheduleBackups, backupIfDue, listBackups };
