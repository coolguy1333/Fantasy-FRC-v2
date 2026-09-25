const path = require("path");
const express = require("express");
const config = require("./config");
const apiRoutes = require("./routes");
const { securityHeaders, enforceTransport, enforceLocalApiOnly } = require("./security");

const app = express();

app.set("trust proxy", true);
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

app.listen(config.port, config.host, () => {
  console.log(`Fantasy FRC listening on http://${config.host}:${config.port} (v${config.appVersion})`);
  if (!config.googleClientId) console.warn("GOOGLE_CLIENT_ID not set - sign-in disabled.");
  if (!config.tbaApiKey) console.warn("TBA_API_KEY not set - live event data disabled.");
});
