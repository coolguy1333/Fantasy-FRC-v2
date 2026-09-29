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

const MAX_NAME = 100;
const MAX_CONTACT = 200;
const MAX_MESSAGE = 2000;
const MAX_FEEDBACK = 5000;

function tooLong(value, max) {
  return value !== undefined && value !== null && (typeof value !== "string" || value.length > max);
}

function validateState(state) {
  for (const key of DOMAINS) {
    if (!(key in state)) return { ok: false, error: `missing_domain:${key}` };
  }
  if (Object.keys(state).length !== DOMAINS.length) return { ok: false, error: "unexpected_domain_present" };
  if (state.feedback.length > MAX_FEEDBACK) return { ok: false, error: "feedback_too_large" };
  for (const [id, profile] of Object.entries(state.profiles)) {
    if (profile && typeof profile === "object" && (tooLong(profile.name, MAX_NAME) || tooLong(profile.teamNumber, 20))) {
      return { ok: false, error: `profile_field_too_long:${id}` };
    }
  }
  const codes = Object.values(state.teamInviteCodes).map((c) => String(c).toUpperCase());
  if (new Set(codes).size !== codes.length) return { ok: false, error: "duplicate_team_code" };
  for (const [id, group] of Object.entries(state.groups)) {
    if (group && typeof group === "object" && tooLong(group.name, MAX_NAME)) return { ok: false, error: `team_name_too_long:${id}` };
  }
  for (const item of state.feedback) {
    if (!item || typeof item !== "object" || tooLong(item.name, MAX_NAME) || tooLong(item.contact, MAX_CONTACT) || tooLong(item.message, MAX_MESSAGE)) {
      return { ok: false, error: "feedback_entry_invalid" };
    }
  }
  return { ok: true };
}

module.exports = { DOMAINS, emptyState, normalizeState, validateState, MAX_NAME, MAX_CONTACT, MAX_MESSAGE, MAX_FEEDBACK };
