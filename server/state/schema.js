// The whole app shares one JSON "state" document. Each top-level key is a
// "domain" - see authorize.js for who is allowed to write to which domain.

const DOMAINS = [
  "profiles",
  "predictionsByProfile",
  "groups",
  "profileTeams",
  "teamAdmins",
  "teamInviteCodes",
  "globalAdminIds",
  "globalAdminEmails",
  "eventSummaries",
  "bracketPicksByProfile",
  "bracketScoreByProfile",
  "pointAdjustments",
  "adminByEvent",
  "profileSetupDone",
  "showAllEventsInCatalog",
  "feedback"
];

function emptyState() {
  return {
    profiles: {},
    predictionsByProfile: {},
    groups: {},
    profileTeams: {},
    teamAdmins: {},
    teamInviteCodes: {},
    globalAdminIds: [],
    globalAdminEmails: [],
    eventSummaries: {},
    bracketPicksByProfile: {},
    bracketScoreByProfile: {},
    pointAdjustments: {},
    adminByEvent: {},
    profileSetupDone: {},
    showAllEventsInCatalog: false,
    feedback: []
  };
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

// Fill in anything missing, drop anything unrecognized, and coerce obvious
// type mistakes so a malformed client payload can't corrupt the store.
function normalizeState(raw) {
  const base = emptyState();
  const input = isPlainObject(raw) ? raw : {};
  const out = {};
  for (const key of DOMAINS) {
    const value = input[key];
    if (Array.isArray(base[key])) out[key] = Array.isArray(value) ? value : base[key];
    else if (typeof base[key] === "boolean") out[key] = typeof value === "boolean" ? value : base[key];
    else out[key] = isPlainObject(value) ? value : base[key];
  }
  return out;
}

function validateState(state) {
  for (const key of DOMAINS) {
    if (!(key in state)) return { ok: false, error: `missing_domain:${key}` };
  }
  if (Object.keys(state).length !== DOMAINS.length) return { ok: false, error: "unexpected_domain_present" };
  if (state.feedback.length > 5000) return { ok: false, error: "feedback_too_large" };
  return { ok: true };
}

module.exports = { DOMAINS, emptyState, normalizeState, validateState };
