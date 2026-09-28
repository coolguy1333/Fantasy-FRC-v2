const express = require("express");
const config = require("./config");
const { readState, writeState } = require("./db");
const { normalizeState, validateState, MAX_NAME, MAX_CONTACT, MAX_MESSAGE, MAX_FEEDBACK } = require("./state/schema");
const { checkAuthorization, isGlobalAdmin } = require("./state/authorize");
const { redactForNonAdmin, restoreAdminOnlyDomains } = require("./state/redact");
const { checkPredictionLocks } = require("./state/locks");
const { verifyGoogleIdToken, requireAuth } = require("./auth");
const { limiters, requireSameOrigin } = require("./security");
const { fetchTba, tbaProxyHandler, EVENT_KEY_RE, YEAR_RE } = require("./tba");

const router = express.Router();
const auth = requireAuth();

// Bodies are parsed per route, after auth where there is any, so an anonymous
// caller can never make us buffer a large payload. The state document holds
// everyone's predictions, so it legitimately grows with the number of players.
const smallJson = express.json({ limit: "16kb" });
const stateJson = express.json({ limit: "8mb" });
const MAX_FEEDBACK_PER_USER = 50;

router.use((_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});

router.post("/auth/verify", limiters.auth, smallJson, async (req, res) => {
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

// Liveness check for monitoring / the host's health probe - must stay
// unauthenticated (docs/API.md documents it that way) and cheap, since a
// probe hits it repeatedly with no credentials.
router.get("/health", limiters.read, (_req, res) => {
  res.json({ ok: true });
});

router.get("/state", limiters.read, auth, (req, res) => {
  const { state, updatedAt } = readState();
  const payload = isGlobalAdmin(state, req.authUser) ? state : redactForNonAdmin(state);
  res.json({ payload, updatedAt });
});

// The client sends the whole document plus the updatedAt it was based on. If
// someone else saved in between, reject with 409 so the client can reload and
// re-apply its change - otherwise a stale copy either gets refused forever
// (non-admins) or silently overwrites other people's data (admins).
router.put("/state", limiters.write, auth, requireSameOrigin, stateJson, async (req, res, next) => {
  try {
    const baseUpdatedAt = req.body?.updatedAt;
    if (typeof baseUpdatedAt !== "number" || !Number.isFinite(baseUpdatedAt)) {
      return res.status(400).json({ error: "missing_updated_at" });
    }
    const current = readState();
    if (baseUpdatedAt !== current.updatedAt) return res.status(409).json({ error: "stale_state", updatedAt: current.updatedAt });

    const admin = isGlobalAdmin(current.state, req.authUser);
    const incoming = normalizeState(req.body?.payload);
    const normalized = admin ? incoming : restoreAdminOnlyDomains(current.state, incoming);
    const validation = validateState(normalized);
    if (!validation.ok) return res.status(400).json({ error: "invalid_payload", detail: validation.error });
    const authz = checkAuthorization(current.state, normalized, req.authUser);
    if (!authz.ok) return res.status(403).json({ error: "forbidden_state_change", detail: authz.error });

    if (!admin) {
      const locks = await checkPredictionLocks(current.state, normalized, req.authUser, {
        getMatches: (eventKey) => fetchTba(`/event/${eventKey}/matches`)
      });
      if (!locks.ok) return res.status(locks.status).json({ error: locks.error, detail: locks.detail });
    }

    // The lock check awaited TBA, so someone else may have saved meanwhile.
    // Everything from here to the write is synchronous, so this can't race.
    const latest = readState();
    if (latest.updatedAt !== current.updatedAt) return res.status(409).json({ error: "stale_state", updatedAt: latest.updatedAt });
    res.json({ ok: true, updatedAt: writeState(normalized, latest.updatedAt) });
  } catch (err) {
    next(err);
  }
});

// Feedback is appended server-side (never through the generic state write) so
// it can stay invisible to everyone but global admins.
router.post("/feedback", limiters.write, auth, requireSameOrigin, smallJson, (req, res) => {
  const clean = (value, max) => String(value ?? "").trim().slice(0, max);
  const message = clean(req.body?.message, MAX_MESSAGE);
  if (!message) return res.status(400).json({ error: "message_required" });

  const current = readState();
  const feedback = current.state.feedback;
  if (feedback.length >= MAX_FEEDBACK) return res.status(503).json({ error: "feedback_full" });
  if (feedback.filter((f) => f.profileId === req.authUser.sub).length >= MAX_FEEDBACK_PER_USER) {
    return res.status(429).json({ error: "feedback_limit_reached" });
  }
  feedback.push({
    profileId: req.authUser.sub,
    name: clean(req.body?.name, MAX_NAME),
    contact: clean(req.body?.contact, MAX_CONTACT),
    message,
    at: Date.now()
  });
  writeState(current.state, current.updatedAt);
  res.json({ ok: true });
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

router.use((_req, res) => res.status(404).json({ error: "not_found" }));

module.exports = router;
