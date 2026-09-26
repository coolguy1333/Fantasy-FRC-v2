const path = require("path");
require("dotenv").config();

function bool(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  return String(value).trim().toLowerCase() === "true";
}

function csv(value) {
  return String(value || "").split(",").map((v) => v.trim()).filter(Boolean);
}

// DATA_DIR is what a WebManager-style host sets (always /data, always
// writable); FF_DATA_DIR is the older self-hosted (systemd/LXC) variable.
// Prefer DATA_DIR when both are present.
const dataDir = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : process.env.FF_DATA_DIR
  ? path.resolve(process.env.FF_DATA_DIR)
  : path.join(__dirname, "..", "data");

module.exports = {
  host: process.env.HOST || "0.0.0.0",
  port: Number(process.env.PORT || 3000),
  // Only true when actually deployed behind a reverse proxy (nginx, Caddy,
  // Cloudflare...) that overwrites X-Forwarded-* itself. If false (the safe
  // default for a bare LXC exposed directly), a client can't spoof its own
  // IP and bypass the per-IP rate limits by forging X-Forwarded-For.
  trustProxy: bool(process.env.TRUST_PROXY, false),
  dataDir,
  dbPath: path.join(dataDir, "fantasyfrc.db"),
  publicDir: path.join(__dirname, "..", "public"),
  tbaApiKey: String(process.env.TBA_API_KEY || "").trim(),
  tbaApiBase: "https://www.thebluealliance.com/api/v3",
  googleClientId: String(process.env.GOOGLE_CLIENT_ID || "").trim(),
  requireHttps: bool(process.env.REQUIRE_HTTPS, false),
  localApiOnly: bool(process.env.LOCAL_API_ONLY, false),
  bootstrapAdminEmails: csv(process.env.GLOBAL_ADMIN_EMAILS).map((e) => e.toLowerCase()),
  bootstrapAdminIds: csv(process.env.GLOBAL_ADMIN_IDS),
  appVersion: require("../package.json").version
};
