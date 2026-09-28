// Some domains are only meant for global admins: the feedback inbox holds
// other people's contact details, and the admin lists reveal who has power.
// Every client still round-trips the whole document, so non-admins get these
// domains emptied on read, and on write the server puts the real values back
// before diffing - a non-admin's copy of them is never trusted.

const ADMIN_ONLY_DOMAINS = ["feedback", "globalAdminIds", "globalAdminEmails"];

function redactForNonAdmin(state) {
  const copy = { ...state };
  for (const domain of ADMIN_ONLY_DOMAINS) copy[domain] = [];
  return copy;
}

function restoreAdminOnlyDomains(currentState, incomingState) {
  const copy = { ...incomingState };
  for (const domain of ADMIN_ONLY_DOMAINS) copy[domain] = currentState[domain];
  return copy;
}

module.exports = { ADMIN_ONLY_DOMAINS, redactForNonAdmin, restoreAdminOnlyDomains };
