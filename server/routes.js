const express = require("express");
const config = require("./config");
const { readState, writeState, integrityCheck } = require("./db");
const { normalizeState, validateState } = require("./state/schema");
const { checkAuthorization, isGlobalAdmin } = require("./state/authorize");
const { verifyGoogleIdToken, requireAuth } = require("./auth");
const { limiters, requireSameOrigin } = require("./security");
const { tbaProxyHandler, EVENT_KEY_RE, YEAR_RE } = require("./tba");

const router = express.Router();
const auth = requireAuth();
const counters = { reads: 0, writes: 0, lastReadAt: 0, lastWriteAt: 0 };

router.post("/auth/verify", limiters.auth, async (req, res) => {
  const idToken = String(req.body?.idToken || "").trim();
  if (!idToken) return res.status(400).json({ error: "missing_id_token" });
  try {
    const user = await verifyGoogleIdToken(idToken);
    const { state } = readState();
    res.json({ ok: true, user, isGlobalAdmin: isGlobalAdmin(state, user) });
  } catch (err) {
    const message = String(err.message || "token_verification_failed");
    res.status(message === "google_client_id_not_configured" ? 500 : 401).json({ error: message });
  }
});

router.get("/runtime-config", (_req, res) => {
  res.json({
    appVersion: config.appVersion,
    googleClientId: config.googleClientId,
    authConfigured: Boolean(config.googleClientId),
    tbaConfigured: Boolean(config.tbaApiKey)
  });
});

router.get("/health", limiters.read, auth, (_req, res) => {
  const db = integrityCheck();
  res.json({
    ok: db.ok,
    dbIntegrity: db,
    authConfigured: Boolean(config.googleClientId),
    tbaConfigured: Boolean(config.tbaApiKey),
    ...counters
  });
});

router.get("/state", limiters.read, auth, (_req, res) => {
  const { state, updatedAt } = readState();
  counters.reads += 1;
  counters.lastReadAt = Date.now();
  res.json({ payload: state, updatedAt });
});

router.put("/state", limiters.write, auth, requireSameOrigin, (req, res) => {
  const normalized = normalizeState(req.body?.payload);
  const validation = validateState(normalized);
  if (!validation.ok) return res.status(400).json({ error: "invalid_payload", detail: validation.error });
  const current = readState();
  const authz = checkAuthorization(current.state, normalized, req.authUser);
  if (!authz.ok) return res.status(403).json({ error: "forbidden_state_change", detail: authz.error });
  const updatedAt = writeState(normalized, current.updatedAt);
  counters.writes += 1;
  counters.lastWriteAt = updatedAt;
  res.json({ ok: true, updatedAt });
});

function validateParam(re, param, errorName) {
  return (req, res, next) => (re.test(req.params[param]) ? next() : res.status(400).json({ error: errorName }));
}

router.get(
  "/tba/events/:year/simple",
  limiters.tba,
  validateParam(YEAR_RE, "year", "invalid_year"),
  tbaProxyHandler((p) => `/events/${p.year}/simple`)
);

router.get(
  "/tba/event/:eventKey/matches",
  limiters.tba,
  validateParam(EVENT_KEY_RE, "eventKey", "invalid_event_key"),
  tbaProxyHandler((p) => `/event/${p.eventKey}/matches`)
);

router.get(
  "/tba/event/:eventKey/teams/simple",
  limiters.tba,
  validateParam(EVENT_KEY_RE, "eventKey", "invalid_event_key"),
  tbaProxyHandler((p) => `/event/${p.eventKey}/teams/simple`)
);

router.get(
  "/tba/event/:eventKey/alliances",
  limiters.tba,
  validateParam(EVENT_KEY_RE, "eventKey", "invalid_event_key"),
  tbaProxyHandler((p) => `/event/${p.eventKey}/alliances`)
);

module.exports = router;
