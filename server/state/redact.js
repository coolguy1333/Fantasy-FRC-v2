// Some data is only meant for some people. Every client still round-trips the
// whole document, so it is emptied on read, and on write the server puts the real
// values back before diffing - a copy of something the caller couldn't see is
// never trusted.
//
//  - feedback / admin lists: global admins only (contact details, who has power).
//  - team invite codes: only the team's admins and its members. A code is the
//    secret that lets someone join, so it must not be readable by everyone.

const ADMIN_ONLY_DOMAINS = ["feedback", "globalAdminIds", "globalAdminEmails"];

function visibleTeamIds(state, user) {
  const admins = state.teamAdmins || {};
  return new Set(
    Object.keys(state.teamInviteCodes || {}).filter(
      (teamId) => (Array.isArray(admins[teamId]) && admins[teamId].includes(user.sub)) || state.profileTeams?.[user.sub] === teamId
    )
  );
}

function redactForNonAdmin(state, user) {
  const copy = { ...state };
  for (const domain of ADMIN_ONLY_DOMAINS) copy[domain] = [];
  const visible = visibleTeamIds(state, user);
  copy.teamInviteCodes = Object.fromEntries(Object.entries(state.teamInviteCodes || {}).filter(([teamId]) => visible.has(teamId)));
  return copy;
}

function restoreAdminOnlyDomains(currentState, incomingState, user) {
  const copy = { ...incomingState };
  for (const domain of ADMIN_ONLY_DOMAINS) copy[domain] = currentState[domain];

  const currentCodes = currentState.teamInviteCodes || {};
  const incomingCodes = incomingState.teamInviteCodes || {};
  const visible = visibleTeamIds(currentState, user);
  const merged = {};
  for (const [teamId, code] of Object.entries(currentCodes)) {
    if (!visible.has(teamId)) merged[teamId] = code;
    else if (Object.prototype.hasOwnProperty.call(incomingCodes, teamId)) merged[teamId] = incomingCodes[teamId];
  }
  // A brand-new team's code comes from its creator (authorize.js checks they are its only admin).
  for (const [teamId, code] of Object.entries(incomingCodes)) if (!(teamId in currentCodes)) merged[teamId] = code;
  copy.teamInviteCodes = merged;
  return copy;
}

module.exports = { ADMIN_ONLY_DOMAINS, redactForNonAdmin, restoreAdminOnlyDomains };
