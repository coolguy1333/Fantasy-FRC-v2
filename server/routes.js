const express = require("express");
const config = require("./config");
const { readState, writeState } = require("./db");
const { normalizeState, validateState, MAX_NAME, MAX_CONTACT, MAX_MESSAGE, MAX_FEEDBACK } = require("./state/schema");
const { checkAuthorization, isGlobalAdmin } = require("./state/authorize");
const { redactForNonAdmin, restoreAdminOnlyDomains } = require("./state/redact");
const { checkPredictionLocks } = require("./state/locks");
const { verifyGoogleIdToken, requireAuth } = require("./auth");
const { createSession, lookupSession, deleteSession, readSessionId, setSessionCookie, clearSessionCookie, listAccounts, deleteSessionsFor } = require("./sessions");
const { claimAvailable, checkSetupCode } = require("./setup");
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

// Google proves who someone is once; from then on the session cookie does.
router.post("/auth/verify", limiters.auth, requireSameOrigin, smallJson, async (req, res) => {
  const idToken = String(req.body?.idToken || "").trim();
  if (!idToken) return res.status(400).json({ error: "missing_id_token" });
  try {
    const user = await verifyGoogleIdToken(idToken);
    const { state } = readState();
    setSessionCookie(req, res, createSession(user));
    res.json({ ok: true, user, isGlobalAdmin: isGlobalAdmin(state, user) });
  } catch (err) {
    const message = String(err.message || "token_verification_failed");
    res.status(message === "google_client_id_not_configured" ? 500 : 401).json({ error: message });
  }
});

// Who is signed in right now? Answers 200 with user: null rather than 401, so
// a signed-out visitor doesn't get an error in their console on every page load.
router.get("/auth/session", limiters.read, (req, res) => {
  const id = readSessionId(req);
  const session = lookupSession(id);
  if (!session) return res.json({ user: null, isGlobalAdmin: false });
  if (session.renewed) setSessionCookie(req, res, id);
  res.json({ user: session.user, isGlobalAdmin: isGlobalAdmin(readState().state, session.user) });
});

router.post("/auth/logout", limiters.auth, requireSameOrigin, (req, res) => {
  deleteSession(readSessionId(req));
  clearSessionCookie(req, res);
  res.json({ ok: true });
});

router.get("/runtime-config", (_req, res) => {
  const { state } = readState();
  res.json({
    appVersion: config.appVersion,
    googleClientId: config.googleClientId,
    authConfigured: Boolean(config.googleClientId),
    tbaConfigured: Boolean(config.tbaApiKey),
    // Shown to everyone, guests included, so it lives here rather than only in the synced document.
    announcement: state.announcement?.text || "",
    // The event everyone starts on until they choose their own.
    featuredEvent: state.siteSettings?.featuredEvent || "",
    // True until someone is made an admin from inside the app: the setup code still works.
    adminClaimAvailable: claimAvailable(state)
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
  // Clients poll with the version they already have; most of the time nothing
  // changed, and answering with a few bytes beats resending the whole document.
  if (req.query.since !== undefined && Number(req.query.since) === updatedAt) return res.json({ unchanged: true, updatedAt });
  const payload = isGlobalAdmin(state, req.authUser) ? state : redactForNonAdmin(state, req.authUser);
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
    // A domain the client didn't send keeps its stored value: a tab opened before an
    // update added a domain must not wipe it (or be refused for "changing" it).
    const payload = req.body?.payload;
    const incoming = normalizeState(payload && typeof payload === "object" && !Array.isArray(payload) ? { ...current.state, ...payload } : payload);
    const normalized = admin ? incoming : restoreAdminOnlyDomains(current.state, incoming, req.authUser);
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

const CODE_RE = /^[A-Z0-9]{5}$/;

function findTeamByCode(state, raw) {
  const code = String(raw || "").trim().toUpperCase();
  if (!CODE_RE.test(code)) return null;
  const teamId = Object.keys(state.teamInviteCodes).find((id) => String(state.teamInviteCodes[id]).toUpperCase() === code && state.groups[id]);
  return teamId ? { teamId, name: state.groups[teamId].name || teamId } : null;
}

// Team codes are secrets: they are never sent to people who aren't on the team,
// and joining goes through here, where the server checks the code itself.
router.post("/teams/preview", limiters.code, auth, requireSameOrigin, smallJson, (req, res) => {
  const team = findTeamByCode(readState().state, req.body?.code);
  if (!team) return res.status(404).json({ error: "invalid_code" });
  res.json({ ok: true, ...team });
});

router.post("/teams/join", limiters.code, auth, requireSameOrigin, smallJson, (req, res) => {
  const current = readState();
  const team = findTeamByCode(current.state, req.body?.code);
  if (!team) return res.status(404).json({ error: "invalid_code" });
  current.state.profileTeams[req.authUser.sub] = team.teamId;
  res.json({ ok: true, ...team, updatedAt: writeState(current.state, current.updatedAt) });
});

// ---------------------------------------------------------------- admin

function requireGlobalAdmin(req, res, next) {
  if (isGlobalAdmin(readState().state, req.authUser)) return next();
  res.status(403).json({ error: "global_admin_required" });
}

// Become a global admin with the setup code from the server log (see server/setup.js).
router.post("/admin/claim", limiters.code, auth, requireSameOrigin, smallJson, (req, res) => {
  const current = readState();
  if (!claimAvailable(current.state)) return res.status(409).json({ error: "already_claimed" });
  if (!checkSetupCode(req.body?.code)) return res.status(403).json({ error: "invalid_code" });
  if (!current.state.globalAdminIds.includes(req.authUser.sub)) current.state.globalAdminIds.push(req.authUser.sub);
  res.json({ ok: true, updatedAt: writeState(current.state, current.updatedAt) });
});

// Who has signed in: emails aren't part of the shared document, so admins get them here.
router.get("/admin/accounts", limiters.read, auth, requireGlobalAdmin, (_req, res) => {
  res.json({ accounts: listAccounts() });
});

// Sign someone out on every device (e.g. after removing them).
router.post("/admin/revoke-sessions", limiters.write, auth, requireSameOrigin, requireGlobalAdmin, smallJson, (req, res) => {
  const sub = String(req.body?.sub || "");
  if (!sub) return res.status(400).json({ error: "missing_sub" });
  res.json({ ok: true, revoked: deleteSessionsFor(sub) });
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
