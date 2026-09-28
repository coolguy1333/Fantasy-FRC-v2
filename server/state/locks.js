// Predictions "lock" 10 minutes before a match starts. The browser greys the
// inputs out, but that alone is decorative - anyone can call the API directly -
// so the server re-checks every changed prediction against live TBA data.

const LOCK_WINDOW_MS = 10 * 60 * 1000;
const MAX_EVENTS_PER_WRITE = 5;

const MATCH_KEY_RE = /^(\d{4}[a-z0-9]{1,24})_[a-z0-9]+$/i;
const BRACKET_KEY_RE = /^(\d{4}[a-z0-9]{1,24}):(u[1-7]|l[1-6]|f[1-3])$/;

// Keep in sync with gameIdForMatch in public/js/scoring.js.
const SF_GAMES = { 1: "u1", 2: "u2", 3: "u3", 4: "u4", 5: "l1", 6: "l2", 7: "u5", 8: "u6", 9: "l3", 10: "l4", 11: "u7", 12: "l5", 13: "l6" };
const F_GAMES = { 1: "f1", 2: "f2", 3: "f3" };

function gameIdForMatch(match) {
  if (match.comp_level === "sf") return SF_GAMES[match.match_number] || null;
  if (match.comp_level === "f") return F_GAMES[match.match_number] || null;
  return null;
}

function changedKeys(prev, next) {
  const a = prev && typeof prev === "object" ? prev : {};
  const b = next && typeof next === "object" ? next : {};
  return [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((key) => JSON.stringify(a[key]) !== JSON.stringify(b[key]));
}

// Same rule as the client (public/js/ui.js isLocked): closed once the match has
// been played or is within the lock window of its (predicted) start time.
function isClosed(match, now) {
  const score = (alliance) => match.alliances?.[alliance]?.score ?? -1;
  if (score("red") >= 0 && score("blue") >= 0) return true;
  const startSec = match.predicted_time || match.time;
  return Boolean(startSec) && now >= startSec * 1000 - LOCK_WINDOW_MS;
}

const fail = (status, error, detail) => ({ ok: false, status, error, detail });

async function checkPredictionLocks(prevState, nextState, user, { getMatches, now = Date.now() }) {
  const own = (state, domain) => state[domain]?.[user.sub];
  const changes = [];

  for (const key of changedKeys(own(prevState, "predictionsByProfile"), own(nextState, "predictionsByProfile"))) {
    const m = MATCH_KEY_RE.exec(key);
    if (!m) return fail(400, "invalid_prediction_key", key);
    changes.push({ eventKey: m[1], matchKey: key, label: key });
  }
  for (const domain of ["bracketPicksByProfile", "bracketScoreByProfile"]) {
    for (const key of changedKeys(own(prevState, domain), own(nextState, domain))) {
      const m = BRACKET_KEY_RE.exec(key);
      if (!m) return fail(400, "invalid_bracket_key", key);
      changes.push({ eventKey: m[1], gameId: m[2], label: key });
    }
  }
  if (!changes.length) return { ok: true };

  const eventKeys = [...new Set(changes.map((c) => c.eventKey))];
  if (eventKeys.length > MAX_EVENTS_PER_WRITE) return fail(400, "too_many_events");

  const matchesByEvent = {};
  for (const eventKey of eventKeys) {
    try {
      matchesByEvent[eventKey] = await getMatches(eventKey);
    } catch (err) {
      // Fail closed: if we can't tell whether a match has locked, don't guess.
      return err.status === 404 ? fail(400, "unknown_event", eventKey) : fail(503, "lock_check_unavailable");
    }
  }

  for (const change of changes) {
    const matches = matchesByEvent[change.eventKey];
    const match = change.matchKey
      ? matches.find((m) => m.key === change.matchKey)
      : matches.find((m) => gameIdForMatch(m) === change.gameId);
    // A bracket game that isn't in TBA yet can't have started.
    if (!match) {
      if (change.matchKey) return fail(400, "unknown_match", change.matchKey);
      continue;
    }
    if (isClosed(match, now)) return fail(403, "prediction_locked", change.label);
  }
  return { ok: true };
}

module.exports = { checkPredictionLocks, isClosed, gameIdForMatch, LOCK_WINDOW_MS };
