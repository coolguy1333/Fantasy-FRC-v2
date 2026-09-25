const config = require("../config");

// Profile IDs are the Google account's `sub` claim - one profile per signed-in
// user, so "own profile" checks are just `key === user.sub`.

function isGlobalAdmin(state, user) {
  if (!user) return false;
  if (config.bootstrapAdminIds.includes(user.sub)) return true;
  if (user.email && config.bootstrapAdminEmails.includes(String(user.email).toLowerCase())) return true;
  const ids = Array.isArray(state.globalAdminIds) ? state.globalAdminIds : [];
  const emails = Array.isArray(state.globalAdminEmails) ? state.globalAdminEmails : [];
  if (ids.includes(user.sub)) return true;
  if (user.email && emails.includes(String(user.email).toLowerCase())) return true;
  return false;
}

function teamsAdministeredBy(state, user) {
  if (!user) return [];
  const teamAdmins = state.teamAdmins || {};
  return Object.keys(teamAdmins).filter((teamId) => {
    const admins = teamAdmins[teamId];
    return Array.isArray(admins) && admins.includes(user.sub);
  });
}

function diffKeys(prevDomain, nextDomain) {
  const a = prevDomain || {};
  const b = nextDomain || {};
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  const changed = [];
  for (const key of keys) {
    if (JSON.stringify(a[key]) !== JSON.stringify(b[key])) changed.push(key);
  }
  return changed;
}

const OWN_PROFILE_DOMAINS = [
  "profiles",
  "predictionsByProfile",
  "eventSummaries",
  "bracketPicksByProfile",
  "bracketScoreByProfile",
  "profileSetupDone"
];

const TEAM_SCOPED_DOMAINS = ["profileTeams", "teamAdmins", "teamInviteCodes"];

const GLOBAL_ONLY_DOMAINS = [
  "groups",
  "globalAdminIds",
  "globalAdminEmails",
  "pointAdjustments",
  "adminByEvent",
  "showAllEventsInCatalog"
];

function checkAuthorization(prevState, nextState, user) {
  if (!user) return { ok: false, error: "authentication_required" };
  if (isGlobalAdmin(prevState, user)) return { ok: true };

  const adminTeams = teamsAdministeredBy(prevState, user);

  for (const domain of OWN_PROFILE_DOMAINS) {
    const changed = diffKeys(prevState[domain], nextState[domain]);
    const illegal = changed.filter((key) => key !== user.sub);
    if (illegal.length) return { ok: false, error: `${domain}:${illegal[0]}:not_own_profile` };
  }

  for (const domain of TEAM_SCOPED_DOMAINS) {
    const changed = diffKeys(prevState[domain], nextState[domain]);
    for (const key of changed) {
      const teamId = domain === "profileTeams" ? nextState.profileTeams[key] || prevState.profileTeams[key] : key;
      const isOwnMembership = domain === "profileTeams" && key === user.sub;
      const manages = teamId && adminTeams.includes(teamId);
      if (!isOwnMembership && !manages) return { ok: false, error: `${domain}:${key}:not_team_admin` };
    }
  }

  // Feedback is append-only, and only for one's own new entry per write.
  const prevFeedback = Array.isArray(prevState.feedback) ? prevState.feedback : [];
  const nextFeedback = Array.isArray(nextState.feedback) ? nextState.feedback : [];
  if (nextFeedback.length !== prevFeedback.length) {
    if (nextFeedback.length !== prevFeedback.length + 1) return { ok: false, error: "feedback:bulk_change_not_allowed" };
    const added = nextFeedback[nextFeedback.length - 1];
    if (!added || added.profileId !== user.sub) return { ok: false, error: "feedback:must_be_own_entry" };
    for (let i = 0; i < prevFeedback.length; i += 1) {
      if (JSON.stringify(prevFeedback[i]) !== JSON.stringify(nextFeedback[i])) {
        return { ok: false, error: "feedback:existing_entries_immutable" };
      }
    }
  } else if (JSON.stringify(prevFeedback) !== JSON.stringify(nextFeedback)) {
    return { ok: false, error: "feedback:edits_not_allowed" };
  }

  for (const domain of GLOBAL_ONLY_DOMAINS) {
    const changed = diffKeys(prevState[domain], nextState[domain]);
    if (changed.length) return { ok: false, error: `${domain}:global_admin_required` };
  }

  return { ok: true };
}

module.exports = { isGlobalAdmin, teamsAdministeredBy, checkAuthorization };
