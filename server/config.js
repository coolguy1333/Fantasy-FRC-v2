const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
require("dotenv").config();
const { parseEmailList, parseList } = require("./emails");

function bool(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  return String(value).trim().toLowerCase() === "true";
}

function positiveNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

// DATA_DIR is what a WebManager-style host sets (always /data, always
// writable); FF_DATA_DIR is the older self-hosted (systemd/LXC) variable.
// Prefer DATA_DIR when both are present.
const dataDir = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : process.env.FF_DATA_DIR
  ? path.resolve(process.env.FF_DATA_DIR)
  : path.join(__dirname, "..", "data");

// A fingerprint of the frontend files, so an open tab can tell it's out of date
// after a deploy (even one that didn't change the version number).
function buildIdOf(dir) {
  const hash = crypto.createHash("sha1");
  const walk = (d) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else hash.update(entry.name).update(fs.readFileSync(full));
    }
  };
  try {
    walk(dir);
  } catch {
    return "unknown";
  }
  return hash.digest("hex").slice(0, 12);
}

const publicDir = path.join(__dirname, "..", "public");

module.exports = {
  host: process.env.HOST || "0.0.0.0",
  port: Number(process.env.PORT || 3000),
  // Only true when actually deployed behind a reverse proxy (nginx, Caddy,
  // Cloudflare...) that overwrites X-Forwarded-* itself. If false (the safe
  // default for a bare LXC exposed directly), a client can't spoof its own
  // IP and bypass the per-IP rate limits by forging X-Forwarded-For.
  trustProxy: bool(process.env.TRUST_PROXY, false),
  publicUrl: String(process.env.PUBLIC_URL || "").trim(),
  dataDir,
  dbPath: path.join(dataDir, "fantasyfrc.db"),
  publicDir,
  buildId: buildIdOf(publicDir),
  tbaApiKey: String(process.env.TBA_API_KEY || "").trim(),
  tbaApiBase: "https://www.thebluealliance.com/api/v3",
  // How long a sign-in lasts. Sliding: active people are never signed out.
  sessionTtlMs: (positiveNumber(process.env.SESSION_TTL_DAYS) || 30) * 24 * 60 * 60 * 1000,
  googleClientId: String(process.env.GOOGLE_CLIENT_ID || "").trim(),
  requireHttps: bool(process.env.REQUIRE_HTTPS, false),
  localApiOnly: bool(process.env.LOCAL_API_ONLY, false),
  bootstrapAdminEmails: parseEmailList(process.env.GLOBAL_ADMIN_EMAILS),
  bootstrapAdminIds: parseList(process.env.GLOBAL_ADMIN_IDS),
  appVersion: require("../package.json").version
};
