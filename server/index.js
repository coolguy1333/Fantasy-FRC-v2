const path = require("path");
const express = require("express");
const config = require("./config");
const apiRoutes = require("./routes");
const { db } = require("./db");
const { securityHeaders, enforceTransport, enforceLocalApiOnly } = require("./security");

const app = express();

// "true" would tell Express to trust an unlimited chain of proxies, which
// lets a client bypass IP-based rate limiting by prepending fake hops to
// X-Forwarded-For (see ERR_ERL_PERMISSIVE_TRUST_PROXY). There is exactly one
// reverse proxy in front of this app when TRUST_PROXY is on, so trust just
// that one hop.
app.set("trust proxy", config.trustProxy ? 1 : false);
app.disable("x-powered-by");

app.use(securityHeaders);
app.use(enforceTransport);
app.use(express.json({ limit: "1mb" }));

app.use("/api", enforceLocalApiOnly, apiRoutes);

// Deny dotfiles and anything reaching for the data directory.
app.use((req, res, next) => {
  const p = req.path.toLowerCase();
  if (p.split("/").some((seg) => seg.startsWith("."))) return res.status(404).end();
  if (p.startsWith("/data") || p.endsWith(".db")) return res.status(404).end();
  next();
});

app.use(express.static(config.publicDir, { dotfiles: "deny" }));

app.get("*", (_req, res) => {
  res.sendFile(path.join(config.publicDir, "index.html"));
});

const server = app.listen(config.port, config.host, () => {
  console.log(`Fantasy FRC listening on http://${config.host}:${config.port} (v${config.appVersion})`);
  if (!config.googleClientId) console.warn("GOOGLE_CLIENT_ID not set - sign-in disabled.");
  if (!config.tbaApiKey) console.warn("TBA_API_KEY not set - live event data disabled.");
});

// Stop cleanly on SIGTERM/SIGINT: stop accepting new connections, close the
// database, then exit - so a host that restarts/redeploys the process
// doesn't kill it mid-write or leave the sqlite file in a bad state.
function shutdown(signal) {
  console.log(`${signal} received, shutting down`);
  server.close(() => {
    db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 9000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
